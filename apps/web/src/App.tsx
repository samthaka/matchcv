import { useEffect, useState, type FormEvent } from 'react'
import { clearAccessToken, setAccessToken } from './auth'
import './App.css'

type AuthResponse = {
  error?: string
  message?: string
  accessToken?: string
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
      } else if (result.accessToken) {
        setAccessToken(result.accessToken)
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

  if (signedIn) {
    return (
      <main className="auth-layout">
        <BrandPanel />
        <section className="form-panel">
          <div className="form-content">
            <Brand compact />
            <div className="success-icon" aria-hidden="true">✓</div>
            <p className="form-eyebrow">You’re signed in</p>
            <h1>Welcome back.</h1>
            <p className="form-description">
              Your MatchCV workspace is ready. We’ll take you to your dashboard as soon as it’s available.
            </p>
            <button className="primary-button" type="button" onClick={signOut} disabled={busy}>
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
            {error && <p className="form-message error-message" role="alert">{error}</p>}
          </div>
          <p className="panel-footer">© 2026 MatchCV. Built for your next move.</p>
        </section>
      </main>
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
