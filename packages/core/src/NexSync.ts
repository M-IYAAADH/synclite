import { v4 as uuidv4 } from 'uuid'
import { EventEmitter } from './events.js'
import { OperationQueue } from './queue/index.js'
import { WebSocketManager } from './ws/index.js'
import { reduceOperations, advanceClock } from './crdt/index.js'
import { MemoryStore } from './store/MemoryStore.js'
import type {
  NexSyncConfig,
  SyncStatus,
  Operation,
  BatchItem,
  ChangeCallback,
  PrefixChangeCallback,
  Unsubscribe,
  LocalStore,
  RelayMessage,
} from './types.js'

type NexSyncEvents = {
  connected: []
  disconnected: []
  'sync:start': []
  'sync:complete': [{ ops: number }]
  'sync:error': [Error]
  'conflict:resolved': [{ key: string; winner: Operation }]
}

/**
 * The main NexSync client. Instantiate once per app.
 *
 * @example
 * ```ts
 * const db = new NexSync({ relay: 'wss://relay.example.com' })
 * db.set('note:1', { title: 'Hello' }) // instant, syncs automatically
 * const note = await db.get('note:1')
 * ```
 */
export class NexSync extends EventEmitter<NexSyncEvents> {
  private readonly deviceId: string
  private readonly appId: string
  private readonly userId: string | undefined
  private readonly config: {
    appId: string
    offline: boolean
    storage: 'indexeddb' | 'sqlite' | 'memory'
    syncInterval: number
    debug: boolean
    relay?: string
    userId?: string
    token?: string
    storeInstance?: import('./types.js').LocalStore
  }

  private store!: LocalStore
  private queue!: OperationQueue
  private wsManager: WebSocketManager | null = null

  private _status: SyncStatus = 'offline'
  private lamportClock = 0
  private authenticated = false
  private lastSyncTimestamp = 0
  private syncIntervalTimer: ReturnType<typeof setInterval> | null = null

  // Subscriptions: key → set of callbacks
  private keySubscriptions = new Map<string, Set<ChangeCallback>>()
  private prefixSubscriptions = new Map<string, Set<PrefixChangeCallback>>()

