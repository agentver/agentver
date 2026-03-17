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
import { AlertCircle, CheckCircle2, GitBranch, Loader2, Server } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

type SkillsRepoConnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  organisationId: string
  onConnected: () => void
}

type ConnectionMode = 'agentver' | 'github'

function parseGitHubUrl(url: string): { owner: string; name: string } | null {
  const trimmed = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')

  // Handle https://github.com/owner/repo
  const httpsMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)$/)
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { owner: httpsMatch[1], name: httpsMatch[2] }
  }

  // Handle owner/repo shorthand
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
  if (shortMatch?.[1] && shortMatch[2]) {
    return { owner: shortMatch[1], name: shortMatch[2] }
  }

  return null
}

export function SkillsRepoConnectDialog({
  open,
  onOpenChange,
  organisationId,
  onConnected,
}: SkillsRepoConnectDialogProps) {
  const [mode, setMode] = useState<ConnectionMode>('agentver')
  const [repoUrl, setRepoUrl] = useState('')
  const [parsed, setParsed] = useState<{ owner: string; name: string } | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const connectRepo = trpc.organisations.connectSkillsRepo.useMutation({
    onSuccess: () => {
      toast.success(
        mode === 'agentver' ? 'Built-in storage enabled' : 'Package repository connected'
      )
      setRepoUrl('')
      setParsed(null)
      setMode('agentver')
      onOpenChange(false)
      onConnected()
    },
    onError: (error) => toast.error(error.message),
  })

  const handleUrlChange = useCallback((value: string) => {
    setRepoUrl(value)
    setValidationError(null)
    const result = parseGitHubUrl(value)
    setParsed(result)
  }, [])

  const handleConnectAgentver = useCallback(() => {
    connectRepo.mutate({
      organisationId,
      useAgentverGit: true,
    })
  }, [organisationId, connectRepo])

  const handleConnectGitHub = useCallback(() => {
    if (!parsed) {
      setValidationError(
        'Please enter a valid GitHub repository URL (e.g. https://github.com/org/repo)'
      )
      return
    }

    const fullUrl = `https://github.com/${parsed.owner}/${parsed.name}`
    connectRepo.mutate({
      organisationId,
      url: fullUrl,
      owner: parsed.owner,
      name: parsed.name,
      provider: 'github',
    })
  }, [parsed, organisationId, connectRepo])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Package Repository</DialogTitle>
          <DialogDescription>
            Choose where to store your organisation&apos;s packages.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Built-in storage option */}
          <button
            type="button"
            onClick={() => setMode('agentver')}
            className={`w-full rounded-lg border p-4 text-left transition-colors ${
              mode === 'agentver'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <Server className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium text-sm">Built-in storage</p>
                <p className="text-muted-foreground text-xs">
                  Store packages on Agentver&apos;s built-in git server. No external account needed.
                </p>
              </div>
            </div>
          </button>

          {/* GitHub option */}
          <button
            type="button"
            onClick={() => setMode('github')}
            className={`w-full rounded-lg border p-4 text-left transition-colors ${
              mode === 'github'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <GitBranch className="h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium text-sm">GitHub repository</p>
                <p className="text-muted-foreground text-xs">
                  Connect an external GitHub repository. You must have push access.
                </p>
              </div>
            </div>
          </button>

          {/* GitHub URL input — only shown when GitHub mode is selected */}
          {mode === 'github' && (
            <div className="space-y-2">
              <Label htmlFor="repo-url">Repository URL</Label>
              <Input
                id="repo-url"
                value={repoUrl}
                onChange={(e) => handleUrlChange(e.currentTarget.value)}
                placeholder="https://github.com/your-org/skills"
              />
              {parsed && (
                <div className="flex items-center gap-1.5 text-emerald-600 text-sm">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>
                    {parsed.owner}/{parsed.name}
                  </span>
                </div>
              )}
              {validationError && (
                <div className="flex items-center gap-1.5 text-destructive text-sm">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{validationError}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {mode === 'agentver' ? (
            <Button onClick={handleConnectAgentver} disabled={connectRepo.isPending}>
              {connectRepo.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {connectRepo.isPending ? 'Enabling...' : 'Enable Built-in Storage'}
            </Button>
          ) : (
            <Button onClick={handleConnectGitHub} disabled={!parsed || connectRepo.isPending}>
              {connectRepo.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {connectRepo.isPending ? 'Connecting...' : 'Connect Repository'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
