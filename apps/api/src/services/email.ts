import { Resend } from 'resend'
import nodemailer from 'nodemailer'

const defaultSender = 'onboarding@resend.dev'
const mailtrapHost = 'sandbox.smtp.mailtrap.io'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;')
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const publicApiUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3000'
  const verificationUrl = new URL('/api/v1/auth/verify-email', publicApiUrl)
  verificationUrl.searchParams.set('token', token)

  const from = process.env.RESEND_FROM_EMAIL ?? defaultSender
  const content = {
    to,
    from,
    subject: 'Verify your MatchCV email address',
    html: `<p>Confirm your email address to finish creating your MatchCV account.</p><p><a href="${escapeHtml(verificationUrl.toString())}">Verify email address</a></p><p>This link expires in 24 hours.</p>`,
    text: `Confirm your email address to finish creating your MatchCV account:\n${verificationUrl.toString()}\n\nThis link expires in 24 hours.`,
  }

  const provider = process.env.EMAIL_PROVIDER
    ?? (process.env.NODE_ENV === 'production' ? 'resend' : 'mailtrap')
  if (provider === 'mailtrap') {
    const user = process.env.MAILTRAP_SMTP_USER
    const pass = process.env.MAILTRAP_SMTP_PASS
    if (!user || !pass) {
      throw new Error('MAILTRAP_SMTP_USER and MAILTRAP_SMTP_PASS are required for Mailtrap')
    }

    const port = Number(process.env.MAILTRAP_SMTP_PORT ?? 2525)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('MAILTRAP_SMTP_PORT must be a valid TCP port')
    }

    const transporter = nodemailer.createTransport({
      host: mailtrapHost,
      port,
      secure: port === 465,
      auth: { user, pass },
    })
    try {
      await transporter.sendMail(content)
    } finally {
      transporter.close()
    }
    return
  }

  if (provider !== 'resend') {
    throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`)
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send(content)
  if (error) {
    throw new Error(`Resend failed to send verification email: ${error.message}`)
  }
}
