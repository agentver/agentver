import { Store } from '@tauri-apps/plugin-store'
import { useCallback, useEffect, useState } from 'react'

const STORE_PATH = 'agentver-settings.json'
const SETTINGS_KEY = 'settings'

export type Theme = 'system' | 'light' | 'dark'
export type DefaultScope = 'project' | 'global'
export type BlockSeverity = 'critical' | 'high' | 'medium'

export type Settings = {
  theme: Theme
  defaultScope: DefaultScope
  auditEnabled: boolean
  blockSeverity: BlockSeverity
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultScope: 'project',
  auditEnabled: true,
  blockSeverity: 'high',
}

let storeInstance: Store | null = null

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load(STORE_PATH)
  }
  return storeInstance
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const store = await getStore()
        const stored = await store.get<Settings>(SETTINGS_KEY)
        if (stored) {
          setSettings({ ...DEFAULT_SETTINGS, ...stored })
        }
      } catch {
        // First launch — no stored settings
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const persist = useCallback(async (updated: Settings) => {
    const store = await getStore()
    await store.set(SETTINGS_KEY, updated)
    await store.save()
  }, [])

  const updateTheme = useCallback(
    (theme: Theme) => {
      const updated = { ...settings, theme }
      setSettings(updated)
      persist(updated)
    },
    [settings, persist]
  )

  const updateDefaultScope = useCallback(
    (defaultScope: DefaultScope) => {
      const updated = { ...settings, defaultScope }
      setSettings(updated)
      persist(updated)
    },
    [settings, persist]
  )

  const updateAuditEnabled = useCallback(
    (auditEnabled: boolean) => {
      const updated = { ...settings, auditEnabled }
      setSettings(updated)
      persist(updated)
    },
    [settings, persist]
  )

  const updateBlockSeverity = useCallback(
    (blockSeverity: BlockSeverity) => {
      const updated = { ...settings, blockSeverity }
      setSettings(updated)
      persist(updated)
    },
    [settings, persist]
  )

  return {
    settings,
    loading,
    updateTheme,
    updateDefaultScope,
    updateAuditEnabled,
    updateBlockSeverity,
  }
}
