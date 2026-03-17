import { Prisma, prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'

const logger = createLogger('audit')

const AUDIT_ACTIONS = [
  'PACKAGE_CATEGORIES_UPDATED',
  'PACKAGE_CREATED',
  'PACKAGE_UPDATED',
  'PACKAGE_DELETED',
  'PACKAGE_ARCHIVED',
  'PACKAGE_DEPRECATED',
  'PACKAGE_ACTIVATED',
  'VERSION_PUBLISHED',
  'PACKAGE_FORKED',
  'PACKAGE_SYNCED',
  'API_KEY_CREATED',
  'API_KEY_REVOKED',
  'ORG_CREATED',
  'MEMBER_INVITED',
  'MEMBER_REMOVED',
  'COLLECTION_CREATED',
  'IMPORT_COMPLETED',
  'WEBHOOK_REGISTERED',
  'PROPOSAL_CREATED',
  'PROPOSAL_MERGED',
  'PROPOSAL_REJECTED',
  'PROPOSAL_CLOSED',
  'SKILLS_REPO_CONNECTED',
  'SKILLS_REPO_DISCONNECTED',
  'ORG_UPDATED',
  'ORG_DELETED',
  'MEMBER_ROLE_UPDATED',
  'CONNECTION_DISCONNECTED',
  'VERIFICATION_REQUESTED',
  'VERIFICATION_APPROVED',
  'SECRET_CREATED',
  'SECRET_ROTATED',
  'SECRET_DELETED',
  'MCP_SERVER_UPSERTED',
  'MCP_OAUTH_CREDENTIAL_STORED',
  'BUNDLE_INSTALLED',
  'USER_SUSPENDED',
  'USER_UNSUSPENDED',
  'VERSION_DEPRECATED',
  'VERSION_YANKED',
  'VERSION_RESTORED',
  'PACKAGE_ARCHIVED',
  'PACKAGE_DEPRECATED',
  'PACKAGE_ACTIVATED',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

type AuditParams = {
  userId: string
  action: AuditAction
  resource: string
  resourceId?: string
  metadata?: Record<string, unknown>
}

/**
 * Non-blocking audit log writer.
 * Failures are logged but never propagate to the caller.
 */
export function logAudit(params: AuditParams): void {
  prisma.auditLog
    .create({
      data: {
        userId: params.userId,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId ?? null,
        metadata: (params.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    })
    .catch((error: unknown) => {
      logger.error('Failed to write audit log', {
        action: params.action,
        resource: params.resource,
        error: error instanceof Error ? error.message : String(error),
      })
    })
}
