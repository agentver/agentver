import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { InitResult } from '@agentver/shared'
import chalk from 'chalk'
import type { Command } from 'commander'
import prompts from 'prompts'
import { isJSONMode, outputError, outputSuccess } from '../output.js'

// ---------------------------------------------------------------------------
// Token budget helpers
// ---------------------------------------------------------------------------

const TOKEN_BUDGET = 5000

/** Rough token estimate: ~4 characters per token. */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4)
}

/** Warn (informational only) if content exceeds the recommended budget. */
function warnIfOverBudget(filePath: string, content: string): void {
  const tokens = estimateTokens(content)
  if (tokens > TOKEN_BUDGET) {
    process.stderr.write(
      chalk.yellow(
        `\n  Warning: ${filePath} is ~${tokens} tokens (recommended < ${TOKEN_BUDGET}).\n`
      )
    )
    process.stderr.write(
      chalk.yellow('  Move detailed content to docs/ or examples/ for progressive disclosure.\n')
    )
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const SKILL_TEMPLATE = `---
name: {{name}}
description: {{description}}
version: 0.1.0
author: {{author}}
compatibility:
  agents:
    - claude-code
    - cursor
    - windsurf
triggers:
  - "Use when the user asks about..."
  - "Use when working with..."
---

<!-- Keep this file under 5000 tokens. Use docs/ and examples/ for detailed content. -->

# {{name}}

{{description}}

## When to use

- Trigger condition 1
- Trigger condition 2

## Instructions

Step-by-step instructions for the AI agent.

1. First, do this
2. Then, do that
3. Finally, verify the result

## Examples

### Example 1: Basic usage

\`\`\`
Describe a typical interaction
\`\`\`
`

const AGENT_CONFIG_TEMPLATE = `# {{name}}

<!-- [section:overview] -->

{{description}}

## Project Overview

<!-- Describe the project, its purpose, and key architecture decisions -->

<!-- [/section:overview] -->

<!-- [section:tech-stack] -->

## Tech Stack

<!-- List frameworks, languages, and key dependencies -->

<!-- [/section:tech-stack] -->

<!-- [section:standards] -->

## Code Standards

<!-- Define naming conventions, file structure, and coding patterns -->

## Forbidden Patterns

<!-- List anti-patterns, deprecated approaches, and things to avoid -->

<!-- [/section:standards] -->

<!-- [section:testing] -->

## Testing Requirements

<!-- Define testing strategy, coverage expectations, and testing patterns -->

<!-- [/section:testing] -->

<!-- [section:workflow] -->

## PR Conventions

<!-- Define PR title format, review process, and merge requirements -->

<!-- [/section:workflow] -->
`

const PLUGIN_TEMPLATE = `{
  "name": "{{name}}",
  "description": "{{description}}",
  "version": "1.0.0",
  "tools": [],
  "hooks": {},
  "rules": []
}
`

const SCRIPT_TEMPLATE = `{
  "name": "{{name}}",
  "description": "{{description}}",
  "version": "1.0.0",
  "runtime": "node",
  "entryPoint": "src/index.ts",
  "args": []
}
`

const PROMPT_TEMPLATE = `---
name: {{name}}
description: {{description}}
version: 0.1.0
author: {{author}}
variables:
  - name: topic
    description: "The subject to focus on"
    required: true
    default: ""
  - name: tone
    description: "The desired tone (e.g. formal, casual, technical)"
    required: false
    default: "neutral"
---

# {{name}}

{{description}}

## Prompt

<!-- Write the prompt content below. Use \${variable_name} for variable substitution. -->

You are an expert on \${topic}. Respond in a \${tone} tone.

## Notes

<!-- Additional context or guidance for prompt usage. -->
`

const SCRIPT_ENTRY_TEMPLATE = `#!/usr/bin/env node
// {{name}} — entry point
`

const AGENTVERIGNORE_CONTENT = `node_modules/
.git/
.DS_Store
*.log
.env*
`

const EXAMPLES_README = `# Examples

Add example files here. These are loaded on demand by the agent when it needs
more context about how to use the skill.

Each file should demonstrate a single use case or scenario.
`

const DOCS_README = `# Documentation

Add detailed documentation here. Reference these files from SKILL.md when the
agent needs deeper context.

Keep SKILL.md concise (< 5000 tokens) and offload detailed explanations,
reference material, and edge-case handling into this directory.
`

const EXAMPLE_SKILL_TEMPLATE = `---
name: example-skill
description: A starter skill demonstrating best practices
version: 0.1.0
author: Your Name
compatibility:
  agents:
    - claude-code
    - cursor
    - windsurf
triggers:
  - "Use when the user asks about example patterns"
  - "Use when scaffolding a new skill"
---

<!-- Keep this file under 5000 tokens. Use docs/ and examples/ for detailed content. -->

# Example Skill

A starter skill that demonstrates the recommended structure and conventions.

## When to use

- When creating a new skill for the first time
- When reviewing best practices for skill authoring

## Instructions

1. Read the frontmatter to understand metadata and triggers
2. Follow the progressive disclosure pattern: keep this file concise
3. Place detailed docs in \`docs/\` and usage examples in \`examples/\`

## Examples

### Example 1: Basic usage

\`\`\`
User: "Help me scaffold a new skill"
Agent: Reads this skill, follows the structure, creates a new SKILL.md
\`\`\`
`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildReadme(name: string, description: string): string {
  return `# ${name}

${description}

## Structure

\`\`\`
skills/       — Agent skills (SKILL.md files)
configs/      — Agent configurations (CLAUDE.md, .cursorrules, etc.)
prompts/      — Reusable prompt templates (PROMPT.md files)
\`\`\`

## Install

\`\`\`bash
agentver install github.com/YOUR_ORG/YOUR_REPO@main
\`\`\`
`
}

function createGitkeep(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, '.gitkeep'), '', 'utf-8')
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Scaffold a new package')
    .option('--type <type>', 'Package type: skill, agent, plugin, script, prompt', 'skill')
    .option('--repo', 'Scaffold in a Git-repo-friendly structure')
    .option('--name <name>', 'Package name (required in JSON mode)')
    .option('--description <desc>', 'Package description')
    .action(
      async (options: { type: string; repo?: boolean; name?: string; description?: string }) => {
        let packageName: string
        let description: string
        let author = ''

        if (isJSONMode()) {
          if (!options.name) {
            outputError('VALIDATION_ERROR', 'Name is required in JSON mode (use --name flag)')
            process.exit(1)
          }
          packageName = options.name
          description = options.description ?? ''
        } else if (options.name) {
          packageName = options.name
          description = options.description ?? ''

          if (options.type === 'skill' || options.type === 'prompt') {
            const authorResponse = await prompts({
              type: 'text',
              name: 'author',
              message: 'Author:',
            })
            author = (authorResponse.author as string) ?? ''
          }
        } else {
          const promptQuestions: prompts.PromptObject[] = [
            {
              type: 'text',
              name: 'name',
              message: 'Package name:',
              validate: (value: string) => (value.length > 0 ? true : 'Name is required'),
            },
            {
              type: 'text',
              name: 'description',
              message: 'Description:',
            },
          ]

          if (options.type === 'skill' || options.type === 'prompt') {
            promptQuestions.push({
              type: 'text',
              name: 'author',
              message: 'Author:',
            })
          }

          const response = await prompts(promptQuestions)

          if (!response.name) return

          packageName = response.name as string
          description = (response.description as string) ?? ''
          author = (response.author as string) ?? ''
        }

        const dir = join(process.cwd(), packageName)

        if (existsSync(dir)) {
          if (isJSONMode()) {
            outputError('ALREADY_EXISTS', `Directory "${packageName}" already exists.`)
            process.exit(1)
          }
          console.error(chalk.red(`Directory "${packageName}" already exists.`))
          process.exit(1)
        }

        mkdirSync(dir, { recursive: true })

        const applyReplacements = (tmpl: string) =>
          tmpl
            .replace(/\{\{name\}\}/g, packageName)
            .replace(/\{\{description\}\}/g, description)
            .replace(/\{\{author\}\}/g, author)

        let fileName: string
        const createdFiles: string[] = []

        switch (options.type) {
          case 'skill': {
            fileName = 'SKILL.md'
            const content = applyReplacements(SKILL_TEMPLATE)
            writeFileSync(join(dir, fileName), content, 'utf-8')
            createdFiles.push(fileName)
            if (!options.repo) {
              mkdirSync(join(dir, 'examples'), { recursive: true })
              writeFileSync(join(dir, 'examples', 'README.md'), EXAMPLES_README, 'utf-8')
              createdFiles.push('examples/README.md')
              mkdirSync(join(dir, 'docs'), { recursive: true })
              writeFileSync(join(dir, 'docs', 'README.md'), DOCS_README, 'utf-8')
              createdFiles.push('docs/README.md')
            }
            if (!isJSONMode()) {
              warnIfOverBudget(fileName, content)
            }
            break
          }

          case 'agent': {
            fileName = 'CLAUDE.md'
            const content = applyReplacements(AGENT_CONFIG_TEMPLATE)
            writeFileSync(join(dir, fileName), content, 'utf-8')
            createdFiles.push(fileName)
            if (!options.repo) {
              mkdirSync(join(dir, 'rules'), { recursive: true })
            }
            break
          }

          case 'plugin': {
            fileName = 'plugin.json'
            writeFileSync(join(dir, fileName), applyReplacements(PLUGIN_TEMPLATE), 'utf-8')
            createdFiles.push(fileName)
            if (!options.repo) {
              mkdirSync(join(dir, 'scripts'), { recursive: true })
            }
            break
          }

          case 'script': {
            fileName = 'script.json'
            writeFileSync(join(dir, fileName), applyReplacements(SCRIPT_TEMPLATE), 'utf-8')
            createdFiles.push(fileName)
            mkdirSync(join(dir, 'src'), { recursive: true })
            writeFileSync(
              join(dir, 'src', 'index.ts'),
              applyReplacements(SCRIPT_ENTRY_TEMPLATE),
              'utf-8'
            )
            createdFiles.push('src/index.ts')
            break
          }

          case 'prompt': {
            fileName = 'PROMPT.md'
            const content = applyReplacements(PROMPT_TEMPLATE)
            writeFileSync(join(dir, fileName), content, 'utf-8')
            createdFiles.push(fileName)
            if (!options.repo) {
              mkdirSync(join(dir, 'variants'), { recursive: true })
            }
            if (!isJSONMode()) {
              warnIfOverBudget(fileName, content)
            }
            break
          }

          default: {
            if (isJSONMode()) {
              outputError('VALIDATION_ERROR', `Unknown package type: "${options.type}"`)
              process.exit(1)
            }
            console.error(chalk.red(`Unknown package type: "${options.type}"`))
            process.exit(1)
          }
        }

        if (options.repo) {
          const skillsDir = join(dir, 'skills', 'example-skill')
          mkdirSync(skillsDir, { recursive: true })
          writeFileSync(join(skillsDir, 'SKILL.md'), EXAMPLE_SKILL_TEMPLATE, 'utf-8')
          createdFiles.push('skills/example-skill/SKILL.md')
          mkdirSync(join(skillsDir, 'examples'), { recursive: true })
          writeFileSync(join(skillsDir, 'examples', 'README.md'), EXAMPLES_README, 'utf-8')
          createdFiles.push('skills/example-skill/examples/README.md')
          mkdirSync(join(skillsDir, 'docs'), { recursive: true })
          writeFileSync(join(skillsDir, 'docs', 'README.md'), DOCS_README, 'utf-8')
          createdFiles.push('skills/example-skill/docs/README.md')

          createGitkeep(join(dir, 'configs'))
          createdFiles.push('configs/.gitkeep')
          createGitkeep(join(dir, 'prompts'))
          createdFiles.push('prompts/.gitkeep')

          writeFileSync(join(dir, 'README.md'), buildReadme(packageName, description), 'utf-8')
          createdFiles.push('README.md')
          writeFileSync(join(dir, '.agentverignore'), AGENTVERIGNORE_CONTENT, 'utf-8')
          createdFiles.push('.agentverignore')
        }

        if (isJSONMode()) {
          outputSuccess<InitResult>({
            name: packageName,
            type: options.type,
            path: dir,
            files: createdFiles,
          })
          return
        }

        console.log(chalk.green(`\nCreated ${fileName} in ./${packageName}/`))

        if (options.repo) {
          console.log(chalk.dim('Repo structure created with skills/, configs/, prompts/'))
          console.log(
            chalk.dim(`Install with: agentver install github.com/YOUR_ORG/YOUR_REPO@main`)
          )
        } else {
          console.log(chalk.dim(`Edit the file, then run: agentver publish ./${packageName}`))
        }
      }
    )
}
