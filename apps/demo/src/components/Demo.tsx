'use client'

import { Panel } from './Panel'

const RELAY_URL =
  process.env['NEXT_PUBLIC_RELAY_URL'] ?? 'ws://localhost:8080'

const APP_ID = 'nexsync-demo'

export function Demo() {
  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold tracking-tight text-white">NexSync</span>
            <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-400">
              Demo
            </span>
          </div>
          <a
            href="https://github.com/M-IYAAADH/NexSync"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            GitHub →
          </a>
        </div>
      </header>

      {/* Hero */}
      <div className="border-b border-gray-800 px-6 py-8">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            Two windows. One relay. Zero config.
          </h1>
          <p className="mt-2 text-gray-400">
            Type in either window — changes appear instantly in the other.
            Hit{' '}
            <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-gray-300">
              ✈️ Go Offline
            </span>{' '}
            to queue writes locally, then{' '}
            <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-xs text-gray-300">
              ⚡ Go Online
            </span>{' '}
            to sync — nothing is lost.
          </p>
          <p className="mt-2 text-xs text-gray-600">
            Relay: <code className="text-gray-500">{RELAY_URL}</code>
          </p>
        </div>
      </div>

      {/* Panels */}
      <main className="flex-1 px-6 py-8">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2">
          <Panel
            panelId="Window A"
            accentClass="border-blue-500/40"
            relayUrl={RELAY_URL}
            appId={APP_ID}
          />
          <Panel
            panelId="Window B"
            accentClass="border-emerald-500/40"
            relayUrl={RELAY_URL}
            appId={APP_ID}
          />
        </div>
      </main>

      {/* How it works */}
      <footer className="border-t border-gray-800 px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
            How it works
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                step: '1',
                title: 'Instant local writes',
                body: 'Every keystroke writes to IndexedDB immediately — no waiting for the network.',
              },
              {
                step: '2',
                title: 'Relay broadcasts',
                body: 'The relay receives the op, stores it, and fans it out to all connected windows in the same app.',
              },
              {
                step: '3',
                title: 'Offline queue',
                body: 'While offline, writes queue locally. On reconnect they flush in order, and conflicts resolve via Last-Write-Wins.',
              },
            ].map(({ step, title, body }) => (
              <div key={step} className="rounded-xl bg-gray-900 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-gray-400">
                    {step}
                  </span>
                  <span className="text-sm font-semibold text-gray-200">{title}</span>
                </div>
                <p className="text-xs leading-relaxed text-gray-500">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-gray-700">
            Built with{' '}
            <a href="https://github.com/M-IYAAADH/NexSync" className="text-gray-500 hover:text-gray-400">
              @nexsync/react
            </a>{' '}
            · MIT License
          </p>
        </div>
      </footer>
    </div>
  )
}
