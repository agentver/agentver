declare module 'nodemailer' {
  type TransportOptions = {
    host?: string
    port?: number
    secure?: boolean
    auth?: { user: string; pass?: string }
  }

  type MailOptions = {
    from?: string
    to: string
    subject: string
    html?: string
    text?: string
  }

  type Transporter = {
    sendMail(options: MailOptions): Promise<void>
  }

  function createTransport(options: TransportOptions): Transporter
}
