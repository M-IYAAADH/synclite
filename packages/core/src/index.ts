export { NexSync } from './NexSync.js'
export type {
  NexSyncConfig,
  SyncStatus,
  Operation,
  BatchItem,
  ChangeCallback,
  PrefixChange,
  PrefixChangeCallback,
  Unsubscribe,
  LocalStore,
  ClientMessage,
  RelayMessage,
} from './types.js'
export { resolveConflict, reduceOperations, advanceClock } from './crdt/index.js'
export { MemoryStore } from './store/MemoryStore.js'
export { IndexedDBStore } from './store/IndexedDBStore.js'
export { SQLiteStore } from './store/SQLiteStore.js'
