import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'crypto'
import { RelayDB } from './db.js'
import { Broadcaster } from './broadcaster.js'
import { verifyToken } from './auth.js'
import { Logger } from './logger.js'
import type { RelayConfig, ConnectedClient, ClientMessage, RelayMessage, Operation } from './types.js'

// Rate limiting: max ops per second per connection
const MAX_OPS_PER_SECOND = 100
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

  // Rate limiting: connectionId → { count, resetAt }
  private rateLimits = new Map<string, { count: number; resetAt: number }>()

  constructor(private readonly config: RelayConfig) {
    this.log = new Logger(config.logLevel)
    this.db = new RelayDB(config.databasePath)
    this.broadcaster = new Broadcaster()

    this.wss = new WebSocketServer({
      port: config.port,
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
    const result = await verifyToken(msg.token, msg.appId, this.config)

    if (!result.ok) {
      this.log.warn(`auth failed for ${connectionId}: ${result.reason}`)
      this.send(ws, { type: 'auth:error', message: result.reason })
      ws.close()
      return
    }

    const deviceId = randomUUID()
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

  private checkRateLimit(connectionId: string): boolean {
    const now = Date.now()
    const limit = this.rateLimits.get(connectionId) ?? { count: 0, resetAt: now + 1000 }

    if (now > limit.resetAt) {
      limit.count = 0
      limit.resetAt = now + 1000
    }

    limit.count++
    this.rateLimits.set(connectionId, limit)
    return limit.count <= MAX_OPS_PER_SECOND
  }

  private send(ws: WebSocket, msg: RelayMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  /** Gracefully shut down the relay. */
  close(): Promise<void> {
    return new Promise((resolve) => {
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
