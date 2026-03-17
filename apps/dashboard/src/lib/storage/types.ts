export type StorageProvider = {
  put(key: string, data: Buffer | Uint8Array): Promise<void>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  list(prefix: string): Promise<string[]>
}
