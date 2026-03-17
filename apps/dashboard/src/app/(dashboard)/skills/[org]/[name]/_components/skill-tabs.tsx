'use client'

import { cn } from '@agentver/ui-utils'
import { BookOpen, Clock, FileCode, MessageSquare, Tag } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type SkillTabsProps = {
  org: string
  name: string
}

const TABS = [
  { label: 'Overview', href: '', icon: BookOpen },
  { label: 'Files', href: '/files', icon: FileCode },
  { label: 'Versions', href: '/versions', icon: Tag },
  { label: 'History', href: '/history', icon: Clock },
  { label: 'Suggestions', href: '/suggestions', icon: MessageSquare },
] as const

export function SkillTabs({ org, name }: SkillTabsProps) {
  const pathname = usePathname()
  const basePath = `/skills/${org}/${name}`

  return (
    <div className="border-b">
      <nav className="-mb-px flex gap-1" aria-label="Skill tabs">
        {TABS.map((tab) => {
          const tabPath = `${basePath}${tab.href}`
          const isActive = tab.href === '' ? pathname === basePath : pathname.startsWith(tabPath)

          return (
            <Link
              key={tab.label}
              href={tabPath}
              className={cn(
                'inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 font-medium text-sm transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground'
              )}
            >
              <tab.icon className="size-3.5" />
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
