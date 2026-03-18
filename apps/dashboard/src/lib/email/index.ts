import type { EmailProvider } from './types'

export type { EmailMessage, EmailProvider } from './types'

type ProviderModule = { new (): EmailProvider }

let cachedProvider: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (cachedProvider) return cachedProvider

  const provider = process.env.EMAIL_PROVIDER ?? 'console'

  switch (provider) {
    case 'postmark': {
      const { PostmarkEmailProvider } = require('./providers/postmark') as {
        PostmarkEmailProvider: ProviderModule
      }
      cachedProvider = new PostmarkEmailProvider()
      break
    }
    case 'smtp': {
      const { SmtpEmailProvider } = require('./providers/smtp') as {
        SmtpEmailProvider: ProviderModule
      }
      cachedProvider = new SmtpEmailProvider()
      break
    }
    default: {
      const { ConsoleEmailProvider } = require('./providers/console') as {
        ConsoleEmailProvider: ProviderModule
      }
      cachedProvider = new ConsoleEmailProvider()
    }
  }

  return cachedProvider
}
