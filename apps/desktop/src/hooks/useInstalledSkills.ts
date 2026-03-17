import { useCallback, useEffect } from 'react'
import { useProject } from '../context/ProjectContext'
import { useListSkills, useRemoveSkill } from './useCLI'

export function useInstalledSkills(cwd?: string) {
  const { activeProject } = useProject()
  const effectiveCwd = cwd ?? activeProject ?? undefined
  const list = useListSkills()
  const remove = useRemoveSkill()

  useEffect(() => {
    list.execute([], effectiveCwd)
  }, [list.execute, effectiveCwd])

  const refresh = useCallback(() => {
    list.execute([], effectiveCwd)
  }, [list.execute, effectiveCwd])

  const removeSkill = useCallback(
    async (name: string) => {
      const result = await remove.execute([name], effectiveCwd)
      if (result.success) {
        await refresh()
      }
      return result
    },
    [remove.execute, effectiveCwd, refresh]
  )

  const packages = list.data?.packages ?? {}
  const skills = Object.entries(packages).map(([name, pkg]) => ({
    name,
    ...pkg,
  }))

  return {
    skills,
    loading: list.loading,
    error: list.error,
    removing: remove.loading,
    refresh,
    removeSkill,
  }
}
