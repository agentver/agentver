import { Button } from '@agentver/ui/components/button'
import Link from 'next/link'

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4">
      <div className="text-center">
        <h2 className="font-display font-semibold text-xl">Page not found</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          The page you're looking for doesn't exist or has been moved.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Back to dashboard</Link>
      </Button>
    </div>
  )
}
