import { createLogger } from '@agentver/shared'
import { getRedis } from './client'

const logger = createLogger('redis:rate-limiter')

type RateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: Date
}

/**
 * Sliding-window rate limiter backed by Redis sorted sets.
 *
 * Algorithm:
 * 1. Remove entries older than the window
 * 2. Count entries in the current window
 * 3. If under limit, add the current timestamp
 * 4. Return result
 *
 * Gracefully allows all requests when Redis is unavailable.
 */
export async function checkRedisRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const client = getRedis()

  // No Redis = allow everything
  if (!client) {
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(Date.now() + windowSeconds * 1000),
    }
  }

  const now = Date.now()
  const windowStart = now - windowSeconds * 1000
  const redisKey = `agentver:ratelimit:${key}`

  try {
    const pipeline = client.pipeline()

    // Remove entries outside the sliding window
    pipeline.zremrangebyscore(redisKey, '-inf', windowStart)
    // Count entries in the current window
    pipeline.zcard(redisKey)

    const results = await pipeline.exec()
    if (!results) {
      return {
        allowed: true,
        remaining: limit,
        resetAt: new Date(now + windowSeconds * 1000),
      }
    }

    const count = (results[1]?.[1] as number) ?? 0

    if (count >= limit) {
      // Over limit — find when the oldest entry in the window expires
      const oldest = await client.zrange(redisKey, 0, 0, 'WITHSCORES')
      const oldestTimestamp = oldest[1] ? Number(oldest[1]) : now
      const resetAt = new Date(oldestTimestamp + windowSeconds * 1000)

      return { allowed: false, remaining: 0, resetAt }
    }

    // Under limit — add this request
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`
    const addPipeline = client.pipeline()
    addPipeline.zadd(redisKey, now, member)
    addPipeline.expire(redisKey, windowSeconds + 1)
    await addPipeline.exec()

    return {
      allowed: true,
      remaining: limit - count - 1,
      resetAt: new Date(now + windowSeconds * 1000),
    }
  } catch (error) {
    logger.warn('Redis rate limit check failed, allowing request', {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      allowed: true,
      remaining: limit,
      resetAt: new Date(now + windowSeconds * 1000),
    }
  }
}

export type { RateLimitResult }
