import { vi } from 'vitest'

export function mockAuth(userId: string, email = 'test@example.com') {
  vi.mock('@/lib/auth/session', () => ({
    getSession: vi.fn().mockResolvedValue({
      user: { id: userId, email, name: 'Test User', image: null },
      session: { id: 'test-session', userId, expiresAt: new Date(Date.now() + 86400000) },
    }),
    getUser: vi.fn().mockResolvedValue({
      id: userId,
      email,
      name: 'Test User',
      image: null,
    }),
  }))
}

export function mockUnauthenticated() {
  vi.mock('@/lib/auth/session', () => ({
    getSession: vi.fn().mockResolvedValue(null),
    getUser: vi.fn().mockResolvedValue(null),
  }))
}
