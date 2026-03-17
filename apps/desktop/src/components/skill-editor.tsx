import { cn } from '@agentver/ui-utils'
import Editor from '@monaco-editor/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorTab } from '../hooks/useEditorState'
import { useEditorState } from '../hooks/useEditorState'
import { CreateSkillWizard } from './create-skill-wizard'
import { EditorToolbar } from './editor-toolbar'
import { FileTree } from './file-tree'
import { FrontmatterValidator } from './frontmatter-validator'
import { MarkdownPreview } from './markdown-preview'

function TabBar({
  tabs,
  activeTabPath,
  onSelect,
  onClose,
}: {
  tabs: EditorTab[]
  activeTabPath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}) {
  if (tabs.length === 0) return null
  return (
    <div
      className="flex shrink-0 overflow-x-auto border-border border-b bg-card"
      style={{ minHeight: '34px' }}
    >
      {tabs.map((tab) => {
        const isActive = tab.path === activeTabPath
        const isUnsaved = tab.content !== tab.savedContent
        return (
          <div
            key={tab.path}
            onClick={() => onSelect(tab.path)}
            className={cn(
              'flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap border-border border-r px-3 py-1.5 text-xs transition-colors',
              isActive
                ? 'border-b-2 border-b-primary bg-muted text-foreground'
                : 'border-b-2 border-b-transparent bg-transparent text-muted-foreground hover:bg-muted'
            )}
          >
            <span className="flex items-center gap-1 overflow-hidden text-ellipsis">
              {isUnsaved && <span className="size-1.5 shrink-0 rounded-full bg-yellow-500" />}
              {tab.name}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.path)
              }}
              className={cn(
                'flex shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0.5 transition-opacity',
                isActive
                  ? 'text-muted-foreground opacity-100 hover:text-foreground'
                  : 'text-muted-foreground opacity-0 hover:opacity-100'
              )}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function EmptyState({ onCreateSkill }: { onCreateSkill: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground/40"
      >
        <rect x="8" y="6" width="32" height="36" rx="3" />
        <path d="M16 18h16M16 24h12M16 30h8" />
      </svg>
      <h3 className="font-semibold text-foreground text-lg">No skill selected</h3>
      <p className="max-w-[320px] text-center text-[0.85rem] text-muted-foreground leading-relaxed">
        Select a skill from the browser or create a new one to start editing.
      </p>
      <button
        onClick={onCreateSkill}
        className="mt-2 cursor-pointer rounded-lg border-none bg-primary px-5 py-2 font-[inherit] font-medium text-[0.85rem] text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
      >
        Create New Skill
      </button>
    </div>
  )
}

function useResizable(initialWidth: number, minWidth: number, maxWidth: number) {
  const [width, setWidth] = useState(initialWidth)
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      draggingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = width
      e.preventDefault()
    },
    [width]
  )
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!draggingRef.current) return
      setWidth(
        Math.max(
          minWidth,
          Math.min(maxWidth, startWidthRef.current + (e.clientX - startXRef.current))
        )
      )
    }
    function onMouseUp() {
      draggingRef.current = false
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [minWidth, maxWidth])
  return { width, onMouseDown }
}

type SkillEditorProps = { skillPath?: string | null; skillName?: string | null }

