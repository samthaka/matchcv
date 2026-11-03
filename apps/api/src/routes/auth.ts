import { createHash, randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Router, type CookieOptions, type Request, type Response } from 'express'
import { rateLimit } from 'express-rate-limit'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { Types } from 'mongoose'
import { z } from 'zod'
import { getJwtSecret } from '../config.js'
import { RefreshTokenModel } from '../models/refresh-token.js'
import { UserModel, type UserRole } from '../models/user.js'
import { sendVerificationEmail } from '../services/email.js'
import { HttpError } from '../utils/http-error.js'

const router = Router()
const bcryptSaltRounds = 12
const verificationTokenLifetimeMs = 24 * 60 * 60 * 1000
const refreshTokenLifetimeMs = 7 * 24 * 60 * 60 * 1000
const refreshCookieName = 'refreshToken'
const refreshCookiePath = '/api/v1/auth'

const registerSchema = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
  password: z
    .string()
    .min(12)
    .max(72)
    .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, {
      message: 'Password must be no longer than 72 bytes',
    }),
})

const loginSchema = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
  password: z.string().min(1).max(72),
})

const resendVerificationSchema = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
})

const verificationTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i)

function getLoginUrl(status: 'email-verified'): string {
  const webAppUrl = process.env.WEB_APP_URL ?? 'http://localhost:5173'
  const loginUrl = new URL('/login', webAppUrl)
  loginUrl.searchParams.set(status, '1')
  return loginUrl.toString()
}

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Try again later.' },
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
})

const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Try again later.' },
})

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts. Try again later.' },
})

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function invalidBody(error: z.ZodError): HttpError {
  return new HttpError(
    400,
    'Invalid request body',
    error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
  )
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: refreshCookiePath,
    maxAge: refreshTokenLifetimeMs,
  }
}

function setRefreshCookie(response: Response, token: string): void {
  response.cookie(refreshCookieName, token, cookieOptions())
}

function clearRefreshCookie(response: Response): void {
  response.clearCookie(refreshCookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: refreshCookiePath,
  })
}

function publicUser(user: { _id: { toString(): string }; email: string; role: UserRole }) {
  return { id: user._id.toString(), email: user.email, role: user.role }
}

async function issueTokens(userId: string, role: UserRole): Promise<{
  accessToken: string
  refreshToken: string
}> {
  const issuedAt = Math.floor(Date.now() / 1000)

  const accessToken = await new SignJWT({ role, tokenUse: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime('15m')
    .sign(getJwtSecret('JWT_ACCESS_SECRET'))

  const refreshToken = await new SignJWT({ tokenUse: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime('7d')
    .sign(getJwtSecret('JWT_REFRESH_SECRET'))

  await RefreshTokenModel.create({
    userId: new Types.ObjectId(userId),
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + refreshTokenLifetimeMs),
  })

  return { accessToken, refreshToken }
}

function readRefreshCookie(request: Request): string | undefined {
  const token: unknown = request.cookies?.[refreshCookieName]
  return typeof token === 'string' ? token : undefined
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000
}

async function sendVerification(userId: string, email: string): Promise<void> {
  const token = randomBytes(32).toString('hex')
  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        emailVerificationTokenHash: hashToken(token),
        emailVerificationTokenExpiresAt: new Date(Date.now() + verificationTokenLifetimeMs),
      },
    },
  )

  try {
    await sendVerificationEmail(email, token)
  } catch (error) {
    throw new HttpError(502, 'Unable to send verification email', undefined, { cause: error })
  }
}

router.post('/register', registerLimiter, async (request, response) => {
  const parsed = registerSchema.safeParse(request.body)
  if (!parsed.success) {
    throw invalidBody(parsed.error)
  }

  const { email, password } = parsed.data
  const existingUser = await UserModel.findOne({ email }).select('_id').lean()
  if (existingUser) {
    throw new HttpError(409, 'An account with this email already exists')
  }

  const passwordHash = await bcrypt.hash(password, bcryptSaltRounds)
  let user
  try {
    user = await UserModel.create({ email, passwordHash })
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new HttpError(409, 'An account with this email already exists')
    }
    throw error
  }

  await sendVerification(user._id.toString(), user.email)
  response.status(201).json({
    message: 'Account created. Check your email to verify your address before logging in.',
  })
})

router.post('/verification/resend', verificationLimiter, async (request, response) => {
  const parsed = resendVerificationSchema.safeParse(request.body)
  if (!parsed.success) {
    throw invalidBody(parsed.error)
  }

  const user = await UserModel.findOne({ email: parsed.data.email }).select('_id email emailVerifiedAt')
  if (user && !user.emailVerifiedAt) {
    await sendVerification(user._id.toString(), user.email)
  }

  response.status(202).json({
    message: 'A new verification link has been sent to your email.',
  })
})

