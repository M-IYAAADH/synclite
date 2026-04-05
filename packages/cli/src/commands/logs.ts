import type { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'

/**
 * Register the `nexsync logs` command.
 * Connects to a relay via WebSocket and streams live operation events.
 */
export function registerLogsCommand(program: Command): void {
  program
    .command('logs')
    .description('Stream live sync activity from a relay')
    .requiredOption('--relay <url>', 'Relay WebSocket URL (e.g. ws://localhost:8080)')
    .option('--app <id>', 'Filter by app ID', 'default')
    .option('--token <token>', 'Auth token')
    .action(async (opts: { relay: string; app: string; token?: string }) => {
      const spinner = ora(`Connecting to ${opts.relay}…`).start()

      const { WebSocket } = await import('ws')
      const ws = new WebSocket(opts.relay)

      ws.on('open', () => {
        spinner.succeed(chalk.green('Connected') + chalk.gray(` → ${opts.relay}`))
        console.log(chalk.dim(`Streaming ops for app "${opts.app}". Press Ctrl+C to stop.\n`))

        const authMsg: Record<string, unknown> = { type: 'auth', appId: opts.app }
        if (opts.token !== undefined) authMsg['token'] = opts.token
        ws.send(JSON.stringify(authMsg))
      })

      ws.on('message', (data: Buffer | string) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(data.toString()) as Record<string, unknown>
        } catch {
          return
        }

        const type = String(msg['type'] ?? '')
        const ts = new Date().toISOString().slice(11, 23)

        switch (type) {
          case 'auth:ok':
            console.log(chalk.dim(`[${ts}]`) + chalk.green(' auth:ok'))
            break
          case 'ops': {
            const ops = Array.isArray(msg['ops']) ? msg['ops'] : []
            for (const op of ops) {
              const o = op as Record<string, unknown>
              const opType = String(o['type'] ?? 'set')
              const key = String(o['key'] ?? '')
              const color = opType === 'delete' ? chalk.red : chalk.cyan
              console.log(
                chalk.dim(`[${ts}]`) +
                  ' ' +
                  color(opType.padEnd(6)) +
                  ' ' +
                  chalk.white(key) +
                  (o['userId'] !== undefined ? chalk.dim(` (${String(o['userId'])})`) : ''),
              )
            }
            break
          }
          case 'sync:complete':
            console.log(chalk.dim(`[${ts}] sync:complete latest=${String(msg['latest'] ?? 0)}`))
            break
          default:
            break
        }
      })

      ws.on('error', (err: Error) => {
        spinner.fail(chalk.red(`Connection error: ${err.message}`))
        process.exit(1)
      })

      ws.on('close', () => {
        console.log(chalk.dim('\nDisconnected.'))
        process.exit(0)
      })

      process.on('SIGINT', () => {
        ws.close()
        process.exit(0)
      })
    })
}
