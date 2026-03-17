import type { StorageProvider } from '../types'

type S3ClientType = {
  send(command: unknown): Promise<unknown>
}

type S3Sdk = {
  S3Client: new (config: {
    endpoint?: string
    region?: string
    credentials?: { accessKeyId: string; secretAccessKey: string }
    forcePathStyle?: boolean
  }) => S3ClientType
  PutObjectCommand: new (input: Record<string, unknown>) => unknown
  GetObjectCommand: new (input: Record<string, unknown>) => unknown
  DeleteObjectCommand: new (input: Record<string, unknown>) => unknown
  HeadObjectCommand: new (input: Record<string, unknown>) => unknown
  ListObjectsV2Command: new (input: Record<string, unknown>) => unknown
}

/**
 * S3-compatible storage provider (AWS S3, MinIO, Cloudflare R2).
 *
 * Requires `@aws-sdk/client-s3` as a peer dependency — install it
 * separately to use this provider:
 *
 *   bun add @aws-sdk/client-s3
 *
 * Reads configuration from environment variables:
 *   S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 */
export class S3StorageProvider implements StorageProvider {
  private client: unknown
  private readonly bucket: string

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? 'agentver'
    this.client = this.createClient()
  }

  private createClient(): unknown {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { S3Client } = require('@aws-sdk/client-s3') as {
        S3Client: new (config: Record<string, unknown>) => unknown
      }
      return new S3Client({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? 'auto',
        credentials:
          process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
            ? {
                accessKeyId: process.env.S3_ACCESS_KEY_ID,
                secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
              }
            : undefined,
        forcePathStyle: true,
      })
    } catch {
      throw new Error('Install @aws-sdk/client-s3 to use S3 storage: bun add @aws-sdk/client-s3')
    }
  }

  async put(key: string, data: Buffer | Uint8Array): Promise<void> {
    const { PutObjectCommand } = await this.loadSdk()
    await this.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }))
  }

  async get(key: string): Promise<Buffer | null> {
    const { GetObjectCommand } = await this.loadSdk()
    try {
      const response = await this.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      const body = (response as Record<string, unknown>).Body
      if (!body) return null
      // Body is a readable stream — collect into a Buffer
      const chunks: Uint8Array[] = []
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        return null
      }
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await this.loadSdk()
    await this.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await this.loadSdk()
    try {
      await this.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return true
    } catch {
      return false
    }
  }

  async list(prefix: string): Promise<string[]> {
    const { ListObjectsV2Command } = await this.loadSdk()
    const keys: string[] = []
    let continuationToken: string | undefined

    do {
      const response = (await this.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      )) as { Contents?: { Key?: string }[]; NextContinuationToken?: string; IsTruncated?: boolean }

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) keys.push(obj.Key)
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return keys
  }

  private async loadSdk(): Promise<S3Sdk> {
    try {
      return require('@aws-sdk/client-s3') as S3Sdk
    } catch {
      throw new Error('Install @aws-sdk/client-s3 to use S3 storage: bun add @aws-sdk/client-s3')
    }
  }

  private async send(command: unknown): Promise<unknown> {
    const client = this.client as { send: (cmd: unknown) => Promise<unknown> }
    return client.send(command)
  }
}
