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
// apiKeys.list
// ---------------------------------------------------------------------------

describe('apiKeys.list', () => {
  it("returns the calling user's API keys for the given organisation", async () => {
    const { user: owner, org } = await createTestOrgWithOwner()

    // Seed a key directly so we are not dependent on the create procedure
    await prisma.apiKey.create({
      data: {
        name: 'CI Key',
        keyPrefix: 'av_ci12',
        keyHash: 'deadbeef',
        scopes: ['READ'],
        organisationId: org.id,
        userId: owner.id,
      },
    })

    const caller = createTestCaller(owner.id)
    const result = await caller.apiKeys.list({ organisationId: org.id })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'CI Key',
      keyPrefix: 'av_ci12',
      scopes: ['READ'],
    })
  })

  it('does not return the full key hash in the list response', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()

    await prisma.apiKey.create({
      data: {
        name: 'Secret Key',
        keyPrefix: 'av_sec1',
        keyHash: 'supersecrethashedvalue',
        scopes: ['WRITE'],
        organisationId: org.id,
        userId: owner.id,
      },
    })

    const caller = createTestCaller(owner.id)
    const result = await caller.apiKeys.list({ organisationId: org.id })

    expect(result[0]).not.toHaveProperty('keyHash')
    // The raw key is never returned in list
    expect(result[0]).not.toHaveProperty('key')
  })

  it("returns only the calling user's keys, not keys belonging to other users", async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const otherMember = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: otherMember.id, role: 'MEMBER' },
    })

    await prisma.apiKey.create({
      data: {
        name: 'Other User Key',
        keyPrefix: 'av_oth1',
        keyHash: 'otherhash',
        scopes: ['READ'],
        organisationId: org.id,
        userId: otherMember.id,
      },
    })

    const caller = createTestCaller(owner.id)
    const result = await caller.apiKeys.list({ organisationId: org.id })

    expect(result).toHaveLength(0)
  })

  it('returns an empty array when the user has no API keys in the organisation', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    const result = await caller.apiKeys.list({ organisationId: org.id })

    expect(result).toEqual([])
  })

  it('returns the expected shape including optional fields', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const expiresAt = new Date('2027-01-01T00:00:00Z')

    await prisma.apiKey.create({
      data: {
        name: 'Expiring Key',
        keyPrefix: 'av_exp1',
        keyHash: 'exphash',
        scopes: ['READ', 'WRITE'],
        expiresAt,
        organisationId: org.id,
        userId: owner.id,
      },
    })

    const caller = createTestCaller(owner.id)
    const result = await caller.apiKeys.list({ organisationId: org.id })

    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('name')
    expect(result[0]).toHaveProperty('keyPrefix')
    expect(result[0]).toHaveProperty('scopes')
    expect(result[0]).toHaveProperty('expiresAt')
    expect(result[0]).toHaveProperty('lastUsedAt')
    expect(result[0]).toHaveProperty('createdAt')
    expect(result[0]!.expiresAt?.toISOString()).toBe(expiresAt.toISOString())
  })

  it('returns an empty array when the user is not a member of the organisation', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    const caller = createTestCaller(outsider.id)

    // The list procedure filters by userId so non-members see an empty array
    const result = await caller.apiKeys.list({ organisationId: org.id })
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// apiKeys.create
// ---------------------------------------------------------------------------

describe('apiKeys.create', () => {
  it('creates an API key and returns the plaintext key exactly once', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    const result = await caller.apiKeys.create({
      name: 'Deploy Key',
      organisationId: org.id,
      scopes: ['READ'],
    })

    expect(result).toHaveProperty('key')
    expect(typeof result.key).toBe('string')
    expect(result.key.startsWith('av_')).toBe(true)
  })

  it('stores a SHA256 hash rather than the plaintext key', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    const result = await caller.apiKeys.create({
      name: 'Hashed Key',
      organisationId: org.id,
      scopes: ['WRITE'],
    })

    const stored = await prisma.apiKey.findFirst({
      where: { userId: owner.id, organisationId: org.id },
    })

    expect(stored).not.toBeNull()
    // The stored hash must not equal the raw key
    expect(stored?.keyHash).not.toBe(result.key)
    // SHA256 hex digest is 64 characters
    expect(stored?.keyHash).toHaveLength(64)
  })

  it('stores the key prefix (first N characters of the raw key)', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    const result = await caller.apiKeys.create({
      name: 'Prefix Key',
      organisationId: org.id,
      scopes: ['READ'],
    })

    const stored = await prisma.apiKey.findFirst({
      where: { userId: owner.id, organisationId: org.id },
    })

    expect(stored?.keyPrefix).toBeTruthy()
    expect(result.key.startsWith(stored!.keyPrefix)).toBe(true)
  })

  it('accepts all valid scope values', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    const result = await caller.apiKeys.create({
      name: 'Full Access Key',
      organisationId: org.id,
      scopes: ['READ', 'WRITE', 'ADMIN'],
    })

    expect(result.key).toBeTruthy()

    const stored = await prisma.apiKey.findFirst({
      where: { userId: owner.id, organisationId: org.id },
    })
    expect(stored?.scopes).toEqual(expect.arrayContaining(['READ', 'WRITE', 'ADMIN']))
  })

  it('persists the optional expiresAt when provided', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)
    const expiresAt = new Date('2028-06-01T00:00:00Z')

    await caller.apiKeys.create({
      name: 'Temporary Key',
      organisationId: org.id,
      scopes: ['READ'],
      expiresAt: expiresAt.toISOString(),
    })

    const stored = await prisma.apiKey.findFirst({
      where: { userId: owner.id, organisationId: org.id },
    })

    expect(stored?.expiresAt?.toISOString()).toBe(expiresAt.toISOString())
  })

  it('creates the key with a null expiresAt when not provided', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    await caller.apiKeys.create({
      name: 'Permanent Key',
      organisationId: org.id,
      scopes: ['READ'],
    })

    const stored = await prisma.apiKey.findFirst({
      where: { userId: owner.id, organisationId: org.id },
    })

    expect(stored?.expiresAt).toBeNull()
  })

  it('associates the key with the calling user', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    await caller.apiKeys.create({
      name: 'Owner Key',
      organisationId: org.id,
      scopes: ['READ'],
    })

    const stored = await prisma.apiKey.findFirst({
      where: { organisationId: org.id },
    })

    expect(stored?.userId).toBe(owner.id)
  })

  it('throws FORBIDDEN when the user is not a member of the organisation', async () => {
    const { org } = await createTestOrgWithOwner()
    const outsider = await createTestUser()
    const caller = createTestCaller(outsider.id)

    await expect(
      caller.apiKeys.create({ name: 'Sneaky Key', organisationId: org.id, scopes: ['READ'] })
    ).rejects.toThrow(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('allows a plain MEMBER (not just OWNER/ADMIN) to create an API key', async () => {
    const { org } = await createTestOrgWithOwner()
    const member = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: member.id, role: 'MEMBER' },
    })

    const caller = createTestCaller(member.id)
    const result = await caller.apiKeys.create({
      name: 'Member Key',
      organisationId: org.id,
      scopes: ['READ'],
    })

    expect(result.key.startsWith('av_')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// apiKeys.revoke
// ---------------------------------------------------------------------------

describe('apiKeys.revoke', () => {
  it('allows the key owner to revoke their own key', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()

    const apiKey = await prisma.apiKey.create({
      data: {
        name: 'Revokable Key',
        keyPrefix: 'av_rev1',
        keyHash: 'revhash',
        scopes: ['READ'],
        organisationId: org.id,
        userId: owner.id,
      },
    })

    const caller = createTestCaller(owner.id)
    await caller.apiKeys.revoke({ id: apiKey.id })

    const deleted = await prisma.apiKey.findUnique({ where: { id: apiKey.id } })
    expect(deleted).toBeNull()
  })

  it('throws NOT_FOUND when the key does not exist', async () => {
    const { user: owner } = await createTestOrgWithOwner()
    const caller = createTestCaller(owner.id)

    await expect(caller.apiKeys.revoke({ id: 'nonexistent-id' })).rejects.toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    )
  })

  it('throws NOT_FOUND when the key exists but belongs to a different user', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()
    const otherMember = await createTestUser()

    await prisma.organisationMember.create({
      data: { organisationId: org.id, userId: otherMember.id, role: 'MEMBER' },
    })

    const apiKey = await prisma.apiKey.create({
      data: {
        name: "Other's Key",
        keyPrefix: 'av_oth2',
        keyHash: 'otherhash2',
        scopes: ['READ'],
        organisationId: org.id,
        userId: otherMember.id,
      },
    })

    // The owner attempts to revoke a key they do not own
    const caller = createTestCaller(owner.id)

    await expect(caller.apiKeys.revoke({ id: apiKey.id })).rejects.toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    )
  })

  it('does not delete other keys belonging to the same user', async () => {
    const { user: owner, org } = await createTestOrgWithOwner()

    const keyToRevoke = await prisma.apiKey.create({
      data: {
        name: 'Key A',
        keyPrefix: 'av_ka11',
        keyHash: 'hashA',
        scopes: ['READ'],
        organisationId: org.id,
        userId: owner.id,
      },
    })

    const keyToKeep = await prisma.apiKey.create({
      data: {
        name: 'Key B',
        keyPrefix: 'av_kb22',
        keyHash: 'hashB',
        scopes: ['WRITE'],
        organisationId: org.id,
        userId: owner.id,
      },
    })

    const caller = createTestCaller(owner.id)
    await caller.apiKeys.revoke({ id: keyToRevoke.id })

    const remaining = await prisma.apiKey.findUnique({ where: { id: keyToKeep.id } })
    expect(remaining).not.toBeNull()
  })
})
