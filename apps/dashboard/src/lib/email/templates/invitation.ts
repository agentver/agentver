import type { EmailMessage } from '../types'
import { escapeHtml } from '../utils'

type InvitationEmailParams = {
  recipientEmail: string
  inviterName: string
  organisationName: string
  role: string
  acceptUrl: string
  expiresAt: Date
}

export function buildInvitationEmail(params: InvitationEmailParams): EmailMessage {
  const expiryDate = params.expiresAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const safeName = escapeHtml(params.inviterName)
  const safeOrg = escapeHtml(params.organisationName)
  const safeRole = escapeHtml(params.role.toLowerCase())
  const safeUrl = escapeHtml(params.acceptUrl)

  return {
    to: params.recipientEmail,
    subject: `${params.inviterName} invited you to join ${params.organisationName} on Agentver`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 0;">
        <h2 style="margin: 0 0 16px;">You've been invited to ${safeOrg}</h2>
        <p style="color: #555; line-height: 1.6;">
          <strong>${safeName}</strong> has invited you to join
          <strong>${safeOrg}</strong> as a <strong>${safeRole}</strong> on Agentver.
        </p>
        <div style="margin: 24px 0;">
          <a href="${safeUrl}"
             style="display: inline-block; background: #171717; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
            Accept Invitation
          </a>
        </div>
        <p style="color: #888; font-size: 14px;">
          This invitation expires on ${expiryDate}. If you didn't expect this email you can safely ignore it.
        </p>
      </div>
    `,
    text: [
      `${params.inviterName} invited you to join ${params.organisationName} on Agentver.`,
      `Role: ${params.role.toLowerCase()}`,
      ``,
      `Accept the invitation: ${params.acceptUrl}`,
      ``,
      `This invitation expires on ${expiryDate}.`,
    ].join('\n'),
  }
}
