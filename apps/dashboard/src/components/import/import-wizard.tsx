'use client'

import { FolderSearch } from 'lucide-react'
import Image from 'next/image'

type ImportSource = 'github' | 'gitlab' | 'bitbucket' | 'google-drive' | 'onedrive' | 'scan'

type ImportWizardProps = {
  onSourceSelect: (source: ImportSource) => void
}

const sources = [
  {
    id: 'github' as const,
    name: 'GitHub',
    description: 'Import skills and configurations from a GitHub repository',
    logo: '/images/integrations/github.svg',
    available: true,
  },
  {
    id: 'gitlab' as const,
    name: 'GitLab',
    description: 'Import skills and configurations from a GitLab project',
    logo: '/images/integrations/gitlab.svg',
    available: true,
  },
  {
    id: 'bitbucket' as const,
    name: 'Bitbucket',
    description: 'Import skills and configurations from a Bitbucket repository',
    logo: '/images/integrations/bitbucket.svg',
    available: true,
  },
  {
    id: 'google-drive' as const,
    name: 'Google Drive',
    description: 'Import skills and configurations directly from your Google Drive',
    logo: '/images/integrations/google-drive.png',
    available: true,
  },
  {
    id: 'onedrive' as const,
    name: 'OneDrive',
    description: 'Import skills and configurations from your Microsoft OneDrive',
    logo: '/images/integrations/microsoft-onedrive.png',
    available: true,
  },
  {
    id: 'scan' as const,
    name: 'Scan Directory',
    description:
      'Automatically detect agent configurations and skills by scanning a repository URL',
    logo: null,
    available: true,
  },
]

export function ImportWizard({ onSourceSelect }: ImportWizardProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sources.map((source) => (
        <button
          key={source.id}
          type="button"
          disabled={!source.available}
          onClick={() => source.available && onSourceSelect(source.id)}
          className="group rounded-xl border border-border bg-card p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-black/[0.03] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          <div className="flex items-center gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted">
              {source.logo ? (
                <Image
                  src={source.logo}
                  alt={source.name}
                  width={28}
                  height={28}
                  className={`size-7${source.id === 'github' ? 'dark:invert' : ''}`}
                />
              ) : (
                <FolderSearch className="size-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <h3 className="font-display font-semibold tracking-tight">{source.name}</h3>
              <p className="mt-0.5 text-muted-foreground text-sm">{source.description}</p>
            </div>
          </div>
          {!source.available && <p className="mt-3 text-muted-foreground text-xs">Coming soon</p>}
        </button>
      ))}
    </div>
  )
}
