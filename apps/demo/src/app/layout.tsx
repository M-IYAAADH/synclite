import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NexSync Demo — Offline-First Sync',
  description:
    'See two windows sync in real time. Go offline, make changes, come back online — nothing is lost.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-gray-950 text-gray-100 antialiased">{children}</body>
    </html>
  )
}
