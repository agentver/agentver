'use client'

import { Suspense, use } from 'react'
import { OrgProfileContent } from './_components/org-profile-content'

type OrgProfilePageProps = {
  params: Promise<{ slug: string }>
}

export default function OrgProfilePage({ params }: OrgProfilePageProps) {
  const { slug } = use(params)

  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="size-16 animate-pulse rounded-full bg-muted" />
            <div className="space-y-2">
              <div className="h-7 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      }
    >
      <OrgProfileContent slug={slug} />
    </Suspense>
  )
}
