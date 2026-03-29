import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputError, outputSuccess } from '../output.js'
import { type AgentverConfig, getConfigPath, readConfig, writeConfig } from '../registry/config.js'

const KNOWN_KEYS = ['platformUrl', 'defaultOrg', 'telemetry'] as const
type KnownKey = (typeof KNOWN_KEYS)[number]

function isKnownKey(key: string): key is KnownKey {
  return (KNOWN_KEYS as readonly string[]).includes(key)
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function validateKey(key: string): key is KnownKey {
  if (!isKnownKey(key)) {
    if (isJSONMode()) {
      outputError('INVALID_KEY', `Unknown config key: ${key}. Valid keys: ${KNOWN_KEYS.join(', ')}`)
    } else {
      console.error(chalk.red(`Unknown config key: ${key}. Valid keys: ${KNOWN_KEYS.join(', ')}`))
    }
    return false
  }
  return true
}

function validateValue(key: KnownKey, value: string): { valid: boolean; parsed?: unknown } {
  switch (key) {
    case 'telemetry': {
      if (value !== 'true' && value !== 'false') {
        if (isJSONMode()) {
          outputError('INVALID_VALUE', 'telemetry must be true or false')
        } else {
          console.error(chalk.red('telemetry must be true or false'))
        }
        return { valid: false }
      }
      return { valid: true, parsed: value === 'true' }
    }
    case 'platformUrl': {
      if (!value.startsWith('https://') && !value.startsWith('http://')) {
        if (isJSONMode()) {
          outputError('INVALID_VALUE', 'platformUrl must start with http:// or https://')
        } else {
          console.error(chalk.red('platformUrl must start with http:// or https://'))
        }
        return { valid: false }
      }
      return { valid: true, parsed: value }
    }
    default:
      return { valid: true, parsed: value }
  }
}

export function registerConfigCommand(program: Command): void {
  const configCmd = program.command('config').description('Manage CLI configuration')

  configCmd
    .command('list')
    .description('Show all config values')
    .option('--json', 'Output as JSON')
    .action(() => {
      const config = readConfig()
      const jsonMode = isJSONMode()

      if (jsonMode) {
        outputSuccess(config)
        return
      }

      const entries = Object.entries(config)

      if (entries.length === 0) {
        console.log(chalk.dim('No configuration set.'))
        return
      }

      console.log(chalk.bold('\nConfiguration:\n'))

      for (const [key, value] of entries) {
        console.log(`  ${chalk.green(key)} = ${chalk.cyan(formatValue(value))}`)
      }

      console.log()
    })

  configCmd
    .command('get')
    .description('Get a config value')
    .argument('<key>', 'Config key to read')
    .option('--json', 'Output as JSON')
    .action((key: string) => {
      const jsonMode = isJSONMode()

      if (!validateKey(key)) {
        process.exit(1)
      }

      const config = readConfig()
      const value = config[key as KnownKey]

      if (jsonMode) {
        outputSuccess({ key, value: value ?? null })
        return
      }

      if (value === undefined) {
        process.exit(0)
      }

      console.log(formatValue(value))
    })

  configCmd
    .command('set')
    .description('Set a config value')
    .argument('<key>', 'Config key to set')
    .argument('<value>', 'Value to set')
    .option('--json', 'Output as JSON')
    .action((key: string, value: string) => {
      const jsonMode = isJSONMode()

      if (!validateKey(key)) {
        process.exit(1)
      }

      const validation = validateValue(key, value)

      if (!validation.valid) {
        process.exit(1)
      }

      const config = readConfig()
      const updated: AgentverConfig = { ...config, [key]: validation.parsed }
      writeConfig(updated)

      if (jsonMode) {
        outputSuccess({ key, value: validation.parsed })
        return
      }

      console.log(chalk.green(`Set ${key} = ${formatValue(validation.parsed)}`))
    })

  configCmd
    .command('unset')
    .description('Remove a config key')
    .argument('<key>', 'Config key to remove')
    .option('--json', 'Output as JSON')
    .action((key: string) => {
      const jsonMode = isJSONMode()

      if (!validateKey(key)) {
        process.exit(1)
      }

      const config = readConfig()
      delete config[key as KnownKey]
      writeConfig(config)

      if (jsonMode) {
        outputSuccess({ key, removed: true })
        return
      }

      console.log(chalk.green(`Removed ${key}`))
    })

  configCmd
    .command('path')
    .description('Print the config file path')
    .action(() => {
      console.log(getConfigPath())
    })
}
