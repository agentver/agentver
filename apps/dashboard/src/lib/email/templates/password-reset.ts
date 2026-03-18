import type { EmailMessage } from '../types'

type PasswordResetEmailParams = {
  recipientEmail: string
  resetUrl: string
  expiresInMinutes: number
}

function getSafeResetUrl(url: string): string {
  if (url.startsWith('https://') || url.startsWith('/')) return url
  return '#'
}

export function buildPasswordResetEmail(params: PasswordResetEmailParams): EmailMessage {
  const safeUrl = getSafeResetUrl(params.resetUrl)

  return {
    to: params.recipientEmail,
    subject: 'Reset your Agentver password',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 0;">
        <h2 style="margin: 0 0 16px;">Reset your password</h2>
        <p style="color: #555; line-height: 1.6;">
          We received a request to reset the password for your Agentver account.
          Click the button below to choose a new password.
        </p>
        <div style="margin: 24px 0;">
          <a href="${safeUrl}"
             style="display: inline-block; background: #171717; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
            Reset Password
          </a>
        </div>
        <p style="color: #888; font-size: 14px;">
          This link expires in ${params.expiresInMinutes} minutes. If you didn't request a password reset, you can safely ignore this email.
        </p>
      </div>
    `,
    text: [
      'Reset your password',
      '',
      'We received a request to reset the password for your Agentver account.',
      '',
      `Reset your password: ${params.resetUrl}`,
      '',
      `This link expires in ${params.expiresInMinutes} minutes. If you didn't request a password reset, you can safely ignore this email.`,
    ].join('\n'),
  }
}
