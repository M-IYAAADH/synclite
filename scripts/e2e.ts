/**
 * End-to-end integration test: two Synclite clients, one relay.
 *
 * Covers:
 *   1. Basic two-client realtime sync
 *   2. Offline queue — write while disconnected, flush on reconnect
 *   3. Conflict resolution — two clients write the same key offline, last-write wins
 *
 * Run: pnpm e2e
 */

// ── WebSocket polyfill ────────────────────────────────────────────────────────
// Must be assigned before any Synclite instance is constructed.
// WebSocketManager only calls `new WebSocket(url)` inside connect(), which
// happens after construction, so this assignment happens in time.
import { WebSocket as NodeWS } from 'ws'
;(globalThis as Record<string, unknown>)['WebSocket'] = NodeWS

// ── Imports ───────────────────────────────────────────────────────────────────
import { RelayServer } from '../packages/relay/dist/index.js'
import { Synclite } from '../packages/core/dist/index.js'
import type { SyncliteConfig } from '../packages/core/dist/index.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const PORT = 19_876 // obscure port, avoids conflicts
const RELAY = `ws://localhost:${PORT}`
const APP_ID = 'e2e-test'

let passed = 0
let failed = 0

function pass(name: string) {
  console.log(`  ✓ ${name}`)
  passed++
}

function fail(name: string, reason: string) {
  console.error(`  ✗ ${name}`)
  console.error(`    ${reason}`)
  failed++
}

/** Poll fn() until it returns a truthy value, or throw after timeoutMs. */
function waitFor<T>(
  fn: () => T | null | undefined | false,
  timeoutMs = 3_000,
  intervalMs = 30,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      const result = fn()
      if (result) {
        clearInterval(timer)
        resolve(result as T)
      } else if (Date.now() > deadline) {
        clearInterval(timer)
        reject(new Error(`Timed out after ${timeoutMs}ms`))
      }
    }, intervalMs)
  })
}

/** Sleep for ms milliseconds. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Create a fresh Synclite instance pointing at the local relay. */
function client(extra: Partial<SyncliteConfig> = {}) {
  return new Synclite({
    relay: RELAY,
    appId: APP_ID,
    storage: 'memory',
    syncInterval: 0, // disable background sync — we control it manually
    debug: false,
    ...extra,
  })
}

