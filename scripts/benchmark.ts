/**
 * NexSync performance benchmarks.
 *
 * Measures:
 * 1. Local write latency (1000 db.set() calls, MemoryStore)
 * 2. Subscribe notification latency (time from set() to callback firing)
 * 3. query() performance (1000 keys, then query by prefix)
 * 4. batch() performance (100 items per batch, 100 batches)
 */

import { NexSync, MemoryStore } from '../packages/core/dist/index.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function timer(): () => number {
  const start = performance.now()
  return () => performance.now() - start
}

function stats(samples: number[]): {
  mean: number
  p50: number
  p95: number
  p99: number
  min: number
  max: number
} {
  const sorted = [...samples].sort((a, b) => a - b)
  const n = sorted.length
  const mean = samples.reduce((a, b) => a + b, 0) / n
  const p50 = sorted[Math.floor(n * 0.5)] ?? 0
  const p95 = sorted[Math.floor(n * 0.95)] ?? 0
  const p99 = sorted[Math.floor(n * 0.99)] ?? 0
  const min = sorted[0] ?? 0
  const max = sorted[n - 1] ?? 0
  return { mean, p50, p95, p99, min, max }
}

function fmt(n: number): string {
  return n.toFixed(3).padStart(10)
}

function printTable(
  title: string,
  s: { mean: number; p50: number; p95: number; p99: number; min: number; max: number },
): void {
  console.log(`\n  ${title}`)
  console.log('  ' + '─'.repeat(62))
  console.log(`  ${'metric'.padEnd(10)} ${'mean'.padStart(10)} ${'p50'.padStart(10)} ${'p95'.padStart(10)} ${'p99'.padStart(10)} ${'min'.padStart(10)}`)
  console.log('  ' + '─'.repeat(62))
  console.log(`  ${'ms'.padEnd(10)} ${fmt(s.mean)} ${fmt(s.p50)} ${fmt(s.p95)} ${fmt(s.p99)} ${fmt(s.min)}`)
  console.log('  ' + '─'.repeat(62))
}

// ─── Benchmark 1: Local write latency ───────────────────────────────────────

async function benchWriteLatency(): Promise<void> {
  const store = new MemoryStore()
  const db = new NexSync({ appId: 'bench', storage: 'memory', storeInstance: store })

  const samples: number[] = []
  const N = 1000

  for (let i = 0; i < N; i++) {
    const stop = timer()
    db.set(`key:${i}`, { index: i, data: 'benchmark value' })
    samples.push(stop())
  }

  // allow microtasks to flush
  await new Promise((r) => setTimeout(r, 100))

  printTable('1. Local write latency (1000 x db.set(), MemoryStore)', stats(samples))
}

// ─── Benchmark 2: Subscribe notification latency ────────────────────────────

async function benchSubscribeLatency(): Promise<void> {
  const db = new NexSync({ appId: 'bench-sub', storage: 'memory' })

  const samples: number[] = []
  const N = 100

  for (let i = 0; i < N; i++) {
    await new Promise<void>((resolve) => {
      let fired = false
      const key = `sub-key:${i}`
      const stop = timer()

      const unsub = db.subscribe(key, () => {
        if (!fired) {
          fired = true
          samples.push(stop())
          unsub()
          resolve()
        }
      })

      db.set(key, { v: i })
    })
  }

  printTable('2. Subscribe notification latency (100 samples)', stats(samples))
}

// ─── Benchmark 3: query() performance ───────────────────────────────────────

async function benchQueryPerformance(): Promise<void> {
  const db = new NexSync({ appId: 'bench-query', storage: 'memory' })

  // Populate 1000 keys
  for (let i = 0; i < 1000; i++) {
    db.set(`note:${i}`, { content: `note content ${i}` })
  }
  for (let i = 0; i < 100; i++) {
    db.set(`task:${i}`, { done: false, title: `task ${i}` })
  }

  await new Promise((r) => setTimeout(r, 200))

  const samples: number[] = []
  const N = 200

  for (let i = 0; i < N; i++) {
    const stop = timer()
    await db.query('note:')
    samples.push(stop())
  }

  printTable('3. query() performance (1000 keys, query by prefix, 200 runs)', stats(samples))
}

// ─── Benchmark 4: batch() performance ───────────────────────────────────────

async function benchBatchPerformance(): Promise<void> {
  const db = new NexSync({ appId: 'bench-batch', storage: 'memory' })

  const samples: number[] = []
  const BATCHES = 100
  const ITEMS_PER_BATCH = 100

  for (let b = 0; b < BATCHES; b++) {
    const items = Array.from({ length: ITEMS_PER_BATCH }, (_, i) => ({
      op: 'set' as const,
      key: `batch-key:${b}:${i}`,
      value: { batch: b, index: i },
    }))

    const stop = timer()
    db.batch(items)
    samples.push(stop())
  }

  await new Promise((r) => setTimeout(r, 500))

  printTable('4. batch() performance (100 batches x 100 items)', stats(samples))
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n  NexSync Performance Benchmarks')
  console.log('  ================================')

  await benchWriteLatency()
  await benchSubscribeLatency()
  await benchQueryPerformance()
  await benchBatchPerformance()

  console.log('\n  \u2713 All benchmarks complete\n')
}

void main()
