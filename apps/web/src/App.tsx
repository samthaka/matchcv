import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { clearAccessToken, getAccessToken, refreshAccessToken, setAccessToken } from './auth'
import './App.css'

type AuthResponse = {
  error?: string
  message?: string
  accessToken?: string
  expiresIn?: number
}

type ResumeDraft = {
  id: string
  title: string
  createdAt: string
  entryMethod: 'PARSED_UPLOAD'
  rawExtractedText: string
  personalInfo: {
    fullName: string | null
    email: string | null
    phone: string | null
    location: string | null
    linkedinUrl: string | null
    githubUrl: string | null
  }
  workExperience: Array<{
    company: string | null
    position: string | null
    startDate: string | null
    endDate: string | null
    isCurrent: boolean
    bullets: string[]
  }>
  education: Array<{
    institution: string | null
    degree: string | null
    fieldOfStudy: string | null
    graduationYear: number | null
  }>
  skills: string[]
}

type ParseResumeResponse = {
  error?: string
  resume?: ResumeDraft
}

type ResumeListResponse = {
  error?: string
  resumes?: ResumeDraft[]
}

type AuthMode = 'login' | 'signup'

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
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [loadError, setLoadError] = useState(() =>
    getAccessToken() ? '' : 'Your sign-in session has expired. Please sign in again.',
  )
  const [draft, setDraft] = useState<ResumeDraft | null>(null)
  const [savedResumes, setSavedResumes] = useState<ResumeDraft[]>([])

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

  return (
    <main className="auth-layout workspace-layout">
      <BrandPanel />
      <section className="form-panel workspace-panel">
        <div className="form-content workspace-content">
          <Brand compact />
          <div className="workspace-heading">
            <div>
              <p className="form-eyebrow">YOUR MATCHCV WORKSPACE</p>
              <h1>Start with your resume.</h1>
              <p className="form-description">
                Upload a PDF or Word document and we’ll turn it into an editable draft.
              </p>
            </div>
            <button className="text-button signout-button" disabled={busy || parsing} onClick={onSignOut} type="button">
              Sign out
            </button>
          </div>

          {error && <p className="form-message error-message" role="alert">{error}</p>}
          {loadError && <p className="form-message error-message" role="alert">{loadError}</p>}

          <form className="resume-upload" onSubmit={submitResume}>
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
              }}
              type="file"
            />
            <p className="upload-hint">PDF or DOCX · 5 MB maximum · Each resume can only be processed once per account, even if renamed. Extracted text is saved with the draft and sent to Gemini.</p>
            {parseError && <p className="form-message error-message" role="alert">{parseError}</p>}
            <button className="primary-button" disabled={parsing || !file} type="submit">
              {parsing ? 'Parsing your resume…' : 'Parse resume'}
              {!parsing && <span aria-hidden="true">→</span>}
            </button>
          </form>

          {savedResumes.length > 0 && (
            <section className="saved-resumes" aria-labelledby="saved-resumes-title">
              <h2 id="saved-resumes-title">Saved resumes <span>{savedResumes.length}</span></h2>
              <ul>
                {savedResumes.map((resume) => (
                  <li key={resume.id}>
                    <button
                      aria-current={draft?.id === resume.id ? 'true' : undefined}
                      className="saved-resume-button"
                      onClick={() => setDraft(resume)}
                      type="button"
                    >
                      <span>
                        <strong>{resume.personalInfo.fullName || resume.title}</strong>
                        <small>{new Date(resume.createdAt).toLocaleDateString()}</small>
                      </span>
                      <span aria-hidden="true">{draft?.id === resume.id ? 'Viewing' : 'View'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {draft && (
            <section className="resume-draft" aria-labelledby="draft-title">
              <div className="draft-heading">
                <div>
                  <p className="form-eyebrow">PARSED DRAFT</p>
                  <h2 id="draft-title">{draft.personalInfo.fullName || 'Resume draft'}</h2>
                </div>
                <span className="draft-badge" role="status">Ready to review</span>
              </div>

              <section className="draft-section">
                <h3>Personal details</h3>
                <dl className="personal-details">
                  {([
                    ['Email', draft.personalInfo.email],
                    ['Phone', draft.personalInfo.phone],
                    ['Location', draft.personalInfo.location],
                    ['LinkedIn', draft.personalInfo.linkedinUrl],
                    ['GitHub', draft.personalInfo.githubUrl],
                  ] as const).map(([label, value]) => value && (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {!Object.values(draft.personalInfo).some(Boolean) && (
                  <p className="empty-draft">No personal details were identified.</p>
                )}
              </section>

              <section className="draft-section">
                <h3>Work experience <span>{draft.workExperience.length}</span></h3>
                {draft.workExperience.length ? (
                  <ul className="draft-list">
                    {draft.workExperience.map((experience, index) => (
                      <li key={`${experience.company ?? 'experience'}-${index}`}>
                        <strong>{experience.position || 'Position not identified'}</strong>
                        <p>{experience.company || 'Company not identified'}</p>
                        {(experience.startDate || experience.endDate || experience.isCurrent) && (
                          <p className="draft-meta">
                            {experience.startDate ?? 'Start date unknown'} – {experience.isCurrent ? 'Present' : experience.endDate ?? 'End date unknown'}
                          </p>
                        )}
                        {experience.bullets.length > 0 && (
                          <ul>{experience.bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}</ul>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : <p className="empty-draft">No work experience was identified.</p>}
              </section>

              <section className="draft-section">
                <h3>Education <span>{draft.education.length}</span></h3>
                {draft.education.length ? (
                  <ul className="draft-list">
                    {draft.education.map((education, index) => (
                      <li key={`${education.institution ?? 'education'}-${index}`}>
                        <strong>{education.degree || 'Degree not identified'}</strong>
                        <p>{education.institution || 'Institution not identified'}</p>
                        {(education.fieldOfStudy || education.graduationYear) && (
                          <p className="draft-meta">
                            {[education.fieldOfStudy, education.graduationYear].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : <p className="empty-draft">No education was identified.</p>}
              </section>

              <section className="draft-section">
                <h3>Skills <span>{draft.skills.length}</span></h3>
                {draft.skills.length ? (
                  <ul className="skill-list">{draft.skills.map((skill, index) => <li key={`${skill}-${index}`}>{skill}</li>)}</ul>
                ) : <p className="empty-draft">No skills were identified.</p>}
              </section>

              <details className="raw-text">
                <summary>View extracted text</summary>
                <pre>{draft.rawExtractedText}</pre>
              </details>
            </section>
          )}
        </div>
        <p className="panel-footer">© 2026 MatchCV. Built for your next move.</p>
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
    <a aria-label="MatchCV home" className={`brand${compact ? ' brand-compact' : ''}`} href="/login">
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
