import type { EmailProvider } from './types'

export type { EmailMessage, EmailProvider } from './types'

let cachedProvider: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (cachedProvider) return cachedProvider

  const provider = process.env.EMAIL_PROVIDER ?? 'console'

  switch (provider) {
    case 'smtp': {
      const { SmtpEmailProvider } = require('./providers/smtp') as typeof import('./providers/smtp')
      cachedProvider = new SmtpEmailProvider()
      break
    }
    default: {
      const { ConsoleEmailProvider } =
        require('./providers/console') as typeof import('./providers/console')
      cachedProvider = new ConsoleEmailProvider()
    }
  }

  return cachedProvider
}
