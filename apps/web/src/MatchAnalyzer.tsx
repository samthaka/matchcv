import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { getAccessToken } from './auth'
import type { ResumeRecord } from './resume-types'

const matchResponseSchema = z.object({
  matchScore: z.number().int().min(0).max(100),
  proposedMatchScore: z.number().int().min(0).max(100),
  scoreConfidence: z.number().int().min(0).max(100),
  scoreMethod: z.literal('weighted_requirement_coverage'),
  analysisStatus: z.enum(['skipped', 'completed']),
  requirements: z.array(z.object({
    text: z.string(),
    normalizedTerm: z.string(),
    category: z.enum([
      'hard_skill',
      'tool',
      'soft_skill',
      'responsibility',
      'experience',
      'education',
    ]),
    importance: z.enum(['required', 'preferred']),
    confidence: z.number().min(0).max(1),
    status: z.enum(['matched', 'partial', 'missing', 'unclear']),
    evidence: z.array(z.string()),
    minimumYears: z.number().nullable(),
  }).strict()),
  taxonomyUpdates: z.object({
    addedSkills: z.number().int().min(0),
    addedAliases: z.number().int().min(0),
  }).strict(),
  matchedHardSkills: z.array(z.string()),
  missingCriticalKeywords: z.array(z.string()),
  bulletPointRewrites: z.array(z.object({
    originalBullet: z.string(),
    rewrittenBullet: z.string(),
  }).strict()),
}).strict()

export type MatchResult = z.infer<typeof matchResponseSchema>
export type MatchGap = Omit<MatchResult['requirements'][number], 'status'> & {
  status: 'partial' | 'missing' | 'unclear'
}

function isMatchGap(requirement: MatchResult['requirements'][number]): requirement is MatchGap {
  return requirement.status !== 'matched'
}

export function MatchAnalyzer({
  resumes,
  onSessionExpired,
  onBuildResume,
  onSuggestionsReady,
}: {
  resumes: ResumeRecord[]
  onSessionExpired: () => void
  onBuildResume: () => void
  onSuggestionsReady: (
    resume: ResumeRecord,
    rewrites: MatchResult['bulletPointRewrites'],
    analysis: {
      current: number
      proposed: number
      gaps: MatchGap[]
    },
  ) => Promise<void>
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
      if (parsed.data.analysisStatus === 'completed') {
        const sourceResume = resumes.find((resume) => resume.id === selectedResumeId)
        if (!sourceResume) {
          throw new Error('The selected resume is no longer available.')
        }
        await onSuggestionsReady(
          sourceResume,
          parsed.data.bulletPointRewrites,
          {
            current: parsed.data.matchScore,
            proposed: parsed.data.proposedMatchScore,
            gaps: parsed.data.requirements.filter(isMatchGap),
          },
        )
      }
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
            Groq extracts role requirements and compares them with resume evidence. Confident technical terms can be added to the skills taxonomy. Gemini is used for suggestions when the score is at least 20% and the first-pass assessment is sufficiently certain. Contact details are excluded.
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
            <section aria-labelledby="match-results-title">
              <div className="match-score-comparison">
                {([
                  ['current', 'Current CV', result.matchScore],
                  ['proposed', 'Optimized / proposed CV', result.proposedMatchScore],
                ] as const).map(([id, label, score]) => (
                  <div className="match-score-card" key={id}>
                    <div>
                      <p className="workspace-section-kicker">{label}</p>
                      <h2 id={id === 'current' ? 'match-results-title' : undefined}>{score}%</h2>
                    </div>
                    <div
                      aria-label={`${label} match score: ${score}%`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={score}
                      className="match-score-track"
                      role="progressbar"
                    >
                      <span style={{ width: `${score}%` }} />
                    </div>
                    {id === 'current' && (
                      <p className="match-score-confidence">
                        Weighted requirement coverage · {result.scoreConfidence}% assessment confidence
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {result.analysisStatus === 'skipped' && (
                <p className="match-score-note">
                  No optimized CV was generated, so the proposed score matches your current CV.
                </p>
              )}
            </section>

            <section className="match-requirements" aria-labelledby="requirements-title">
              <div className="workspace-section-heading">
                <div>
                  <p className="workspace-section-kicker">ROOM TO IMPROVE</p>
                  <h2 id="requirements-title">What’s missing</h2>
                </div>
              </div>
              {result.requirements.some((requirement) => requirement.status !== 'matched') ? (
                <ul>
                  {result.requirements
                    .filter((requirement) => requirement.status !== 'matched')
                    .map((requirement, index) => (
                    <li key={`${requirement.normalizedTerm}-${index}`}>
                      <div className="match-requirement-heading">
                        <strong>{requirement.normalizedTerm}</strong>
                        <span className={`requirement-status ${requirement.status}`}>
                          {requirement.status === 'matched'
                            ? 'Matched'
                            : requirement.status === 'partial'
                              ? 'Partial'
                              : requirement.status === 'missing'
                                ? 'Not evidenced'
                                : 'Unclear'}
                        </span>
                      </div>
                      <p>{requirement.text} · {requirement.importance} · {requirement.category.replace('_', ' ')}</p>
                      {requirement.evidence.length > 0 && (
                        <blockquote>{requirement.evidence.join(' · ')}</blockquote>
                      )}
                      {requirement.status === 'unclear' && requirement.evidence.length === 0 && (
                        <small>There was not enough resume information to assess this requirement.</small>
                      )}
                    </li>
                    ))}
                </ul>
              ) : (
                <p className="match-empty-copy">
                  {result.requirements.length > 0
                    ? 'No missing requirements were identified.'
                    : 'No clear requirements could be extracted.'}
                </p>
              )}
              {(result.taxonomyUpdates.addedSkills > 0 || result.taxonomyUpdates.addedAliases > 0) && (
                <p className="taxonomy-update-note" role="status">
                  Skills taxonomy updated: {result.taxonomyUpdates.addedSkills} new skills and {result.taxonomyUpdates.addedAliases} aliases.
                </p>
              )}
            </section>

            {result.analysisStatus === 'skipped' && (
              <div className="match-skipped-note" role="status">
                <strong>AI suggestions were skipped to save tokens.</strong>
                <p>
                  This score is below 20%, which can indicate the resume and role are in different fields.
                  Review the job description and selected resume before deciding whether to continue.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  )
}
