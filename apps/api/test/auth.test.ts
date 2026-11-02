import { createHash } from 'node:crypto'
import express from 'express'
import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { SignJWT, jwtVerify } from 'jose'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'

const { sendVerificationEmailMock } = vi.hoisted(() => ({
  sendVerificationEmailMock: vi.fn<(email: string, token: string) => Promise<void>>(),
}))

vi.mock('../src/services/email.js', () => ({
  sendVerificationEmail: sendVerificationEmailMock,
}))

import { app } from '../src/app.js'
import { authenticate, requireRole } from '../src/middleware/authenticate.js'
import { RefreshTokenModel } from '../src/models/refresh-token.js'
import { UserModel } from '../src/models/user.js'

const accessSecretValue = 'test-access-secret-value-with-at-least-32-bytes'
const refreshSecretValue = 'test-refresh-secret-value-with-at-least-32-bytes'
const accessSecret = new TextEncoder().encode(accessSecretValue)
let mongoServer: MongoMemoryServer
let clientAddress = 1

function nextAddress(): string {
  const address = clientAddress++
  return `10.${(address >> 16) & 255}.${(address >> 8) & 255}.${address & 255}`
}

function post(path: string, body?: Record<string, unknown>, address = nextAddress()) {
  const testRequest = request(app).post(path).set('X-Forwarded-For', address)
  return body === undefined ? testRequest : testRequest.send(body)
}

function get(path: string, address = nextAddress()) {
  return request(app).get(path).set('X-Forwarded-For', address)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function createUnverifiedAccount(email = 'candidate@example.com'): Promise<string> {
  const result = await post('/api/v1/auth/register', {
    email,
    password: 'a-strong-password',
  }).expect(201)

  expect(sendVerificationEmailMock).toHaveBeenCalled()
  const token = sendVerificationEmailMock.mock.calls.at(-1)?.[1]
  expect(token).toMatch(/^[a-f0-9]{64}$/)
  expect(result.body.message).toMatch(/Check your email/)
  if (!token) {
    throw new Error('Verification email was not sent with a token')
  }
  return token
}

async function verifyAccount(token: string): Promise<request.Response> {
  return post('/api/v1/auth/verify-email', { token }).expect(303)
}

async function createVerifiedAccount(email = 'candidate@example.com'): Promise<void> {
  const token = await createUnverifiedAccount(email)
  await verifyAccount(token)
}

function setCookieHeader(response: request.Response): string {
  const setCookie = response.headers['set-cookie']
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie
  if (!cookie) {
    throw new Error('Response did not set a cookie')
  }
  return cookie
}

function cookieFrom(response: request.Response): string {
  return setCookieHeader(response).split(';', 1)[0] ?? ''
}

async function signAccessToken(role: 'CANDIDATE' | 'ADMIN' = 'CANDIDATE', tokenUse = 'access') {
  return new SignJWT({ role, tokenUse })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(new mongoose.Types.ObjectId().toString())
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(accessSecret)
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = accessSecretValue
  process.env.JWT_REFRESH_SECRET = refreshSecretValue
  app.set('trust proxy', 1)

  mongoServer = await MongoMemoryServer.create()
  await mongoose.connect(mongoServer.getUri())
  await Promise.all([UserModel.init(), RefreshTokenModel.init()])
})

beforeEach(() => {
  sendVerificationEmailMock.mockReset()
  sendVerificationEmailMock.mockResolvedValue()
})

afterEach(async () => {
  await Promise.all([UserModel.deleteMany({}), RefreshTokenModel.deleteMany({})])
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongoServer.stop()
})

