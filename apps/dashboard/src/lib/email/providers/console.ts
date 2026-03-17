import { createLogger } from '@agentver/shared'
import type { EmailMessage, EmailProvider } from '../types'

const logger = createLogger('email:console')

export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    logger.info(`[Email] To: ${message.to} | Subject: ${message.subject}`)
  }
}
