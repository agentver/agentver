'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Check, FileText, Settings } from 'lucide-react'
import { AGENT_COLOURS, DETECTED_TYPE_COLOURS, DETECTED_TYPE_LABELS } from './shared-constants'
import type { DetectedFileType, ScannedFile } from './shared-types'

function FileTypeIcon({ detectedType }: { detectedType: DetectedFileType }) {
  if (detectedType === 'AGENT_CONFIG') {
    return <Settings className="size-4 shrink-0 text-muted-foreground" />
  }
  return <FileText className="size-4 shrink-0 text-muted-foreground" />
}

type ScannedFileListProps = {
  files: ScannedFile[]
  selectedPaths: Set<string>
  onToggleFile: (path: string) => void
  /** Compact mode for use within dialogs — hides agent badges and previews, uses tighter spacing */
  compact?: boolean
}

export function ScannedFileList({
  files,
  selectedPaths,
  onToggleFile,
  compact = false,
}: ScannedFileListProps) {
  if (files.length === 0) {
    return (
      <p className="py-4 text-center text-muted-foreground text-sm">
        No skill or config files found in this repository.
      </p>
    )
  }

  const grouped = files.reduce<Record<string, ScannedFile[]>>((groups, file) => {
    const group = groups[file.detectedType] ?? []
    group.push(file)
    groups[file.detectedType] = group
    return groups
  }, {})

  return (
    <div className={compact ? 'max-h-80 space-y-3 overflow-y-auto pr-1' : 'space-y-4'}>
      {Object.entries(grouped).map(([groupType, groupFiles]) => (
        <div key={groupType}>
          <div className={`flex items-center gap-2 ${compact ? 'mb-1.5' : 'mb-2'}`}>
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
          <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
            {groupFiles.map((file) => {
              const isSelected = selectedPaths.has(file.path)
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onToggleFile(file.path)}
                  className={`flex w-full ${compact ? 'items-center gap-3 p-2.5' : 'items-start gap-3 p-3'} rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/50'
                  }`}
                >
                  <div
                    className={`flex shrink-0 items-center justify-center rounded border ${compact ? 'size-4' : 'mt-0.5 h-5 w-5'} ${
                      isSelected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                    }`}
                  >
                    {isSelected && <Check className="size-3" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <FileTypeIcon detectedType={file.detectedType} />
                      <span className={`truncate font-mono ${compact ? 'text-xs' : 'text-sm'}`}>
                        {file.path}
                      </span>
                      <Badge
                        variant="secondary"
                        className={`shrink-0 text-xs ${DETECTED_TYPE_COLOURS[file.detectedType] ?? ''}`}
                      >
                        {DETECTED_TYPE_LABELS[file.detectedType] ?? file.detectedType}
                      </Badge>
                    </div>
                    {!compact && (
                      <>
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
                      </>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
