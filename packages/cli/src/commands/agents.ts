import { homedir } from 'node:os'
import { detectGlobalAgents, detectInstalledAgents } from '@agentver/agent-definitions'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputError, outputSuccess } from '../output.js'

type AgentsOptions = {
  global?: boolean
}

export function registerAgentsCommand(program: Command): void {
  program
    .command('agents')
    .description('List detected AI agents')
    .option('--global', 'Show globally detected agents instead of project agents')
    .action(async (options: AgentsOptions) => {
      const jsonMode = isJSONMode()
      const scope = options.global ? 'global' : 'project'

      let agents: ReturnType<typeof detectInstalledAgents>
      try {
        agents = options.global
          ? detectGlobalAgents(homedir())
          : detectInstalledAgents(process.cwd())
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (jsonMode) {
          outputError('DETECT_FAILED', message)
          process.exit(1)
        }
        process.stderr.write(chalk.red(`Failed to detect agents: ${message}\n`))
        process.exit(1)
      }

      if (jsonMode) {
        outputSuccess({
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            configPath: a.configPath,
          })),
          scope,
        })
        return
      }

      if (agents.length === 0) {
        process.stdout.write(
          chalk.dim(
            options.global
              ? 'No agents detected globally.\n'
              : 'No agents detected in this project.\n'
          )
        )
        return
      }

      const scopeLabel = options.global ? 'Global' : 'Project'
      process.stdout.write(chalk.bold(`\n${scopeLabel} agents (${agents.length}):\n\n`))

      for (const agent of agents) {
        process.stdout.write(
          `  ${chalk.green(agent.id)}  ${chalk.dim(agent.name)}  ${chalk.dim(agent.configPath)}\n`
        )
      }

      process.stdout.write('\n')
    })
}
