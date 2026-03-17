import { createLogger } from '@agentver/shared'

const logger = createLogger('github-webhook')

type GitHubWebhook = {
  id: number
  active: boolean
  events: string[]
  config: {
    url: string
    content_type: string
    insecure_ssl: string
  }
}

type GitHubApiError = {
  message: string
  errors?: Array<{ message: string }>
}

export async function registerWebhook(
  accessToken: string,
  repoOwner: string,
  repoName: string,
  webhookUrl: string
): Promise<{ webhookId: number }> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('GITHUB_WEBHOOK_SECRET environment variable is not set')
  }

  const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/hooks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['push'],
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
    }),
  })

  if (!response.ok) {
    const body = (await response.json()) as GitHubApiError
    logger.error('Failed to register webhook', {
      status: response.status,
      message: body.message,
      repoOwner,
      repoName,
    })
    throw new Error(`Failed to register GitHub webhook: ${body.message}`)
  }

  const webhook = (await response.json()) as GitHubWebhook
  logger.info('Webhook registered', {
    webhookId: webhook.id,
    repoOwner,
    repoName,
  })

  return { webhookId: webhook.id }
}

export async function deleteWebhook(
  accessToken: string,
  repoOwner: string,
  repoName: string,
  webhookId: number
): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/hooks/${webhookId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  )

  if (!response.ok && response.status !== 404) {
    logger.error('Failed to delete webhook', {
      status: response.status,
      webhookId,
      repoOwner,
      repoName,
    })
    throw new Error(`Failed to delete GitHub webhook: ${response.status}`)
  }

  logger.info('Webhook deleted', { webhookId, repoOwner, repoName })
}
