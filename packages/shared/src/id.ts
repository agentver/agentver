import { nanoid } from 'nanoid'

export function generateId(size = 21): string {
  return nanoid(size)
}

export function generateShortId(): string {
  return nanoid(12)
}
