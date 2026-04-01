import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  detectGlobalAgents,
  detectInstalledAgents,
  scanForSkillFiles,
  scanGlobalSkillFiles,
} from '@agentver/agent-definitions'
import type { ScanResult } from '@agentver/shared'
import {
  getPackageSourceCommit,
  getPackageSourceLocation,
  getPackageSourceReference,
  validateSkillMd,
} from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputSuccess } from '../output'
import { readManifest } from '../storage/manifest.js'
import { getPackageDisplayName } from '../storage/package-identity.js'

export function registerScanCommand(program: Command): void {
  program
    .command('scan [path]')
    .alias('detect')
    .description('Scan directory for agent configs and skills')
    .action(async (path?: string) => {
      const jsonMode = isJSONMode()
      const targetPath = path ?? process.cwd()

      const projectAgents = detectInstalledAgents(targetPath)
      const globalAgents = detectGlobalAgents(homedir())

      // Merge: project agents first, then global agents not already detected
      const seenIds = new Set(projectAgents.map((a) => a.id))
      const agents = [...projectAgents, ...globalAgents.filter((a) => !seenIds.has(a.id))]

      // Merge project + global skill files, deduplicating by path
      const projectFiles = scanForSkillFiles(targetPath)
      const globalFiles = scanGlobalSkillFiles(homedir())
      const seenPaths = new Set(projectFiles.map((f) => f.path))
      const files = [...projectFiles, ...globalFiles.filter((f) => !seenPaths.has(f.path))]

      if (jsonMode) {
        const result: ScanResult = {
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            paths: [a.configPath],
          })),
          skills: files.map((f) => ({
            name: f.name,
            path: f.path,
            type: f.detectedType,
          })),
        }
        outputSuccess(result)
        return
      }

      console.log(chalk.bold('\nDetected agents:\n'))

      if (agents.length === 0) {
        console.log(chalk.dim('  No agents detected.'))
      } else {
        for (const agent of agents) {
          console.log(`  ${chalk.green(agent.name)} ${chalk.dim(agent.configPath)}`)
        }
      }

      console.log(chalk.bold('\nDiscovered files:\n'))

      if (files.length === 0) {
        console.log(chalk.dim('  No skill or config files found.'))
      } else {
        for (const file of files) {
          const typeLabel = chalk.dim(`[${file.detectedType}]`)
          const agentLabel = chalk.cyan(`(${file.agentId})`)
          console.log(`  ${typeLabel} ${agentLabel} ${file.name} ${chalk.dim(file.path)}`)
        }
      }

      // Validate SKILL.md files against the Agent Skills spec
      const skillFiles = files.filter((f) => f.detectedType === 'SKILL')
      if (skillFiles.length > 0) {
        console.log(chalk.bold('\nSkill spec validation:\n'))

        for (const file of skillFiles) {
          let content: string
          try {
            content = readFileSync(file.path, 'utf-8')
          } catch {
            console.log(`  ${chalk.red('\u2717')} ${file.name} ${chalk.dim('Could not read file')}`)
            continue
          }

          const result = validateSkillMd(content)

          if (result.valid && result.specCompliant) {
            console.log(
              `  ${chalk.green('\u2713')} ${file.name} ${chalk.green('Agent Skills spec compliant')}`
            )
          } else if (result.valid && !result.specCompliant) {
            console.log(
              `  ${chalk.yellow('\u2713')} ${file.name} ${chalk.yellow('Valid (Agentver extended)')}`
            )
          } else {
            console.log(`  ${chalk.red('\u2717')} ${file.name} ${chalk.red('Invalid')}`)
            for (const error of result.errors) {
              console.log(`    ${chalk.red(`\u2514 ${error}`)}`)
            }
          }

          if (result.warnings.length > 0) {
            for (const warning of result.warnings) {
              console.log(`    ${chalk.yellow(`\u26A0 ${warning}`)}`)
            }
          }

          if (result.agentverExtensions.length > 0) {
            console.log(
              `    ${chalk.dim(`Agentver extensions: ${result.agentverExtensions.join(', ')}`)}`
            )
          }
        }
      }

      const manifest = readManifest(targetPath)
      const manifestEntries = Object.entries(manifest.packages)

      if (manifestEntries.length > 0) {
        console.log(chalk.bold(`\nInstalled skills (${manifestEntries.length}):\n`))

        for (const [packageKey, pkg] of manifestEntries) {
          const displayName = getPackageDisplayName(packageKey, pkg)
          const source = pkg.source
          const agentList = `[${pkg.agents.join(', ')}]`

          if (source.type === 'git') {
            const sourcePath = getPackageSourceLocation(source)
            const ref = `@${getPackageSourceReference(source)}`
            const commit = `(${getPackageSourceCommit(source).slice(0, 7)})`
            console.log(
              `  ${chalk.green(displayName.padEnd(18))} ${chalk.dim(sourcePath.padEnd(40))} ${chalk.cyan(ref.padEnd(10))} ${chalk.dim(commit)}  ${chalk.dim(agentList)}`
            )
          } else if (source.type === 'platform') {
            const sourcePath = getPackageSourceLocation(source)
            const ref = `@${getPackageSourceReference(source)}`
            const commit = `(${getPackageSourceCommit(source).slice(0, 7)})`
            console.log(
              `  ${chalk.green(displayName.padEnd(18))} ${chalk.dim(sourcePath.padEnd(40))} ${chalk.cyan(ref.padEnd(10))} ${chalk.dim(commit)}  ${chalk.dim(agentList)}`
            )
          } else if (source.type === 'well-known') {
            const sourceLabel = `${getPackageSourceLocation(source)} (well-known)`
            console.log(
              `  ${chalk.green(displayName.padEnd(18))} ${chalk.dim(sourceLabel.padEnd(40))} ${chalk.dim('[well-known]').padEnd(10)}  ${chalk.dim(agentList)}`
            )
          } else if (source.type === 'local') {
            console.log(
              `  ${chalk.green(displayName.padEnd(18))} ${chalk.dim(getPackageSourceLocation(source).padEnd(40))} ${chalk.dim('[local]').padEnd(10)}  ${chalk.dim(agentList)}`
            )
          } else {
            console.log(
              `  ${chalk.green(displayName.padEnd(18))} ${chalk.dim(getPackageSourceLocation(source).padEnd(40))} ${chalk.dim('[unknown]').padEnd(10)}  ${chalk.dim(agentList)}`
            )
          }
        }
      }

      console.log()
    })
}
