'use client'

import { Button } from '@agentver/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@agentver/ui/components/card'
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  GitBranch,
  GitCompareArrows,
  Link as LinkIcon,
  Plug,
  Settings2,
} from 'lucide-react'
import Link from 'next/link'
import { Suspense, useState } from 'react'
import { FadeIn } from '@/components/fade-in'
import { BitbucketImportFlow } from '@/components/import/bitbucket-import-flow'
import { GitHubImportFlow } from '@/components/import/github-import-flow'
import { GitLabImportFlow } from '@/components/import/gitlab-import-flow'
import { GoogleDriveImportFlow } from '@/components/import/google-drive-import-flow'
import { OneDriveImportFlow } from '@/components/import/onedrive-import-flow'
import { SourceCard } from '@/components/sources/source-card'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import { useOrgContext } from '@/hooks/use-org-context'
import { trpc } from '@/trpc/client'

type ProviderId = 'GITHUB' | 'GITLAB' | 'BITBUCKET' | 'GOOGLE' | 'MICROSOFT'

type ProviderConfig = {
  id: ProviderId
  name: string
  description: string
  logo: string
  sourceType: 'git' | 'file'
  importKey: string
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'GITHUB',
    name: 'GitHub',
    description: 'Import skills and agent configurations from your GitHub repositories.',
    logo: '/images/integrations/github.svg',
    sourceType: 'git',
    importKey: 'github',
  },
  {
    id: 'GITLAB',
    name: 'GitLab',
    description: 'Import skills and agent configurations from your GitLab projects.',
    logo: '/images/integrations/gitlab.svg',
    sourceType: 'git',
    importKey: 'gitlab',
  },
  {
    id: 'BITBUCKET',
    name: 'Bitbucket',
    description: 'Import skills and agent configurations from your Bitbucket repositories.',
    logo: '/images/integrations/bitbucket.svg',
    sourceType: 'git',
    importKey: 'bitbucket',
  },
  {
    id: 'GOOGLE',
    name: 'Google Drive',
    description: 'Import skills and documents from your Google Drive.',
    logo: '/images/integrations/google-drive.png',
    sourceType: 'file',
    importKey: 'google-drive',
  },
  {
    id: 'MICROSOFT',
    name: 'OneDrive',
    description: 'Import skills and documents from your Microsoft OneDrive.',
    logo: '/images/integrations/microsoft-onedrive.png',
    sourceType: 'file',
    importKey: 'onedrive',
  },
]

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
}

const IMPORT_MODES = [
  {
    icon: Copy,
    label: 'Copy',
    description: 'Duplicates files into your workspace. Changes won\u2019t sync from the source.',
  },
  {
    icon: GitCompareArrows,
    label: 'Mirror',
    description: 'Syncs automatically when the source is updated. Read-only.',
  },
  {
    icon: LinkIcon,
    label: 'Link',
    description: 'References files without copying. Requires the source to remain accessible.',
  },
]

