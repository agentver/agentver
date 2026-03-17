import { useSession } from '@/lib/auth/client'
import { trpc } from '@/trpc/client'

/**
 * Determines whether the current user can manage a skill package.
 * Returns true if the user is the package author or an OWNER/ADMIN of the organisation.
 */
export function useCanManage(orgSlug: string, authorId: string | undefined): boolean {
  const { data: session } = useSession()
  const { data: orgDetail } = trpc.organisations.getBySlug.useQuery(
    { slug: orgSlug },
    { enabled: Boolean(session?.user?.id) }
  )

  if (!session?.user?.id || !authorId) return false

  const isAuthor = session.user.id === authorId
  const role = orgDetail?.currentUserRole
  const isAdminOrOwner = role === 'OWNER' || role === 'ADMIN'

  return isAuthor || isAdminOrOwner
}
