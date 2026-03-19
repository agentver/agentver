'use client'

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
import { Separator } from '@agentver/ui/components/separator'
import { AlertTriangle, Check, ExternalLink, Info, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { AdoptionModeSelector } from '@/components/sources/adoption-mode-selector'
import { useOrgContext } from '@/hooks/use-org-context'
import { trpc } from '@/trpc/client'
import { ScannedFileList } from './scanned-file-list'
import type { ImportResult, ScannedFile } from './shared-types'

type GitHubImportStep = 'scan' | 'select' | 'importing' | 'done'

export function GitHubImportFlow() {
  const [step, setStep] = useState<GitHubImportStep>('scan')
  const [repoUrl, setRepoUrl] = useState('')
  const [repoLabel, setRepoLabel] = useState('')
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const { selectedOrg } = useOrgContext()

  const accounts = trpc.connections.list.useQuery()
  const hasGitHubAccount = accounts.data?.some((a) => a.provider === 'GITHUB') ?? false

  const [adoptionMode, setAdoptionMode] = useState<'COPY' | 'MIRROR' | 'LINK'>(
    hasGitHubAccount ? 'MIRROR' : 'COPY'
  )

  const scanMutation = trpc.imports.scanGitHub.useMutation({
    onSuccess: (data) => {
      setRepoLabel(data.repo)
      setScannedFiles(data.files)
      setSelectedPaths(new Set(data.files.map((f) => f.path)))

      if (data.files.length === 0) {
        toast.info('No skill or config files found in this repository')
      } else {
        toast.success(`Found ${data.files.length} file${data.files.length === 1 ? '' : 's'}`)
      }

      setStep('select')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const importMutation = trpc.imports.importFromGitHub.useMutation({
    onSuccess: (data) => {
      setImportResult(data)
      setStep('done')

      if (data.errors.length === 0) {
        toast.success(
          `Successfully imported ${data.imported.length} file${data.imported.length === 1 ? '' : 's'}`
        )
      } else {
        toast.warning(`Imported ${data.imported.length}, failed ${data.errors.length}`)
      }

      if (data.syncStatus === 'failed') {
        toast.warning('Mirror sync could not be enabled. You can retry from repository settings.')
      }
    },
    onError: (error) => {
      toast.error(error.message)
      if (step === 'importing') {
        setStep('select')
      }
    },
  })

  const handleScan = useCallback(() => {
    const trimmed = repoUrl.trim()
    if (!trimmed) {
      toast.error('Please enter a repository URL or owner/repo')
      return
    }

    // Detect owner/repo vs URL
    const slashMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/)
    if (slashMatch?.[1] && slashMatch[2]) {
      scanMutation.mutate({ repoOwner: slashMatch[1], repoName: slashMatch[2] })
    } else {
      scanMutation.mutate({ repoUrl: trimmed })
    }
  }, [repoUrl, scanMutation])

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

  const handleImport = useCallback(() => {
    const orgId = selectedOrg?.id
    if (!orgId) {
      toast.error('Create an organisation first')
      return
    }

    const filesToImport = scannedFiles.filter((f) => selectedPaths.has(f.path))
    if (filesToImport.length === 0) {
      toast.error('Select at least one file to import')
      return
    }

    setStep('importing')
    importMutation.mutate({
      repo: repoLabel,
      organisationId: orgId,
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
  }, [selectedOrg, scannedFiles, selectedPaths, repoLabel, adoptionMode, importMutation])

  const handleReset = useCallback(() => {
    setStep('scan')
    setRepoUrl('')
    setRepoLabel('')
    setScannedFiles([])
    setSelectedPaths(new Set())
    setImportResult(null)
    setAdoptionMode('MIRROR')
  }, [])

  if (step === 'scan') {
    return (
      <div className="space-y-4">
        {!hasGitHubAccount && (
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardContent className="flex items-center gap-3 pt-6">
              <Info className="size-5 shrink-0 text-blue-500" />
              <div className="flex-1">
                <p className="text-sm">
                  Scanning as unauthenticated user. Connect your GitHub account for access to
                  private repositories and higher rate limits.
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings/connections">
                  <ExternalLink className="mr-1.5 size-3" />
                  Connect GitHub
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Scan Repository</CardTitle>
            <CardDescription>
              Enter a GitHub repository URL or owner/repo to scan for skills and agent configs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="repo-url">Repository</Label>
              <div className="flex gap-2">
                <Input
                  id="repo-url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.currentTarget.value)}
                  placeholder="https://github.com/owner/repo or owner/repo"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleScan()
                    }
                  }}
                />
                <Button onClick={handleScan} disabled={scanMutation.isPending}>
                  {scanMutation.isPending ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    'Scan'
                  )}
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">
              We&apos;ll look for agent config files (CLAUDE.md, AGENTS.md, .cursorrules,
              .windsurfrules, copilot-instructions.md, and more) plus skill directories.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (step === 'select') {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Discovered Files</CardTitle>
                <CardDescription>
                  Found {scannedFiles.length} file{scannedFiles.length === 1 ? '' : 's'} in{' '}
                  <span className="font-mono text-foreground">{repoLabel}</span>
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={toggleAll}>
                  {selectedPaths.size === scannedFiles.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScannedFileList
              files={scannedFiles}
              selectedPaths={selectedPaths}
              onToggleFile={toggleFile}
            />
          </CardContent>
        </Card>

        <AdoptionModeSelector
          value={adoptionMode}
          onChange={setAdoptionMode}
          disabledModes={
            hasGitHubAccount
              ? undefined
              : { MIRROR: 'Connect your GitHub account to enable mirror sync' }
          }
        />

        <Separator />

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={handleReset}>
            Scan Another Repository
          </Button>
          <Button
            onClick={handleImport}
            disabled={selectedPaths.size === 0 || importMutation.isPending}
          >
            Import {selectedPaths.size} File{selectedPaths.size === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'importing') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
          <p className="font-medium">Importing files...</p>
          <p className="mt-1 text-muted-foreground text-sm">
            Committing files to your package repository
          </p>
        </CardContent>
      </Card>
    )
  }

  // step === 'done'
  return (
    <div className="space-y-4">
      {importResult && importResult.imported.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-green-600 dark:text-green-400">
              Successfully Imported
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {importResult.imported.map((item) => (
                <li key={item.packageId} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span className="font-mono text-sm">{item.path}</span>
                  <span className="text-muted-foreground text-xs">as {item.name}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {importResult && importResult.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {importResult.errors.map((item) => (
                <li key={item.path} className="text-sm">
                  <span className="font-mono">{item.path}</span>
                  <span className="ml-2 text-muted-foreground">{item.error}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {importResult?.syncStatus === 'failed' && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              Mirror Sync Not Active
            </CardTitle>
            <CardDescription>
              Your files were imported successfully, but automatic sync could not be enabled.
              Changes to the source repository will not be mirrored until sync is configured. You
              can retry from the repository settings.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={handleReset}>
          Import More
        </Button>
        <Button asChild>
          <a
            href={
              importResult?.imported.length === 1 && selectedOrg
                ? `/skills/${selectedOrg.slug}/${importResult.imported[0]!.name}`
                : '/skills'
            }
          >
            {importResult?.imported.length === 1 ? 'View Package' : 'View Packages'}
          </a>
        </Button>
      </div>
    </div>
  )
}
