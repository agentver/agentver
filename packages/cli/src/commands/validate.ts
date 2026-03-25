import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validateSkillMd } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputError, outputSuccess } from '../output.js'

export function registerValidateCommand(program: Command): void {
  program
    .command('validate [path]')
    .description('Validate a SKILL.md file against the spec')
    .addHelpText(
      'after',
      `
Validates frontmatter, required fields, and spec compliance.
Defaults to SKILL.md in the current directory.`
    )
    .action(async (pathArg: string | undefined) => {
      const jsonMode = isJSONMode()
      const targetPath = pathArg ? resolve(process.cwd(), pathArg) : join(process.cwd(), 'SKILL.md')

      const skillMdPath = targetPath.endsWith('.md') ? targetPath : join(targetPath, 'SKILL.md')

      if (!existsSync(skillMdPath)) {
        if (jsonMode) {
          outputError('NOT_FOUND', `No SKILL.md found at ${skillMdPath}`)
          process.exit(1)
        }
        process.stderr.write(chalk.red(`No SKILL.md found at ${skillMdPath}\n`))
        process.exit(1)
      }

      const content = readFileSync(skillMdPath, 'utf-8')
      const result = validateSkillMd(content)

      if (jsonMode) {
        outputSuccess({
          path: skillMdPath,
          valid: result.valid,
          specCompliant: result.specCompliant,
          errors: result.errors,
          warnings: result.warnings,
          agentverExtensions: result.agentverExtensions,
        })
        if (!result.valid) process.exit(1)
        return
      }

      if (result.valid) {
        process.stdout.write(chalk.green('✓ SKILL.md is valid\n'))

        if (result.specCompliant) {
          process.stdout.write(chalk.dim('  agentskills.io spec compliant\n'))
        } else {
          process.stdout.write(
            chalk.yellow('  ⚠ Not fully agentskills.io spec compliant (Agentver extensions used)\n')
          )
        }

        if (result.agentverExtensions.length > 0) {
          process.stdout.write(
            chalk.dim(`  Agentver extensions: ${result.agentverExtensions.join(', ')}\n`)
          )
        }

        if (result.warnings.length > 0) {
          process.stdout.write('\n')
          for (const w of result.warnings) {
            process.stdout.write(chalk.yellow(`  ⚠ ${w}\n`))
          }
        }
      } else {
        process.stdout.write(chalk.red('✗ SKILL.md validation failed\n'))
        process.stdout.write('\n')
        for (const e of result.errors) {
          process.stdout.write(chalk.red(`  ✗ ${e}\n`))
        }
        process.exit(1)
      }
    })
}
