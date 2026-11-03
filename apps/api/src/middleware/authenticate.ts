import type { Request, RequestHandler, Response } from 'express'
import { jwtVerify } from 'jose'
import { getJwtSecret } from '../config.js'
import type { UserRole } from '../models/user.js'

export interface AuthenticatedUser {
  userId: string
  role: UserRole
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser
    }
  }
}

function unauthorized(response: Response): void {
  response.status(401).json({ error: 'Authentication required' })
}

export const authenticate: RequestHandler = async (request, response, next) => {
  const authorization = request.header('authorization')
  const [scheme, token, ...extra] = authorization?.split(' ') ?? []

  if (scheme !== 'Bearer' || !token || extra.length > 0) {
    unauthorized(response)
    return
  }

  const secret = getJwtSecret('JWT_ACCESS_SECRET')

  let authenticatedUser: AuthenticatedUser
  try {
    const { payload } = await jwtVerify(token, secret)
    if (
      typeof payload.sub !== 'string' ||
      (payload.role !== 'CANDIDATE' && payload.role !== 'ADMIN') ||
      payload.tokenUse !== 'access'
    ) {
      unauthorized(response)
      return
    }

    authenticatedUser = { userId: payload.sub, role: payload.role }
  } catch {
    unauthorized(response)
    return
  }

  request.auth = authenticatedUser
  next()
}

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (request: Request, response, next) => {
    if (!request.auth) {
      unauthorized(response)
      return
    }

    if (!roles.includes(request.auth.role)) {
      response.status(403).json({ error: 'Insufficient permissions' })
      return
    }

    next()
  }
}
