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
import { Separator } from '@agentver/ui/components/separator'
import { AlertTriangle, Check, FileText, Loader2, Settings } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { AdoptionModeSelector } from '@/components/sources/adoption-mode-selector'
import { useOrgContext } from '@/hooks/use-org-context'
import { trpc } from '@/trpc/client'

type GitHubImportStep = 'connect' | 'scan' | 'select' | 'importing' | 'done'

type DetectedFileType = 'SKILL' | 'AGENT_CONFIG' | 'PLUGIN' | 'SCRIPT' | 'PROMPT'

type ScannedFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  downloadUrl: string
  preview: string | null
}

type ImportResult = {
  imported: Array<{ path: string; packageId: string; name: string }>
  errors: Array<{ path: string; error: string }>
  syncStatus: 'active' | 'failed' | 'not_requested'
}

const DETECTED_TYPE_LABELS: Record<DetectedFileType, string> = {
  AGENT_CONFIG: 'Agent Config',
  SKILL: 'Skill',
  PLUGIN: 'Plugin',
  SCRIPT: 'Script',
  PROMPT: 'Prompt',
}

const DETECTED_TYPE_COLOURS: Record<DetectedFileType, string> = {
  AGENT_CONFIG: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  SKILL: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
  PLUGIN: 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
  SCRIPT: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
  PROMPT: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
}

const AGENT_COLOURS: Record<string, string> = {
  'claude-code': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  cursor: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  codex: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  windsurf: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  copilot: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
  gemini: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  'roo-code': 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  goose: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  junie: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
  aider: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  opencode: 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200',
}

function FileTypeIcon({ detectedType }: { detectedType: DetectedFileType }) {
  if (detectedType === 'AGENT_CONFIG') {
    return <Settings className="h-4 w-4 text-muted-foreground" />
  }
  return <FileText className="h-4 w-4 text-muted-foreground" />
}

export function GitHubImportFlow() {
  const [step, setStep] = useState<GitHubImportStep>('scan')
  const [repoUrl, setRepoUrl] = useState('')
  const [repoLabel, setRepoLabel] = useState('')
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [adoptionMode, setAdoptionMode] = useState<'COPY' | 'MIRROR' | 'LINK'>('MIRROR')

  const { selectedOrg } = useOrgContext()

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
      if (error.message.includes('No GitHub account connected')) {
        setStep('connect')
      }
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

  if (step === 'connect') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect GitHub</CardTitle>
          <CardDescription>
            You need to connect your GitHub account before importing repositories.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings/connections">Connect GitHub Account</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (step === 'scan') {
    return (
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
            {scannedFiles.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground">
                No skill or config files found in this repository.
              </p>
            ) : (
              <div className="space-y-4">
                {Object.entries(
                  scannedFiles.reduce<Record<DetectedFileType, ScannedFile[]>>(
                    (groups, file) => {
                      const group = groups[file.detectedType] ?? []
                      group.push(file)
                      groups[file.detectedType] = group
                      return groups
                    },
                    {} as Record<DetectedFileType, ScannedFile[]>
                  )
                ).map(([groupType, groupFiles]) => (
                  <div key={groupType}>
                    <div className="mb-2 flex items-center gap-2">
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
                    <div className="space-y-2">
                      {groupFiles.map((file) => {
                        const isSelected = selectedPaths.has(file.path)
                        return (
                          <button
                            key={file.path}
                            type="button"
                            onClick={() => toggleFile(file.path)}
                            className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                              isSelected
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:border-muted-foreground/50'
                            }`}
                          >
                            <div
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                                isSelected
                                  ? 'border-primary bg-primary text-primary-foreground'
                                  : 'border-muted-foreground/30'
                              }`}
                            >
                              {isSelected && <Check className="h-3 w-3" />}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <FileTypeIcon detectedType={file.detectedType} />
                                <span className="truncate font-mono text-sm">{file.path}</span>
                                <Badge
                                  variant="secondary"
                                  className={`shrink-0 text-xs ${DETECTED_TYPE_COLOURS[file.detectedType] ?? ''}`}
                                >
                                  {DETECTED_TYPE_LABELS[file.detectedType] ?? file.detectedType}
                                </Badge>
                              </div>
                              <div className="mt-1 flex gap-1.5">
                                <Badge
                                  variant="outline"
                                  className={`text-xs ${AGENT_COLOURS[file.agentId] ?? ''}`}
                                >
                                  {file.agentId}
                                </Badge>
                              </div>
                              {file.preview && (
                                <pre className="mt-2 max-h-24 overflow-hidden text-ellipsis whitespace-pre-wrap rounded bg-muted p-2 font-mono text-muted-foreground text-xs">
                                  {file.preview.slice(0, 200)}
                                  {file.preview.length > 200 ? '...' : ''}
                                </pre>
                              )}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <AdoptionModeSelector value={adoptionMode} onChange={setAdoptionMode} />

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
          <a href="/skills">View Packages</a>
        </Button>
      </div>
    </div>
  )
}
