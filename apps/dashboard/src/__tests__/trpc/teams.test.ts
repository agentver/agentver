import { prisma } from '@agentver/database/client'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestOrgWithOwner, createTestUser } from '~/test/factories'
import { cleanDatabase, disconnectDatabase } from '~/test/helpers/db'
import { createTestCaller } from '~/test/helpers/trpc'

beforeEach(async () => {
  await cleanDatabase()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ---------------------------------------------------------------------------
// teams.list
// ---------------------------------------------------------------------------

describe('teams.list', () => {
  it('returns teams for an organisation the user belongs to', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()

    await prisma.team.create({
      data: {
        name: 'Engineering',
        slug: 'engineering',
        organisationId: org.id,
      },
    })

    const caller = createTestCaller(owner.id)
    const result = await caller.teams.list({ organisationId: org.id })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Engineering',
      slug: 'engineering',
    })
    expect(typeof result[0]!._count.members).toBe('number')
    expect(typeof result[0]!._count.packages).toBe('number')
  })

  it('returns an empty array when the organisation has no teams', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    const result = await caller.teams.list({ organisationId: org.id })

    expect(result).toEqual([])
  })

  it('throws FORBIDDEN when the user is not a member of the organisation', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    const caller = createTestCaller(outsider.id)

    await expect(caller.teams.list({ organisationId: org.id })).rejects.toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' })
    )
  })

  it('includes correct member and package counts', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const member = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
    })

    const team = await prisma.team.create({
      data: { name: 'Design', slug: 'design', organisationId: org.id },
    })

    await prisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: owner.id },
        { teamId: team.id, userId: member.id },
      ],
    })

    const caller = createTestCaller(owner.id)
    const result = await caller.teams.list({ organisationId: org.id })

    expect(result[0]!._count.members).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// teams.getBySlug
// ---------------------------------------------------------------------------

describe('teams.getBySlug', () => {
  it('returns the team with its members for a known slug', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()

    const team = await prisma.team.create({
      data: { name: 'Backend', slug: 'backend', organisationId: org.id },
    })

    await prisma.teamMember.create({ data: { teamId: team.id, userId: owner.id } })

    const caller = createTestCaller(owner.id)
    const result = await caller.teams.getBySlug({ organisationId: org.id, slug: 'backend' })

    expect(result.slug).toBe('backend')
    expect(result.members).toHaveLength(1)
    expect(result.members[0]!.userId).toBe(owner.id)
  })

  it('throws NOT_FOUND when the slug does not exist in the organisation', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    await expect(
      caller.teams.getBySlug({ organisationId: org.id, slug: 'nonexistent' })
    ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('throws NOT_FOUND when the slug exists in a different organisation', async () => {
    const { org: orgA } = await createTestOrgWithOwner()
    const { user: ownerB, org: orgB } = await createTestOrgWithOwner()

    await prisma.team.create({
      data: { name: 'Frontend', slug: 'frontend', organisationId: orgA.id },
    })

    const caller = createTestCaller(ownerB.id)

    await expect(
      caller.teams.getBySlug({ organisationId: orgB.id, slug: 'frontend' })
    ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('throws FORBIDDEN when the user is not an org member', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()

    await prisma.team.create({
      data: { name: 'Ops', slug: 'ops', organisationId: org.id },
    })

    const caller = createTestCaller(outsider.id)

    await expect(caller.teams.getBySlug({ organisationId: org.id, slug: 'ops' })).rejects.toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' })
    )
  })
})

// ---------------------------------------------------------------------------
// teams.create
// ---------------------------------------------------------------------------

describe('teams.create', () => {
  it('creates a team and auto-adds the creator as a member', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    const result = await caller.teams.create({
      organisationId: org.id,
      name: 'Infrastructure',
      slug: 'infrastructure',
    })

    expect(result.name).toBe('Infrastructure')
    expect(result.slug).toBe('infrastructure')

    const membership = await prisma.teamMember.findFirst({
      where: { teamId: result.id, userId: owner.id },
    })
    expect(membership).not.toBeNull()
  })

  it('allows an ADMIN org member to create a team', async () => {
    const { org } = await createTestOrgWithOwner()
    const admin = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
    })

    const caller = createTestCaller(admin.id)
    const result = await caller.teams.create({
      organisationId: org.id,
      name: 'Security',
      slug: 'security',
    })

    expect(result.slug).toBe('security')
  })

  it('throws FORBIDDEN when a plain MEMBER tries to create a team', async () => {
    const { org } = await createTestOrgWithOwner()
    const member = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
    })

    const caller = createTestCaller(member.id)

    await expect(
      caller.teams.create({ organisationId: org.id, name: 'Stealth', slug: 'stealth' })
    ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('throws CONFLICT when the slug is already taken within the same organisation', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()

    await prisma.team.create({
      data: { name: 'Platform', slug: 'platform', organisationId: org.id },
    })

    const caller = createTestCaller(owner.id)

    await expect(
      caller.teams.create({ organisationId: org.id, name: 'Platform 2', slug: 'platform' })
    ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }))
  })

  it('allows the same slug in a different organisation', async () => {
    const { user: ownerA, org: orgA } = await createTestOrgWithOwner()
    const { user: ownerB, org: orgB } = await createTestOrgWithOwner()

    await prisma.team.create({
      data: { name: 'Core', slug: 'core', organisationId: orgA.id },
    })

    const caller = createTestCaller(ownerB.id)
    const result = await caller.teams.create({
      organisationId: orgB.id,
      name: 'Core',
      slug: 'core',
    })

    expect(result.slug).toBe('core')
    // Suppress unused variable warning
    void ownerA
  })

  it('throws FORBIDDEN when the user does not belong to the organisation', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    const caller = createTestCaller(outsider.id)

    await expect(
      caller.teams.create({ organisationId: org.id, name: 'Ghost', slug: 'ghost' })
    ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
  })
})

