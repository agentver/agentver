'use client'

import { AlertTriangle, ExternalLink, LinkIcon } from 'lucide-react'
import Link from 'next/link'
import { use } from 'react'
import { toast } from 'sonner'
import { SkillEditor } from '@/components/editor/skill-editor'
import { trpc } from '@/trpc/client'

export default function SkillEditPage({
  params,
}: {
  params: Promise<{ org: string; name: string }>
}) {
  const { org, name } = use(params)
  const utils = trpc.useUtils()
  const { data: pkg, isLoading: pkgLoading } = trpc.skills.getBySlug.useQuery({ org, name })

  const { data: skillContent, isLoading: contentLoading } = trpc.skills.getSkillContent.useQuery(
    { packageId: pkg?.id ?? '' },
    { enabled: Boolean(pkg?.id) }
  )

  const { data: githubStatus } = trpc.connections.getStatus.useQuery({ provider: 'GITHUB' })

  const saveMutation = trpc.skills.saveSkillContent.useMutation({
    onSuccess: (result) => {
      toast.success('Committed to Git', {
        description: `v${result.version} — ${result.commitSha.slice(0, 7)}`,
        ...(result.commitUrl
          ? {
              action: {
                label: 'View commit',
                onClick: () => window.open(result.commitUrl!, '_blank'),
              },
            }
          : {}),
      })
      utils.skills.getBySlug.invalidate({ org, name })
      utils.skills.getSkillContent.invalidate({ packageId: pkg?.id ?? '' })
    },
    onError: (error) => {
      toast.error('Failed to save', { description: error.message })
    },
  })

  const isLoading = pkgLoading || contentLoading

  if (isLoading) {
    return <div className="h-screen animate-pulse bg-muted" />
  }

  if (!pkg) {
    return <div className="py-16 text-center text-muted-foreground">Package not found</div>
  }

  const isAgentverProvider = pkg.organisation.skillsRepoProvider === 'agentver'

  // No GitHub account connected — only gate when the org uses GitHub, not Agentver
  if (!githubStatus?.connected && !isAgentverProvider) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
          <LinkIcon className="size-5" />
        </div>
        <h3 className="mt-4 font-display font-semibold text-lg">GitHub account required</h3>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          Connect your GitHub account to edit skills. Changes are committed directly to your
          organisation&apos;s package repository.
        </p>
        <Link
          href="/settings"
          className="mt-4 inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
        >
          Go to Settings <ExternalLink className="size-3" />
        </Link>
      </div>
    )
  }

  // No skills repo connected for the org
  if (!pkg.organisation.skillsRepoOwner && !isAgentverProvider) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
          <AlertTriangle className="size-5" />
        </div>
        <h3 className="mt-4 font-display font-semibold text-lg">No package repository connected</h3>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          This organisation does not have a package repository configured. An admin needs to connect
          one in the organisation settings.
        </p>
        <Link
          href="/settings"
          className="mt-4 inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
        >
          Go to Settings <ExternalLink className="size-3" />
        </Link>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-5rem)]">
      <SkillEditor
        initialContent={skillContent?.content ?? pkg.readme ?? ''}
        initialName={pkg.name}
        initialDescription={pkg.description ?? ''}
        initialTags={pkg.tags}
        gitPath={skillContent?.gitPath ?? pkg.gitPath}
        contentSource={skillContent?.source}
        saving={saveMutation.isPending}
        readOnlyName
        onSave={(data) => {
          saveMutation.mutate({
            packageId: pkg.id,
            content: data.content,
            commitMessage: data.commitMessage,
            description: data.description,
            tags: data.tags,
          })
        }}
      />
    </div>
  )
}
