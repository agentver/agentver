'use client'

import { Button } from '@agentver/ui/components/button'
import { cn } from '@agentver/ui-utils'
import { Star } from 'lucide-react'
import { useCallback, useState } from 'react'
import { trpc } from '@/trpc/client'

type StarButtonProps = {
  packageId: string
  className?: string
}

export function StarButton({ packageId, className }: StarButtonProps) {
  const utils = trpc.useUtils()

  const { data, isLoading } = trpc.stars.isStarred.useQuery({ packageId })

  const [optimisticStarred, setOptimisticStarred] = useState<boolean | null>(null)
  const [optimisticCount, setOptimisticCount] = useState<number | null>(null)

  const starred = optimisticStarred ?? data?.starred ?? false
  const count = optimisticCount ?? data?.count ?? 0

  const starMutation = trpc.stars.star.useMutation({
    onMutate: () => {
      setOptimisticStarred(true)
      setOptimisticCount(count + 1)
    },
    onSuccess: (result) => {
      setOptimisticStarred(null)
      setOptimisticCount(null)
      utils.stars.isStarred.setData({ packageId }, { starred: result.starred, count: result.count })
    },
    onError: () => {
      setOptimisticStarred(null)
      setOptimisticCount(null)
    },
  })

  const unstarMutation = trpc.stars.unstar.useMutation({
    onMutate: () => {
      setOptimisticStarred(false)
      setOptimisticCount(Math.max(0, count - 1))
    },
    onSuccess: (result) => {
      setOptimisticStarred(null)
      setOptimisticCount(null)
      utils.stars.isStarred.setData({ packageId }, { starred: result.starred, count: result.count })
    },
    onError: () => {
      setOptimisticStarred(null)
      setOptimisticCount(null)
    },
  })

  const handleClick = useCallback(() => {
    if (starMutation.isPending || unstarMutation.isPending) return

    if (starred) {
      unstarMutation.mutate({ packageId })
    } else {
      starMutation.mutate({ packageId })
    }
  }, [starred, packageId, starMutation, unstarMutation])

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('gap-1.5', className)}
      onClick={handleClick}
      disabled={isLoading}
    >
      <Star
        className={cn(
          'size-3.5',
          starred ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
        )}
      />
      <span>{count}</span>
    </Button>
  )
}
