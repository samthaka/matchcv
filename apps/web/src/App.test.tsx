import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  vi.useRealTimers()
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
      .mockResolvedValueOnce(response({ accessToken: 'access-token', expiresIn: 900 }))
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

  it('clears the verification URL on login and refreshes the access token before it expires', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'access-token', expiresIn: 1 }))
      .mockResolvedValueOnce(response({ resumes: [] }))
      .mockResolvedValueOnce(response({ accessToken: 'refreshed-token', expiresIn: 900 }))
      .mockResolvedValueOnce(response(null, 204))
    window.history.replaceState({}, '', '/login?email-verified=1')
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Email verified successfully')

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'person@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-strong-password' } })
    await act(async () => {
      fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: 'Start with your resume.' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.getByRole('heading', { name: 'Start with your resume.' })).toBeInTheDocument()
    expect(getAccessToken()).toBe('refreshed-token')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/auth/refresh', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
  })

  it('restores a signed-in session after refreshing the page at the home URL', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'restored-token', expiresIn: 900 }))
      .mockResolvedValueOnce(response({ resumes: [] }))
    window.history.replaceState({}, '', '/')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Start with your resume.' })).toBeInTheDocument()
    expect(getAccessToken()).toBe('restored-token')
    expect(window.location.pathname).toBe('/')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/refresh', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
  })

  it('redirects an unauthenticated home visit to the login route', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'Refresh token is required' }, 401))
    window.history.replaceState({}, '', '/')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Sign in to your account' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe('')
  })

  it('uploads a resume and opens its parsed details in the editor', async () => {
    const user = userEvent.setup()
    const draft = {
      id: 'resume-id',
      title: "Ada Lovelace's Resume",
      createdAt: '2026-11-03T12:00:00.000Z',
      entryMethod: 'PARSED_UPLOAD' as const,
      rawExtractedText: 'Ada Lovelace\nJavaScript',
      professionalSummary: 'Mathematician and computing pioneer.',
      personalInfo: {
        fullName: 'Ada Lovelace',
        email: 'ada@example.com',
        linkedinUrl: null,
        githubUrl: null,
        portfolioUrl: null,
      },
      workExperience: [{
        company: 'Analytical Engines',
        position: 'Project lead',
        title: 'Engineer',
        startDate: '2022',
        endDate: null,
        isCurrent: true,
        bullets: ['Built reliable systems'],
      }],
      education: [],
      skills: ['JavaScript'],
    }
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'access-token', expiresIn: 900 }))
      .mockResolvedValueOnce(response({ resumes: [] }))
      .mockResolvedValueOnce(response({ resume: draft }))
    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await user.click(screen.getByRole('button', { name: 'Build resume' }))
    const fileInput = screen.getByLabelText('Resume file')
    await user.upload(fileInput, new File(['%PDF-1.4'], 'resume.pdf', { type: 'application/pdf' }))
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error('Resume upload control was not a file input')
    }
    expect(fileInput.files?.[0]?.name).toBe('resume.pdf')
    await user.click(screen.getByRole('button', { name: 'Parse resume' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(await screen.findByRole('heading', { name: 'Edit your resume' })).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('Ada Lovelace')
    expect(screen.getByLabelText('Achievement 1')).toHaveValue('Built reliable systems')
    expect(screen.getByLabelText('Separate skills with commas')).toHaveValue('JavaScript')
    await user.click(screen.getByRole('button', { name: 'Overview' }))
    expect(screen.getByRole('heading', { name: /Recent resumes/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ada Lovelace/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Ada Lovelace/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit resume' }))
    expect(await screen.findByRole('heading', { name: 'Edit your resume' })).toBeInTheDocument()
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

  it('keeps the proposed resume unsaved until the user chooses a name', async () => {
    const user = userEvent.setup()
    const savedResume = {
      id: 'resume-id',
      title: 'Ada Lovelace Resume',
      createdAt: '2026-11-03T12:00:00.000Z',
      updatedAt: '2026-11-03T12:00:00.000Z',
      entryMethod: 'FORM' as const,
      rawExtractedText: '',
      professionalSummary: '',
      personalInfo: {
        fullName: 'Ada Lovelace',
        email: 'not-an-email',
        linkedinUrl: null,
        githubUrl: null,
        portfolioUrl: null,
      },
      workExperience: [{
        company: 'Analytical Engines',
        position: 'Engineer',
        title: null,
        startDate: null,
        endDate: null,
        isCurrent: false,
        bullets: ['Built web applications'],
      }],
      education: [],
      skills: ['React', 'TypeScript'],
    }
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'access-token', expiresIn: 900 }))
      .mockResolvedValueOnce(response({ resumes: [savedResume] }))
      .mockResolvedValueOnce(response({
        matchScore: 12,
        proposedMatchScore: 12,
        scoreConfidence: 99,
        scoreMethod: 'weighted_requirement_coverage',
        analysisStatus: 'skipped',
        requirements: [{
          text: 'Python experience',
          normalizedTerm: 'Python',
          category: 'hard_skill',
          importance: 'required',
          confidence: 0.99,
          status: 'missing',
          evidence: [],
          minimumYears: null,
        }],
        taxonomyUpdates: { addedSkills: 0, addedAliases: 0 },
        matchedHardSkills: [],
        missingCriticalKeywords: [],
        bulletPointRewrites: [],
      }))
      .mockResolvedValueOnce(response({
        matchScore: 76,
        proposedMatchScore: 84,
        scoreConfidence: 91,
        scoreMethod: 'weighted_requirement_coverage',
        analysisStatus: 'completed',
        requirements: [{
          text: 'Build React applications',
          normalizedTerm: 'React',
          category: 'hard_skill',
          importance: 'required',
          confidence: 0.99,
          status: 'matched',
          evidence: ['Built web applications'],
          minimumYears: null,
        }, {
          text: 'Experience with accessibility',
          normalizedTerm: 'Accessibility',
          category: 'hard_skill',
          importance: 'required',
          confidence: 0.99,
          status: 'missing',
          evidence: [],
          minimumYears: null,
        }],
        taxonomyUpdates: { addedSkills: 0, addedAliases: 1 },
        matchedHardSkills: ['React', 'TypeScript'],
        missingCriticalKeywords: ['Accessibility'],
        bulletPointRewrites: [{
          originalBullet: 'Built web applications',
          rewrittenBullet: 'Developed web applications using React and TypeScript',
        }],
      }))
      .mockResolvedValueOnce(response({
        resume: {
          ...savedResume,
          id: 'proposed-resume-id',
          title: 'Frontend Engineer CV',
          workExperience: [{
            ...savedResume.workExperience[0],
            bullets: ['Developed web applications using React and TypeScript'],
          }],
        },
      }, 201))
    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Start with your resume.' })
    await user.click(screen.getByRole('button', { name: 'Match' }))

    expect(await screen.findByRole('heading', { name: 'Match a job.' })).toBeInTheDocument()
    expect(screen.getByLabelText('Resume')).toHaveValue('resume-id')
    const jobDescription = screen.getByLabelText('Job description')
    expect(jobDescription).toHaveAttribute('maxlength', '20000')
    await user.type(jobDescription, 'A role in an unrelated field')
    await user.click(screen.getByRole('button', { name: 'Analyze match' }))

    expect(await screen.findAllByRole('heading', { name: '12%' })).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('AI suggestions were skipped')
    expect(screen.queryByRole('heading', { name: 'Matched hard skills' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/match/analyze', expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resumeId: 'resume-id',
        jobDescriptionText: 'A role in an unrelated field',
      }),
    }))

    await user.clear(jobDescription)
    await user.type(jobDescription, 'A role developing React and TypeScript applications')
    await user.click(screen.getByRole('button', { name: 'Analyze match' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '76%' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('Ada Lovelace')
    expect(screen.getByRole('complementary', { name: 'Match analysis' })).toHaveTextContent('Current CV76%')
    expect(screen.getByRole('complementary', { name: 'Match analysis' })).toHaveTextContent('Optimized / proposed CV84%')
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'What’s missing' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('Accessibility')
    expect(screen.getByRole('dialog')).toHaveTextContent('Missing')
    expect(screen.getByText('Developed web applications using React and TypeScript')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Built web applications')
    expect(screen.getByText('This proposed resume is not saved yet.')).toBeInTheDocument()
    expect(screen.getByLabelText('Save this resume as')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    await user.type(screen.getByLabelText('Save this resume as'), 'Frontend Engineer CV')
    await user.click(screen.getByRole('button', { name: 'Save resume' }))
    expect(await screen.findByRole('button', { name: 'Saved to My resumes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/resumes', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }))
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      title: 'Frontend Engineer CV',
      template: {
        name: 'Classic',
        layout: 'single-column',
      },
      workExperience: [{
        bullets: ['Developed web applications using React and TypeScript'],
      }],
      personalInfo: { email: null },
    })
  })

  it('edits, renames, and deletes saved resumes from the library', async () => {
    const user = userEvent.setup()
    const resume = {
      id: 'saved-resume-id',
      title: 'Ada Resume',
      createdAt: '2026-11-03T12:00:00.000Z',
      updatedAt: '2026-11-03T12:00:00.000Z',
      entryMethod: 'FORM' as const,
      rawExtractedText: '',
      professionalSummary: '',
      personalInfo: {
        fullName: 'Ada Lovelace',
        email: null,
        linkedinUrl: null,
        githubUrl: null,
        portfolioUrl: null,
      },
      workExperience: [{
        company: 'Analytical Engines',
        position: 'Engineer',
        title: null,
        startDate: null,
        endDate: null,
        isCurrent: false,
        bullets: ['Built web applications'],
      }],
      education: [],
      skills: ['React'],
    }
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'access-token', expiresIn: 900 }))
      .mockResolvedValueOnce(response({ resumes: [resume] }))
      .mockResolvedValueOnce(response({ resume: { ...resume, title: 'Product Engineer CV' } }))
      .mockResolvedValueOnce(response(null, 204))

    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Start with your resume.' })
    await user.click(screen.getByRole('button', { name: /My resumes/ }))

    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const renameInput = screen.getByLabelText('Resume name')
    await user.clear(renameInput)
    await user.type(renameInput, 'Product Engineer CV')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('button', { name: 'Preview Product Engineer CV' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/resumes/saved-resume-id', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ title: 'Product Engineer CV' }),
    }))

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('heading', { name: 'Edit your resume' })).toBeInTheDocument()
    expect(screen.getByLabelText('Resume title')).toHaveValue('Product Engineer CV')
    await user.click(screen.getByRole('button', { name: /My resumes/ }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const deleteDialog = screen.getByRole('alertdialog', { name: 'Delete this resume?' })
    expect(deleteDialog).toBeInTheDocument()
    expect(within(deleteDialog).getByText('Product Engineer CV', { selector: 'strong' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete resume' }))
    expect(await screen.findByRole('heading', { name: 'No resumes yet' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/resumes/saved-resume-id', expect.objectContaining({
      method: 'DELETE',
    }))
  })

  it('uses the latest template when saving a proposed match resume', async () => {
    const user = userEvent.setup()
    const previousTemplate = {
      name: 'Modern Blue',
      fontFamily: 'Helvetica',
      fontSize: 11,
      accentColor: '#0f766e',
      textColor: '#173330',
      backgroundColor: '#ffffff',
      layout: 'two-column',
    }
    const resume = {
      id: 'modern-resume',
      title: 'Recent resume',
      createdAt: '2026-11-03T12:00:00.000Z',
      updatedAt: '2026-11-05T12:00:00.000Z',
      entryMethod: 'FORM' as const,
      rawExtractedText: '',
      template: previousTemplate,
      professionalSummary: '',
      personalInfo: {
        fullName: 'Ada Lovelace',
        email: null,
        linkedinUrl: null,
        githubUrl: null,
        portfolioUrl: null,
      },
      workExperience: [],
      education: [],
      skills: [],
    }
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'access-token', expiresIn: 900 }))
      .mockResolvedValueOnce(response({ resumes: [resume] }))
      .mockResolvedValueOnce(response({
        matchScore: 80,
        proposedMatchScore: 80,
        scoreConfidence: 95,
        scoreMethod: 'weighted_requirement_coverage',
        analysisStatus: 'completed',
        requirements: [],
        taxonomyUpdates: { addedSkills: 0, addedAliases: 0 },
        matchedHardSkills: [],
        missingCriticalKeywords: [],
        bulletPointRewrites: [],
      }))
      .mockResolvedValueOnce(response({ resume: { ...resume, id: 'tailored-modern-resume' } }, 201))

    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Start with your resume.' })
    await user.click(screen.getByRole('button', { name: 'Match' }))
    await user.type(screen.getByLabelText('Job description'), 'A software engineering role')
    await user.click(screen.getByRole('button', { name: 'Analyze match' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Modern Blue template' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await user.type(screen.getByLabelText('Save this resume as'), 'Custom name')
    await user.click(screen.getByRole('button', { name: 'Save resume' }))
    await screen.findByRole('button', { name: 'Saved to My resumes' })
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      title: 'Custom name',
      template: previousTemplate,
    })
  })

  it('guides users to build a resume before matching when their library is empty', async () => {
    const user = userEvent.setup()
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'access-token', expiresIn: 900 }))
      .mockResolvedValueOnce(response({ resumes: [] }))
    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Start with your resume.' })
    await user.click(screen.getByRole('button', { name: 'Match' }))

    expect(await screen.findByRole('heading', { name: 'Save a resume to get started' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Build a resume' }))
    expect(await screen.findByRole('heading', { name: 'Start with your resume.' })).toBeInTheDocument()
    expect(screen.getByLabelText('Resume file')).toBeInTheDocument()
  })

  it('creates a resume from scratch with dynamic experience and education entries', async () => {
    const user = userEvent.setup()
    const createdResume = {
      id: 'manual-resume-id',
      title: 'My Resume',
      createdAt: '2026-11-03T12:00:00.000Z',
      updatedAt: '2026-11-03T12:00:00.000Z',
      entryMethod: 'FORM' as const,
      rawExtractedText: '',
      professionalSummary: '',
      personalInfo: {
        fullName: 'Grace Hopper',
        email: 'grace@example.com',
        linkedinUrl: null,
        githubUrl: null,
        portfolioUrl: null,
      },
      workExperience: [{
        company: 'Navy',
        position: 'Supervisor',
        title: 'Computer Scientist',
        startDate: null,
        endDate: null,
        isCurrent: false,
        bullets: [],
      }],
      education: [{
        institution: 'Yale',
        award: 'PhD',
        fieldOfStudy: 'Mathematics',
        graduationYear: 1934,
      }],
      skills: ['COBOL'],
    }
    const updatedResume = { ...createdResume, title: 'Grace Hopper Resume' }
    fetchMock
      .mockResolvedValueOnce(response({ accessToken: 'access-token', expiresIn: 900 }))
      .mockResolvedValueOnce(response({ resumes: [] }))
      .mockResolvedValueOnce(response({ resume: createdResume }, 201))
      .mockResolvedValueOnce(response({ resume: updatedResume }))
    render(<App />)
    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Start with your resume.' })
    await user.click(screen.getByRole('button', { name: 'Build resume' }))
    await user.click(screen.getByRole('button', { name: 'Create from scratch' }))
    await user.selectOptions(screen.getByLabelText('Template'), 'modern')
    await user.click(screen.getByRole('button', { name: 'Preview resume' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Your name')).toBeInTheDocument()
    expect(screen.getByLabelText('Resume preview')).toHaveClass('cv-preview-two-column')
    await user.click(screen.getByRole('button', { name: 'Close preview' }))
    await user.type(screen.getByLabelText('Full name'), 'Grace Hopper')
    await user.type(screen.getByLabelText('Email', { selector: 'input' }), 'grace@example.com')
    await user.click(screen.getByRole('button', { name: 'Overview' }))
    await user.click(screen.getByRole('button', { name: 'Build resume' }))
    expect(screen.getByLabelText('Full name')).toHaveValue('Grace Hopper')
    await user.click(screen.getByRole('button', { name: 'Add experience' }))
    await user.type(screen.getByLabelText('Position'), 'Supervisor')
    await user.type(screen.getByLabelText('Title'), 'Computer Scientist')
    await user.type(screen.getByLabelText('Company'), 'Navy')
    await user.click(screen.getByRole('button', { name: 'Add achievement' }))
    await user.type(screen.getByLabelText('Achievement 1'), 'Built the first compiler')
    await user.click(screen.getByRole('button', { name: 'Add achievement' }))
    await user.type(screen.getByLabelText('Achievement 2'), 'Advanced programming languages')
    await user.click(screen.getByRole('button', { name: 'Delete achievement 1' }))
    await user.click(screen.getByRole('button', { name: 'Add education' }))
    await user.type(screen.getByLabelText('Institution'), 'Yale')
    await user.type(screen.getByLabelText('Award'), 'PhD')
    await user.type(screen.getByLabelText('Field of study'), 'Mathematics')
    await user.type(screen.getByLabelText('Graduation year'), '1934')
    await user.type(screen.getByLabelText('Separate skills with commas'), 'COBOL')
    await user.click(screen.getAllByRole('button', { name: 'Create resume' }).at(-1)!)

    expect(await screen.findByRole('heading', { name: 'Edit your resume' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview resume' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/resumes', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }))
    const saveBody = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)) as {
      personalInfo: { fullName: string }
      workExperience: Array<{ company: string | null; position: string | null; title: string | null; bullets: string[] }>
      education: Array<{ graduationYear: number; award: string | null }>
    }
    expect(saveBody.personalInfo.fullName).toBe('Grace Hopper')
    expect(saveBody.workExperience[0]?.company).toBe('Navy')
    expect(saveBody.workExperience[0]?.position).toBe('Supervisor')
    expect(saveBody.workExperience[0]?.title).toBe('Computer Scientist')
    expect(saveBody.workExperience[0]?.bullets).toEqual(['Advanced programming languages'])
    expect(saveBody.education[0]?.graduationYear).toBe(1934)
    expect(saveBody.education[0]?.award).toBe('PhD')

    await user.clear(screen.getByLabelText('Resume title'))
    await user.type(screen.getByLabelText('Resume title'), updatedResume.title)
    await user.click(screen.getAllByRole('button', { name: 'Save changes' }).at(-1)!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/v1/resumes/${createdResume.id}`, expect.objectContaining({
      method: 'PUT',
    }))
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      title: updatedResume.title,
    })
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
