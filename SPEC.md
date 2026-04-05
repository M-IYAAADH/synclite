# Synclite — Full System Specification
> A universal, embeddable, offline-first sync primitive for any app or framework.
> Priority: Developer experience above all else.

---

## 1. Project Overview

### What It Is
A drop-in TypeScript library that gives any application offline-first data sync with automatic conflict resolution. Developers install one package and never think about network state, offline queuing, or merge conflicts again.

### The One-Liner
"SQLite but with sync — embed it anywhere, works offline, syncs automatically."

### Core Promise To Developers
```bash
npm install @synclite/core
```
```typescript
const db = new Synclite({ relay: 'wss://relay.example.com' })
db.set('note:1', { title: 'Hello' })  // works offline, syncs automatically
```
That is the entire API surface for basic usage. Everything else is optional.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Developer's App                       │
│         (Next.js / React Native / Vue / Flutter)         │
└────────────────────────┬────────────────────────────────┘
                         │ imports
┌────────────────────────▼────────────────────────────────┐
│                  @synclite/core                        │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Local Store │  │  CRDT Layer  │  │   Sync Queue   │  │
│  │ (IndexedDB/ │  │ (Automerge)  │  │ (offline ops)  │  │
│  │  SQLite)    │  │              │  │                │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              WebSocket Manager                       │ │
│  │   (connect / disconnect / reconnect / heartbeat)     │ │
│  └─────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket (wss://)
┌────────────────────────▼────────────────────────────────┐
│                  @synclite/relay                        │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  WebSocket  │  │  Op Log DB   │  │   Broadcaster  │  │
│  │   Server    │  │  (SQLite)    │  │                │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│              @synclite/dashboard (Next.js)              │
│         Inspect data • Debug sync • Manage schemas        │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Packages & Monorepo Structure

```
synclite/
├── packages/
│   ├── core/              # The main client library
│   ├── relay/             # The relay server
│   ├── react/             # React adapter (hooks)
│   ├── vue/               # Vue adapter (composables)
│   ├── react-native/      # React Native adapter
│   └── cli/               # Developer CLI tool
├── apps/
│   ├── dashboard/         # Next.js developer dashboard
│   ├── docs/              # Documentation site (Nextra)
│   └── demo/              # Interactive demo app
├── package.json           # Workspace root (pnpm workspaces)
├── turbo.json             # Turborepo config
└── README.md
```

### Tooling
- **Package manager**: pnpm with workspaces
- **Build system**: Turborepo
- **Language**: TypeScript throughout (strict mode)
- **Testing**: Vitest
- **Linting**: ESLint + Prettier
- **CI**: GitHub Actions

---

## 4. Package: @synclite/core

### Responsibilities
- Write data to local storage instantly
- Queue operations for sync
- Connect to relay via WebSocket
- Apply incoming operations from relay
- Merge conflicts using CRDTs
- Emit reactive updates to subscribers

### System Requirements
- **Runtime**: Browser (IndexedDB), Node.js (better-sqlite3), React Native (AsyncStorage adapter)
- **Language**: TypeScript 5+
- **CRDT library**: Automerge 2.x (handles all conflict resolution)
- **Local storage**: idb-keyval (browser), better-sqlite3 (Node), AsyncStorage (RN)
- **WebSocket**: Native WebSocket API (browser + RN), ws (Node)
- **Bundle size target**: < 50kb gzipped

### API Design

#### Initialization
```typescript
import { Synclite } from '@synclite/core'

const db = new Synclite({
  // Required
  relay: 'wss://relay.example.com',

  // Optional
  appId: 'my-app',           // namespaces data, default: 'default'
  userId: 'user-123',        // identifies the user/device
  token: 'jwt-token',        // auth token sent to relay on connect
  offline: true,             // allow fully offline mode (no relay), default: false
  storage: 'indexeddb',      // 'indexeddb' | 'sqlite' | 'memory', default: auto-detect
  syncInterval: 30000,       // background sync interval ms, default: 30000
  debug: false,              // verbose logging, default: false
})
```

#### Core Data Methods
```typescript
// Write — always instant, queued for sync
db.set(key: string, value: object): void

// Read once
db.get(key: string): Promise<object | null>

// Delete
db.delete(key: string): void

// Batch write — atomic locally, synced together
db.batch([
  { op: 'set', key: 'note:1', value: { title: 'A' } },
  { op: 'set', key: 'note:2', value: { title: 'B' } },
  { op: 'delete', key: 'note:3' },
])

// Query — returns all matching keys
db.query(prefix: string): Promise<Record<string, object>>
// Example: db.query('note:') → all keys starting with 'note:'
```

#### Subscriptions (Reactive)
```typescript
// Subscribe to a single key
const unsub = db.subscribe('note:1', (value) => {
  console.log('updated:', value)
})

// Subscribe to a prefix (all matching keys)
const unsub = db.subscribePrefix('note:', (changes) => {
  // changes: { key: string, value: object | null, deleted: boolean }[]
})

// Unsubscribe
unsub()
```

#### Connection & Status
```typescript
// Connection state
db.status // 'connecting' | 'connected' | 'offline' | 'syncing'

// Subscribe to status changes
db.onStatusChange((status) => console.log(status))

// Force sync now
await db.sync()

// Disconnect
db.disconnect()

// Check pending operations
db.pendingOps() // number of unsynced operations
```

#### Events
```typescript
db.on('connected', () => {})
db.on('disconnected', () => {})
db.on('sync:start', () => {})
db.on('sync:complete', ({ ops }) => {})
db.on('sync:error', (err) => {})
db.on('conflict:resolved', ({ key, winner }) => {})
```

### Internal Architecture

#### Operation Log Format
Every write is stored as an operation, not a snapshot:
```typescript
type Operation = {
  id: string           // uuid v4
  type: 'set' | 'delete'
  key: string
  value?: object
  timestamp: number    // logical clock (Lamport timestamp)
  deviceId: string     // unique per device/session
  userId?: string
  synced: boolean      // has this been confirmed by relay
}
```

#### Conflict Resolution Rules
1. Operations are merged using Automerge CRDT — no manual rules needed for most cases
2. For plain key-value overwrites: Last-Write-Wins using Lamport timestamps
3. For rich text / complex objects: Automerge CRDT (field-level merge)
4. Delete always wins over concurrent set (configurable)
5. All merges are deterministic — same input always produces same output

#### Offline Queue Behavior
1. Write happens instantly to local store
2. Operation added to pending queue
3. On connect: flush queue in order, oldest first
4. On relay confirm: mark operation as synced
5. On relay reject: emit error event, keep in queue for retry
6. Queue persists across page reloads (stored in IndexedDB/SQLite)

#### WebSocket Connection Manager
- Connects on instantiation (if relay provided)
- Exponential backoff on disconnect: 1s, 2s, 4s, 8s, 16s, max 30s
- Heartbeat ping every 25s to detect dead connections
- Queues messages during reconnect — none are lost
- Handles browser online/offline events automatically

---

## 5. Package: @synclite/relay

### Responsibilities
- Accept WebSocket connections from clients
- Authenticate connections (verify JWT or custom token)
- Store the operation log (every op ever sent)
- Broadcast new operations to all connected clients in same app
- Replay missed operations to clients that were offline
- Self-hostable as Docker container or Node.js process

### System Requirements
- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **WebSocket**: ws library
- **Database**: SQLite via better-sqlite3 (simple, zero-config, single file)
- **Auth**: JWT verification (jsonwebtoken) OR custom auth hook
- **Port**: 8080 default (configurable)
- **Docker**: Official Dockerfile included

### Environment Variables
```bash
PORT=8080                        # WebSocket server port
DATABASE_PATH=./relay.db         # SQLite database path
JWT_SECRET=your-secret-here      # For JWT auth (optional)
AUTH_WEBHOOK=https://...         # Custom auth endpoint (optional)
MAX_PAYLOAD_SIZE=1mb             # Max message size
LOG_LEVEL=info                   # debug | info | warn | error
CORS_ORIGINS=*                   # Allowed origins
```

### WebSocket Protocol

#### Client → Relay Messages
```typescript
// Authenticate after connect
{ type: 'auth', appId: string, userId?: string, token?: string }

// Send operations
{ type: 'ops', ops: Operation[] }

// Request missed ops since last sync
{ type: 'sync', since: number } // since = last known timestamp
```

#### Relay → Client Messages
```typescript
// Auth confirmed
{ type: 'auth:ok', deviceId: string }

// Auth failed
{ type: 'auth:error', message: string }

// New operations from other clients
{ type: 'ops', ops: Operation[] }

// Sync complete — client is up to date
{ type: 'sync:complete', latest: number }

// Error
{ type: 'error', code: string, message: string }
```

### Database Schema (SQLite)
```sql
-- Operation log — append only, never updated
CREATE TABLE operations (
  id          TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL,
  type        TEXT NOT NULL,       -- 'set' | 'delete'
  key         TEXT NOT NULL,
  value       TEXT,                -- JSON serialized
  timestamp   INTEGER NOT NULL,    -- Lamport clock
  device_id   TEXT NOT NULL,
  user_id     TEXT,
  created_at  INTEGER NOT NULL     -- unix ms
);

CREATE INDEX idx_ops_app_ts ON operations(app_id, timestamp);
CREATE INDEX idx_ops_key ON operations(app_id, key);

-- Connected clients (in-memory, cleared on restart)
CREATE TABLE clients (
  id          TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL,
  user_id     TEXT,
  device_id   TEXT NOT NULL,
  connected_at INTEGER NOT NULL
);
```

### Deployment

#### Docker (recommended)
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install --production
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

```bash
docker run -p 8080:8080 \
  -e JWT_SECRET=mysecret \
  -v ./data:/app/data \
  synclite/relay
```

#### Manual
```bash
npx @synclite/relay start
```

---

## 6. Package: @synclite/react

### Responsibilities
Thin React wrapper over core. Provides hooks that feel native to React developers.

### System Requirements
- React 18+ (uses useSyncExternalStore)
- Peer dependency on @synclite/core

### API
```typescript
import { SyncliteProvider, useSynclite, useValue, useQuery, useStatus } from '@synclite/react'

// Wrap app
function App() {
  return (
    <SyncliteProvider relay="wss://relay.example.com" userId="user-1">
      <MyApp />
    </SyncliteProvider>
  )
}

// Read a single value — updates live
function NoteTitle({ id }) {
  const note = useValue(`note:${id}`)
  return <h1>{note?.title}</h1>
}

// Read all matching keys — updates live
function NoteList() {
  const notes = useQuery('note:')
  return notes.map(note => <Note key={note.key} data={note.value} />)
}

// Write
function NoteEditor({ id }) {
  const db = useSynclite()
  return (
    <input
      onChange={e => db.set(`note:${id}`, { title: e.target.value })}
    />
  )
}

// Connection status
function StatusBar() {
  const status = useStatus() // 'connected' | 'offline' | 'syncing'
  return <span>{status}</span>
}
```

---

## 7. Package: @synclite/react-native

### Same API as @synclite/react but:
- Uses AsyncStorage as local store backend
- Uses React Native's NetInfo for connection detection
- Uses React Native WebSocket (built-in)
- Works on iOS and Android

---

## 8. Package: @synclite/vue

### Same pattern as React adapter but using Vue 3 composables:
```typescript
const note = useValue('note:1')        // Ref<object | null>
const notes = useQuery('note:')        // Ref<Record<string, object>>
const status = useStatus()             // Ref<string>
const { set, delete: del } = useSynclite()
```

---

## 9. Package: @synclite/cli

### Commands
```bash
# Initialize a new project
synclite init

# Start local relay for development
synclite relay dev

# Deploy relay to Fly.io / Railway / Render
synclite relay deploy --platform fly

# Push schema (future feature)
synclite schema push

# View live sync activity
synclite logs --relay wss://my-relay.com

# Check version
synclite --version
```

### System Requirements
- Node.js 18+
- commander.js for CLI parsing
- inquirer.js for interactive prompts
- chalk for colored output
- ora for spinners

---

## 10. App: Dashboard (Next.js)

### Purpose
A web UI developers open to inspect their app's data, debug sync issues, and monitor connected clients. Like a lite Supabase table editor, but for sync data.

### System Requirements
- Next.js 14+ (App Router)
- Tailwind CSS
- Connects to a relay server via WebSocket
- Auth: same token as the relay uses

### Pages & Features

#### / — Overview
- Connected clients count
- Operations per minute graph
- Total operations in log
- Storage used

#### /data — Data Explorer
- Table view of all key-value pairs in the app
- Filter by key prefix
- Click any row to see full value as JSON
- Edit values directly (writes through relay)
- Delete keys

#### /sync — Sync Activity
- Live feed of operations as they happen
- Filter by user, device, key
- See conflict resolutions in real time
- Replay operations from a specific timestamp

#### /clients — Connected Clients
- List of currently connected devices
- userId, deviceId, connected since
- Pending ops per client
- Kick a client (force disconnect)

#### /settings — Configuration
- Relay URL
- Auth token
- App ID

---

## 11. App: Documentation Site

### Stack
- Nextra (Next.js-based docs framework)
- Deployed to Vercel

### Structure
```
docs/
├── Getting Started
│   ├── Introduction
│   ├── Quick Start (5 minutes)
│   ├── How It Works
│   └── Core Concepts
├── Guides
│   ├── React
│   ├── Vue
│   ├── React Native
│   ├── Vanilla JS
│   ├── Offline-First Patterns
│   └── Self-hosting the Relay
├── API Reference
│   ├── Synclite (core)
│   ├── React Hooks
│   ├── Vue Composables
│   └── Relay Config
├── Examples
│   ├── Notes App
│   ├── Todo App (collaborative)
│   ├── Field Worker App
│   └── Chat App
└── Changelog
```

### Quick Start Must Work In Under 5 Minutes
This is non-negotiable. The getting started guide must:
1. Install in one command
2. Show working local example with no relay needed
3. Add relay in one line
4. Show two-device sync with copy-pasteable code

---

## 12. App: Demo App

### Purpose
A publicly accessible demo at demo.synclite.dev that shows the engine working in real time. The most powerful marketing asset.

### What It Shows
A simple collaborative notes app where:
- Two browser windows are open side by side
- User types in one window
- Text appears in real time in the other window
- One window goes offline
- Changes are made in both windows
- Window comes back online
- Both changes merge correctly, nothing is lost

### Stack
- Next.js + @synclite/react
- Deployed to Vercel
- Uses a public relay (hosted by the project)
- No login required — uses random session IDs

---

## 13. Testing Strategy

### Unit Tests (Vitest)
Every function in core must have unit tests:
- CRDT merge logic (all conflict scenarios)
- Operation log queue behavior
- Offline detection and reconnection
- Serialization / deserialization

### Integration Tests
- Core + relay talking to each other
- Two clients sync correctly
- Client goes offline, makes changes, comes back online
- Three clients edit same key simultaneously

### End-to-End Tests (Playwright)
- Demo app: offline scenario works
- Demo app: two windows stay in sync
- Dashboard: data appears after write

### Test Coverage Target: 80%+

---

## 14. Performance Requirements

| Metric | Target |
|---|---|
| Write latency (local) | < 5ms |
| Sync latency (online, same region) | < 100ms |
| Reconnect time | < 2s |
| Bundle size (@synclite/core) | < 50kb gzipped |
| Relay: concurrent connections | 1,000+ per instance |
| Relay: operations per second | 10,000+ |
| Local storage limit | 50MB default (configurable) |

---

## 15. Security

### Authentication
- Relay accepts a token on WebSocket connect
- Token can be a JWT (relay verifies with JWT_SECRET)
- Or relay calls an auth webhook (any backend can verify)
- Unauthenticated connections are rejected immediately

### Data Isolation
- All data is namespaced by appId
- Clients can only read/write their own appId's data
- No cross-app data leakage

### Transport
- All relay connections must use wss:// (TLS) in production
- Relay rejects ws:// connections in production mode

### Rate Limiting
- Max 100 operations per second per client
- Max payload size: 1MB per message (configurable)
- Max 10,000 operations per sync request

---

## 16. Open Source Configuration

### License
MIT — most permissive, maximum adoption

### Repository Structure
```
synclite/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml          # Run tests on every PR
│   │   ├── release.yml     # Publish to npm on tag
│   │   └── docs.yml        # Deploy docs on merge to main
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
├── LICENSE
└── README.md
```

### README Must Include
1. One-line description
2. Animated GIF showing sync in action
3. Quick install + usage (< 10 lines of code)
4. Feature list
5. Comparison table vs Firebase / Supabase / building yourself
6. Links to docs, demo, Discord
7. GitHub stars badge, npm version badge, license badge

---

## 17. Build & Release

### Build
```bash
pnpm install          # install all deps
pnpm build            # build all packages
pnpm test             # run all tests
pnpm lint             # lint all packages
```

### Release (automated via GitHub Actions)
1. Developer creates git tag: `v0.1.0`
2. CI runs all tests
3. If tests pass: publishes all packages to npm
4. Creates GitHub Release with changelog
5. Deploys docs to Vercel
6. Deploys demo app to Vercel

### Versioning
- Semantic versioning (semver)
- All packages share the same version number
- CHANGELOG.md updated on every release

---

## 18. Phase Roadmap

### Phase 1 — Core (Build First)
- [ ] @synclite/core — local store, CRDT, queue, WebSocket manager
- [ ] @synclite/relay — WebSocket server, SQLite op log, broadcaster
- [ ] Basic README

### Phase 2 — Developer Experience
- [ ] @synclite/react — hooks
- [ ] Demo app — collaborative notes
- [ ] Quick Start docs

### Phase 3 — Ecosystem
- [ ] @synclite/vue
- [ ] @synclite/react-native
- [ ] @synclite/cli
- [ ] Full documentation site

### Phase 4 — Production Hardening
- [ ] Dashboard app
- [ ] Auth webhook support
- [ ] Rate limiting
- [ ] Performance benchmarks
- [ ] End-to-end tests

### Phase 5 — Growth
- [ ] Schema validation
- [ ] Migration system (schema versioning across offline clients)
- [ ] Encryption at rest
- [ ] Multi-relay (federation)
- [ ] Edge relay (Cloudflare Workers compatible)

---

## 19. Git Workflow & Version Control

Every major task must be committed to Git immediately after completion. This keeps a clean history, makes it easy to roll back, and documents progress for open source contributors.

### Initial Setup (run once)
```bash
git init
git remote add origin https://github.com/yourusername/synclite.git
```

### Commit After Every Major Task
Claude Code must run a git commit after completing each item in the phase roadmap. No exceptions.

### Commit Message Format
Use conventional commits — this is the standard for open source projects and enables automatic changelog generation later.

```
<type>(<scope>): <short description>

[optional body]
```

**Types:**
- `feat` — new feature or capability
- `fix` — bug fix
- `chore` — setup, config, tooling
- `docs` — documentation only
- `test` — adding or updating tests
- `refactor` — code change that isn't a fix or feature

**Examples:**
```bash
git commit -m "chore: initialize monorepo with pnpm workspaces and turborepo"
git commit -m "feat(core): add local store with IndexedDB backend"
git commit -m "feat(core): add CRDT merge layer using Automerge"
git commit -m "feat(core): add offline operation queue with persistence"
git commit -m "feat(core): add WebSocket manager with reconnection and backoff"
git commit -m "feat(relay): add WebSocket server with SQLite operation log"
git commit -m "feat(relay): add operation broadcaster to connected clients"
git commit -m "feat(relay): add missed ops replay for reconnecting clients"
git commit -m "test(core): add CRDT conflict resolution tests"
git commit -m "test(relay): add integration tests for two-client sync"
git commit -m "feat(react): add useValue, useQuery, useStatus hooks"
git commit -m "feat(demo): add collaborative notes demo app"
git commit -m "docs: add quick start guide and API reference"
```

### Commit Checklist (before each commit)
Claude Code must verify before committing:
- [ ] Code builds without errors (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] No TypeScript errors (`pnpm typecheck`)
- [ ] Commit message follows conventional commits format

### Tag Every Phase Completion
When a full phase is complete, create a version tag:
```bash
git tag -a v0.1.0 -m "Phase 1 complete: core library and relay server"
git tag -a v0.2.0 -m "Phase 2 complete: React adapter and demo app"
git tag -a v0.3.0 -m "Phase 3 complete: Vue, React Native, CLI, docs"
git tag -a v0.4.0 -m "Phase 4 complete: dashboard, auth, rate limiting"
git tag -a v1.0.0 -m "Phase 5 complete: production ready"
```

### Branch Strategy
```
main          ← stable, always working, tagged releases
dev           ← active development, Claude Code works here
feature/*     ← individual features (optional for solo work)
```

Claude Code works on `dev` branch. Only merge to `main` when a phase is fully complete and all tests pass.

```bash
# Start working
git checkout -b dev

# After phase complete, merge to main
git checkout main
git merge dev --no-ff -m "chore: merge phase 1 complete"
git push origin main
git push origin --tags
```

---

## 20. Instructions For Claude Code

When building this project, follow these rules:

1. **Start with Phase 1 only.** Build core and relay first. Nothing else matters until those work.

2. **Developer experience is the top priority.** Every API decision should be made by asking "is this the simplest possible way to express this?"

3. **TypeScript strict mode everywhere.** No `any` types. Full type safety across all packages.

4. **Every public method needs a JSDoc comment.** Developers should get inline documentation in their IDE without opening the docs site.

5. **Error messages must be helpful.** Instead of `Error: connection failed`, say `Synclite: Could not connect to relay at wss://example.com. Check that your relay is running and the URL is correct.`

6. **The relay must be stateless-friendly.** Clients should be able to reconnect to any relay instance. Don't store session state in memory that can't be recovered from the SQLite database.

7. **Never block the main thread.** All storage operations are async. CRDT merges happen in a Web Worker if possible.

8. **Test every conflict scenario.** The CRDT merge logic must have tests for: same key edited on two devices offline, delete vs edit conflict, three-way concurrent edit, and coming back online after extended offline period.

9. **The demo app is a marketing asset.** It must look good, load fast, and work reliably. It is the first thing potential users will see.

10. **Write the README last.** Once the code works, write the README against the actual working API — not the planned API.

11. **Commit after every major task.** Follow the Git workflow in Section 19 exactly. Every item completed in the phase roadmap gets its own commit with a conventional commit message. Run build and tests before every commit.
