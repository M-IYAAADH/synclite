import { createServer } from 'http'
import type { IncomingMessage, ServerResponse, Server } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import { RelayDB } from './db.js'
import { Broadcaster } from './broadcaster.js'
import { verifyToken } from './auth.js'
import { Logger } from './logger.js'
import type { RelayConfig, ConnectedClient, ClientMessage, RelayMessage, Operation } from './types.js'

// Max ops per sync request
const MAX_OPS_PER_SYNC = 10_000

/**
 * The Synclite relay server. Accepts WebSocket connections, authenticates clients,
 * persists the operation log, and broadcasts ops to peers.
 */
export class RelayServer {
  private wss: WebSocketServer
  private db: RelayDB
  private broadcaster: Broadcaster
  private log: Logger
  private httpServer: Server

  // Rate limiting: connectionId → { count, resetAt }
  private rateLimits = new Map<string, { count: number; resetAt: number }>()
  private rateLimitCleanupInterval: ReturnType<typeof setInterval>

  constructor(private readonly config: RelayConfig) {
    this.log = new Logger(config.logLevel)
    this.db = new RelayDB(config.databasePath)
    this.broadcaster = new Broadcaster()

    this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res))

    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: config.maxPayloadBytes,
    })

    this.wss.on('connection', (ws, req) => {
      const connectionId = randomUUID()
      const ip = req.socket.remoteAddress ?? 'unknown'
      this.log.debug(`new connection ${connectionId} from ${ip}`)
      this.handleConnection(connectionId, ws)
    })

    this.wss.on('listening', () => {
      this.log.info(`relay listening on port ${config.port}`)
    })

    // Cleanup stale rate limit entries every 60 seconds
    this.rateLimitCleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [id, limit] of this.rateLimits) {
        if (limit.resetAt < now) {
          this.rateLimits.delete(id)
        }
      }
    }, 60_000)

    this.httpServer.listen(config.port)
  }

  private handleConnection(connectionId: string, ws: WebSocket): void {
    let client: ConnectedClient | null = null
    let authenticated = false

    // Auth timeout: close if not authenticated within 10 s
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        this.log.warn(`${connectionId} auth timeout — closing`)
        this.send(ws, { type: 'error', code: 'AUTH_TIMEOUT', message: 'Authentication timeout' })
        ws.close()
      }
    }, 10_000)

    ws.on('message', (rawData) => {
      // Handle heartbeat pings
      if (rawData.toString() === 'ping') {
        ws.send('pong')
        return
      }

      let msg: ClientMessage
      try {
        msg = JSON.parse(rawData.toString()) as ClientMessage
      } catch {
        this.send(ws, { type: 'error', code: 'PARSE_ERROR', message: 'Invalid JSON' })
        return
      }

      if (!authenticated && msg.type !== 'auth') {
        this.send(ws, {
          type: 'error',
          code: 'NOT_AUTHENTICATED',
          message: 'Send auth message first',
        })
        return
      }

      void this.handleMessage(connectionId, ws, msg, () => {
        authenticated = true
        clearTimeout(authTimeout)
        client = this.broadcaster.getClients().find((c) => c.id === connectionId) ?? null
      })
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
      this.broadcaster.remove(connectionId)
      if (client) {
        this.log.debug(`client ${client.deviceId} disconnected`)
      }
    })

    ws.on('error', (err) => {
      this.log.error(`ws error on ${connectionId}: ${err.message}`)
    })
  }

  private async handleMessage(
    connectionId: string,
    ws: WebSocket,
    msg: ClientMessage,
    onAuthenticated: () => void,
  ): Promise<void> {
    switch (msg.type) {
      case 'auth': {
        await this.handleAuth(connectionId, ws, msg, onAuthenticated)
        break
      }

      case 'ops': {
        const client = this.broadcaster.getClients().find((c) => c.id === connectionId)
        if (!client) return

        // Rate limiting
        if (!this.checkRateLimit(connectionId)) {
          this.send(ws, {
            type: 'error',
            code: 'RATE_LIMITED',
            message: 'Too many operations. Max 100 ops/second.',
          })
          return
        }

        const ops = msg.ops.slice(0, MAX_OPS_PER_SYNC)
        this.log.debug(`${connectionId} sent ${ops.length} ops`)

        for (const op of ops) {
          this.db.saveOperation(client.appId, op)
        }

        // Broadcast to other clients in the same app
        this.broadcaster.broadcast(connectionId, client.appId, ops)
        break
      }

      case 'sync': {
        const client = this.broadcaster.getClients().find((c) => c.id === connectionId)
        if (!client) return

        const since = typeof msg.since === 'number' ? msg.since : 0
        this.log.debug(`${connectionId} sync since ${since}`)

        const missedOps = this.db.getOperationsSince(client.appId, since)
        if (missedOps.length > 0) {
          this.send(ws, { type: 'ops', ops: missedOps })
        }

        const latest = this.db.getLatestTimestamp(client.appId)
        this.send(ws, { type: 'sync:complete', latest })
        break
      }
    }
  }

  private async handleAuth(
    connectionId: string,
    ws: WebSocket,
    msg: Extract<ClientMessage, { type: 'auth' }>,
    onAuthenticated: () => void,
  ): Promise<void> {
    const deviceId = randomUUID()
    const result = await verifyToken(msg.token, msg.appId, this.config, deviceId)

    if (!result.ok) {
      this.log.warn(`auth failed for ${connectionId}: ${result.reason}`)
      this.send(ws, { type: 'auth:error', message: result.reason })
      ws.close()
      return
    }
    const client: ConnectedClient = {
      id: connectionId,
      appId: msg.appId,
      userId: msg.userId ?? result.userId,
      deviceId,
      connectedAt: Date.now(),
    }

    this.broadcaster.add(connectionId, ws, client)
    onAuthenticated()

    this.log.info(`client authenticated: app=${msg.appId} device=${deviceId}`)
    this.send(ws, { type: 'auth:ok', deviceId })
  }

  handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname

    try {
      if (req.method === 'GET' && pathname === '/health') {
        this.jsonResponse(res, 200, { status: 'ok', uptime: process.uptime() })
        return
      }

      if (req.method === 'GET' && pathname === '/api/apps') {
        this.jsonResponse(res, 200, { apps: this.db.getDistinctAppIds() })
        return
      }

      if (req.method === 'GET' && pathname === '/api/stats') {
        const appId = url.searchParams.get('appId')
        if (!appId) {
          this.jsonResponse(res, 400, { error: 'appId required' })
          return
        }
        const connectedClients = this.broadcaster.countForApp(appId)
        const totalOps = this.db.getOperationCount(appId)
        const latestTimestamp = this.db.getLatestTimestamp(appId)
        const opsLastMinute = this.db.getOpsInWindow(appId, 60_000)
        this.jsonResponse(res, 200, { connectedClients, totalOps, latestTimestamp, opsLastMinute })
        return
      }

      if (req.method === 'GET' && pathname === '/api/data') {
        const appId = url.searchParams.get('appId')
        if (!appId) {
          this.jsonResponse(res, 400, { error: 'appId required' })
          return
        }
        const prefix = url.searchParams.get('prefix') ?? undefined
        const limitParam = url.searchParams.get('limit')
        const limit = limitParam !== null ? parseInt(limitParam, 10) : 200
        const data = this.db.getCurrentValues(appId, prefix, limit)
        this.jsonResponse(res, 200, { data })
        return
      }

      if (req.method === 'GET' && pathname === '/api/ops') {
        const appId = url.searchParams.get('appId')
        if (!appId) {
          this.jsonResponse(res, 400, { error: 'appId required' })
          return
        }
        const sinceParam = url.searchParams.get('since')
        const since = sinceParam !== null ? parseInt(sinceParam, 10) : undefined
        const limitParam = url.searchParams.get('limit')
        const limit = limitParam !== null ? parseInt(limitParam, 10) : 100
        const ops = this.db.getRecentOps(appId, limit, since)
        this.jsonResponse(res, 200, { ops })
        return
      }

      if (req.method === 'GET' && pathname === '/api/clients') {
        this.jsonResponse(res, 200, { clients: this.broadcaster.getClients() })
        return
      }

      this.jsonResponse(res, 404, { error: 'Not found' })
    } catch (err) {
      this.log.error(`HTTP error: ${err instanceof Error ? err.message : String(err)}`)
      this.jsonResponse(res, 500, { error: 'Internal server error' })
    }
  }

  private jsonResponse(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(json)
  }

  private checkRateLimit(connectionId: string): boolean {
    const now = Date.now()
    const limit = this.rateLimits.get(connectionId) ?? { count: 0, resetAt: now + 1000 }

    if (now > limit.resetAt) {
      limit.count = 0
      limit.resetAt = now + 1000
    }

    limit.count++
    this.rateLimits.set(connectionId, limit)
    return limit.count <= this.config.maxOpsPerSecond
  }

  private send(ws: WebSocket, msg: RelayMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  /** Gracefully shut down the relay. */
  close(): Promise<void> {
    clearInterval(this.rateLimitCleanupInterval)
    return new Promise((resolve) => {
      this.httpServer.close()
      this.wss.close(() => {
        this.db.close()
        resolve()
      })
    })
  }

  /** Return all currently connected clients. */
  getConnectedClients(): ConnectedClient[] {
    return this.broadcaster.getClients()
  }
}
