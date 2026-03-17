import { createLogger } from '@agentver/shared'
import Redis from 'ioredis'

const logger = createLogger('redis')

let redis: Redis | null = null

/**
 * Returns a singleton Redis client, or null if REDIS_URL is not configured.
 * Gracefully degrades — the platform works without Redis.
 */
export function getRedis(): Redis | null {
  if (redis) return redis

  const url = process.env.REDIS_URL
  if (!url) return null

  redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    lazyConnect: true,
  })

  redis.on('error', (err: Error) => {
    logger.error('Redis connection error', { message: err.message })
  })

  return redis
}