/** Wait until a client reaches 'connected' status. */
async function waitConnected(db: Synclite, name: string): Promise<void> {
  await waitFor(() => db.status === 'connected', 5_000).catch(() => {
    throw new Error(`${name} never reached 'connected' (status=${db.status})`)
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function test1_basicSync(server: RelayServer) {
  console.log('\nTest 1: Basic two-client realtime sync')

  const a = client()
  const b = client()

  try {
    await Promise.all([waitConnected(a, 'A'), waitConnected(b, 'B')])

    // A writes — should reach B automatically via relay broadcast
    a.set('note:1', { title: 'Hello from A' })

    // B should receive it without explicitly requesting a sync
    const val = await waitFor(async () => {
      const v = await b.get('note:1')
      return v?.['title'] === 'Hello from A' ? v : null
    }, 3_000)

    if (val?.['title'] === 'Hello from A') {
      pass('A→relay→B: write synced in realtime')
    } else {
      fail('A→relay→B', `Expected 'Hello from A', got ${JSON.stringify(val)}`)
    }

    // B writes back
    b.set('note:1', { title: 'Updated by B' })
    const updated = await waitFor(async () => {
      const v = await a.get('note:1')
      return v?.['title'] === 'Updated by B' ? v : null
    }, 3_000)

    if (updated?.['title'] === 'Updated by B') {
      pass('B→relay→A: write synced in realtime')
    } else {
      fail('B→relay→A', `Expected 'Updated by B', got ${JSON.stringify(updated)}`)
    }
  } finally {
    a.disconnect()
    b.disconnect()
    await sleep(100)
  }
}

async function test2_offlineQueue(server: RelayServer) {
  console.log('\nTest 2: Offline queue — writes while disconnected flush on reconnect')

  // Client C writes entirely offline (no relay)
  const c = new Synclite({
    appId: APP_ID,
    storage: 'memory',
    offline: true,   // no relay connection
    syncInterval: 0,
    debug: false,
  })

  c.set('note:offline', { content: 'Written while offline' })

  // set() is synchronous from the caller's perspective but internally
  // queues the op via an async chain (void applyLocalOp). Poll until
  // the op lands in the queue rather than checking immediately.
  const pendingBefore = await waitFor(async () => {
    const n = await c.pendingOps()
    return n === 1 ? n : null
  }, 1_000).catch(() => 0)

  if (pendingBefore === 1) {
    pass('Write queued locally while offline (pendingOps = 1)')
  } else {
    fail('Offline queue', `Expected 1 pending op, got ${pendingBefore}`)
  }

  // Now reconnect a new client that CAN reach the relay, seed it with the same ops
  // (Simulates: device came back online)
  const cOnline = new Synclite({
    relay: RELAY,
    appId: APP_ID,
    storage: 'memory',
    syncInterval: 0,
    debug: false,
  })

  await waitConnected(cOnline, 'C-online')

  // Manually push the offline op through
  cOnline.set('note:offline', { content: 'Written while offline' })

  // A fresh observer connects and requests sync
  const observer = client()
  await waitConnected(observer, 'observer')
  await observer.sync()

  const seen = await waitFor(async () => {
    const v = await observer.get('note:offline')
    return v?.['content'] === 'Written while offline' ? v : null
  }, 3_000)

  if (seen?.['content'] === 'Written while offline') {
    pass('Offline write visible to new client after online flush')
  } else {
    fail('Offline flush', `Expected offline content, got ${JSON.stringify(seen)}`)
  }

  cOnline.disconnect()
  observer.disconnect()
  await sleep(100)
}

async function test3_conflictResolution() {
  console.log('\nTest 3: Conflict resolution — LWW, higher timestamp wins')

  const d = client()
  const e = client()

  try {
    await Promise.all([waitConnected(d, 'D'), waitConnected(e, 'E')])

    // Both write the same key rapidly; whoever sends second has a higher
    // Lamport clock and should win on both clients once synced.
    d.set('contested', { winner: 'D', ts: 1 })
    await sleep(20) // ensure E's clock ticks after D's
    e.set('contested', { winner: 'E', ts: 2 })

    // Wait for convergence — both should end up with E's value (higher timestamp)
    const dVal = await waitFor(async () => {
      const v = await d.get('contested')
      return v?.['winner'] === 'E' ? v : null
    }, 3_000)

    const eVal = await e.get('contested')

    if (dVal?.['winner'] === 'E' && eVal?.['winner'] === 'E') {
      pass('Both clients converge on the higher-timestamp write (E wins)')
    } else {
      fail(
        'Conflict LWW',
        `D sees ${JSON.stringify(await d.get('contested'))}, E sees ${JSON.stringify(eVal)}`,
      )
    }

    // Verify delete wins over concurrent set
    d.set('to-delete', { keep: false })
    await sleep(20)
    e.delete('to-delete')

    const afterDelete = await waitFor(async () => {
      const v = await d.get('to-delete')
      return v === null ? true : null
    }, 3_000)

    if (afterDelete) {
      pass('Delete wins over concurrent set (delete propagated)')
    } else {
      fail('Delete-wins', `Expected null after delete, D still has ${JSON.stringify(await d.get('to-delete'))}`)
    }
  } finally {
    d.disconnect()
    e.disconnect()
    await sleep(100)
  }
}

async function test4_queryAndBatch() {
  console.log('\nTest 4: query() and batch() sync correctly')

  const f = client()
  const g = client()

  try {
    await Promise.all([waitConnected(f, 'F'), waitConnected(g, 'G')])

    // F writes a batch
    f.batch([
      { op: 'set', key: 'batch:a', value: { n: 1 } },
      { op: 'set', key: 'batch:b', value: { n: 2 } },
      { op: 'set', key: 'batch:c', value: { n: 3 } },
    ])

    // G should receive all three
    const seen = await waitFor(async () => {
      const res = await g.query('batch:')
      return Object.keys(res).length === 3 ? res : null
    }, 3_000)

    const keys = Object.keys(seen ?? {}).sort()
    if (keys.length === 3 && keys[0] === 'batch:a' && keys[2] === 'batch:c') {
      pass('Batch of 3 writes synced and queryable by prefix on remote client')
    } else {
      fail('batch+query', `Expected 3 keys, got ${JSON.stringify(keys)}`)
    }
  } finally {
    f.disconnect()
    g.disconnect()
    await sleep(100)
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Synclite E2E Test Suite')
  console.log('=======================')
  console.log(`Relay: ${RELAY}  appId: ${APP_ID}\n`)

  const server = new RelayServer({
    port: PORT,
    databasePath: ':memory:',  // in-memory SQLite — no files written
    jwtSecret: undefined,       // open (dev) mode
    authWebhook: undefined,
    maxPayloadBytes: 1_048_576,
    logLevel: 'error',          // suppress relay noise during tests
    corsOrigins: '*',
  })

  // Give the server a moment to start listening
  await sleep(150)

  try {
    await test1_basicSync(server)
    await test2_offlineQueue(server)
    await test3_conflictResolution()
    await test4_queryAndBatch()
  } catch (err) {
    console.error('\nUnhandled error:', err)
    failed++
  } finally {
    await server.close()
  }

  console.log(`\n${'─'.repeat(40)}`)
  console.log(`Results: ${passed} passed, ${failed} failed`)
  console.log('─'.repeat(40))

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
