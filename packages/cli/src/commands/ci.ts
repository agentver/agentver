import type { CiResult } from '@agentver/shared'
import type { Command } from 'commander'
import { isJSONMode, outputError, outputSuccess } from '../output.js'
import { extractError } from '../utils.js'
import { restoreFromManifest } from './install.js'

type CiOptions = {
  agent?: string | string[]
  global?: boolean
  skipAudit?: boolean
  concurrency?: number
}

export function registerCiCommand(program: Command): void {
  program
    .command('ci')
    .description('Non-interactive restore and verify — exits 0 on success, 1 on any failure')
    .option('--agent <agent>', 'Target specific agent', (value: string, previous?: string[]) => [
      ...(previous ?? []),
      value,
    ])
    .option('--global', 'Restore at user level (~/.agents/skills/)')
    .option('--skip-audit', 'Skip the security scan during restore')
    .option('--concurrency <n>', 'Max concurrent fetches (default: 4)', Number.parseInt)
    .action(async (options: CiOptions) => {
      const jsonMode = isJSONMode()

      try {
        const restoreOutput = await restoreFromManifest({
          agent: options.agent,
          global: options.global,
          skipAudit: options.skipAudit,
          concurrency: options.concurrency,
          yes: true,
          force: false,
          offline: false,
        })

        if (jsonMode) {
          const success =
            restoreOutput?.success ?? (process.exitCode === undefined || process.exitCode === 0)

          const ciResult: CiResult = {
            restore: restoreOutput ?? {
              type: 'RESTORE_COMPLETE',
              packages: [],
              installedCount: 0,
              upToDateCount: 0,
              skippedCount: 0,
              failedCount: 0,
              success,
            },
            success,
          }

          outputSuccess(ciResult)

          if (!success) {
            process.exitCode = 1
          }
        }
      } catch (error) {
        const { code, message } = extractError(error, 'CI_FAILED')
        if (jsonMode) {
          outputError(code, message)
        } else if (code !== 'CANCELLED') {
          process.stderr.write(`${message}\n`)
        }
        process.exit(1)
      }
    })
}
