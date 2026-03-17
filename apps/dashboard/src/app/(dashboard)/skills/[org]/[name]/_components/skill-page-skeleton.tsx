export function SkillPageSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-3">
        <div className="h-8 w-64 rounded bg-muted" />
        <div className="h-4 w-96 rounded bg-muted" />
        <div className="flex gap-3">
          <div className="h-5 w-16 rounded bg-muted" />
          <div className="h-5 w-20 rounded bg-muted" />
          <div className="h-5 w-16 rounded bg-muted" />
        </div>
      </div>
      <div className="h-px w-full bg-muted" />
      <div className="h-64 rounded-lg bg-muted" />
    </div>
  )
}
