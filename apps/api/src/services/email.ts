import { Resend } from 'resend'

const defaultSender = 'onboarding@resend.dev'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;')
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  const publicApiUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3000'
  const verificationUrl = new URL('/api/v1/auth/verify-email', publicApiUrl)
  verificationUrl.searchParams.set('token', token)

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? defaultSender,
    to,
    subject: 'Verify your MatchCV email address',
    html: `<p>Confirm your email address to finish creating your MatchCV account.</p><p><a href="${escapeHtml(verificationUrl.toString())}">Verify email address</a></p><p>This link expires in 24 hours.</p>`,
    text: `Confirm your email address to finish creating your MatchCV account:\n${verificationUrl.toString()}\n\nThis link expires in 24 hours.`,
  })

  if (error) {
    throw new Error(`Resend failed to send verification email: ${error.message}`)
  }
}