export function SkillEditor({
  skillPath: propSkillPath,
  skillName: propSkillName,
}: SkillEditorProps) {
  const editor = useEditorState()
  const fileTreeResize = useResizable(250, 180, 400)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFileParent, setNewFileParent] = useState<string | null>(null)
  const effectiveSkillPath = propSkillPath ?? null
  const effectiveSkillName = propSkillName ?? effectiveSkillPath?.split('/').pop() ?? null

  useEffect(() => {
    if (effectiveSkillPath) editor.loadFileTree(effectiveSkillPath)
  }, [effectiveSkillPath, editor.loadFileTree])

  const activeTab = editor.activeTab
  const isMarkdown = activeTab?.language === 'markdown'
  const isSKILLMd = activeTab?.name === 'SKILL.md'
  const activeTabUnsaved = activeTab ? activeTab.content !== activeTab.savedContent : false
  function handleNewFile(parentPath?: string) {
    setNewFileParent(parentPath ?? editor.skillPath)
    setNewFileName('')
    setNewFileDialogOpen(true)
  }
  function handleNewFileSubmit() {
    if (!newFileName.trim() || !newFileParent) return
    editor.createNewFile(`${newFileParent}/${newFileName.trim()}`)
    setNewFileDialogOpen(false)
    setNewFileName('')
  }
  function handleRenameFile(oldPath: string, newName: string) {
    const dir = oldPath.substring(0, oldPath.lastIndexOf('/'))
    editor.renameFile(oldPath, `${dir}/${newName}`)
  }
  function handleSkillCreated(path: string) {
    editor.loadFileTree(path)
    setWizardOpen(false)
  }

  if (!effectiveSkillPath)
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-background">
        <EmptyState onCreateSkill={() => setWizardOpen(true)} />
        <CreateSkillWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onCreated={handleSkillCreated}
        />
      </div>
    )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <EditorToolbar
        skillName={effectiveSkillName}
        skillPath={effectiveSkillPath}
        hasUnsavedChanges={activeTabUnsaved}
        previewOpen={editor.previewOpen}
        activeFileIsMarkdown={isMarkdown}
        onSave={editor.saveActiveFile}
        onTogglePreview={editor.togglePreview}
        onNewFile={() => handleNewFile()}
        onPublish={() => {}}
      />
      {isSKILLMd && activeTab && <FrontmatterValidator content={activeTab.content} visible />}
      <div className="flex flex-1 overflow-hidden">
        <div className="shrink-0" style={{ width: fileTreeResize.width, height: '100%' }}>
          <FileTree
            entries={editor.fileTree}
            activePath={editor.activeTabPath}
            loading={editor.treeLoading}
            error={editor.treeError}
            onSelectFile={editor.openFile}
            onNewFile={(p) => handleNewFile(p)}
            onDeleteFile={editor.deleteFile}
            onRenameFile={handleRenameFile}
          />
        </div>
        <div
          onMouseDown={fileTreeResize.onMouseDown}
          className="z-10 w-1 shrink-0 cursor-col-resize bg-transparent"
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={editor.tabs}
            activeTabPath={editor.activeTabPath}
            onSelect={editor.setActiveTab}
            onClose={editor.closeTab}
          />
          <div className="flex-1 overflow-hidden">
            {activeTab ? (
              <Editor
                key={activeTab.path}
                height="100%"
                language={activeTab.language}
                value={activeTab.content}
                onChange={(value) => {
                  if (value !== undefined) editor.updateTabContent(activeTab.path, value)
                }}
                theme="vs"
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: activeTab.language === 'markdown' ? 'on' : 'off',
                  scrollBeyondLastLine: false,
                  renderLineHighlight: 'line',
                  padding: { top: 12 },
                  bracketPairColorization: { enabled: true },
                  autoIndent: 'full',
                  formatOnPaste: true,
                  tabSize: 2,
                  smoothScrolling: true,
                  cursorSmoothCaretAnimation: 'on',
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
                  fontLigatures: true,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-muted">
                <span className="text-[0.85rem] text-muted-foreground">Select a file to edit</span>
              </div>
            )}
          </div>
        </div>
        {editor.previewOpen && isMarkdown && activeTab && (
          <div className="shrink-0" style={{ width: 400, height: '100%' }}>
            <MarkdownPreview content={activeTab.content} />
          </div>
        )}
      </div>

      {newFileDialogOpen && (
        <>
          <div
            className="fixed inset-0 z-[999] bg-black/50"
            onClick={() => setNewFileDialogOpen(false)}
          />
          <div className="pointer-events-none fixed inset-0 z-[1000] flex items-center justify-center">
            <div className="pointer-events-auto flex min-w-[300px] flex-col gap-2.5 rounded-lg border border-border bg-popover p-4 shadow-lg">
              <span className="font-semibold text-foreground text-sm">New File</span>
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNewFileSubmit()
                  if (e.key === 'Escape') setNewFileDialogOpen(false)
                }}
                placeholder="filename.md"
                autoFocus
                className="rounded-md border border-border bg-card px-2.5 py-2 font-[inherit] text-[0.85rem] text-foreground outline-none"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={() => setNewFileDialogOpen(false)}
                  className="cursor-pointer rounded-md border border-border bg-muted px-3 py-1.5 font-[inherit] text-foreground text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNewFileSubmit}
                  disabled={!newFileName.trim()}
                  className={cn(
                    'cursor-pointer rounded-md border-none bg-primary px-3 py-1.5 font-[inherit] text-primary-foreground text-xs',
                    !newFileName.trim() && 'opacity-50'
                  )}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      <CreateSkillWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={handleSkillCreated}
      />
    </div>
  )
}
