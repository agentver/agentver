import { z } from 'zod'

const REF_PATTERN = /^[a-zA-Z0-9/_.-]{1,200}$/
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i

export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, 'Must be valid semver')

export function isValidGitRef(ref: string): boolean {
  if (FULL_SHA_PATTERN.test(ref)) {
    return true
  }

  return (
    REF_PATTERN.test(ref) &&
    !ref.includes('..') &&
    !ref.startsWith('.') &&
    !ref.endsWith('.') &&
    !ref.includes('//')
  )
}
