import { createContext, useContext } from 'react'

type ProjectContextValue = {
  activeProject: string | null
}

export const ProjectContext = createContext<ProjectContextValue>({ activeProject: null })

export function useProject() {
  return useContext(ProjectContext)
}
