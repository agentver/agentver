import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import chalk from 'chalk'
import type { InstallOptions } from '../commands/install.js'
import type { FetchedFile } from '../git/types.js'
import type { SpinnerLike } from '../output.js'
import { createAgentSymlinks, getCanonicalSkillPath } from '../storage/canonical'

/**
 * Install a single constituent package from local bundle files.
 *
 * Writes files to the canonical skill path and creates agent symlinks,
 * mirroring the behaviour of `installStandardPackage` in install.ts.
 */
export async function installLocalBundleConstituent(
  name: string,
  files: FetchedFile[],
  agents: string[],
  options: InstallOptions,
  spinner: SpinnerLike
): Promise<void> {
  const projectRoot = process.cwd()
  const scope = options.global ? 'global' : 'project'

  if (options.dryRun) {
    const canonicalPath = getCanonicalSkillPath(projectRoot, name, scope)
    spinner.info(
      `${chalk.yellow('[dry-run]')} Would install ${chalk.green(name)} to ${chalk.dim(canonicalPath)}`
    )
    return
  }

  const canonicalPath = getCanonicalSkillPath(projectRoot, name, scope)

  if (!existsSync(canonicalPath)) {
    mkdirSync(canonicalPath, { recursive: true })
  }

  for (const file of files) {
    const resolvedFilePath = resolve(canonicalPath, file.path)
    const relativePath = relative(canonicalPath, resolvedFilePath)
    if (relativePath.startsWith('..') || resolve(resolvedFilePath) !== resolvedFilePath) {
      spinner.warn(`Skipping file with suspicious path: ${file.path}`)
      continue
    }

    const dir = dirname(resolvedFilePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(resolvedFilePath, file.content, 'utf-8')
  }

  createAgentSymlinks(projectRoot, name, agents, scope)
}
