import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { getAccessToken } from './auth'
import type { ResumeRecord } from './resume-types'

const matchResponseSchema = z.object({
  matchScore: z.number().int().min(0).max(100),
  analysisStatus: z.enum(['skipped', 'completed']),
  matchedHardSkills: z.array(z.string()),
  missingCriticalKeywords: z.array(z.string()),
  bulletPointRewrites: z.array(z.object({
    originalBullet: z.string(),
    rewrittenBullet: z.string(),
  }).strict()),
}).strict()

type MatchResult = z.infer<typeof matchResponseSchema>

export function MatchAnalyzer({
  resumes,
  onSessionExpired,
  onBuildResume,
}: {
  resumes: ResumeRecord[]
  onSessionExpired: () => void
  onBuildResume: () => void
}) {
  const [resumeId, setResumeId] = useState(() => resumes[0]?.id ?? '')
  const [jobDescriptionText, setJobDescriptionText] = useState('')
  const [result, setResult] = useState<MatchResult | null>(null)
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const selectedResumeId = resumes.some((resume) => resume.id === resumeId)
    ? resumeId
    : resumes[0]?.id ?? ''

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setResult(null)

    const token = getAccessToken()
    if (!token) {
      onSessionExpired()
      setError('Your sign-in session has expired. Please sign in again.')
      return
    }

    setAnalyzing(true)
    try {
      const response = await fetch('/api/v1/match/analyze', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resumeId: selectedResumeId, jobDescriptionText }),
      })
      if (response.status === 401) {
        onSessionExpired()
        return
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new Error('The server returned an invalid match analysis response.')
      }

      if (!response.ok) {
        const message = typeof payload === 'object'
          && payload !== null
          && 'error' in payload
          && typeof payload.error === 'string'
          ? payload.error
          : 'We couldn’t analyze this job description. Please try again.'
        throw new Error(message)
      }

      const parsed = matchResponseSchema.safeParse(payload)
      if (!parsed.success) {
        throw new Error('The server returned an incomplete match analysis.')
      }
      setResult(parsed.data)
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : 'We couldn’t reach the server. Check your connection and try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  if (resumes.length === 0) {
    return (
      <>
        <div className="workspace-page-heading">
          <p className="form-eyebrow">FIND YOUR FIT</p>
          <h1>Match a job.</h1>
          <p className="form-description">Compare one of your saved resumes with a target role.</p>
        </div>
        <div className="workspace-empty-state">
          <span aria-hidden="true">◎</span>
          <h3>Save a resume to get started</h3>
          <p>Create or upload a resume first, then come back to compare it with a job description.</p>
          <button className="workspace-primary-button" onClick={onBuildResume} type="button">
            Build a resume <span aria-hidden="true">→</span>
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="workspace-page-heading">
        <p className="form-eyebrow">FIND YOUR FIT</p>
        <h1>Match a job.</h1>
        <p className="form-description">
          See how your experience aligns and where your application could be stronger.
        </p>
      </div>

      <div className="match-layout">
        <form className="match-form" onSubmit={submit}>
          <div className="workspace-card-heading">
            <span className="workspace-action-icon upload-icon" aria-hidden="true">◎</span>
            <div>
              <h2>Choose a resume and job description</h2>
              <p>Your resume is only used for this analysis.</p>
            </div>
          </div>

          <label htmlFor="match-resume">Resume</label>
          <select
            disabled={analyzing}
            id="match-resume"
            onChange={(event) => {
              setResumeId(event.target.value)
              setResult(null)
              setError('')
            }}
            required
            value={selectedResumeId}
          >
            {resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.personalInfo.fullName || resume.title} — {resume.title}
              </option>
            ))}
          </select>

          <div className="match-label-row">
            <label htmlFor="job-description">Job description</label>
            <span>{jobDescriptionText.length.toLocaleString()} / 20,000</span>
          </div>
          <textarea
            disabled={analyzing}
            id="job-description"
            maxLength={20_000}
            onChange={(event) => {
              setJobDescriptionText(event.target.value)
              setResult(null)
              setError('')
            }}
            placeholder="Paste the job description here — responsibilities, requirements, and qualifications."
            required
            rows={12}
            value={jobDescriptionText}
          />
          <p className="match-privacy-note">
            We first calculate a lightweight similarity score. If it is 20% or higher, resume experience and the job description are sent to Gemini for suggestions. Contact details are excluded.
          </p>
          {error && <p className="form-message error-message" role="alert">{error}</p>}
          <button
            className="workspace-primary-button match-submit"
            disabled={analyzing || !selectedResumeId || !jobDescriptionText.trim()}
            type="submit"
          >
            {analyzing ? 'Analyzing your match…' : 'Analyze match'}
            {!analyzing && <span aria-hidden="true">→</span>}
          </button>
        </form>

        {result && (
          <section aria-labelledby="match-results-title" className="match-results" aria-live="polite">
            <div className="match-score-card">
              <div>
                <p className="workspace-section-kicker">OVERALL MATCH</p>
                <h2 id="match-results-title">{result.matchScore}%</h2>
              </div>
              <span className={`match-status-badge ${result.analysisStatus}`}>
                {result.analysisStatus === 'completed' ? 'Suggestions ready' : 'Quick score only'}
              </span>
              <div
                aria-label={`Match score: ${result.matchScore}%`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={result.matchScore}
                className="match-score-track"
                role="progressbar"
              >
                <span style={{ width: `${result.matchScore}%` }} />
              </div>
            </div>

            {result.analysisStatus === 'skipped' ? (
              <div className="match-skipped-note" role="status">
                <strong>AI suggestions were skipped to save tokens.</strong>
                <p>
                  This score is below 20%, which can indicate the resume and role are in different fields.
                  Review the job description and selected resume before deciding whether to continue.
                </p>
              </div>
            ) : (
              <>
                <div className="match-result-grid">
                  <section className="match-result-card" aria-labelledby="matched-skills-title">
                    <h3 id="matched-skills-title">Matched hard skills</h3>
                    {result.matchedHardSkills.length > 0 ? (
                      <ul className="match-chip-list matched">
                        {result.matchedHardSkills.map((skill) => <li key={skill}>{skill}</li>)}
                      </ul>
                    ) : <p className="match-empty-copy">No matched hard skills identified.</p>}
                  </section>
                  <section className="match-result-card" aria-labelledby="missing-keywords-title">
                    <h3 id="missing-keywords-title">Missing keywords</h3>
                    {result.missingCriticalKeywords.length > 0 ? (
                      <ul className="match-chip-list missing">
                        {result.missingCriticalKeywords.map((keyword) => <li key={keyword}>{keyword}</li>)}
                      </ul>
                    ) : <p className="match-empty-copy">No critical keywords identified as missing.</p>}
                  </section>
                </div>

                <section className="match-rewrites" aria-labelledby="rewrites-title">
                  <div className="workspace-section-heading">
                    <div>
                      <p className="workspace-section-kicker">MAKE YOUR EXPERIENCE CLEAR</p>
                      <h2 id="rewrites-title">Bullet point suggestions</h2>
                    </div>
                  </div>
                  {result.bulletPointRewrites.length > 0 ? (
                    <ul>
                      {result.bulletPointRewrites.map((rewrite, index) => (
                        <li key={`${rewrite.originalBullet}-${index}`}>
                          <p><span>ORIGINAL</span>{rewrite.originalBullet}</p>
                          <p><span>SUGGESTED</span>{rewrite.rewrittenBullet}</p>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="match-empty-copy">No existing bullets needed a rewrite.</p>}
                </section>
              </>
            )}
          </section>
        )}
      </div>
    </>
  )
}
