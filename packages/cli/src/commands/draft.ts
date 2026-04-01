import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { createSpinner, outputSuccess } from '../output.js'
import { type PlatformResolveResponse, platformFetch } from '../registry/platform.js'
import { getCanonicalSkillPath } from '../storage/canonical.js'
import { computeSha256FromFiles, deriveCommitFromIntegrity } from '../storage/integrity.js'
import { readLockfile } from '../storage/lockfile.js'
import {
  getTrackedSourceRef,
  isPlatformManagedSource,
  resolvePackageQuery,
} from '../storage/package-identity.js'
import { updateManifestAndLockfile } from '../storage/pair.js'
import { resolveCurrentSkillIdentity } from './skill-context.js'

type DraftInfo = {
  name: string
  branchName: string
  latestCommitId: string
  latestMessage: string
}

type DraftCreateResponse = {
  name: string
  branchName: string
}

type DraftActionResponse = {
  commitSha?: string
}

type DraftListOptions = {
  json?: boolean
}

function writeResolvedFiles(
  targetPath: string,
  files: Array<{ path: string; content: string }>
): void {
  rmSync(targetPath, { recursive: true, force: true })
  mkdirSync(targetPath, { recursive: true })

  for (const file of files) {
    const resolvedFilePath = resolve(targetPath, file.path)
    if (!resolvedFilePath.startsWith(`${targetPath}/`) && resolvedFilePath !== targetPath) {
      continue
    }

    const parentDir = dirname(resolvedFilePath)
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true })
    }

    writeFileSync(resolvedFilePath, file.content, 'utf-8')
  }
}

