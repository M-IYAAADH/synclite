import { useState, useEffect } from 'react'
import type { SyncStatus } from '@nexsync/core'
import { useNexSync } from './context.js'

/**
 * Subscribe to a single key. Returns the current value and re-renders whenever
 * it changes (locally or via sync from another device).
 *
 * @example
 * ```tsx
 * function NoteTitle({ id }: { id: string }) {
 *   const note = useValue(`note:${id}`)
 *   return <Text>{String(note?.title ?? '')}</Text>
 * }
 * ```
 */
export function useValue(key: string): Record<string, unknown> | null {
  const db = useNexSync()
  const [value, setValue] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    return db.subscribe(key, setValue)
  }, [db, key])

  return value
}

/**
 * Subscribe to all keys that start with `prefix`. Returns a live-updating map of
 * key → value. New keys, updates, and deletes are all reflected automatically.
 *
 * @example
 * ```tsx
 * function NoteList() {
 *   const notes = useQuery('note:')
 *   return Object.entries(notes).map(([key, note]) => (
 *     <NoteItem key={key} data={note} />
 *   ))
 * }
 * ```
 */
export function useQuery(prefix: string): Record<string, Record<string, unknown>> {
  const db = useNexSync()
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({})

  useEffect(() => {
    void db.query(prefix).then(setValues)

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

/**
 * Returns the current sync status: `'connecting'`, `'connected'`, `'offline'`,
 * or `'syncing'`. Updates automatically when the connection state changes.
 */
export function useStatus(): SyncStatus {
  const db = useNexSync()
  const [status, setStatus] = useState<SyncStatus>(() => db.status)

  useEffect(() => {
    setStatus(db.status)
    return db.onStatusChange(setStatus)
  }, [db])

  return status
}
