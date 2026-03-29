import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { isJSONMode, outputError, outputSuccess } from '../output'

type CompletionOptions = {
  install?: boolean
}

const TOP_LEVEL_COMMANDS: readonly string[] = [
  'adopt',
  'agents',
  'audit',
  'completion',
  'config',
  'diff',
  'doctor',
  'draft',
  'info',
  'init',
  'install',
  'list',
  'log',
  'login',
  'logout',
  'pin',
  'publish',
  'remove',
  'save',
  'scan',
  'search',
  'status',
  'suggest',
  'suggestions',
  'sync',
  'unpin',
  'update',
  'upgrade',
  'validate',
  'verify',
  'version',
  'whoami',
]

const SUBCOMMANDS: Readonly<Record<string, readonly string[]>> = {
  draft: ['create', 'list', 'switch', 'publish', 'discard'],
  version: ['create', 'list'],
  config: ['list', 'get', 'set', 'unset', 'path'],
  completion: ['bash', 'zsh', 'fish'],
}

const COMMON_FLAGS: readonly string[] = ['--json', '--global', '--dry-run', '--help']

function generateBashScript(): string {
  const subcmdCases = Object.entries(SUBCOMMANDS)
    .map(
      ([cmd, subs]) =>
        `      ${cmd})\n        COMPREPLY=( $(compgen -W "${subs.join(' ')}" -- "$cur") )\n        return 0\n        ;;`
    )
    .join('\n')

  return `# agentver bash completion
_agentver() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  commands="${TOP_LEVEL_COMMANDS.join(' ')}"

  if [[ "$COMP_CWORD" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "${COMMON_FLAGS.join(' ')}" -- "$cur") )
    return 0
  fi

  case "$prev" in
${subcmdCases}
  esac

  return 0
}

complete -F _agentver agentver
`
}

function generateZshScript(): string {
  const subcmdCases = Object.entries(SUBCOMMANDS)
    .map(
      ([cmd, subs]) =>
        `    ${cmd})\n      _values 'subcommand' ${subs.map((s) => `'${s}'`).join(' ')}\n      ;;`
    )
    .join('\n')

  return `# agentver zsh completion
_agentver() {
  local -a commands
  commands=(
${TOP_LEVEL_COMMANDS.map((c) => `    '${c}'`).join('\n')}
  )

  _arguments -C \
    '--json[Output results as structured JSON]' \
    '--global[Apply globally]' \
    '--dry-run[Preview changes without applying]' \
    '--help[Show help]' \
    '1:command:->cmd' \
    '*::arg:->args'

  case "$state" in
    cmd)
      _describe 'command' commands
      ;;
    args)
      case "\${words[1]}" in
${subcmdCases}
      esac
      ;;
  esac
}

compdef _agentver agentver
`
}

function generateFishScript(): string {
  const topLevelCompletions = TOP_LEVEL_COMMANDS.map(
    (cmd) => `complete -c agentver -n '__fish_use_subcommand' -a '${cmd}'`
  ).join('\n')

  const subcmdCompletions = Object.entries(SUBCOMMANDS)
    .flatMap(([cmd, subs]) =>
      subs.map((sub) => `complete -c agentver -n '__fish_seen_subcommand_from ${cmd}' -a '${sub}'`)
    )
    .join('\n')

  const flagCompletions = [
    "complete -c agentver -l json -d 'Output results as structured JSON'",
    "complete -c agentver -l global -d 'Apply globally'",
    "complete -c agentver -l dry-run -d 'Preview changes without applying'",
    "complete -c agentver -l help -d 'Show help'",
  ].join('\n')

  return `# agentver fish completion
${topLevelCompletions}
${subcmdCompletions}
${flagCompletions}
`
}

type Shell = 'bash' | 'zsh' | 'fish'

const SHELL_GENERATORS: Record<Shell, () => string> = {
  bash: generateBashScript,
  zsh: generateZshScript,
  fish: generateFishScript,
}

const RC_PATHS: Record<Shell, string> = {
  bash: join(homedir(), '.bashrc'),
  zsh: join(homedir(), '.zshrc'),
  fish: join(homedir(), '.config', 'fish', 'config.fish'),
}

const EVAL_LINES: Record<Shell, string> = {
  bash: 'eval "$(agentver completion bash)"',
  zsh: 'eval "$(agentver completion zsh)"',
  fish: 'agentver completion fish | source',
}

function installCompletion(shell: Shell): void {
  const rcPath = RC_PATHS[shell]
  const evalLine = EVAL_LINES[shell]

  if (existsSync(rcPath)) {
    const content = readFileSync(rcPath, 'utf-8')
    if (content.includes(evalLine)) {
      process.stdout.write(chalk.dim(`Completion already installed in ${rcPath}\n`))
      return
    }
  }

  appendFileSync(rcPath, `\n# agentver shell completion\n${evalLine}\n`)
  process.stdout.write(
    chalk.green(`Completion installed in ${rcPath}\n`) +
      chalk.dim('Restart your shell or run: ') +
      chalk.cyan(`source ${rcPath}`) +
      '\n'
  )
}

export function registerCompletionCommand(program: Command): void {
  program
    .command('completion <shell>')
    .description('Generate shell completion scripts (bash, zsh, fish)')
    .option('--install', 'Install the completion script to your shell RC file')
    .action((shell: string, options: CompletionOptions) => {
      const jsonMode = isJSONMode()

      if (!['bash', 'zsh', 'fish'].includes(shell)) {
        if (jsonMode) {
          outputError('INVALID_SHELL', `Unsupported shell "${shell}". Supported: bash, zsh, fish`)
          process.exit(1)
        }
        process.stderr.write(
          chalk.red(`Unsupported shell "${shell}". Supported: bash, zsh, fish\n`)
        )
        process.exit(1)
      }

      const validShell = shell as Shell
      const script = SHELL_GENERATORS[validShell]()

      if (options.install) {
        if (jsonMode) {
          installCompletion(validShell)
          outputSuccess({ shell: validShell, installed: true, rcPath: RC_PATHS[validShell] })
          return
        }
        installCompletion(validShell)
        return
      }

      if (jsonMode) {
        outputSuccess({ shell: validShell, script })
        return
      }

      process.stdout.write(script)
    })
}
