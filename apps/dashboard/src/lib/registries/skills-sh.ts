import { z } from 'zod'

const SKILLS_SH_API = 'https://skills.sh/api/search'
const SKILLS_SH_TIMEOUT_MS = 5_000

const skillsShSkillSchema = z.object({
  id: z.string(),
  skillId: z.string(),
  name: z.string(),
  installs: z.number(),
  source: z.string(),
})

const skillsShResponseSchema = z.object({
  query: z.string(),
  searchType: z.string(),
  skills: z.array(skillsShSkillSchema),
  count: z.number(),
  duration_ms: z.number(),
})

export type SkillsShResult = {
  id: string
  name: string
  description: string
  installCount: number
  source: string
  url: string
}

function toResult(skill: z.infer<typeof skillsShSkillSchema>): SkillsShResult {
  return {
    id: skill.id,
    name: skill.name,
    description: '',
    installCount: skill.installs,
    source: skill.source,
    url: `https://skills.sh/${skill.id}`,
  }
}

export type SkillsShSearchResponse = {
  skills: SkillsShResult[]
  count: number
}

/**
 * Build the install-friendly git source from a skills.sh result.
 * Maps `owner/repo` + skill name to `github.com/{owner}/{repo}/{name}`.
 */
export function toGitInstallSource(result: SkillsShResult): string {
  return `github.com/${result.source}/${result.name}`
}

/**
 * Search the skills.sh public API.
 * Returns an empty result on any failure -- never throws.
 */
export async function searchSkillsSh(query: string, limit = 20): Promise<SkillsShSearchResponse> {
  const params = new URLSearchParams({ q: query })
  if (limit !== undefined) {
    params.set('limit', String(limit))
  }

  const url = `${SKILLS_SH_API}?${params.toString()}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SKILLS_SH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      next: { revalidate: 60 },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return { skills: [], count: 0 }
    }

    const raw: unknown = await response.json()
    const parsed = skillsShResponseSchema.safeParse(raw)

    if (!parsed.success) {
      return { skills: [], count: 0 }
    }

    return {
      skills: parsed.data.skills.map(toResult),
      count: parsed.data.count,
    }
  } catch {
    clearTimeout(timeoutId)
    return { skills: [], count: 0 }
  }
}
