import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RelayServer } from '@nexsync/relay'
import { WebSocket } from 'ws'

function connectAndAuth(port, appId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('auth timeout')) }, 5000)
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', appId })))
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString())
      if (msg.type === 'auth:ok') { clearTimeout(timer); resolve(ws) }
      else if (msg.type === 'auth:error') { clearTimeout(timer); ws.close(); reject(new Error('auth:error')) }
    })
    ws.on('error', (e) => { clearTimeout(timer); reject(e) })
  })
}

function waitForOps(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', handler); reject(new Error(`no ops within ${timeoutMs}ms`)) }, timeoutMs)
    function handler(d) {
      const msg = JSON.parse(d.toString())
      if (msg.type === 'ops') { clearTimeout(timer); ws.off('message', handler); resolve(msg.ops) }
    }
    ws.on('message', handler)
  })
}

test('two-client bidirectional sync', { timeout: 10000 }, async (t) => {
  const relay = new RelayServer({
    port: 0,
    databasePath: ':memory:',
    jwtSecret: undefined,
    authWebhook: undefined,
    maxPayloadBytes: 1_048_576,
    logLevel: 'error',
    corsOrigins: '*',
    maxOpsPerSecond: 1000,
  })

  const port = await relay.ready()

  t.after(async () => {
    wsA.close()
    wsB.close()
    await relay.close()
  })

  const [wsA, wsB] = await Promise.all([
    connectAndAuth(port, 'e2e-test'),
    connectAndAuth(port, 'e2e-test'),
  ])

  // A sends op → B receives it
  const opsForB = waitForOps(wsB)
  wsA.send(JSON.stringify({
    type: 'ops',
    ops: [{ id: 'e2e-1', type: 'set', key: 'test:sync', value: { data: 'from-a' }, timestamp: 1, deviceId: 'device-a', synced: false }],
  }))
  const bOps = await opsForB
  assert.equal(bOps.length, 1, 'B should receive 1 op')
  assert.equal(bOps[0].id, 'e2e-1')
  assert.deepEqual(bOps[0].value, { data: 'from-a' })

  // B sends op → A receives it
  const opsForA = waitForOps(wsA)
  wsB.send(JSON.stringify({
    type: 'ops',
    ops: [{ id: 'e2e-2', type: 'set', key: 'test:sync', value: { data: 'from-b' }, timestamp: 2, deviceId: 'device-b', synced: false }],
  }))
  const aOps = await opsForA
  assert.equal(aOps.length, 1, 'A should receive 1 op')
  assert.equal(aOps[0].id, 'e2e-2')
  assert.deepEqual(aOps[0].value, { data: 'from-b' })
})
