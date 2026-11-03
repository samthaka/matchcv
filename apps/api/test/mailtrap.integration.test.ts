import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { sendVerificationEmail } from '../src/services/email.js'

it('delivers a verification email to the Mailtrap Email Sandbox', async () => {
  if (!process.env.MAILTRAP_SMTP_USER || !process.env.MAILTRAP_SMTP_PASS) {
    throw new Error(
      'Set MAILTRAP_SMTP_USER and MAILTRAP_SMTP_PASS from your Mailtrap Email Sandbox before running this test.',
    )
  }

  process.env.EMAIL_PROVIDER = 'mailtrap'
  process.env.API_PUBLIC_URL ??= 'http://localhost:3000'
  const token = randomBytes(32).toString('hex')

  await expect(
    sendVerificationEmail(
      process.env.MAILTRAP_TEST_TO ?? 'matchcv-sandbox@example.test',
      token,
    ),
  ).resolves.toBeUndefined()
})
