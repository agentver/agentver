'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@agentver/ui/components/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentver/ui/components/dialog'
import { Label } from '@agentver/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentver/ui/components/select'
import { Skeleton } from '@agentver/ui/components/skeleton'
import { cn } from '@agentver/ui-utils'
import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Plus,
} from 'lucide-react'
import Link from 'next/link'
import { use, useCallback, useState } from 'react'
import { toast } from 'sonner'
import { formatCount } from '@/components/install-badge'
import { trpc } from '@/trpc/client'

const TRANSPORT_COLOURS: Record<string, string> = {
  stdio: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  http: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  sse: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  npm: 'npm',
  git: 'Git',
  docker: 'Docker',
  url: 'URL',
}

function generateConfigSnippet(server: {
  name: string
  transport: string
  command: string | null
  args: string[]
  url: string | null
  sourceType: string
  sourcePackage: string | null
}): string {
  if (server.transport === 'stdio') {
    const cmd = server.command ?? 'npx'
    const args =
      server.args.length > 0
        ? server.args
        : server.sourcePackage
          ? ['-y', server.sourcePackage]
          : []

    return JSON.stringify(
      {
        mcpServers: {
          [server.name]: {
            command: cmd,
            args,
          },
        },
      },
      null,
      2
    )
  }

  return JSON.stringify(
    {
      mcpServers: {
        [server.name]: {
          url: server.url ?? `https://${server.name}.example.com/mcp`,
        },
      },
    },
    null,
    2
  )
}

type AddToSetupState = 'idle' | 'adding' | 'success' | 'error'

