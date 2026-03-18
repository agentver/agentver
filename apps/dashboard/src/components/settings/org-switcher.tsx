'use client'

import { Button } from '@agentver/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@agentver/ui/components/select'
import { Skeleton } from '@agentver/ui/components/skeleton'
import { Building2, Plus } from 'lucide-react'
import { useState } from 'react'
import { CreateOrganisationDialog } from '@/components/settings/create-organisation-dialog'
import { useOrgContext } from '@/hooks/use-org-context'

export function OrgSwitcher() {
  const { selectedOrg, orgs, setSelectedOrg, isLoading } = useOrgContext()
  const [createOpen, setCreateOpen] = useState(false)

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />
  }

  if (orgs.length === 0) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
          Create Organisation
        </Button>
        <CreateOrganisationDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    )
  }

  if (orgs.length === 1) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-3 py-2">
          <Building2 className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{orgs[0]!.name}</p>
            <p className="truncate text-muted-foreground text-xs">{orgs[0]!.slug}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
          Create Organisation
        </Button>
        <CreateOrganisationDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    )
  }

  return (
    <>
      <Select
        value={selectedOrg?.slug ?? ''}
        onValueChange={(value) => {
          if (value === '__create__') {
            setCreateOpen(true)
            return
          }
          setSelectedOrg(value)
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select organisation" />
        </SelectTrigger>
        <SelectContent>
          {orgs.map((org) => (
            <SelectItem key={org.id} value={org.slug}>
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-muted-foreground" />
                <div>
                  <span className="font-medium">{org.name}</span>
                  <span className="ml-2 text-muted-foreground text-xs">{org.slug}</span>
                </div>
              </div>
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value="__create__">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Plus className="size-4" />
              <span>Create Organisation</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
      <CreateOrganisationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
