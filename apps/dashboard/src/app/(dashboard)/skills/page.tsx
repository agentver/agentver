'use client'

import { Badge } from '@agentver/ui/components/badge'
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
import {
  Check,
  CheckCircle,
  Download,
  FileText,
  GitBranch,
  Layers,
  Loader2,
  Package,
  Search as SearchIcon,
  Settings,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/fade-in'
import { DETECTED_TYPE_COLOURS, DETECTED_TYPE_LABELS } from '@/components/import/shared-constants'
import type { DetectedFileType, ScannedFile } from '@/components/import/shared-types'
import { SkillFilters } from '@/components/skills/skill-filters'
import { SkillGrid } from '@/components/skills/skill-grid'
import { SkillList } from '@/components/skills/skill-list'
import { AdoptionModeSelector } from '@/components/sources/adoption-mode-selector'
import { PackageManagerTabs } from '@/components/ui/package-manager-tabs'
import { useOrgContext } from '@/hooks/use-org-context'
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

type ScanStep = 'input' | 'scanning' | 'select' | 'importing' | 'done'

type ScanImportResult = {
  imported: Array<{ path: string; packageId: string; name: string }>
  errors: Array<{ path: string; error: string }>
}

type ScanProvider = 'github' | 'gitlab' | 'bitbucket'

/**
 * Detect the git provider from a URL string.
 * Defaults to GitHub for bare owner/repo input.
 */
function detectProviderFromUrl(url: string): ScanProvider {
  const cleaned = url.trim().replace(/^https?:\/\//, '')
  if (cleaned.startsWith('gitlab.com/')) return 'gitlab'
  if (cleaned.startsWith('bitbucket.org/')) return 'bitbucket'
  return 'github'
}

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
  const [scanMode, setScanMode] = useState(false)
  const [scanStep, setScanStep] = useState<ScanStep>('input')
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [repoLabel, setRepoLabel] = useState('')
  const [scanImportResult, setScanImportResult] = useState<ScanImportResult | null>(null)
  const [scanProvider, setScanProvider] = useState<ScanProvider>('github')
  const [adoptionMode, setAdoptionMode] = useState<'COPY' | 'MIRROR' | 'LINK'>('COPY')

  const { data: orgs } = trpc.organisations.list.useQuery()
  const accounts = trpc.connections.list.useQuery()
  const hasGitHubAccount = accounts.data?.some((a) => a.provider === 'GITHUB') ?? false
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

  // Shared scan success/error handlers
  const onScanSuccess = useCallback((data: { repo: string; files: ScannedFile[] }) => {
    setRepoLabel(data.repo)
    setScannedFiles(data.files)
    setSelectedPaths(new Set(data.files.map((f) => f.path)))

    if (data.files.length === 0) {
      toast.info('No skill or config files found in this repository')
    } else {
      toast.success(`Found ${data.files.length} file${data.files.length === 1 ? '' : 's'}`)
    }

    setScanStep('select')
  }, [])

  const onScanError = useCallback((error: { message: string }) => {
    setScanStep('input')
    toast.error(error.message)
  }, [])

  const scanGitHubMutation = trpc.imports.scanGitHub.useMutation({
    onSuccess: onScanSuccess,
    onError: onScanError,
  })

  const scanGitLabMutation = trpc.imports.scanGitLab.useMutation({
    onSuccess: (data) => {
      onScanSuccess({
        repo: data.repo,
        files: data.files.map((f) => ({
          ...f,
          downloadUrl: '',
          preview: f.preview ?? null,
        })),
      })
    },
    onError: onScanError,
  })

  const scanBitbucketMutation = trpc.imports.scanBitbucket.useMutation({
    onSuccess: onScanSuccess,
    onError: onScanError,
  })

  // Shared bulk import success/error handlers
  const onBulkImportSuccess = useCallback(
    (data: {
      imported: Array<{ path: string; packageId: string; name: string }>
      errors: Array<{ path: string; error: string }>
    }) => {
      setScanImportResult({
        imported: data.imported,
        errors: data.errors,
      })
      setScanStep('done')
      utils.skills.list.invalidate()

      if (data.errors.length === 0) {
        toast.success(
          `Imported ${data.imported.length} file${data.imported.length === 1 ? '' : 's'}`
        )
      } else {
        toast.warning(`Imported ${data.imported.length}, failed ${data.errors.length}`)
      }
    },
    [utils.skills.list]
  )

  const onBulkImportError = useCallback((error: { message: string }) => {
    setScanStep('select')
    toast.error(error.message)
  }, [])

  const bulkImportGitHubMutation = trpc.imports.importFromGitHub.useMutation({
    onSuccess: onBulkImportSuccess,
    onError: onBulkImportError,
  })

  const bulkImportGitLabMutation = trpc.imports.importFromGitLab.useMutation({
    onSuccess: onBulkImportSuccess,
    onError: onBulkImportError,
  })

  const bulkImportBitbucketMutation = trpc.imports.importFromBitbucket.useMutation({
    onSuccess: onBulkImportSuccess,
    onError: onBulkImportError,
  })

  const isScanPending =
    scanGitHubMutation.isPending || scanGitLabMutation.isPending || scanBitbucketMutation.isPending

  const handleSingleImport = useCallback(() => {
    if (!url.trim() || !selectedOrgId) return
    setImportState('importing')
    importMutation.mutate({
      organisationId: selectedOrgId,
      url: url.trim(),
    })
  }, [url, selectedOrgId, importMutation])

  const handleScan = useCallback(() => {
    const trimmed = url.trim()
    if (!trimmed) {
      toast.error('Please enter a repository URL or owner/repo')
      return
    }

    const provider = detectProviderFromUrl(trimmed)
    setScanProvider(provider)
    setScanStep('scanning')

    if (provider === 'gitlab') {
      const withoutProtocol = trimmed.replace(/^https?:\/\//, '').replace(/^gitlab\.com\//, '')
      const withoutTree = withoutProtocol.split('/-/')[0] ?? withoutProtocol
      scanGitLabMutation.mutate({ projectPath: withoutTree })
      return
    }

    if (provider === 'bitbucket') {
      const withoutProtocol = trimmed.replace(/^https?:\/\//, '').replace(/^bitbucket\.org\//, '')
      const segments = withoutProtocol.split('/').filter(Boolean)
      if (segments.length >= 2) {
        scanBitbucketMutation.mutate({ workspace: segments[0]!, repoSlug: segments[1]! })
      } else {
        scanBitbucketMutation.mutate({ repoUrl: trimmed })
      }
      return
    }

    // GitHub (default)
    const withoutProtocol = trimmed.replace(/^https?:\/\//, '').replace(/^github\.com\//, '')
    const slashMatch = withoutProtocol.match(/^([^/\s]+)\/([^/\s]+)$/)

    if (slashMatch?.[1] && slashMatch[2]) {
      scanGitHubMutation.mutate({ repoOwner: slashMatch[1], repoName: slashMatch[2] })
    } else {
      scanGitHubMutation.mutate({ repoUrl: trimmed })
    }
  }, [url, scanGitHubMutation, scanGitLabMutation, scanBitbucketMutation])

  const handleBulkImport = useCallback(() => {
    if (!selectedOrgId || selectedPaths.size === 0) return

    const filesToImport = scannedFiles.filter((f) => selectedPaths.has(f.path))
    if (filesToImport.length === 0) return

    setScanStep('importing')

    if (scanProvider === 'gitlab') {
      const firstFile = filesToImport[0]!
      bulkImportGitLabMutation.mutate({
        repo: repoLabel,
        projectId: firstFile.projectId ?? 0,
        organisationId: selectedOrgId,
        adoptionMode,
        files: filesToImport.map((f) => ({
          path: f.path,
          name: f.name,
          type: f.type,
          detectedType: f.detectedType,
          agentId: f.agentId,
          projectId: f.projectId ?? 0,
          ref: f.ref ?? 'main',
        })),
      })
      return
    }

    if (scanProvider === 'bitbucket') {
      const segments = repoLabel.split('/')
      bulkImportBitbucketMutation.mutate({
        repo: repoLabel,
        workspace: segments[0] ?? '',
        repoSlug: segments[1] ?? '',
        mainBranch: filesToImport[0]?.ref ?? 'main',
        organisationId: selectedOrgId,
        adoptionMode,
        files: filesToImport.map((f) => ({
          path: f.path,
          name: f.name,
          type: f.type,
          detectedType: f.detectedType,
          agentId: f.agentId,
          downloadUrl: f.downloadUrl,
        })),
      })
      return
    }

    // GitHub (default)
    bulkImportGitHubMutation.mutate({
      repo: repoLabel,
      organisationId: selectedOrgId,
      adoptionMode,
      files: filesToImport.map((f) => ({
        path: f.path,
        name: f.name,
        type: f.type,
        detectedType: f.detectedType,
        agentId: f.agentId,
        downloadUrl: f.downloadUrl,
      })),
    })
  }, [
    selectedOrgId,
    selectedPaths,
    scannedFiles,
    repoLabel,
    scanProvider,
    adoptionMode,
    bulkImportGitHubMutation,
    bulkImportGitLabMutation,
    bulkImportBitbucketMutation,
  ])

  const toggleFile = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelectedPaths((prev) => {
      if (prev.size === scannedFiles.length) {
        return new Set()
      }
      return new Set(scannedFiles.map((f) => f.path))
    })
  }, [scannedFiles])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setUrl('')
        setSelectedOrgId('')
        setImportState('idle')
        setImportedSlug(null)
        setScanMode(false)
        setScanStep('input')
        setScannedFiles([])
        setSelectedPaths(new Set())
        setRepoLabel('')
        setScanImportResult(null)
        setScanProvider('github')
        setAdoptionMode('COPY')
      }
      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  const isScanSelectStep = scanMode && scanStep === 'select'
  const isScanImportingStep = scanMode && scanStep === 'importing'
  const isScanDoneStep = scanMode && scanStep === 'done'
  const isSingleSuccess = !scanMode && importState === 'success'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={isScanSelectStep ? 'sm:max-w-2xl' : 'sm:max-w-lg'}>
        <DialogHeader>
          <DialogTitle>Import from URL</DialogTitle>
          <DialogDescription>
            {scanMode
              ? 'Scan a repository to discover and import all skills.'
              : 'Import a skill from a public GitHub, GitLab, or Bitbucket repository.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Mode toggle - only show when not mid-flow */}
          {!isSingleSuccess && !isScanSelectStep && !isScanImportingStep && !isScanDoneStep && (
            <button
              type="button"
              onClick={() => {
                setScanMode((prev) => !prev)
                setScanStep('input')
                setImportState('idle')
              }}
              className="flex w-full items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <SearchIcon className="size-4 text-muted-foreground" />
                <div className="text-left">
                  <p className="font-medium text-sm">Scan repository for all skills</p>
                  <p className="text-muted-foreground text-xs">
                    Discover and import multiple skills at once
                  </p>
                </div>
              </div>
              <div
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  scanMode ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block size-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                    scanMode ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </div>
            </button>
          )}

          {/* Single import mode */}
          {!scanMode && importState !== 'success' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="import-url">Repository URL or path</Label>
                <Input
                  id="import-url"
                  placeholder="owner/repo, github.com/..., gitlab.com/..., bitbucket.org/..."
                  value={url}
                  onChange={(e) => setUrl(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSingleImport()
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  Accepts <code className="rounded bg-muted px-1">owner/repo</code>,{' '}
                  <code className="rounded bg-muted px-1">owner/repo/path/to/skill</code>, or a full
                  GitHub, GitLab, or Bitbucket URL.
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

          {/* Scan mode: input step */}
          {scanMode && (scanStep === 'input' || scanStep === 'scanning') && (
            <>
              <div className="space-y-2">
                <Label htmlFor="scan-url">Repository URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="scan-url"
                    placeholder="owner/repo, github.com/..., gitlab.com/..., bitbucket.org/..."
                    value={url}
                    onChange={(e) => setUrl(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleScan()
                      }
                    }}
                  />
                  <Button onClick={handleScan} disabled={isScanPending || !url.trim()}>
                    {isScanPending ? (
                      <>
                        <Loader2 className="mr-1 size-4 animate-spin" />
                        Scanning...
                      </>
                    ) : (
                      <>
                        <SearchIcon className="mr-1 size-4" />
                        Scan
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  Enter a repository URL to scan for skills, configs, and other agent files. GitLab
                  and Bitbucket scanning requires a connected account.
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

          {/* Scan mode: select step */}
          {isScanSelectStep && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm">
                  Found <span className="font-semibold">{scannedFiles.length}</span> file
                  {scannedFiles.length === 1 ? '' : 's'} in{' '}
                  <code className="rounded bg-muted px-1 text-xs">{repoLabel}</code>
                </p>
                <Button variant="ghost" size="sm" onClick={toggleAll}>
                  {selectedPaths.size === scannedFiles.length ? 'Deselect all' : 'Select all'}
                </Button>
              </div>

              {scannedFiles.length === 0 ? (
                <p className="py-4 text-center text-muted-foreground text-sm">
                  No skill or config files found in this repository.
                </p>
              ) : (
                <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
                  {Object.entries(
                    scannedFiles.reduce<Record<string, ScannedFile[]>>((groups, file) => {
                      const group = groups[file.detectedType] ?? []
                      group.push(file)
                      groups[file.detectedType] = group
                      return groups
                    }, {})
                  ).map(([groupType, groupFiles]) => (
                    <div key={groupType}>
                      <div className="mb-1.5 flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={`text-xs ${DETECTED_TYPE_COLOURS[groupType as DetectedFileType] ?? ''}`}
                        >
                          {DETECTED_TYPE_LABELS[groupType as DetectedFileType] ?? groupType}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {groupFiles.length} file{groupFiles.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {groupFiles.map((file) => {
                          const isSelected = selectedPaths.has(file.path)
                          return (
                            <button
                              key={file.path}
                              type="button"
                              onClick={() => toggleFile(file.path)}
                              className={`flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                                isSelected
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border hover:border-muted-foreground/50'
                              }`}
                            >
                              <div
                                className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                                  isSelected
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-muted-foreground/30'
                                }`}
                              >
                                {isSelected && <Check className="size-3" />}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  {file.detectedType === 'AGENT_CONFIG' ? (
                                    <Settings className="size-3.5 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="truncate font-mono text-xs">{file.path}</span>
                                </div>
                              </div>

                              <Badge
                                variant="secondary"
                                className={`shrink-0 text-xs ${DETECTED_TYPE_COLOURS[file.detectedType] ?? ''}`}
                              >
                                {DETECTED_TYPE_LABELS[file.detectedType] ?? file.detectedType}
                              </Badge>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!selectedOrgId && (
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
              )}

              <AdoptionModeSelector
                value={adoptionMode}
                onChange={setAdoptionMode}
                disabledModes={
                  scanProvider === 'github'
                    ? hasGitHubAccount
                      ? undefined
                      : { MIRROR: 'Connect your GitHub account to enable mirror sync' }
                    : scanProvider === 'gitlab'
                      ? { MIRROR: 'Coming soon — webhook sync for GitLab is not yet available' }
                      : { MIRROR: 'Coming soon — webhook sync for Bitbucket is not yet available' }
                }
              />
            </div>
          )}

          {/* Scan mode: importing step */}
          {isScanImportingStep && (
            <div className="flex flex-col items-center justify-center py-6">
              <Loader2 className="mb-3 size-6 animate-spin text-primary" />
              <p className="font-medium text-sm">Importing {selectedPaths.size} files...</p>
              <p className="mt-1 text-muted-foreground text-xs">
                Committing files to your package repository
              </p>
            </div>
          )}

          {/* Scan mode: done step */}
          {isScanDoneStep && scanImportResult && (
            <div className="space-y-3">
              {scanImportResult.imported.length > 0 && (
                <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
                  <p className="flex items-center gap-2 font-medium text-emerald-700 text-sm dark:text-emerald-300">
                    <CheckCircle className="size-4" />
                    Imported {scanImportResult.imported.length} file
                    {scanImportResult.imported.length === 1 ? '' : 's'}
                  </p>
                  <ul className="space-y-1">
                    {scanImportResult.imported.map((item) => (
                      <li
                        key={item.packageId}
                        className="flex items-center gap-2 text-emerald-600 text-xs dark:text-emerald-400"
                      >
                        <Check className="size-3" />
                        <span className="font-mono">{item.name}</span>
                        <span className="text-muted-foreground">({item.path})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {scanImportResult.errors.length > 0 && (
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
                  <p className="font-medium text-red-700 text-sm dark:text-red-300">
                    {scanImportResult.errors.length} file
                    {scanImportResult.errors.length === 1 ? '' : 's'} failed
                  </p>
                  <ul className="space-y-1">
                    {scanImportResult.errors.map((item) => (
                      <li key={item.path} className="text-red-600 text-xs dark:text-red-400">
                        <span className="font-mono">{item.path}</span>
                        <span className="ml-1 text-muted-foreground">{item.error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Single import: success */}
          {isSingleSuccess && importedSlug && (
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
          {isScanSelectStep && (
            <Button
              variant="outline"
              onClick={() => {
                setScanStep('input')
                setScannedFiles([])
                setSelectedPaths(new Set())
                setRepoLabel('')
              }}
            >
              Back
            </Button>
          )}

          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>

          {/* Single import button */}
          {!scanMode && importState !== 'success' && (
            <Button
              onClick={handleSingleImport}
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

          {/* Scan mode: import selected button */}
          {isScanSelectStep && scannedFiles.length > 0 && (
            <Button
              onClick={handleBulkImport}
              disabled={selectedPaths.size === 0 || !selectedOrgId}
            >
              <Download className="mr-2 size-4" />
              Import {selectedPaths.size} selected
            </Button>
          )}

          {/* Scan mode: done - view packages */}
          {isScanDoneStep && (
            <Button asChild>
              <Link href="/skills">View packages</Link>
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
  const { selectedOrg, isLoading: isOrgLoading } = useOrgContext()

  const skillsRepoStatus = trpc.organisations.getSkillsRepoStatus.useQuery(
    { organisationId: selectedOrg?.id ?? '' },
    { enabled: !!selectedOrg?.id }
  )
  const hasSkillsRepo = skillsRepoStatus.data?.connected ?? false
  const showRepoBanner = !isOrgLoading && !skillsRepoStatus.isLoading && !hasSkillsRepo

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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
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

  const bulkDeleteMutation = trpc.skills.bulkDelete.useMutation({
    onSuccess: (result) => {
      utils.skills.list.invalidate()
      setDeleteDialogOpen(false)
      setDeleteConfirmation('')
      setSelectedIds(new Set())

      if (result.errors.length === 0) {
        toast.success(`Deleted ${result.deleted} ${result.deleted === 1 ? 'package' : 'packages'}`)
      } else if (result.deleted > 0) {
        toast.warning(
          `Deleted ${result.deleted} ${result.deleted === 1 ? 'package' : 'packages'}. ${result.errors.length} could not be deleted.`
        )
      } else {
        toast.error('No packages could be deleted', {
          description: result.errors.map((e) => `${e.name}: ${e.error}`).join(', '),
        })
      }
    },
    onError: (error) => {
      toast.error('Failed to delete packages', { description: error.message })
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

  const handleBulkDelete = () => {
    if (deleteConfirmation !== 'DELETE' || selectedIds.size === 0) return
    bulkDeleteMutation.mutate({ ids: Array.from(selectedIds) })
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

      {showRepoBanner && (
        <FadeIn delay={120}>
          <div className="flex items-start gap-4 rounded-2xl border border-amber-500/50 bg-amber-500/5 p-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
              <GitBranch className="size-5 text-amber-500" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-semibold text-sm tracking-tight">
                Connect a package repository to get started
              </h3>
              <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                A package repository is required to store, version, and manage your skills. Choose
                built-in storage or connect your own GitHub repository.
              </p>
            </div>
            <Button asChild size="sm" className="shrink-0">
              <Link href="/settings/organisation">Connect Repository</Link>
            </Button>
          </div>
        </FadeIn>
      )}

      <FadeIn delay={160}>
        <div data-testid="skills-list">
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
                {showRepoBanner ? <GitBranch className="size-7" /> : <Package className="size-7" />}
              </div>
              <h2 className="mt-6 font-display font-semibold text-xl tracking-tight">
                {showRepoBanner ? 'Connect a package repository' : 'No packages yet'}
              </h2>
              <p className="mt-2 max-w-md text-muted-foreground">
                {showRepoBanner
                  ? 'Before you can create or import packages, connect a package repository to store and version your skills.'
                  : 'Create your first package to start sharing skills and configurations with your team.'}
              </p>
              <div className="mt-6 flex gap-3">
                {showRepoBanner ? (
                  <>
                    <Link href="/settings/organisation">
                      <Button>
                        <GitBranch className="mr-2 size-4" />
                        Connect Repository
                      </Button>
                    </Link>
                    <Link href="/skills/new">
                      <Button variant="outline">Create Package</Button>
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href="/skills/new">
                      <Button>Create Package</Button>
                    </Link>
                    <Link href="/sources">
                      <Button variant="outline">Import from Source</Button>
                    </Link>
                  </>
                )}
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
        </div>
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
              <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Delete Selected
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

      {/* Delete Selected Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setDeleteConfirmation('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {selectedIds.size} {selectedIds.size === 1 ? 'package' : 'packages'}?
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the selected packages, all their versions, and
              installation records. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border bg-muted/50 p-3">
              <ul className="space-y-1 text-sm">
                {selectedPackages.slice(0, 5).map((pkg) => (
                  <li key={pkg.id} className="font-mono text-foreground">
                    {pkg.organisation.slug}/{pkg.name}
                  </li>
                ))}
                {selectedPackages.length > 5 && (
                  <li className="text-muted-foreground">
                    ...and {selectedPackages.length - 5} more
                  </li>
                )}
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulk-delete-confirmation">
                Type <strong>DELETE</strong> to confirm
              </Label>
              <Input
                id="bulk-delete-confirmation"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false)
                setDeleteConfirmation('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleteConfirmation !== 'DELETE' || bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import from URL Dialog */}
      <ImportFromUrlDialog open={importUrlDialogOpen} onOpenChange={setImportUrlDialogOpen} />
    </div>
  )
}
