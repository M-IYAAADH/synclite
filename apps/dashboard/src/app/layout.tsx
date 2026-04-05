'use client'

import './globals.css'
import { Inter } from 'next/font/google'
import Link from 'next/link'

const inter = Inter({ subsets: ['latin'] })

const navItems = [
  { label: 'Overview', href: '/' },
  { label: 'Data Explorer', href: '/data' },
  { label: 'Sync Activity', href: '/sync' },
  { label: 'Clients', href: '/clients' },
  { label: 'Settings', href: '/settings' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-950 text-gray-100 min-h-screen flex`}>
        <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col py-6 px-4 shrink-0">
          <div className="text-lg font-bold text-white mb-8">NexSync</div>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </body>
    </html>
  )
}
