import 'server-only'
import { headers } from 'next/headers'
import { createCallerFactory } from './init'
import { appRouter } from './router'

const createCaller = createCallerFactory(appRouter)

export async function createServerCaller() {
  return createCaller({
    user: null,
    headers: await headers(),
  })
}
