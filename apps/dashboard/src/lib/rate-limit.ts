import { createLogger } from '@agentver/shared'
import { getRedis } from './redis/client'

const logger = createLogger('rate-limit')

type RateLimitConfig = {
  windowMs: number
  maxRequests: number
}

type RateLimitResult = {
  allowed: boolean
  remaining: number
  resetMs: number
}

// ── In-memory fallback ──────────────────────────────────────────────

type RateLimitEntry = {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

let cleanupInterval: ReturnType<typeof setInterval> | null = null

function startCleanup(windowMs: number): void {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs)
      if (entry.timestamps.length === 0) {
        store.delete(key)
      }
    }
  }, 60_000)
  if (cleanupInterval.unref) {
    cleanupInterval.unref()
  }
}

function checkInMemoryRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  startCleanup(config.windowMs)

  const now = Date.now()
  const entry = store.get(key) ?? { timestamps: [] }

  entry.timestamps = entry.timestamps.filter((t) => now - t < config.windowMs)

  if (entry.timestamps.length >= config.maxRequests) {
    const oldestInWindow = entry.timestamps[0] ?? now
    const resetMs = oldestInWindow + config.windowMs - now

    return { allowed: false, remaining: 0, resetMs }
  }

  entry.timestamps.push(now)
  store.set(key, entry)

  return {
    allowed: true,
    remaining: config.maxRequests - entry.timestamps.length,
    resetMs: config.windowMs,
  }
}

// ── Redis-backed rate limiting (fixed window with INCR + EXPIRE) ────

async function checkRedisRateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const redis = getRedis()
  if (!redis) {
    return checkInMemoryRateLimit(key, config)
  }

  const windowSeconds = Math.ceil(config.windowMs / 1000)
  const windowKey = `agentver:ratelimit:${key}:${Math.floor(Date.now() / config.windowMs)}`

  try {
    const count = await redis.incr(windowKey)
    if (count === 1) {
      await redis.expire(windowKey, windowSeconds)
    }

    const resetAt = (Math.floor(Date.now() / config.windowMs) + 1) * config.windowMs

    return {
      allowed: count <= config.maxRequests,
      remaining: Math.max(0, config.maxRequests - count),
      resetMs: resetAt - Date.now(),
    }
  } catch (error) {
    logger.warn('Redis rate limit check failed, falling back to in-memory', {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
    return checkInMemoryRateLimit(key, config)
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function checkRateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  return checkRedisRateLimit(key, config)
}

export const RATE_LIMITS = {
  authToken: { windowMs: 60_000, maxRequests: 20 },
  skillsRead: { windowMs: 60_000, maxRequests: 100 },
  skillsWrite: { windowMs: 60_000, maxRequests: 30 },
  webhook: { windowMs: 60_000, maxRequests: 60 },
  default: { windowMs: 60_000, maxRequests: 60 },
} as const

export type { RateLimitConfig, RateLimitResult }
