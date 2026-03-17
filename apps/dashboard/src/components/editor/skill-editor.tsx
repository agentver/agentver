'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { Separator } from '@agentver/ui/components/separator'
import { Code, Eye, GitCommit, Save } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useState } from 'react'
import { MarkdownPreview } from './markdown-preview'

const CodeEditor = dynamic(
  () => import('./code-editor').then((mod) => ({ default: mod.CodeEditor })),
  { ssr: false, loading: () => <div className="h-full animate-pulse bg-muted" /> }
)

export type SkillEditorSaveData = {
  name: string
  description: string
  content: string
  tags: string[]
  commitMessage: string
}

type SkillEditorProps = {
  initialContent?: string
  initialName?: string
  initialDescription?: string
  initialTags?: string[]
  gitPath?: string | null
  contentSource?: 'git' | 'database' | null
  onSave?: (data: SkillEditorSaveData) => void
  saving?: boolean
  readOnlyName?: boolean
}

export function SkillEditor({
  initialContent = '',
  initialName = '',
  initialDescription = '',
  initialTags = [],
  gitPath,
  contentSource,
  onSave,
  saving = false,
  readOnlyName = false,
}: SkillEditorProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [content, setContent] = useState(initialContent)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [tagInput, setTagInput] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !tags.includes(tag) && tags.length < 20) {
      setTags([...tags, tag])
      setTagInput('')
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const handleSave = () => {
    onSave?.({
      name,
      description,
      content,
      tags,
      commitMessage: commitMessage.trim() || `Update ${name || 'skill'} via Agentver`,
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="my-skill"
              readOnly={readOnlyName}
              className={readOnlyName ? 'bg-muted' : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder="What does this skill do?"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Tags</Label>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="cursor-pointer"
                onClick={() => handleRemoveTag(tag)}
              >
                {tag} &times;
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddTag()
                }
              }}
              placeholder="Add tag..."
              className="max-w-xs"
            />
            <Button variant="outline" size="sm" onClick={handleAddTag}>
              Add
            </Button>
          </div>
        </div>

        {/* Git info and commit message */}
        {gitPath && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <GitCommit className="size-3" />
              <span className="font-mono">{gitPath}</span>
              {contentSource && (
                <Badge variant="outline" className="ml-1 text-[10px]">
                  {contentSource === 'git' ? 'From Git' : 'From database'}
                </Badge>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="commit-message">Commit message</Label>
          <Input
            id="commit-message"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.currentTarget.value)}
            placeholder={`Update ${name || 'skill'} via Agentver`}
          />
        </div>
      </div>

      <Separator />

      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex gap-1">
          <Button
            variant={mode === 'edit' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('edit')}
          >
            <Code className="mr-1 h-3 w-3" /> Edit
          </Button>
          <Button
            variant={mode === 'preview' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setMode('preview')}
          >
            <Eye className="mr-1 h-3 w-3" /> Preview
          </Button>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving || !name} variant="default">
            <Save className="mr-1 h-3 w-3" /> {saving ? 'Committing...' : 'Commit & Save'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {mode === 'edit' ? (
          <CodeEditor value={content} onChange={setContent} className="h-full" />
        ) : (
          <MarkdownPreview content={content} className="p-4" />
        )}
      </div>
    </div>
  )
}
