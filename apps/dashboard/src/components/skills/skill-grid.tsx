'use client'

import { Package } from 'lucide-react'
import { SkillCard } from './skill-card'

type PackageData = {
  id: string
  slug: string
  name: string
  description: string | null
  type: string
  tags: string[]
  organisation: { slug: string; name: string }
  author: { name: string | null; image: string | null }
  versions: Array<{ version: string; gitRef?: string | null }>
  gitUri?: string | null
  gitPath?: string | null
  gitDefaultRef?: string
  _count: { installationReports: number }
}

type SkillGridProps = {
  packages: PackageData[]
  selectable?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}

export function SkillGrid({ packages, selectable, selectedIds, onToggleSelect }: SkillGridProps) {
  if (packages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
          <Package className="size-5" />
        </div>
        <p className="mt-4 font-display font-medium text-lg">No packages yet</p>
        <p className="mt-1 max-w-sm text-muted-foreground text-sm">
          Register your first skill from a Git repository to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {packages.map((pkg) => (
        <SkillCard
          key={pkg.slug}
          id={pkg.id}
          slug={pkg.slug}
          name={pkg.name}
          description={pkg.description}
          type={pkg.type}
          tags={pkg.tags}
          version={pkg.versions[0]?.version ?? '0.0.0'}
          installations={pkg._count.installationReports}
          orgSlug={pkg.organisation.slug}
          author={pkg.author}
          selectable={selectable}
          selected={selectedIds?.has(pkg.id) ?? false}
          onToggleSelect={onToggleSelect}
          gitUri={pkg.gitUri}
          gitPath={pkg.gitPath}
          gitDefaultRef={pkg.gitDefaultRef}
          gitRef={pkg.versions[0]?.gitRef}
        />
      ))}
    </div>
  )
}
