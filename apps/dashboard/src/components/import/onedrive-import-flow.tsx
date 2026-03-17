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
import { Separator } from '@agentver/ui/components/separator'
import { Check, ChevronRight, FileText, Folder, Loader2, Settings } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { AdoptionModeSelector } from '@/components/sources/adoption-mode-selector'
import { useOrgContext } from '@/hooks/use-org-context'
import { trpc } from '@/trpc/client'

type OneDriveImportStep = 'connect' | 'browse' | 'scan' | 'select' | 'importing' | 'done'

type DetectedFileType = 'SKILL' | 'AGENT_CONFIG' | 'PLUGIN' | 'SCRIPT' | 'PROMPT'

type DriveItem = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  size: number
  modifiedTime: string
}

type BreadcrumbEntry = {
  id: string
  name: string
}

type ScannedFile = {
  path: string
  name: string
  type: 'skill' | 'config' | 'rules'
  detectedType: DetectedFileType
  agentId: string
  itemId: string
  preview: string | null
}

type ImportResult = {
  imported: Array<{ path: string; packageId: string; name: string }>
  errors: Array<{ path: string; error: string }>
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function FileTypeIcon({ detectedType }: { detectedType: DetectedFileType }) {
  if (detectedType === 'AGENT_CONFIG') {
    return <Settings className="h-4 w-4 text-muted-foreground" />
  }
  return <FileText className="h-4 w-4 text-muted-foreground" />
}

export function OneDriveImportFlow() {
  const [step, setStep] = useState<OneDriveImportStep>('browse')
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined)
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [selectedFolderName, setSelectedFolderName] = useState('')
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [adoptionMode, setAdoptionMode] = useState<'COPY' | 'MIRROR' | 'LINK'>('COPY')

  const { selectedOrg } = useOrgContext()

  const filesQuery = trpc.imports.listOneDriveFiles.useQuery(
    { folderId: currentFolderId },
    {
      retry: (failureCount, error) => {
        if (error.message.includes('No Microsoft account connected')) {
          return false
        }
        return failureCount < 2
      },
    }
  )

  const scanMutation = trpc.imports.scanOneDrive.useMutation({
    onSuccess: (data) => {
      setScannedFiles(data.files)
      setSelectedPaths(new Set(data.files.map((f) => f.path)))

      if (data.files.length === 0) {
        toast.info('No skill or config files found in this folder')
      } else {
        toast.success(`Found ${data.files.length} file${data.files.length === 1 ? '' : 's'}`)
      }

      setStep('select')
    },
    onError: (error) => {
      if (error.message.includes('No Microsoft account connected')) {
        setStep('connect')
      }
      toast.error(error.message)
    },
  })

  const importMutation = trpc.imports.importFromOneDrive.useMutation({
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
    },
    onError: (error) => {
      toast.error(error.message)
      if (step === 'importing') {
        setStep('select')
      }
    },
  })

  const navigateToFolder = useCallback((folder: DriveItem) => {
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }])
    setCurrentFolderId(folder.id)
  }, [])

  const navigateToBreadcrumb = useCallback(
    (index: number) => {
      if (index < 0) {
        setBreadcrumbs([])
        setCurrentFolderId(undefined)
      } else {
        const entry = breadcrumbs[index]
        if (entry) {
          setBreadcrumbs((prev) => prev.slice(0, index + 1))
          setCurrentFolderId(entry.id)
        }
      }
    },
    [breadcrumbs]
  )

  const handleScanCurrentFolder = useCallback(() => {
    const folderId = currentFolderId
    if (!folderId) {
      toast.error('Please navigate into a folder first')
      return
    }
    const folderName = breadcrumbs[breadcrumbs.length - 1]?.name ?? 'OneDrive'
    setSelectedFolderId(folderId)
    setSelectedFolderName(folderName)
    setStep('scan')
    scanMutation.mutate({ folderId })
  }, [currentFolderId, breadcrumbs, scanMutation])

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

    if (!selectedFolderId) {
      toast.error('No folder selected')
      return
    }

    const filesToImport = scannedFiles.filter((f) => selectedPaths.has(f.path))
    if (filesToImport.length === 0) {
      toast.error('Select at least one file to import')
      return
    }

    setStep('importing')
    importMutation.mutate({
      folderId: selectedFolderId,
      organisationId: orgId,
      adoptionMode,
      files: filesToImport.map((f) => ({
        path: f.path,
        name: f.name,
        type: f.type,
        detectedType: f.detectedType,
        agentId: f.agentId,
        itemId: f.itemId,
      })),
    })
  }, [selectedOrg, scannedFiles, selectedPaths, selectedFolderId, adoptionMode, importMutation])

  const handleReset = useCallback(() => {
    setStep('browse')
    setCurrentFolderId(undefined)
    setBreadcrumbs([])
    setSelectedFolderId(null)
    setSelectedFolderName('')
    setScannedFiles([])
    setSelectedPaths(new Set())
    setImportResult(null)
    setAdoptionMode('COPY')
  }, [])

  const handleBackToBrowse = useCallback(() => {
    setStep('browse')
    setScannedFiles([])
    setSelectedPaths(new Set())
  }, [])

  if (
    step === 'connect' ||
    (filesQuery.error?.message.includes('No Microsoft account connected') && step === 'browse')
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect Microsoft</CardTitle>
          <CardDescription>
            You need to connect your Microsoft account before importing from OneDrive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings/connections">Connect Microsoft Account</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (step === 'browse') {
    const files = filesQuery.data?.files ?? []
    const folders = files.filter((f) => f.isFolder)
    const documents = files.filter((f) => !f.isFolder)

    return (
      <Card>
        <CardHeader>
          <CardTitle>Browse your OneDrive</CardTitle>
          <CardDescription>
            Navigate to a folder containing your skills and agent configs, then scan it for
            importable files.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Breadcrumb navigation */}
          <nav className="flex items-center gap-1 text-sm">
            <button
              type="button"
              onClick={() => navigateToBreadcrumb(-1)}
              className="font-medium text-primary hover:underline"
            >
              OneDrive
            </button>
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => navigateToBreadcrumb(index)}
                  className={`font-medium ${
                    index === breadcrumbs.length - 1
                      ? 'text-foreground'
                      : 'text-primary hover:underline'
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>

          <Separator />

          {filesQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="mb-2 h-6 w-6 animate-spin text-primary" />
              <p className="text-muted-foreground text-sm">Loading files...</p>
            </div>
          ) : filesQuery.isError ? (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">
                Unable to access your drive. Please reconnect in Settings.
              </p>
              <Button asChild variant="outline" className="mt-3">
                <Link href="/settings/connections">Reconnect</Link>
              </Button>
            </div>
          ) : files.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No files found in this folder</p>
          ) : (
            <div className="space-y-1">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => navigateToFolder(folder)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-muted-foreground/50 hover:bg-muted/50"
                >
                  <Folder className="h-5 w-5 shrink-0 text-blue-500" />
                  <div className="min-w-0 flex-1">
                    <span className="truncate font-medium text-sm">{folder.name}</span>
                  </div>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {formatDate(folder.modifiedTime)}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
              {documents.map((file) => (
                <div
                  key={file.id}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-3"
                >
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm">{file.name}</span>
                  </div>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {formatFileSize(file.size)}
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {formatDate(file.modifiedTime)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {currentFolderId && (
            <>
              <Separator />
              <div className="flex justify-end">
                <Button onClick={handleScanCurrentFolder} disabled={scanMutation.isPending}>
                  {scanMutation.isPending ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    'Scan This Folder'
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    )
  }

  if (step === 'scan') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
          <p className="font-medium">Scanning folder...</p>
          <p className="mt-1 text-muted-foreground text-sm">
            Looking for skills and agent configs in{' '}
            <span className="font-mono text-foreground">{selectedFolderName}</span>
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
                  <span className="font-mono text-foreground">{selectedFolderName}</span>
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
                No skill or config files found in this folder.
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

        <AdoptionModeSelector
          value={adoptionMode}
          onChange={setAdoptionMode}
          disabledModes={{
            MIRROR: 'Coming soon — mirror sync is not available for cloud storage.',
          }}
        />

        <Separator />

        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={handleBackToBrowse}>
            Browse Another Folder
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