// ---------------------------------------------------------------------------
// teams.addMember
// ---------------------------------------------------------------------------

describe('teams.addMember', () => {
  it('adds an org member to a team', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const member = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
    })

    const team = await prisma.team.create({
      data: { name: 'Alpha', slug: 'alpha', organisationId: org.id },
    })

    const caller = createTestCaller(owner.id)
    await caller.teams.addMember({ teamId: team.id, userId: member.id })

    const teamMember = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: member.id },
    })
    expect(teamMember).not.toBeNull()
  })

  it('throws BAD_REQUEST when the target user is not an org member', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()

    const team = await prisma.team.create({
      data: { name: 'Beta', slug: 'beta', organisationId: org.id },
    })

    const caller = createTestCaller(owner.id)

    await expect(caller.teams.addMember({ teamId: team.id, userId: outsider.id })).rejects.toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' })
    )
  })

  it('throws FORBIDDEN when a plain MEMBER tries to add someone to a team', async () => {
    const { org } = await createTestOrgWithOwner()
    const memberA = await createTestUser()
    const memberB = await createTestUser()

    await prisma.organisationMember.createMany({
      data: [
        { organisationId: org.id, userId: memberA.id, role: 'MEMBER' },
        { organisationId: org.id, userId: memberB.id, role: 'MEMBER' },
      ],
    })

    const team = await prisma.team.create({
      data: { name: 'Gamma', slug: 'gamma', organisationId: org.id },
    })

    const caller = createTestCaller(memberA.id)

    await expect(caller.teams.addMember({ teamId: team.id, userId: memberB.id })).rejects.toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' })
    )
  })

  it('allows an ADMIN to add an org member to a team', async () => {
    const { org } = await createTestOrgWithOwner()
    const admin = await createTestUser()
    const member = await createTestUser()

    await prisma.organisationMember.createMany({
      data: [
        { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
        { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      ],
    })

    const team = await prisma.team.create({
      data: { name: 'Delta', slug: 'delta', organisationId: org.id },
    })

    const caller = createTestCaller(admin.id)
    await caller.teams.addMember({ teamId: team.id, userId: member.id })

    const teamMember = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: member.id },
    })
    expect(teamMember).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// teams.removeMember
// ---------------------------------------------------------------------------

describe('teams.removeMember', () => {
  it('allows an OWNER to remove a member from a team', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const member = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
    })

    const team = await prisma.team.create({
      data: { name: 'Echo', slug: 'echo', organisationId: org.id },
    })

    await prisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: owner.id },
        { teamId: team.id, userId: member.id },
      ],
    })

    const caller = createTestCaller(owner.id)
    await caller.teams.removeMember({ teamId: team.id, userId: member.id })

    const remaining = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: member.id },
    })
    expect(remaining).toBeNull()
  })

  it('allows a member to remove themselves from a team', async () => {
    const { org } = await createTestOrgWithOwner()
    const member = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
    })

    const team = await prisma.team.create({
      data: { name: 'Foxtrot', slug: 'foxtrot', organisationId: org.id },
    })

    await prisma.teamMember.create({ data: { teamId: team.id, userId: member.id } })

    const caller = createTestCaller(member.id)
    await caller.teams.removeMember({ teamId: team.id, userId: member.id })

    const remaining = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: member.id },
    })
    expect(remaining).toBeNull()
  })

  it('throws FORBIDDEN when a non-admin member tries to remove someone else', async () => {
    const { org } = await createTestOrgWithOwner()
    const memberA = await createTestUser()
    const memberB = await createTestUser()

    await prisma.organisationMember.createMany({
      data: [
        { organisationId: org.id, userId: memberA.id, role: 'MEMBER' },
        { organisationId: org.id, userId: memberB.id, role: 'MEMBER' },
      ],
    })

    const team = await prisma.team.create({
      data: { name: 'Golf', slug: 'golf', organisationId: org.id },
    })

    await prisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: memberA.id },
        { teamId: team.id, userId: memberB.id },
      ],
    })

    const caller = createTestCaller(memberA.id)

    await expect(
      caller.teams.removeMember({ teamId: team.id, userId: memberB.id })
    ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('throws NOT_FOUND when the user is not a team member', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const nonMember = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: nonMember.id, role: 'MEMBER' },
    })

    const team = await prisma.team.create({
      data: { name: 'Hotel', slug: 'hotel', organisationId: org.id },
    })

    const caller = createTestCaller(owner.id)

    await expect(
      caller.teams.removeMember({ teamId: team.id, userId: nonMember.id })
    ).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('allows an ADMIN to remove another member from a team', async () => {
    const { org } = await createTestOrgWithOwner()
    const admin = await createTestUser()
    const member = await createTestUser()

    await prisma.organisationMember.createMany({
      data: [
        { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
        { organisationId: org.id, userId: member.id, role: 'MEMBER' },
      ],
    })

    const team = await prisma.team.create({
      data: { name: 'India', slug: 'india', organisationId: org.id },
    })

    await prisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: admin.id },
        { teamId: team.id, userId: member.id },
      ],
    })

    const caller = createTestCaller(admin.id)
    await caller.teams.removeMember({ teamId: team.id, userId: member.id })

    const remaining = await prisma.teamMember.findFirst({
      where: { teamId: team.id, userId: member.id },
    })
    expect(remaining).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// teams.delete
