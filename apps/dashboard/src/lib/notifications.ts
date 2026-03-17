import type { NotificationType, PrismaClient } from '@agentver/database'
import { createLogger } from '@agentver/shared'

const logger = createLogger('notifications')

type CreateNotificationInput = {
  userId: string
  type: NotificationType
  title: string
  body?: string
  resourceId?: string
  resourceType?: string
  actorId?: string
}

/**
 * Create a single notification. Non-blocking — failures are logged
 * but never propagate to the caller.
 */
export async function createNotification(
  prisma: PrismaClient,
  input: CreateNotificationInput
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        resourceId: input.resourceId ?? null,
        resourceType: input.resourceType ?? null,
        actorId: input.actorId ?? null,
      },
    })
  } catch (error) {
    logger.error('Failed to create notification', {
      type: input.type,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Batch-create multiple notifications. Non-blocking — failures are logged
 * but never propagate to the caller.
 */
export async function createNotifications(
  prisma: PrismaClient,
  inputs: CreateNotificationInput[]
): Promise<void> {
  if (inputs.length === 0) return

  try {
    await prisma.notification.createMany({
      data: inputs.map((input) => ({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        resourceId: input.resourceId ?? null,
        resourceType: input.resourceType ?? null,
        actorId: input.actorId ?? null,
      })),
    })
  } catch (error) {
    logger.error('Failed to create batch notifications', {
      count: inputs.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
