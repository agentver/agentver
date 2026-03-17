import { cn } from '@agentver/ui-utils'
import { useState } from 'react'

type EditorToolbarProps = {
  skillName: string | null
  skillPath: string | null
  hasUnsavedChanges: boolean
  previewOpen: boolean
  activeFileIsMarkdown: boolean
  onSave: () => void
  onTogglePreview: () => void
  onNewFile: () => void
  onPublish: () => void
}

function ToolbarButton({
  id,
  label,
  icon,
  hovered,
  onHover,
  onClick,
  active,
  activeColour,
  activeBg,
  badge,
}: {
  id: string
  label: string
  icon: React.ReactNode
  hovered: string | null
  onHover: (id: string | null) => void
  onClick: () => void
  active?: boolean
  activeColour?: string
  activeBg?: string
  badge?: boolean
}) {
  const isHovered = hovered === id
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border-none px-2 py-1 font-[inherit] font-medium text-xs transition-all'
      )}
      style={{
        color: active
          ? (activeColour ?? 'var(--color-primary)')
          : isHovered
            ? 'var(--color-foreground)'
            : 'var(--color-muted-foreground)',
        background: active
          ? (activeBg ?? 'transparent')
          : isHovered
            ? 'var(--color-muted)'
            : 'transparent',
      }}
    >
      {icon}
      <span>{label}</span>
      {badge && (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: activeColour ?? '#f59e0b' }}
        />
      )}
    </button>
  )
}

function SaveIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 13H2.5a1 1 0 01-1-1V2a1 1 0 011-1h7l3 3v8a1 1 0 01-1 1z" />
      <path d="M10 13V8H4v5M4 1v3h5" />
    </svg>
  )
}
function PreviewIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 7s2.5-4.5 6-4.5S13 7 13 7s-2.5 4.5-6 4.5S1 7 1 7z" />
      <circle cx="7" cy="7" r="2" />
    </svg>
  )
}
function NewFileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1H3.5a1 1 0 00-1 1v10a1 1 0 001 1h7a1 1 0 001-1V4.5L8 1z" />
      <path d="M8 1v3.5h3.5" />
      <path d="M7 7v4M5 9h4" />
    </svg>
  )
}
function PublishIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 10V2M4 4.5L7 1.5l3 3M2 10.5v1a1 1 0 001 1h8a1 1 0 001-1v-1" />
    </svg>
  )
}

export function EditorToolbar({
  skillName,
  skillPath,
  hasUnsavedChanges,
  previewOpen,
  activeFileIsMarkdown,
  onSave,
  onTogglePreview,
  onNewFile,
  onPublish,
}: EditorToolbarProps) {
  const [hoveredButton, setHoveredButton] = useState<string | null>(null)

  return (
    <div
      className="flex shrink-0 items-center justify-between border-border border-b bg-card px-3 py-1.5"
      style={{ minHeight: '40px' }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="whitespace-nowrap font-semibold text-foreground text-sm tracking-tight">
          {skillName ?? 'Editor'}
        </span>
        {skillPath && (
          <span className="max-w-[300px] truncate text-[0.7rem] text-muted-foreground">
            {skillPath}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ToolbarButton
          id="new"
          label="New File"
          icon={<NewFileIcon />}
          hovered={hoveredButton}
          onHover={setHoveredButton}
          onClick={onNewFile}
        />
        {activeFileIsMarkdown && (
          <ToolbarButton
            id="preview"
            label="Preview"
            icon={<PreviewIcon />}
            hovered={hoveredButton}
            onHover={setHoveredButton}
            onClick={onTogglePreview}
            active={previewOpen}
            activeColour="var(--color-primary)"
            activeBg="var(--color-accent)"
          />
        )}
        <ToolbarButton
          id="save"
          label="Save"
          icon={<SaveIcon />}
          hovered={hoveredButton}
          onHover={setHoveredButton}
          onClick={onSave}
          active={hasUnsavedChanges}
          activeColour="#f59e0b"
          badge={hasUnsavedChanges}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <button
          onClick={onPublish}
          onMouseEnter={() => setHoveredButton('publish')}
          onMouseLeave={() => setHoveredButton(null)}
          className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border-none bg-primary px-2 py-1 font-[inherit] font-medium text-primary-foreground text-xs shadow-lg shadow-primary/20 transition-all hover:bg-primary/90"
        >
          <PublishIcon />
          <span>Publish</span>
        </button>
      </div>
    </div>
  )
}
