import { createCallerFactory } from '~/trpc/init'
import { appRouter } from '~/trpc/router'

const createCaller = createCallerFactory(appRouter)

export function createTestCaller(userId: string, overrides?: { email?: string; name?: string }) {
  return createCaller({
    user: {
      id: userId,
      email: overrides?.email ?? 'test@example.com',
      name: overrides?.name ?? 'Test User',
    },
    headers: new Headers(),
  })
}

export function createUnauthenticatedCaller() {
  return createCaller({
    user: null,
    headers: new Headers(),
  })
}

export type TestCaller = ReturnType<typeof createTestCaller>
