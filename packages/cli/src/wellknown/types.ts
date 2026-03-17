export type WellKnownIndexEntry = {
  name: string
  description: string
  files: string[]
}

export type WellKnownIndex = {
  skills: WellKnownIndexEntry[]
}

export type WellKnownSource = {
  type: 'well-known'
  baseUrl: string
  hostname: string
  skillName: string
}

export type WellKnownFetchResult = {
  name: string
  description: string
  files: Array<{ path: string; content: string; size: number }>
  sourceUrl: string
  hostname: string
}
