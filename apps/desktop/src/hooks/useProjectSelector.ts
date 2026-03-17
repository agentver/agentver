import { Store } from '@tauri-apps/plugin-store'
import { useCallback, useEffect, useState } from 'react'

const STORE_PATH = 'agentver-projects.json'
const RECENT_KEY = 'recentProjects'
const ACTIVE_KEY = 'activeProject'

type ProjectInfo = {
  path: string
  name: string
  lastOpened: string
}

let storeInstance: Store | null = null

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load(STORE_PATH)
  }
  return storeInstance
}

export type { ProjectInfo }

export function useProjectSelector() {
  const [activeProject, setActiveProjectState] = useState<string | null>(null)
  const [recentProjects, setRecentProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const store = await getStore()
        const active = await store.get<string>(ACTIVE_KEY)
        const recent = await store.get<ProjectInfo[]>(RECENT_KEY)
        if (active) setActiveProjectState(active)
        if (recent) setRecentProjects(recent)
      } catch {
        // First launch — no stored data
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const setActiveProject = useCallback(
    async (path: string) => {
      setActiveProjectState(path)

      const name = path.split('/').pop() ?? path.split('\\').pop() ?? path
      const now = new Date().toISOString()

      const store = await getStore()
      await store.set(ACTIVE_KEY, path)

      const existing = recentProjects.filter((p) => p.path !== path)
      const updated = [{ path, name, lastOpened: now }, ...existing].slice(0, 10)
      setRecentProjects(updated)
      await store.set(RECENT_KEY, updated)
      await store.save()
    },
    [recentProjects]
  )

  const clearActiveProject = useCallback(async () => {
    setActiveProjectState(null)
    const store = await getStore()
    await store.delete(ACTIVE_KEY)
    await store.save()
  }, [])

  const removeRecentProject = useCallback(
    async (path: string) => {
      const updated = recentProjects.filter((p) => p.path !== path)
      setRecentProjects(updated)

      const store = await getStore()
      await store.set(RECENT_KEY, updated)

      if (activeProject === path) {
        setActiveProjectState(null)
        await store.delete(ACTIVE_KEY)
      }

      await store.save()
    },
    [recentProjects, activeProject]
  )

  return {
    activeProject,
    recentProjects,
    loading,
    setActiveProject,
    clearActiveProject,
    removeRecentProject,
  }
}
