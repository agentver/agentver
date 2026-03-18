import { createAuthClient } from 'better-auth/react'

export const authClient: ReturnType<typeof createAuthClient> = createAuthClient()

export const { useSession, signIn, signUp, signOut, requestPasswordReset, resetPassword } =
  authClient
