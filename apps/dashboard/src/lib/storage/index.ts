import type { StorageProvider } from './types'

export type { StorageProvider } from './types'

let cachedProvider: StorageProvider | null = null

export function getStorageProvider(): StorageProvider {
  if (cachedProvider) return cachedProvider

  const adapter = process.env.STORAGE_ADAPTER ?? 'local'

  switch (adapter) {
    case 's3': {
      const { S3StorageProvider } = require('./providers/s3') as typeof import('./providers/s3')
      cachedProvider = new S3StorageProvider()
      break
    }
    default: {
      const { LocalStorageProvider } =
        require('./providers/local') as typeof import('./providers/local')
      cachedProvider = new LocalStorageProvider()
    }
  }

  return cachedProvider
}
