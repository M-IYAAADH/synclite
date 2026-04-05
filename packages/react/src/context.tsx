'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { NexSync } from '@nexsync/core'
import type { NexSyncConfig } from '@nexsync/core'

// ── Context ────────────────────────────────────────────────────────────────────

const NexSyncContext = createContext<NexSync | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────────

export type NexSyncProviderProps = NexSyncConfig & {
  children: React.ReactNode
}

/**
 * Wrap your app (or a section of it) with this provider.
 * All `useNexSync`, `useValue`, `useQuery`, and `useStatus` hooks
 * must be rendered inside a `NexSyncProvider`.
 *
 * @example
 * ```tsx
 * <NexSyncProvider relay="wss://relay.example.com" userId="user-1">
 *   <App />
 * </NexSyncProvider>
 * ```
 */
export function NexSyncProvider({ children, ...config }: NexSyncProviderProps) {
  // useState initializer runs exactly once per mount, even in Strict Mode.
  const [db] = useState(() => new NexSync(config))

  useEffect(() => {
    // Disconnect when the provider unmounts
    return () => {
      db.disconnect()
    }
  }, [db])

  return <NexSyncContext.Provider value={db}>{children}</NexSyncContext.Provider>
}

// ── useNexSync ───────────────────────────────────────────────────────────────

/**
 * Access the raw `NexSync` instance to call `set`, `delete`, `batch`, `sync`, etc.
 *
 * @example
 * ```tsx
 * const db = useNexSync()
 * db.set('note:1', { title: 'Hello' })
 * ```
 */
export function useNexSync(): NexSync {
  const db = useContext(NexSyncContext)
  if (!db) {
    throw new Error(
      'useNexSync: no NexSyncProvider found in the component tree. ' +
        'Wrap your component with <NexSyncProvider>.',
    )
  }
  return db
}
