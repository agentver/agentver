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
})

export type RemoveResult = z.infer<typeof removeResultSchema>

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

export const listResultSchema = z.object({
  packages: z.record(z.string(), manifestV2PackageSchema),
})

export type ListResult = z.infer<typeof listResultSchema>

export const searchResultSchema = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      type: z.string(),
      source: z.string(),
      url: z.string().optional(),
    })
  ),
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
  skill: z
    .object({
      title: z.string(),
      description: z.string(),
    })
    .optional(),
})

export type InfoResult = z.infer<typeof infoResultSchema>

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
