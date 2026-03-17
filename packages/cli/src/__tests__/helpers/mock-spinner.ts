import { vi } from 'vitest'

/** Returns a no-op spinner stub with every method mocked via `vi.fn()`. */
export function createNoopSpinner(): Record<string, unknown> {
  return {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  }
}
