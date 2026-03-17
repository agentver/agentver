import { isCloud } from '@agentver/shared'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'

const adminEmails = process.env.PLATFORM_ADMIN_EMAILS
  ? process.env.PLATFORM_ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase())
  : []

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isCloud()) {
    redirect('/')
  }

  const session = await getSession()

  if (!session?.user?.email || !adminEmails.includes(session.user.email.toLowerCase())) {
    redirect('/')
  }

  return children
}
