import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import type { ScannedFile } from '@agentver/agent-definitions'
import { scanForSkillFiles, scanGlobalSkillFiles } from '@agentver/agent-definitions'
import type { AdoptResult, GitSource } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { computeSha256FromBuffer } from '../storage/integrity'
import { readManifest } from '../storage/manifest'
import { updateManifestAndLockfile } from '../storage/pair'

export type AdoptOptions = {
  global?: boolean
  name?: string
  dryRun?: boolean
}

type AdoptedEntry = {
  name: string
  path: string
  type: string
  agents: string[]
}

type SkippedEntry = {
  name: string
  path: string
  reason: string
}

type DeduplicatedFile = {
  path: string
  name: string
  detectedType: ScannedFile['detectedType']
  agents: string[]
}

type PendingAdoption = {
  name: string
  path: string
  type: string
  agents: string[]
  manifestEntry: {
    source: GitSource
    agents: string[]
    installedAt: string
    modified: false
  }
  lockfileEntry: {
    source: GitSource
    integrity: string
    agents: string[]
  }
}

function deduplicateByPath(files: ScannedFile[]): DeduplicatedFile[] {
  const byPath = new Map<string, DeduplicatedFile>()

  for (const file of files) {
    const existing = byPath.get(file.path)
    if (existing) {
      if (!existing.agents.includes(file.agentId)) {
        existing.agents.push(file.agentId)
      }
    } else {
      byPath.set(file.path, {
        path: file.path,
        name: file.name,
        detectedType: file.detectedType,
        agents: [file.agentId],
      })
    }
  }

  return [...byPath.values()]
}

function computeFileIntegrity(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf-8')
    return computeSha256FromBuffer(content)
  } catch {
    return computeSha256FromBuffer('')
  }
}

function computeDirectoryIntegrity(entryFilePath: string): string {
  // For adopted skills, compute integrity from the entry file
  // (the SKILL.md or config file that was discovered)
  return computeFileIntegrity(entryFilePath)
}

