import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import chalk from 'chalk'
import { Command, CommanderError } from 'commander'
import updateNotifier from 'update-notifier'
import { registerAdoptCommand } from '../src/commands/adopt'
import { registerAgentsCommand } from '../src/commands/agents'
import { registerAuditCommand } from '../src/commands/audit'
import { registerBackupCommand } from '../src/commands/backup'
import { registerCiCommand } from '../src/commands/ci'
import { registerCompletionCommand } from '../src/commands/completion'
import { registerConfigCommand } from '../src/commands/config'
import { registerDeprecateCommand } from '../src/commands/deprecate'
import { registerDiffCommand } from '../src/commands/diff'
import { registerDoctorCommand } from '../src/commands/doctor'
import { registerDraftCommand } from '../src/commands/draft'
import { registerInfoCommand } from '../src/commands/info'
import { registerInitCommand } from '../src/commands/init'
import { registerInstallCommand } from '../src/commands/install'
import { registerListCommand } from '../src/commands/list'
import { registerLogCommand } from '../src/commands/log'
import { registerLoginCommand } from '../src/commands/login'
import { registerLogoutCommand } from '../src/commands/logout'
import { registerMigrateCommand } from '../src/commands/migrate'
import { registerPinCommand, registerUnpinCommand } from '../src/commands/pin'
import { registerPromoteCommand } from '../src/commands/promote'
import { registerPublishCommand } from '../src/commands/publish'
import { registerRemoveCommand } from '../src/commands/remove'
import { registerSaveCommand } from '../src/commands/save'
import { registerScanCommand } from '../src/commands/scan'
import { registerSearchCommand } from '../src/commands/search'
import { registerStatusCommand } from '../src/commands/status'
import { registerSuggestCommand } from '../src/commands/suggest'
import { registerSuggestionsCommand } from '../src/commands/suggestions'
import { registerSyncCommand } from '../src/commands/sync'
import { registerUnpublishCommand } from '../src/commands/unpublish'
import { registerUpdateCommand } from '../src/commands/update'
import { registerUpgradeCommand } from '../src/commands/upgrade'
import { registerValidateCommand } from '../src/commands/validate'
import { registerVerifyCommand } from '../src/commands/verify'
import { registerVersionCommand } from '../src/commands/version'
import { registerWhoamiCommand } from '../src/commands/whoami'
import { isJSONMode, outputError } from '../src/output'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const pkg = require(join(__dirname, '..', 'package.json')) as { name: string; version: string }
updateNotifier({ pkg }).notify({
  message: `Update available: {currentVersion} → {latestVersion}\nRun ${chalk.cyan('agentver upgrade')} to update`,
})

const program = new Command()

program
  .name('agentver')
  .description('Agent skill registry — store, version, and distribute AI agent skills')
  .version(pkg.version)
  .option('--json', 'Output results as structured JSON')
  .option('--verbose', 'Show detailed debug output')
  .option('--quiet', 'Suppress all non-essential output')
  .exitOverride()
  .configureOutput({
    writeErr: (str) => {
      if (!isJSONMode()) {
        process.stderr.write(str)
      }
    },
    writeOut: (str) => {
      if (!isJSONMode()) {
        process.stdout.write(str)
      }
    },
  })

registerAdoptCommand(program)
registerAgentsCommand(program)
registerAuditCommand(program)
registerBackupCommand(program)
registerCiCommand(program)
registerCompletionCommand(program)
registerConfigCommand(program)
registerDeprecateCommand(program)
registerDiffCommand(program)
registerDoctorCommand(program)
registerDraftCommand(program)
registerInfoCommand(program)
registerInitCommand(program)
registerInstallCommand(program)
registerListCommand(program)
registerLogCommand(program)
registerLoginCommand(program)
registerLogoutCommand(program)
registerMigrateCommand(program)
registerPinCommand(program)
registerPromoteCommand(program)
registerPublishCommand(program)
registerRemoveCommand(program)
registerSaveCommand(program)
registerScanCommand(program)
registerSearchCommand(program)
registerStatusCommand(program)
registerSuggestCommand(program)
registerSuggestionsCommand(program)
registerSyncCommand(program)
registerUnpinCommand(program)
registerUnpublishCommand(program)
registerUpdateCommand(program)
registerUpgradeCommand(program)
registerValidateCommand(program)
registerVerifyCommand(program)
registerVersionCommand(program)
registerWhoamiCommand(program)

try {
  program.parse()
} catch (err: unknown) {
  if (err instanceof CommanderError) {
    // --help and --version exit with code 0 — let them through silently
    if (err.exitCode !== 0 && isJSONMode()) {
      const code = err.code === 'commander.unknownCommand' ? 'UNKNOWN_COMMAND' : 'VALIDATION_ERROR'
      outputError(code, err.message)
    }
    process.exit(err.exitCode)
  }
  throw err
}
