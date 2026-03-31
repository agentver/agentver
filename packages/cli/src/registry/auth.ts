import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { createCliLogger } from '../utils.js'

const logger = createCliLogger('auth')

const credentialsSchema = z
  .object({
    token: z.string().trim().min(1).optional(),
    apiKey: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.token ?? value.apiKey), {
    message: 'Credentials must include a non-empty token or API key.',
  })

export type Credentials = z.infer<typeof credentialsSchema>

function getAgentverDir(): string {
  return join(homedir(), '.agentver')
}

function getCredentialsPath(): string {
  return join(getAgentverDir(), 'credentials.json')
}

function ensureAgentverDir(): void {
  const dir = getAgentverDir()
  mkdirSync(dir, { recursive: true, mode: 0o700 })

  try {
    chmodSync(dir, 0o700)
  } catch (error) {
    logger.debug(`Could not update permissions for ${dir}: ${String(error)}`)
  }
}

function normaliseCredentials(input: unknown): Credentials | null {
  const result = credentialsSchema.safeParse(input)
  if (!result.success) {
    return null
  }

  return result.data
}

function getEnvironmentCredentials(): Credentials | null {
  const token = process.env.AGENTVER_TOKEN?.trim()
  const apiKey = process.env.AGENTVER_API_KEY?.trim()

  return normaliseCredentials({
    ...(token ? { token } : {}),
    ...(apiKey ? { apiKey } : {}),
  })
}

export async function getCredentials(): Promise<Credentials | null> {
  const environmentCredentials = getEnvironmentCredentials()
  if (environmentCredentials) {
    return environmentCredentials
  }

  const credPath = getCredentialsPath()

  if (!existsSync(credPath)) {
    return null
  }

  const raw = readFileSync(credPath, 'utf-8')

  try {
    const parsed = JSON.parse(raw) as unknown
    const credentials = normaliseCredentials(parsed)
    if (!credentials) {
      logger.warn(
        `Credentials at ${credPath} are invalid. Re-authenticate with \`agentver login\`.`
      )
      return null
    }
    return credentials
  } catch {
    logger.warn(
      `Could not parse credentials at ${credPath}. Re-authenticate with \`agentver login\`.`
    )
    return null
  }
}

export function saveCredentials(credentials: Credentials): void {
  const validatedCredentials = normaliseCredentials(credentials)
  if (!validatedCredentials) {
    throw new Error('Credentials must include a non-empty token or API key.')
  }

  const credPath = getCredentialsPath()
  ensureAgentverDir()

  writeFileSync(credPath, JSON.stringify(validatedCredentials, null, 2), { mode: 0o600 })
}

export function clearCredentials(): void {
  const credPath = getCredentialsPath()
  try {
    unlinkSync(credPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const creds = await getCredentials()
  return !!(creds?.token ?? creds?.apiKey)
}
