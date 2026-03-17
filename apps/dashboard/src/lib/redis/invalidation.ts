import { createLogger } from '@agentver/shared'
import { cacheDelete, cacheDeletePattern } from './cache'

const logger = createLogger('redis:invalidation')

/**
 * Invalidate caches when a skill/package is created or updated.
 */
export async function invalidateOnSkillWrite(org: string, name: string): Promise<void> {
  try {
    await Promise.all([
      cacheDelete(`agentver:pkg:${org}:${name}`),
      cacheDeletePattern('agentver:search:*'),
    ])
  } catch (error) {
    logger.warn('Failed to invalidate caches on skill write', {
      org,
      name,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Invalidate caches when a new version is published.
 */
export async function invalidateOnVersionPublish(org: string, name: string): Promise<void> {
  try {
    await Promise.all([
      cacheDelete(`agentver:pkg:${org}:${name}`),
      cacheDeletePattern('agentver:trending:*'),
    ])
  } catch (error) {
    logger.warn('Failed to invalidate caches on version publish', {
      org,
      name,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Invalidate caches when a package is starred or unstarred.
 */
export async function invalidateOnStarChange(org: string, name: string): Promise<void> {
  try {
    await Promise.all([
      cacheDelete(`agentver:pkg:${org}:${name}`),
      cacheDeletePattern('agentver:trending:*'),
    ])
  } catch (error) {
    logger.warn('Failed to invalidate caches on star change', {
      org,
      name,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
