'use client'

import { Button } from '@agentver/ui/components/button'
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
import { AlertCircle, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

type CreateOrganisationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function CreateOrganisationDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateOrganisationDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const utils = trpc.useUtils()

  const createOrg = trpc.organisations.create.useMutation({
    onSuccess: () => {
      toast.success('Organisation created')
      setName('')
      setSlug('')
      setSlugTouched(false)
      setValidationError(null)
      onOpenChange(false)
      utils.organisations.list.invalidate()
      onCreated?.()
    },
    onError: (error) => {
      if (error.data?.code === 'CONFLICT') {
        setValidationError('This slug is already taken. Please choose another.')
      } else {
        toast.error(error.message)
      }
    },
  })

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value)
      setValidationError(null)
      if (!slugTouched) {
        setSlug(generateSlug(value))
      }
    },
    [slugTouched]
  )

  const handleSlugChange = useCallback((value: string) => {
    setSlugTouched(true)
    setValidationError(null)
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
  }, [])

  const handleCreate = useCallback(() => {
    if (!name.trim()) {
      setValidationError('Organisation name is required.')
      return
    }
    if (slug.length < 2) {
      setValidationError('Slug must be at least 2 characters.')
      return
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setValidationError('Slug must be lowercase alphanumeric with hyphens only.')
      return
    }

    createOrg.mutate({ name: name.trim(), slug })
  }, [name, slug, createOrg])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Organisation</DialogTitle>
          <DialogDescription>
            Create an organisation to publish and manage agent skills with your team.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => handleNameChange(e.currentTarget.value)}
              placeholder="My Organisation"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-slug">Slug</Label>
            <Input
              id="org-slug"
              value={slug}
              onChange={(e) => handleSlugChange(e.currentTarget.value)}
              placeholder="my-organisation"
            />
            <p className="text-muted-foreground text-xs">
              Used in URLs and package scopes. Lowercase letters, numbers, and hyphens only.
            </p>
          </div>
          {validationError && (
            <div className="flex items-center gap-1.5 text-destructive text-sm">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>{validationError}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || slug.length < 2 || createOrg.isPending}
          >
            {createOrg.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {createOrg.isPending ? 'Creating...' : 'Create Organisation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
