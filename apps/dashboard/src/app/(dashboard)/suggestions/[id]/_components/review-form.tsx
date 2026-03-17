'use client'

import { Button } from '@agentver/ui/components/button'
import { Textarea } from '@agentver/ui/components/textarea'
import { cn } from '@agentver/ui-utils'
import { CheckCircle2, MessageSquare, ShieldAlert } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { trpc } from '@/trpc/client'

type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'

type ReviewFormProps = {
  proposalId: string
  canReview: boolean
}

const DECISIONS: {
  value: ReviewDecision
  label: string
  description: string
  icon: typeof CheckCircle2
  colour: string
}[] = [
  {
    value: 'APPROVED',
    label: 'Approve',
    description: 'This suggestion looks good and is ready to merge.',
    icon: CheckCircle2,
    colour: 'border-green-500 bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300',
  },
  {
    value: 'CHANGES_REQUESTED',
    label: 'Request Changes',
    description: 'This suggestion needs changes before it can be merged.',
    icon: ShieldAlert,
    colour:
      'border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-950/30 dark:text-orange-300',
  },
  {
    value: 'COMMENTED',
    label: 'Comment',
    description: 'Submit general feedback without explicit approval.',
    icon: MessageSquare,
    colour: 'border-gray-400 bg-gray-50 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  },
]

export function ReviewForm({ proposalId, canReview }: ReviewFormProps) {
  const [body, setBody] = useState('')
  const [decision, setDecision] = useState<ReviewDecision>('COMMENTED')
  const utils = trpc.useUtils()

  const submitMutation = trpc.proposals.submitReview.useMutation({
    onSuccess: () => {
      setBody('')
      setDecision('COMMENTED')
      utils.proposals.getById.invalidate({ id: proposalId })
    },
  })

  if (!canReview) {
    return null
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    submitMutation.mutate({
      proposalId,
      decision,
      body: body.trim() || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border bg-background p-4">
      <h3 className="mb-3 font-medium text-sm">Submit your review</h3>

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a review comment (optional)..."
        rows={3}
        className="mb-4"
      />

      <div className="mb-4 space-y-2">
        {DECISIONS.map((opt) => {
          const Icon = opt.icon
          const isSelected = decision === opt.value
          return (
            <label
              key={opt.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border-2 p-3 transition-colors',
                isSelected ? opt.colour : 'border-transparent bg-muted/30 hover:bg-muted/50'
              )}
            >
              <input
                type="radio"
                name="review-decision"
                value={opt.value}
                checked={isSelected}
                onChange={() => setDecision(opt.value)}
                className="mt-0.5 accent-primary"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Icon className="size-4" />
                  <span className="font-medium text-sm">{opt.label}</span>
                </div>
                <p className="mt-0.5 text-xs opacity-80">{opt.description}</p>
              </div>
            </label>
          )
        })}
      </div>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={submitMutation.isPending}
          className={cn(
            decision === 'APPROVED' && 'bg-green-600 hover:bg-green-700',
            decision === 'CHANGES_REQUESTED' && 'bg-orange-600 hover:bg-orange-700'
          )}
        >
          {submitMutation.isPending
            ? 'Submitting...'
            : decision === 'APPROVED'
              ? 'Approve'
              : decision === 'CHANGES_REQUESTED'
                ? 'Request Changes'
                : 'Submit Review'}
        </Button>
      </div>
    </form>
  )
}
