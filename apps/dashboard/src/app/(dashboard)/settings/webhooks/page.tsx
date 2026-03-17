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
import { Copy, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

const AVAILABLE_EVENTS = [
  { value: 'skill.created', label: 'Skill Created' },
  { value: 'skill.updated', label: 'Skill Updated' },
  { value: 'skill.deleted', label: 'Skill Deleted' },
  { value: 'version.published', label: 'Version Published' },
  { value: 'suggestion.opened', label: 'Suggestion Opened' },
  { value: 'suggestion.merged', label: 'Suggestion Merged' },
  { value: 'suggestion.rejected', label: 'Suggestion Rejected' },
  { value: 'member.added', label: 'Member Added' },
  { value: 'member.removed', label: 'Member Removed' },
] as const

export default function WebhooksSettingsPage() {
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [newSecret, setNewSecret] = useState<string | null>(null)

  const orgs = trpc.organisations.list.useQuery()
  const orgId = orgs.data?.[0]?.id

  const endpoints = trpc.webhooks.list.useQuery({ organisationId: orgId! }, { enabled: !!orgId })

  const createEndpoint = trpc.webhooks.create.useMutation({
    onSuccess: (data) => {
      setNewSecret(data.secret)
      setUrl('')
      setSelectedEvents([])
      endpoints.refetch()
      toast.success('Webhook endpoint created')
    },
    onError: (error) => toast.error(error.message),
  })

  const deleteEndpoint = trpc.webhooks.delete.useMutation({
    onSuccess: () => {
      endpoints.refetch()
      toast.success('Webhook endpoint deleted')
    },
    onError: (error) => toast.error(error.message),
  })

  const toggleActive = trpc.webhooks.update.useMutation({
    onSuccess: () => {
      endpoints.refetch()
    },
    onError: (error) => toast.error(error.message),
  })

  const rotateSecret = trpc.webhooks.rotateSecret.useMutation({
    onSuccess: (data) => {
      setNewSecret(data.secret)
      toast.success('Secret rotated')
    },
    onError: (error) => toast.error(error.message),
  })

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-bold text-2xl tracking-tight">Webhooks</h2>
        <p className="text-muted-foreground">
          Receive HTTP POST notifications when events happen in your organisation. Each delivery is
          signed with HMAC-SHA256 for verification.
        </p>
      </div>

      {newSecret && (
        <Card className="border-primary">
          <CardContent className="flex items-center gap-3 pt-6">
            <code className="flex-1 break-all rounded bg-muted p-2 font-mono text-sm">
              {newSecret}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                navigator.clipboard.writeText(newSecret)
                toast.success('Copied to clipboard')
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </CardContent>
          <CardContent className="pt-0">
            <p className="text-muted-foreground text-xs">
              Copy this signing secret now — it won&apos;t be shown again.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add Webhook Endpoint</CardTitle>
          <CardDescription>
            Enter a URL and select which events should trigger a delivery.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Payload URL</Label>
            <Input
              id="webhook-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              placeholder="https://example.com/webhooks/agentver"
            />
          </div>

          <div className="space-y-2">
            <Label>Events</Label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_EVENTS.map((event) => (
                <button
                  key={event.value}
                  type="button"
                  onClick={() => toggleEvent(event.value)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    selectedEvents.includes(event.value)
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {event.label}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={() =>
              orgId &&
              createEndpoint.mutate({
                organisationId: orgId,
                url,
                events: selectedEvents,
              })
            }
            disabled={!url || selectedEvents.length === 0 || !orgId || createEndpoint.isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            {createEndpoint.isPending ? 'Creating...' : 'Add Endpoint'}
          </Button>
        </CardContent>
      </Card>

      {endpoints.data && endpoints.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Endpoints</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {endpoints.data.map((endpoint) => (
                <div key={endpoint.id} className="space-y-3 rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm">{endpoint.url}</p>
                      <p className="mt-1 text-muted-foreground text-xs">
                        {endpoint._count.deliveries} deliveries &middot; Created{' '}
                        {new Date(endpoint.createdAt).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={endpoint.active ? 'default' : 'secondary'}>
                        {endpoint.active ? 'Active' : 'Paused'}
                      </Badge>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {endpoint.events.map((event) => (
                      <Badge key={event} variant="outline" className="text-xs">
                        {event}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        toggleActive.mutate({
                          id: endpoint.id,
                          active: !endpoint.active,
                        })
                      }
                    >
                      {endpoint.active ? 'Pause' : 'Resume'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rotateSecret.mutate({ id: endpoint.id })}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Rotate Secret
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteEndpoint.mutate({ id: endpoint.id })}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
