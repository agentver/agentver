import { randomUUID } from 'node:crypto'
import type {
  Organisation,
  OrganisationMember,
  Package,
  PackageVersion,
  User,
} from '@agentver/database/client'
import { prisma } from '@agentver/database/client'

export function createTestUser(
  overrides?: Partial<Parameters<typeof prisma.user.create>[0]['data']>
): Promise<User> {
  return prisma.user.create({
    data: {
      email: `test-${randomUUID().slice(0, 8)}@example.com`,
      name: 'Test User',
      ...overrides,
    },
  })
}

export function createTestOrg(
  overrides?: Partial<Parameters<typeof prisma.organisation.create>[0]['data']>
): Promise<Organisation> {
  return prisma.organisation.create({
    data: {
      name: 'Test Org',
      slug: `test-org-${randomUUID().slice(0, 8)}`,
      ...overrides,
    },
  })
}

export async function createTestOrgWithOwner(): Promise<{
  user: User
  org: Organisation
  membership: OrganisationMember
}> {
  const user = await createTestUser()
  const org = await createTestOrg()
  const membership = await prisma.organisationMember.create({
    data: {
      userId: user.id,
      organisationId: org.id,
      role: 'OWNER',
    },
  })
  return { user, org, membership }
}

export function createTestPackage(
  organisationId: string,
  authorId: string,
  overrides?: Record<string, unknown>
): Promise<Package> {
  return prisma.package.create({
    data: {
      name: `test-skill-${randomUUID().slice(0, 8)}`,
      slug: `test-skill-${randomUUID().slice(0, 8)}`,
      type: 'SKILL',
      visibility: 'PUBLIC',
      organisationId,
      authorId,
      gitUri: 'https://github.com/test/repo',
      gitPath: '',
      gitDefaultRef: 'main',
      ...overrides,
    },
  })
}

export function createTestVersion(
  packageId: string,
  overrides?: Record<string, unknown>
): Promise<PackageVersion> {
  return prisma.packageVersion.create({
    data: {
      packageId,
      version: '1.0.0',
      gitRef: 'main',
      gitCommitSha: 'abc1234',
      ...overrides,
    },
  })
}
