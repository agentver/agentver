import { cn } from '@agentver/ui-utils'
import { open } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectInfo } from '../hooks/useProjectSelector'

type ProjectSelectorProps = {
  activeProject: string | null
  recentProjects: ProjectInfo[]
  loading: boolean
  onSelectProject: (path: string) => void
  onClearProject: () => void
  onRemoveRecent: (path: string) => void
}

function FolderIcon({ size = 16, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={active ? 'text-primary' : 'text-muted-foreground'}
    >
      <path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5H3A1 1 0 002 4.5z" />
    </svg>
  )
}

function ChevronIcon({ open: isOpen }: { open: boolean }) {
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
      className={cn('shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
    >
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  )
}

function CloseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  )
}

function getProjectName(path: string): string {
  return path.split('/').pop() ?? path.split('\\').pop() ?? path
}

export function ProjectSelector({
  activeProject,
  recentProjects,
  loading,
  onSelectProject,
  onClearProject,
  onRemoveRecent,
}: ProjectSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
      setIsOpen(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, handleClickOutside])

  async function handleOpenFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select a project folder',
      })
      if (selected) {
        onSelectProject(selected)
        setIsOpen(false)
      }
    } catch {
      // User cancelled the dialog
    }
  }

  function handleSelectRecent(path: string) {
    onSelectProject(path)
    setIsOpen(false)
  }

  function handleClear() {
    onClearProject()
    setIsOpen(false)
  }

  if (loading) {
    return (
      <div className="relative mb-1 px-3">
        <div className="h-[34px] animate-[pulse_1.5s_ease-in-out_infinite] rounded-md bg-muted" />
      </div>
    )
  }

  const displayRecent = recentProjects.slice(0, 5)

  return (
    <div className="relative mb-1 px-3" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left font-medium text-[0.8rem] transition-colors',
          'cursor-pointer bg-transparent font-[inherit]',
          isOpen && 'bg-muted'
        )}
      >
        <FolderIcon size={16} active={Boolean(activeProject)} />
        <span
          className={cn(
            'flex-1 truncate text-[0.8rem]',
            activeProject ? 'text-sidebar-foreground' : 'text-muted-foreground'
          )}
        >
          {activeProject ? getProjectName(activeProject) : 'No project selected'}
        </span>
        <ChevronIcon open={isOpen} />
      </button>

      {isOpen && (
        <div className="absolute top-[calc(100%+4px)] right-3 left-3 z-[100] min-w-[220px] overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          {activeProject && (
            <div className="border-border border-b px-3 py-2.5">
              <span className="mb-1.5 block font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-widest">
                Active project
              </span>
              <div className="flex items-start gap-2 pt-0.5">
                <FolderIcon size={14} active />
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="font-medium text-[0.8rem] text-foreground">
                    {getProjectName(activeProject)}
                  </span>
                  <span className="truncate font-mono text-[0.65rem] text-muted-foreground">
                    {activeProject}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="border-border border-b py-1.5">
            <button
              onClick={handleOpenFolder}
              className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left font-[inherit] text-[0.8rem] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <FolderIcon size={14} />
              <span>Open folder...</span>
            </button>

            {activeProject && (
              <button
                onClick={handleClear}
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left font-[inherit] text-[0.8rem] text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              >
                <CloseIcon size={14} />
                <span>Clear selection</span>
              </button>
            )}
          </div>

          {displayRecent.length > 0 && (
            <div className="py-2">
              <span className="mb-1.5 block px-3 font-semibold text-[0.65rem] text-muted-foreground uppercase tracking-widest">
                Recent projects
              </span>
              {displayRecent.map((project, index) => (
                <div
                  key={project.path}
                  className="flex items-center pr-1.5 transition-colors hover:bg-accent"
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <button
                    onClick={() => handleSelectRecent(project.path)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left font-[inherit]"
                  >
                    <FolderIcon size={13} active={project.path === activeProject} />
                    <div className="flex min-w-0 flex-1 flex-col gap-px">
                      <span
                        className={cn(
                          'font-medium text-[0.8rem]',
                          project.path === activeProject ? 'text-primary' : 'text-foreground'
                        )}
                      >
                        {project.name}
                      </span>
                      <span className="truncate font-mono text-[0.65rem] text-muted-foreground">
                        {project.path}
                      </span>
                    </div>
                  </button>
                  {hoveredIndex === index && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveRecent(project.path)
                      }}
                      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border-none bg-transparent p-0 text-muted-foreground transition-colors hover:text-destructive"
                      title="Remove from recent"
                    >
                      <CloseIcon size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
