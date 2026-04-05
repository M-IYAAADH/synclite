import Database from 'better-sqlite3'
import type { Operation } from './types.js'

/**
 * SQLite-backed operation log. Append-only — operations are never updated or deleted.
 * Provides fast lookups by (appId, timestamp) for missed-op replay.
 */
export class RelayDB {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id          TEXT PRIMARY KEY,
        app_id      TEXT NOT NULL,
        type        TEXT NOT NULL,
        key_        TEXT NOT NULL,
        value       TEXT,
        timestamp   INTEGER NOT NULL,
        device_id   TEXT NOT NULL,
        user_id     TEXT,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ops_app_ts  ON operations (app_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_ops_app_key ON operations (app_id, key_);
    `)
  }

  /**
   * Persist an operation. Silently ignored if the id already exists (idempotent).
   */
  saveOperation(appId: string, op: Operation): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO operations
           (id, app_id, type, key_, value, timestamp, device_id, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        op.id,
        appId,
        op.type,
        op.key,
        op.value !== undefined ? JSON.stringify(op.value) : null,
        op.timestamp,
        op.deviceId,
        op.userId ?? null,
        Date.now(),
      )
  }

  /**
   * Return all operations for an app with timestamp > since, in ascending order.
   * Used to replay missed ops when a client reconnects.
   */
  getOperationsSince(appId: string, since: number): Operation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM operations WHERE app_id = ? AND timestamp > ? ORDER BY timestamp ASC`,
      )
      .all(appId, since) as RawRow[]
    return rows.map(rowToOp)
  }

  /** Return the highest timestamp in the log for an app, or 0 if none. */
  getLatestTimestamp(appId: string): number {
    const row = this.db
      .prepare(`SELECT MAX(timestamp) AS ts FROM operations WHERE app_id = ?`)
      .get(appId) as { ts: number | null }
    return row.ts ?? 0
  }

  /** Return total operation count for an app. */
  getOperationCount(appId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS cnt FROM operations WHERE app_id = ?`)
      .get(appId) as { cnt: number }
    return row.cnt
  }

  /** Return the latest value for each key (where the latest op is 'set', not 'delete'). */
  getCurrentValues(
    appId: string,
    prefix?: string,
    limit = 200,
  ): Array<{
    key: string
    value: Record<string, unknown>
    timestamp: number
    deviceId: string
    userId: string | undefined
  }> {
    const prefixParam = prefix !== undefined ? `${prefix}%` : null
    const rows = this.db
      .prepare(
        `SELECT o.key_, o.value, o.timestamp, o.device_id, o.user_id
         FROM operations o
         INNER JOIN (
           SELECT key_, MAX(timestamp) as max_ts
           FROM operations WHERE app_id = ?
           GROUP BY key_
         ) latest ON o.key_ = latest.key_ AND o.timestamp = latest.max_ts
         WHERE o.app_id = ? AND o.type = 'set'
           AND (? IS NULL OR o.key_ LIKE ?)
         ORDER BY o.key_ ASC
         LIMIT ?`,
      )
      .all(appId, appId, prefixParam, prefixParam, limit) as Array<{
      key_: string
      value: string | null
      timestamp: number
      device_id: string
      user_id: string | null
    }>
    return rows.map((row) => ({
      key: row.key_,
      value: row.value !== null ? (JSON.parse(row.value) as Record<string, unknown>) : {},
      timestamp: row.timestamp,
      deviceId: row.device_id,
      userId: row.user_id !== null ? row.user_id : undefined,
    }))
  }

  /** Return recent operations for an app in descending timestamp order. */
  getRecentOps(appId: string, limit: number, since?: number): Operation[] {
    const sinceParam = since !== undefined ? since : null
    const rows = this.db
      .prepare(
        `SELECT * FROM operations WHERE app_id = ? AND (? IS NULL OR timestamp > ?)
         ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(appId, sinceParam, sinceParam, limit) as RawRow[]
    return rows.map(rowToOp)
  }

  /** Return all distinct app IDs that have at least one operation. */
  getDistinctAppIds(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT app_id FROM operations ORDER BY app_id ASC`)
      .all() as Array<{ app_id: string }>
    return rows.map((r) => r.app_id)
  }

  /** Return the number of ops in the last N milliseconds */
  getOpsInWindow(appId: string, windowMs: number): number {
    const cutoff = Date.now() - windowMs
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM operations WHERE app_id = ? AND created_at > ?`)
      .get(appId, cutoff) as { cnt: number }
    return row.cnt
  }

  close(): void {
    this.db.close()
  }
}

type RawRow = {
  id: string
  app_id: string
  type: string
  key_: string
  value: string | null
  timestamp: number
  device_id: string
  user_id: string | null
  created_at: number
}

function rowToOp(row: RawRow): Operation {
  return {
    id: row.id,
    type: row.type as Operation['type'],
    key: row.key_,
    value: row.value !== null ? (JSON.parse(row.value) as Record<string, unknown>) : undefined,
    timestamp: row.timestamp,
    deviceId: row.device_id,
    userId: row.user_id !== null ? row.user_id : undefined,
    synced: true,
  }
}
