import { useCallback, useEffect, useRef, useState } from 'react'
import { useProject } from '../context/ProjectContext'
import { useSearchSkills } from './useCLI'

type TypeFilter = 'all' | 'skill' | 'config' | 'plugin' | 'script' | 'prompt'
type BrowserSearchResult = {
  name: string
  description: string
  type: string
  source: string
  url?: string
}

export function useSearch() {
  const { activeProject } = useProject()
  const effectiveCwd = activeProject ?? undefined
  const { data, error, loading, execute } = useSearchSkills()
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const search = useCallback(
    (q: string, type: TypeFilter = 'all') => {
      if (debounceRef.current) clearTimeout(debounceRef.current)

      if (!q.trim()) return

      debounceRef.current = setTimeout(() => {
        const args = [q]
        if (type !== 'all') args.push('--type', type)
        execute(args, effectiveCwd)
      }, 300)
    },
    [execute, effectiveCwd]
  )

  useEffect(() => {
    search(query, typeFilter)
  }, [query, typeFilter, search])

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const filteredResults: BrowserSearchResult[] = data
    ? [
        ...data.platform.map((result) => ({
          name: `${result.organisation.slug}/${result.slug}`,
          description: result.description ?? '',
          type: result.type,
          source: 'platform',
          url: `agentver://${result.organisation.slug}/skills/${result.slug}`,
        })),
        ...data.community.map((result) => ({
          name: result.name,
          description: result.description ?? '',
          type: 'SKILL',
          source: 'community',
          url: `github.com/${result.source}/${result.name}`,
        })),
        ...data.wellKnown.map((result) => ({
          name: result.name,
          description: result.description,
          type: 'SKILL',
          source: 'well-known',
          url: result.url,
        })),
      ]
    : []

  return {
    query,
    setQuery,
    typeFilter,
    setTypeFilter,
    results: filteredResults,
    loading,
    error,
    hasSearched: query.trim().length > 0,
  }
}

export type { TypeFilter }
