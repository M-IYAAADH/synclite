/** Status of the Synclite connection to the relay. */
export type SyncStatus = 'connecting' | 'connected' | 'offline' | 'syncing'

/** An immutable record of a single write or delete. Appended locally and synced to the relay. */
export type Operation = {
  /** UUID v4 — unique per operation across all devices */
  id: string
  /** 'set' writes a value; 'delete' removes the key */
  type: 'set' | 'delete'
  /** The key being written or deleted */
  key: string
  /** The value being written (absent for deletes) */
  value?: Record<string, unknown>
  /** Lamport logical clock — increments on every write, used for LWW conflict resolution */
  timestamp: number
  /** Unique identifier for this device/session */
  deviceId: string
  /** Optional user identifier passed in SyncliteConfig */
  userId?: string
  /** True once the relay has confirmed receipt */
  synced: boolean
}

/** Configuration passed to `new Synclite(config)` */
export type SyncliteConfig = {
  /** WebSocket URL of the relay (e.g. 'wss://relay.example.com'). Required unless offline:true. */
  relay?: string
  /** Namespaces all data on the relay. Defaults to 'default'. */
  appId?: string
  /** Identifies the user. Passed to the relay for auth and stored on operations. */
  userId?: string
  /** JWT or custom auth token sent on WebSocket connect. */
  token?: string
  /** Allow fully offline mode with no relay. Defaults to false. */
  offline?: boolean
  /** Local storage backend. Defaults to auto-detect (indexeddb in browser, sqlite in Node). */
  storage?: 'indexeddb' | 'sqlite' | 'memory'
  /** Background sync interval in ms. Defaults to 30000. */
  syncInterval?: number
  /** Emit verbose debug logs. Defaults to false. */
  debug?: boolean
}

/** A single operation in a batch write. */
export type BatchItem =
  | { op: 'set'; key: string; value: Record<string, unknown> }
  | { op: 'delete'; key: string }

/** Callback invoked when a subscribed key changes. */
export type ChangeCallback = (value: Record<string, unknown> | null) => void

/** A single change event emitted by subscribePrefix. */
export type PrefixChange = {
  key: string
  value: Record<string, unknown> | null
  deleted: boolean
}

/** Callback invoked when any key under a subscribed prefix changes. */
export type PrefixChangeCallback = (changes: PrefixChange[]) => void

/** Call to cancel a subscription returned by subscribe / subscribePrefix. */
export type Unsubscribe = () => void

/** Internal interface that all local store adapters implement. */
export interface LocalStore {
  /** Read the current merged value for a key. */
  getValue(key: string): Promise<Record<string, unknown> | null>
  /** Write the current merged value for a key. */
  setValue(key: string, value: Record<string, unknown>): Promise<void>
  /** Remove the current value for a key. */
  deleteValue(key: string): Promise<void>
  /** Return all key-value pairs whose keys start with prefix. */
  queryValues(prefix: string): Promise<Record<string, Record<string, unknown>>>

  /** Persist a new operation to the op log. */
  addOperation(op: Operation): Promise<void>
  /** Return all operations that have not yet been confirmed by the relay. */
  getPendingOperations(): Promise<Operation[]>
  /** Mark an operation as confirmed by the relay. */
  markOperationSynced(id: string): Promise<void>
  /** Return all stored operations for a given key (for conflict resolution). */
  getOperationsForKey(key: string): Promise<Operation[]>
}

/** Messages the client sends to the relay. */
export type ClientMessage =
  | { type: 'auth'; appId: string; userId?: string; token?: string }
  | { type: 'ops'; ops: Operation[] }
  | { type: 'sync'; since: number }

/** Messages the relay sends to the client. */
export type RelayMessage =
  | { type: 'auth:ok'; deviceId: string }
  | { type: 'auth:error'; message: string }
  | { type: 'ops'; ops: Operation[] }
  | { type: 'sync:complete'; latest: number }
  | { type: 'error'; code: string; message: string }
