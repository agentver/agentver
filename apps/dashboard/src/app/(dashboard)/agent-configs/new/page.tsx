'use client'

import { Badge } from '@agentver/ui/components/badge'
import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { Separator } from '@agentver/ui/components/separator'
import { Textarea } from '@agentver/ui/components/textarea'
import { cn } from '@agentver/ui-utils'
import { Code, Eye, Save } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { MarkdownPreview } from '@/components/editor/markdown-preview'
import { trpc } from '@/trpc/client'

const CodeEditor = dynamic(
  () => import('@/components/editor/code-editor').then((mod) => ({ default: mod.CodeEditor })),
  { ssr: false, loading: () => <div className="h-full animate-pulse bg-muted" /> }
)

const TARGET_AGENTS = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'claude-cowork', label: 'Claude Cowork' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'codex', label: 'OpenAI Codex' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'copilot', label: 'GitHub Copilot' },
  { id: 'goose', label: 'Goose' },
  { id: 'roo-code', label: 'Roo Code' },
  { id: 'junie', label: 'JetBrains Junie' },
  { id: 'aider', label: 'Aider' },
  { id: 'opencode', label: 'OpenCode' },
] as const

type TargetAgentId = (typeof TARGET_AGENTS)[number]['id']

const CONFIG_TEMPLATE = `# My Agent Config

## Rules

- Add your rules and instructions here.
- These will be translated to each target agent's native config format.

## Standards

- Use consistent naming conventions
- Follow existing patterns in the codebase
`

const AGENT_FILE_MAP: Record<string, string> = {
  'claude-code': 'CLAUDE.md',
  'claude-cowork': 'CLAUDE.md',
  cursor: '.cursorrules',
  codex: 'AGENTS.md',
  windsurf: '.windsurfrules',
  copilot: '.github/copilot-instructions.md',
  gemini: 'AGENTS.md',
  'roo-code': '.roo/rules/{name}.md',
  goose: '.goose/config.yaml',
  junie: '.junie/guidelines.md',
  aider: '.aider.conf.yml',
  opencode: 'AGENTS.md',
}

function generatePreview(content: string, agentId: string, name: string): string {
  if (agentId === 'goose') {
    const escaped = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return `instructions: "${escaped}"\n`
  }

  if (agentId === 'aider') {
    return `read:\n  - AGENTS.md\n`
  }

  if (agentId === 'roo-code') {
    return `# ${name}\n\n${content}`
  }

  return content
}

