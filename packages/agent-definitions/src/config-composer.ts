export type ComposableConfig = {
  packageName: string
  content: string
  sections?: string[]
  order: number
}

export type ComposedResult = {
  content: string
  sources: string[]
}

const SECTION_MARKER_PREFIX = '## From:'
const SECTION_MARKER_REGEX = /^## From: .+$/m
const SECTION_MARKER_REGEX_GLOBAL = /^## From: .+$/gm

/**
 * Compose multiple agent configs into a single layered config.
 * Lower order = base config, higher order = overlay.
 * Identical lines from base configs are removed when they also appear in an overlay.
 */
export function composeConfigs(configs: ComposableConfig[]): ComposedResult {
  if (configs.length === 0) {
    return { content: '', sources: [] }
  }

  if (configs.length === 1) {
    const config = configs[0]!
    return {
      content: `${SECTION_MARKER_PREFIX} ${config.packageName}\n\n${config.content.trim()}`,
      sources: [config.packageName],
    }
  }

  const sorted = [...configs].sort((a, b) => a.order - b.order)

  // Collect lines from each config, tracking which overlay lines should override base lines
  const overlayLines = new Set<string>()
  for (const config of sorted.slice(1)) {
    for (const line of config.content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length > 0) {
        overlayLines.add(trimmed)
      }
    }
  }

  const sections: string[] = []

  for (const config of sorted) {
    const isBase = config === sorted[0]
    let lines = config.content.split('\n')

    if (isBase) {
      // Remove lines from base that are duplicated in overlays
      lines = lines.filter((line) => {
        const trimmed = line.trim()
        if (trimmed.length === 0) return true
        return !overlayLines.has(trimmed)
      })
    }

    const body = lines.join('\n').trim()
    if (body.length > 0) {
      sections.push(`${SECTION_MARKER_PREFIX} ${config.packageName}\n\n${body}`)
    }
  }

  return {
    content: sections.join('\n\n'),
    sources: sorted.map((c) => c.packageName),
  }
}

/**
 * Check whether a config file was produced by composition (contains section markers).
 */
export function isComposedConfig(content: string): boolean {
  return SECTION_MARKER_REGEX.test(content)
}

/**
 * Parse an existing composed config back into its constituent sections.
 */
export function parseComposedSections(
  content: string
): Array<{ packageName: string; content: string }> {
  const parts = content.split(SECTION_MARKER_REGEX_GLOBAL)
  const markers = content.match(SECTION_MARKER_REGEX_GLOBAL) ?? []

  const sections: Array<{ packageName: string; content: string }> = []

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]!
    const packageName = marker.replace(`${SECTION_MARKER_PREFIX} `, '').trim()
    const body = (parts[i + 1] ?? '').trim()

    if (packageName && body.length > 0) {
      sections.push({ packageName, content: body })
    }
  }

  return sections
}
