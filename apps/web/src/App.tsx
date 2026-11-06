import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { clearAccessToken, getAccessToken, refreshAccessToken, setAccessToken } from './auth'
import { MatchAnalyzer } from './MatchAnalyzer'
import { ResumeEditor } from './ResumeEditor'
import type { ResumeInput, ResumeRecord } from './resume-types'
import './App.css'

type AuthResponse = {
  error?: string
  message?: string
  accessToken?: string
  expiresIn?: number
}

type ParseResumeResponse = {
  error?: string
  resume?: ResumeRecord
}

type ResumeListResponse = {
  error?: string
  resumes?: ResumeRecord[]
}

type SaveResumeResponse = {
  error?: string
  resume?: ResumeRecord
}

type AuthMode = 'login' | 'signup'
type WorkspaceSection = 'overview' | 'resumes' | 'build' | 'match'

function currentMode(): AuthMode {
  return window.location.pathname === '/signup' ? 'signup' : 'login'
}

function noticeFromLocation(): string {
  const search = new URLSearchParams(window.location.search)
  if (search.has('email-verified')) {
    return 'Email verified successfully. You can now sign in.'
  }
  if (search.has('registered')) {
    return 'Account created. Check your inbox for the verification link, then return here to sign in.'
  }
  return ''
}

