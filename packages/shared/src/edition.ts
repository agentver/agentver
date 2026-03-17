export type Edition = 'community' | 'cloud' | 'enterprise'

export function getEdition(): Edition {
  if (process.env.AGENTVER_LICENCE_KEY) return 'enterprise'
  if (process.env.AGENTVER_CLOUD === 'true') return 'cloud'
  return 'community'
}

export function isCloud(): boolean {
  return getEdition() === 'cloud'
}

export function isCommunity(): boolean {
  return getEdition() === 'community'
}

export function isEnterprise(): boolean {
  return getEdition() === 'enterprise'
}
