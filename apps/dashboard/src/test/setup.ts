import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

// Use a separate test database
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://agentver:local@localhost:5434/agentver_test'

// Set required env vars for platform validation
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ?? 'test-secret-minimum-thirty-two-characters-long'
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'

// OAuth provider env vars for connections tests
process.env.GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? 'test-github-client-id'
process.env.GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? 'test-github-client-secret'
process.env.GITLAB_CLIENT_ID = process.env.GITLAB_CLIENT_ID ?? 'test-gitlab-client-id'
process.env.GITLAB_CLIENT_SECRET = process.env.GITLAB_CLIENT_SECRET ?? 'test-gitlab-client-secret'
process.env.BITBUCKET_CLIENT_ID = process.env.BITBUCKET_CLIENT_ID ?? 'test-bitbucket-client-id'
process.env.BITBUCKET_CLIENT_SECRET =
  process.env.BITBUCKET_CLIENT_SECRET ?? 'test-bitbucket-client-secret'
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'test-google-client-id'
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? 'test-google-client-secret'
process.env.MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID ?? 'test-microsoft-client-id'
process.env.MICROSOFT_CLIENT_SECRET =
  process.env.MICROSOFT_CLIENT_SECRET ?? 'test-microsoft-client-secret'

// Push schema before tests run (run from database package directory)
// Use the prisma binary directly — bunx may not be on PATH in child processes
const rootDir = new URL('../../../../', import.meta.url).pathname
const prismaBin = resolve(rootDir, 'node_modules/.bin/prisma')
execSync(`${prismaBin} db push`, {
  stdio: 'inherit',
  cwd: `${rootDir}packages/database`,
  env: { ...process.env },
})
