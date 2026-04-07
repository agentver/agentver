import { homedir } from 'node:os'
import { detectGlobalAgents, detectInstalledAgents } from '@agentver/agent-definitions'
import type { SetupResult, SetupStep, SetupStepStatus } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { getCredentials, isAuthenticated } from '../registry/auth.js'
import {
  DEFAULT_PLATFORM_URL,
  getPlatformUrl,
  readConfig,
  writeConfig,
} from '../registry/config.js'
import { checkOnline } from '../utils/network.js'

type StepResult = {
  name: string
  status: SetupStepStatus
  message: string
}

async function stepPlatformUrl(): Promise<StepResult> {
  const existing = getPlatformUrl()

  if (existing) {
    const { change } = (await prompts({
      type: 'confirm',
      name: 'change',
      message: `Platform URL is already set to ${existing}. Change it?`,
      initial: false,
    })) as { change?: boolean }

    if (!change) {
      return { name: 'platform-url', status: 'skip', message: `Kept existing: ${existing}` }
    }
  }

  const { url } = (await prompts({
    type: 'text',
    name: 'url',
    message: 'Platform URL',
    initial: DEFAULT_PLATFORM_URL,
    validate: (value: string) => {
      if (!value.startsWith('http://') && !value.startsWith('https://')) {
        return 'URL must start with http:// or https://'
      }
      return true
    },
  })) as { url?: string }

  if (!url) {
    return { name: 'platform-url', status: 'skip', message: 'Skipped (no input)' }
  }

  const config = readConfig()
  writeConfig({ ...config, platformUrl: url })
  return { name: 'platform-url', status: 'pass', message: `Set to ${url}` }
}

async function stepAuthentication(): Promise<StepResult> {
  const alreadyAuthenticated = await isAuthenticated()

  if (alreadyAuthenticated) {
    const creds = await getCredentials()
    const method = creds?.token ? 'OAuth token' : 'API key'
    return { name: 'authentication', status: 'pass', message: `Already authenticated (${method})` }
  }

  const { method } = (await prompts({
    type: 'select',
    name: 'method',
    message: 'How would you like to authenticate?',
    choices: [
      { title: 'Browser (OAuth)', value: 'oauth' },
      { title: 'API key', value: 'apikey' },
      { title: 'Skip for now', value: 'skip' },
    ],
  })) as { method?: string }

  if (!method || method === 'skip') {
    return {
      name: 'authentication',
      status: 'skip',
      message: 'Skipped — run `agentver login` later',
    }
  }

  if (method === 'oauth') {
    return {
      name: 'authentication',
      status: 'skip',
      message: 'Run `agentver login` to complete OAuth authentication',
    }
  }

  const { apiKey } = (await prompts({
    type: 'password',
    name: 'apiKey',
    message: 'Enter your API key',
    validate: (value: string) => (value.trim().length > 0 ? true : 'API key must not be empty'),
  })) as { apiKey?: string }

  if (!apiKey?.trim()) {
    return { name: 'authentication', status: 'skip', message: 'Skipped (no key provided)' }
  }

  const { saveCredentials } = await import('../registry/auth.js')
  saveCredentials({ apiKey: apiKey.trim() })
  return { name: 'authentication', status: 'pass', message: 'API key saved' }
}

function stepDetectAgents(projectRoot: string): StepResult {
  const projectAgents = detectInstalledAgents(projectRoot)
  const globalAgents = detectGlobalAgents(homedir())

  const seenIds = new Set(projectAgents.map((a) => a.id))
  const agents = [...projectAgents, ...globalAgents.filter((a) => !seenIds.has(a.id))]

  if (agents.length === 0) {
    return {
      name: 'detect-agents',
      status: 'pass',
      message: 'No agents detected (install one to get started)',
    }
  }

  const names = agents.map((a) => a.name).join(', ')
  return {
    name: 'detect-agents',
    status: 'pass',
    message: `Found ${String(agents.length)} agent${agents.length === 1 ? '' : 's'}: ${names}`,
  }
}

async function stepConnectivity(): Promise<StepResult> {
  const platformUrl = getPlatformUrl()
  if (!platformUrl) {
    return {
      name: 'connectivity',
      status: 'skip',
      message: 'No platform URL configured',
    }
  }

  const spinner = createSpinner('Checking connectivity...').start()
  const online = await checkOnline()
  spinner.stop()

  if (online) {
    return { name: 'connectivity', status: 'pass', message: 'Platform is reachable' }
  }

  return {
    name: 'connectivity',
    status: 'fail',
    message: 'Platform is unreachable — check your network or platform URL',
  }
}