export async function adoptSkills(path: string | undefined, options: AdoptOptions): Promise<void> {
  const jsonMode = isJSONMode()
  const spinner = createSpinner('Scanning for skills...').start()

  try {
    const targetPath = path ?? process.cwd()
    const projectRoot = process.cwd()
    const home = homedir()

    // Collect scanned files
    const projectFiles = scanForSkillFiles(targetPath)
    const seenPaths = new Set(projectFiles.map((f) => f.path))

    let allFiles: ScannedFile[] = [...projectFiles]

    if (options.global) {
      const globalFiles = scanGlobalSkillFiles(home)
      for (const gf of globalFiles) {
        if (!seenPaths.has(gf.path)) {
          allFiles.push(gf)
          seenPaths.add(gf.path)
        }
      }
    }

    // Filter by name if --name provided
    if (options.name) {
      allFiles = allFiles.filter((f) => f.name === options.name)
      if (allFiles.length === 0) {
        if (jsonMode) {
          outputError('NOT_FOUND', `No skill found matching name "${options.name}"`)
          process.exit(1)
        }
        spinner.fail(`No skill found matching name "${options.name}"`)
        process.exit(1)
      }
    }

    if (allFiles.length === 0) {
      if (jsonMode) {
        outputSuccess<AdoptResult>({ adopted: [], skipped: [] }, [
          'No skills or configs found to adopt.',
        ])
        return
      }
      spinner.warn('No skills or configs found to adopt.')
      return
    }

    // Deduplicate files by path, merging agents for the same file
    const deduped = deduplicateByPath(allFiles)

    const manifest = readManifest(projectRoot)
    const adopted: AdoptedEntry[] = []
    const skipped: SkippedEntry[] = []
    const pendingAdoptions: PendingAdoption[] = []

    for (const file of deduped) {
      // Check if already in manifest
      if (manifest.packages[file.name]) {
        skipped.push({
          name: file.name,
          path: file.path,
          reason: 'Already managed by Agentver',
        })
        continue
      }

      const integrity = computeDirectoryIntegrity(file.path)
      const sourcePath = file.detectedType === 'AGENT_CONFIG' ? file.path : dirname(file.path)

      const source: GitSource = {
        type: 'git',
        uri: 'local',
        path: sourcePath,
        ref: 'local',
        commit: 'adopted',
      }

      if (!options.dryRun) {
        pendingAdoptions.push({
          name: file.name,
          path: file.path,
          type: file.detectedType,
          agents: file.agents,
          manifestEntry: {
            source,
            agents: file.agents,
            installedAt: new Date().toISOString(),
            modified: false,
          },
          lockfileEntry: {
            source,
            integrity,
            agents: file.agents,
          },
        })
      }

      adopted.push({
        name: file.name,
        path: file.path,
        type: file.detectedType,
        agents: file.agents,
      })
    }

    if (!options.dryRun && pendingAdoptions.length > 0) {
      const committed = new Set<string>()

      updateManifestAndLockfile(projectRoot, 'project', (currentManifest, currentLockfile) => {
        for (const adoption of pendingAdoptions) {
          if (currentManifest.packages[adoption.name]) {
            skipped.push({
              name: adoption.name,
              path: adoption.path,
              reason: 'Already managed by Agentver',
            })
            continue
          }

          currentManifest.packages[adoption.name] = { ...adoption.manifestEntry }
          currentLockfile.packages[adoption.name] = { ...adoption.lockfileEntry }
          committed.add(adoption.name)
        }

        return { manifest: currentManifest, lockfile: currentLockfile }
      })

      if (committed.size !== pendingAdoptions.length) {
        const committedAdoptions = adopted.filter((entry) => committed.has(entry.name))
        adopted.length = 0
        adopted.push(...committedAdoptions)
      }
    }

    // Output results
    if (jsonMode) {
      outputSuccess<AdoptResult>({ adopted, skipped })
      return
    }

    spinner.stop()

    if (options.dryRun) {
      process.stdout.write(chalk.yellow('\n[dry-run] ') + chalk.dim('No changes written.\n'))
    }

    if (adopted.length > 0) {
      process.stdout.write(chalk.bold('\nAdopted:\n'))
      for (const entry of adopted) {
        const typeLabel = entry.type === 'AGENT_CONFIG' ? chalk.dim(', config') : ''
        const agentList = entry.agents.join(', ')
        process.stdout.write(
          `  ${chalk.green('\u2713')} ${chalk.green(entry.name.padEnd(16))} ${chalk.dim(entry.path.padEnd(45))} ${chalk.cyan(`(${agentList}${typeLabel})`)}\n`
        )
      }
    }

    if (skipped.length > 0) {
      process.stdout.write(chalk.bold('\nSkipped:\n'))
      for (const entry of skipped) {
        process.stdout.write(
          `  ${chalk.dim('\u2013')} ${entry.name.padEnd(16)} ${chalk.dim(entry.reason)}\n`
        )
      }
    }

    const summary = `\nAdopted ${adopted.length} skill${adopted.length === 1 ? '' : 's'}, skipped ${skipped.length}.\n`
    process.stdout.write(chalk.dim(summary))
  } catch (error) {
    if (jsonMode) {
      outputError('ADOPT_FAILED', error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    spinner.fail(`Failed to adopt: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

export function registerAdoptCommand(program: Command): void {
  program
    .command('adopt [path]')
    .description('Adopt existing skills and configs into Agentver management')
    .option('--global', 'Also scan global paths (~/.claude/skills, etc.)')
    .option('--name <name>', 'Adopt a specific skill by name')
    .option('--dry-run', 'Show what would be adopted without making changes')
    .action(async (path: string | undefined, options: AdoptOptions) => {
      await adoptSkills(path, options)
    })
}
