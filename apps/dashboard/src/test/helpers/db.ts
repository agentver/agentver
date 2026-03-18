import { prisma } from '@agentver/database/client'

export async function cleanDatabase() {
  // Delete in reverse dependency order
  const tables = [
    'WebhookDelivery',
    'WebhookEndpoint',
    'SkillMaintainer',
    'Draft',
    'PackageCategory',
    'Category',
    'Star',
    'ProposalReview',
    'ProposalComment',
    'ChangeProposal',
    'Notification',
    'AuditLog',
    'CollectionItem',
    'Collection',
    'InstallationReport',
    'PackageInstall',
    'PackageVersion',
    'Package',
    'ApiKey',
    'ConnectedAccount',
    'TeamMember',
    'Team',
    'OrganisationInvitation',
    'OrganisationMember',
    'Organisation',
    'User',
  ]
  for (const table of tables) {
    const modelName = table.charAt(0).toLowerCase() + table.slice(1)
    const model = (prisma as unknown as Record<string, { deleteMany: () => Promise<unknown> }>)[
      modelName
    ]
    if (model) {
      await model.deleteMany()
    }
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect()
}
