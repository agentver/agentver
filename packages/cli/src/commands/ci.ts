import type { CiResult, RestoreResultOutput } from '@agentver/shared'
import type { Command } from 'commander'
import { isJSONMode, outputError, outputSuccess } from '../output.js'
import { extractError } from '../utils.js'
import { restoreFromManifest } from './install.js'

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
        // Capture the restore result by intercepting JSON output
        let restoreOutput: RestoreResultOutput | undefined

        if (jsonMode) {
          // In JSON mode, we need to capture the restore output instead of
          // letting restoreFromManifest write it directly. We do this by
          // intercepting stdout writes.
          const originalWrite = process.stdout.write.bind(process.stdout)
          let captured = ''

          process.stdout.write = ((
            chunk: string | Uint8Array,
            encodingOrCb?: BufferEncoding | ((err?: Error) => void),
            cb?: (err?: Error) => void
          ): boolean => {
            if (typeof chunk === 'string') {
              captured += chunk
            }
            // Suppress the output — we'll write our own
            if (typeof encodingOrCb === 'function') {
              encodingOrCb()
              return true
            }
            if (typeof cb === 'function') {
              cb()
              return true
            }
            return true
          }) as typeof process.stdout.write

          try {
            await restoreFromManifest({
              agent: options.agent,
              global: options.global,
              skipAudit: options.skipAudit,
              concurrency: options.concurrency,
              yes: true,
              force: false,
              offline: false,
            })
          } finally {
            process.stdout.write = originalWrite
          }

          // Parse captured output to extract the restore result
          const lines = captured.trim().split('\n').filter(Boolean)
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line) as { success: boolean; data?: RestoreResultOutput }
              if (parsed.data?.type === 'RESTORE_COMPLETE') {
                restoreOutput = parsed.data
              }
            } catch {
              // Not JSON — ignore
            }
          }

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
        } else {
          // In text mode, just run restore with --yes (non-interactive)
          await restoreFromManifest({
            agent: options.agent,
            global: options.global,
            skipAudit: options.skipAudit,
            concurrency: options.concurrency,
            yes: true,
            force: false,
            offline: false,
          })
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

type CiOptions = {
  agent?: string | string[]
  global?: boolean
  skipAudit?: boolean
  concurrency?: number
}
