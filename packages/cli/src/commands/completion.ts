import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import type { Command, Option } from 'commander'
import { isJSONMode, outputError, outputSuccess } from '../output'

type CompletionOptions = {
  install?: boolean
}

type Shell = 'bash' | 'zsh' | 'fish'

type CompletionMetadata = {
  topLevelCommands: string[]
  subcommands: Record<string, string[]>
  commandFlags: Record<string, string[]>
  nestedCommandFlags: Record<string, string[]>
}

const FALLBACK_COMPLETION_METADATA: CompletionMetadata = {
  topLevelCommands: [
    'adopt',
    'agents',
    'audit',
    'completion',
    'config',
    'deprecate',
    'detect',
    'diff',
    'doctor',
    'draft',
    'info',
    'init',
    'install',
    'list',
    'migrate',
    'log',
    'login',
    'logout',
    'pin',
    'proposals',
    'propose',
    'publish',
    'remove',
    'save',
    'scan',
    'search',
    'self-update',
    'status',
    'suggest',
    'suggestions',
    'sync',
    'unpin',
    'unpublish',
    'update',
    'upgrade',
    'validate',
    'verify',
    'version',
    'versions',
    'whoami',
  ],
  subcommands: {
    completion: ['bash', 'fish', 'zsh'],
    config: ['get', 'list', 'path', 'set', 'unset'],
    draft: ['create', 'discard', 'list', 'publish', 'switch'],
    version: ['create', 'list'],
  },
  commandFlags: {
    completion: ['--help', '--install'],
  },
  nestedCommandFlags: {},
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

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function getCommandNames(command: Command): string[] {
  return uniqueSorted([command.name(), ...command.aliases()])
}

function getLongFlags(options: readonly Option[]): string[] {
  return uniqueSorted(
    options
      .map((option) => option.long)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  )
}

function buildCompletionMetadata(program: Command): CompletionMetadata {
  const rootFlags = getLongFlags(program.options)
  const topLevelCommands: string[] = []
  const subcommands: Record<string, string[]> = {}
  const commandFlags: Record<string, string[]> = {}
  const nestedCommandFlags: Record<string, string[]> = {}

  for (const command of program.commands) {
    const names = getCommandNames(command)
    const ownFlags = uniqueSorted([...rootFlags, ...getLongFlags(command.options)])

    topLevelCommands.push(...names)
    for (const name of names) {
      commandFlags[name] = ownFlags
    }

    if (command.commands.length === 0) {
      continue
    }

    const nestedNames = uniqueSorted(
      command.commands.flatMap((subcommand) => getCommandNames(subcommand))
    )
    for (const name of names) {
      subcommands[name] = nestedNames
    }

    for (const subcommand of command.commands) {
      const subcommandNames = getCommandNames(subcommand)
      const nestedFlags = uniqueSorted([...ownFlags, ...getLongFlags(subcommand.options)])

      for (const name of names) {
        for (const subcommandName of subcommandNames) {
          nestedCommandFlags[`${name}:${subcommandName}`] = nestedFlags
        }
      }
    }
  }

  return {
    topLevelCommands: uniqueSorted(topLevelCommands),
    subcommands,
    commandFlags,
    nestedCommandFlags,
  }
}

function getCompletionMetadata(program: Command): CompletionMetadata {
  const metadata = buildCompletionMetadata(program)
  return metadata.topLevelCommands.length > 1 ? metadata : FALLBACK_COMPLETION_METADATA
}

function renderBashCaseStatements(entries: Record<string, string[]>): string {
  return Object.entries(entries)
    .map(([key, values]) => {
      if (values.length === 0) {
        return `      ${key})\n        return 0\n        ;;`
      }
      return `      ${key})\n        COMPREPLY=( $(compgen -W "${values.join(' ')}" -- "$cur") )\n        return 0\n        ;;`
    })
    .join('\n')
}

function generateBashScript(metadata: CompletionMetadata): string {
  const subcommandCases = renderBashCaseStatements(metadata.subcommands)
  const nestedFlagCases = renderBashCaseStatements(metadata.nestedCommandFlags)
  const flagCases = renderBashCaseStatements(metadata.commandFlags)

  return `# agentver bash completion
_agentver() {
  local cur prev command subcommand commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  command="\${COMP_WORDS[1]}"
  subcommand="\${COMP_WORDS[2]}"
  commands="${metadata.topLevelCommands.join(' ')}"

  if [[ "$COMP_CWORD" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return 0
  fi

  if [[ "$cur" == -* ]]; then
    case "$command:$subcommand" in
${nestedFlagCases}
    esac

    case "$command" in
${flagCases}
    esac

    return 0
  fi

  case "$prev" in
${subcommandCases}
  esac

  return 0
}

complete -F _agentver agentver
`
}

function zshValues(values: string[]): string {
  return values.map((value) => `'${value}'`).join(' ')
}

function generateZshScript(metadata: CompletionMetadata): string {
  const commandCases = Object.entries(metadata.subcommands)
    .map(
      ([command, subcommands]) =>
        `    ${command})\n      _values 'subcommand' ${zshValues(subcommands)}\n      return\n      ;;`
    )
    .join('\n')

  const nestedFlagCases = Object.entries(metadata.nestedCommandFlags)
    .map(
      ([key, flags]) =>
        `    ${key})\n      _values 'flag' ${zshValues(flags)}\n      return\n      ;;`
    )
    .join('\n')

  const flagCases = Object.entries(metadata.commandFlags)
    .map(
      ([command, flags]) =>
        `    ${command})\n      _values 'flag' ${zshValues(flags)}\n      return\n      ;;`
    )
    .join('\n')

  return `# agentver zsh completion
_agentver() {
  local curcontext="$curcontext" state line

  _arguments -C \
    '1:command:(${metadata.topLevelCommands.map((command) => `'${command}'`).join(' ')})' \
    '2:subcommand:->subcommand' \
    '*::arg:->args'

  case "$state" in
    subcommand)
      case "$words[2]" in
${commandCases}
      esac
      ;;
    args)
      if [[ "$words[CURRENT]" == -* ]]; then
        case "$words[2]:$words[3]" in
${nestedFlagCases}
        esac

        case "$words[2]" in
${flagCases}
        esac
      fi
      ;;
  esac
}

compdef _agentver agentver
`
}

function generateFishScript(metadata: CompletionMetadata): string {
  const topLevelCompletions = metadata.topLevelCommands
    .map((command) => `complete -c agentver -n '__fish_use_subcommand' -a '${command}'`)
    .join('\n')

  const subcommandCompletions = Object.entries(metadata.subcommands)
    .flatMap(([command, subcommands]) =>
      subcommands.map(
        (subcommand) =>
          `complete -c agentver -n '__fish_seen_subcommand_from ${command}' -a '${subcommand}'`
      )
    )
    .join('\n')

  const flagCompletions = Object.entries(metadata.commandFlags)
    .flatMap(([command, flags]) =>
      flags.map((flag) => {
        const longFlag = flag.replace(/^--/, '')
        return `complete -c agentver -n '__fish_seen_subcommand_from ${command}' -l '${longFlag}'`
      })
    )
    .join('\n')

  return `# agentver fish completion
${topLevelCompletions}
${subcommandCompletions}
${flagCompletions}
`
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
          return
        }
        process.stderr.write(
          chalk.red(`Unsupported shell "${shell}". Supported: bash, zsh, fish\n`)
        )
        process.exit(1)
        return
      }

      const validShell = shell as Shell
      const metadata = getCompletionMetadata(program)
      const script =
        validShell === 'bash'
          ? generateBashScript(metadata)
          : validShell === 'zsh'
            ? generateZshScript(metadata)
            : generateFishScript(metadata)

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
