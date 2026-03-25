import { homedir } from 'node:os'
import { detectGlobalAgents, detectInstalledAgents } from '@agentver/agent-definitions'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode } from '../output.js'

type AgentsOptions = {
  global?: boolean
}

export function registerAgentsCommand(program: Command): void {
  program
    .command('agents')
    .description('List detected AI agents in the current project')
    .option('--global', 'Show globally detected agents instead of project agents')
    .action(async (options: AgentsOptions) => {
      const jsonMode = isJSONMode()

      const agents = options.global
        ? detectGlobalAgents(homedir())
        : detectInstalledAgents(process.cwd())

      if (jsonMode) {
        process.stdout.write(
          `${JSON.stringify({
            success: true,
            data: {
              agents: agents.map((a) => ({
                id: a.id,
                name: a.name,
                configPath: a.configPath,
              })),
              scope: options.global ? 'global' : 'project',
            },
          })}\n`
        )
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
