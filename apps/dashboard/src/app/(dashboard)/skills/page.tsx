'use client'

import { Button } from '@agentver/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentver/ui/components/dialog'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentver/ui/components/select'
import { CheckCircle, Download, Layers, Loader2, Package, Terminal, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/fade-in'
import { SkillFilters } from '@/components/skills/skill-filters'
import { SkillGrid } from '@/components/skills/skill-grid'
import { SkillList } from '@/components/skills/skill-list'
import { PackageManagerTabs } from '@/components/ui/package-manager-tabs'
import { trpc } from '@/trpc/client'

const VALID_TYPES = ['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT'] as const

export default function SkillsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-8">
          <div>
            <h1 className="page-title">Packages</h1>
            <p className="page-description">
              Manage your skills, configurations, plugins, scripts, and prompts.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        </div>
      }
    >
      <SkillsPageContent />
    </Suspense>
  )
}

type ImportFromUrlState = 'idle' | 'importing' | 'success' | 'error'

function ImportFromUrlDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [url, setUrl] = useState('')
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [importState, setImportState] = useState<ImportFromUrlState>('idle')
  const [importedSlug, setImportedSlug] = useState<string | null>(null)

  const { data: orgs } = trpc.organisations.list.useQuery()
  const utils = trpc.useUtils()

  const importMutation = trpc.skills.importFromUrl.useMutation({
    onSuccess: (pkg) => {
      setImportState('success')
      setImportedSlug(pkg.slug)
      utils.skills.list.invalidate()
      toast.success(`Imported ${pkg.name} successfully`)
    },
    onError: (error) => {
      setImportState('error')
      toast.error(error.message)
    },
  })

  const handleImport = useCallback(() => {
    if (!url.trim() || !selectedOrgId) return
    setImportState('importing')
    importMutation.mutate({
      organisationId: selectedOrgId,
      url: url.trim(),
    })
  }, [url, selectedOrgId, importMutation])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setUrl('')
        setSelectedOrgId('')
        setImportState('idle')
        setImportedSlug(null)
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from URL</DialogTitle>
          <DialogDescription>
            Import a skill from a public GitHub repository. The repository must contain a SKILL.md
            file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {importState !== 'success' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="import-url">GitHub URL or path</Label>
                <Input
                  id="import-url"
                  placeholder="owner/repo or https://github.com/owner/repo"
                  value={url}
                  onChange={(e) => setUrl(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleImport()
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  Accepts <code className="rounded bg-muted px-1">owner/repo</code>,{' '}
                  <code className="rounded bg-muted px-1">owner/repo/path/to/skill</code>, or a full
                  GitHub URL.
                </p>
              </div>

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
            </>
          )}

          {importState === 'success' && importedSlug && (
            <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30">
              <div className="flex items-center gap-2 font-medium text-emerald-700 text-sm dark:text-emerald-300">
                <CheckCircle className="size-4" />
                Skill imported successfully
              </div>
              <Button variant="outline" size="sm" asChild className="w-full">
                <Link href={`/skills/${importedSlug}`}>View imported skill</Link>
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          {importState !== 'success' && (
            <Button
              onClick={handleImport}
              disabled={!url.trim() || !selectedOrgId || importState === 'importing'}
            >
              {importState === 'importing' ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="mr-2 size-4" />
                  Import
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SkillsPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const typeParam = searchParams.get('type')
  const type =
    typeParam && VALID_TYPES.includes(typeParam as (typeof VALID_TYPES)[number]) ? typeParam : 'all'

  const setType = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === 'all') {
        params.delete('type')
      } else {
        params.set('type', value)
      }
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`)
    },
    [searchParams, router, pathname]
  )

  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false)
  const [installDialogOpen, setInstallDialogOpen] = useState(false)
  const [importUrlDialogOpen, setImportUrlDialogOpen] = useState(false)
  const [selectedCollectionId, setSelectedCollectionId] = useState('')

  const { data, isLoading } = trpc.skills.list.useQuery({
    search: search || undefined,
    type:
      type !== 'all'
        ? (type as 'SKILL' | 'AGENT_CONFIG' | 'PLUGIN' | 'SCRIPT' | 'PROMPT')
        : undefined,
  })

  // Fetch unfiltered list for type counts (only when a type filter is active)
  const { data: allData } = trpc.skills.list.useQuery(
    { search: search || undefined },
    { enabled: type !== 'all' }
  )

  const { data: collectionsData } = trpc.collections.list.useQuery()
  const utils = trpc.useUtils()

  const addItemsMutation = trpc.collections.addItems.useMutation({
    onSuccess: () => {
      utils.collections.list.invalidate()
      setCollectionDialogOpen(false)
      setSelectedIds(new Set())
      setSelectedCollectionId('')
    },
  })

  const packages = data?.packages ?? []
  const hasSelection = selectedIds.size > 0

  // Compute type counts from the full (unfiltered) package list
  const typeCounts = useMemo(() => {
    const source = type === 'all' ? packages : (allData?.packages ?? [])
    if (source.length === 0 && isLoading) return undefined

    const counts: Record<string, number> = { all: source.length }
    for (const pkg of source) {
      counts[pkg.type] = (counts[pkg.type] ?? 0) + 1
    }
    return counts
  }, [type, packages, allData?.packages, isLoading])

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleSelectAll = () => {
    if (selectedIds.size === packages.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(packages.map((pkg) => pkg.id)))
    }
  }

  const handleDeselectAll = () => {
    setSelectedIds(new Set())
  }

  const handleAddToCollection = () => {
    if (!selectedCollectionId || selectedIds.size === 0) return

    addItemsMutation.mutate({
      collectionId: selectedCollectionId,
      packageIds: Array.from(selectedIds),
    })
  }

  const selectedPackages = packages.filter((pkg) => selectedIds.has(pkg.id))
  const installCmd = selectedPackages
    .map((pkg) => {
      const ref = pkg.versions[0]?.gitRef ?? pkg.gitDefaultRef ?? 'main'
      if (pkg.gitUri && pkg.gitPath) {
        return `${pkg.gitUri}/${pkg.gitPath}@${ref}`
      }
      if (pkg.gitUri) {
        return `${pkg.gitUri}@${ref}`
      }
      return `${pkg.organisation.slug}/${pkg.name}`
    })
    .join(' ')

  const isEmpty = !isLoading && packages.length === 0

  return (
    <div className="space-y-8">
      <FadeIn>
        <h1 className="page-title">Packages</h1>
        <p className="page-description">
          Manage your skills, configurations, plugins, scripts, and prompts.
        </p>
      </FadeIn>

      <FadeIn delay={80}>
        <SkillFilters
          search={search}
          onSearchChange={setSearch}
          type={type}
          onTypeChange={setType}
          view={view}
          onViewChange={setView}
          onImportFromUrl={() => setImportUrlDialogOpen(true)}
          typeCounts={typeCounts}
        />
      </FadeIn>

      <FadeIn delay={160}>
        {isLoading ? (
          view === 'grid' ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          )
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Package className="size-7" />
            </div>
            <h2 className="mt-6 font-display font-semibold text-xl tracking-tight">
              No packages yet
            </h2>
            <p className="mt-2 max-w-md text-muted-foreground">
              Create your first package to start sharing skills and configurations with your team.
            </p>
            <div className="mt-6 flex gap-3">
              <Link href="/skills/new">
                <Button>Create Package</Button>
              </Link>
              <Link href="/sources">
                <Button variant="outline">Import from Source</Button>
              </Link>
            </div>
          </div>
        ) : view === 'grid' ? (
          <SkillGrid
            packages={packages}
            selectable
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        ) : (
          <SkillList
            packages={packages}
            selectable
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        )}
      </FadeIn>

      {/* Bulk action bar */}
      {hasSelection && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-4 shadow-lg backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium text-sm">
                {selectedIds.size} {selectedIds.size === 1 ? 'package' : 'packages'} selected
              </span>
              <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                {selectedIds.size === packages.length ? 'Deselect All' : 'Select All'}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
                <X className="mr-1 h-3 w-3" /> Clear
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setCollectionDialogOpen(true)}>
                <Layers className="mr-1 h-4 w-4" /> Add to Collection
              </Button>
              <Button variant="outline" size="sm" onClick={() => setInstallDialogOpen(true)}>
                <Terminal className="mr-1 h-4 w-4" /> Install Selected
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add to Collection Dialog */}
      <Dialog open={collectionDialogOpen} onOpenChange={setCollectionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Collection</DialogTitle>
            <DialogDescription>
              Add {selectedIds.size} {selectedIds.size === 1 ? 'package' : 'packages'} to a
              collection.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Collection</Label>
              <Select value={selectedCollectionId} onValueChange={setSelectedCollectionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a collection" />
                </SelectTrigger>
                <SelectContent>
                  {collectionsData?.collections.map((collection) => (
                    <SelectItem key={collection.id} value={collection.id}>
                      {collection.organisation.slug}/{collection.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {!collectionsData?.collections.length && (
              <p className="text-muted-foreground text-sm">
                No collections found. Create one first from the Collections page.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectionDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddToCollection}
              disabled={!selectedCollectionId || addItemsMutation.isPending}
            >
              {addItemsMutation.isPending ? 'Adding...' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Install Selected Dialog */}
      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install Selected Packages</DialogTitle>
            <DialogDescription>
              Run the following command to install the selected{' '}
              {selectedIds.size === 1 ? 'package' : 'packages'} via the Agentver CLI.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <PackageManagerTabs
              packageName="agentver"
              global
              description="Step 1: Install the CLI (if you haven't already)"
            />
            <PackageManagerTabs
              packageName={`agentver install ${installCmd}`}
              customCommands={{
                bun: `agentver install ${installCmd}`,
                npm: `agentver install ${installCmd}`,
                pnpm: `agentver install ${installCmd}`,
                yarn: `agentver install ${installCmd}`,
              }}
              description="Step 2: Install the selected packages"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import from URL Dialog */}
      <ImportFromUrlDialog open={importUrlDialogOpen} onOpenChange={setImportUrlDialogOpen} />
    </div>
  )
}
