'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
import { Check, ClipboardCopy, GitBranch, GitCommit, Tag } from 'lucide-react'
import { use, useState } from 'react'
import { trpc } from '@/trpc/client'
import { SkillHeader } from '../_components/skill-header'
import { SkillPageSkeleton } from '../_components/skill-page-skeleton'
import { SkillTabs } from '../_components/skill-tabs'

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function VersionsPage({
  params,
}: {
  params: Promise<{ org: string; name: string }>
}) {
  const { org, name } = use(params)
  const { data: pkg, isLoading: pkgLoading } = trpc.skills.getBySlug.useQuery({ org, name })

  const {
    data: versions,
    isLoading: versionsLoading,
    error: versionsError,
  } = trpc.git.getSkillVersions.useQuery({ org, name })

  if (pkgLoading) {
    return <SkillPageSkeleton />
  }

  if (!pkg) {
    return <div className="py-16 text-center text-muted-foreground">Package not found</div>
  }

  const latestVersionId = pkg.versions[0]?.id ?? null

  return (
    <div className="space-y-6">
      <SkillHeader pkg={pkg} org={org} name={name} />
      <SkillTabs org={org} name={name} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Published Versions</CardTitle>
          <p className="text-muted-foreground text-sm">
            Each version is created from a Git commit. Install a specific version using the version
            tag.
          </p>
        </CardHeader>
        <CardContent>
          {versionsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : versionsError ? (
            <div className="py-8 text-center text-muted-foreground">
              <p>Unable to load versions.</p>
              <p className="mt-1 text-xs">Please try again later.</p>
            </div>
          ) : !versions || versions.length === 0 ? (
            <div className="py-12 text-center">
              <Tag className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-display font-medium">No versions yet</p>
              <p className="mt-1 text-muted-foreground text-sm">
                Versions are created when content is saved or published.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((version) => (
                <VersionEntry
                  key={version.id}
                  version={version}
                  org={org}
                  name={name}
                  isLatest={version.id === latestVersionId}
                  gitRepoUrl={pkg.gitRepoUrl}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function VersionEntry({
  version,
  org,
  name,
  isLatest,
  gitRepoUrl,
}: {
  version: {
    id: string
    version: string
    changelog: string | null
    createdAt: Date | string
    gitRef: string | null
    gitCommitSha: string | null
  }
  org: string
  name: string
  isLatest: boolean
  gitRepoUrl: string | null
}) {
  const [copied, setCopied] = useState(false)

  const installCommand = `agentver install @${org}/${name}@v${version.version}`
  const commitUrl =
    gitRepoUrl && version.gitCommitSha ? `${gitRepoUrl}/commit/${version.gitCommitSha}` : null

  const handleCopy = async () => {
    await navigator.clipboard.writeText(installCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-start justify-between rounded-lg border p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium font-mono">v{version.version}</span>
          {isLatest && <Badge className="bg-emerald-100 text-emerald-800">latest</Badge>}
          {version.gitRef && (
            <Badge variant="outline" className="font-mono text-xs">
              <GitBranch className="mr-1 size-3" />
              {version.gitRef}
            </Badge>
          )}
        </div>

        {version.changelog && <p className="text-muted-foreground text-sm">{version.changelog}</p>}

        {version.gitCommitSha && (
          <div className="flex items-center gap-1 text-muted-foreground text-xs">
            <GitCommit className="size-3" />
            {commitUrl ? (
              <a
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono hover:text-primary hover:underline"
              >
                {version.gitCommitSha.slice(0, 7)}
              </a>
            ) : (
              <span className="font-mono">{version.gitCommitSha.slice(0, 7)}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-muted-foreground text-xs">{formatDate(version.createdAt)}</span>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? (
            <Check className="mr-1 size-3.5 text-emerald-500" />
          ) : (
            <ClipboardCopy className="mr-1 size-3.5" />
          )}
          {copied ? 'Copied' : 'Install'}
        </Button>
      </div>
    </div>
  )
}