router.get('/verify-email', verificationLimiter, async (request, response) => {
  const parsed = verificationTokenSchema.safeParse(request.query.token)
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid or expired verification link')
  }

  response.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  })
  response.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="referrer" content="no-referrer">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Verify your MatchCV email</title>
    <style>
      * { box-sizing: border-box; }
      body {
        display: grid;
        min-height: 100vh;
        margin: 0;
        padding: 24px;
        place-items: center;
        background: #f4f6fb;
        color: #17213a;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(100%, 440px);
        padding: 42px;
        border: 1px solid #e8ebf2;
        border-radius: 20px;
        background: #fff;
        box-shadow: 0 24px 70px rgb(25 39 75 / 10%);
      }
      .brand { display: flex; align-items: center; gap: 11px; font-size: 20px; font-weight: 720; letter-spacing: -0.055em; }
      .brand-mark {
        display: grid;
        width: 39px;
        height: 39px;
        place-items: center;
        border-radius: 12px;
        background: linear-gradient(145deg, #527cff, #3262e8);
        color: #fff;
        font-size: 18px;
        font-weight: 800;
      }
      .brand-accent { color: #4269ec; }
      .icon {
        display: grid;
        width: 54px;
        height: 54px;
        margin-top: 40px;
        place-items: center;
        border-radius: 50%;
        background: #eef2ff;
        color: #365fe5;
        font-size: 24px;
      }
      .eyebrow { margin: 26px 0 8px; color: #4269ec; font-size: 11px; font-weight: 760; letter-spacing: .16em; }
      h1 { margin: 0; font-size: 29px; font-weight: 650; letter-spacing: -.06em; line-height: 1.15; }
      p { margin: 12px 0 0; color: #69758b; font-size: 14px; line-height: 1.7; }
      button {
        width: 100%;
        min-height: 51px;
        margin-top: 28px;
        border: 0;
        border-radius: 10px;
        background: #365fe5;
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-size: 14px;
        font-weight: 650;
      }
      button:hover { background: #2d53d4; }
      .footnote { margin-top: 20px; color: #939cad; font-size: 12px; text-align: center; }
      @media (max-width: 480px) { main { padding: 32px 26px; } }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="brand-mark" aria-hidden="true">M</span><span>match<span class="brand-accent">cv</span></span></div>
      <div class="icon" aria-hidden="true">✉</div>
      <p class="eyebrow">ONE LAST STEP</p>
      <h1>Verify your email</h1>
      <p>Confirm your email address to activate your MatchCV account. Once verified, you’ll return to sign in.</p>
      <form method="post" action="/api/v1/auth/verify-email">
        <input type="hidden" name="token" value="${parsed.data}">
        <button type="submit">Verify email address</button>
      </form>
      <p class="footnote">This link can only be used once.</p>
    </main>
  </body>
</html>`)
})

router.post('/verify-email', verificationLimiter, async (request, response) => {
  const parsed = verificationTokenSchema.safeParse(request.body?.token)
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid or expired verification link')
  }

  const now = new Date()
  const user = await UserModel.findOneAndUpdate(
    {
      emailVerificationTokenHash: hashToken(parsed.data),
      emailVerificationTokenExpiresAt: { $gt: now },
      emailVerifiedAt: null,
    },
    {
      $set: { emailVerifiedAt: now },
      $unset: {
        emailVerificationTokenHash: 1,
        emailVerificationTokenExpiresAt: 1,
      },
    },
    { returnDocument: 'after' },
  )

  if (!user) {
    throw new HttpError(400, 'Invalid or expired verification link')
  }

  response.redirect(303, getLoginUrl('email-verified'))
})

router.post('/login', loginLimiter, async (request, response) => {
  const parsed = loginSchema.safeParse(request.body)
  if (!parsed.success) {
    throw invalidBody(parsed.error)
  }

  const user = await UserModel.findOne({ email: parsed.data.email }).select('+passwordHash')
  const passwordMatches = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false
  if (!user || !passwordMatches) {
    throw new HttpError(401, 'Invalid email or password')
  }
  if (!user.emailVerifiedAt) {
    throw new HttpError(403, 'Please verify your email before logging in')
  }

  const tokens = await issueTokens(user._id.toString(), user.role)
  setRefreshCookie(response, tokens.refreshToken)
  response.json({
    accessToken: tokens.accessToken,
    tokenType: 'Bearer',
    expiresIn: 900,
    user: publicUser(user),
  })
})

router.post('/refresh', refreshLimiter, async (request, response) => {
  const refreshToken = readRefreshCookie(request)
  if (!refreshToken) {
    throw new HttpError(401, 'Refresh token is required')
  }

  const secret = getJwtSecret('JWT_REFRESH_SECRET')
  let payload: JWTPayload
  try {
    const verifiedToken = await jwtVerify(refreshToken, secret)
    payload = verifiedToken.payload
  } catch (error) {
    throw new HttpError(401, 'Invalid or expired refresh token', undefined, { cause: error })
  }

  if (payload.tokenUse !== 'refresh' || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
    throw new HttpError(401, 'Invalid or expired refresh token')
  }

  const storedToken = await RefreshTokenModel.findOneAndDelete({
    tokenHash: hashToken(refreshToken),
    expiresAt: { $gt: new Date() },
    userId: payload.sub,
  })
  if (!storedToken) {
    throw new HttpError(401, 'Invalid or expired refresh token')
  }

  const user = await UserModel.findById(payload.sub)
  if (!user || !user.emailVerifiedAt) {
    throw new HttpError(401, 'Invalid or expired refresh token')
  }

  const tokens = await issueTokens(user._id.toString(), user.role)
  setRefreshCookie(response, tokens.refreshToken)
  response.json({
    accessToken: tokens.accessToken,
    tokenType: 'Bearer',
    expiresIn: 900,
    user: publicUser(user),
  })
})

router.post('/logout', async (request, response) => {
  const refreshToken = readRefreshCookie(request)
  if (refreshToken) {
    await RefreshTokenModel.deleteOne({ tokenHash: hashToken(refreshToken) })
  }

  clearRefreshCookie(response)
  response.status(204).end()
})

export const authRouter = router
