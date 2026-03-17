import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createLogger } from '@agentver/shared'

const logger = createLogger('crypto:token-encryption')

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class TokenDecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenDecryptionError'
  }
}

function getEncryptionKey(): Buffer | null {
  const key = process.env.TOKEN_ENCRYPTION_KEY
  if (!key) {
    return null
  }

  const keyBuffer = Buffer.from(key, 'base64')
  if (keyBuffer.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (256 bits) when base64-decoded')
  }

  return keyBuffer
}

/**
 * Encrypt a plaintext token using AES-256-GCM.
 * Returns the ciphertext in the format: `iv:authTag:ciphertext` (all base64).
 * If TOKEN_ENCRYPTION_KEY is not set, returns plaintext with a warning (local dev fallback).
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey()
  if (!key) {
    logger.warn(
      'TOKEN_ENCRYPTION_KEY not set — storing token as plaintext (not safe for production)'
    )
    return plaintext
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

/**
 * Decrypt a token encrypted with `encryptToken`.
 * If the value does not look like an encrypted token (no colons), returns it as-is
 * to support migration from plaintext tokens.
 */
export function decryptToken(ciphertext: string): string {
  // If the value doesn't contain the expected format, treat as plaintext (migration support)
  const parts = ciphertext.split(':')
  if (parts.length !== 3) {
    return ciphertext
  }

  const key = getEncryptionKey()
  if (!key) {
    logger.warn('TOKEN_ENCRYPTION_KEY not set — returning token as-is (not safe for production)')
    return ciphertext
  }

  const [ivB64, authTagB64, encryptedB64] = parts

  try {
    const iv = Buffer.from(ivB64!, 'base64')
    const authTag = Buffer.from(authTagB64!, 'base64')
    const encrypted = Buffer.from(encryptedB64!, 'base64')

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return decrypted.toString('utf-8')
  } catch (error) {
    logger.error('Token decryption failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw new TokenDecryptionError(
      'Failed to decrypt token — the stored credentials may be corrupted or the encryption key may have changed'
    )
  }
}
