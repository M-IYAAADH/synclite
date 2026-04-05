'use client'

import { useEffect, useState } from 'react'
import type { SyncStatus } from '@nexsync/core'
import { useNexSync } from './context.js'

// ── useValue ──────────────────────────────────────────────────────────────────

/**
 * Subscribe to a single key. Returns the current value and re-renders whenever it changes.
 * The initial render returns `null` until the stored value is loaded.
 *
 * @example
 * ```tsx
 * const note = useValue('note:1')
 * return <h1>{note?.title ?? 'Loading...'}</h1>
 * ```
 */
export function useValue(key: string): Record<string, unknown> | null {
  const db = useNexSync()
  const [value, setValue] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    // subscribe fires immediately with the current stored value, then on every change
    return db.subscribe(key, setValue)
  }, [db, key])

  return value
}

// ── useQuery ──────────────────────────────────────────────────────────────────

/**
 * Subscribe to all keys that start with a prefix.
 * Returns a live map of `{ [key]: value }` that updates in real time.
 *
 * @example
 * ```tsx
 * const notes = useQuery('note:')
 * return Object.entries(notes).map(([id, note]) => <div key={id}>{note.title}</div>)
 * ```
 */
export function useQuery(prefix: string): Record<string, Record<string, unknown>> {
  const db = useNexSync()
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({})

  useEffect(() => {
    // Load current snapshot
    void db.query(prefix).then(setValues)

    // Subscribe to future changes
    return db.subscribePrefix(prefix, (changes) => {
      setValues((prev) => {
        const next = { ...prev }
        for (const change of changes) {
          if (change.deleted || change.value === null) {
            delete next[change.key]
          } else if (change.value !== null) {
            next[change.key] = change.value
          }
        }
        return next
      })
    })
  }, [db, prefix])

  return values
}

// ── useStatus ─────────────────────────────────────────────────────────────────

/**
 * Returns the current relay connection status.
 * Re-renders whenever the status changes.
 *
 * @returns `'connecting' | 'connected' | 'offline' | 'syncing'`
 *
 * @example
 * ```tsx
 * const status = useStatus()
 * return <span className={status === 'offline' ? 'text-red-500' : 'text-green-500'}>{status}</span>
 * ```
 */
export function useStatus(): SyncStatus {
  const db = useNexSync()
  const [status, setStatus] = useState<SyncStatus>(() => db.status)

  useEffect(() => {
    // Sync in case status changed between render and effect run
    setStatus(db.status)
    return db.onStatusChange(setStatus)
  }, [db])

  return status
}