describe('health and registration', () => {
  it('returns the API health response', async () => {
    await get('/api/v1/health').expect(200, { status: 'ok', service: 'api' })
  })

  it('validates registration fields and password bounds', async () => {
    await post('/api/v1/auth/register', { email: 'bad-email', password: 'short' })
      .expect(400)
      .expect(({ body }) => expect(body.error).toBe('Invalid request body'))

    await post('/api/v1/auth/register', {
      email: 'candidate@example.com',
      password: 'a'.repeat(73),
    }).expect(400)
  })

  it('creates a candidate with a hashed password and sends a verification email', async () => {
    await post('/api/v1/auth/register', {
      email: '  CANDIDATE@EXAMPLE.COM ',
      password: 'a-strong-password',
    }).expect(201)

    const user = await UserModel.findOne({ email: 'candidate@example.com' }).select('+passwordHash')
    expect(user).not.toBeNull()
    expect(user?.role).toBe('CANDIDATE')
    expect(user?.emailVerifiedAt).toBeNull()
    expect(user?.passwordHash).not.toBe('a-strong-password')
    expect(user?.passwordHash).toMatch(/^\$2/)
    expect(sendVerificationEmailMock).toHaveBeenCalledOnce()
    expect(sendVerificationEmailMock.mock.calls[0]?.[0]).toBe('candidate@example.com')
  })

  it('rejects duplicate email addresses', async () => {
    await createUnverifiedAccount()
    await post('/api/v1/auth/register', {
      email: 'candidate@example.com',
      password: 'a-different-password',
    }).expect(409)
  })

  it('retains the account and returns a server error if email delivery fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendVerificationEmailMock.mockRejectedValueOnce(new Error('Mail service unavailable'))
    const response = await post('/api/v1/auth/register', {
      email: 'delivery-failure@example.com',
      password: 'a-strong-password',
    }).expect(502)
    expect(response.body).toEqual({ error: 'Unable to send verification email' })

    expect(errorLog).toHaveBeenCalledOnce()
    const loggedError: unknown = errorLog.mock.calls[0]?.[0]
    expect(loggedError).toMatchObject({
      message: 'Unable to send verification email',
      statusCode: 502,
      cause: expect.objectContaining({ message: 'Mail service unavailable' }),
    })
    await expect(UserModel.findOne({ email: 'delivery-failure@example.com' })).resolves.not.toBeNull()
  })
})

describe('email verification', () => {
  it('does not verify on link open and redirects after explicit confirmation', async () => {
    const token = await createUnverifiedAccount()
    const linkPage = await get(`/api/v1/auth/verify-email?token=${token}`).expect(200)
    expect(linkPage.text).toContain('<style>')
    expect(linkPage.text).toContain('Verify email address')
    expect(linkPage.headers['cache-control']).toBe('no-store')

    await post('/api/v1/auth/login', {
      email: 'candidate@example.com',
      password: 'a-strong-password',
    }).expect(403)

    const confirmation = await verifyAccount(token)
    expect(confirmation.headers.location).toBe('http://localhost:5173/login?email-verified=1')
    await post('/api/v1/auth/login', {
      email: 'candidate@example.com',
      password: 'a-strong-password',
    }).expect(200)
  })

  it('rejects malformed, unknown, expired, and already-used verification tokens', async () => {
    await post('/api/v1/auth/verify-email', { token: 'bad-token' }).expect(400)
    await post('/api/v1/auth/verify-email', { token: 'a'.repeat(64) }).expect(400)

    const token = await createUnverifiedAccount()
    await UserModel.updateOne(
      { email: 'candidate@example.com' },
      { $set: { emailVerificationTokenExpiresAt: new Date(Date.now() - 1000) } },
    )
    await post('/api/v1/auth/verify-email', { token }).expect(400)

    const freshToken = await createUnverifiedAccount('another@example.com')
    await verifyAccount(freshToken)
    await post('/api/v1/auth/verify-email', { token: freshToken }).expect(400)
  })

  it('resends verification for pending users without revealing account existence', async () => {
    await createUnverifiedAccount()
    const firstToken = sendVerificationEmailMock.mock.calls[0]?.[1]

    await post('/api/v1/auth/verification/resend', { email: 'candidate@example.com' })
      .expect(202)
      .expect(({ body }) => expect(body.message).toMatch(/has been sent to your email/))

    const newToken = sendVerificationEmailMock.mock.calls[1]?.[1]
    expect(newToken).toBeDefined()
    expect(newToken).not.toBe(firstToken)
    await post('/api/v1/auth/verify-email', { token: firstToken }).expect(400)
    await verifyAccount(newToken as string)
  })

  it('returns the same response when resending for an unknown account', async () => {
    const response = await post('/api/v1/auth/verification/resend', {
      email: 'missing@example.com',
    }).expect(202)
    expect(sendVerificationEmailMock).not.toHaveBeenCalled()
    expect(response.body.message).toMatch(/has been sent to your email/)
  })
})

