import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'

// --- Types ---

export type FileEntry = {
  name: string
  path: string
  is_dir: boolean
  children: FileEntry[] | null
}

export type EditorTab = {
  path: string
  name: string
  content: string
  savedContent: string
  language: string
}

type EditorState = {
  skillPath: string | null
  fileTree: FileEntry[]
  treeLoading: boolean
  treeError: string | null
  tabs: EditorTab[]
  activeTabPath: string | null
  previewOpen: boolean
}

// --- Helpers ---

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.md': 'markdown',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.css': 'css',
  '.html': 'html',
  '.sh': 'shell',
  '.bash': 'shell',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.sql': 'sql',
  '.xml': 'xml',
  '.env': 'plaintext',
  '.txt': 'plaintext',
  '.gitignore': 'plaintext',
}

function getLanguageFromPath(filePath: string): string {
  const name = filePath.split('/').pop() ?? ''
  const ext = name.includes('.') ? `.${name.split('.').pop()}` : ''
  return EXTENSION_LANGUAGE_MAP[ext] ?? EXTENSION_LANGUAGE_MAP[`.${name}`] ?? 'plaintext'
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

function sortFileTree(entries: FileEntry[]): FileEntry[] {
  const sorted = [...entries].sort((a, b) => {
    if (a.name === 'SKILL.md') return -1
    if (b.name === 'SKILL.md') return 1
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.name.localeCompare(b.name)
  })

  return sorted.map((entry) => {
    if (entry.children) {
      return { ...entry, children: sortFileTree(entry.children) }
    }
    return entry
  })
}

// --- Hook ---

export function useEditorState() {
  const [state, setState] = useState<EditorState>({
    skillPath: null,
    fileTree: [],
    treeLoading: false,
    treeError: null,
    tabs: [],
    activeTabPath: null,
    previewOpen: false,
  })

  const savingRef = useRef<Set<string>>(new Set())
  const tabsRef = useRef(state.tabs)
  tabsRef.current = state.tabs

  const loadFileTree = useCallback(async (path: string) => {
    setState((prev) => ({ ...prev, treeLoading: true, treeError: null, skillPath: path }))

    try {
      const entries = await invoke<FileEntry[]>('read_skill_directory', { path })
      setState((prev) => ({
        ...prev,
        fileTree: sortFileTree(entries),
        treeLoading: false,
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        treeError: err instanceof Error ? err.message : String(err),
        treeLoading: false,
      }))
    }
  }, [])

  const openFile = useCallback(async (filePath: string) => {
    const existing = tabsRef.current.find((t) => t.path === filePath)
    if (existing) {
      setState((prev) => ({ ...prev, activeTabPath: filePath }))
      return
    }

    try {
      const content = await invoke<string>('read_skill_file', { path: filePath })
      const language = getLanguageFromPath(filePath)
      const name = getFileName(filePath)

      setState((prev) => ({
        ...prev,
        tabs: [...prev.tabs, { path: filePath, name, content, savedContent: content, language }],
        activeTabPath: filePath,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({ ...prev, treeError: `Failed to open file: ${message}` }))
    }
  }, [])

  const closeTab = useCallback((filePath: string) => {
    setState((prev) => {
      const tabIndex = prev.tabs.findIndex((t) => t.path === filePath)
      if (tabIndex === -1) return prev

      const newTabs = prev.tabs.filter((t) => t.path !== filePath)
      let newActive = prev.activeTabPath

      if (prev.activeTabPath === filePath) {
        if (newTabs.length === 0) {
          newActive = null
        } else if (tabIndex >= newTabs.length) {
          newActive = newTabs[newTabs.length - 1]!.path
        } else {
          newActive = newTabs[tabIndex]!.path
        }
      }

      return { ...prev, tabs: newTabs, activeTabPath: newActive }
    })
  }, [])

  const updateTabContent = useCallback((filePath: string, content: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.path === filePath ? { ...t, content } : t)),
    }))
  }, [])

  const saveFile = useCallback(async (filePath: string) => {
    if (savingRef.current.has(filePath)) return

    const tab = tabsRef.current.find((t) => t.path === filePath)
    if (!tab || tab.content === tab.savedContent) return

    savingRef.current.add(filePath)

    try {
      await invoke('write_skill_file', { path: filePath, content: tab.content })
      setState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => (t.path === filePath ? { ...t, savedContent: t.content } : t)),
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({ ...prev, treeError: `Failed to save: ${message}` }))
    } finally {
      savingRef.current.delete(filePath)
    }
  }, [])

  const saveActiveFile = useCallback(() => {
    if (state.activeTabPath) {
      saveFile(state.activeTabPath)
    }
  }, [state.activeTabPath, saveFile])

  const togglePreview = useCallback(() => {
    setState((prev) => ({ ...prev, previewOpen: !prev.previewOpen }))
  }, [])

  const setActiveTab = useCallback((filePath: string) => {
    setState((prev) => ({ ...prev, activeTabPath: filePath }))
  }, [])

  const createNewFile = useCallback(
    async (filePath: string) => {
      try {
        await invoke('create_file', { path: filePath })
        if (state.skillPath) {
          await loadFileTree(state.skillPath)
        }
        await openFile(filePath)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setState((prev) => ({ ...prev, treeError: `Failed to create file: ${message}` }))
      }
    },
    [state.skillPath, loadFileTree, openFile]
  )

  const deleteFile = useCallback(
    async (filePath: string) => {
      try {
        await invoke('delete_file', { path: filePath })
        closeTab(filePath)
        if (state.skillPath) {
          await loadFileTree(state.skillPath)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setState((prev) => ({ ...prev, treeError: `Failed to delete: ${message}` }))
      }
    },
    [state.skillPath, loadFileTree, closeTab]
  )

  const renameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      try {
        await invoke('rename_file', { oldPath, newPath })
        setState((prev) => ({
          ...prev,
          tabs: prev.tabs.map((t) => {
            if (t.path === oldPath) {
              return { ...t, path: newPath, name: getFileName(newPath) }
            }
            return t
          }),
          activeTabPath: prev.activeTabPath === oldPath ? newPath : prev.activeTabPath,
        }))
        if (state.skillPath) {
          await loadFileTree(state.skillPath)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setState((prev) => ({ ...prev, treeError: `Failed to rename: ${message}` }))
      }
    },
    [state.skillPath, loadFileTree]
  )

  const activeTab = state.tabs.find((t) => t.path === state.activeTabPath) ?? null
  const hasUnsavedChanges = state.tabs.some((t) => t.content !== t.savedContent)

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey

      if (isMod && e.key === 's') {
        e.preventDefault()
        saveActiveFile()
      }

      if (isMod && e.key === 'p') {
        e.preventDefault()
        togglePreview()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveActiveFile, togglePreview])

  return {
    ...state,
    activeTab,
    hasUnsavedChanges,
    loadFileTree,
    openFile,
    closeTab,
    updateTabContent,
    saveFile,
    saveActiveFile,
    togglePreview,
    setActiveTab,
    createNewFile,
    deleteFile,
    renameFile,
  }
}
