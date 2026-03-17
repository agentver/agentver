import type { AuthData } from './hooks/useAuth'

export type Page =
  | 'dashboard'
  | 'browse'
  | 'discover'
  | 'installed'
  | 'editor'
  | 'agents'
  | 'proposals'
  | 'settings'
  | 'login'

export type AuthProps = {
  user: AuthData['user'] | null
  isAuthenticated: boolean
  isLoading: boolean
  platformUrl: string | null
  error: string | null
  signInWithAPIKey: (apiKey: string, platformUrl?: string) => Promise<void>
  signOut: () => Promise<void>
}
