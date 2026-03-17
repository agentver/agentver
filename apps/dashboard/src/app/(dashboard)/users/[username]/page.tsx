'use client'

import { Suspense, use } from 'react'
import { UserProfileContent } from './_components/user-profile-content'

type UserProfilePageProps = {
  params: Promise<{ username: string }>
}

export default function UserProfilePage({ params }: UserProfilePageProps) {
  const { username } = use(params)

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
      <UserProfileContent username={username} />
    </Suspense>
  )
}
