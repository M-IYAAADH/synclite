'use client'

import type { SyncStatus } from '@nexsync/core'

const STATUS_CONFIG: Record<SyncStatus, { color: string; label: string; pulse: boolean }> = {
  connecting: { color: 'bg-yellow-400', label: 'Connecting…', pulse: true },
  connected: { color: 'bg-green-400', label: 'Connected', pulse: false },
  syncing: { color: 'bg-blue-400', label: 'Syncing…', pulse: true },
  offline: { color: 'bg-red-500', label: 'Offline', pulse: false },
}

export function StatusDot({ status }: { status: SyncStatus }) {
  const { color, label, pulse } = STATUS_CONFIG[status]
  return (
    <div className="flex items-center gap-2">
      <span className="relative flex h-2.5 w-2.5">
        {pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-75`}
          />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`} />
      </span>
      <span className="text-xs font-medium text-gray-400">{label}</span>
    </div>
  )
}
