import type { LocalStore, Operation } from '@nexsync/core'

// AsyncStorage is a peer dep — imported via the module specifier React Native resolves
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AsyncStorage = require('@react-native-async-storage/async-storage').default as {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  getAllKeys(): Promise<readonly string[]>
  multiGet(keys: readonly string[]): Promise<readonly [string, string | null][]>
}

const V = 'nexsync:v:'  // value store prefix
const O = 'nexsync:op:' // operation log prefix

/**
 * LocalStore adapter backed by React Native's AsyncStorage.
 * Pass an instance to `NexSyncProvider` via the `storeInstance` prop to enable
 * persistent offline storage on iOS and Android.
 *
 * @example
 * ```tsx
 * import AsyncStorage from '@react-native-async-storage/async-storage'
 * import { NexSyncProvider } from '@nexsync/react-native'
 *
 * <NexSyncProvider relay="wss://relay.example.com">
 *   <App />
 * </NexSyncProvider>
 * // AsyncStorage is used automatically
 * ```
 */
export class AsyncStorageStore implements LocalStore {
  async getValue(key: string): Promise<Record<string, unknown> | null> {
    const raw = await AsyncStorage.getItem(V + key)
    return raw !== null ? (JSON.parse(raw) as Record<string, unknown>) : null
  }

  async setValue(key: string, value: Record<string, unknown>): Promise<void> {
    await AsyncStorage.setItem(V + key, JSON.stringify(value))
  }

  async deleteValue(key: string): Promise<void> {
    await AsyncStorage.removeItem(V + key)
  }

  async queryValues(prefix: string): Promise<Record<string, Record<string, unknown>>> {
    const allKeys = await AsyncStorage.getAllKeys()
    const fullPrefix = V + prefix
    const matching = allKeys.filter((k) => k.startsWith(fullPrefix))
    if (matching.length === 0) return {}

    const pairs = await AsyncStorage.multiGet(matching)
    const result: Record<string, Record<string, unknown>> = {}
    for (const [k, v] of pairs) {
      if (v !== null) {
        result[k.slice(V.length)] = JSON.parse(v) as Record<string, unknown>
      }
    }
    return result
  }

  async addOperation(op: Operation): Promise<void> {
    await AsyncStorage.setItem(O + op.id, JSON.stringify(op))
  }

  async getPendingOperations(): Promise<Operation[]> {
    const allKeys = await AsyncStorage.getAllKeys()
    const opKeys = allKeys.filter((k) => k.startsWith(O))
    if (opKeys.length === 0) return []

    const pairs = await AsyncStorage.multiGet(opKeys)
    const ops: Operation[] = []
    for (const [, v] of pairs) {
      if (v !== null) {
        const op = JSON.parse(v) as Operation
        if (!op.synced) ops.push(op)
      }
    }
    return ops.sort((a, b) => a.timestamp - b.timestamp)
  }

  async markOperationSynced(id: string): Promise<void> {
    const raw = await AsyncStorage.getItem(O + id)
    if (raw !== null) {
      const op = JSON.parse(raw) as Operation
      await AsyncStorage.setItem(O + id, JSON.stringify({ ...op, synced: true }))
    }
  }

  async getOperationsForKey(key: string): Promise<Operation[]> {
    const allKeys = await AsyncStorage.getAllKeys()
    const opKeys = allKeys.filter((k) => k.startsWith(O))
    if (opKeys.length === 0) return []

    const pairs = await AsyncStorage.multiGet(opKeys)
    const ops: Operation[] = []
    for (const [, v] of pairs) {
      if (v !== null) {
        const op = JSON.parse(v) as Operation
        if (op.key === key) ops.push(op)
      }
    }
    return ops
  }
}
