import chalk from 'chalk'
import type { Command } from 'commander'
import ora from 'ora'
import { registryFetch } from '../registry/client'
import { isConnected } from '../registry/config'
import { type SkillsShResult, searchSkillsSh, toGitInstallSource } from '../registry/skills-sh'
import { fetchWellKnownIndex } from '../wellknown/index.js'
import type { WellKnownIndexEntry } from '../wellknown/types.js'

type PlatformSearchOrganisation = {
  slug: string
  name: string
}

type PlatformSearchCategory = {
  id: string
  name: string
  slug: string
  icon: string | null
}

type PlatformSearchResult = {
  id: string
  name: string
  slug: string
  description: string | null
  type: string
  tags: string[]
  compatibilityAgents: string[]
  starCount: number
  installCount: number
  organisation: PlatformSearchOrganisation
  categories: PlatformSearchCategory[]
}

type PlatformSearchResponse = {
  results: PlatformSearchResult[]
  total: number
  limit: number
  offset: number
}

type SearchSource = 'platform' | 'community' | 'well-known' | 'all'

function formatInstallCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`
  }
  return String(count)
}

function renderPlatformResults(results: PlatformSearchResult[], total: number): void {
  if (results.length === 0) return

  process.stdout.write(chalk.bold(`\nPlatform results (${total}):\n\n`))

  for (const result of results) {
    const desc = result.description ? chalk.dim(` — ${result.description}`) : ''
    const stars = result.starCount > 0 ? chalk.yellow(` ★ ${result.starCount}`) : ''
    const installs =
      result.installCount > 0 ? chalk.cyan(` ↓ ${formatInstallCount(result.installCount)}`) : ''
    const cats =
      result.categories.length > 0
        ? chalk.dim(` [${result.categories.map((c) => c.name).join(', ')}]`)
        : ''

    process.stdout.write(`  ${chalk.green(result.slug)}${stars}${installs}${cats}${desc}\n`)
  }

  process.stdout.write('\n')
}

function renderCommunityResults(results: SkillsShResult[]): void {
  if (results.length === 0) return

  process.stdout.write(chalk.bold(`\nSkills from skills.sh:\n\n`))

  for (const result of results) {
    const nameCol = chalk.green(result.name)
    const sourceCol = chalk.dim(`(${result.source})`)
    const installCol = chalk.cyan(`↓ ${formatInstallCount(result.installCount)}`)

    process.stdout.write(`  ${nameCol} ${sourceCol}  ${installCol}\n`)

    if (result.description) {
      process.stdout.write(`    ${chalk.dim(result.description)}\n`)
    }

    process.stdout.write('\n')
  }

  process.stdout.write(
    chalk.dim('  Install with: ') +
      chalk.white('agentver install github.com/{source}/{name}') +
      '\n\n'
  )
}

function renderWellKnownResults(hostname: string, skills: WellKnownIndexEntry[]): void {
  if (skills.length === 0) return

  process.stdout.write(chalk.bold(`\nSkills from ${hostname}:\n\n`))

  for (const skill of skills) {
    process.stdout.write(`  ${chalk.green(skill.name)} ${chalk.dim(`— ${skill.description}`)}\n`)
    process.stdout.write(
      `    ${chalk.dim('Install:')} ${chalk.white(`agentver install ${hostname}/${skill.name}`)}\n`
    )
    process.stdout.write('\n')
  }
}

function renderNoResults(query: string): void {
  process.stdout.write(chalk.dim(`No results for "${query}"\n`))
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('Search for skills across registries')
    .option('--type <type>', 'Filter by type (skill, agent, plugin, script, prompt)')
    .option('--category <category>', 'Filter by category slug (e.g. testing, devops)')
    .option(
      '--source <source>',
      'Search source: platform, community (skills.sh), well-known (domain), or all'
    )
    .action(
      async (query: string, options: { type?: string; category?: string; source?: string }) => {
        const connected = await isConnected()

        const requestedSource = (options.source as SearchSource | undefined) ?? undefined
        let source: SearchSource

        if (requestedSource) {
          if (!['platform', 'community', 'well-known', 'all'].includes(requestedSource)) {
            process.stderr.write(
              chalk.red(
                `Invalid source "${requestedSource}". Use: platform, community, well-known, or all\n`
              )
            )
            process.exit(1)
          }
          source = requestedSource as SearchSource

          if (source === 'platform' && !connected) {
            process.stderr.write(
              chalk.red('Not connected to a platform. Run `agentver login <url>` to connect.\n')
            )
            process.exit(1)
          }
        } else {
          source = connected ? 'platform' : 'community'
        }

        // Well-known search is a separate flow — query is treated as a domain name
        if (source === 'well-known') {
          const spinner = ora(`Fetching skills from ${query}...`).start()

          try {
            const baseUrl = query.startsWith('https://') ? query : `https://${query}`
            const hostname = new URL(baseUrl).hostname
            const index = await fetchWellKnownIndex(baseUrl)

            spinner.stop()

            renderWellKnownResults(hostname, index.skills)
          } catch (error) {
            spinner.fail(
              `Well-known search failed: ${error instanceof Error ? error.message : String(error)}`
            )
            process.exit(1)
          }
          return
        }

        const spinner = ora('Searching...').start()

        try {
          let platformResults: PlatformSearchResult[] = []
          let platformTotal = 0
          let communityResults: SkillsShResult[] = []

          const searchPlatform = source === 'platform' || source === 'all'
          const searchCommunity = source === 'community' || source === 'all'

          const promises: Promise<void>[] = []

          if (searchPlatform && connected) {
            promises.push(
              (async () => {
                const params = new URLSearchParams({ q: query })
                if (options.type) params.set('type', options.type.toUpperCase())
                if (options.category) params.set('category', options.category)

                const data = await registryFetch<PlatformSearchResponse>(
                  `/search?${params.toString()}`
                )
                platformResults = data.results
                platformTotal = data.total
              })()
            )
          }

          if (searchCommunity) {
            promises.push(
              (async () => {
                communityResults = await searchSkillsSh(query, 10)
              })()
            )
          }

          await Promise.all(promises)

          spinner.stop()

          const hasResults = platformResults.length > 0 || communityResults.length > 0

          if (!hasResults) {
            renderNoResults(query)
            return
          }

          if (platformResults.length > 0) {
            renderPlatformResults(platformResults, platformTotal)
          }

          if (communityResults.length > 0) {
            renderCommunityResults(communityResults)
          }

          // Show install hint for community results
          if (communityResults.length > 0) {
            const example = communityResults[0]!
            process.stdout.write(
              chalk.dim('  Example: ') +
                chalk.white(`agentver install ${toGitInstallSource(example)}`) +
                '\n'
            )
          }
        } catch (error) {
          spinner.fail(`Search failed: ${error instanceof Error ? error.message : String(error)}`)
          process.exit(1)
        }
      }
    )
}
