import { createLogger } from '@agentver/shared'
import { getRedis } from './client'

const logger = createLogger('redis:cache')

const DEFAULT_TTL_SECONDS = 300

/**
 * Retrieve a cached value by key. Returns null on miss or if Redis is unavailable.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedis()
  if (!client) return null

  try {
    const raw = await client.get(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch (error) {
    logger.warn('Cache get failed', {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Store a value in the cache with an optional TTL (defaults to 300s).
 * No-op if Redis is unavailable.
 */
export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  const client = getRedis()
  if (!client) return

  try {
    const serialised = JSON.stringify(value)
    await client.set(key, serialised, 'EX', ttlSeconds)
  } catch (error) {
    logger.warn('Cache set failed', {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Delete a single cache key. No-op if Redis is unavailable.
 */
export async function cacheDelete(key: string): Promise<void> {
  const client = getRedis()
  if (!client) return

  try {
    await client.del(key)
  } catch (error) {
    logger.warn('Cache delete failed', {
      key,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Delete all keys matching a glob pattern (e.g. "agentver:search:*").
 * Uses SCAN to avoid blocking Redis. No-op if Redis is unavailable.
 */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  const client = getRedis()
  if (!client) return

  try {
    let cursor = '0'
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await client.del(...keys)
      }
    } while (cursor !== '0')
  } catch (error) {
    logger.warn('Cache delete pattern failed', {
      pattern,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Cache-through helper: returns cached data if available,
 * otherwise calls the provided function, caches the result, and returns it.
 * Falls back to calling `fn` directly if Redis is unavailable.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  const cached = await cacheGet<T>(key)
  if (cached !== null) return cached

  const result = await fn()
  // Fire-and-forget — never block on caching
  cacheSet(key, result, ttlSeconds).catch(() => {})
  return result
}
