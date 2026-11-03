import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { clearAccessToken, getAccessToken } from './auth'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  window.history.replaceState({}, '', '/login')
  clearAccessToken()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('login and signup screens', () => {
  it('switches between login and signup forms', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('heading', { name: 'Sign in to your account' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
  })

  it('prevents signup when passwords do not match', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Create an account' }))

    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.type(screen.getByLabelText('Confirm password'), 'a-different-password')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Those passwords don’t match')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits registration and returns to login with a verification reminder', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(response({
      message: 'Account created. Check your email.',
    }, 201))
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Sign in to your account' })).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('Check your inbox')
    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe('?registered=1')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/register', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ email: 'person@example.com', password: 'a-strong-password' }),
    }))
  })

  it('shows login errors and offers a verification resend for unverified accounts', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(response({ error: 'Please verify your email before logging in' }, 403))
      .mockResolvedValueOnce(response({ message: 'A new verification link has been sent to your email.' }, 202))
    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Please verify your email')
    await user.click(screen.getByRole('button', { name: 'Send a new verification email' }))
    expect(await screen.findByRole('status')).toHaveTextContent('link has been sent to your email')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/auth/verification/resend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'person@example.com' }),
    }))
  })

  it('stores the access token after login and signs out through the API', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'access-token' }))
      .mockResolvedValueOnce(response({ resumes: [] }))
      .mockResolvedValueOnce(response(null, 204))
    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'Start with your resume.' })).toBeInTheDocument()
    expect(getAccessToken()).toBe('access-token')
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in to your account' })).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/auth/logout', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
  })

  it('uploads a resume and displays the parsed draft without saving it', async () => {
    const user = userEvent.setup()
    const draft = {
      id: 'resume-id',
      title: "Ada Lovelace's Resume",
      createdAt: '2026-11-03T12:00:00.000Z',
      entryMethod: 'PARSED_UPLOAD' as const,
      rawExtractedText: 'Ada Lovelace\nJavaScript',
      personalInfo: {
        fullName: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: null,
        location: null,
        linkedinUrl: null,
        githubUrl: null,
      },
      workExperience: [{
        company: 'Analytical Engines',
        position: 'Engineer',
        startDate: '2022',
        endDate: null,
        isCurrent: true,
        bullets: ['Built reliable systems'],
      }],
      education: [],
      skills: ['JavaScript'],
    }
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'access-token' }))
      .mockResolvedValueOnce(response({ resumes: [] }))
      .mockResolvedValueOnce(response({ resume: draft }))
    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const fileInput = screen.getByLabelText('Resume file')
    await user.upload(fileInput, new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' }))
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error('Resume upload control was not a file input')
    }
    expect(fileInput.files?.[0]?.name).toBe('resume.pdf')
    await user.click(screen.getByRole('button', { name: 'Parse resume' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(screen.getByText('Built reliable systems')).toBeInTheDocument()
    expect(screen.getByText('JavaScript')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Saved resumes/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/resumes', expect.objectContaining({
      headers: { Authorization: 'Bearer access-token' },
    }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/resumes/parse-file', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer access-token' },
    }))
    const requestBody = fetchMock.mock.calls.at(-1)?.[1]?.body
    if (!(requestBody instanceof FormData)) {
      throw new Error('Resume upload request did not use multipart form data')
    }
    expect(requestBody.get('file')).toMatchObject({ name: 'resume.pdf' })
  })

  it('displays post-verification and post-registration notices from the login URL', () => {
    window.history.replaceState({}, '', '/login?email-verified=1')
    const { rerender } = render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Email verified successfully')

    window.history.replaceState({}, '', '/login?registered=1')
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    rerender(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Check your inbox')
  })

  it('shows API and network errors without logging the user in', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(response({ error: 'Invalid email or password' }, 401))
    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')

    cleanup()
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'))
    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('couldn’t reach the server'))
  })
})
