'use client'

import { Button } from '@agentver/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@agentver/ui/components/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentver/ui/components/dialog'
import { cn } from '@agentver/ui-utils'
import { ArrowLeft, File, FileCode, FileJson, FileText, Folder, Trash2 } from 'lucide-react'
import { use, useState } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'
import { SkillHeader } from '../_components/skill-header'
import { SkillPageSkeleton } from '../_components/skill-page-skeleton'
import { SkillTabs } from '../_components/skill-tabs'
import { useCanManage } from '../_components/use-can-manage'

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'md':
      return FileText
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'sh':
    case 'yaml':
    case 'yml':
      return FileCode
    case 'json':
      return FileJson
    default:
      return File
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function FilesPage({ params }: { params: Promise<{ org: string; name: string }> }) {
  const { org, name } = use(params)
  const utils = trpc.useUtils()
  const { data: pkg, isLoading: pkgLoading } = trpc.skills.getBySlug.useQuery({ org, name })
  const canManage = useCanManage(org, pkg?.authorId)

  const {
    data: files,
    isLoading: filesLoading,
    error: filesError,
  } = trpc.git.getSkillFiles.useQuery({ org, name })

  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: fileContent, isLoading: contentLoading } = trpc.git.getSkillFileContent.useQuery(
    { org, name, path: selectedFile! },
    { enabled: selectedFile !== null }
  )

  const removeFileMutation = trpc.git.removeSkillFile.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(`${variables.filePath} has been removed`)
      utils.git.getSkillFiles.invalidate({ org, name })
      setDeleteTarget(null)
    },
    onError: (error) => {
      toast.error('Failed to remove file', { description: error.message })
    },
  })

  if (pkgLoading) {
    return <SkillPageSkeleton />
  }

  if (!pkg) {
    return <div className="py-16 text-center text-muted-foreground">Package not found</div>
  }

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    removeFileMutation.mutate({ org, name, filePath: deleteTarget })
  }

  return (
    <div className="space-y-6">
      <SkillHeader pkg={pkg} org={org} name={name} canManage={canManage} />
      <SkillTabs org={org} name={name} canManage={canManage} />

      {selectedFile ? (
        <FileViewer
          org={org}
          name={name}
          filePath={selectedFile}
          content={fileContent?.content ?? null}
          isLoading={contentLoading}
          onBack={() => setSelectedFile(null)}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Files</CardTitle>
          </CardHeader>
          <CardContent>
            {filesLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : filesError ? (
              <div className="py-8 text-center text-muted-foreground">
                <p>Unable to load files from Git.</p>
                <p className="mt-1 text-xs">
                  Ensure Forgejo is configured and the namespace exists.
                </p>
              </div>
            ) : !files || files.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <File className="mx-auto size-8" />
                <p className="mt-3">No files found</p>
              </div>
            ) : (
              <div className="rounded-lg border">
                {files.map((file, index) => {
                  const Icon = file.type === 'dir' ? Folder : getFileIcon(file.name)
                  const isLast = index === files.length - 1
                  const canDelete = canManage && file.type === 'file' && file.name !== 'SKILL.md'

                  return (
                    <div
                      key={file.path}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2.5 text-sm',
                        !isLast && 'border-b'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (file.type === 'file') {
                            setSelectedFile(file.path)
                          }
                        }}
                        disabled={file.type !== 'file'}
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-3 text-left transition-colors',
                          file.type === 'file'
                            ? 'cursor-pointer hover:text-foreground'
                            : 'cursor-default opacity-60'
                        )}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate font-mono text-xs">{file.path}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatFileSize(file.size)}
                        </span>
                      </button>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(file.path)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Delete File Confirmation Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget}</DialogTitle>
            <DialogDescription>
              This file will be permanently removed from the skill repository. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={removeFileMutation.isPending}
            >
              {removeFileMutation.isPending ? 'Deleting...' : 'Delete file'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FileViewer({
  org,
  name,
  filePath,
  content,
  isLoading,
  onBack,
}: {
  org: string
  name: string
  filePath: string
  content: string | null
  isLoading: boolean
  onBack: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate font-mono text-sm">
              {org}/{name}/{filePath}
            </CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-muted"
                style={{ width: `${60 + Math.random() * 40}%` }}
              />
            ))}
          </div>
        ) : content === null ? (
          <div className="py-8 text-center text-muted-foreground">
            File not found or could not be loaded.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-muted/30">
            <pre className="p-4 font-mono text-sm leading-relaxed">
              <code>{content}</code>
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
