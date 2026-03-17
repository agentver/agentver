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
  DialogTrigger,
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
import { Textarea } from '@agentver/ui/components/textarea'
import { Globe, Layers, Lock, Plus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { trpc } from '@/trpc/client'

export default function CollectionsPage() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [orgId, setOrgId] = useState('')
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PRIVATE')

  const { data, isLoading } = trpc.collections.list.useQuery()
  const { data: orgsData } = trpc.organisations.list.useQuery()
  const utils = trpc.useUtils()

  const createMutation = trpc.collections.create.useMutation({
    onSuccess: () => {
      utils.collections.list.invalidate()
      setDialogOpen(false)
      resetForm()
    },
  })

  const resetForm = () => {
    setName('')
    setDescription('')
    setOrgId('')
    setVisibility('PRIVATE')
  }

  const handleCreate = () => {
    if (!name.trim() || !orgId) return

    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      organisationId: orgId,
      visibility,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display font-semibold text-3xl tracking-tight">Collections</h2>
          <p className="text-muted-foreground leading-relaxed">
            Group skills into installable bundles for one-click installation.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New Collection
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Collection</DialogTitle>
              <DialogDescription>
                Bundle related packages together for easy installation.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="collection-name">Name</Label>
                <Input
                  id="collection-name"
                  placeholder="my-collection"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="collection-description">Description</Label>
                <Textarea
                  id="collection-description"
                  placeholder="What does this collection include?"
                  value={description}
                  onChange={(e) => setDescription(e.currentTarget.value)}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Organisation</Label>
                <Select value={orgId} onValueChange={setOrgId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an organisation" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgsData?.map((org) => (
                      <SelectItem key={org.id} value={org.id}>
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Visibility</Label>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as 'PUBLIC' | 'PRIVATE')}
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
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!name.trim() || !orgId || createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : !data?.collections.length ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
            <Layers className="size-5" />
          </div>
          <p className="mt-4 font-display font-medium text-lg">No collections yet</p>
          <p className="mt-1 max-w-sm text-center text-muted-foreground text-sm">
            Collections let you bundle related skills for one-click installation.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {data.collections.map((collection) => (
            <Link
              key={collection.id}
              href={`/collections/${collection.organisation.slug}/${collection.slug}`}
            >
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base">{collection.name}</CardTitle>
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
                  <p className="text-muted-foreground text-sm">{collection.organisation.slug}</p>
                </CardHeader>
                <CardContent>
                  {collection.description && (
                    <p className="mb-3 line-clamp-2 text-muted-foreground text-sm">
                      {collection.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 text-muted-foreground text-xs">
                    <span className="flex items-center gap-1">
                      <Layers className="h-3 w-3" /> {collection._count.items}{' '}
                      {collection._count.items === 1 ? 'package' : 'packages'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