function ImportModesHelp() {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <h3 className="font-display font-semibold text-base tracking-tight">Import modes</h3>
        <HelpTooltip content="Choose how imported skills relate to their source. You can change this per import." />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {IMPORT_MODES.map((mode) => {
          const Icon = mode.icon
          return (
            <div key={mode.label} className="flex items-start gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-4 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-sm">{mode.label}</p>
                <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
                  {mode.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Plug className="size-7" />
      </div>
      <h2 className="mt-6 font-display font-semibold text-xl tracking-tight">Connect a source</h2>
      <p className="mt-2 max-w-md text-muted-foreground">
        Link your GitHub, GitLab, or cloud storage account to import existing skills and
        configurations.
      </p>
      <Button className="mt-6" asChild>
        <Link href="/settings/connections">
          <Settings2 className="mr-2 size-4" />
          Go to Connections
        </Link>
      </Button>
    </div>
  )
}

function SourcesContent() {
  const { selectedOrg, isLoading: isOrgLoading } = useOrgContext()

  const [browsingSource, setBrowsingSource] = useState<string | null>(null)

  const accounts = trpc.connections.list.useQuery()

  const skillsRepoStatus = trpc.organisations.getSkillsRepoStatus.useQuery(
    { organisationId: selectedOrg?.id ?? '' },
    { enabled: !!selectedOrg?.id }
  )

  const hasSkillsRepo = skillsRepoStatus.data?.connected ?? false

  const getAccountForProvider = (providerId: ProviderId) => {
    return accounts.data?.find((a) => a.provider === providerId)
  }

  const hasAnyConnection = accounts.data?.some((a) => PROVIDERS.some((p) => p.id === a.provider))

  if (browsingSource) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setBrowsingSource(null)}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h2 className="font-display font-semibold text-3xl tracking-tight">
              Import from {PROVIDER_LABELS[browsingSource] ?? browsingSource}
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Browse and import skills and configurations into your registry.
            </p>
          </div>
        </div>

        {!hasSkillsRepo && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardContent className="flex items-center gap-3 pt-6">
              <AlertTriangle className="size-5 shrink-0 text-amber-500" />
              <div className="flex-1">
                <p className="font-medium text-sm">No skills repository connected</p>
                <p className="text-muted-foreground text-sm">
                  Copy and Mirror modes require a connected skills repository. You can still use
                  Link mode to reference files without copying them.
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/organisation">Connect Repository</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {browsingSource === 'github' ? (
          <GitHubImportFlow />
        ) : browsingSource === 'gitlab' ? (
          <GitLabImportFlow />
        ) : browsingSource === 'bitbucket' ? (
          <BitbucketImportFlow />
        ) : browsingSource === 'google-drive' ? (
          <GoogleDriveImportFlow />
        ) : browsingSource === 'onedrive' ? (
          <OneDriveImportFlow />
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <FadeIn>
        <div className="page-header">
          <h1 className="page-title">Sources</h1>
          <p className="page-description">
            Connect your code repositories and cloud storage to import existing skills and
            configurations.
          </p>
        </div>
      </FadeIn>

      {!isOrgLoading && !hasSkillsRepo && (
        <FadeIn delay={100}>
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardHeader>
              <div className="flex items-start gap-3">
                <GitBranch className="mt-0.5 size-5 shrink-0 text-amber-500" />
                <div className="flex-1">
                  <CardTitle className="text-base">Connect a Skills Repository</CardTitle>
                  <CardDescription>
                    To import skills with Copy or Mirror mode, your organisation needs a connected
                    GitHub repository. This is where imported skills are committed and versioned.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/settings/organisation">
                  <Settings2 className="mr-2 size-4" />
                  Go to Organisation Settings
                </Link>
              </Button>
            </CardContent>
          </Card>
        </FadeIn>
      )}

      {!accounts.isLoading && !hasAnyConnection ? (
        <FadeIn delay={200}>
          <EmptyState />
        </FadeIn>
      ) : (
        <FadeIn delay={200}>
          <div className="grid gap-4">
            {PROVIDERS.map((provider, index) => (
              <FadeIn key={provider.id} delay={250 + index * 75}>
                <SourceCard
                  provider={provider}
                  account={getAccountForProvider(provider.id)}
                  isLoading={accounts.isLoading}
                  onBrowse={() => setBrowsingSource(provider.importKey)}
                />
              </FadeIn>
            ))}
          </div>
        </FadeIn>
      )}

      <FadeIn delay={600}>
        <ImportModesHelp />
      </FadeIn>
    </div>
  )
}

export default function SourcesPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-8">
          <div className="page-header">
            <h1 className="page-title">Sources</h1>
            <p className="page-description">
              Connect your code repositories and cloud storage to import existing skills and
              configurations.
            </p>
          </div>
          <div className="grid gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-6">
                <div className="flex items-start gap-4">
                  <div className="size-12 animate-pulse rounded-xl bg-muted" />
                  <div className="flex-1">
                    <div className="h-6 w-32 animate-pulse rounded bg-muted" />
                    <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted" />
                  </div>
                </div>
                <div className="mt-5 h-9 w-28 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      }
    >
      <SourcesContent />
    </Suspense>
  )
}