function ResumeWorkspace({ busy, error, onSessionExpired, onSignOut }: {
  busy: boolean
  error: string
  onSessionExpired: () => void
  onSignOut: () => void
}) {
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('overview')
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [loadError, setLoadError] = useState(() =>
    getAccessToken() ? '' : 'Your sign-in session has expired. Please sign in again.',
  )
  const [draft, setDraft] = useState<ResumeRecord | null>(null)
  const [savedResumes, setSavedResumes] = useState<ResumeRecord[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let active = true
    const token = getAccessToken()

    if (!token) {
      return () => {
        active = false
      }
    }

    fetch('/api/v1/resumes', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (response.status === 401) {
          onSessionExpired()
          return
        }
        const result = (await response.json()) as ResumeListResponse
        if (!response.ok) {
          throw new Error(result.error ?? 'We couldn’t load your saved resumes.')
        }
        if (!result.resumes) {
          throw new Error('The server returned an invalid resume list.')
        }
        if (active) {
          setSavedResumes(result.resumes)
          setDraft(result.resumes[0] ?? null)
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : 'We couldn’t load your saved resumes.')
        }
      })

    return () => {
      active = false
    }
  }, [onSessionExpired])

  async function submitResume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setParseError('')
    setDraft(null)

    if (!file) {
      setParseError('Choose a PDF or DOCX resume to continue.')
      return
    }

    const token = getAccessToken()
    if (!token) {
      setParseError('Your sign-in session has expired. Please sign in again.')
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    setParsing(true)
    try {
      const response = await fetch('/api/v1/resumes/parse-file', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (response.status === 401) {
        onSessionExpired()
        return
      }
      const result = (await response.json()) as ParseResumeResponse
      if (!response.ok) {
        setParseError(result.error ?? 'We couldn’t parse this resume. Please try again.')
      } else if (result.resume) {
        const parsedResume = result.resume
        setDraft(parsedResume)
        setCreating(false)
        setActiveSection('build')
        setSavedResumes((resumes) => [
          parsedResume,
          ...resumes.filter((resume) => resume.id !== parsedResume.id),
        ])
      } else {
        setParseError('The server returned an incomplete resume draft. Please try again.')
      }
    } catch {
      setParseError('We couldn’t reach the server. Check your connection and try again.')
    } finally {
      setParsing(false)
    }
  }

  async function saveResume(input: ResumeInput, resumeId?: string): Promise<ResumeRecord> {
    const token = getAccessToken()
    if (!token) {
      onSessionExpired()
      throw new Error('Your sign-in session has expired. Please sign in again.')
    }

    const response = await fetch(
      resumeId ? `/api/v1/resumes/${encodeURIComponent(resumeId)}` : '/api/v1/resumes',
      {
        method: resumeId ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    )
    if (response.status === 401) {
      onSessionExpired()
      throw new Error('Your sign-in session has expired. Please sign in again.')
    }
    const result = (await response.json()) as SaveResumeResponse
    if (!response.ok) {
      throw new Error(result.error ?? 'We couldn’t save this resume.')
    }
    if (!result.resume) {
      throw new Error('The server returned an incomplete saved resume.')
    }

    const savedResume = result.resume
    setDraft(savedResume)
    setCreating(false)
    setActiveSection('build')
    setSavedResumes((resumes) => [
      savedResume,
      ...resumes.filter((resume) => resume.id !== savedResume.id),
    ])
    return savedResume
  }

  async function exportResume(resumeId: string): Promise<void> {
    const token = getAccessToken()
    if (!token) {
      onSessionExpired()
      throw new Error('Your sign-in session has expired. Please sign in again.')
    }
    const response = await fetch(
      `/api/v1/resumes/${encodeURIComponent(resumeId)}/export-pdf`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (response.status === 401) {
      onSessionExpired()
      throw new Error('Your sign-in session has expired. Please sign in again.')
    }
    if (!response.ok) {
      let message = 'We couldn’t export this PDF.'
      try {
        const result = (await response.json()) as { error?: string }
        message = result.error ?? message
      } catch {
        message = 'The server returned an invalid PDF export response.'
      }
      throw new Error(message)
    }

    const pdf = await response.blob()
    const url = window.URL.createObjectURL(pdf)
    const link = document.createElement('a')
    link.href = url
    const contentDisposition = response.headers.get('Content-Disposition')
    const serverFileName = contentDisposition?.match(/filename="([^"]+)"/i)?.[1]
    const fileName = (draft?.personalInfo.fullName || draft?.title || 'resume')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
    link.download = serverFileName || `${fileName || 'resume'}.pdf`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0)
  }

  function showResume(resume: ResumeRecord) {
    setDraft(resume)
    setCreating(false)
    setActiveSection('build')
  }

  function renderResumeList(resumes: ResumeRecord[]) {
    if (resumes.length === 0) {
      return (
        <div className="workspace-empty-state">
          <span aria-hidden="true">▤</span>
          <h3>No resumes yet</h3>
          <p>Upload an existing resume or create one from scratch to get started.</p>
          <button className="workspace-link-button" onClick={() => setActiveSection('build')} type="button">
            Build your first resume <span aria-hidden="true">→</span>
          </button>
        </div>
      )
    }

    return (
      <ul className="workspace-resume-list">
        {resumes.map((resume) => (
          <li key={resume.id}>
            <button className="workspace-resume-card" onClick={() => showResume(resume)} type="button">
              <span className="resume-card-icon" aria-hidden="true">▤</span>
              <span className="resume-card-copy">
                <strong>{resume.personalInfo.fullName || resume.title}</strong>
                <small>{resume.title} · Updated {new Date(resume.updatedAt).toLocaleDateString()}</small>
              </span>
              <span className="resume-card-action">Open <span aria-hidden="true">→</span></span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  const sectionTitles: Record<WorkspaceSection, string> = {
    overview: 'Overview',
    resumes: 'My resumes',
    build: draft || creating ? 'Resume editor' : 'Build a resume',
    match: 'Match a job',
  }

  return (
    <main className="workspace-layout">
      <aside className="workspace-sidebar">
        <Brand />
        <div className="workspace-nav-group">
          <p className="workspace-nav-label">WORKSPACE</p>
          <nav aria-label="Workspace navigation" className="workspace-nav">
            {([
              ['overview', 'Overview', '⌂'],
              ['resumes', 'My resumes', '▤'],
              ['build', 'Build resume', '+'],
              ['match', 'Match', '◎'],
            ] as const).map(([section, label, icon]) => (
              <button
                aria-current={activeSection === section ? 'page' : undefined}
                className="workspace-nav-item"
                key={section}
                onClick={() => setActiveSection(section)}
                type="button"
              >
                <span aria-hidden="true">{icon}</span>
                {label}
                {section === 'resumes' && savedResumes.length > 0 && (
                  <small>{savedResumes.length}</small>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="workspace-sidebar-footer">
          <p>Ready for your next move?</p>
          <button
            className="workspace-signout"
            disabled={busy || parsing}
            onClick={onSignOut}
            type="button"
          >
            <span aria-hidden="true">↪</span> Sign out
          </button>
        </div>
      </aside>

      <section className="workspace-main">
        <header className="workspace-topbar">
          <p><span>MatchCV</span><span aria-hidden="true">/</span>{sectionTitles[activeSection]}</p>
          <span className="workspace-user-mark" aria-label="Signed in">M</span>
        </header>

        <div className="workspace-content">
          {error && <p className="form-message error-message" role="alert">{error}</p>}
          {loadError && <p className="form-message error-message" role="alert">{loadError}</p>}

          {activeSection === 'overview' && (
            <>
              <div className="workspace-page-heading">
                <p className="form-eyebrow">YOUR MATCHCV WORKSPACE</p>
                <h1>Start with your resume.</h1>
                <p className="form-description">Create, organize, and refine resumes that tell your story.</p>
              </div>

              <section className="workspace-quick-start" aria-labelledby="quick-start-title">
                <div className="workspace-section-heading">
                  <div>
                    <p className="workspace-section-kicker">GET STARTED</p>
                    <h2 id="quick-start-title">How would you like to begin?</h2>
                  </div>
                </div>
                <div className="workspace-action-grid">
                  <button className="workspace-action-card" onClick={() => setActiveSection('build')} type="button">
                    <span className="workspace-action-icon upload-icon" aria-hidden="true">↑</span>
                    <span className="workspace-action-copy">
                      <strong>Upload a resume</strong>
                      <small>Import a PDF or DOCX and turn it into an editable draft.</small>
                    </span>
                    <span className="workspace-action-arrow" aria-hidden="true">→</span>
                  </button>
                  <button
                    className="workspace-action-card"
                    onClick={() => {
                      setDraft(null)
                      setCreating(true)
                      setActiveSection('build')
                    }}
                    type="button"
                  >
                    <span className="workspace-action-icon create-icon" aria-hidden="true">✎</span>
                    <span className="workspace-action-copy">
                      <strong>Start from scratch</strong>
                      <small>Build a polished resume step by step, with full control.</small>
                    </span>
                    <span className="workspace-action-arrow" aria-hidden="true">→</span>
                  </button>
                </div>
              </section>

              <section className="workspace-overview-resumes" aria-labelledby="overview-resumes-title">
                <div className="workspace-section-heading">
                  <div>
                    <p className="workspace-section-kicker">YOUR LIBRARY</p>
                    <h2 id="overview-resumes-title">Recent resumes</h2>
                  </div>
                  <button className="workspace-link-button" onClick={() => setActiveSection('resumes')} type="button">
                    View all <span aria-hidden="true">→</span>
                  </button>
                </div>
                {renderResumeList(savedResumes.slice(0, 3))}
              </section>
            </>
          )}

          {activeSection === 'resumes' && (
            <>
              <div className="workspace-page-heading">
                <p className="form-eyebrow">YOUR LIBRARY</p>
                <h1>My resumes</h1>
                <p className="form-description">Keep all your resume versions organized in one place.</p>
              </div>
              <section className="workspace-library" aria-labelledby="saved-resumes-title">
                <div className="workspace-section-heading">
                  <h2 id="saved-resumes-title">Saved resumes <span>{savedResumes.length}</span></h2>
                  <button
                    className="workspace-primary-button"
                    onClick={() => {
                      setDraft(null)
                      setCreating(false)
                      setActiveSection('build')
                    }}
                    type="button"
                  >
                    <span aria-hidden="true">+</span> New resume
                  </button>
                </div>
                {renderResumeList(savedResumes)}
              </section>
            </>
          )}

          {activeSection === 'match' && (
            <MatchAnalyzer
              onBuildResume={() => {
                setDraft(null)
                setCreating(false)
                setActiveSection('build')
              }}
              onSessionExpired={onSessionExpired}
              resumes={savedResumes}
            />
          )}

          <div className="workspace-build-page" hidden={activeSection !== 'build'}>
              <div className="workspace-page-heading">
                <p className="form-eyebrow">{draft || creating ? 'YOUR NEXT CHAPTER' : 'GET STARTED'}</p>
                <h1>{draft || creating ? (draft ? 'Refine your story.' : 'Build your resume.') : 'Start with your resume.'}</h1>
                <p className="form-description">
                  {draft || creating
                    ? 'Shape your experience into a resume you’re proud to share.'
                    : 'Upload an existing resume or create a new one from scratch.'}
                </p>
              </div>

              {!draft && !creating && (
                <div className="workspace-build-options">
                  <form className="resume-upload" onSubmit={submitResume}>
                    <div className="workspace-card-heading">
                      <span className="workspace-action-icon upload-icon" aria-hidden="true">↑</span>
                      <div>
                        <h2>Upload an existing resume</h2>
                        <p>We’ll extract your details into an editable draft.</p>
                      </div>
                    </div>
                    <label htmlFor="resume-file">Resume file</label>
                    <input
                      accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      disabled={parsing}
                      id="resume-file"
                      name="file"
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null)
                        setParseError('')
                        setDraft(null)
                        setCreating(false)
                      }}
                      type="file"
                    />
                    <p className="upload-hint">PDF recommended · DOCX also accepted · 5 MB maximum</p>
                    <p className="upload-note">Each upload can only be processed once per account. Extracted text is saved with the draft and sent to Gemini.</p>
                    {parseError && <p className="form-message error-message" role="alert">{parseError}</p>}
                    <button className="primary-button" disabled={parsing || !file} type="submit">
                      {parsing ? 'Parsing your resume…' : 'Parse resume'}
                      {!parsing && <span aria-hidden="true">→</span>}
                    </button>
                  </form>
                  <div className="workspace-create-card">
                    <span className="workspace-action-icon create-icon" aria-hidden="true">✎</span>
                    <div>
                      <h2>Prefer a fresh start?</h2>
                      <p>Add your experience, education, and skills in the editor.</p>
                    </div>
                    <button
                      className="workspace-secondary-button"
                      onClick={() => {
                        setDraft(null)
                        setCreating(true)
                      }}
                      type="button"
                    >
                      Create from scratch <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </div>
              )}

              {(draft || creating) && (
                <ResumeEditor
                  key={draft?.id ?? 'new-resume'}
                  onExport={exportResume}
                  onSave={saveResume}
                  resume={draft ?? undefined}
                />
              )}

              {draft?.rawExtractedText && (
                <details className="raw-text">
                  <summary>View extracted text</summary>
                  <pre>{draft.rawExtractedText}</pre>
                </details>
              )}
          </div>
        </div>
        <p className="workspace-footer">© 2026 MatchCV. Built for your next move.</p>
      </section>
    </main>
  )
}

function AuthPage() {
  const [mode, setMode] = useState<AuthMode>(currentMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(noticeFromLocation)
  const [resendAvailable, setResendAvailable] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [accessTokenExpiresAt, setAccessTokenExpiresAt] = useState<number | null>(null)
  const [restoringSession, setRestoringSession] = useState(() => window.location.pathname === '/')

  const expireSession = useCallback(() => {
    if (!getAccessToken()) {
      return
    }

    clearAccessToken()
    setAccessTokenExpiresAt(null)
    setSignedIn(false)
    setMode('login')
    setError('Your sign-in session has expired. Please sign in again.')
    setNotice('')
    setResendAvailable(false)
    window.history.replaceState({}, '', '/login')

    void fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
      .then((response) => {
        if (!response.ok) {
          setError('Your sign-in session has expired. Please sign in again. We couldn’t revoke the refresh token.')
        }
      })
      .catch(() => {
        setError('Your sign-in session has expired. Please sign in again. We couldn’t reach the server to revoke the refresh token.')
      })
  }, [])

  useEffect(() => {
    function syncMode() {
      setMode(currentMode())
      setError('')
      setNotice(noticeFromLocation())
      setResendAvailable(false)
    }

    window.addEventListener('popstate', syncMode)
    return () => window.removeEventListener('popstate', syncMode)
  }, [])

  useEffect(() => {
    if (window.location.pathname !== '/') {
      return
    }

    let active = true
    refreshAccessToken()
      .then((tokens) => {
        if (!active) {
          return
        }

        if (tokens) {
          setAccessToken(tokens.accessToken)
          setAccessTokenExpiresAt(Date.now() + tokens.expiresIn * 1000)
          setSignedIn(true)
        } else {
          window.history.replaceState({}, '', '/login')
          setMode('login')
        }
      })
      .catch(() => {
        if (active) {
          window.history.replaceState({}, '', '/login')
          setMode('login')
          setError('We couldn’t restore your session. Please sign in again.')
        }
      })
      .finally(() => {
        if (active) {
          setRestoringSession(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (accessTokenExpiresAt === null) {
      return
    }

    const timeout = window.setTimeout(() => {
      refreshAccessToken()
        .then((tokens) => {
          if (tokens) {
            setAccessToken(tokens.accessToken)
            setAccessTokenExpiresAt(Date.now() + tokens.expiresIn * 1000)
          } else {
            expireSession()
          }
        })
        .catch(() => expireSession())
    }, Math.max(0, accessTokenExpiresAt - Date.now()))
    return () => window.clearTimeout(timeout)
  }, [accessTokenExpiresAt, expireSession])

  function navigate(nextMode: AuthMode, status?: 'registered') {
    const url = new URL(nextMode === 'signup' ? '/signup' : '/login', window.location.origin)
    if (status) {
      url.searchParams.set(status, '1')
    }
    window.history.pushState({}, '', `${url.pathname}${url.search}`)
    setMode(nextMode)
    setError('')
    setNotice(noticeFromLocation())
    setResendAvailable(false)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    setResendAvailable(false)

    if (mode === 'signup' && password !== confirmPassword) {
      setError('Those passwords don’t match. Please try again.')
      return
    }

    setBusy(true)
    try {
      const response = await fetch(`/api/v1/auth/${mode === 'signup' ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })
      const result = (await response.json()) as AuthResponse

      if (!response.ok) {
        setError(result.error ?? 'Something went wrong. Please try again.')
        setResendAvailable(mode === 'login' && response.status === 403)
        return
      }

      if (mode === 'signup') {
        setPassword('')
        setConfirmPassword('')
        navigate('login', 'registered')
      } else if (
        result.accessToken &&
        typeof result.expiresIn === 'number' &&
        Number.isSafeInteger(result.expiresIn) &&
        result.expiresIn > 0
      ) {
        setAccessToken(result.accessToken)
        setAccessTokenExpiresAt(Date.now() + result.expiresIn * 1000)
        window.history.replaceState({}, '', '/')
        setSignedIn(true)
      } else {
        setError('We couldn’t complete your sign in. Please try again.')
      }
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function resendVerification() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch('/api/v1/auth/verification/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      })
      const result = (await response.json()) as AuthResponse
      if (!response.ok) {
        setError(result.error ?? 'We couldn’t send another link. Please try again.')
        return
      }
      setNotice(result.message ?? 'A new verification link has been sent to your email.')
      setResendAvailable(false)
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    try {
      const response = await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) {
        setError('We couldn’t complete sign out. Please try again.')
        return
      }
      clearAccessToken()
      setAccessTokenExpiresAt(null)
      setSignedIn(false)
      setPassword('')
      setNotice('You’ve been signed out.')
    } catch {
      setError('We couldn’t reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const isSignup = mode === 'signup'

  if (restoringSession) {
    return <main className="auth-layout" aria-busy="true" />
  }

  if (signedIn) {
    return (
      <ResumeWorkspace
        busy={busy}
        error={error}
        onSessionExpired={expireSession}
        onSignOut={signOut}
      />
    )
  }

  return (
    <main className="auth-layout">
      <BrandPanel />
      <section className="form-panel">
        <div className="form-content">
          <Brand compact />
          <div className="form-heading">
            <p className="form-eyebrow">{isSignup ? 'Start with MatchCV' : 'Welcome back'}</p>
            <h1>{isSignup ? 'Create your account' : 'Sign in to your account'}</h1>
            <p className="form-description">
              {isSignup
                ? 'One account to bring your experience and next opportunity into focus.'
                : 'Pick up where you left off and keep moving forward.'}
            </p>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="email">Email address</label>
            <input
              autoComplete="email"
              id="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={email}
            />

            <div className="label-row">
              <label htmlFor="password">Password</label>
              {isSignup && <span className="label-hint">At least 12 characters</span>}
            </div>
            <input
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              id="password"
              maxLength={72}
              minLength={isSignup ? 12 : undefined}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isSignup ? 'Create a strong password' : 'Enter your password'}
              required
              type="password"
              value={password}
            />

            {isSignup && (
              <>
                <label htmlFor="confirm-password">Confirm password</label>
                <input
                  autoComplete="new-password"
                  id="confirm-password"
                  maxLength={72}
                  minLength={12}
                  name="confirm-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Enter your password again"
                  required
                  type="password"
                  value={confirmPassword}
                />
              </>
            )}

            {error && <p className="form-message error-message" role="alert">{error}</p>}
            {notice && <p className="form-message success-message" role="status">{notice}</p>}

            {resendAvailable && (
              <button
                className="text-button resend-button"
                disabled={busy}
                onClick={resendVerification}
                type="button"
              >
                Send a new verification email
              </button>
            )}

            <button className="primary-button" disabled={busy} type="submit">
              {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
              {!busy && <span aria-hidden="true">→</span>}
            </button>
          </form>

          <p className="switch-mode">
            {isSignup ? 'Already have an account?' : 'New to MatchCV?'}{' '}
            <button className="text-button" onClick={() => navigate(isSignup ? 'login' : 'signup')} type="button">
              {isSignup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>
        <p className="panel-footer">© 2026 MatchCV. Built for your next move.</p>
      </section>
    </main>
  )
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a aria-label="MatchCV home" className={`brand${compact ? ' brand-compact' : ''}`} href="/">
      <span className="brand-mark" aria-hidden="true">M</span>
      <span>match<span className="brand-name-accent">cv</span></span>
    </a>
  )
}

function BrandPanel() {
  return (
    <section className="brand-panel">
      <div className="brand-panel-content">
        <Brand />
        <div className="brand-copy">
          <p className="brand-kicker"><span /> CAREER CLARITY, REIMAGINED</p>
          <h2>Your next chapter<br />starts with <span>your story.</span></h2>
          <p className="brand-description">
            Make your experience make sense. Build a resume that feels like you, and find the roles that do too.
          </p>
        </div>
        <div className="insight-card" aria-label="MatchCV career insights preview">
          <div className="insight-topline">
            <span className="insight-dot" />
            <span>YOUR CAREER, IN FOCUS</span>
            <span className="insight-more">···</span>
          </div>
          <div className="insight-content">
            <div className="insight-chart" aria-hidden="true">
              <span /><span /><span /><span /><span /><span /><span /><span /><span />
            </div>
            <div className="insight-copy">
              <span className="insight-caption">A clearer path forward</span>
              <strong>Make your next move count.</strong>
            </div>
          </div>
          <div className="insight-footer"><span /> Built around you, not an algorithm.</div>
        </div>
      </div>
      <div className="decorative-orb orb-one" />
      <div className="decorative-orb orb-two" />
      <p className="brand-panel-footer">A little more you. A lot more possibility.</p>
    </section>
  )
}

function App() {
  return <AuthPage />
}

export default App
