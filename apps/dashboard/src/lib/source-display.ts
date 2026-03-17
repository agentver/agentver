export type ProviderDisplayInfo = {
  label: string
  colour: string
}

export const PROVIDER_DISPLAY: Record<string, ProviderDisplayInfo> = {
  GITHUB: {
    label: 'GitHub',
    colour: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
  },
  GITLAB: {
    label: 'GitLab',
    colour: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  },
  BITBUCKET: {
    label: 'Bitbucket',
    colour: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  },
  GOOGLE: {
    label: 'Google Drive',
    colour: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  },
  MICROSOFT: {
    label: 'OneDrive',
    colour: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  },
}

export type AdoptionModeDisplayInfo = {
  label: string
  verb: string
  colour: string
}

export const ADOPTION_MODE_DISPLAY: Record<string, AdoptionModeDisplayInfo> = {
  COPY: {
    label: 'Copied',
    verb: 'Copied from',
    colour: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  MIRROR: {
    label: 'Mirrored',
    verb: 'Mirrored from',
    colour: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  },
  LINK: {
    label: 'Linked',
    verb: 'Linked to',
    colour: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  },
}

export function getSourceLabel(provider: string, adoptionMode: string): string {
  const modeDisplay = ADOPTION_MODE_DISPLAY[adoptionMode]
  const providerDisplay = PROVIDER_DISPLAY[provider]
  if (!modeDisplay || !providerDisplay) return ''
  return `${modeDisplay.verb} ${providerDisplay.label}`
}
