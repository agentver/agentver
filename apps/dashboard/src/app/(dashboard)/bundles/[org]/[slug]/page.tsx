'use client'

import { type BundleManifest, bundleManifestSchema } from '@agentver/shared'
import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentver/ui/components/dialog'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { Separator } from '@agentver/ui/components/separator'
import { Textarea } from '@agentver/ui/components/textarea'
import { GitFork, Globe, Key, Lock, Monitor, Package, Rocket, Server, Terminal } from 'lucide-react'
import { use, useState } from 'react'
import { toast } from 'sonner'
import { PackageManagerTabs } from '@/components/ui/package-manager-tabs'
import { trpc } from '@/trpc/client'

function parseManifest(raw: unknown): BundleManifest | null {
  const result = bundleManifestSchema.safeParse(raw)
  return result.success ? result.data : null
}

function countManifestContents(manifest: BundleManifest) {
  let packageCount = 0
  let mcpServerCount = 0
  let credentialCount = 0

  if (manifest.includes) {
    for (const refs of Object.values(manifest.includes)) {
      packageCount += refs?.length ?? 0
    }
  }

  mcpServerCount = manifest.mcpServers?.length ?? 0
  credentialCount = manifest.credentials ? Object.keys(manifest.credentials).length : 0

  return { packageCount, mcpServerCount, credentialCount }
}