describe('login, refresh, and logout', () => {
  it('rejects invalid credentials without disclosing which field was wrong', async () => {
    await createVerifiedAccount()
    await post('/api/v1/auth/login', {
      email: 'candidate@example.com',
      password: 'incorrect-password',
    }).expect(401, { error: 'Invalid email or password' })
    await post('/api/v1/auth/login', {
      email: 'missing@example.com',
      password: 'incorrect-password',
    }).expect(401, { error: 'Invalid email or password' })
  })

  it('issues a short-lived access token and HttpOnly refresh cookie on login', async () => {
    await createVerifiedAccount()
    const response = await post('/api/v1/auth/login', {
      email: 'candidate@example.com',
      password: 'a-strong-password',
    }).expect(200)

    expect(response.body.tokenType).toBe('Bearer')
    expect(response.body.expiresIn).toBe(900)
    expect(response.body.user).toMatchObject({
      email: 'candidate@example.com',
      role: 'CANDIDATE',
    })
    expect(response.body.user.passwordHash).toBeUndefined()
    const { payload } = await jwtVerify(response.body.accessToken, accessSecret)
    expect(payload.tokenUse).toBe('access')
    expect(payload.role).toBe('CANDIDATE')
    expect(payload.exp! - payload.iat!).toBe(900)

    const cookie = cookieFrom(response)
    expect(cookie).toMatch(/^refreshToken=/)
    const cookieHeader = setCookieHeader(response)
    expect(cookieHeader).toMatch(/HttpOnly/i)
    expect(cookieHeader).toMatch(/SameSite=Lax/i)
    expect(cookieHeader).toMatch(/Path=\/api\/v1\/auth/i)
  })

  it('rotates refresh tokens and rejects reuse of an old token', async () => {
    await createVerifiedAccount()
    const login = await post('/api/v1/auth/login', {
      email: 'candidate@example.com',
      password: 'a-strong-password',
    }).expect(200)
    const oldCookie = cookieFrom(login)

    const refreshed = await post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(200)
    const newCookie = cookieFrom(refreshed)
    expect(newCookie).not.toBe(oldCookie)
    expect(refreshed.body.accessToken).toBeDefined()

    await post('/api/v1/auth/refresh').set('Cookie', oldCookie).expect(401)
    await post('/api/v1/auth/refresh').set('Cookie', newCookie).expect(200)
  })

  it('rejects missing and malformed refresh cookies', async () => {
    await post('/api/v1/auth/refresh').expect(401)
    await post('/api/v1/auth/refresh').set('Cookie', 'refreshToken=not-a-jwt').expect(401)
  })

  it('revokes the refresh cookie on logout', async () => {
    await createVerifiedAccount()
    const login = await post('/api/v1/auth/login', {
      email: 'candidate@example.com',
      password: 'a-strong-password',
    }).expect(200)
    const cookie = cookieFrom(login)

    const logout = await post('/api/v1/auth/logout').set('Cookie', cookie).expect(204)
    const cookieHeader = setCookieHeader(logout)
    expect(cookieHeader).toMatch(/refreshToken=;/)
    expect(cookieHeader).toMatch(/Expires=/i)
    await post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401)
  })
})

describe('authentication middleware', () => {
  const protectedApp = express()
  protectedApp.get('/admin', authenticate, requireRole('ADMIN'), (_request, response) => {
    response.json({ access: 'admin' })
  })

  it('requires a valid access token and enforces roles', async () => {
    await request(protectedApp).get('/admin').expect(401)

    const candidateToken = await signAccessToken('CANDIDATE')
    await request(protectedApp)
      .get('/admin')
      .set('Authorization', `Bearer ${candidateToken}`)
      .expect(403)

    const adminToken = await signAccessToken('ADMIN')
    await request(protectedApp)
      .get('/admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200, { access: 'admin' })

    const refreshToken = await signAccessToken('ADMIN', 'refresh')
    await request(protectedApp)
      .get('/admin')
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(401)
  })
})

describe('request limits and error handling', () => {
  it('returns a client error for malformed JSON and a not-found response', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', nextAddress())
      .send('{')
      .expect(400, { error: 'Invalid JSON body' })
    await get('/not-a-route').expect(404, { error: 'Route not found' })
  })

  it('rate limits repeated registration attempts from the same IP', async () => {
    const sharedAddress = '198.51.100.220'
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await post('/api/v1/auth/register', {}, sharedAddress).expect(400)
    }
    await post('/api/v1/auth/register', {}, sharedAddress).expect(429)
  })
})