// ---------------------------------------------------------------------------

describe('teams.delete', () => {
  it('allows an OWNER to delete a team', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()

    const team = await prisma.team.create({
      data: { name: 'Juliet', slug: 'juliet', organisationId: org.id },
    })

    const caller = createTestCaller(owner.id)
    await caller.teams.delete({ teamId: team.id })

    const deleted = await prisma.team.findUnique({ where: { id: team.id } })
    expect(deleted).toBeNull()
  })

  it('throws FORBIDDEN when an ADMIN tries to delete a team', async () => {
    const { org } = await createTestOrgWithOwner()
    const admin = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: admin.id, role: 'ADMIN' },
    })

    const team = await prisma.team.create({
      data: { name: 'Kilo', slug: 'kilo', organisationId: org.id },
    })

    const caller = createTestCaller(admin.id)

    await expect(caller.teams.delete({ teamId: team.id })).rejects.toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' })
    )
  })

  it('throws FORBIDDEN when a plain MEMBER tries to delete a team', async () => {
    const { org } = await createTestOrgWithOwner()
    const member = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
    })

    const team = await prisma.team.create({
      data: { name: 'Lima', slug: 'lima', organisationId: org.id },
    })

    const caller = createTestCaller(member.id)

    await expect(caller.teams.delete({ teamId: team.id })).rejects.toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' })
    )
  })

  it('throws FORBIDDEN when an outsider tries to delete a team', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()

    const team = await prisma.team.create({
      data: { name: 'Mike', slug: 'mike', organisationId: org.id },
    })

    const caller = createTestCaller(outsider.id)

    await expect(caller.teams.delete({ teamId: team.id })).rejects.toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' })
    )
  })
})
