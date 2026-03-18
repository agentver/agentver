'use client'

import { Button } from '@agentver/ui/components/button'
import { LogoIcon } from '@agentver/ui/components/logo'
import { AlertCircle, CheckCircle2, Loader2, Users } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { use, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { trpc } from '@/trpc/client'

type InvitationPageProps = {
  params: Promise<{ token: string }>
}

export default function InvitationAcceptPage({ params }: InvitationPageProps) {
  const { token } = use(params)
  const router = useRouter()

  const acceptInvitation = trpc.organisations.acceptInvitation.useMutation()
  const mutateRef = useRef(acceptInvitation.mutate)
  mutateRef.current = acceptInvitation.mutate

  useEffect(() => {
    mutateRef.current({ token })
  }, [token])

  const data = acceptInvitation.data
  const error = acceptInvitation.error

  useEffect(() => {
    if (!data) return

    if (!data.requiresAuth && !data.alreadyMember) {
      toast.success(`You've joined ${data.organisation.name}`)
      router.push('/settings/organisation')
    }

    if (!data.requiresAuth && data.alreadyMember) {
      router.push('/settings/organisation')
    }
  }, [data, router])

  const signInUrl = data?.requiresAuth
    ? `/sign-in?email=${encodeURIComponent(data.email)}&callbackUrl=${encodeURIComponent(`/invitations/${token}`)}`
    : '/sign-in'

  const signUpUrl = data?.requiresAuth
    ? `/sign-up?email=${encodeURIComponent(data.email)}&callbackUrl=${encodeURIComponent(`/invitations/${token}`)}`
    : '/sign-up'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8">
      <div className="flex animate-fade-up items-center gap-2.5">
        <LogoIcon className="h-9 w-auto text-primary" />
        <span className="font-display font-semibold text-foreground text-xl tracking-tight">
          agentver
        </span>
      </div>

      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8">
        {acceptInvitation.isPending && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground text-sm">Verifying invitation…</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div className="space-y-2">
              <h2 className="font-semibold text-foreground text-lg">Invitation Not Found</h2>
              <p className="text-muted-foreground text-sm">
                This invitation may have expired or been cancelled. Contact the organisation owner
                to send a new invite.
              </p>
            </div>
            <Link href="/sign-in">
              <Button variant="outline">Go to Sign In</Button>
            </Link>
          </div>
        )}

        {data?.requiresAuth && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="font-semibold text-foreground text-lg">You&apos;ve been invited</h2>
              <p className="text-muted-foreground text-sm">
                You&apos;ve been invited to join{' '}
                <span className="font-medium text-foreground">{data.organisation.name}</span> as a{' '}
                <span className="font-medium text-foreground">{data.role.toLowerCase()}</span>.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3">
              <Link href={signInUrl} className="w-full">
                <Button className="w-full">Sign in to accept</Button>
              </Link>
              <Link href={signUpUrl} className="w-full">
                <Button variant="outline" className="w-full">
                  Create an account
                </Button>
              </Link>
            </div>
          </div>
        )}

        {data && !data.requiresAuth && (
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <p className="text-muted-foreground text-sm">Redirecting…</p>
          </div>
        )}
      </div>
    </div>
  )
}
