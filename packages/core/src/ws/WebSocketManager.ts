import { EventEmitter } from '../events.js'
import type { ClientMessage, RelayMessage } from '../types.js'

type WSEvents = {
  open: []
  close: []
  message: [RelayMessage]
  error: [Error]
}

const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]
const HEARTBEAT_INTERVAL = 25_000

/**
 * Manages the WebSocket connection to the relay.
 *
 * Features:
 * - Exponential backoff on disconnect (1s → 2s → 4s → 8s → 16s → 30s max)
 * - Heartbeat ping every 25 s to detect dead connections
 * - Queues outgoing messages during reconnect — none are lost
 * - Automatically handles browser online/offline events
 */
export class WebSocketManager extends EventEmitter<WSEvents> {
  private ws: WebSocket | null = null
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private sendQueue: string[] = []
  private destroyed = false

  constructor(
    private readonly url: string,
    private readonly debug: boolean = false,
  ) {
    super()
  }

  /** Open the WebSocket connection. Called once on Synclite init. */
  connect(): void {
    if (this.destroyed) return
    this.openSocket()

    // Handle browser online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onBrowserOnline)
      window.addEventListener('offline', this.onBrowserOffline)
    }
  }

  /** Send a typed message to the relay. Queued if not yet connected. */
  send(msg: ClientMessage): void {
    const raw = JSON.stringify(msg)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(raw)
    } else {
      this.sendQueue.push(raw)
      this.log('queued message (not connected)')
    }
  }

  /** Close the connection permanently. */
  destroy(): void {
    this.destroyed = true
    this.clearTimers()
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onBrowserOnline)
      window.removeEventListener('offline', this.onBrowserOffline)
    }
    this.ws?.close()
    this.ws = null
  }

  private openSocket(): void {
    this.log(`connecting to ${this.url}`)
    let ws: WebSocket

    try {
      ws = new WebSocket(this.url)
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      this.scheduleReconnect()
      return
    }

    this.ws = ws

    ws.addEventListener('open', () => {
      this.log('connected')
      this.retryCount = 0
      this.flushQueue()
      this.startHeartbeat()
      this.emit('open')
    })

    ws.addEventListener('close', () => {
      this.log('disconnected')
      this.clearTimers()
      this.emit('close')
      if (!this.destroyed) {
        this.scheduleReconnect()
      }
    })

    ws.addEventListener('message', (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as RelayMessage
        this.emit('message', msg)
      } catch {
        this.log('received unparseable message')
      }
    })

    ws.addEventListener('error', () => {
      // The close event fires right after, which triggers reconnect.
      this.emit('error', new Error(`Synclite: WebSocket error on ${this.url}`))
    })
  }

  private flushQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    while (this.sendQueue.length > 0) {
      const msg = this.sendQueue.shift()
      if (msg) this.ws.send(msg)
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return
    const delay = BACKOFF_DELAYS[Math.min(this.retryCount, BACKOFF_DELAYS.length - 1)] ?? 30_000
    this.retryCount++
    this.log(`reconnecting in ${delay}ms (attempt ${this.retryCount})`)
    this.retryTimer = setTimeout(() => {
      if (!this.destroyed) this.openSocket()
    }, delay)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping')
      }
    }, HEARTBEAT_INTERVAL)
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private onBrowserOnline = (): void => {
    this.log('browser came online — reconnecting')
    this.clearTimers()
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.openSocket()
    }
  }

  private onBrowserOffline = (): void => {
    this.log('browser went offline')
    this.ws?.close()
  }

  private log(msg: string): void {
    if (this.debug) {
      console.log(`[Synclite/ws] ${msg}`)
    }
  }
}
