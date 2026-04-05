'use client'

import { useState, useCallback } from 'react'
import { NexSyncProvider, useNexSync, useValue, useStatus } from '@nexsync/react'
import { StatusDot } from './StatusDot'

// ── Inner component — must be inside NexSyncProvider ────────────────────────

function PanelInner({
  panelId,
  accentClass,
}: {
  panelId: string
  accentClass: string
}) {
  const db = useNexSync()
  const status = useStatus()
  const noteValue = useValue('demo:note')
  const text = typeof noteValue?.['text'] === 'string' ? noteValue['text'] : ''

  const [isOffline, setIsOffline] = useState(false)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      db.set('demo:note', { text: e.target.value })
    },
    [db],
  )

  const toggleOffline = useCallback(() => {
    if (isOffline) {
      // Reconnect by forcing a sync — the WebSocket manager handles reconnect automatically
      void db.sync()
      setIsOffline(false)
    } else {
      db.disconnect()
      setIsOffline(true)
    }
  }, [db, isOffline])

  const effectiveStatus = isOffline ? 'offline' : status

  return (
    <div className={`flex flex-col rounded-2xl border-2 ${accentClass} bg-gray-900 overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${accentClass.includes('blue') ? 'bg-blue-500' : 'bg-emerald-500'}`} />
          <span className="text-sm font-semibold text-gray-200">{panelId}</span>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot status={effectiveStatus} />
          <button
            onClick={toggleOffline}
            className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
              isOffline
                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
            }`}
          >
            {isOffline ? '⚡ Go Online' : '✈️ Go Offline'}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="relative flex-1">
        {isOffline && (
          <div className="absolute inset-0 z-10 flex items-start justify-center pt-6 pointer-events-none">
            <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-400">
              Offline — changes queue locally
            </span>
          </div>
        )}
        <textarea
          className="h-full min-h-[280px] w-full resize-none bg-transparent px-4 py-4 text-sm leading-relaxed text-gray-100 placeholder-gray-600 outline-none"
          placeholder="Start typing… changes appear in the other window in real time."
          value={text}
          onChange={handleChange}
          spellCheck={false}
        />
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800 px-4 py-2">
        <span className="text-xs text-gray-600">
          {text.length} chars
        </span>
      </div>
    </div>
  )
}

// ── Public component — owns its own NexSyncProvider ─────────────────────────

export function Panel({
  panelId,
  accentClass,
  relayUrl,
  appId,
}: {
  panelId: string
  accentClass: string
  relayUrl: string
  appId: string
}) {
  return (
    <NexSyncProvider
      relay={relayUrl}
      appId={appId}
      storage="indexeddb"
      syncInterval={0}
      debug={false}
    >
      <PanelInner panelId={panelId} accentClass={accentClass} />
    </NexSyncProvider>
  )
}
