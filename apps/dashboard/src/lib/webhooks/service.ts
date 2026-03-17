import { createHmac, timingSafeEqual } from 'node:crypto'
import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'

const logger = createLogger('webhooks')

const DELIVERY_TIMEOUT_MS = 10_000
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_SECONDS = [60, 300, 1_800] as const // 1m, 5m, 30m
const RETRY_POLL_INTERVAL_MS = 30_000
const RETRY_BATCH_SIZE = 10

type WebhookEvent =
  | 'skill.created'
  | 'skill.updated'
  | 'skill.deleted'
  | 'version.published'
  | 'suggestion.opened'
  | 'suggestion.merged'
  | 'suggestion.rejected'
  | 'member.added'
  | 'member.removed'

type WebhookPayload = {
  event: WebhookEvent
  timestamp: string
  actor: { id: string; username: string }
  data: Record<string, unknown>
}

type WebhookActor = {
  id: string
  username: string
}

/**
 * Generate an HMAC-SHA256 signature for a webhook payload.
 */
function signPayload(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(payload)
  return `sha256=${hmac.digest('hex')}`
}

/**
 * Verify an HMAC-SHA256 signature for a webhook payload.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = signPayload(payload, secret)

  if (signature.length !== expected.length) {
    return false
  }

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

/**
 * Send a single webhook delivery to an endpoint.
 * Records the result in the WebhookDelivery table.
 */
