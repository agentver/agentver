'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
import { Separator } from '@agentver/ui/components/separator'
import { ExternalLink, GitBranch, GitFork, Monitor } from 'lucide-react'
import { use } from 'react'
import { MarkdownPreview } from '@/components/editor/markdown-preview'
import { UpstreamStatus } from '@/components/fork/upstream-status'
import { trpc } from '@/trpc/client'
import { SkillHeader } from './_components/skill-header'
import { SkillPageSkeleton } from './_components/skill-page-skeleton'
import { SkillTabs } from './_components/skill-tabs'
import { useCanManage } from './_components/use-can-manage'

function buildGitViewUrl(
  gitRepoUrl: string | null | undefined,
  gitPath: string | null | undefined,
  ref?: string | null
): string | null {
  if (!gitRepoUrl) return null
  if (gitPath) return `${gitRepoUrl}/tree/${ref ?? 'HEAD'}/${gitPath}`
  return gitRepoUrl
}

export default function SkillDetailPage({
  params,
}: {
  params: Promise<{ org: string; name: string }>
}) {
  const { org, name } = use(params)
  const { data: pkg, isLoading } = trpc.skills.getBySlug.useQuery({ org, name })
  const canManage = useCanManage(org, pkg?.authorId)

  if (isLoading) {
    return <SkillPageSkeleton />
  }

  if (!pkg) {
    return <div className="py-16 text-center text-muted-foreground">Package not found</div>
  }

  const gitViewUrl = buildGitViewUrl(pkg.gitRepoUrl, pkg.gitPath, pkg.gitDefaultRef)
  const licence = pkg.readme ? extractLicence(pkg.readme) : null

  return (
    <div className="space-y-6">
      <SkillHeader pkg={pkg} org={org} name={name} canManage={canManage} />
      <SkillTabs org={org} name={name} canManage={canManage} />

      {pkg.forkedFrom && <UpstreamStatus packageId={pkg.id} forkedFrom={pkg.forkedFrom} />}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content — rendered SKILL.md */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">SKILL.md</CardTitle>
                {gitViewUrl && (
                  <a
                    href={gitViewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary text-sm hover:underline"
                  >
                    <ExternalLink className="size-3.5" />
                    View source
                  </a>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {pkg.readme ? (
                <MarkdownPreview content={pkg.readme} />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <GitBranch className="size-8 text-muted-foreground" />
                  <p className="mt-3 text-muted-foreground text-sm">Content is managed in Git.</p>
                  {gitViewUrl && (
                    <a
                      href={gitViewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-primary text-sm hover:underline"
                    >
                      <ExternalLink className="size-3.5" />
                      View on Git
                    </a>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar — metadata */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Installations</span>
                <span className="flex items-center gap-1">
                  <Monitor className="h-3 w-3" /> {pkg._count.installationReports}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Forks</span>
                <span className="flex items-center gap-1">
                  <GitFork className="h-3 w-3" /> {pkg._count.forks}
                </span>
              </div>

              {licence && (
                <>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Licence</span>
                    <span className="font-mono text-xs">{licence}</span>
                  </div>
                </>
              )}

              {pkg.gitUri && (
                <>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Git Source</span>
                    <span className="max-w-[200px] truncate font-mono text-xs">{pkg.gitUri}</span>
                  </div>
                  {pkg.gitPath && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Path</span>
                      <span className="font-mono text-xs">{pkg.gitPath}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Default Ref</span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {pkg.gitDefaultRef}
                    </Badge>
                  </div>
                </>
              )}

              {pkg.author && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Author</span>
                    <div className="flex items-center gap-2">
                      {pkg.author.image && (
                        <img src={pkg.author.image} alt="" className="size-5 rounded-full" />
                      )}
                      <span className="text-xs">{pkg.author.name ?? 'Unknown'}</span>
                    </div>
                  </div>
                </>
              )}

              {pkg.tags.length > 0 && (
                <>
                  <Separator />
                  <div className="flex flex-wrap gap-1">
                    {pkg.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/**
 * Extract licence from SKILL.md frontmatter (simple YAML parse for this field).
 */
function extractLicence(readme: string): string | null {
  const match = readme.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null

  const yamlBlock = match[1] ?? ''
  const licenceMatch = yamlBlock.match(/^license:\s*(.+)$/m)
  return licenceMatch?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null
}
