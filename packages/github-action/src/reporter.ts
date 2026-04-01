import * as core from '@actions/core'

export type InstallResult = {
  packageKey?: string
  name: string
  version: string
  agents: string[]
  fileCount: number
  success: boolean
  error?: string
}

export type InstallSummary = {
  results: InstallResult[]
  totalInstalled: number
  totalFailed: number
  allAgents: string[]
}

export function buildSummary(results: InstallResult[]): InstallSummary {
  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)
  const allAgents = [...new Set(successful.flatMap((r) => r.agents))]

  return {
    results,
    totalInstalled: successful.length,
    totalFailed: failed.length,
    allAgents,
  }
}

export function setOutputs(summary: InstallSummary): void {
  const installedNames = summary.results.filter((r) => r.success).map((r) => r.name)

  core.setOutput('installed-count', String(summary.totalInstalled))
  core.setOutput('installed-skills', JSON.stringify(installedNames))
  core.setOutput('agents-configured', summary.allAgents.join(','))
}

export async function generateJobSummary(summary: InstallSummary): Promise<void> {
  const lines: string[] = []

  lines.push('## Agentver Skill Installation')
  lines.push('')

  if (summary.totalInstalled > 0) {
    lines.push(`**${summary.totalInstalled}** skill(s) installed successfully.`)
  }
  if (summary.totalFailed > 0) {
    lines.push(`**${summary.totalFailed}** skill(s) failed to install.`)
  }
  lines.push('')

  if (summary.allAgents.length > 0) {
    lines.push(`**Agents configured:** ${summary.allAgents.join(', ')}`)
    lines.push('')
  }

  lines.push('| Skill | Version | Agents | Files | Status |')
  lines.push('|-------|---------|--------|-------|--------|')

  for (const result of summary.results) {
    const status = result.success ? 'Installed' : `Failed: ${result.error ?? 'Unknown'}`
    const agents = result.agents.join(', ') || '-'
    lines.push(
      `| ${result.name} | ${result.version} | ${agents} | ${result.fileCount} | ${status} |`
    )
  }

  lines.push('')

  await core.summary.addRaw(lines.join('\n')).write()
}
