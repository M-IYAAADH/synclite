#!/usr/bin/env node
/**
 * Minimal CLI entry point: `npx @nexsync/relay start`
 * Full CLI lives in @nexsync/cli (Phase 3). This is just the relay bootstrap.
 */
import { RelayServer } from './server.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const server = new RelayServer(config)

function shutdown(): void {
  console.info('[relay] shutting down...')
  void server.close().then(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
