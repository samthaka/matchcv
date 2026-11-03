import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mocks.createTransport,
  },
}))

import { sendVerificationEmail } from '../src/services/email.js'

const originalProvider = process.env.EMAIL_PROVIDER
const originalUser = process.env.MAILTRAP_SMTP_USER
const originalPass = process.env.MAILTRAP_SMTP_PASS
const originalPort = process.env.MAILTRAP_SMTP_PORT
const originalApiUrl = process.env.API_PUBLIC_URL
const originalSender = process.env.RESEND_FROM_EMAIL

beforeEach(() => {
  process.env.EMAIL_PROVIDER = 'mailtrap'
  process.env.MAILTRAP_SMTP_USER = 'sandbox-user'
  process.env.MAILTRAP_SMTP_PASS = 'sandbox-password'
  process.env.MAILTRAP_SMTP_PORT = '2525'
  process.env.API_PUBLIC_URL = 'https://api.matchcv.test'
  process.env.RESEND_FROM_EMAIL = 'no-reply@matchcv.test'
  mocks.createTransport.mockReset()
  mocks.sendMail.mockReset()
  mocks.close.mockReset()
  mocks.sendMail.mockResolvedValue({ messageId: 'sandbox-message' })
  mocks.createTransport.mockReturnValue({
    sendMail: mocks.sendMail,
    close: mocks.close,
  })
})

afterEach(() => {
  if (originalProvider === undefined) delete process.env.EMAIL_PROVIDER
  else process.env.EMAIL_PROVIDER = originalProvider
  if (originalUser === undefined) delete process.env.MAILTRAP_SMTP_USER
  else process.env.MAILTRAP_SMTP_USER = originalUser
  if (originalPass === undefined) delete process.env.MAILTRAP_SMTP_PASS
  else process.env.MAILTRAP_SMTP_PASS = originalPass
  if (originalPort === undefined) delete process.env.MAILTRAP_SMTP_PORT
  else process.env.MAILTRAP_SMTP_PORT = originalPort
  if (originalApiUrl === undefined) delete process.env.API_PUBLIC_URL
  else process.env.API_PUBLIC_URL = originalApiUrl
  if (originalSender === undefined) delete process.env.RESEND_FROM_EMAIL
  else process.env.RESEND_FROM_EMAIL = originalSender
})

describe('Mailtrap Email Sandbox delivery', () => {
  it('sends verification mail only to the fixed Mailtrap sandbox host', async () => {
    await sendVerificationEmail('candidate@example.test', 'verification-token')

    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      secure: false,
      auth: { user: 'sandbox-user', pass: 'sandbox-password' },
    })
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'candidate@example.test',
      from: 'no-reply@matchcv.test',
      subject: 'Verify your MatchCV email address',
      html: expect.stringContaining(
        'https://api.matchcv.test/api/v1/auth/verify-email?token=verification-token',
      ),
      text: expect.stringContaining(
        'https://api.matchcv.test/api/v1/auth/verify-email?token=verification-token',
      ),
    }))
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('closes the SMTP connection when delivery fails', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error('Sandbox SMTP unavailable'))

    await expect(
      sendVerificationEmail('candidate@example.test', 'verification-token'),
    ).rejects.toThrow('Sandbox SMTP unavailable')
    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