export default function BundleDetailPage({
  params,
}: {
  params: Promise<{ org: string; slug: string }>
}) {
  const { org, slug } = use(params)
  const { data: bundle, isLoading } = trpc.bundles.getBySlug.useQuery({ org, name: slug })

  const [publishDialogOpen, setPublishDialogOpen] = useState(false)
  const [publishVersion, setPublishVersion] = useState('')
  const [publishChangelog, setPublishChangelog] = useState('')

  const utils = trpc.useUtils()

  const publishMutation = trpc.bundles.publishVersion.useMutation({
    onSuccess: (version) => {
      toast.success(`Version ${version.version} published`)
      utils.bundles.getBySlug.invalidate({ org, name: slug })
      setPublishDialogOpen(false)
      setPublishVersion('')
      setPublishChangelog('')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 rounded bg-muted" />
        <div className="h-4 w-96 rounded bg-muted" />
        <div className="h-64 rounded bg-muted" />
      </div>
    )
  }

  if (!bundle) {
    return <div className="py-16 text-center text-muted-foreground">Bundle not found</div>
  }

  const latestVersion = bundle.versions[0]
  const manifest = latestVersion?.fileManifest ? parseManifest(latestVersion.fileManifest) : null
  const counts = manifest ? countManifestContents(manifest) : null

  const handlePublish = () => {
    if (!publishVersion.trim() || !manifest || !bundle) return

    publishMutation.mutate({
      packageId: bundle.id,
      version: publishVersion.trim(),
      manifest,
      changelog: publishChangelog.trim() || undefined,
    })
  }

  const installSlug = `${org}/${slug}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-display font-semibold text-2xl tracking-tight">{bundle.name}</h2>
            <Badge
              variant={bundle.visibility === 'PUBLIC' ? 'secondary' : 'outline'}
              className="text-xs"
            >
              {bundle.visibility === 'PUBLIC' ? (
                <Globe className="mr-1 h-3 w-3" />
              ) : (
                <Lock className="mr-1 h-3 w-3" />
              )}
              {bundle.visibility.toLowerCase()}
            </Badge>
          </div>
          <p className="text-muted-foreground">{org}</p>
          {bundle.description && (
            <p className="mt-2 max-w-2xl text-muted-foreground text-sm">{bundle.description}</p>
          )}
        </div>
        <Button onClick={() => setPublishDialogOpen(true)}>
          <Rocket className="h-4 w-4" />
          Publish Version
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Install instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Install</CardTitle>
              <p className="text-muted-foreground text-sm">
                Install this bundle with the Agentver CLI.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <PackageManagerTabs
                packageName="agentver"
                global
                description="Step 1: Install the CLI (if you haven't already)"
              />
              <PackageManagerTabs
                packageName={`agentver install --bundle ${installSlug}`}
                customCommands={{
                  bun: `agentver install --bundle ${installSlug}`,
                  npm: `agentver install --bundle ${installSlug}`,
                  pnpm: `agentver install --bundle ${installSlug}`,
                  yarn: `agentver install --bundle ${installSlug}`,
                }}
                description="Step 2: Install this bundle"
              />
            </CardContent>
          </Card>

          {/* Included packages */}
          {manifest?.includes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Package className="h-4 w-4" />
                  Included Packages
                </CardTitle>
              </CardHeader>
              <CardContent>
                {Object.entries(manifest.includes).map(([category, refs]) => {
                  if (!refs?.length) return null
                  return (
                    <div key={category} className="mb-4 last:mb-0">
                      <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                        {category}
                      </p>
                      <div className="space-y-2">
                        {refs.map((ref) => (
                          <div
                            key={ref.name}
                            className="flex items-center justify-between rounded-lg border p-3"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{ref.name}</span>
                              {ref.version && (
                                <Badge variant="outline" className="font-mono text-xs">
                                  v{ref.version}
                                </Badge>
                              )}
                            </div>
                            {ref.optional && (
                              <Badge variant="secondary" className="text-xs">
                                optional
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {!Object.values(manifest.includes).some((refs) => refs && refs.length > 0) && (
                  <p className="text-muted-foreground text-sm">No packages included.</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* MCP servers */}
          {manifest?.mcpServers && manifest.mcpServers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Server className="h-4 w-4" />
                  MCP Servers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {manifest.mcpServers.map((server) => (
                  <div key={server.name} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{server.name}</span>
                      <Badge variant="outline" className="font-mono text-xs">
                        {server.transport}
                      </Badge>
                    </div>
                    {server.description && (
                      <p className="mt-1 text-muted-foreground text-sm">{server.description}</p>
                    )}
                    {server.command && (
                      <p className="mt-2 font-mono text-muted-foreground text-xs">
                        {server.command} {server.args?.join(' ')}
                      </p>
                    )}
                    {server.url && (
                      <p className="mt-2 font-mono text-muted-foreground text-xs">{server.url}</p>
                    )}
                    {server.credentials && server.credentials.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {server.credentials.map((cred) => (
                          <Badge key={cred.key} variant="secondary" className="text-xs">
                            <Key className="mr-1 h-3 w-3" />
                            {cred.key}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Credential requirements */}
          {manifest?.credentials && Object.keys(manifest.credentials).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Key className="h-4 w-4" />
                  Credential Requirements
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(manifest.credentials).map(([key, cred]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <span className="font-medium font-mono text-sm">{key}</span>
                      <p className="text-muted-foreground text-xs">{cred.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {cred.sharing}
                      </Badge>
                      {cred.required && (
                        <Badge variant="destructive" className="text-xs">
                          required
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {latestVersion && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Version</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    v{latestVersion.version}
                  </Badge>
                </div>
              )}

              <div className="flex justify-between">
                <span className="text-muted-foreground">Installations</span>
                <span className="flex items-center gap-1">
                  <Monitor className="h-3 w-3" /> {bundle._count.installationReports}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Forks</span>
                <span className="flex items-center gap-1">
                  <GitFork className="h-3 w-3" /> {bundle._count.forks}
                </span>
              </div>

              {counts && (
                <>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Packages</span>
                    <span className="flex items-center gap-1">
                      <Package className="h-3 w-3" /> {counts.packageCount}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">MCP Servers</span>
                    <span className="flex items-center gap-1">
                      <Server className="h-3 w-3" /> {counts.mcpServerCount}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Credentials</span>
                    <span className="flex items-center gap-1">
                      <Key className="h-3 w-3" /> {counts.credentialCount}
                    </span>
                  </div>
                </>
              )}

              {bundle.author && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Author</span>
                    <div className="flex items-center gap-2">
                      {bundle.author.image && (
                        <img src={bundle.author.image} alt="" className="size-5 rounded-full" />
                      )}
                      <span className="text-xs">{bundle.author.name ?? 'Unknown'}</span>
                    </div>
                  </div>
                </>
              )}

              {manifest?.extends && (
                <>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Extends</span>
                    <span className="font-mono text-xs">{manifest.extends}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Version history */}
          {bundle.versions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Version History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {bundle.versions.map((version) => (
                  <div key={version.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="font-mono text-xs">
                        v{version.version}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {new Date(version.createdAt).toLocaleDateString('en-GB')}
                      </span>
                    </div>
                    {version.changelog && (
                      <p className="text-muted-foreground text-xs">{version.changelog}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* CLI command card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Terminal className="h-4 w-4" />
                Quick Install
              </CardTitle>
            </CardHeader>
            <CardContent>
              <code className="block rounded-lg bg-muted p-3 font-mono text-xs">
                agentver install --bundle {installSlug}
              </code>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Publish Version Dialog */}
      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish New Version</DialogTitle>
            <DialogDescription>
              Publish a new version of the &quot;{bundle.name}&quot; bundle. The current manifest
              will be used.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="publish-version">Version</Label>
              <Input
                id="publish-version"
                placeholder="1.0.0"
                value={publishVersion}
                onChange={(e) => setPublishVersion(e.currentTarget.value)}
              />
              <p className="text-muted-foreground text-xs">Must be valid semver (e.g. 1.2.3)</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="publish-changelog">Changelog</Label>
              <Textarea
                id="publish-changelog"
                placeholder="What changed in this version?"
                value={publishChangelog}
                onChange={(e) => setPublishChangelog(e.currentTarget.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handlePublish}
              disabled={!publishVersion.trim() || !manifest || publishMutation.isPending}
            >
              {publishMutation.isPending ? 'Publishing...' : 'Publish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
