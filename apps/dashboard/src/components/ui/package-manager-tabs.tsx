'use client'

import { Button } from '@agentver/ui/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@agentver/ui/components/tabs'
import { cn } from '@agentver/ui-utils'
import { Check, Copy, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

const PREFERRED_PM_KEY = 'agentver:preferred-pm'

const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm', 'yarn'] as const
type PackageManager = (typeof PACKAGE_MANAGERS)[number]

type PackageManagerTabsProps = {
  /** The package or command to install */
  packageName: string
  /** Whether this is a global install (-g) */
  global?: boolean
  /** Whether to show the one-off execution variant (bunx/npx/etc.) */
  showExec?: boolean
  /** Custom commands per manager (overrides default install) */
  customCommands?: Partial<Record<PackageManager, string>>
  /** Additional descriptive text shown above the command */
  description?: string
  /** Additional CSS class for the outer wrapper */
  className?: string
}

function getInstallCommand(pm: PackageManager, packageName: string, global?: boolean): string {
  if (global) {
    const commands: Record<PackageManager, string> = {
      bun: `bun add -g ${packageName}`,
      npm: `npm install -g ${packageName}`,
      pnpm: `pnpm add -g ${packageName}`,
      yarn: `yarn global add ${packageName}`,
    }
    return commands[pm]
  }

  const commands: Record<PackageManager, string> = {
    bun: `bun add ${packageName}`,
    npm: `npm install ${packageName}`,
    pnpm: `pnpm add ${packageName}`,
    yarn: `yarn add ${packageName}`,
  }
  return commands[pm]
}

function getExecCommand(pm: PackageManager, packageName: string): string {
  const commands: Record<PackageManager, string> = {
    bun: `bunx ${packageName}`,
    npm: `npx ${packageName}`,
    pnpm: `pnpm dlx ${packageName}`,
    yarn: `yarn dlx ${packageName}`,
  }
  return commands[pm]
}

function isValidPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value)
}

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [command])

  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 font-mono text-sm">
      <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
      <code className="flex-1 select-all text-foreground">{command}</code>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={handleCopy}
        aria-label={copied ? 'Copied to clipboard' : 'Copy command to clipboard'}
      >
        {copied ? <Check className="size-3 text-emerald-600" /> : <Copy className="size-3" />}
      </Button>
    </div>
  )
}

export function PackageManagerTabs({
  packageName,
  global,
  showExec,
  customCommands,
  description,
  className,
}: PackageManagerTabsProps) {
  const [selectedPm, setSelectedPm] = useState<PackageManager>('bun')

  useEffect(() => {
    const stored = localStorage.getItem(PREFERRED_PM_KEY)
    if (stored && isValidPackageManager(stored)) {
      setSelectedPm(stored)
    }
  }, [])

  const handlePmChange = useCallback((value: string) => {
    if (!isValidPackageManager(value)) return
    setSelectedPm(value)
    localStorage.setItem(PREFERRED_PM_KEY, value)
  }, [])

  return (
    <div className={cn('space-y-2', className)}>
      {description && <p className="text-muted-foreground text-sm">{description}</p>}
      <Tabs value={selectedPm} onValueChange={handlePmChange}>
        <TabsList className="h-9">
          {PACKAGE_MANAGERS.map((pm) => (
            <TabsTrigger
              key={pm}
              value={pm}
              className="px-3 py-1 text-xs"
              aria-label={`Show ${pm} command`}
            >
              {pm}
            </TabsTrigger>
          ))}
        </TabsList>

        {PACKAGE_MANAGERS.map((pm) => {
          const command = customCommands?.[pm] ?? getInstallCommand(pm, packageName, global)
          const execCommand = showExec ? getExecCommand(pm, packageName) : null

          return (
            <TabsContent key={pm} value={pm} className="mt-2 space-y-2">
              <CommandBlock command={command} />
              {execCommand && <CommandBlock command={execCommand} />}
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}
