import { useCallback, useEffect, useState } from 'react'
import { type AuthData, getAuthData, loginWithAPIKey, logout as performLogout } from '../lib/auth'

export type { AuthData } from '../lib/auth'

type AuthState = {
  user: AuthData['user'] | null
  isAuthenticated: boolean
  isLoading: boolean
  platformUrl: string | null
  error: string | null
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    platformUrl: null,
    error: null,
  })

  // Check for existing auth on mount
  useEffect(() => {
    async function checkAuth() {
      try {
        const data = await getAuthData()
        if (data?.token || data?.apiKey) {
          setState({
            user: data.user ?? null,
            isAuthenticated: true,
            isLoading: false,
            platformUrl: data.platformUrl ?? null,
            error: null,
          })
        } else {
          setState((prev) => ({ ...prev, isLoading: false }))
        }
      } catch {
        setState((prev) => ({ ...prev, isLoading: false }))
      }
    }
    checkAuth()
  }, [])

  const signInWithAPIKey = useCallback(async (apiKey: string, platformUrl?: string) => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))
    try {
      const data = await loginWithAPIKey(apiKey, platformUrl)
      setState({
        user: data.user ?? null,
        isAuthenticated: true,
        isLoading: false,
        platformUrl: data.platformUrl ?? null,
        error: null,
      })
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Authentication failed',
      }))
      throw err
    }
  }, [])

  const signOut = useCallback(async () => {
    await performLogout()
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      platformUrl: null,
      error: null,
    })
  }, [])

  return { ...state, signInWithAPIKey, signOut }
}
