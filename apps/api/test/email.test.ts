import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendVerificationEmail } from '../src/services/email.js'

const originalProvider = process.env.EMAIL_PROVIDER
const originalApiKey = process.env.RESEND_API_KEY
const originalMailtrapUser = process.env.MAILTRAP_SMTP_USER
const originalMailtrapPass = process.env.MAILTRAP_SMTP_PASS
const originalPort = process.env.MAILTRAP_SMTP_PORT
const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  if (originalProvider === undefined) delete process.env.EMAIL_PROVIDER
  else process.env.EMAIL_PROVIDER = originalProvider
  if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = originalApiKey
  if (originalMailtrapUser === undefined) delete process.env.MAILTRAP_SMTP_USER
  else process.env.MAILTRAP_SMTP_USER = originalMailtrapUser
  if (originalMailtrapPass === undefined) delete process.env.MAILTRAP_SMTP_PASS
  else process.env.MAILTRAP_SMTP_PASS = originalMailtrapPass
  if (originalPort === undefined) delete process.env.MAILTRAP_SMTP_PORT
  else process.env.MAILTRAP_SMTP_PORT = originalPort
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  vi.restoreAllMocks()
})

describe('verification email provider configuration', () => {
  it('defaults to Mailtrap outside production so local testing cannot send live mail', async () => {
    delete process.env.EMAIL_PROVIDER
    process.env.NODE_ENV = 'test'
    delete process.env.MAILTRAP_SMTP_USER
    delete process.env.MAILTRAP_SMTP_PASS
    process.env.RESEND_API_KEY = 'must-not-be-used'

    await expect(
      sendVerificationEmail('test@example.test', 'a'.repeat(64)),
    ).rejects.toThrow('MAILTRAP_SMTP_USER and MAILTRAP_SMTP_PASS are required for Mailtrap')
  })

  it('uses the Mailtrap sandbox provider only when explicitly selected', async () => {
    process.env.EMAIL_PROVIDER = 'mailtrap'
    delete process.env.MAILTRAP_SMTP_USER
    delete process.env.MAILTRAP_SMTP_PASS
    process.env.RESEND_API_KEY = 'must-not-be-used'

    await expect(
      sendVerificationEmail('test@example.test', 'a'.repeat(64)),
    ).rejects.toThrow('MAILTRAP_SMTP_USER and MAILTRAP_SMTP_PASS are required for Mailtrap')
  })

  it('validates the sandbox SMTP port before attempting a connection', async () => {
    process.env.EMAIL_PROVIDER = 'mailtrap'
    process.env.MAILTRAP_SMTP_USER = 'sandbox-user'
    process.env.MAILTRAP_SMTP_PASS = 'sandbox-password'
    process.env.MAILTRAP_SMTP_PORT = 'not-a-port'

    await expect(
      sendVerificationEmail('test@example.test', 'a'.repeat(64)),
    ).rejects.toThrow('MAILTRAP_SMTP_PORT must be a valid TCP port')
  })

  it('rejects unknown email providers instead of silently falling back', async () => {
    process.env.EMAIL_PROVIDER = 'unknown-provider'
    process.env.RESEND_API_KEY = 'must-not-be-used'

    await expect(
      sendVerificationEmail('test@example.test', 'a'.repeat(64)),
    ).rejects.toThrow('Unsupported EMAIL_PROVIDER: unknown-provider')
  })

  it('requires a Resend API key when Resend is selected', async () => {
    process.env.EMAIL_PROVIDER = 'resend'
    delete process.env.RESEND_API_KEY

    await expect(
      sendVerificationEmail('test@example.test', 'a'.repeat(64)),
    ).rejects.toThrow('RESEND_API_KEY is not configured')
  })
})
