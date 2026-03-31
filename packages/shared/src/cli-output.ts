import { z } from 'zod'
import { manifestV2PackageSchema } from './schemas'

// --- CLI output envelope ---

export const cliErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
})

export type CLIError = z.infer<typeof cliErrorSchema>

export function createCLIOutputSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: cliErrorSchema.optional(),
    warnings: z.array(z.string()).optional(),
  })
}

export type CLIOutput<T> = {
  success: boolean
  data?: T
  error?: CLIError
  warnings?: string[]
}

// --- Per-command result schemas ---

export const loginResultSchema = z.object({
  token: z.string().optional(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
  }),
})

export type LoginResult = z.infer<typeof loginResultSchema>

export const logoutResultSchema = z.object({
  cleared: z.boolean(),
})

export type LogoutResult = z.infer<typeof logoutResultSchema>

export const whoamiResultSchema = z.object({
  authenticated: z.boolean(),
  user: z
    .object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
    })
    .optional(),
  platform: z.string().optional(),
  organisation: z.string().optional(),
})

export type WhoamiResult = z.infer<typeof whoamiResultSchema>

export const installResultSchema = z.object({
  name: z.string(),
  source: z.object({
    type: z.string(),
    uri: z.string().optional(),
    baseUrl: z.string().optional(),
  }),
  agents: z.array(z.string()),
  path: z.string(),
  scope: z.string(),
  audit: z.object({
    passed: z.boolean(),
    findings: z.number(),
    blockers: z.number(),
  }),
})

export type InstallResult = z.infer<typeof installResultSchema>

export const removeResultSchema = z.object({
  name: z.string(),
  removed: z.boolean(),
  paths: z.array(z.string()),
  bundleConstituents: z.array(z.string()).optional(),
})

export const bundleInstallResultSchema = z.object({
  bundleName: z.string(),
  bundleVersion: z.string(),
  installed: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      source: z.object({ type: z.string(), uri: z.string().optional() }),
    })
  ),
  skipped: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      reason: z.string(),
    })
  ),
  mcpServers: z.array(
    z.object({
      name: z.string(),
      configured: z.boolean(),
    })
  ),
})

export type RemoveResult = z.infer<typeof removeResultSchema>

export type BundleInstallResult = z.infer<typeof bundleInstallResultSchema>

export const updateResultSchema = z.object({
  updated: z.array(
    z.object({
      name: z.string(),
      fromRef: z.string(),
      toRef: z.string(),
      strategy: z.string(),
    })
  ),
  skipped: z.array(
    z.object({
      name: z.string(),
      reason: z.string(),
    })
  ),
})

export type UpdateResult = z.infer<typeof updateResultSchema>

const scopeSchema = z.enum(['project', 'global'])

export const listPackageEntrySchema = z.object({
  name: z.string(),
  scope: scopeSchema,
  package: manifestV2PackageSchema,
})

export type ListPackageEntry = z.infer<typeof listPackageEntrySchema>

export const listResultSchema = z.object({
  packages: z.array(listPackageEntrySchema),
})

export type ListResult = z.infer<typeof listResultSchema>

export const platformSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  tags: z.array(z.string()),
  compatibilityAgents: z.array(z.string()),
  starCount: z.number(),
  installCount: z.number(),
  organisation: z.object({
    slug: z.string(),
    name: z.string(),
  }),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      icon: z.string().nullable(),
    })
  ),
})

export type PlatformSearchResult = z.infer<typeof platformSearchResultSchema>

export const communitySearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  installCount: z.number(),
  source: z.string(),
  url: z.string().optional(),
})

export type CommunitySearchResult = z.infer<typeof communitySearchResultSchema>

export const wellKnownSearchResultSchema = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string(),
})

export type WellKnownSearchResult = z.infer<typeof wellKnownSearchResultSchema>

export const searchResultSchema = z.object({
  platform: z.array(platformSearchResultSchema),
  community: z.array(communitySearchResultSchema),
  wellKnown: z.array(wellKnownSearchResultSchema),
  total: z.number(),
})

export type SearchResult = z.infer<typeof searchResultSchema>

export const auditResultSchema = z.object({
  target: z.string(),
  passed: z.boolean(),
  findings: z.array(
    z.object({
      rule: z.string(),
      severity: z.string(),
      file: z.string(),
      line: z.number(),
      evidence: z.string(),
    })
  ),
})

export type AuditResult = z.infer<typeof auditResultSchema>

export const scanResultSchema = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      paths: z.array(z.string()),
    })
  ),
  skills: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      type: z.string(),
    })
  ),
})

export type ScanResult = z.infer<typeof scanResultSchema>

export const statusResultSchema = z.object({
  packages: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      modified: z.boolean(),
      upstream: z.boolean(),
      pinned: z.boolean().optional(),
    })
  ),
  summary: z.object({
    total: z.number(),
    upToDate: z.number(),
    modified: z.number(),
    upstream: z.number(),
    unknown: z.number(),
  }),
})