async function sendDelivery(
  endpointId: string,
  url: string,
  secret: string,
  event: WebhookEvent,
  payload: WebhookPayload,
  deliveryId?: string
): Promise<void> {
  const body = JSON.stringify(payload)
  const signature = signPayload(body, secret)

  let status = 0
  let response: string | null = null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Agentver-Signature': signature,
        'X-Agentver-Event': event,
      },
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    status = res.status
    response = await res.text().catch(() => null)
  } catch (error) {
    status = 0
    response = error instanceof Error ? error.message : 'Unknown error'

    logger.warn('Webhook delivery failed', {
      endpointId,
      url,
      event,
      error: response,
    })
  }

  const isSuccess = status >= 200 && status < 300

  if (deliveryId) {
    const updated = await prisma.webhookDelivery
      .update({
        where: { id: deliveryId },
        data: {
          status,
          response: response?.slice(0, 5000) ?? null,
          attempts: { increment: 1 },
          nextRetryAt: null,
        },
        select: { attempts: true },
      })
      .catch((err: unknown) => {
        logger.error('Failed to update webhook delivery', {
          deliveryId,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      })

    if (!isSuccess && updated && updated.attempts < MAX_ATTEMPTS) {
      await scheduleRetry(deliveryId, updated.attempts)
    }
  } else {
    const delivery = await prisma.webhookDelivery
      .create({
        data: {
          endpointId,
          event,
          payload: payload as unknown as Parameters<
            typeof prisma.webhookDelivery.create
          >[0]['data']['payload'],
          status,
          response: response?.slice(0, 5000) ?? null,
          attempts: 1,
        },
      })
      .catch((err: unknown) => {
        logger.error('Failed to create webhook delivery record', {
          endpointId,
          event,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      })

    if (!isSuccess && delivery) {
      await scheduleRetry(delivery.id, 1)
    }
  }
}

/**
 * Schedule a retry by setting nextRetryAt on the delivery record.
 */
async function scheduleRetry(deliveryId: string, attemptNumber: number): Promise<void> {
  if (attemptNumber >= MAX_ATTEMPTS) return

  const delaySeconds =
    RETRY_DELAYS_SECONDS[attemptNumber - 1] ??
    RETRY_DELAYS_SECONDS[RETRY_DELAYS_SECONDS.length - 1]!

  const nextRetryAt = new Date(Date.now() + delaySeconds * 1_000)

  await prisma.webhookDelivery
    .update({
      where: { id: deliveryId },
      data: { nextRetryAt },
    })
    .catch((err: unknown) => {
      logger.error('Failed to schedule webhook retry', {
        deliveryId,
        attemptNumber,
        error: err instanceof Error ? err.message : String(err),
      })
    })
}

/**
 * Execute a retry for a specific delivery.
 */
async function executeRetry(delivery: {
  id: string
  endpointId: string
  event: string
  payload: unknown
  attempts: number
  endpoint: { url: string; secret: string; active: boolean }
}): Promise<void> {
  if (!delivery.endpoint.active) return
  if (delivery.attempts >= MAX_ATTEMPTS) return

  const payload = delivery.payload as unknown as WebhookPayload

  await sendDelivery(
    delivery.endpointId,
    delivery.endpoint.url,
    delivery.endpoint.secret,
    delivery.event as WebhookEvent,
    payload,
    delivery.id
  )
}

/**
 * Process due retries from the database. Queries for deliveries whose
 * nextRetryAt has passed, claims them atomically by clearing nextRetryAt,
 * then re-attempts each delivery.
 */
async function processRetries(): Promise<void> {
  try {
    const due = await prisma.webhookDelivery.findMany({
      where: {
        nextRetryAt: { lte: new Date() },
        attempts: { lt: MAX_ATTEMPTS },
      },
      include: {
        endpoint: { select: { url: true, secret: true, active: true } },
      },
      take: RETRY_BATCH_SIZE,
    })

    for (const delivery of due) {
      const claimed = await prisma.webhookDelivery
        .updateMany({
          where: {
            id: delivery.id,
            nextRetryAt: { not: null },
          },
          data: { nextRetryAt: null },
        })
        .catch((err: unknown) => {
          logger.error('Failed to claim webhook retry', {
            deliveryId: delivery.id,
            error: err instanceof Error ? err.message : String(err),
          })
          return { count: 0 }
        })

      if (claimed.count === 0) continue

      await executeRetry(delivery)
    }
  } catch (error) {
    logger.error('Failed to process webhook retries', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Manually retry a failed delivery.
 */
export async function retryDelivery(deliveryId: string): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      endpoint: { select: { url: true, secret: true, active: true } },
    },
  })

  if (!delivery) {
    throw new Error('Delivery not found')
  }

  if (delivery.attempts >= MAX_ATTEMPTS) {
    throw new Error('Maximum retry attempts reached')
  }

  if (!delivery.endpoint.active) {
    throw new Error('Endpoint is inactive')
  }

  const payload = delivery.payload as unknown as WebhookPayload

  await sendDelivery(
    delivery.endpointId,
    delivery.endpoint.url,
    delivery.endpoint.secret,
    delivery.event as WebhookEvent,
    payload,
    deliveryId
  )
}

/**
 * Deliver a webhook event to all active endpoints for an organisation
 * that subscribe to the given event type. Fire-and-forget — never blocks
 * the calling operation.
 */
export function deliverEvent(
  organisationId: string,
  event: WebhookEvent,
  actor: WebhookActor,
  data: Record<string, unknown>
): void {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    actor,
    data,
  }

  prisma.webhookEndpoint
    .findMany({
      where: {
        organisationId,
        active: true,
        events: { has: event },
      },
      select: {
        id: true,
        url: true,
        secret: true,
      },
    })
    .then((endpoints) => {
      for (const endpoint of endpoints) {
        void sendDelivery(endpoint.id, endpoint.url, endpoint.secret, event, payload)
      }
    })
    .catch((error: unknown) => {
      logger.error('Failed to fetch webhook endpoints for delivery', {
        organisationId,
        event,
        error: error instanceof Error ? error.message : String(error),
      })
    })
}

/**
 * Start the periodic retry polling loop.
 * Returns a cleanup function to stop the interval.
 */
export function startRetryScheduler(intervalMs: number = RETRY_POLL_INTERVAL_MS): () => void {
  const interval = setInterval(() => {
    void processRetries()
  }, intervalMs)

  logger.info('Webhook retry scheduler started', { intervalMs })

  return () => {
    clearInterval(interval)
    logger.info('Webhook retry scheduler stopped')
  }
}

export const WEBHOOK_EVENTS = [
  'skill.created',
  'skill.updated',
  'skill.deleted',
  'version.published',
  'suggestion.opened',
  'suggestion.merged',
  'suggestion.rejected',
  'member.added',
  'member.removed',
] as const satisfies readonly WebhookEvent[]

export type { WebhookActor, WebhookEvent, WebhookPayload }
