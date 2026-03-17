'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@agentver/ui/components/avatar'
import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { ChevronRight, ExternalLink } from 'lucide-react'
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

type SourceCardProps = {
  provider: {
    id: 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'GOOGLE' | 'MICROSOFT'
    name: string
    description: string
    logo: string
    sourceType: 'git' | 'file'
  }
  account: ConnectedAccountInfo | undefined
  isLoading: boolean
  onBrowse: () => void
}

export function SourceCard({ provider, account, isLoading, onBrowse }: SourceCardProps) {
  const isConnected = !!account

  return (
    <div
      className={`rounded-2xl border border-border p-6 transition-all hover:-translate-y-0.5 hover:shadow-lg ${
        isConnected ? 'border-l-4 border-l-green-500' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <Image
              src={provider.logo}
              alt={provider.name}
              width={28}
              height={28}
              className={`size-7${provider.id === 'GITHUB' ? 'dark:invert' : ''}`}
            />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="font-display font-semibold text-lg tracking-tight">{provider.name}</h3>
              <Badge variant="secondary" className="text-xs">
                {provider.sourceType === 'git' ? 'Git' : 'Files'}
              </Badge>
            </div>
            <p className="mt-0.5 text-muted-foreground text-sm">{provider.description}</p>
          </div>
        </div>
        <div className="shrink-0">
          {isLoading ? (
            <div className="h-6 w-20 animate-pulse rounded bg-muted" />
          ) : isConnected ? (
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-green-500" />
              <span className="font-medium text-green-600 text-sm dark:text-green-400">
                Connected
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted-foreground/40" />
              <span className="text-muted-foreground text-sm">Not connected</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-9 w-28 animate-pulse rounded bg-muted" />
          </div>
        ) : isConnected && account ? (
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
            <Button variant="cta" size="sm" onClick={onBrowse}>
              Browse repositories
              <ChevronRight className="ml-1 size-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              Connect your {provider.name} account to browse and import packages.
            </p>
            <Button variant="outline" asChild>
              <Link href="/settings/connections">
                <ExternalLink className="mr-2 size-3" />
                Connect
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
