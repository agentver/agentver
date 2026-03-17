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
import { Label } from '@agentver/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentver/ui/components/select'
import {
  Check,
  CheckCircle,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Search,
  Terminal,
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/fade-in'
import { formatCount } from '@/components/install-badge'
import type { SkillsShResult } from '@/lib/registries/skills-sh'
import { toGitInstallSource } from '@/lib/registries/skills-sh'
import { trpc } from '@/trpc/client'

function CommunitySkillCard({
  skill,
  onImport,
}: {
  skill: SkillsShResult
  onImport: (skill: SkillsShResult) => void
}) {
  const [owner, repo] = skill.source.split('/')

  return (
    <div className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/[0.04]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1 truncate font-display font-semibold tracking-tight">
            {skill.name}
          </h3>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {owner}/{repo}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-700 text-xs dark:bg-amber-900/40 dark:text-amber-300">
          <Globe className="mr-1 inline size-3" />
          skills.sh
        </span>
      </div>

      {skill.description && (
        <p className="mt-2 line-clamp-2 flex-1 text-muted-foreground text-sm leading-relaxed">
          {skill.description}
        </p>
      )}

      {!skill.description && <div className="flex-1" />}

      <div className="mt-auto pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <span className="flex items-center gap-1">
              <Download className="size-3" /> {formatCount(skill.installCount)}
            </span>
            <a
              href={skill.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3" /> View
            </a>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onImport(skill)}
          >
            <Terminal className="mr-1 size-3" />
            Add to Agentver
          </Button>
        </div>
      </div>
    </div>
  )
}

type ImportState = 'idle' | 'importing' | 'success' | 'error'

function ImportDialog({
  skill,
  open,
  onOpenChange,
}: {
  skill: SkillsShResult | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [importState, setImportState] = useState<ImportState>('idle')
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

  const installCommand = skill ? `agentver install ${toGitInstallSource(skill)}` : ''

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(installCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [installCommand])

  const handleImportToOrg = useCallback(() => {
    if (!skill || !selectedOrgId) return

    setImportState('importing')
    importMutation.mutate({
      organisationId: selectedOrgId,
      url: `github.com/${skill.source}/${skill.name}`,
    })
  }, [skill, selectedOrgId, importMutation])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setImportState('idle')
        setImportedSlug(null)
        setSelectedOrgId('')
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  if (!skill) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {skill.name} to Agentver</DialogTitle>
          <DialogDescription>
            Import this skill directly into your organisation, or install via the CLI.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Direct import section */}
          {orgs && orgs.length > 0 && importState !== 'success' && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              <Label className="font-medium text-sm">Import to organisation</Label>
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an organisation" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name} ({org.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleImportToOrg}
                disabled={!selectedOrgId || importState === 'importing'}
                className="w-full"
              >
                {importState === 'importing' ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 size-4" />
                    Import Skill
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Success state */}
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

          {/* Divider */}
          {orgs && orgs.length > 0 && importState !== 'success' && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or use the CLI</span>
              </div>
            </div>
          )}

          {/* CLI install command */}
          <div>
            <label className="mb-1.5 block font-medium text-sm">Install command</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm">
                {installCommand}
              </code>
              <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/50 p-3 text-muted-foreground text-sm">
            <p>
              <strong className="text-foreground">Source:</strong>{' '}
              <a
                href={`https://github.com/${skill.source}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                github.com/{skill.source}
              </a>
            </p>
            <p className="mt-1">
              <strong className="text-foreground">Installs:</strong>{' '}
              {formatCount(skill.installCount)}
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          <Button asChild>
            <a href={skill.url} target="_blank" rel="noopener noreferrer">
              View on skills.sh
              <ExternalLink className="ml-1 size-3.5" />
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type CommunityResultsProps = {
  query: string
}

export function CommunityResults({ query }: CommunityResultsProps) {
  const [importSkill, setImportSkill] = useState<SkillsShResult | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const searchEnabled = query.length > 0

  const { data, isLoading, isError } = trpc.search.searchExternal.useQuery(
    { query, limit: 20 },
    { enabled: searchEnabled, retry: 1 }
  )

  const handleImport = useCallback((skill: SkillsShResult) => {
    setImportSkill(skill)
    setDialogOpen(true)
  }, [])

  if (!searchEnabled) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          <Search className="size-5" />
        </div>
        <p className="mt-4 font-display font-semibold text-lg">Search community skills</p>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          Enter a search term to discover skills from{' '}
          <a
            href="https://skills.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            skills.sh
          </a>
          , the open skill registry.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <Globe className="size-5" />
        </div>
        <p className="mt-4 font-display font-semibold text-lg">Unable to reach skills.sh</p>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          The external registry is currently unavailable. Please try again later.
        </p>
      </div>
    )
  }

  const skills = data?.skills ?? []

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
          <Search className="size-5" />
        </div>
        <p className="mt-4 font-display font-semibold text-lg">No community results</p>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          No skills matching &ldquo;{query}&rdquo; found on skills.sh. Try a different search term.
        </p>
      </div>
    )
  }

  return (
    <>
      <FadeIn>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <CommunitySkillCard key={skill.id} skill={skill} onImport={handleImport} />
          ))}
        </div>
      </FadeIn>

      <ImportDialog skill={importSkill} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
