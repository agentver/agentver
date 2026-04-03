import { homedir } from 'node:os'
import { basename, dirname } from 'node:path'
import type { ScannedFile } from '@agentver/agent-definitions'
import {
  detectGlobalAgents,
  detectInstalledAgents,
  scanForSkillFiles,
  scanGlobalSkillFiles,
} from '@agentver/agent-definitions'
import type { ManifestV2, PackageSource, SetupResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { createGitRepoCache, resolveLocalGitContext } from '../git/local-context.js'
import { createSpinner, isJSONMode, outputError, outputSuccess } from '../output.js'
import { readManifest } from '../storage/manifest.js'
import {
  resolvePackageQuery,
  setLockfilePackage,
  setManifestPackage,
} from '../storage/package-identity.js'
import { updateManifestAndLockfile } from '../storage/pair.js'
import type { Scope } from '../utils/paths.js'
import { extractError } from '../utils.js'
import { buildAdoptSource, computeAdoptedIntegrity, deduplicateByPath } from './adopt.js'
import {
  checkLockfileIntegrity,
  checkManifestIntegrity,
  checkManifestLockfileSync,
  checkSkillFilesExist,
  checkSymlinksValid,
  formatCheck,
} from './doctor.js'
import { migrateSkills } from './migrate.js'

type SetupOptions = {
  global?: boolean
  dryRun?: boolean
  yes?: boolean
  canonicalise?: boolean
}

type DiscoveredSkill = {
  name: string
  path: string
  type: string
  agents: string[]
  alreadyManaged: boolean
}

type AnnotatedAgent = {
  id: string
  name: string
  configPath: string
  scope: 'project' | 'global'
}

type AdoptedEntry = {
  name: string
  path: string
  type: string
  agents: string[]
}

type SkippedEntry = {
  name: string
  reason: string
}

// ---------------------------------------------------------------------------
// Phase 1: Discovery
// ---------------------------------------------------------------------------

function discoverAgents(projectRoot: string, includeGlobal: boolean): AnnotatedAgent[] {
  const projectAgents = detectInstalledAgents(projectRoot)
  const seenIds = new Set(projectAgents.map((a) => a.id))

  const agents: AnnotatedAgent[] = projectAgents.map((a) => ({
    id: a.id,
    name: a.name,
    configPath: a.configPath,
    scope: 'project' as const,
  }))

  if (includeGlobal) {
    const globalAgents = detectGlobalAgents(homedir())
    for (const a of globalAgents) {
      if (!seenIds.has(a.id)) {
        agents.push({ id: a.id, name: a.name, configPath: a.configPath, scope: 'global' })
        seenIds.add(a.id)
      }
    }
  }

  return agents
}

function discoverSkills(
  projectRoot: string,
  includeGlobal: boolean,
  manifest: ManifestV2
): DiscoveredSkill[] {
  const projectFiles = scanForSkillFiles(projectRoot)
  const seenPaths = new Set(projectFiles.map((f) => f.path))

  const allFiles: ScannedFile[] = [...projectFiles]

  if (includeGlobal) {
    const globalFiles = scanGlobalSkillFiles(homedir())
    for (const gf of globalFiles) {
      if (!seenPaths.has(gf.path)) {
        allFiles.push(gf)
        seenPaths.add(gf.path)
      }
    }
  }

  const deduped = deduplicateByPath(allFiles)

  return deduped.map((file) => {
    const existing = resolvePackageQuery(manifest.packages, file.name)
    return {
      name: file.name,
      path: file.path,
      type: file.detectedType,
      agents: file.agents,
      alreadyManaged: existing.ok,
    }
  })
}

// ---------------------------------------------------------------------------
// Phase 2: Display
// ---------------------------------------------------------------------------

function displayFindings(agents: AnnotatedAgent[], skills: DiscoveredSkill[]): void {
  process.stdout.write(chalk.bold('\nDetected agents:\n\n'))

  if (agents.length === 0) {
    process.stdout.write(chalk.dim('  No agents detected.\n'))
  } else {
    for (const agent of agents) {
      const scopeTag = agent.scope === 'global' ? chalk.dim(' (global)') : ''
      process.stdout.write(
        `  ${chalk.green(agent.name)}${scopeTag} ${chalk.dim(agent.configPath)}\n`
      )
    }
  }

  process.stdout.write(chalk.bold('\nDiscovered skills:\n\n'))

  if (skills.length === 0) {
    process.stdout.write(chalk.dim('  No skill or config files found.\n'))
  } else {
    const newSkills = skills.filter((s) => !s.alreadyManaged)
    const managed = skills.filter((s) => s.alreadyManaged)

    for (const skill of newSkills) {
      const typeLabel = skill.type === 'SKILL' ? '' : chalk.dim(` [${skill.type}]`)
      const agentList = chalk.cyan(`(${skill.agents.join(', ')})`)
      process.stdout.write(
        `  ${chalk.white(skill.name)}${typeLabel} ${agentList} ${chalk.dim(skill.path)}\n`
      )
    }

    if (managed.length > 0) {
      for (const skill of managed) {
        process.stdout.write(`  ${chalk.dim(`${skill.name} — already managed`)}\n`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Selection
// ---------------------------------------------------------------------------

async function selectSkillsToAdopt(
  skills: DiscoveredSkill[],
  options: SetupOptions
): Promise<DiscoveredSkill[]> {
  if (options.yes || isJSONMode()) {
    return skills
  }

  const choices: prompts.Choice[] = skills.map((skill, index) => {
    const agentList = skill.agents.join(', ')
    const typeLabel = skill.type === 'SKILL' ? '' : ` (${skill.type})`
    return {
      title: `${skill.name}${typeLabel} [${agentList}]`,
      description: skill.path,
      value: index,
      selected: true,
    }
  })

  const { selected } = await prompts({
    type: 'multiselect',
    name: 'selected',
    message: 'Select skills to adopt',
    choices,
    hint: 'Space to toggle, return to confirm',
    instructions: false,
  })

  if (!selected || (selected as number[]).length === 0) {
    return []
  }

  return (selected as number[]).map((i) => skills[i]).filter(Boolean) as DiscoveredSkill[]
}

// ---------------------------------------------------------------------------
// Phase 4: Adoption
// ---------------------------------------------------------------------------

async function adoptSelectedSkills(
  projectRoot: string,
  selected: DiscoveredSkill[],
  scope: Scope,
  options: SetupOptions
): Promise<{ adopted: AdoptedEntry[]; skipped: SkippedEntry[] }> {
  const adopted: AdoptedEntry[] = []
  const skipped: SkippedEntry[] = []
  const gitCache = createGitRepoCache()

  type PendingAdoption = {
    name: string
    path: string
    type: string
    agents: string[]
    manifestEntry: {
      source: PackageSource
      agents: string[]
      installedAt: string
      modified: boolean
      packageType?: ManifestV2['packages'][string]['packageType']
      entryFile?: ManifestV2['packages'][string]['entryFile']
    }
    lockfileEntry: {
      source: PackageSource
      integrity: string
      agents: string[]
    }
  }

  const pending: PendingAdoption[] = []

  for (const skill of selected) {
    const isConfig = skill.type === 'AGENT_CONFIG'
    const sourcePath = isConfig ? skill.path : dirname(skill.path)
    const gitContext = await resolveLocalGitContext(sourcePath, gitCache)
    const { source, modified } = buildAdoptSource(gitContext, sourcePath)
    const integrity = await computeAdoptedIntegrity(
      skill.path,
      skill.type as ScannedFile['detectedType']
    )
    const entryFile =
      skill.type === 'AGENT' || skill.type === 'COMMAND' ? basename(skill.path) : undefined
    const packageType =
      skill.type === 'SKILL'
        ? undefined
        : (skill.type as ManifestV2['packages'][string]['packageType'])

    if (!options.dryRun) {
      pending.push({
        name: skill.name,
        path: skill.path,
        type: skill.type,
        agents: skill.agents,
        manifestEntry: {
          source,
          agents: skill.agents,
          installedAt: new Date().toISOString(),
          modified,
          packageType,
          entryFile,
        },
        lockfileEntry: {
          source,
          integrity,
          agents: skill.agents,
        },
      })
    }

    adopted.push({
      name: skill.name,
      path: skill.path,
      type: skill.type,
      agents: skill.agents,
    })
  }

  if (!options.dryRun && pending.length > 0) {
    const committedNames = new Set<string>()

    updateManifestAndLockfile(projectRoot, scope, (currentManifest, currentLockfile) => {
      for (const adoption of pending) {
        const existing = resolvePackageQuery(currentManifest.packages, adoption.name)
        if (existing.ok) {
          skipped.push({ name: adoption.name, reason: 'Already managed by Agentver' })
          continue
        }

        setManifestPackage(currentManifest, adoption.name, adoption.manifestEntry)
        setLockfilePackage(currentLockfile, adoption.name, adoption.lockfileEntry)
        committedNames.add(adoption.name)
      }

      return { manifest: currentManifest, lockfile: currentLockfile }
    })

    // Remove entries that were skipped at commit time from the adopted list
    if (committedNames.size !== pending.length) {
      const committed = adopted.filter((e) => committedNames.has(e.name))
      adopted.length = 0
      adopted.push(...committed)
    }
  }

  return { adopted, skipped }
}

// ---------------------------------------------------------------------------
// Phase 5: Canonicalisation
// ---------------------------------------------------------------------------

async function offerCanonicalisation(options: SetupOptions): Promise<boolean> {
  if (isJSONMode()) {
    return options.canonicalise === true
  }

  if (options.yes) {
    return options.canonicalise === true
  }

  const { proceed } = await prompts({
    type: 'confirm',
    name: 'proceed',
    message: 'Reorganise skill files into .agents/ with symlinks from agent directories?',
    initial: false,
  })

  return proceed === true
}

// ---------------------------------------------------------------------------
// Phase 6: Health checks
// ---------------------------------------------------------------------------

function runHealthChecks(
  projectRoot: string,
  scope: Scope
): Array<{ name: string; status: 'pass' | 'fail' | 'warn'; message: string }> {
  const checks = [
    checkManifestIntegrity(projectRoot, scope),
    checkLockfileIntegrity(projectRoot, scope),
    checkManifestLockfileSync(projectRoot, scope),
    checkSkillFilesExist(projectRoot, scope),
    checkSymlinksValid(projectRoot, scope),
  ]

  return checks.map((c) => ({ name: c.name, status: c.status, message: c.message }))
}

// ---------------------------------------------------------------------------
// Phase 7: Summary
// ---------------------------------------------------------------------------

function renderSummary(result: SetupResult): void {
  process.stdout.write(chalk.bold('\nSetup complete\n'))
  process.stdout.write(chalk.dim(`${'\u2500'.repeat(40)}\n\n`))

  process.stdout.write(`  Agents detected: ${chalk.green(String(result.agents.length))}\n`)
  process.stdout.write(`  Skills adopted:  ${chalk.green(String(result.adopted.length))}\n`)

  if (result.skipped.length > 0) {
    process.stdout.write(`  Skills skipped:  ${chalk.yellow(String(result.skipped.length))}\n`)
  }

  if (result.canonicalised.length > 0) {
    process.stdout.write(`  Canonicalised:   ${chalk.green(String(result.canonicalised.length))}\n`)
  }

  const passed = result.healthChecks.filter((c) => c.status === 'pass').length
  const failed = result.healthChecks.filter((c) => c.status === 'fail').length
  const warnings = result.healthChecks.filter((c) => c.status === 'warn').length
  process.stdout.write(`  Health:          ${chalk.green(String(passed))} passed`)
  if (failed > 0) process.stdout.write(`, ${chalk.red(String(failed))} failed`)
  if (warnings > 0) process.stdout.write(`, ${chalk.yellow(String(warnings))} warnings`)
  process.stdout.write('\n')

  // Health check details for failures/warnings
  if (failed > 0 || warnings > 0) {
    process.stdout.write('\n')
    for (const check of result.healthChecks) {
      if (check.status !== 'pass') {
        process.stdout.write(`${formatCheck(check)}\n`)
      }
    }
  }

  process.stdout.write(chalk.bold('\nNext steps:\n\n'))
  process.stdout.write(`  ${chalk.cyan('agentver status')}    Review managed skills\n`)
  process.stdout.write(
    `  ${chalk.cyan('agentver install')}   Install skills from a registry or Git\n`
  )
  process.stdout.write(`  ${chalk.cyan('agentver doctor')}    Run full health diagnostics\n`)

  if (result.canonicalised.length === 0 && result.adopted.length > 0) {
    process.stdout.write(
      `  ${chalk.cyan('agentver migrate')}   Centralise skill files with symlinks\n`
    )
  }

  process.stdout.write('\n')
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function setupProject(options: SetupOptions): Promise<void> {
  const jsonMode = isJSONMode()
  const projectRoot = process.cwd()
  const scope: Scope = options.global ? 'global' : 'project'
  const spinner = createSpinner('Starting setup...')

  try {
    // Welcome
    if (!jsonMode) {
      process.stdout.write('\n')
      process.stdout.write(chalk.bold('Agentver Setup\n'))
      process.stdout.write(chalk.dim(`${'\u2500'.repeat(40)}\n`))
      process.stdout.write(
        '\nThis wizard will detect your AI agents, discover existing skills,\n' +
          'and bring them under Agentver management.\n'
      )
    }

    // Scan
    spinner.text = 'Detecting agents and scanning for skills...'
    spinner.start()

    const agents = discoverAgents(projectRoot, options.global ?? false)
    const manifest = readManifest(projectRoot, scope)
    const skills = discoverSkills(projectRoot, options.global ?? false, manifest)

    spinner.stop()

    // Display findings
    if (!jsonMode) {
      displayFindings(agents, skills)
    }

    // Selection
    const selectable = skills.filter((s) => !s.alreadyManaged)
    let selected: DiscoveredSkill[]

    if (selectable.length === 0) {
      if (!jsonMode && skills.length > 0) {
        process.stdout.write(chalk.dim('\nAll discovered skills are already managed.\n'))
      }
      selected = []
    } else {
      selected = await selectSkillsToAdopt(selectable, options)
    }

    // Adopt
    let adopted: AdoptedEntry[] = []
    let skipped: SkippedEntry[] = []

    if (selected.length > 0) {
      spinner.text = 'Adopting skills...'
      spinner.start()

      const result = await adoptSelectedSkills(projectRoot, selected, scope, options)
      adopted = result.adopted
      skipped = result.skipped

      spinner.stop()

      if (!jsonMode && adopted.length > 0) {
        process.stdout.write(chalk.bold('\nAdopted:\n'))
        for (const entry of adopted) {
          const agentList = entry.agents.join(', ')
          process.stdout.write(
            `  ${chalk.green('\u2713')} ${chalk.green(entry.name)} ${chalk.cyan(`(${agentList})`)}\n`
          )
        }
      }

      if (!jsonMode && options.dryRun) {
        process.stdout.write(chalk.yellow('\n[dry-run] ') + chalk.dim('No changes written.\n'))
      }
    }

    // Canonicalisation
    let canonicalised: SetupResult['canonicalised'] = []

    if (!options.dryRun && adopted.length > 0) {
      const shouldCanonicalise = await offerCanonicalisation(options)

      if (shouldCanonicalise) {
        if (!jsonMode) {
          process.stdout.write('\n')
        }
        await migrateSkills(undefined, { yes: true, global: options.global, dryRun: false })
        // migrateSkills handles its own output and manifest updates
        // We record a simplified result for the summary
        canonicalised = adopted.map((a) => ({
          name: a.name,
          from: a.path,
          to: `.agents/skills/${a.name}`,
        }))
      }
    }

    // Health checks
    spinner.text = 'Running health checks...'
    spinner.start()

    const healthChecks = runHealthChecks(projectRoot, scope)

    spinner.stop()

    // Output
    const result: SetupResult = {
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        configPath: a.configPath,
        scope: a.scope,
      })),
      discovered: skills.map((s) => ({
        name: s.name,
        path: s.path,
        type: s.type,
        agents: s.agents,
        alreadyManaged: s.alreadyManaged,
      })),
      adopted: adopted.map((a) => ({
        name: a.name,
        path: a.path,
        type: a.type,
        agents: a.agents,
      })),
      skipped: skipped.map((s) => ({ name: s.name, reason: s.reason })),
      canonicalised,
      healthChecks,
    }

    if (jsonMode) {
      outputSuccess<SetupResult>(result)
      return
    }

    renderSummary(result)
  } catch (error) {
    const { code, message } = extractError(error, 'SETUP_FAILED')
    if (jsonMode) {
      outputError(code, message)
      process.exit(1)
    }
    spinner.stop()
    process.stderr.write(chalk.red(`\nSetup failed: ${message}\n`))
    process.exit(1)
  }
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Guided setup — detect agents, adopt skills, and verify health')
    .option('--global', 'Include global agent paths in detection')
    .option('--dry-run', 'Preview changes without writing anything')
    .option('-y, --yes', 'Skip prompts and adopt all discovered skills')
    .option('--canonicalise', 'Reorganise into .agents/ with symlinks (use with --yes)')
    .action(async (options: SetupOptions) => {
      await setupProject(options)
    })
}
