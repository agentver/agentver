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
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { Copy, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

export default function ApiKeysPage() {
  const [name, setName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const orgs = trpc.organisations.list.useQuery()
  const orgId = orgs.data?.[0]?.id

  const keys = trpc.apiKeys.list.useQuery({ organisationId: orgId! }, { enabled: !!orgId })

  const createKey = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setNewKey(data.key)
      setName('')
      keys.refetch()
      toast.success('API key created')
    },
    onError: (error) => toast.error(error.message),
  })

  const revokeKey = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      keys.refetch()
      toast.success('API key revoked')
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-bold text-2xl tracking-tight">API Keys</h2>
        <p className="text-muted-foreground">
          Create an API key to connect the command-line tool to your account. You can also use keys
          for automated workflows and CI/CD pipelines.
        </p>
      </div>

      {newKey && (
        <Card className="border-primary">
          <CardContent className="flex items-center gap-3 pt-6">
            <code className="flex-1 rounded bg-muted p-2 font-mono text-sm">{newKey}</code>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(newKey)
                toast.success('Copied to clipboard')
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </CardContent>
          <CardContent className="pt-0">
            <p className="text-muted-foreground text-xs">
              Copy this key now — it won&apos;t be shown again.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create API Key</CardTitle>
          <CardDescription>
            Give your key a descriptive name so you know what it&apos;s for. Each key is linked to
            an organisation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key-name">Key Name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="CI/CD Pipeline"
            />
          </div>
          <Button
            onClick={() =>
              orgId &&
              createKey.mutate({
                name,
                organisationId: orgId,
                scopes: ['READ', 'WRITE'],
              })
            }
            disabled={!name || !orgId || createKey.isPending}
          >
            {createKey.isPending ? 'Creating...' : 'Create Key'}
          </Button>
        </CardContent>
      </Card>

      {keys.data && keys.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Keys</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {keys.data.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium">{key.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {key.keyPrefix}... &middot; Created{' '}
                      {new Date(key.createdAt).toLocaleDateString('en-GB')}
                    </p>
                    <div className="mt-1 flex gap-1">
                      {key.scopes.map((scope) => (
                        <Badge key={scope} variant="outline" className="text-xs">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => revokeKey.mutate({ id: key.id })}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
