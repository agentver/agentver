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
import { Skeleton } from '@agentver/ui/components/skeleton'
import { Textarea } from '@agentver/ui/components/textarea'
import { cn } from '@agentver/ui-utils'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  KeyRound,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

type SharingMode = 'INDIVIDUAL' | 'TEAM' | 'ORG'

const SHARING_LABELS: Record<SharingMode, string> = {
  INDIVIDUAL: 'Individual',
  TEAM: 'Team',
  ORG: 'Organisation',
}

const SHARING_COLOURS: Record<SharingMode, string> = {
  INDIVIDUAL: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  TEAM: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ORG: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

function formatRelativeDate(date: Date | string): string {
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return d.toLocaleDateString('en-GB')
}

function AddSecretDialog({
  organisationId,
  onSuccess,
}: {
  organisationId: string
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [description, setDescription] = useState('')
  const [sharing, setSharing] = useState<SharingMode>('ORG')
  const [rotationDays, setRotationDays] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  const setSecret = trpc.vault.set.useMutation({
    onSuccess: () => {
      setOpen(false)
      resetForm()
      onSuccess()
      toast.success('Secret stored successfully')
    },
    onError: (error) => toast.error(error.message),
  })

  function resetForm() {
    setKey('')
    setValue('')
    setDescription('')
    setSharing('ORG')
    setRotationDays('')
    setExpiresAt('')
  }

  function handleSubmit() {
    setSecret.mutate({
      organisationId,
      key,
      value,
      description,
      sharing,
      rotationDays: rotationDays ? Number.parseInt(rotationDays, 10) : undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Secret
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Secret</DialogTitle>
          <DialogDescription>
            Store a credential or secret in the encrypted vault. Values are encrypted with
            AES-256-GCM at rest.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="secret-key">Key</Label>
            <Input
              id="secret-key"
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
              placeholder="github-pat"
              pattern="^[a-z0-9-]+$"
            />
            <p className="text-muted-foreground text-xs">
              Lowercase alphanumeric with hyphens only.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-value">Value</Label>
            <Textarea
              id="secret-value"
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-description">Description</Label>
            <Input
              id="secret-description"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder="GitHub personal access token for CI"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Sharing Mode</Label>
              <Select value={sharing} onValueChange={(v) => setSharing(v as SharingMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INDIVIDUAL">Individual</SelectItem>
                  <SelectItem value="TEAM">Team</SelectItem>
                  <SelectItem value="ORG">Organisation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rotation-days">Rotation (days)</Label>
              <Input
                id="rotation-days"
                type="number"
                min={1}
                max={365}
                value={rotationDays}
                onChange={(e) => setRotationDays(e.currentTarget.value)}
                placeholder="90"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expires-at">Expires At (optional)</Label>
            <Input
              id="expires-at"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.currentTarget.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!key || !value || !description || setSecret.isPending}
          >
            {setSecret.isPending ? 'Storing...' : 'Store Secret'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RotateSecretDialog({
  organisationId,
  secretKey,
  teamId,
  onSuccess,
}: {
  organisationId: string
  secretKey: string
  teamId: string | null
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [newValue, setNewValue] = useState('')

  const rotate = trpc.vault.rotate.useMutation({
    onSuccess: () => {
      setOpen(false)
      setNewValue('')
      onSuccess()
      toast.success('Secret rotated successfully')
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RefreshCw className="mr-1 h-3 w-3" />
          Rotate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate Secret</DialogTitle>
          <DialogDescription>
            Enter a new value for <span className="font-mono">{secretKey}</span>. The old value will
            be replaced immediately.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="new-value">New Value</Label>
          <Textarea
            id="new-value"
            value={newValue}
            onChange={(e) => setNewValue(e.currentTarget.value)}
            placeholder="Enter the new secret value"
            className="font-mono text-sm"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              rotate.mutate({
                organisationId,
                key: secretKey,
                teamId: teamId ?? undefined,
                newValue,
              })
            }
            disabled={!newValue || rotate.isPending}
          >
            {rotate.isPending ? 'Rotating...' : 'Rotate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteSecretDialog({
  organisationId,
  secretKey,
  teamId,
  onSuccess,
}: {
  organisationId: string
  secretKey: string
  teamId: string | null
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)

  const deleteSecret = trpc.vault.delete.useMutation({
    onSuccess: () => {
      setOpen(false)
      onSuccess()
      toast.success('Secret deleted')
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Secret</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <span className="font-mono">{secretKey}</span>? This
            action cannot be undone. Any services using this secret will lose access.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              deleteSecret.mutate({
                organisationId,
                key: secretKey,
                teamId: teamId ?? undefined,
              })
            }
            disabled={deleteSecret.isPending}
          >
            {deleteSecret.isPending ? 'Deleting...' : 'Delete Secret'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AccessLogsSection({
  organisationId,
  secretId,
}: {
  organisationId: string
  secretId: string
}) {
  const [expanded, setExpanded] = useState(false)

  const logs = trpc.vault.accessLogs.useQuery(
    { organisationId, secretId, limit: 20 },
    { enabled: expanded }
  )

  return (
    <div className="mt-3 border-border/50 border-t pt-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
      >
        {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        Access Logs
      </button>

      {expanded && (
        <div className="mt-2 space-y-1">
          {logs.isLoading && (
            <div className="space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-6 rounded" />
              ))}
            </div>
          )}

          {logs.data && logs.data.items.length === 0 && (
            <p className="py-2 text-muted-foreground text-xs">No access logs recorded yet.</p>
          )}

          {logs.data && logs.data.items.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {logs.data.items.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-xs"
                >
                  <span className="font-medium">{log.action}</span>
                  <span className="text-muted-foreground">
                    {log.userId.slice(0, 8)}... &middot;{' '}
                    {new Date(log.createdAt).toLocaleString('en-GB')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SecretRow({
  secret,
  organisationId,
  onRefetch,
}: {
  secret: {
    id: string
    key: string
    description: string
    sharing: string
    rotationDays: number | null
    lastRotatedAt: Date | string | null
    expiresAt: Date | string | null
    teamId: string | null
    createdBy: { id: string; name: string | null; email: string } | null
    createdAt: Date | string
    isExpired: boolean
    isRotationDue: boolean
  }
  organisationId: string
  onRefetch: () => void
}) {
  const sharingMode = secret.sharing as SharingMode

  return (
    <div className="space-y-0 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium font-mono text-sm">{secret.key}</p>
            {secret.isExpired && (
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="mr-1 size-3" />
                Expired
              </Badge>
            )}
            {secret.isRotationDue && !secret.isExpired && (
              <Badge variant="secondary" className="text-xs">
                <Clock className="mr-1 size-3" />
                Rotation Due
              </Badge>
            )}
          </div>
          <p className="mt-1 text-muted-foreground text-sm">{secret.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <Badge
              className={cn(
                'text-xs',
                SHARING_COLOURS[sharingMode] ?? 'bg-secondary text-secondary-foreground'
              )}
            >
              {SHARING_LABELS[sharingMode] ?? secret.sharing}
            </Badge>
            {secret.lastRotatedAt && (
              <span>Last rotated {formatRelativeDate(secret.lastRotatedAt)}</span>
            )}
            {secret.rotationDays && <span>&middot; Rotates every {secret.rotationDays}d</span>}
            {secret.createdBy && (
              <span>&middot; Created by {secret.createdBy.name ?? secret.createdBy.email}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <RotateSecretDialog
            organisationId={organisationId}
            secretKey={secret.key}
            teamId={secret.teamId}
            onSuccess={onRefetch}
          />
          <DeleteSecretDialog
            organisationId={organisationId}
            secretKey={secret.key}
            teamId={secret.teamId}
            onSuccess={onRefetch}
          />
        </div>
      </div>

      <AccessLogsSection organisationId={organisationId} secretId={secret.id} />
    </div>
  )
}

export default function VaultSettingsPage() {
  const orgs = trpc.organisations.list.useQuery()
  const orgId = orgs.data?.[0]?.id

  const secrets = trpc.vault.list.useQuery({ organisationId: orgId! }, { enabled: !!orgId })

  function handleRefetch() {
    secrets.refetch()
  }

  if (!orgId && !orgs.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-bold text-2xl tracking-tight">Credential Vault</h2>
          <p className="text-muted-foreground">
            You need to be part of an organisation to manage vault secrets.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-bold text-2xl tracking-tight">Credential Vault</h2>
          <p className="text-muted-foreground">
            Securely store and manage credentials for MCP servers and integrations. All values are
            encrypted with AES-256-GCM at rest.
          </p>
        </div>
        {orgId && <AddSecretDialog organisationId={orgId} onSuccess={handleRefetch} />}
      </div>

      {secrets.isLoading && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-md" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {secrets.data && secrets.data.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
            <Shield className="size-5" />
          </div>
          <p className="mt-4 font-display font-semibold text-lg">No secrets stored</p>
          <p className="mt-1 max-w-sm text-muted-foreground text-sm">
            Add your first credential to the vault. Secrets are encrypted and access-controlled by
            sharing mode.
          </p>
        </div>
      )}

      {secrets.data && secrets.data.length > 0 && orgId && (
        <Card>
          <CardHeader>
            <CardTitle>
              <KeyRound className="mr-2 inline-block size-5" />
              Stored Secrets ({secrets.data.length})
            </CardTitle>
            <CardDescription>
              Manage your organisation&apos;s encrypted credentials.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {secrets.data.map((secret) => (
                <SecretRow
                  key={secret.id}
                  secret={secret}
                  organisationId={orgId}
                  onRefetch={handleRefetch}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
