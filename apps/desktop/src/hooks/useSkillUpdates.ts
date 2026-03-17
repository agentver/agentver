import {
  type StatusResult,
  type SyncResult,
  statusResultSchema,
  syncResultSchema,
  type UpdateResult,
  updateResultSchema,
} from '@agentver/shared'
import { useCallback, useEffect, useState } from 'react'
import { useProject } from '../context/ProjectContext'
import { runCLI } from '../lib/cli-bridge'

export function useSkillUpdates(cwd?: string) {
  const { activeProject } = useProject()
  const effectiveCwd = cwd ?? activeProject ?? undefined
  // Status checking
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Update state
  const [updating, setUpdating] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)

  // Sync state
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)

  const checkStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError(null)
    const result = await runCLI('status', [], statusResultSchema, { cwd: effectiveCwd })
    if (result.success && result.data) {
      setStatus(result.data)
    } else {
      setStatusError(result.error?.message ?? 'Failed to check status')
    }
    setStatusLoading(false)
  }, [effectiveCwd])

  const updateAll = useCallback(async () => {
    setUpdating(true)
    const result = await runCLI('update', [], updateResultSchema, { cwd: effectiveCwd })
    if (result.success && result.data) {
      setUpdateResult(result.data)
      await checkStatus()
    }
    setUpdating(false)
    return result
  }, [effectiveCwd, checkStatus])

  const updateSkill = useCallback(
    async (name: string) => {
      setUpdating(true)
      const result = await runCLI('update', [name], updateResultSchema, { cwd: effectiveCwd })
      if (result.success) {
        await checkStatus()
      }
      setUpdating(false)
      return result
    },
    [effectiveCwd, checkStatus]
  )

  const sync = useCallback(async () => {
    setSyncing(true)
    const result = await runCLI('sync', [], syncResultSchema, { cwd: effectiveCwd })
    if (result.success && result.data) {
      setSyncResult(result.data)
    }
    setSyncing(false)
    return result
  }, [effectiveCwd])

  // Check status on mount
  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  return {
    status,
    statusLoading,
    statusError,
    checkStatus,
    updating,
    updateResult,
    updateAll,
    updateSkill,
    syncing,
    syncResult,
    sync,
  }
}
