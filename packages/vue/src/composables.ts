import { ref, inject, provide, onUnmounted, type Ref } from 'vue'
import { NexSync, type NexSyncConfig, type SyncStatus } from '@nexsync/core'
import { SYNCLITE_KEY } from './plugin.js'

/**
 * Set up NexSync in a root (or layout) component. Provides the instance to all
 * descendants via `useNexSync()`. Call once at the component tree root.
 *
 * Prefer `app.use(createNexSync(config))` for app-wide setup; use this composable
 * when you need NexSync only inside a specific subtree.
 *
 * @example
 * ```ts
 * // RootLayout.vue
 * const db = useNexSyncSetup({ relay: 'wss://relay.example.com' })
 * ```
 */
export function useNexSyncSetup(config: NexSyncConfig): NexSync {
  const db = new NexSync(config)
  provide(SYNCLITE_KEY, db)
  onUnmounted(() => db.disconnect())
  return db
}

/**
 * Access the NexSync instance provided by a parent `useNexSyncSetup()` call
 * or the `createNexSync()` plugin.
 *
 * Throws if called outside a NexSync context.
 */
export function useNexSync(): NexSync {
  const db = inject(SYNCLITE_KEY)
  if (!db) {
    throw new Error(
      'NexSync: useNexSync() was called outside of a NexSync context. ' +
        'Install the plugin with app.use(createNexSync(config)) or call ' +
        'useNexSyncSetup(config) in an ancestor component.',
    )
  }
  return db
}

/**
 * Reactive ref that tracks the current value of a key. Updates live as sync
 * delivers changes from other clients.
 *
 * @example
 * ```ts
 * const note = useValue('note:1') // Ref<Record<string, unknown> | null>
 * ```
 */
export function useValue(key: string): Ref<Record<string, unknown> | null> {
  const db = useNexSync()
  const value = ref<Record<string, unknown> | null>(null)
  const unsub = db.subscribe(key, (v) => {
    value.value = v
  })
  onUnmounted(unsub)
  return value
}

/**
 * Reactive ref containing all key-value pairs whose keys start with `prefix`.
 * The ref stays up to date as remote or local changes arrive.
 *
 * @example
 * ```ts
 * const notes = useQuery('note:') // Ref<Record<string, Record<string, unknown>>>
 * ```
 */
export function useQuery(prefix: string): Ref<Record<string, Record<string, unknown>>> {
  const db = useNexSync()
  const values = ref<Record<string, Record<string, unknown>>>({})

  // Load initial snapshot
  void db.query(prefix).then((initial) => {
    values.value = initial
  })

  // Keep in sync with future changes
  const unsub = db.subscribePrefix(prefix, (changes) => {
    const next = { ...values.value }
    for (const change of changes) {
      if (change.deleted || change.value === null) {
        delete next[change.key]
      } else if (change.value !== null) {
        next[change.key] = change.value
      }
    }
    values.value = next
  })

  onUnmounted(unsub)
  return values
}

/**
 * Reactive ref tracking the current connection status.
 *
 * @returns `'connecting' | 'connected' | 'offline' | 'syncing'`
 */
export function useStatus(): Ref<SyncStatus> {
  const db = useNexSync()
  const status = ref<SyncStatus>(db.status)
  status.value = db.status
  const unsub = db.onStatusChange((s) => {
    status.value = s
  })
  onUnmounted(unsub)
  return status
}
