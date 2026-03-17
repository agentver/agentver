import { cn } from '@agentver/ui-utils'
import { useState } from 'react'
import type { FileEntry } from '../hooks/useEditorState'

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {open ? (
        <path d="M2 13V4a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1v1H4.5L2.5 13H2z" />
      ) : (
        <path d="M2 13V4a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z" />
      )}
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('transition-transform', open && 'rotate-90')}
    >
      <path d="M4.5 2.5l3.5 3.5-3.5 3.5" />
    </svg>
  )
}

const FILE_ICON_COLOURS: Record<string, string> = {
  '.md': '#519aba',
  '.ts': '#3178c6',
  '.tsx': '#3178c6',
  '.js': '#f0db4f',
  '.jsx': '#f0db4f',
  '.json': '#cbcb41',
  '.yaml': '#cb171e',
  '.yml': '#cb171e',
  '.css': '#42a5f5',
  '.html': '#e34c26',
  '.sh': '#89e051',
  '.toml': '#9c4221',
  '.py': '#3776ab',
  '.rs': '#dea584',
}

function FileIcon({ name }: { name: string }) {
  const ext = name.includes('.') ? `.${name.split('.').pop()}` : ''
  const colour = FILE_ICON_COLOURS[ext] ?? 'var(--color-muted-foreground)'
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke={colour}
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 1.5H4a1 1 0 00-1 1v11a1 1 0 001 1h8a1 1 0 001-1V5.5L9 1.5z" />
      <path d="M9 1.5v4h4" />
    </svg>
  )
}

type ContextMenuState = { x: number; y: number; entry: FileEntry } | null

function ContextMenu({
  menu,
  onNewFile,
  onDelete,
  onRename,
  onClose,
}: {
  menu: NonNullable<ContextMenuState>
  onNewFile: (parentPath: string) => void
  onDelete: (path: string) => void
  onRename: (path: string) => void
  onClose: () => void
}) {
  const items = [
    ...(menu.entry.is_dir
      ? [{ id: 'new', label: 'New File', action: () => onNewFile(menu.entry.path) }]
      : []),
    { id: 'rename', label: 'Rename', action: () => onRename(menu.entry.path) },
    { id: 'delete', label: 'Delete', action: () => onDelete(menu.entry.path) },
  ]
  return (
    <>
      <div className="fixed inset-0 z-[999]" onClick={onClose} />
      <div
        className="fixed z-[1000] min-w-[140px] rounded-md border border-border bg-popover p-1 shadow-lg"
        style={{ left: menu.x, top: menu.y }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              item.action()
              onClose()
            }}
            className={cn(
              'block w-full cursor-pointer rounded border-none px-2.5 py-1.5 text-left font-[inherit] text-xs transition-colors hover:bg-accent',
              item.id === 'delete' ? 'text-destructive' : 'bg-transparent text-foreground'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}

function TreeNode({
  entry,
  depth,
  activePath,
  onSelect,
  onContextMenu,
}: {
  entry: FileEntry
  depth: number
  activePath: string | null
  onSelect: (path: string) => void
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isActive = activePath === entry.path
  const isSKILLMd = entry.name === 'SKILL.md'

  return (
    <div>
      <button
        onClick={() => (entry.is_dir ? setExpanded(!expanded) : onSelect(entry.path))}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e, entry)
        }}
        className={cn(
          'flex w-full cursor-pointer items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap border-none text-left font-[inherit] text-xs transition-colors',
          isActive ? 'bg-accent text-foreground' : 'bg-transparent text-foreground hover:bg-muted',
          isSKILLMd && !isActive && 'font-medium text-primary'
        )}
        style={{ padding: `3px 12px`, paddingLeft: `${12 + depth * 16}px` }}
      >
        {entry.is_dir && (
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <ChevronIcon open={expanded} />
          </span>
        )}
        <span className="flex size-4 shrink-0 items-center justify-center">
          {entry.is_dir ? <FolderIcon open={expanded} /> : <FileIcon name={entry.name} />}
        </span>
        <span className="overflow-hidden text-ellipsis">{entry.name}</span>
      </button>
      {entry.is_dir &&
        expanded &&
        entry.children?.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            activePath={activePath}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
        ))}
    </div>
  )
}

type FileTreeProps = {
  entries: FileEntry[]
  activePath: string | null
  loading: boolean
  error: string | null
  onSelectFile: (path: string) => void
  onNewFile: (parentPath: string) => void
  onDeleteFile: (path: string) => void
  onRenameFile: (oldPath: string, newName: string) => void
}

export function FileTree({
  entries,
  activePath,
  loading,
  error,
  onSelectFile,
  onNewFile,
  onDeleteFile,
  onRenameFile,
}: FileTreeProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  function handleRenameStart(path: string) {
    setRenaming(path)
    setRenameValue(path.split('/').pop() ?? '')
  }
  function handleRenameSubmit() {
    if (renaming && renameValue.trim()) onRenameFile(renaming, renameValue.trim())
    setRenaming(null)
    setRenameValue('')
  }

  if (loading)
    return <div className="p-6 text-center text-muted-foreground text-xs">Loading files...</div>
  if (error) return <div className="p-6 text-center text-destructive text-xs">{error}</div>
  if (entries.length === 0)
    return <div className="p-6 text-center text-muted-foreground text-xs">No files found</div>

  return (
    <div className="flex h-full flex-col overflow-hidden border-border border-r bg-card">
      <div className="shrink-0 border-border border-b px-3 py-2.5">
        <span className="font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">
          Files
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {entries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            activePath={activePath}
            onSelect={onSelectFile}
            onContextMenu={(e, ent) => setContextMenu({ x: e.clientX, y: e.clientY, entry: ent })}
          />
        ))}
      </div>
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onNewFile={onNewFile}
          onDelete={onDeleteFile}
          onRename={handleRenameStart}
          onClose={() => setContextMenu(null)}
        />
      )}
      {renaming && (
        <>
          <div className="fixed inset-0 z-[999]" onClick={() => setRenaming(null)} />
          <div className="fixed inset-0 z-[1001] flex items-center justify-center">
            <div className="flex min-w-[280px] flex-col gap-2.5 rounded-lg border border-border bg-popover p-4 shadow-lg">
              <span className="font-medium text-[0.85rem] text-foreground">Rename</span>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit()
                  if (e.key === 'Escape') setRenaming(null)
                }}
                autoFocus
                className="rounded-md border border-border bg-card px-2.5 py-2 font-[inherit] text-[0.85rem] text-foreground outline-none"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={() => setRenaming(null)}
                  className="cursor-pointer rounded-md border border-border bg-muted px-3 py-1.5 font-[inherit] text-foreground text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRenameSubmit}
                  disabled={!renameValue.trim()}
                  className="cursor-pointer rounded-md border-none bg-primary px-3 py-1.5 font-[inherit] text-primary-foreground text-xs"
                >
                  Rename
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
