import { deleteBackup, listBackups, restorePersistentBackup } from '@agentver/installer'
import type {
  BackupDeleteResult,
  BackupIndexEntry,
  BackupListResult,
  BackupRestoreResult,
} from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { isJSONMode, outputError, outputSuccess } from '../output.js'
import type { Scope } from '../utils/paths.js'

function resolveScope(options: { global?: boolean }): Scope {
  return options.global ? 'global' : 'project'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function totalSize(entry: BackupIndexEntry): number {
  let total = 0
  for (const item of entry.items) {
    total += item.size
  }
  return total
}

export function registerBackupCommand(program: Command): void {
  const backup = program
    .command('backup')
    .description('Manage persistent backups of overwritten files')

  // --- list ---
  backup
    .command('list')
    .description('List all persistent backups')
    .option('--global', 'List global backups')
    .option('--json', 'Output as JSON')
    .action((options: { global?: boolean; json?: boolean }) => {
      const jsonMode = isJSONMode() || options.json === true
      const scope = resolveScope(options)
      const projectRoot = process.cwd()
      const entries = listBackups(projectRoot, scope)

      if (jsonMode) {
        outputSuccess<BackupListResult>({ backups: entries })
        return
      }

      if (entries.length === 0) {
        console.log(chalk.dim('No backups found.'))
        return
      }

      console.log(chalk.bold(`\nBackups (${String(entries.length)}):\n`))

      const idWidth = Math.max(4, ...entries.map((e) => e.id.length))
      const nameWidth = Math.max(7, ...entries.map((e) => e.displayName.length))
      const reasonWidth = Math.max(6, ...entries.map((e) => e.reason.length))

      console.log(
        `  ${chalk.dim('ID'.padEnd(idWidth))}  ${chalk.dim('Package'.padEnd(nameWidth))}  ${chalk.dim('Reason'.padEnd(reasonWidth))}  ${chalk.dim('Size')}      ${chalk.dim('Created')}`
      )

      for (const entry of entries) {
        const size = formatSize(totalSize(entry))
        console.log(
          `  ${entry.id.padEnd(idWidth)}  ${chalk.green(entry.displayName.padEnd(nameWidth))}  ${entry.reason.padEnd(reasonWidth)}  ${size.padEnd(10)}${formatDate(entry.createdAt)}`
        )
      }

      console.log()
      console.log(chalk.dim('Use: agentver backup restore <id>'))
      console.log()
    })

  // --- restore ---
  backup
    .command('restore <id>')
    .description('Restore files from a specific backup')
    .option('--global', 'Restore from global backups')
    .option('--yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { global?: boolean; yes?: boolean; json?: boolean }) => {
      const jsonMode = isJSONMode() || options.json === true
      const scope = resolveScope(options)
      const projectRoot = process.cwd()

      const entries = listBackups(projectRoot, scope)
      const entry = entries.find((e) => e.id === id)

      if (!entry) {
        if (jsonMode) {
          outputError('NOT_FOUND', `Backup not found: ${id}`)
        } else {
          console.error(chalk.red(`Backup not found: ${id}`))
        }
        process.exitCode = 1
        return
      }

      if (!jsonMode && !options.yes) {
        console.log()
        console.log(chalk.bold(`Restore backup ${id}?`))
        console.log()
        console.log(`  Package: ${chalk.green(entry.displayName)}`)
        console.log(`  Reason:  ${entry.reason}`)
        console.log(`  Files:`)
        for (const item of entry.items) {
          console.log(`    ${item.originalPath} (${item.kind}, ${formatSize(item.size)})`)
        }
        console.log()
        console.log(chalk.yellow('  This will overwrite the current contents at these paths.'))
        console.log()

        const { confirmed } = (await prompts({
          type: 'confirm',
          name: 'confirmed',
          message: 'Continue?',
          initial: true,
        })) as { confirmed: boolean }

        if (!confirmed) {
          console.log(chalk.dim('Cancelled.'))
          return
        }
      }

      if (jsonMode && !options.yes) {
        outputError('CONFIRMATION_REQUIRED', 'Re-run with --yes to restore without confirmation.')
        process.exitCode = 1
        return
      }

      try {
        const restoredPaths = restorePersistentBackup(projectRoot, scope, id)

        if (jsonMode) {
          outputSuccess<BackupRestoreResult>({
            restored: true,
            backupId: id,
            paths: restoredPaths,
          })
        } else {
          console.log(
            chalk.green(`Restored ${String(restoredPaths.length)} path(s) from backup ${id}`)
          )
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (jsonMode) {
          outputError('RESTORE_FAILED', message)
        } else {
          console.error(chalk.red(`Restore failed: ${message}`))
        }
        process.exitCode = 1
      }
    })

  // --- delete ---
  backup
    .command('delete <id>')
    .description('Delete a specific backup')
    .option('--global', 'Delete from global backups')
    .option('--yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: { global?: boolean; yes?: boolean; json?: boolean }) => {
      const jsonMode = isJSONMode() || options.json === true
      const scope = resolveScope(options)
      const projectRoot = process.cwd()

      const entries = listBackups(projectRoot, scope)
      const entry = entries.find((e) => e.id === id)

      if (!entry) {
        if (jsonMode) {
          outputError('NOT_FOUND', `Backup not found: ${id}`)
        } else {
          console.error(chalk.red(`Backup not found: ${id}`))
        }
        process.exitCode = 1
        return
      }

      if (!jsonMode && !options.yes) {
        const { confirmed } = (await prompts({
          type: 'confirm',
          name: 'confirmed',
          message: `Delete backup ${id} (${entry.displayName})?`,
          initial: false,
        })) as { confirmed: boolean }

        if (!confirmed) {
          console.log(chalk.dim('Cancelled.'))
          return
        }
      }

      if (jsonMode && !options.yes) {
        outputError('CONFIRMATION_REQUIRED', 'Re-run with --yes to delete without confirmation.')
        process.exitCode = 1
        return
      }

      try {
        deleteBackup(projectRoot, scope, id)

        if (jsonMode) {
          outputSuccess<BackupDeleteResult>({
            deleted: true,
            backupId: id,
          })
        } else {
          console.log(chalk.green(`Deleted backup ${id}`))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (jsonMode) {
          outputError('BACKUP_FAILED', message)
        } else {
          console.error(chalk.red(`Delete failed: ${message}`))
        }
        process.exitCode = 1
      }
    })
}
