'use client'

import { Button } from '@agentver/ui/components/button'
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
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

export default function NewBundlePage() {
  const router = useRouter()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [orgId, setOrgId] = useState('')
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE' | 'TEAM'>('PRIVATE')

  const { data: orgsData } = trpc.organisations.list.useQuery()

  const createMutation = trpc.bundles.create.useMutation({
    onSuccess: (pkg) => {
      toast.success('Bundle created')
      router.push(`/bundles/${pkg.organisation.slug}/${pkg.name}`)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleCreate = () => {
    const trimmedName = name.trim()
    if (!trimmedName || !orgId) return

    createMutation.mutate({
      organisationId: orgId,
      name: trimmedName,
      description: description.trim() || undefined,
      visibility,
      manifest: {
        name: trimmedName,
        version: '0.1.0',
        description: description.trim() || undefined,
      },
    })
  }

  const nameValid = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name.trim())

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-semibold text-2xl tracking-tight">Create Bundle</h2>
        <p className="text-muted-foreground leading-relaxed">
          A bundle groups packages, MCP servers, and credentials together for one-command
          installation.
        </p>
      </div>

      <div className="max-w-lg space-y-6">
        <div className="space-y-2">
          <Label htmlFor="bundle-name">Name</Label>
          <Input
            id="bundle-name"
            placeholder="my-bundle"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <p className="text-muted-foreground text-xs">
            Lowercase alphanumeric with hyphens (e.g. my-dev-bundle)
          </p>
          {name.trim() && !nameValid && (
            <p className="text-destructive text-xs">
              Must be lowercase letters, numbers, and hyphens only. Cannot start or end with a
              hyphen.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="bundle-description">Description</Label>
          <Textarea
            id="bundle-description"
            placeholder="What does this bundle include?"
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
            onValueChange={(v) => setVisibility(v as 'PUBLIC' | 'PRIVATE' | 'TEAM')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PRIVATE">Private</SelectItem>
              <SelectItem value="PUBLIC">Public</SelectItem>
              <SelectItem value="TEAM">Team</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || !nameValid || !orgId || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Bundle'}
          </Button>
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
