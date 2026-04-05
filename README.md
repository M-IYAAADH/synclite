# NexSync

> Universal offline-first sync primitive for any app or framework.

**SQLite but with sync** — embed it anywhere, works offline, syncs automatically.

---

## Install

```bash
npm install @nexsync/core
```

## Usage

```typescript
import { NexSync } from '@nexsync/core'

const db = new NexSync({ relay: 'wss://relay.example.com' })

// Write — instant locally, queued for sync
db.set('note:1', { title: 'Hello' })

// Read
const note = await db.get('note:1')

// Subscribe to live updates
const unsub = db.subscribe('note:1', (value) => {
  console.log('updated:', value)
})

// Query by prefix
const notes = await db.query('note:')

// Works offline — queue flushes when connection restores
db.set('note:2', { title: 'Created offline' })
```

## React

```tsx
import { NexSyncProvider, useValue, useQuery } from '@nexsync/react'

function App() {
  return (
    <NexSyncProvider relay="wss://relay.example.com" userId="user-1">
      <NoteList />
    </NexSyncProvider>
  )
}

function NoteList() {
  const notes = useQuery('note:')
  return Object.entries(notes).map(([key, note]) => (
    <div key={key}>{note.title}</div>
  ))
}
```

## Self-host the Relay

```bash
# Docker (recommended)
docker run -p 8080:8080 -e JWT_SECRET=mysecret nexsync/relay

# Or run directly
npx @nexsync/relay start
```

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | WebSocket port |
| `DATABASE_PATH` | `./relay.db` | SQLite file path |
| `JWT_SECRET` | — | JWT auth (optional, open in dev) |
| `AUTH_WEBHOOK` | — | Custom auth endpoint |
| `LOG_LEVEL` | `info` | `debug \| info \| warn \| error` |

## Features

- **Offline-first** — writes are instant, sync happens in the background
- **Automatic conflict resolution** — Last-Write-Wins with Lamport timestamps; delete always wins
- **Reactive subscriptions** — `subscribe(key, cb)` and `subscribePrefix(prefix, cb)`
- **Prefix queries** — `db.query('note:')` returns all matching keys
- **Self-hostable relay** — SQLite-backed, Docker-ready, stateless-friendly
- **Auth** — JWT or custom webhook; open in dev mode
- **Rate limiting** — 100 ops/second per client
- **Reconnection** — exponential backoff (1s → 30s), queued messages never lost

## Architecture

```
App
 └─ @nexsync/core
     ├─ LocalStore   (IndexedDB / SQLite / Memory)
     ├─ CRDT Layer   (LWW + Automerge)
     ├─ Op Queue     (offline persistence)
     └─ WS Manager   (connect / reconnect / heartbeat)
          │ wss://
     @nexsync/relay
          ├─ WebSocket Server
          ├─ SQLite Op Log
          └─ Broadcaster
```

## Packages

| Package | Description | Status |
|---|---|---|
| `@nexsync/core` | Client library | ✅ Phase 1 |
| `@nexsync/relay` | Relay server | ✅ Phase 1 |
| `@nexsync/react` | React hooks | Phase 2 |
| `@nexsync/vue` | Vue composables | Phase 3 |
| `@nexsync/react-native` | React Native adapter | Phase 3 |
| `@nexsync/cli` | Developer CLI | Phase 3 |

## Development

```bash
pnpm install
pnpm build    # build all packages
pnpm test     # run all tests
pnpm typecheck
```

## License

MIT
