'use client'

import { Button } from '@agentver/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentver/ui/components/dialog'
import { Input } from '@agentver/ui/components/input'
import { Label } from '@agentver/ui/components/label'
import { Textarea } from '@agentver/ui/components/textarea'
import { cn } from '@agentver/ui-utils'
import { ArrowLeft, Lightbulb, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { use, useState } from 'react'
import { ProposalCard } from '@/components/proposals/proposal-card'
import { trpc } from '@/trpc/client'

type FilterTab = 'open' | 'closed' | 'all'

export default function ProposalsListPage({
  params,
}: {
  params: Promise<{ org: string; name: string }>
}) {
  const { org, name } = use(params)
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<FilterTab>('open')
  const [newProposalOpen, setNewProposalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')

  const { data: pkg, isLoading: pkgLoading } = trpc.skills.getBySlug.useQuery({ org, name })

  const { data: proposalsData, isLoading: proposalsLoading } = trpc.proposals.list.useQuery(
    {
      packageId: pkg?.id ?? '',
      ...(activeTab === 'open' && { status: 'OPEN' as const }),
      ...(activeTab === 'closed' && { status: 'CLOSED' as const }),
    },
    { enabled: !!pkg?.id }
  )

  const createMutation = trpc.proposals.create.useMutation({
    onSuccess: (proposal) => {
      setNewProposalOpen(false)
      setTitle('')
      setDescription('')
      setContent('')
      router.push(`/skills/${org}/${name}/proposals/${proposal.id}`)
    },
  })

  const handleCreateProposal = () => {
    if (!pkg || !title.trim() || !content.trim()) return
    createMutation.mutate({
      packageId: pkg.id,
      title: title.trim(),
      description: description.trim() || undefined,
      content: content.trim(),
    })
  }

  const handleOpenNewProposal = () => {
    setContent(pkg?.readme ?? '')
    setNewProposalOpen(true)
  }

  if (pkgLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 rounded bg-muted" />
        <div className="h-4 w-96 rounded bg-muted" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (!pkg) {
    return <div className="py-16 text-center text-muted-foreground">Package not found</div>
  }

  const proposals = proposalsData?.proposals ?? []
  const isLoading = proposalsLoading

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'open', label: 'Open' },
    { key: 'closed', label: 'Closed' },
    { key: 'all', label: 'All' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/skills/${org}/${name}`}
          className="mb-3 inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to {name}
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display font-semibold text-2xl">Suggestions</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Suggested changes for {org}/{name}
            </p>
          </div>
          <Button onClick={handleOpenNewProposal}>
            <Plus className="mr-1.5 size-4" />
            New Suggestion
          </Button>
        </div>
      </div>

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium text-sm transition-all',
              activeTab === tab.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
            <Lightbulb className="size-5" />
          </div>
          <p className="mt-4 font-display font-medium text-lg">No suggestions yet</p>
          <p className="mt-1 max-w-sm text-muted-foreground text-sm">
            Be the first to suggest changes! Suggestions let you recommend improvements without
            directly editing the package.
          </p>
          <Button className="mt-4" onClick={handleOpenNewProposal}>
            <Plus className="mr-1.5 size-4" />
            Suggest Changes
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              id={proposal.id}
              title={proposal.title}
              status={proposal.status}
              author={proposal.author}
              commentCount={proposal._count.comments}
              reviewCount={proposal._count.reviews}
              createdAt={proposal.createdAt}
              orgSlug={org}
              packageName={name}
            />
          ))}
        </div>
      )}

      <Dialog open={newProposalOpen} onOpenChange={setNewProposalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Suggest Changes</DialogTitle>
            <DialogDescription>
              Propose changes to {org}/{name}. The package maintainers will review your suggestion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="proposal-title">Title</Label>
              <Input
                id="proposal-title"
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder="Brief summary of your changes"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-description">Description (optional)</Label>
              <Textarea
                id="proposal-description"
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
                placeholder="Explain why you're suggesting these changes..."
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-content">Proposed Content</Label>
              <Textarea
                id="proposal-content"
                value={content}
                onChange={(e) => setContent(e.currentTarget.value)}
                placeholder="Enter the proposed package content..."
                rows={12}
                className="resize-none font-mono text-sm"
              />
              <p className="text-muted-foreground text-xs">
                Edit the content above to reflect your suggested changes.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewProposalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateProposal}
              disabled={!title.trim() || !content.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Submitting...' : 'Submit Suggestion'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