export function registerDraftCommand(program: Command): void {
  const draft = program.command('draft').description('Manage skill drafts (branches)')

  // --- draft create <name> ---
  draft
    .command('create <name>')
    .description('Create a draft branch for the current skill')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: DraftListOptions) => {
      const identity = resolveCurrentSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      const spinner = createSpinner(`Creating draft "${name}"...`).start()

      try {
        const result = await platformFetch<DraftCreateResponse>(
          `/skills/@${identity.org}/${identity.name}/drafts`,
          {
            method: 'POST',
            body: { name },
          }
        )

        if (options.json) {
          spinner.stop()
          outputSuccess(result)
        } else {
          spinner.succeed(
            `Draft ${chalk.green(result.name)} created on branch ${chalk.cyan(result.branchName)}`
          )
        }
      } catch (error) {
        spinner.fail(
          `Failed to create draft: ${error instanceof Error ? error.message : String(error)}`
        )
        process.exit(1)
      }
    })

  // --- draft list ---
  draft
    .command('list')
    .description('List open drafts for the current skill')
    .option('--json', 'Output as JSON')
    .action(async (options: DraftListOptions) => {
      const identity = resolveCurrentSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      const spinner = createSpinner('Fetching drafts...').start()

      try {
        const drafts = await platformFetch<DraftInfo[]>(
          `/skills/@${identity.org}/${identity.name}/drafts`
        )

        spinner.stop()

        if (options.json) {
          outputSuccess({ drafts })
          return
        }

        if (drafts.length === 0) {
          process.stdout.write(chalk.dim('No open drafts.\n'))
          return
        }

        process.stdout.write(chalk.bold(`\nDrafts for @${identity.org}/${identity.name}:\n\n`))

        for (const d of drafts) {
          process.stdout.write(
            `  ${chalk.green(d.name)} ${chalk.dim(`(${d.latestCommitId.slice(0, 7)})`)} ${chalk.dim(d.latestMessage)}\n`
          )
        }

        process.stdout.write('\n')
      } catch (error) {
        spinner.fail(
          `Failed to list drafts: ${error instanceof Error ? error.message : String(error)}`
        )
        process.exit(1)
      }
    })

  // --- draft switch <name> ---
  draft
    .command('switch <name>')
    .description('Switch to a draft branch (updates lockfile ref)')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options: DraftListOptions) => {
      const identity = resolveCurrentSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      const projectRoot = process.cwd()
      let syncedFiles = false
      let draftCommitSha: string | undefined
      let syncWarning: string | undefined
      const draftRef = `draft/${identity.name}/${name}`
      const currentLockfile = readLockfile(projectRoot)
      const lockEntryLookup = resolvePackageQuery(currentLockfile.packages, identity.name)
      const lockEntry = lockEntryLookup.ok ? lockEntryLookup.pkg : undefined

      if (!lockEntry || !isPlatformManagedSource(lockEntry.source)) {
        process.stderr.write(chalk.red(`Skill "${identity.name}" not found in lockfile.\n`))
        process.exit(1)
      }

      try {
        const resolved = await platformFetch<PlatformResolveResponse>(
          `/resolve?name=${encodeURIComponent(`${identity.org}/${identity.name}`)}&ref=${encodeURIComponent(draftRef)}`
        )

        if (resolved.source === 'platform' && resolved.files?.length) {
          const resolvedFiles = resolved.files
          let warning: string | undefined

          updateManifestAndLockfile(projectRoot, 'project', (manifest, lockfile) => {
            const manifestEntryLookup = resolvePackageQuery(manifest.packages, identity.name)
            const lockEntryLookup = resolvePackageQuery(lockfile.packages, identity.name)
            const manifestEntry = manifestEntryLookup.ok ? manifestEntryLookup.pkg : undefined
            const lockEntry = lockEntryLookup.ok ? lockEntryLookup.pkg : undefined

            if (!manifestEntry || !lockEntry || !isPlatformManagedSource(lockEntry.source)) {
              throw new Error(`Skill "${identity.name}" not found in lockfile.`)
            }

            if (manifestEntry.packageType === 'AGENT' || manifestEntry.packageType === 'COMMAND') {
              warning =
                'Draft selected, but automatic file sync is only available for skill directories.'
            } else {
              const targetPath =
                manifestEntry.path ?? getCanonicalSkillPath(projectRoot, identity.name, 'project')
              writeResolvedFiles(targetPath, resolvedFiles)
              const integrity = computeSha256FromFiles(
                resolvedFiles.map((file) => ({
                  path: file.path,
                  content: file.content,
                }))
              )
              draftCommitSha = deriveCommitFromIntegrity(integrity)
              lockEntry.integrity = integrity
              syncedFiles = true
            }

            if (isPlatformManagedSource(manifestEntry.source)) {
              manifestEntry.source.ref = draftRef
              if (draftCommitSha) {
                manifestEntry.source.commit = draftCommitSha
              }
            }

            lockEntry.source.ref = draftRef
            if (draftCommitSha) {
              lockEntry.source.commit = draftCommitSha
            }

            return { manifest, lockfile }
          })

          syncWarning = warning
        } else {
          syncWarning =
            'Draft selected, but the platform could not provide draft files. Run save after updating locally.'
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('not found in lockfile')) {
          process.stderr.write(chalk.red(`${message}\n`))
          process.exit(1)
        }

        updateManifestAndLockfile(projectRoot, 'project', (manifest, lockfile) => {
          const manifestEntryLookup = resolvePackageQuery(manifest.packages, identity.name)
          const lockEntryLookup = resolvePackageQuery(lockfile.packages, identity.name)
          const manifestEntry = manifestEntryLookup.ok ? manifestEntryLookup.pkg : undefined
          const lockEntry = lockEntryLookup.ok ? lockEntryLookup.pkg : undefined

          if (!lockEntry || !isPlatformManagedSource(lockEntry.source)) {
            throw new Error(`Skill "${identity.name}" not found in lockfile.`)
          }

          if (manifestEntry && isPlatformManagedSource(manifestEntry.source)) {
            manifestEntry.source.ref = draftRef
          }

          lockEntry.source.ref = draftRef
          return { manifest, lockfile }
        })

        syncWarning = 'Draft selected, but local files were not refreshed automatically.'
      }

      if (options.json) {
        outputSuccess({
          skill: `@${identity.org}/${identity.name}`,
          draft: name,
          ref: draftRef,
          syncedFiles,
          ...(syncWarning ? { warning: syncWarning } : {}),
        })
      } else {
        process.stdout.write(
          `Switched to draft ${chalk.green(name)} ${chalk.dim(`(ref: ${draftRef})`)}\n`
        )
        if (syncWarning) {
          process.stdout.write(chalk.dim(`${syncWarning}\n`))
        }
      }
    })

  // --- draft publish ---
  draft
    .command('publish')
    .description('Merge current draft to main')
    .option('--json', 'Output as JSON')
    .action(async (options: DraftListOptions) => {
      const identity = resolveCurrentSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      // Determine current draft from lockfile ref
      const projectRoot = process.cwd()
      const currentLockfile = readLockfile(projectRoot)
      const lockEntryLookup = resolvePackageQuery(currentLockfile.packages, identity.name)
      const lockEntry = lockEntryLookup.ok ? lockEntryLookup.pkg : undefined

      if (!lockEntry || !isPlatformManagedSource(lockEntry.source)) {
        process.stderr.write(chalk.red('Skill not found in lockfile.\n'))
        process.exit(1)
      }

      const currentRef = getTrackedSourceRef(lockEntry.source) ?? ''

      if (!currentRef.startsWith('draft/')) {
        process.stderr.write(chalk.red(`Not on a draft branch. Current ref: ${currentRef}\n`))
        process.exit(1)
      }

      const spinner = createSpinner('Merging draft to main...').start()

      try {
        const result = await platformFetch<DraftActionResponse>(
          `/skills/@${identity.org}/${identity.name}/drafts`,
          {
            method: 'POST',
            body: { action: 'merge', branchName: currentRef },
          }
        )

        updateManifestAndLockfile(projectRoot, 'project', (manifest, lockfile) => {
          const manifestEntryLookup = resolvePackageQuery(manifest.packages, identity.name)
          const lockEntryLookup = resolvePackageQuery(lockfile.packages, identity.name)
          const manifestEntry = manifestEntryLookup.ok ? manifestEntryLookup.pkg : undefined
          const lockEntry = lockEntryLookup.ok ? lockEntryLookup.pkg : undefined

          if (!lockEntry || !isPlatformManagedSource(lockEntry.source)) {
            throw new Error('Skill not found in lockfile.')
          }

          if (manifestEntry && isPlatformManagedSource(manifestEntry.source)) {
            manifestEntry.source.ref = 'main'
            if (result.commitSha) {
              manifestEntry.source.commit = result.commitSha
            }
          }

          lockEntry.source.ref = 'main'
          if (result.commitSha) {
            lockEntry.source.commit = result.commitSha
          }

          return { manifest, lockfile }
        })

        if (options.json) {
          spinner.stop()
          outputSuccess({
            merged: true,
            commitSha: result.commitSha,
            ref: 'main',
          })
        } else {
          spinner.succeed(
            `Draft merged to main ${result.commitSha ? chalk.dim(`(${result.commitSha.slice(0, 7)})`) : ''}`
          )
        }
      } catch (error) {
        spinner.fail(
          `Failed to merge draft: ${error instanceof Error ? error.message : String(error)}`
        )
        process.exit(1)
      }
    })

  // --- draft discard ---
  draft
    .command('discard')
    .description('Delete the current draft branch')
    .option('--json', 'Output as JSON')
    .action(async (options: DraftListOptions) => {
      const identity = resolveCurrentSkillIdentity()
      if (!identity) {
        process.stderr.write(
          chalk.red('Could not determine skill identity. Run this from a skill directory.\n')
        )
        process.exit(1)
      }

      const projectRoot = process.cwd()
      const currentLockfile = readLockfile(projectRoot)
      const lockEntryLookup = resolvePackageQuery(currentLockfile.packages, identity.name)
      const lockEntry = lockEntryLookup.ok ? lockEntryLookup.pkg : undefined

      if (!lockEntry || !isPlatformManagedSource(lockEntry.source)) {
        process.stderr.write(chalk.red('Skill not found in lockfile.\n'))
        process.exit(1)
      }

      const currentRef = getTrackedSourceRef(lockEntry.source) ?? ''

      if (!currentRef.startsWith('draft/')) {
        process.stderr.write(chalk.red(`Not on a draft branch. Current ref: ${currentRef}\n`))
        process.exit(1)
      }

      const spinner = createSpinner('Discarding draft...').start()

      try {
        await platformFetch<DraftActionResponse>(
          `/skills/@${identity.org}/${identity.name}/drafts`,
          {
            method: 'POST',
            body: { action: 'delete', branchName: currentRef },
          }
        )

        updateManifestAndLockfile(projectRoot, 'project', (manifest, lockfile) => {
          const manifestEntryLookup = resolvePackageQuery(manifest.packages, identity.name)
          const lockEntryLookup = resolvePackageQuery(lockfile.packages, identity.name)
          const manifestEntry = manifestEntryLookup.ok ? manifestEntryLookup.pkg : undefined
          const lockEntry = lockEntryLookup.ok ? lockEntryLookup.pkg : undefined

          if (!lockEntry || !isPlatformManagedSource(lockEntry.source)) {
            throw new Error('Skill not found in lockfile.')
          }

          if (manifestEntry && isPlatformManagedSource(manifestEntry.source)) {
            manifestEntry.source.ref = 'main'
          }

          lockEntry.source.ref = 'main'
          return { manifest, lockfile }
        })

        if (options.json) {
          spinner.stop()
          outputSuccess({
            discarded: true,
            previousRef: currentRef,
            ref: 'main',
          })
        } else {
          spinner.succeed(`Draft discarded. Switched back to ${chalk.cyan('main')}.`)
        }
      } catch (error) {
        spinner.fail(
          `Failed to discard draft: ${error instanceof Error ? error.message : String(error)}`
        )
        process.exit(1)
      }
    })
}
