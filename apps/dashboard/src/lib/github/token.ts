import { prisma } from '@agentver/database'
import { createLogger } from '@agentver/shared'
import { decryptToken, TokenDecryptionError } from '@/lib/crypto/token-encryption'

const logger = createLogger('github:token')

/**
 * Get the GitHub access token for a user's connected account.
 * Returns the decrypted token or null if no account is connected.
 * Returns null if the stored token cannot be decrypted.
 */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const account = await prisma.connectedAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'GITHUB',
      },
    },
    select: { accessToken: true },
  })

  if (!account?.accessToken) {
    return null
  }

  try {
    return decryptToken(account.accessToken)
  } catch (error) {
    if (error instanceof TokenDecryptionError) {
      logger.error('Failed to decrypt GitHub token — user should reconnect their account', {
        userId,
      })
      return null
    }
    throw error
  }
}
