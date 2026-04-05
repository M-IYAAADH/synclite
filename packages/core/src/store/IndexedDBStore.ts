import { get, set, del, entries, createStore } from 'idb-keyval'
import type { LocalStore, Operation } from '../types.js'

/**
 * IndexedDB-backed store for browser environments.
 * Uses two separate IDB stores: one for current key-value pairs, one for the op log.
 */
export class IndexedDBStore implements LocalStore {
  private valuesStore: ReturnType<typeof createStore>
  private opsStore: ReturnType<typeof createStore>

  constructor(dbName = 'synclite') {
    this.valuesStore = createStore(`${dbName}-values`, 'values')
    this.opsStore = createStore(`${dbName}-ops`, 'ops')
  }

  async getValue(key: string): Promise<Record<string, unknown> | null> {
    const result = await get<Record<string, unknown>>(key, this.valuesStore)
    return result ?? null
  }

  async setValue(key: string, value: Record<string, unknown>): Promise<void> {
    await set(key, value, this.valuesStore)
  }

  async deleteValue(key: string): Promise<void> {
    await del(key, this.valuesStore)
  }

  async queryValues(prefix: string): Promise<Record<string, Record<string, unknown>>> {
    const all = await entries<string, Record<string, unknown>>(this.valuesStore)
    const result: Record<string, Record<string, unknown>> = {}
    for (const [k, v] of all) {
      if (k.startsWith(prefix)) {
        result[k] = v
      }
    }
    return result
  }

  async addOperation(op: Operation): Promise<void> {
    await set(op.id, op, this.opsStore)
  }

  async getPendingOperations(): Promise<Operation[]> {
    const all = await entries<string, Operation>(this.opsStore)
    return all.filter(([, op]) => !op.synced).map(([, op]) => op)
  }

  async markOperationSynced(id: string): Promise<void> {
    const op = await get<Operation>(id, this.opsStore)
    if (op) {
      await set(id, { ...op, synced: true }, this.opsStore)
    }
  }

  async getOperationsForKey(key: string): Promise<Operation[]> {
    const all = await entries<string, Operation>(this.opsStore)
    return all.filter(([, op]) => op.key === key).map(([, op]) => op)
  }
}