export type StatusResult = z.infer<typeof statusResultSchema>

export const diffResultSchema = z.object({
  name: z.string(),
  hunks: z.array(
    z.object({
      file: z.string(),
      additions: z.number(),
      deletions: z.number(),
      content: z.string(),
    })
  ),
})

export type DiffResult = z.infer<typeof diffResultSchema>

export const proposeResultSchema = z.object({
  proposalId: z.string(),
  title: z.string(),
  url: z.string(),
})

export type ProposeResult = z.infer<typeof proposeResultSchema>

export const proposalsResultSchema = z.object({
  proposals: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      author: z.string(),
      packageName: z.string(),
      createdAt: z.string(),
    })
  ),
})

export type ProposalsResult = z.infer<typeof proposalsResultSchema>

export const agentsResultSchema = z.object({
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      configPath: z.string(),
    })
  ),
  scope: scopeSchema,
})

export type AgentsResult = z.infer<typeof agentsResultSchema>

export const logResultSchema = z.object({
  commits: z.array(
    z.object({
      sha: z.string(),
      message: z.string(),
      author: z.object({
        name: z.string(),
        email: z.string(),
        date: z.string(),
      }),
      createdAt: z.string(),
    })
  ),
})

export type LogResult = z.infer<typeof logResultSchema>

export const syncResultSchema = z.object({
  synced: z.number(),
  machineId: z.string(),
  packages: z.array(z.string()),
})

export type SyncResult = z.infer<typeof syncResultSchema>

export const initResultSchema = z.object({
  name: z.string(),
  type: z.string(),
  path: z.string(),
  files: z.array(z.string()),
})

export type InitResult = z.infer<typeof initResultSchema>

export const adoptResultSchema = z.object({
  adopted: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      type: z.string(),
      agents: z.array(z.string()),
    })
  ),
  skipped: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      reason: z.string(),
    })
  ),
})

export type AdoptResult = z.infer<typeof adoptResultSchema>

export const infoResultSchema = z.object({
  name: z.string(),
  source: z.object({
    type: z.string(),
    uri: z.string().optional(),
    ref: z.string().optional(),
    commit: z.string().optional(),
    hostname: z.string().optional(),
  }),
  agents: z.array(z.string()),
  installedAt: z.string(),
  modified: z.boolean(),
  integrity: z.string().optional(),
  files: z.object({
    count: z.number(),
    totalSize: z.number(),
  }),
  pinned: z.boolean(),
  packageType: z.string().optional(),
  bundle: z.string().optional(),
  skill: z
    .object({
      title: z.string(),
      description: z.string(),
    })
    .optional(),
})

export type InfoResult = z.infer<typeof infoResultSchema>

export const versionCreateResultSchema = z.object({
  skill: z.string(),
  version: z.string(),
  tag: z.string(),
  commitSha: z.string(),
})

export type VersionCreateResult = z.infer<typeof versionCreateResultSchema>

export const versionListEntrySchema = z.object({
  name: z.string(),
  tag: z.string(),
  commitSha: z.string(),
  message: z.string(),
})

export type VersionListEntry = z.infer<typeof versionListEntrySchema>

export const versionListResultSchema = z.object({
  versions: z.array(versionListEntrySchema),
})

export type VersionListResult = z.infer<typeof versionListResultSchema>

export const deprecateResultSchema = z.object({
  skill: z.string(),
  target: z.enum(['package', 'version']),
  version: z.string().optional(),
  status: z.literal('DEPRECATED'),
  message: z.string().optional(),
})

export type DeprecateResult = z.infer<typeof deprecateResultSchema>

export const unpublishResultSchema = z.object({
  skill: z.string(),
  version: z.string(),
  status: z.literal('YANKED'),
})

export type UnpublishResult = z.infer<typeof unpublishResultSchema>

export const upgradeResultSchema = z.object({
  current: z.string().optional(),
  previous: z.string(),
  latest: z.string(),
  packageManager: z.enum(['bun', 'npm', 'pnpm', 'yarn']).optional(),
  upToDate: z.boolean(),
  checkedOnly: z.boolean(),
  targetVersion: z.string().optional(),
})

export type UpgradeResult = z.infer<typeof upgradeResultSchema>

export const doctorCheckSchema = z.object({
  name: z.string(),
  status: z.enum(['pass', 'fail', 'warn']),
  message: z.string(),
})

export type DoctorCheck = z.infer<typeof doctorCheckSchema>

export const doctorResultSchema = z.object({
  checks: z.array(doctorCheckSchema),
  passed: z.number(),
  failed: z.number(),
  warnings: z.number(),
})

export type DoctorResult = z.infer<typeof doctorResultSchema>
