import type { CLIOutput, DiffResult, ProposalsResult } from '@agentver/shared'
import { diffResultSchema, proposalsResultSchema, proposeResultSchema } from '@agentver/shared'
import { useCallback, useEffect, useState } from 'react'
import { runCLI } from '../lib/cli-bridge'

export function useProposals() {
  const [proposals, setProposals] = useState<ProposalsResult['proposals']>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchProposals = useCallback(async (packageName?: string) => {
    setLoading(true)
    setError(null)
    const args = packageName ? [packageName] : []
    const result = await runCLI('proposals', args, proposalsResultSchema)
    if (result.success && result.data) {
      setProposals(result.data.proposals)
    } else {
      setError(result.error?.message ?? 'Failed to fetch proposals')
    }
    setLoading(false)
  }, [])

  const createProposal = useCallback(
    async (name: string, title: string) => {
      const result = await runCLI('propose', [name, title], proposeResultSchema)
      if (result.success) {
        await fetchProposals()
      }
      return result
    },
    [fetchProposals]
  )

  const fetchDiff = useCallback(async (name: string): Promise<CLIOutput<DiffResult>> => {
    return runCLI('diff', [name], diffResultSchema)
  }, [])

  useEffect(() => {
    fetchProposals()
  }, [fetchProposals])

  return { proposals, loading, error, fetchProposals, createProposal, fetchDiff }
}
