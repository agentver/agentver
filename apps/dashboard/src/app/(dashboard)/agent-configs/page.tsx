'use client'

import { Button } from '@agentver/ui/components/button'
import { Input } from '@agentver/ui/components/input'
import { Plus, Search, Settings2 } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { SkillCard } from '@/components/skills/skill-card'
import { trpc } from '@/trpc/client'

export default function AgentConfigsPage() {
  const [search, setSearch] = useState('')

  const { data, isLoading } = trpc.skills.list.useQuery({
    search: search || undefined,
    type: 'AGENT_CONFIG',
  })

  const packages = data?.packages ?? []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-semibold text-3xl tracking-tight">Agent Configs</h2>
        <p className="text-muted-foreground leading-relaxed">
          Browse and manage agent configuration packages. Configs are translated to each agent's
          native format on install.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search agent configs..."
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            className="w-64 rounded-lg pl-9"
          />
        </div>
        <Link href="/agent-configs/new">
          <Button className="rounded-lg">
            <Plus className="size-4" />
            New Agent Config
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : packages.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed py-20 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-light text-primary">
            <Settings2 className="size-5" />
          </div>
          <p className="mt-4 font-display font-medium text-lg">No agent configs yet</p>
          <p className="mt-1 max-w-sm text-muted-foreground text-sm">
            Create your first agent config to share rules and instructions across coding agents.
          </p>
          <Link href="/agent-configs/new" className="mt-4">
            <Button variant="cta">
              <Plus className="mr-1 size-4" />
              Create Agent Config
            </Button>
          </Link>
        </div>
      ) : (
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
            />
          ))}
        </div>
      )}
    </div>
  )
}
