'use client'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentver/ui/components/select'
import { Separator } from '@agentver/ui/components/separator'
import { Textarea } from '@agentver/ui/components/textarea'
import { Download, Edit, Globe, Layers, Lock, Minus, Plus, Search, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { use, useState } from 'react'
import { PackageManagerTabs } from '@/components/ui/package-manager-tabs'
import { trpc } from '@/trpc/client'

export default function CollectionDetailPage({
  params,
}: {
  params: Promise<{ org: string; slug: string }>
}) {
  const { org, slug } = use(params)
  const router = useRouter()

  const { data: collection, isLoading } = trpc.collections.getBySlug.useQuery({
    orgSlug: org,
    slug,
  })

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editVisibility, setEditVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PRIVATE')

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [packageSearch, setPackageSearch] = useState('')

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const utils = trpc.useUtils()

  const { data: searchResults } = trpc.skills.list.useQuery(
    { search: packageSearch || undefined, limit: 20 },
    { enabled: addDialogOpen && packageSearch.length > 1 }
  )

  const updateMutation = trpc.collections.update.useMutation({
    onSuccess: () => {
      utils.collections.getBySlug.invalidate({ orgSlug: org, slug })
      setEditDialogOpen(false)
    },
  })

  const deleteMutation = trpc.collections.delete.useMutation({
    onSuccess: () => {
      router.push('/collections')
    },
  })

  const addItemMutation = trpc.collections.addItem.useMutation({
    onSuccess: () => {
      utils.collections.getBySlug.invalidate({ orgSlug: org, slug })
    },
  })

  const removeItemMutation = trpc.collections.removeItem.useMutation({
    onSuccess: () => {
      utils.collections.getBySlug.invalidate({ orgSlug: org, slug })
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

  if (!collection) {
    return <div className="py-16 text-center text-muted-foreground">Collection not found</div>
  }

  const existingPackageIds = new Set(collection.items.map((item) => item.package.id))
  const availablePackages = searchResults?.packages.filter((pkg) => !existingPackageIds.has(pkg.id))

  const openEditDialog = () => {
    setEditName(collection.name)
    setEditDescription(collection.description ?? '')
    setEditVisibility(collection.visibility as 'PUBLIC' | 'PRIVATE')
    setEditDialogOpen(true)
  }

  const handleUpdate = () => {
    updateMutation.mutate({
      id: collection.id,
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      visibility: editVisibility,
    })
  }

  const handleDelete = () => {
    deleteMutation.mutate({ id: collection.id })
  }

  const handleAddPackage = (packageId: string) => {
    addItemMutation.mutate({
      collectionId: collection.id,
      packageId,
    })
  }

  const handleRemovePackage = (packageId: string) => {
    removeItemMutation.mutate({
      collectionId: collection.id,
      packageId,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-bold text-2xl">{collection.name}</h2>
            <Badge
              variant={collection.visibility === 'PUBLIC' ? 'secondary' : 'outline'}
              className="text-xs"
            >
              {collection.visibility === 'PUBLIC' ? (
                <Globe className="mr-1 h-3 w-3" />
              ) : (
                <Lock className="mr-1 h-3 w-3" />
              )}
              {collection.visibility.toLowerCase()}
            </Badge>
          </div>
          <p className="text-muted-foreground">{org}</p>
          {collection.description && (
            <p className="mt-2 max-w-2xl text-muted-foreground text-sm">{collection.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openEditDialog}>
            <Edit className="mr-1 h-4 w-4" /> Edit
          </Button>
          <Button variant="outline" onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="mr-1 h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Install All Packages</CardTitle>
          <p className="text-muted-foreground text-sm">
            Install every package in this collection with a single command. Make sure the Agentver
            CLI is installed first.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <PackageManagerTabs
            packageName="agentver"
            global
            description="Step 1: Install the CLI (if you haven't already)"
          />
          <PackageManagerTabs
            packageName={`agentver install --collection ${org}/${slug}`}
            customCommands={{
              bun: `agentver install --collection ${org}/${slug}`,
              npm: `agentver install --collection ${org}/${slug}`,
              pnpm: `agentver install --collection ${org}/${slug}`,
              yarn: `agentver install --collection ${org}/${slug}`,
            }}
            description="Step 2: Install this collection"
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Packages ({collection.items.length})</h3>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Add Package
          </Button>
        </div>

        {collection.items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-12">
            <Layers className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-muted-foreground">No packages yet</p>
            <p className="text-muted-foreground text-sm">
              Add packages to this collection to create an installable bundle.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {collection.items.map((item) => (
              <Card key={item.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <Link
                    href={`/skills/${item.package.organisation.slug}/${item.package.name}`}
                    className="flex-1"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium text-sm">{item.package.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {item.package.organisation.slug} &middot; v
                          {item.package.versions[0]?.version ?? '0.0.0'}
                        </p>
                      </div>
                      {item.package.description && (
                        <>
                          <Separator orientation="vertical" className="h-8" />
                          <p className="line-clamp-1 text-muted-foreground text-sm">
                            {item.package.description}
                          </p>
                        </>
                      )}
                    </div>
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-muted-foreground text-xs">
                      <Download className="h-3 w-3" /> {item.package._count.installationReports}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemovePackage(item.package.id)}
                      disabled={removeItemMutation.isPending}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Collection</DialogTitle>
            <DialogDescription>Update collection details.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.currentTarget.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.currentTarget.value)}
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                value={editVisibility}
                onValueChange={(v) => setEditVisibility(v as 'PUBLIC' | 'PRIVATE')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRIVATE">Private</SelectItem>
                  <SelectItem value="PUBLIC">Public</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Package Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Package</DialogTitle>
            <DialogDescription>Search for a package to add to this collection.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search packages..."
                value={packageSearch}
                onChange={(e) => setPackageSearch(e.currentTarget.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto">
              {!packageSearch ? (
                <p className="py-4 text-center text-muted-foreground text-sm">
                  Type to search for packages
                </p>
              ) : !availablePackages?.length ? (
                <p className="py-4 text-center text-muted-foreground text-sm">
                  No matching packages found
                </p>
              ) : (
                availablePackages.map((pkg) => (
                  <button
                    key={pkg.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md p-2 text-left hover:bg-muted"
                    onClick={() => handleAddPackage(pkg.id)}
                    disabled={addItemMutation.isPending}
                  >
                    <div>
                      <p className="font-medium text-sm">{pkg.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {pkg.organisation.slug} &middot; v{pkg.versions[0]?.version ?? '0.0.0'}
                      </p>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Collection</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{collection.name}&quot;? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
