'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@agentver/ui/components/avatar'
import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@agentver/ui/components/card'
import { cn } from '@agentver/ui-utils'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Shield } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

type ConnectedAccountInfo = {
  id: string
  provider: string
  providerAccountId: string
  providerAccountName: string | null
  avatarUrl: string | null
  scopes: string[]
  connectedAt: Date
  updatedAt: Date
}

type TokenValidationStatus = {
  valid: boolean
  error?: string
} | null

type ProviderConfig = {
  id: 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'GOOGLE' | 'MICROSOFT'
  name: string
  description: string
  logo: string
  sourceType: 'git' | 'file'
  comingSoon?: boolean
}

type ConnectionCardProps = {
  provider: ProviderConfig
  account: ConnectedAccountInfo | undefined
  isLoading: boolean
  isConnecting: boolean
  isDisconnecting: boolean
  isValidating: boolean
  validationStatus: TokenValidationStatus
  onConnect: () => void
  onDisconnect: () => void
  onValidate: () => void
}

export function ConnectionCard({
  provider,
  account,
  isLoading,
  isConnecting,
  isDisconnecting,
  isValidating,
  validationStatus,
  onConnect,
  onDisconnect,
  onValidate,
}: ConnectionCardProps) {
  const isConnected = !!account
  const isTokenInvalid = validationStatus !== null && !validationStatus.valid

  return (
    <Card
      className={cn(isTokenInvalid && 'border-amber-500/50', provider.comingSoon && 'opacity-60')}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg bg-muted',
                provider.comingSoon && 'grayscale'
              )}
            >
              <Image
                src={provider.logo}
                alt={provider.name}
                width={24}
                height={24}
                className={cn('size-6', provider.id === 'GITHUB' && 'dark:invert')}
              />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                {provider.name}
                <Badge variant="secondary" className="text-xs">
                  {provider.sourceType === 'git' ? 'Git' : 'Files'}
                </Badge>
                {provider.comingSoon && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Coming soon
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>{provider.description}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {provider.comingSoon ? null : isLoading ? (
              <div className="h-6 w-20 animate-pulse rounded bg-muted" />
            ) : isConnected ? (
              <>
                {isTokenInvalid && (
                  <Badge
                    variant="outline"
                    className="border-amber-500 text-amber-600 dark:text-amber-400"
                  >
                    <AlertTriangle className="mr-1 size-3" />
                    Token expired
                  </Badge>
                )}
                {validationStatus?.valid && (
                  <Badge
                    variant="outline"
                    className="border-green-500 text-green-600 dark:text-green-400"
                  >
                    <CheckCircle2 className="mr-1 size-3" />
                    Valid
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className="border-green-500 text-green-600 dark:text-green-400"
                >
                  Connected
                </Badge>
              </>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Not connected
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {provider.comingSoon ? (
          <p className="text-muted-foreground text-sm">
            {provider.name} integration is not yet available. We&apos;re working on it.
          </p>
        ) : isLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-9 w-28 animate-pulse rounded bg-muted" />
          </div>
        ) : isConnected && account ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="size-8">
                  {account.avatarUrl && <AvatarImage src={account.avatarUrl} />}
                  <AvatarFallback>
                    {(account.providerAccountName ?? account.providerAccountId)
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-sm">
                    {account.providerAccountName ?? account.providerAccountId}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Connected{' '}
                    {new Date(account.connectedAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onValidate}
                  disabled={isValidating}
                  title="Validate token"
                >
                  {isValidating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Shield className="size-4" />
                  )}
                </Button>
                {isTokenInvalid ? (
                  <Button variant="outline" size="sm" onClick={onConnect} disabled={isConnecting}>
                    {isConnecting ? (
                      <>
                        <Loader2 className="mr-1 size-3 animate-spin" />
                        Reconnecting...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-1 size-3" />
                        Reconnect
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onDisconnect}
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? (
                      <>
                        <Loader2 className="mr-1 size-3 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      'Disconnect'
                    )}
                  </Button>
                )}
              </div>
            </div>

            {account.scopes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {account.scopes.map((scope) => (
                  <Badge key={scope} variant="secondary" className="font-normal text-xs">
                    {scope}
                  </Badge>
                ))}
              </div>
            )}

            {isTokenInvalid && validationStatus?.error && (
              <p className="text-amber-600 text-xs dark:text-amber-400">
                {validationStatus.error}. Please reconnect your account.
              </p>
            )}

            <div className="border-t pt-3">
              <Link
                href={`/sources?provider=${provider.id}`}
                className="inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
              >
                Go to Sources
                <ExternalLink className="size-3" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              Connect your {provider.name} account to browse and import packages.
            </p>
            <Button onClick={onConnect} disabled={isConnecting}>
              {isConnecting ? (
                <>
                  <Loader2 className="mr-1 size-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                `Connect ${provider.name}`
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
