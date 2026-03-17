'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@agentver/ui/components/tabs'
import matter from 'gray-matter'
import { AlertTriangle, ExternalLink, LinkIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { SkillEditorSaveData } from '@/components/editor/skill-editor'
import { SkillEditor } from '@/components/editor/skill-editor'
import { Dropzone } from '@/components/ui/dropzone'
import { trpc } from '@/trpc/client'

const SKILL_TEMPLATE = `---
name: my-skill
description: A brief description of what this skill does
version: 1.0.0
---

# My Skill

## Instructions

Add your skill instructions here.
`

type ParsedFrontmatter = {
  name: string
  description: string
  tags: string[]
  type: 'SKILL' | 'AGENT_CONFIG' | 'PLUGIN' | 'SCRIPT' | 'PROMPT'
}

const VALID_PACKAGE_TYPES = new Set(['SKILL', 'AGENT_CONFIG', 'PLUGIN', 'SCRIPT', 'PROMPT'])

function parseFrontmatter(raw: string): { metadata: ParsedFrontmatter; content: string } {
  const { data, content } = matter(raw)

  const rawType = typeof data.type === 'string' ? data.type.toUpperCase() : 'SKILL'

  return {
    metadata: {
      name: typeof data.name === 'string' ? data.name : '',
      description: typeof data.description === 'string' ? data.description : '',
      tags: Array.isArray(data.tags)
        ? data.tags.filter((t): t is string => typeof t === 'string')
        : [],
      type: VALID_PACKAGE_TYPES.has(rawType) ? (rawType as ParsedFrontmatter['type']) : 'SKILL',
    },
    content: content.trim(),
  }
}

export default function NewSkillPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<string>('editor')
  const [editorKey, setEditorKey] = useState(0)
  const [parsedContent, setParsedContent] = useState<string>(SKILL_TEMPLATE)
  const [parsedName, setParsedName] = useState('')
  const [parsedDescription, setParsedDescription] = useState('')
  const [parsedTags, setParsedTags] = useState<string[]>([])

  const orgs = trpc.organisations.list.useQuery()
  const { data: githubStatus } = trpc.connections.getStatus.useQuery({ provider: 'GITHUB' })

  // Determine if the first org has a skills repo connected
  const firstOrg = orgs.data?.[0]
  const hasSkillsRepo = Boolean(
    firstOrg?.skillsRepoOwner || firstOrg?.skillsRepoProvider === 'agentver'
  )

  // Git-native creation
  const createViaWebMutation = trpc.skills.createViaWeb.useMutation({
    onSuccess: (result) => {
      toast.success('Skill created and committed to Git', {
        description: `${result.commitSha.slice(0, 7)} committed`,
        ...(result.commitUrl
          ? {
              action: {
                label: 'View commit',
                onClick: () => window.open(result.commitUrl!, '_blank'),
              },
            }
          : {}),
      })
      router.push(`/skills/${result.slug}`)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Legacy creation (no skills repo)
  const createMutation = trpc.skills.create.useMutation({
    onSuccess: (pkg) => {
      toast.success('Package created')
      router.push(`/skills/${pkg.slug}`)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleFileDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return

    if (!file.name.endsWith('.md')) {
      toast.error('Only .md files are supported')
      return
    }

    try {
      const text = await file.text()
      const { metadata, content } = parseFrontmatter(text)

      setParsedName(metadata.name)
      setParsedDescription(metadata.description)
      setParsedTags(metadata.tags)
      setParsedContent(content)
      setEditorKey((prev) => prev + 1)
      setActiveTab('editor')

      const extractedFields = [
        metadata.name && 'name',
        metadata.description && 'description',
        metadata.tags.length > 0 && 'tags',
      ].filter(Boolean)

      const detail =
        extractedFields.length > 0
          ? `Extracted ${extractedFields.join(', ')} from frontmatter`
          : 'No frontmatter metadata found'

      toast.success(`Imported ${file.name}`, { description: detail })
    } catch {
      toast.error(`Failed to parse ${file.name}`)
    }
  }, [])

  const handleSave = (data: SkillEditorSaveData) => {
    const orgId = firstOrg?.id
    if (!orgId) {
      toast.error('Create an organisation first')
      return
    }

    if (hasSkillsRepo) {
      createViaWebMutation.mutate({
        name: data.name,
        description: data.description || undefined,
        content: data.content,
        tags: data.tags,
        organisationId: orgId,
      })
    } else {
      createMutation.mutate({
        name: data.name,
        description: data.description || undefined,
        content: data.content,
        tags: data.tags,
        organisationId: orgId,
      })
    }
  }

  const isSaving = createViaWebMutation.isPending || createMutation.isPending

  // No GitHub account connected — only gate when the org uses GitHub, not Agentver
  if (githubStatus && !githubStatus.connected && firstOrg?.skillsRepoProvider !== 'agentver') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-display font-semibold text-3xl tracking-tight">Create Package</h2>
          <p className="text-muted-foreground leading-relaxed">
            A skill is a set of instructions that tells AI coding assistants how to work on your
            project.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
            <LinkIcon className="size-5" />
          </div>
          <h3 className="mt-4 font-display font-semibold text-lg">GitHub account required</h3>
          <p className="mt-1 max-w-sm text-muted-foreground text-sm">
            Connect your GitHub account to create skills. Changes are committed directly to your
            organisation&apos;s package repository.
          </p>
          <Link
            href="/settings"
            className="mt-4 inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
          >
            Go to Settings <ExternalLink className="size-3" />
          </Link>
        </div>
      </div>
    )
  }

  // Org exists but has no skills repo connected
  if (firstOrg && !hasSkillsRepo) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-display font-semibold text-3xl tracking-tight">Create Package</h2>
          <p className="text-muted-foreground leading-relaxed">
            A skill is a set of instructions that tells AI coding assistants how to work on your
            project.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
            <AlertTriangle className="size-5" />
          </div>
          <h3 className="mt-4 font-display font-semibold text-lg">
            No package repository connected
          </h3>
          <p className="mt-1 max-w-sm text-muted-foreground text-sm">
            Connect a GitHub repository to your organisation to start creating packages. An admin
            can set this up in the organisation settings.
          </p>
          <Link
            href="/settings"
            className="mt-4 inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
          >
            Go to Settings <ExternalLink className="size-3" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-semibold text-2xl tracking-tight">Create Package</h2>
        <p className="text-muted-foreground leading-relaxed">
          A skill is a set of instructions that tells AI coding assistants how to work on your
          project. You can also create agent configs, plugins, scripts, and prompts.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="mt-4">
          <div className="h-[calc(100vh-20rem)] rounded-lg border">
            <SkillEditor
              key={editorKey}
              initialContent={parsedContent}
              initialName={parsedName}
              initialDescription={parsedDescription}
              initialTags={parsedTags}
              gitPath={hasSkillsRepo ? `skills/{name}/SKILL.md` : undefined}
              saving={isSaving}
              onSave={handleSave}
            />
          </div>
        </TabsContent>

        <TabsContent value="upload" className="mt-4">
          <Dropzone onFileDrop={handleFileDrop} className="relative min-h-[300px]" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
