import type { CLIOutput } from '@agentver/shared'
import {
  type AdoptResult,
  type AuditResult,
  adoptResultSchema,
  auditResultSchema,
  type InstallResult,
  installResultSchema,
  type ListResult,
  listResultSchema,
  type RemoveResult,
  removeResultSchema,
  type ScanResult,
  type SearchResult,
  type StatusResult,
  scanResultSchema,
  searchResultSchema,
  statusResultSchema,
} from '@agentver/shared'
import { useCallback, useState } from 'react'
import type { z } from 'zod'
import { runCLI } from '../lib/cli-bridge'

type UseCLIState<T> = {
  data: T | null
  error: string | null
  loading: boolean
  warnings: string[]
}

function useCLICommand<T>(command: string, schema: z.ZodType<T>) {
  const [state, setState] = useState<UseCLIState<T>>({
    data: null,
    error: null,
    loading: false,
    warnings: [],
  })

  const execute = useCallback(
    async (args: string[] = [], cwd?: string): Promise<CLIOutput<T>> => {
      setState((prev) => ({ ...prev, loading: true, error: null }))

      const result = await runCLI(command, args, schema, { cwd })

      if (result.success && result.data) {
        setState({
          data: result.data,
          error: null,
          loading: false,
          warnings: result.warnings ?? [],
        })
      } else {
        setState({
          data: null,
          error: result.error?.message ?? 'Unknown error',
          loading: false,
          warnings: result.warnings ?? [],
        })
      }

      return result
    },
    [command, schema]
  )

  const reset = useCallback(() => {
    setState({ data: null, error: null, loading: false, warnings: [] })
  }, [])

  return { ...state, execute, reset }
}

export function useListSkills() {
  return useCLICommand<ListResult>('list', listResultSchema)
}

export function useScanAgents() {
  return useCLICommand<ScanResult>('scan', scanResultSchema)
}

export function useSkillStatus() {
  return useCLICommand<StatusResult>('status', statusResultSchema)
}

export function useSearchSkills() {
  return useCLICommand<SearchResult>('search', searchResultSchema)
}

export function useInstallSkill() {
  return useCLICommand<InstallResult>('install', installResultSchema)
}

export function useRemoveSkill() {
  return useCLICommand<RemoveResult>('remove', removeResultSchema)
}

export function useAuditSkill() {
  return useCLICommand<AuditResult>('audit', auditResultSchema)
}

export function useAdoptSkills() {
  return useCLICommand<AdoptResult>('adopt', adoptResultSchema)
}
