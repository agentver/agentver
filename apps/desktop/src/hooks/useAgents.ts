import { useEffect } from 'react'
import { useProject } from '../context/ProjectContext'
import { useScanAgents } from './useCLI'

export function useAgents(cwd?: string) {
  const { activeProject } = useProject()
  const effectiveCwd = cwd ?? activeProject ?? undefined
  const { data, error, loading, execute } = useScanAgents()

  useEffect(() => {
    execute(effectiveCwd ? [effectiveCwd] : [], effectiveCwd)
  }, [execute, effectiveCwd])

  const rescan = () => execute(effectiveCwd ? [effectiveCwd] : [], effectiveCwd)

  const detectedAgents = data?.agents ?? []
  const detectedSkills = data?.skills ?? []

  return {
    agents: detectedAgents,
    skills: detectedSkills,
    loading,
    error,
    rescan,
  }
}
