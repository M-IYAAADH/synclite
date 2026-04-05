import type { LocalStore, Operation } from '../types.js'

/**
 * SQLite-backed store for Node.js environments (server-side rendering, CLI tools, tests).
 * Uses better-sqlite3 which is loaded dynamically to avoid bundling it in browser builds.
 */
export class SQLiteStore implements LocalStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any

  constructor(dbPath = './synclite.db') {
    // Dynamic require so bundlers can tree-shake this in browser builds
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as new (path: string) => unknown
    this.db = new Database(dbPath)
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS values_ (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS operations (
        id        TEXT PRIMARY KEY,
        type      TEXT NOT NULL,
        key_      TEXT NOT NULL,
        value     TEXT,
        timestamp INTEGER NOT NULL,
        device_id TEXT NOT NULL,
        user_id   TEXT,
        synced    INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_ops_key ON operations(key_);
      CREATE INDEX IF NOT EXISTS idx_ops_synced ON operations(synced);
    `)
  }

  async getValue(key: string): Promise<Record<string, unknown> | null> {
    const row = this.db.prepare('SELECT value FROM values_ WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row ? (JSON.parse(row.value) as Record<string, unknown>) : null
  }

  async setValue(key: string, value: Record<string, unknown>): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO values_ (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(value))
  }

  async deleteValue(key: string): Promise<void> {
    this.db.prepare('DELETE FROM values_ WHERE key = ?').run(key)
  }

  async queryValues(prefix: string): Promise<Record<string, Record<string, unknown>>> {
    const rows = this.db
      .prepare("SELECT key, value FROM values_ WHERE key LIKE ? ESCAPE '\\'")
      .all(this.escapeLike(prefix) + '%') as Array<{ key: string; value: string }>

    const result: Record<string, Record<string, unknown>> = {}
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value) as Record<string, unknown>
    }
    return result
  }

  async addOperation(op: Operation): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO operations (id, type, key_, value, timestamp, device_id, user_id, synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        op.id,
        op.type,
        op.key,
        op.value !== undefined ? JSON.stringify(op.value) : null,
        op.timestamp,
        op.deviceId,
        op.userId ?? null,
        op.synced ? 1 : 0,
      )
  }

  async getPendingOperations(): Promise<Operation[]> {
    const rows = this.db
      .prepare('SELECT * FROM operations WHERE synced = 0 ORDER BY timestamp ASC')
      .all() as Array<RawOpRow>
    return rows.map(rowToOp)
  }

  async markOperationSynced(id: string): Promise<void> {
    this.db.prepare('UPDATE operations SET synced = 1 WHERE id = ?').run(id)
  }

  async getOperationsForKey(key: string): Promise<Operation[]> {
    const rows = this.db
      .prepare('SELECT * FROM operations WHERE key_ = ? ORDER BY timestamp ASC')
      .all(key) as Array<RawOpRow>
    return rows.map(rowToOp)
  }

  private escapeLike(s: string): string {
    return s.replace(/[%_\\]/g, (c) => `\\${c}`)
  }
}

type RawOpRow = {
  id: string
  type: string
  key_: string
  value: string | null
  timestamp: number
  device_id: string
  user_id: string | null
  synced: number
}

function rowToOp(row: RawOpRow): Operation {
  const op: Operation = {
    id: row.id,
    type: row.type as Operation['type'],
    key: row.key_,
    timestamp: row.timestamp,
    deviceId: row.device_id,
    synced: row.synced === 1,
    ...(row.value !== null && { value: JSON.parse(row.value) as Record<string, unknown> }),
    ...(row.user_id !== null && { userId: row.user_id }),
  }
  return op
}
