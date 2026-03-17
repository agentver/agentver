import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { initTRPC, TRPCError } from '@trpc/server'
import superjson from 'superjson'
import { ZodError } from 'zod'
import { getSession } from '@/lib/auth/session'
import '@/lib/env'

const logger = createLogger('trpc')

export type Context = {
  user: {
    id: string
    email: string
    name?: string | null
    image?: string | null
  } | null
  headers: Headers
}

export type AuthenticatedUser = {
  id: string
  email: string
  name?: string | null
  image?: string | null
}

export async function createTRPCContext(opts: { headers: Headers }): Promise<Context> {
  const session = await getSession()

  if (!session?.user) {
    return { user: null, headers: opts.headers }
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, image: true },
  })

  if (!dbUser) {
    logger.warn('Session user not found in database', { userId: session.user.id })
    return { user: null, headers: opts.headers }
  }

  return {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      image: dbUser.image,
    },
    headers: opts.headers,
  }
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.code === 'BAD_REQUEST' && error.cause instanceof ZodError
            ? error.cause.flatten()
            : null,
      },
    }
  },
})

export const createCallerFactory = t.createCallerFactory
export const router = t.router

const CLIENT_ERROR_CODES = new Set([
  'PARSE_ERROR',
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'TOO_MANY_REQUESTS',
])

const SLOW_REQUEST_MS = 1000

const loggingMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const start = performance.now()
  const userId = ctx.user?.id ?? 'anon'

  try {
    const result = await next({ ctx })
    const durationMs = Math.round(performance.now() - start)

    if (durationMs > SLOW_REQUEST_MS) {
      logger.warn(`Slow ${type}: ${path}`, { userId, durationMs })
    } else if (type === 'mutation') {
      logger.info(`${path}`, { userId, durationMs })
    } else {
      logger.debug(`${path}`, { userId, durationMs })
    }

    return result
  } catch (error) {
    const durationMs = Math.round(performance.now() - start)

    if (error instanceof TRPCError && CLIENT_ERROR_CODES.has(error.code)) {
      logger.warn(`${path} → ${error.code}`, { userId, durationMs })
    } else {
      logger.error(`${path} failed`, {
        userId,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    throw error
  }
})

const baseProcedure = t.procedure.use(loggingMiddleware)

export const publicProcedure = baseProcedure

export const protectedProcedure = baseProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action',
    })
  }

  const user: AuthenticatedUser = {
    id: ctx.user.id,
    email: ctx.user.email,
    name: ctx.user.name,
    image: ctx.user.image,
  }

  return next({
    ctx: { user, headers: ctx.headers },
  })
})
