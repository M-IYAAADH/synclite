import type { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'

/**
 * Register the `nexsync relay` subcommand group.
 */
export function registerRelayCommand(program: Command): void {
  const relay = program
    .command('relay')
    .description('Manage the NexSync relay server')

  relay
    .command('dev')
    .description('Start a local relay server for development')
    .option('-p, --port <number>', 'Port to listen on', '8080')
    .option('-d, --db <path>', 'SQLite database path', './relay.db')
    .option('--debug', 'Enable verbose logging', false)
    .action(async (opts: { port: string; db: string; debug: boolean }) => {
      const port = parseInt(opts.port, 10)
      const spinner = ora(`Starting relay on port ${port}…`).start()

      try {
        // Dynamic import so better-sqlite3 only loads when needed
        const { RelayServer } = await import('@nexsync/relay')
        new RelayServer({
          port,
          databasePath: opts.db,
          jwtSecret: undefined,
          authWebhook: undefined,
          maxPayloadBytes: 1_048_576, // 1 MB
          logLevel: opts.debug ? 'debug' : 'info',
          corsOrigins: '*',
          maxOpsPerSecond: 100,
        })
        spinner.succeed(
          chalk.green(`Relay running`) +
            chalk.gray(` → ws://localhost:${port}`),
        )
        console.log(chalk.dim('  Press Ctrl+C to stop.\n'))
      } catch (err) {
        spinner.fail(chalk.red('Failed to start relay'))
        if (err instanceof Error) console.error(chalk.red(err.message))
        process.exit(1)
      }
    })

  relay
    .command('deploy')
    .description('Print deploy instructions for a cloud platform')
    .option('--platform <name>', 'Target platform: fly | railway | render', 'fly')
    .action((opts: { platform: string }) => {
      console.log()
      switch (opts.platform) {
        case 'fly':
          printDeployInstructions('Fly.io', [
            'fly launch --name my-nexsync-relay',
            'fly secrets set JWT_SECRET=$(openssl rand -hex 32)',
            'fly volumes create relay_data --size 1',
            'fly deploy',
          ])
          break
        case 'railway':
          printDeployInstructions('Railway', [
            'railway login',
            'railway init',
            'railway variables set JWT_SECRET=$(openssl rand -hex 32)',
            'railway up',
          ])
          break
        case 'render':
          printDeployInstructions('Render', [
            '# 1. Create a new Web Service in the Render dashboard',
            '# 2. Set the start command to: npx @nexsync/relay',
            '# 3. Add env var: JWT_SECRET=<your-secret>',
            '# 4. Add a Persistent Disk at /app/data (1 GB)',
          ])
          break
        default:
          console.error(chalk.red(`Unknown platform: ${opts.platform}`))
          console.log(chalk.dim('Supported: fly, railway, render'))
          process.exit(1)
      }
    })
}

function printDeployInstructions(platform: string, steps: string[]): void {
  console.log(chalk.bold(`Deploy relay to ${platform}:\n`))
  for (const step of steps) {
    if (step.startsWith('#')) {
      console.log(chalk.dim(step))
    } else {
      console.log('  ' + chalk.cyan(step))
    }
  }
  console.log()
}
