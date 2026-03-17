import { cn } from '@agentver/ui-utils'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="flex w-[90%] max-w-[420px] flex-col gap-4 rounded-2xl border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-semibold text-foreground text-lg tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">{message}</p>
        <div className="mt-2 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="cursor-pointer rounded-lg border border-border bg-muted px-4 py-2 font-medium text-[0.825rem] text-foreground transition-colors hover:bg-accent"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'cursor-pointer rounded-lg border-none px-4 py-2 font-medium text-[0.825rem] text-white transition-colors',
              danger ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
