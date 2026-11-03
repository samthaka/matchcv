const minimumSecretLength = 32

export function getJwtSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'): Uint8Array {
  const secret = process.env[name]

  if (!secret || Buffer.byteLength(secret, 'utf8') < minimumSecretLength) {
    throw new Error(`${name} must be configured with at least ${minimumSecretLength} bytes`)
  }

  return new TextEncoder().encode(secret)
}

export function validateJwtSecrets(): void {
  const accessSecret = getJwtSecret('JWT_ACCESS_SECRET')
  const refreshSecret = getJwtSecret('JWT_REFRESH_SECRET')

  if (Buffer.from(accessSecret).equals(Buffer.from(refreshSecret))) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different')
  }
}

export function getMongoUri(): string {
  return process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/matchcv'
}
