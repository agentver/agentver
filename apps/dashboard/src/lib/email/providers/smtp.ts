import type { EmailMessage, EmailProvider } from '../types'

export class SmtpEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    const nodemailer = await import('nodemailer')

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? '587'),
      secure: process.env.SMTP_PORT === '465',
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    })

    await transporter.sendMail({
      from: process.env.EMAIL_FROM ?? 'noreply@localhost',
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    })
  }
}
