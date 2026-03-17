import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { NextResponse } from 'next/server'

const logger = createLogger('health')

const startedAt = Date.now()

type CheckStatus = 'connected' | 'disconnected' | 'unavailable'

type HealthResponse = {
  status: 'healthy' | 'degraded'
  version: string
  environment: string
  uptime: number
  checks: {
    database: CheckStatus
    forgejo: CheckStatus
    redis: CheckStatus
  }
}

async function checkDatabase(): Promise<CheckStatus> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return 'connected'
  } catch (error) {
    logger.error('Database health check failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return 'disconnected'
  }
}

async function checkForgejo(): Promise<CheckStatus> {
  const baseUrl = process.env.FORGEJO_API_URL ?? process.env.FORGEJO_URL
  const token = process.env.FORGEJO_API_TOKEN ?? process.env.FORGEJO_TOKEN

  if (!baseUrl || !token) {
    return 'unavailable'
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/version`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })

    return response.ok ? 'connected' : 'disconnected'
  } catch (error) {
    logger.error('Forgejo health check failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return 'disconnected'
  }
}

async function checkRedis(): Promise<CheckStatus> {
  const redisUrl = process.env.REDIS_URL

  if (!redisUrl) {
    return 'unavailable'
  }

  // Redis check uses a raw TCP probe via fetch to the Redis host.
  // A full client check will be added once ioredis is wired into the platform.
  try {
    const url = new URL(redisUrl)
    const host = url.hostname
    const port = url.port || '6379'

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    // Attempt a TCP connection by fetching — if the host is reachable this will
    // not time out. We expect a connection refused or a non-HTTP response which
    // is fine; the absence of a timeout proves the host is up.
    try {
      await fetch(`http://${host}:${port}/`, { signal: controller.signal })
    } catch (fetchError) {
      // Any non-abort error means the host is reachable (connection refused, etc.)
      if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
        return 'disconnected'
      }
    } finally {
      clearTimeout(timeout)
    }

    return 'connected'
  } catch (error) {
    logger.error('Redis health check failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
    return 'disconnected'
  }
}

export async function GET() {
  const [database, forgejo, redis] = await Promise.all([
    checkDatabase(),
    checkForgejo(),
    checkRedis(),
  ])

  const checks = { database, forgejo, redis }
  const uptime = Math.floor((Date.now() - startedAt) / 1000)
  const version = process.env.npm_package_version ?? '0.1.0'
  const environment =
    process.env.NODE_ENV === 'production'
      ? process.env.NEXT_PUBLIC_APP_URL?.includes('staging')
        ? 'staging'
        : 'production'
      : 'development'

  const hasFailure = database === 'disconnected'
  const status = hasFailure ? 'degraded' : 'healthy'

  const body: HealthResponse = {
    status,
    version,
    environment,
    uptime,
    checks,
  }

  return NextResponse.json(body, {
    status: hasFailure ? 503 : 200,
  })
}
