import { createLogger } from '@agentver/shared'
import { getRedis } from '../redis/client'

const logger = createLogger('api-key-rate-limit')

type ApiKeyRateLimitResult = {
  allowed: boolean
  remaining: number
  resetMs: number
}

// ── In-memory fallback ──────────────────────────────────────────────

type RateLimitWindow = {
  count: number
  resetAt: number
}

const keyLimits = new Map<string, RateLimitWindow>()

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, window] of keyLimits) {
      if (now >= window.resetAt) {
        keyLimits.delete(key)
      }
    }
  }, 60_000)
  if (cleanupTimer.unref) {
    cleanupTimer.unref()
  }
}

function checkInMemoryApiKeyRateLimit(keyHash: string, maxRequests: number): ApiKeyRateLimitResult {
  startCleanup()

  const now = Date.now()
  const windowMs = 60_000

  let window = keyLimits.get(keyHash)

  if (!window || now >= window.resetAt) {
    window = { count: 0, resetAt: now + windowMs }
    keyLimits.set(keyHash, window)
  }

  if (window.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: window.resetAt - now,
    }
  }

  window.count++

  return {
    allowed: true,
    remaining: maxRequests - window.count,
    resetMs: window.resetAt - now,
  }
}

// ── Redis-backed rate limiting (fixed window with INCR + EXPIRE) ────

const WINDOW_SECONDS = 60

async function checkRedisApiKeyRateLimit(
  keyHash: string,
  maxRequests: number
): Promise<ApiKeyRateLimitResult> {
  const redis = getRedis()
  if (!redis) {
    return checkInMemoryApiKeyRateLimit(keyHash, maxRequests)
  }

  const windowMs = WINDOW_SECONDS * 1000
  const windowKey = `agentver:keylimit:${keyHash}:${Math.floor(Date.now() / windowMs)}`

  try {
    const count = await redis.incr(windowKey)
    if (count === 1) {
      await redis.expire(windowKey, WINDOW_SECONDS)
    }

    const resetAt = (Math.floor(Date.now() / windowMs) + 1) * windowMs

    return {
      allowed: count <= maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetMs: resetAt - Date.now(),
    }
  } catch (error) {
    logger.warn('Redis API key rate limit check failed, falling back to in-memory', {
      keyHash: keyHash.slice(0, 8),
      error: error instanceof Error ? error.message : String(error),
    })
    return checkInMemoryApiKeyRateLimit(keyHash, maxRequests)
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function checkApiKeyRateLimit(
  keyHash: string,
  maxRequests: number
): Promise<ApiKeyRateLimitResult> {
  return checkRedisApiKeyRateLimit(keyHash, maxRequests)
}

export type { ApiKeyRateLimitResult }