export default function NewAgentConfigPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState(CONFIG_TEMPLATE)
  const [selectedAgents, setSelectedAgents] = useState<Set<TargetAgentId>>(new Set(['claude-code']))
  const [composable, setComposable] = useState(false)
  const [baseConfig, setBaseConfig] = useState('')
  const [baseConfigSearch, setBaseConfigSearch] = useState('')
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit')
  const [previewAgent, setPreviewAgent] = useState<string>('claude-code')

  const orgs = trpc.organisations.list.useQuery()
  const createMutation = trpc.skills.create.useMutation({
    onSuccess: (pkg) => {
      toast.success('Agent config created')
      router.push(`/skills/${pkg.slug}`)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const { data: existingConfigs } = trpc.skills.list.useQuery({
    type: 'AGENT_CONFIG',
    search: baseConfigSearch || undefined,
  })

  const handleToggleAgent = useCallback((agentId: TargetAgentId) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) {
        next.delete(agentId)
      } else {
        next.add(agentId)
      }
      return next
    })
  }, [])

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Package name is required')
      return
    }

    if (!description.trim()) {
      toast.error('Description is required')
      return
    }

    if (selectedAgents.size === 0) {
      toast.error('Select at least one target agent')
      return
    }

    const orgId = orgs.data?.[0]?.id
    if (!orgId) {
      toast.error('Create an organisation first')
      return
    }

    const fullContent = `---
name: ${name}
description: ${description}
type: AGENT_CONFIG
targetAgents: [${Array.from(selectedAgents).join(', ')}]
composable: ${composable}${baseConfig ? `\nbaseConfig: ${baseConfig}` : ''}
---

${content}`

    createMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      type: 'AGENT_CONFIG',
      content: fullContent,
      tags: Array.from(selectedAgents),
      organisationId: orgId,
    })
  }

  const previewContent = useMemo(() => {
    if (!previewAgent) return content
    return generatePreview(content, previewAgent, name || 'my-config')
  }, [content, previewAgent, name])

  const previewFilePath = useMemo(() => {
    const template = AGENT_FILE_MAP[previewAgent] ?? 'CLAUDE.md'
    return template.replace('{name}', name || 'my-config')
  }, [previewAgent, name])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-semibold text-2xl tracking-tight">Create Agent Config</h2>
        <p className="text-muted-foreground">
          Define rules and instructions that get translated to each agent's native format.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Main editor area */}
        <div className="space-y-6">
          {/* Metadata */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="config-name">Package Name</Label>
                <Input
                  id="config-name"
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  placeholder="my-team-config"
                  pattern="^[a-z0-9-]+$"
                />
                <p className="text-muted-foreground text-xs">
                  Lowercase, hyphens only (e.g. my-team-config)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="config-description">Description</Label>
                <Textarea
                  id="config-description"
                  value={description}
                  onChange={(e) => setDescription(e.currentTarget.value)}
                  placeholder="Shared coding standards for the team..."
                  className="min-h-[68px] resize-none"
                />
              </div>
            </div>

            {/* Target Agents */}
            <div className="space-y-2">
              <Label>Target Agents</Label>
              <div className="flex flex-wrap gap-2">
                {TARGET_AGENTS.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => handleToggleAgent(agent.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 font-medium text-xs transition-colors',
                      selectedAgents.has(agent.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                    )}
                  >
                    {agent.label}
                  </button>
                ))}
              </div>
              {selectedAgents.size === 0 && (
                <p className="text-destructive text-xs">Select at least one target agent</p>
              )}
            </div>

            {/* Composable toggle */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={composable}
                onClick={() => setComposable((prev) => !prev)}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                  composable
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border hover:border-muted-foreground/50'
                )}
              >
                {composable && (
                  <svg className="size-3" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6l3 3 5-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
              <div>
                <Label className="cursor-pointer" onClick={() => setComposable((prev) => !prev)}>
                  Composable
                </Label>
                <p className="text-muted-foreground text-xs">
                  Allow this config to be layered with other configs
                </p>
              </div>
            </div>

            {/* Base config selector */}
            <div className="space-y-2">
              <Label>Base Config (optional)</Label>
              <p className="text-muted-foreground text-xs">
                Extend an existing agent config. Your rules will overlay on top of the base.
              </p>
              <Input
                value={baseConfigSearch}
                onChange={(e) => setBaseConfigSearch(e.currentTarget.value)}
                placeholder="Search existing configs..."
                className="max-w-xs"
              />
              {baseConfigSearch &&
                existingConfigs?.packages &&
                existingConfigs.packages.length > 0 && (
                  <div className="max-h-32 overflow-y-auto rounded-md border">
                    {existingConfigs.packages.map((pkg) => (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => {
                          setBaseConfig(pkg.slug)
                          setBaseConfigSearch('')
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                          baseConfig === pkg.slug && 'bg-muted'
                        )}
                      >
                        <span className="font-medium">{pkg.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {pkg.organisation.slug}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              {baseConfig && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    Extends: {baseConfig}
                    <button
                      type="button"
                      onClick={() => setBaseConfig('')}
                      className="ml-1.5 text-muted-foreground hover:text-foreground"
                    >
                      &times;
                    </button>
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="h-[calc(100vh-42rem)] min-h-[300px] rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <div className="flex gap-1">
                <Button
                  variant={editorMode === 'edit' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setEditorMode('edit')}
                >
                  <Code className="mr-1 h-3 w-3" /> Edit
                </Button>
                <Button
                  variant={editorMode === 'preview' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setEditorMode('preview')}
                >
                  <Eye className="mr-1 h-3 w-3" /> Preview
                </Button>
              </div>
              <Button
                onClick={handleSave}
                disabled={
                  createMutation.isPending || !name || !description || selectedAgents.size === 0
                }
                variant="outline"
              >
                <Save className="mr-1 h-3 w-3" />
                {createMutation.isPending ? 'Creating...' : 'Create Config'}
              </Button>
            </div>

            <div className="h-[calc(100%-3rem)] overflow-auto">
              {editorMode === 'edit' ? (
                <CodeEditor value={content} onChange={setContent} className="h-full" />
              ) : (
                <MarkdownPreview content={content} className="p-4" />
              )}
            </div>
          </div>
        </div>

        {/* Preview panel */}
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="font-display font-semibold text-sm">Agent Preview</h3>
            <p className="text-muted-foreground text-xs">
              See how your config will look in each agent's native format.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {Array.from(selectedAgents).map((agentId) => {
                const agent = TARGET_AGENTS.find((a) => a.id === agentId)
                if (!agent) return null

                return (
                  <button
                    key={agentId}
                    type="button"
                    onClick={() => setPreviewAgent(agentId)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      previewAgent === agentId
                        ? 'border-primary bg-primary/10 font-medium text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {agent.label}
                  </button>
                )
              })}
            </div>

            {selectedAgents.size > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-muted-foreground text-xs">
                      {previewFilePath}
                    </span>
                  </div>
                  <div className="max-h-[50vh] overflow-auto rounded-md bg-muted p-3">
                    <pre className="whitespace-pre-wrap text-xs leading-relaxed">
                      {previewContent}
                    </pre>
                  </div>
                </div>
              </>
            )}

            {selectedAgents.size === 0 && (
              <p className="text-muted-foreground text-xs italic">
                Select target agents to see previews.
              </p>
            )}
          </div>

          {/* Summary */}
          <div className="space-y-3 rounded-lg border p-4">
            <h3 className="font-display font-semibold text-sm">Summary</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Type</dt>
                <dd>
                  <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                    Agent Config
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Targets</dt>
                <dd className="font-mono text-xs">{selectedAgents.size} agent(s)</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Composable</dt>
                <dd>{composable ? 'Yes' : 'No'}</dd>
              </div>
              {baseConfig && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Extends</dt>
                  <dd className="max-w-[180px] truncate font-mono text-xs">{baseConfig}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