  constructor(config: NexSyncConfig) {
    super()

    this.config = {
      appId: config.appId ?? 'default',
      offline: config.offline ?? false,
      storage: config.storage ?? 'memory',
      syncInterval: config.syncInterval ?? 30_000,
      debug: config.debug ?? false,
      ...(config.relay !== undefined && { relay: config.relay }),
      ...(config.userId !== undefined && { userId: config.userId }),
      ...(config.token !== undefined && { token: config.token }),
      ...(config.storeInstance !== undefined && { storeInstance: config.storeInstance }),
    }

    this.appId = this.config.appId
    this.userId = config.userId
    this.deviceId = uuidv4()

    this.initStore()

    if (config.relay && !config.offline) {
      this.initWebSocket(config.relay)
    }

    if (this.config.syncInterval > 0 && config.relay) {
      this.syncIntervalTimer = setInterval(() => {
        if (this._status === 'connected') {
          void this.sync()
        }
      }, this.config.syncInterval)
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Write a value to a key. Instant locally, queued for relay sync.
   *
   * @param key   Arbitrary string key (e.g. 'note:abc123')
   * @param value Plain object value
   */
  set(key: string, value: Record<string, unknown>): void {
    const op = this.createOp('set', key, value)
    void this.applyLocalOp(op)
  }

  /**
   * Read the current value for a key.
   *
   * @returns The stored object, or null if the key doesn't exist / was deleted.
   */
  async get(key: string): Promise<Record<string, unknown> | null> {
    return this.store.getValue(key)
  }

  /**
   * Delete a key. Delete wins over any concurrent set (CRDT rule).
   */
  delete(key: string): void {
    const op = this.createOp('delete', key)
    void this.applyLocalOp(op)
  }

  /**
   * Execute multiple set/delete operations atomically in local storage
   * and flush them as a single batch to the relay.
   */
  batch(items: BatchItem[]): void {
    const ops = items.map((item) =>
      item.op === 'set'
        ? this.createOp('set', item.key, item.value)
        : this.createOp('delete', item.key),
    )
    void Promise.all(ops.map((op) => this.applyLocalOp(op)))
  }

  /**
   * Return all key-value pairs whose keys start with the given prefix.
   *
   * @example
   * const notes = await db.query('note:') // { 'note:1': {...}, 'note:2': {...} }
   */
  async query(prefix: string): Promise<Record<string, Record<string, unknown>>> {
    return this.store.queryValues(prefix)
  }

  /**
   * Subscribe to changes on a specific key. Fires immediately with the current value,
   * then on every subsequent change.
   */
  subscribe(key: string, callback: ChangeCallback): Unsubscribe {
    if (!this.keySubscriptions.has(key)) {
      this.keySubscriptions.set(key, new Set())
    }
    this.keySubscriptions.get(key)!.add(callback)

    // Fire immediately with current value
    void this.store.getValue(key).then((v) => callback(v))

    return () => {
      this.keySubscriptions.get(key)?.delete(callback)
    }
  }

  /**
   * Subscribe to all keys that start with a prefix. Fires on any matching key change.
   */
  subscribePrefix(prefix: string, callback: PrefixChangeCallback): Unsubscribe {
    if (!this.prefixSubscriptions.has(prefix)) {
      this.prefixSubscriptions.set(prefix, new Set())
    }
    this.prefixSubscriptions.get(prefix)!.add(callback)

    return () => {
      this.prefixSubscriptions.get(prefix)?.delete(callback)
    }
  }

  /** Current connection status. */
  get status(): SyncStatus {
    return this._status
  }

  /**
   * Subscribe to connection status changes.
   * Fires with 'connected', 'offline', or 'syncing' as the relay state changes.
   */
  onStatusChange(callback: (status: SyncStatus) => void): Unsubscribe {
    const onConnected = () => callback('connected')
    const onDisconnected = () => callback('offline')
    const onSyncStart = () => callback('syncing')
    const onSyncComplete = () => callback('connected')

    this.on('connected', onConnected)
    this.on('disconnected', onDisconnected)
    this.on('sync:start', onSyncStart)
    this.on('sync:complete', onSyncComplete)

    return () => {
      this.off('connected', onConnected)
      this.off('disconnected', onDisconnected)
      this.off('sync:start', onSyncStart)
      this.off('sync:complete', onSyncComplete)
    }
  }

  /**
   * Trigger an immediate sync with the relay.
   * Flushes the pending queue and requests any ops we missed.
   */
  async sync(): Promise<void> {
    if (!this.wsManager || !this.authenticated) return
    this.setStatus('syncing')
    await this.flushQueue()
    this.wsManager.send({ type: 'sync', since: this.lastSyncTimestamp })
  }

  /**
   * Return the number of local operations not yet confirmed by the relay.
   */
  async pendingOps(): Promise<number> {
    return this.queue.pendingCount()
  }

  /**
   * Reconnect to the relay if the connection was dropped or explicitly disconnected.
   * This is a no-op if already connected or connecting.
   * Useful after calling `disconnect()`, or to recover from React Strict Mode cleanup.
   */
  reconnect(): void {
    if (!this.config.relay || this.config.offline) return
    if (this.wsManager !== null) return
    this.authenticated = false
    this.initWebSocket(this.config.relay)
    if (this.config.syncInterval > 0 && this.syncIntervalTimer === null) {
      this.syncIntervalTimer = setInterval(() => {
        if (this._status === 'connected') {
          void this.sync()
        }
      }, this.config.syncInterval)
    }
  }

  /**
   * Permanently close the relay connection and stop all timers.
   */
  disconnect(): void {
    if (this.syncIntervalTimer !== null) {
      clearInterval(this.syncIntervalTimer)
      this.syncIntervalTimer = null
    }
    this.wsManager?.destroy()
    this.wsManager = null
    this.setStatus('offline')
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private initStore(): void {
    if (this.config.storeInstance !== undefined) {
      // Caller-supplied store — used by react-native (AsyncStorage) and tests
      this.store = this.config.storeInstance
    } else if (this.config.storage === 'memory' || typeof window === 'undefined') {
      this.store = new MemoryStore()
    } else {
      // IndexedDB — lazily imported to avoid bundling in Node
      void import('./store/IndexedDBStore.js').then(({ IndexedDBStore }) => {
        this.store = new IndexedDBStore(`nexsync-${this.appId}`)
      })
      // Use memory store until IndexedDB is ready (tiny window on startup)
      this.store = new MemoryStore()
    }
    this.queue = new OperationQueue(this.store)
  }

  private initWebSocket(url: string): void {
    this.setStatus('connecting')
    const ws = new WebSocketManager(url, this.config.debug)
    this.wsManager = ws

    ws.on('open', () => {
      ws.send({
        type: 'auth',
        appId: this.appId,
        ...(this.userId !== undefined && { userId: this.userId }),
        ...(this.config.token !== undefined && { token: this.config.token }),
      })
    })

    ws.on('close', () => {
      this.authenticated = false
      this.setStatus('offline')
      this.emit('disconnected')
    })

    ws.on('message', (msg) => {
      void this.handleRelayMessage(msg)
    })

    ws.on('error', (err) => {
      this.emit('sync:error', err)
    })

    ws.connect()
  }

  private async handleRelayMessage(msg: RelayMessage): Promise<void> {
    switch (msg.type) {
      case 'auth:ok': {
        this.authenticated = true
        this.setStatus('connected')
        this.emit('connected')
        // Flush any ops that queued up before this connection
        await this.sync()
        break
      }

      case 'auth:error': {
        this.emit(
          'sync:error',
          new Error(`NexSync: Relay rejected auth — ${msg.message}`),
        )
        break
      }

      case 'ops': {
        await this.applyRemoteOps(msg.ops)
        break
      }

      case 'sync:complete': {
        this.lastSyncTimestamp = msg.latest
        this.setStatus('connected')
        this.emit('sync:complete', { ops: msg.latest })
        break
      }

      case 'error': {
        this.emit(
          'sync:error',
          new Error(`NexSync: Relay error [${msg.code}] — ${msg.message}`),
        )
        break
      }
    }
  }

  private async applyRemoteOps(ops: Operation[]): Promise<void> {
    for (const remoteOp of ops) {
      // Advance our Lamport clock
      this.lamportClock = advanceClock(this.lamportClock, remoteOp.timestamp)

      // Get all local ops for this key
      const localOps = await this.store.getOperationsForKey(remoteOp.key)

      if (localOps.length === 0) {
        // No conflict — just apply
        await this.applyOpToStore(remoteOp)
        await this.store.addOperation({ ...remoteOp, synced: true })
      } else {
        // Merge: pick the winner
        const allOps = [...localOps, remoteOp]
        const winner = reduceOperations(allOps)!
        const loser = localOps.find((op) => op.id !== winner.id) ?? remoteOp

        if (winner.id !== loser.id) {
          this.emit('conflict:resolved', { key: remoteOp.key, winner })
        }

        await this.applyOpToStore(winner)
        await this.store.addOperation({ ...remoteOp, synced: true })
      }
    }
  }

  private async applyOpToStore(op: Operation): Promise<void> {
    if (op.type === 'delete') {
      await this.store.deleteValue(op.key)
    } else if (op.value !== undefined) {
      await this.store.setValue(op.key, op.value)
    }
    this.notifySubscribers(op)
  }

  private async applyLocalOp(op: Operation): Promise<void> {
    // 1. Write instantly to local store
    await this.applyOpToStore(op)
    // 2. Persist to op log
    await this.queue.enqueue(op)
    // 3. Send immediately if connected
    if (this.authenticated && this.wsManager) {
      this.wsManager.send({ type: 'ops', ops: [op] })
    }
  }

  private async flushQueue(): Promise<void> {
    if (!this.wsManager || !this.authenticated) return
    const pending = await this.queue.getPending()
    if (pending.length === 0) return

    this.emit('sync:start')
    this.wsManager.send({ type: 'ops', ops: pending })
  }

  private createOp(type: 'set', key: string, value: Record<string, unknown>): Operation
  private createOp(type: 'delete', key: string): Operation
  private createOp(
    type: 'set' | 'delete',
    key: string,
    value?: Record<string, unknown>,
  ): Operation {
    this.lamportClock++
    const op: Operation = {
      id: uuidv4(),
      type,
      key,
      timestamp: this.lamportClock,
      deviceId: this.deviceId,
      synced: false,
      ...(value !== undefined && { value }),
      ...(this.userId !== undefined && { userId: this.userId }),
    }
    return op
  }

  private notifySubscribers(op: Operation): void {
    const value = op.type === 'delete' ? null : (op.value ?? null)

    // Key subscribers
    const keySubs = this.keySubscriptions.get(op.key)
    if (keySubs) {
      for (const cb of keySubs) {
        cb(value)
      }
    }

    // Prefix subscribers
    for (const [prefix, subs] of this.prefixSubscriptions) {
      if (op.key.startsWith(prefix)) {
        const changes = [{ key: op.key, value, deleted: op.type === 'delete' }]
        for (const cb of subs) {
          cb(changes)
        }
      }
    }
  }

  private setStatus(status: SyncStatus): void {
    if (this._status !== status) {
      this._status = status
      this.log(`status → ${status}`)
    }
  }

  private log(msg: string): void {
    if (this.config.debug) {
      console.log(`[NexSync] ${msg}`)
    }
  }
}