function stepDefaultOrg(): StepResult {
  const config = readConfig()
  if (config.defaultOrg) {
    return {
      name: 'default-org',
      status: 'pass',
      message: `Default organisation: ${config.defaultOrg}`,
    }
  }
  return {
    name: 'default-org',
    status: 'skip',
    message: 'No default organisation set — use `agentver config set defaultOrg <slug>` to set one',
  }
}

function formatStep(step: SetupStep): string {
  switch (step.status) {
    case 'pass':
      return `  ${chalk.green('\u2713')} ${step.message}`
    case 'fail':
      return `  ${chalk.red('\u2717')} ${step.message}`
    case 'skip':
      return `  ${chalk.yellow('\u2013')} ${step.message}`
  }
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Interactive setup wizard for first-time configuration')
    .action(async () => {
      const jsonMode = isJSONMode()
      const projectRoot = process.cwd()

      if (jsonMode) {
        outputError(
          'INTERACTIVE_REQUIRED',
          'The setup wizard requires an interactive terminal. Configure manually with `agentver config` and `agentver login`.'
        )
        process.exit(1)
      }

      console.log(chalk.bold('\nAgentver Setup\n'))
      console.log(chalk.dim('This wizard will help you configure Agentver.\n'))

      const steps: StepResult[] = []

      // Step 1: Platform URL
      steps.push(await stepPlatformUrl())

      // Step 2: Connectivity check
      steps.push(await stepConnectivity())

      // Step 3: Authentication
      steps.push(await stepAuthentication())

      // Step 4: Detect agents
      steps.push(stepDetectAgents(projectRoot))

      // Step 5: Default organisation
      steps.push(stepDefaultOrg())

      // Summary
      const completed = steps.filter((s) => s.status === 'pass').length
      const failed = steps.filter((s) => s.status === 'fail').length
      const skipped = steps.filter((s) => s.status === 'skip').length

      console.log(chalk.bold('\nSetup summary:\n'))

      for (const step of steps) {
        console.log(formatStep(step))
      }

      console.log()
      console.log(
        chalk.dim(
          `${chalk.green(String(completed))} completed, ${chalk.red(String(failed))} failed, ${chalk.yellow(String(skipped))} skipped`
        )
      )

      if (failed > 0) {
        console.log(
          chalk.dim(`\nRun ${chalk.bold('agentver doctor --fix')} to diagnose and repair issues.`)
        )
      }

      console.log()
    })
}

export function registerSetupCommandJSON(program: Command): void {
  // JSON-mode variant for programmatic use — runs all non-interactive checks
  program
    .command('setup-check')
    .description('Run setup checks non-interactively (JSON output)')
    .action(async () => {
      const projectRoot = process.cwd()

      const steps: SetupStep[] = []

      // Platform URL
      const platformUrl = getPlatformUrl()
      steps.push({
        name: 'platform-url',
        status: platformUrl ? 'pass' : 'skip',
        message: platformUrl ? `Configured: ${platformUrl}` : 'Not configured',
      })

      // Connectivity
      if (platformUrl) {
        const online = await checkOnline()
        steps.push({
          name: 'connectivity',
          status: online ? 'pass' : 'fail',
          message: online ? 'Platform is reachable' : 'Platform is unreachable',
        })
      } else {
        steps.push({
          name: 'connectivity',
          status: 'skip',
          message: 'No platform URL configured',
        })
      }

      // Authentication
      const authenticated = await isAuthenticated()
      steps.push({
        name: 'authentication',
        status: authenticated ? 'pass' : 'skip',
        message: authenticated ? 'Authenticated' : 'Not authenticated',
      })

      // Detect agents
      const projectAgents = detectInstalledAgents(projectRoot)
      const globalAgents = detectGlobalAgents(homedir())
      const seenIds = new Set(projectAgents.map((a) => a.id))
      const agents = [...projectAgents, ...globalAgents.filter((a) => !seenIds.has(a.id))]
      steps.push({
        name: 'detect-agents',
        status: 'pass',
        message: `Found ${String(agents.length)} agent${agents.length === 1 ? '' : 's'}`,
      })

      // Default org
      const config = readConfig()
      steps.push({
        name: 'default-org',
        status: config.defaultOrg ? 'pass' : 'skip',
        message: config.defaultOrg
          ? `Default organisation: ${config.defaultOrg}`
          : 'Not configured',
      })

      const completed = steps.filter((s) => s.status === 'pass').length
      const failed = steps.filter((s) => s.status === 'fail').length
      const skippedCount = steps.filter((s) => s.status === 'skip').length

      const result: SetupResult = { steps, completed, failed, skipped: skippedCount }
      outputSuccess(result)
    })
}
