import { useCallback, useEffect, useState } from 'react'
import {
  checkSetup,
  createInitialSetupState,
  installPrerequisite,
  type SetupState,
} from '../lib/prerequisites'

export function usePrerequisites() {
  const [state, setState] = useState<SetupState>(createInitialSetupState())
  const [checking, setChecking] = useState(true)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const result = await checkSetup()
      setState(result)
    } catch (err) {
      setState((prev) => ({
        ...prev,
        steps: prev.steps.map((s) => ({
          ...s,
          status: 'error' as const,
          error: err instanceof Error ? err.message : String(err),
        })),
      }))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    check()
  }, [check])

  const install = useCallback(
    async (id: 'bun' | 'cli') => {
      setState((prev) => ({
        ...prev,
        steps: prev.steps.map((s) => (s.id === id ? { ...s, status: 'installing' as const } : s)),
      }))

      const result = await installPrerequisite(id)

      setState((prev) => ({
        ...prev,
        steps: prev.steps.map((s) =>
          s.id === id
            ? {
                ...s,
                status: result.success ? ('installed' as const) : ('error' as const),
                version: result.version,
                error: result.error,
              }
            : s
        ),
      }))

      if (result.success) {
        await check()
      }

      return result
    },
    [check]
  )

  return { ...state, checking, check, install }
}
