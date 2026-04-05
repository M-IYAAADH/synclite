'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'
import { NexSync, type NexSyncConfig } from '@nexsync/core'
import { AsyncStorageStore } from './store/AsyncStorageStore.js'

const NexSyncContext = createContext<NexSync | null>(null)

export type NexSyncProviderProps = Omit<NexSyncConfig, 'storeInstance'> & {
  children: React.ReactNode
}

/**
 * React Native provider that wraps your app and makes NexSync available via hooks.
 * Uses AsyncStorage for persistent offline storage automatically.
 *
 * @example
 * ```tsx
 * export default function App() {
 *   return (
 *     <NexSyncProvider relay="wss://relay.example.com" appId="my-app">
 *       <MyApp />
 *     </NexSyncProvider>
 *   )
 * }
 * ```
 */
export function NexSyncProvider({ children, ...config }: NexSyncProviderProps) {
  const [db] = useState(() => new NexSync({ ...config, storeInstance: new AsyncStorageStore() }))

  useEffect(() => {
    return () => {
      db.disconnect()
    }
  }, [db])

  return <NexSyncContext.Provider value={db}>{children}</NexSyncContext.Provider>
}

/**
 * Access the NexSync instance from any component inside `NexSyncProvider`.
 * Throws if called outside the provider.
 */
export function useNexSync(): NexSync {
  const db = useContext(NexSyncContext)
  if (!db) {
    throw new Error(
      'NexSync: useNexSync() was called outside of <NexSyncProvider>. ' +
        'Wrap your app (or the relevant subtree) with <NexSyncProvider>.',
    )
  }
  return db
}
