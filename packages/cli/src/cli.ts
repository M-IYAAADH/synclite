import { Command } from 'commander'
import { createRequire } from 'module'
import { registerInitCommand } from './commands/init.js'
import { registerRelayCommand } from './commands/relay.js'
import { registerLogsCommand } from './commands/logs.js'

// Read version from package.json without importing JSON (NodeNext compat)
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pkg = require('../package.json')
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
const version = String(pkg.version ?? '0.0.0')

const program = new Command()

program
  .name('nexsync')
  .description('NexSync CLI — offline-first sync for any app')
  .version(version, '-v, --version', 'Print version number')

registerInitCommand(program)
registerRelayCommand(program)
registerLogsCommand(program)

program.parse(process.argv)
