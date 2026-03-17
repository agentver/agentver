'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { trpc } from '@/trpc/client'

export function useOrgContext() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const orgSlug = searchParams.get('org')

  const { data: orgs, isLoading } = trpc.organisations.list.useQuery()

  const selectedOrg = useMemo(() => {
    if (!orgs || orgs.length === 0) return null
    if (orgSlug) {
      const match = orgs.find((o) => o.slug === orgSlug)
      if (match) return match
    }
    return orgs[0] ?? null
  }, [orgs, orgSlug])

  const setSelectedOrg = useCallback(
    (slug: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('org', slug)
      router.replace(`${pathname}?${params.toString()}`)
    },
    [router, pathname, searchParams]
  )

  return { selectedOrg, orgs: orgs ?? [], setSelectedOrg, isLoading }
}
