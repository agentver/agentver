import { createLogger } from '@agentver/shared'
import { ServerClient } from 'postmark'
import type { EmailMessage, EmailProvider } from '../types'

const logger = createLogger('email:postmark')

export class PostmarkEmailProvider implements EmailProvider {
  private client: ServerClient

  constructor() {
    const token = process.env.POSTMARK_API_TOKEN
    if (!token) {
      throw new Error(
        'POSTMARK_API_TOKEN environment variable is required for Postmark email provider'
      )
    }
    this.client = new ServerClient(token)
  }

  async send(message: EmailMessage): Promise<void> {
    const from = process.env.EMAIL_FROM ?? 'noreply@agentver.com'

    await this.client.sendEmail({
      From: from,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      MessageStream: 'outbound',
    })

    logger.debug('Email sent via Postmark', { to: message.to, subject: message.subject })
  }
}
