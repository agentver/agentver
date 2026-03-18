import { describe, expect, it } from 'vitest'
import { buildPasswordResetEmail } from '~/lib/email/templates/password-reset'

describe('buildPasswordResetEmail', () => {
  it('sets the to field from recipientEmail', () => {
    const result = buildPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl: 'https://example.com/reset?token=abc',
      expiresInMinutes: 30,
    })

    expect(result.to).toBe('user@example.com')
  })

  it('includes expiresInMinutes in the HTML', () => {
    const result = buildPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl: 'https://example.com/reset?token=abc',
      expiresInMinutes: 45,
    })

    expect(result.html).toContain('45')
  })

  it('includes expiresInMinutes in the plain text body', () => {
    const result = buildPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl: 'https://example.com/reset?token=abc',
      expiresInMinutes: 45,
    })

    expect(result.text).toContain('45')
  })

  it('uses a URL with & in the query string as-is in the href (no &amp; encoding)', () => {
    const url = 'https://example.com/reset?token=abc&expires=1234'
    const result = buildPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl: url,
      expiresInMinutes: 30,
    })

    expect(result.html).toContain(`href="${url}"`)
    expect(result.html).not.toContain('&amp;')
  })

  it('replaces a javascript: scheme URL with # in the href', () => {
    const result = buildPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl: 'javascript:alert(1)',
      expiresInMinutes: 30,
    })

    expect(result.html).toContain('href="#"')
    expect(result.html).not.toContain('javascript:')
  })

  it('uses a valid relative URL starting with / as-is in the href', () => {
    const url = '/reset?token=abc'
    const result = buildPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl: url,
      expiresInMinutes: 30,
    })

    expect(result.html).toContain(`href="${url}"`)
  })

  it('uses the original raw URL in the plain text body', () => {
    const url = 'javascript:alert(1)'
    const result = buildPasswordResetEmail({
      recipientEmail: 'user@example.com',
      resetUrl: url,
      expiresInMinutes: 30,
    })

    expect(result.text).toContain(url)
  })
})
