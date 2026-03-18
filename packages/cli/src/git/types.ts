export type GitHost = 'github.com' | 'gitlab.com' | 'bitbucket.org' | (string & {})

export type GitSource = {
  host: GitHost
  owner: string
  repo: string
  path: string
  ref: string
  commit?: string
}

export type ResolvedRef = {
  source: GitSource
  commitSha: string
}

export type FetchedFile = {
  path: string
  content: string
  size: number
}

export type FetchResult = {
  files: FetchedFile[]
  commitSha: string
  source: GitSource
}

export type FetchStrategy = 'api' | 'archive' | 'sparse-checkout' | 'clone'