function AddToSetupDialog({
  serverName,
  serverDisplayName,
  open,
  onOpenChange,
  configSnippet,
}: {
  serverName: string
  serverDisplayName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  configSnippet: string
}) {
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [addState, setAddState] = useState<AddToSetupState>('idle')
  const [importedSlug, setImportedSlug] = useState<string | null>(null)

  const { data: orgs } = trpc.organisations.list.useQuery()
  const utils = trpc.useUtils()

  const addMutation = trpc.mcpCatalogue.addToOrg.useMutation({
    onSuccess: (result) => {
      setAddState('success')
      setImportedSlug(result.package.slug)
      utils.skills.list.invalidate()
      toast.success(`${serverDisplayName} added to your setup`)
    },
    onError: (error) => {
      setAddState('error')
      toast.error(error.message)
    },
  })

  const handleAdd = useCallback(() => {
    if (!selectedOrgId) return
    setAddState('adding')
    addMutation.mutate({
      organisationId: selectedOrgId,
      serverName,
    })
  }, [selectedOrgId, serverName, addMutation])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setAddState('idle')
        setImportedSlug(null)
        setSelectedOrgId('')
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add {serverDisplayName} to My Setup</DialogTitle>
          <DialogDescription>
            Save this MCP server configuration as a package in your organisation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {addState !== 'success' && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Organisation</Label>
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an organisation" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgs?.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name} ({org.slug})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(!orgs || orgs.length === 0) && (
                <p className="text-muted-foreground text-sm">
                  No organisations found. Create one first.
                </p>
              )}
            </div>
          )}

          {addState === 'success' && importedSlug && (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
              <div className="flex items-center gap-2 font-medium text-emerald-700 text-sm dark:text-emerald-300">
                <CheckCircle className="size-4" />
                MCP server added to your setup
              </div>
              <Button variant="outline" size="sm" asChild className="w-full">
                <Link href={`/skills/${importedSlug}`}>View package</Link>
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <Label>Configuration preview</Label>
            <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs">
              {configSnippet}
            </pre>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          {addState !== 'success' && (
            <Button onClick={handleAdd} disabled={!selectedOrgId || addState === 'adding'}>
              {addState === 'adding' ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="mr-2 size-4" />
                  Add to Setup
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function McpServerDetailContent({ name }: { name: string }) {
  const { data: server, isLoading, error } = trpc.mcpCatalogue.getByName.useQuery({ name })
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Skeleton className="h-64 rounded-2xl" />
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <Package className="size-5" />
        </div>
        <p className="mt-4 font-display font-semibold text-lg">Server not found</p>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          The MCP server &ldquo;{name}&rdquo; could not be found in the catalogue.
        </p>
        <Button variant="outline" asChild className="mt-6">
          <Link href="/mcp">Back to catalogue</Link>
        </Button>
      </div>
    )
  }

  if (!server) return null

  const configSnippet = generateConfigSnippet(server)

  function handleCopyConfig() {
    navigator.clipboard.writeText(configSnippet)
    toast.success('Configuration copied to clipboard')
  }

  const credentialSchema = server.credentialSchema as Record<string, unknown> | null
  const toolManifest = server.toolManifest as Array<{ name: string; description?: string }> | null

  return (
    <div className="space-y-6">
      <Link
        href="/mcp"
        className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to catalogue
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display font-semibold text-2xl tracking-tight">
              {server.displayName}
            </h2>
            {server.verified && (
              <span className="inline-flex items-center text-blue-500" aria-label="Verified">
                <BadgeCheck className="size-5" />
              </span>
            )}
          </div>
          <p className="mt-1 text-muted-foreground">
            by {server.author} &middot; {server.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            Add to My Setup
          </Button>
          <Badge
            className={cn(
              'font-medium',
              TRANSPORT_COLOURS[server.transport] ?? 'bg-secondary text-secondary-foreground'
            )}
          >
            {server.transport}
          </Badge>
          <Badge variant="outline">
            {SOURCE_TYPE_LABELS[server.sourceType] ?? server.sourceType}
          </Badge>
          <span className="flex items-center gap-1 text-muted-foreground text-sm">
            <Download className="size-3.5" /> {formatCount(server.installCount)}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{server.description}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Configuration</CardTitle>
                <Button variant="outline" size="sm" onClick={handleCopyConfig}>
                  <Copy className="mr-1.5 h-3 w-3" />
                  Copy
                </Button>
              </div>
              <CardDescription>
                Add this to your MCP client configuration to use this server.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-sm">
                {configSnippet}
              </pre>
            </CardContent>
          </Card>

          {toolManifest && toolManifest.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tools ({toolManifest.length})</CardTitle>
                <CardDescription>Tools exposed by this MCP server.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {toolManifest.map((tool) => (
                    <div key={tool.name} className="rounded-md border p-3">
                      <p className="font-medium font-mono text-sm">{tool.name}</p>
                      {tool.description && (
                        <p className="mt-1 text-muted-foreground text-sm">{tool.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {server.latestVersion && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Version</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="outline" className="font-mono">
                  {server.latestVersion}
                </Badge>
              </CardContent>
            </Card>
          )}

          {credentialSchema && Object.keys(credentialSchema).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Required Credentials</CardTitle>
                <CardDescription>
                  This server requires the following credentials to function.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(credentialSchema, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {server.compatibility.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Compatibility</CardTitle>
                <CardDescription>Agents known to work with this server.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {server.compatibility.map((agent) => (
                    <Badge key={agent} variant="outline" className="text-xs">
                      {agent}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {server.categories.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Categories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {server.categories.map((cat) => (
                    <Badge key={cat} variant="secondary" className="text-xs">
                      {cat}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {(server.sourcePackage || server.sourceUri) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Source</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {server.sourcePackage && (
                  <div>
                    <p className="text-muted-foreground text-xs">Package</p>
                    <p className="font-mono text-sm">{server.sourcePackage}</p>
                  </div>
                )}
                {server.sourceUri && (
                  <div>
                    <p className="text-muted-foreground text-xs">URI</p>
                    <a
                      href={server.sourceUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-primary text-sm hover:underline"
                    >
                      {server.sourceUri}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <AddToSetupDialog
        serverName={server.name}
        serverDisplayName={server.displayName}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        configSnippet={configSnippet}
      />
    </div>
  )
}

export default function McpServerDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params)

  return <McpServerDetailContent name={name} />
}
