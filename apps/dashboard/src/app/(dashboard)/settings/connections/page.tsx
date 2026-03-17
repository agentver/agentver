'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ConnectionCard } from '@/components/settings/connection-card'
import { trpc } from '@/trpc/client'

const PROVIDERS = [
  {
    id: 'GITHUB' as const,
    name: 'GitHub',
    description: 'Connect to browse repositories and import packages.',
    logo: '/images/integrations/github.svg',
    sourceType: 'git' as const,
    comingSoon: false,
  },
  {
    id: 'GITLAB' as const,
    name: 'GitLab',
    description: 'Connect to browse projects and import packages.',
    logo: '/images/integrations/gitlab.svg',
    sourceType: 'git' as const,
    comingSoon: true,
  },
  {
    id: 'BITBUCKET' as const,
    name: 'Bitbucket',
    description: 'Connect to browse repositories and import packages.',
    logo: '/images/integrations/bitbucket.svg',
    sourceType: 'git' as const,
    comingSoon: true,
  },
  {
    id: 'GOOGLE' as const,
    name: 'Google Drive',
    description: 'Connect to browse and import files from Google Drive.',
    logo: '/images/integrations/google-drive.png',
    sourceType: 'file' as const,
    comingSoon: true,
  },
  {
    id: 'MICROSOFT' as const,
    name: 'OneDrive',
    description: 'Connect to browse and import files from OneDrive.',
    logo: '/images/integrations/microsoft-onedrive.png',
    sourceType: 'file' as const,
    comingSoon: true,
  },
]

type ProviderKey = (typeof PROVIDERS)[number]['id']

type ValidationState = Record<ProviderKey, { valid: boolean; error?: string } | null>

export default function ConnectionsPage() {
  const [validationState, setValidationState] = useState<ValidationState>({
    GITHUB: null,
    GITLAB: null,
    BITBUCKET: null,
    GOOGLE: null,
    MICROSOFT: null,
  })

  const connectionsQuery = trpc.connections.list.useQuery()
  const utils = trpc.useUtils()

  const connectMutation = trpc.connections.connect.useMutation({
    onSuccess: (data, variables) => {
      const cookieName = `${variables.provider.toLowerCase()}_oauth_state`
      // biome-ignore lint/suspicious/noDocumentCookie: OAuth state must be set as a cookie for the callback to verify
      document.cookie = `${cookieName}=${data.state}; path=/; max-age=600; samesite=lax`
      window.location.href = data.url
    },
    onError: (error) => toast.error(error.message),
  })

  const disconnectMutation = trpc.connections.disconnect.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(`${variables.provider} account disconnected`)
      setValidationState((prev) => ({ ...prev, [variables.provider]: null }))
      void utils.connections.list.invalidate()
    },
    onError: (error) => toast.error(error.message),
  })

  const validateMutation = trpc.connections.validateToken.useMutation({
    onSuccess: (data, variables) => {
      setValidationState((prev) => ({ ...prev, [variables.provider]: data }))
      if (data.valid) {
        toast.success(`${variables.provider} token is valid`)
      } else {
        toast.warning(`${variables.provider} token is invalid — please reconnect`)
      }
    },
    onError: (error) => toast.error(error.message),
  })

  const accountsByProvider = new Map(
    (connectionsQuery.data ?? []).map((account) => [account.provider, account])
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Connected Accounts</h1>
        <p className="text-muted-foreground">
          Manage your connected accounts for browsing and importing packages from external sources.
        </p>
      </div>

      <div className="space-y-4">
        {PROVIDERS.map((provider) => (
          <ConnectionCard
            key={provider.id}
            provider={provider}
            account={accountsByProvider.get(provider.id)}
            isLoading={connectionsQuery.isLoading}
            isConnecting={
              connectMutation.isPending && connectMutation.variables?.provider === provider.id
            }
            isDisconnecting={
              disconnectMutation.isPending && disconnectMutation.variables?.provider === provider.id
            }
            isValidating={
              validateMutation.isPending && validateMutation.variables?.provider === provider.id
            }
            validationStatus={validationState[provider.id]}
            onConnect={() => connectMutation.mutate({ provider: provider.id })}
            onDisconnect={() => disconnectMutation.mutate({ provider: provider.id })}
            onValidate={() => validateMutation.mutate({ provider: provider.id })}
          />
        ))}
      </div>
    </div>
  )
}
