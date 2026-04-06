import type { RelayConfig } from './types.js'

function parseBytes(s: string): number {
  const m = /^(\d+)(mb?|kb?)?$/i.exec(s.trim())
  if (!m) return 1_048_576 // default 1MB
  const n = parseInt(m[1] ?? '1', 10)
  const unit = (m[2] ?? '').toLowerCase()
  if (unit.startsWith('k')) return n * 1024
  if (unit.startsWith('m')) return n * 1024 * 1024
  return n
}

/**
 * Load relay configuration from environment variables.
 * All variables have sensible defaults so the relay runs out of the box.
 */
export function loadConfig(): RelayConfig {
  return {
    port: parseInt(process.env['PORT'] ?? '9090', 10),
    databasePath: process.env['DATABASE_PATH'] ?? './relay.db',
    jwtSecret: process.env['JWT_SECRET'],
    authWebhook: process.env['AUTH_WEBHOOK'],
    maxPayloadBytes: parseBytes(process.env['MAX_PAYLOAD_SIZE'] ?? '1mb'),
    logLevel: (process.env['LOG_LEVEL'] ?? 'info') as RelayConfig['logLevel'],
    corsOrigins: process.env['CORS_ORIGINS'] ?? '*',
    maxOpsPerSecond: parseInt(process.env['MAX_OPS_PER_SECOND'] ?? '100', 10),
  }
}
