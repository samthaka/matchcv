let accessToken: string | null = null
let refreshRequest: Promise<{ accessToken: string; expiresIn: number } | null> | null = null

export function refreshAccessToken(): Promise<{ accessToken: string; expiresIn: number } | null> {
  if (refreshRequest) {
    return refreshRequest
  }

  refreshRequest = fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (response) => {
      if (!response.ok) {
        return null
      }

      const result: unknown = await response.json()
      if (
        typeof result !== 'object' ||
        result === null ||
        !('accessToken' in result) ||
        typeof result.accessToken !== 'string' ||
        !('expiresIn' in result) ||
        typeof result.expiresIn !== 'number' ||
        !Number.isSafeInteger(result.expiresIn) ||
        result.expiresIn <= 0
      ) {
        throw new Error('The server returned an invalid session refresh response.')
      }

      return { accessToken: result.accessToken, expiresIn: result.expiresIn }
    })
    .finally(() => {
      refreshRequest = null
    })

  return refreshRequest
}

export function setAccessToken(token: string): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function clearAccessToken(): void {
  accessToken = null
}
