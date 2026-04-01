import { describe, expect, it } from 'vitest'
import { sanitiseRedirectUrl } from '@/lib/auth/redirect'

describe('sanitiseRedirectUrl', () => {
  it('allows local absolute paths', () => {
    expect(sanitiseRedirectUrl('/dashboard?tab=skills#top')).toBe('/dashboard?tab=skills#top')
  })

  it('falls back to root for empty values', () => {
    expect(sanitiseRedirectUrl(undefined)).toBe('/')
    expect(sanitiseRedirectUrl(null)).toBe('/')
    expect(sanitiseRedirectUrl('')).toBe('/')
  })

  it('rejects protocol-relative redirects', () => {
    expect(sanitiseRedirectUrl('//evil.example')).toBe('/')
  })

  it('rejects absolute external urls', () => {
    expect(sanitiseRedirectUrl('https://evil.example')).toBe('/')
    expect(sanitiseRedirectUrl('javascript:alert(1)')).toBe('/')
  })

  it('rejects percent-encoded bypass attempts', () => {
    expect(sanitiseRedirectUrl('%2F%2Fevil.com')).toBe('/')
    expect(sanitiseRedirectUrl('/%2Fevil.com')).toBe('/')
  })

  it('rejects data: URLs', () => {
    expect(sanitiseRedirectUrl('data:text/html,<script>alert(1)</script>')).toBe('/')
  })
})
