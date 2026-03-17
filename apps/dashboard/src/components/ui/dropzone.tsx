'use client'

import { cn } from '@agentver/ui-utils'
import { Upload } from 'lucide-react'
import { useCallback, useState } from 'react'

type DropzoneProps = {
  onFileDrop: (files: File[]) => void
  accept?: string
  className?: string
}

export function Dropzone({ onFileDrop, accept, className }: DropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragging(false)

      const fileList = e.dataTransfer?.files
      if (fileList && fileList.length > 0) {
        onFileDrop(Array.from(fileList))
      }
    },
    [onFileDrop]
  )

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors',
        isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
        className
      )}
    >
      <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="font-medium text-sm">Drop SKILL.md files here</p>
      <p className="mt-1 text-muted-foreground text-xs">or click to browse</p>
      <input
        type="file"
        accept={accept ?? '.md'}
        multiple
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => {
          const fileList = e.currentTarget.files
          if (fileList && fileList.length > 0) onFileDrop(Array.from(fileList))
        }}
      />
    </div>
  )
}
