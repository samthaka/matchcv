import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import type { ResumeInput } from './resume-types'
import type { ResumeTemplate } from './template-types'
import './ResumePreview.css'

type Props = {
  resume: ResumeInput
  template: ResumeTemplate
  matchAnalysis?: {
    current: number
    proposed: number
    gaps: Array<{
      normalizedTerm: string
      text: string
      importance: 'required' | 'preferred'
      category: 'hard_skill' | 'tool' | 'soft_skill' | 'responsibility' | 'experience' | 'education'
      status: 'partial' | 'missing' | 'unclear'
    }>
  }
  notice?: string
  onClose: () => void
  onEdit?: () => void
  onSaveMatchResume?: (title: string) => Promise<void>
  onDownload?: () => void | Promise<void>
}

function previewText(value: string | null | undefined, placeholder: string) {
  const text = value?.trim()
  return text ? { text, isPlaceholder: false } : { text: placeholder, isPlaceholder: true }
}

export function ResumePreview({
  resume,
  template,
  matchAnalysis,
  notice,
  onClose,
  onEdit,
  onSaveMatchResume,
  onDownload,
}: Props) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [savingMatchResume, setSavingMatchResume] = useState(false)
  const [matchResumeTitle, setMatchResumeTitle] = useState('')
  const [matchResumeSaved, setMatchResumeSaved] = useState(false)
  const [matchResumeSaveError, setMatchResumeSaveError] = useState('')

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const fullName = previewText(resume.personalInfo.fullName, 'Your name')
  const contactDetails = [
    { value: resume.personalInfo.email, placeholder: 'Email address' },
    { value: resume.personalInfo.phone, placeholder: 'Phone number' },
    { value: resume.personalInfo.location, placeholder: 'City, country' },
    { value: resume.personalInfo.linkedinUrl, placeholder: 'LinkedIn profile' },
    { value: resume.personalInfo.githubUrl, placeholder: 'Portfolio or GitHub' },
  ].map(({ value, placeholder }) => previewText(value, placeholder))
  const experience = resume.workExperience.length > 0
    ? resume.workExperience
    : [{
      company: null,
      position: null,
      title: null,
      startDate: null,
      endDate: null,
      isCurrent: false,
      bullets: [],
    }]
  const education = resume.education.length > 0
    ? resume.education
    : [{ institution: null, award: null, fieldOfStudy: null, graduationYear: null }]
  const skills = resume.skills.length > 0 ? resume.skills : ['Add your skills here']
  const fontFamily = template.fontFamily === 'Times-Roman'
    ? 'Georgia, "Times New Roman", serif'
    : template.fontFamily === 'Courier'
      ? '"Courier New", monospace'
      : 'Arial, Helvetica, sans-serif'
  const pageStyle = {
    '--preview-accent': template.accentColor,
    '--preview-text': template.textColor,
    '--preview-paper': template.backgroundColor,
    '--preview-font': fontFamily,
    '--preview-font-size': `${template.fontSize}pt`,
  } as CSSProperties
  const contactPrimary = contactDetails.slice(0, 3)
  const contactSecondary = contactDetails.slice(3)

  async function download() {
    if (!onDownload) return
    setDownloading(true)
    setDownloadError('')
    try {
      await onDownload()
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'We couldn’t download this resume.')
    } finally {
      setDownloading(false)
    }
  }

  async function saveMatchResume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onSaveMatchResume || matchResumeSaved) return

    setSavingMatchResume(true)
    setMatchResumeSaveError('')
    try {
      await onSaveMatchResume(matchResumeTitle.trim())
      setMatchResumeSaved(true)
    } catch (error) {
      setMatchResumeSaveError(error instanceof Error ? error.message : 'We couldn’t save this resume.')
    } finally {
      setSavingMatchResume(false)
    }
  }

  function renderEducation() {
    return (
      <section className="cv-preview-section">
        <h3>Education</h3>
        {education.map((item, index) => {
          const award = previewText(item.award, 'Degree or qualification')
          const field = previewText(item.fieldOfStudy, 'Field of study')
          const institution = previewText(item.institution, 'School or institution')
          const year = item.graduationYear ?? 'Graduation year'
          return (
            <article className="cv-preview-item" key={`education-${index}`}>
              <strong className={award.isPlaceholder && field.isPlaceholder ? 'cv-preview-placeholder' : ''}>
                {award.text}
              </strong>
              <p className={field.isPlaceholder ? 'cv-preview-placeholder' : ''}>{field.text}</p>
              <p className={institution.isPlaceholder ? 'cv-preview-placeholder' : ''}>{institution.text}</p>
              <p className={year === 'Graduation year' ? 'cv-preview-placeholder' : ''}>{year}</p>
            </article>
          )
        })}
      </section>
    )
  }

  function renderSkills() {
    return (
      <section className="cv-preview-section">
        <h3>Skills</h3>
        <ul className="cv-preview-skills">
          {skills.map((skill, index) => (
            <li
              className={resume.skills.length === 0 ? 'cv-preview-placeholder' : ''}
              key={`skill-${index}`}
            >
              {skill}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  function renderExperience() {
    return (
      <section className="cv-preview-section">
        <h3>Work Experience</h3>
        {experience.map((item, index) => {
          const role = previewText(item.position || item.title, 'Job title')
          const company = previewText(item.company, 'Company')
          const dates = [item.startDate, item.isCurrent ? 'Present' : item.endDate].filter(Boolean)
          return (
            <article className="cv-preview-item" key={`experience-${index}`}>
              <strong className={role.isPlaceholder ? 'cv-preview-placeholder' : ''}>{role.text}</strong>
              <p className={company.isPlaceholder ? 'cv-preview-placeholder' : ''}>{company.text}</p>
              <p className={dates.length === 0 ? 'cv-preview-placeholder' : ''}>
                {dates.length > 0 ? dates.join(' – ') : 'Start date – End date'}
              </p>
              <ul>
                {(item.bullets.length > 0 ? item.bullets : ['Add an achievement or impact']).map((bullet, bulletIndex) => (
                  <li
                    className={item.bullets.length === 0 ? 'cv-preview-placeholder' : ''}
                    key={`experience-${index}-bullet-${bulletIndex}`}
                  >
                    {bullet}
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </section>
    )
  }

  return (
    <div
      className="cv-preview-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-labelledby="cv-preview-title"
        aria-modal="true"
        className="cv-preview-dialog"
        role="dialog"
      >
        <header className="cv-preview-toolbar">
          <div>
            <p className="form-eyebrow">LIVE PREVIEW</p>
            <h2 id="cv-preview-title">{template.name} template</h2>
            {notice && <p className="cv-preview-notice" role="status">{notice}</p>}
            {downloadError && <p className="cv-preview-error" role="alert">{downloadError}</p>}
          </div>
          <div className="cv-preview-actions">
            {onEdit && <button className="cv-preview-secondary" onClick={onEdit} type="button">Edit resume</button>}
            {onDownload && (
              <button className="cv-preview-primary" disabled={downloading} onClick={() => void download()} type="button">
                {downloading ? 'Preparing PDF…' : 'Download PDF'}
              </button>
            )}
            <button aria-label="Close preview" className="cv-preview-close" onClick={onClose} type="button">×</button>
          </div>
        </header>
        <div className="cv-preview-scroll">
          <div className={matchAnalysis ? 'cv-preview-layout has-match-analysis' : 'cv-preview-layout'}>
            {matchAnalysis && (
              <aside aria-label="Match analysis" className="cv-preview-analysis">
                <section aria-labelledby="preview-score-title" className="cv-preview-score-panel">
                  <p className="form-eyebrow">MATCH ANALYSIS</p>
                  <h2 id="preview-score-title">Match scores</h2>
                  {([
                    ['Current CV', matchAnalysis.current],
                    ['Optimized / proposed CV', matchAnalysis.proposed],
                  ] as const).map(([label, score]) => (
                    <div className="cv-preview-score" key={label}>
                      <div>
                        <span>{label}</span>
                        <strong>{score}%</strong>
                      </div>
                      <div
                        aria-label={`${label} match score: ${score}%`}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={score}
                        className="cv-preview-score-track"
                        role="progressbar"
                      >
                        <span style={{ width: `${score}%` }} />
                      </div>
                    </div>
                  ))}
                </section>

                <section aria-labelledby="preview-gaps-title" className="cv-preview-gaps">
                  <p className="form-eyebrow">ROOM TO IMPROVE</p>
                  <h2 id="preview-gaps-title">What’s missing</h2>
                  {matchAnalysis.gaps.length > 0 ? (
                    <ul>
                      {matchAnalysis.gaps.map((gap, index) => (
                        <li key={`${gap.normalizedTerm}-${index}`}>
                          <div>
                            <strong>{gap.normalizedTerm}</strong>
                            <span className={`cv-preview-gap-status ${gap.status}`}>
                              {gap.status === 'missing'
                                ? 'Missing'
                                : gap.status === 'partial'
                                  ? 'Partial'
                                  : 'Unclear'}
                            </span>
                          </div>
                          <p>{gap.text} · {gap.importance} · {gap.category.replace('_', ' ')}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="cv-preview-no-gaps">No missing requirements identified.</p>
                  )}
                </section>
                {onSaveMatchResume && (
                  <form className="cv-preview-save-form" onSubmit={(event) => void saveMatchResume(event)}>
                    <label htmlFor="match-resume-title">Save this resume as</label>
                    <input
                      autoComplete="off"
                      id="match-resume-title"
                      maxLength={120}
                      onChange={(event) => setMatchResumeTitle(event.target.value)}
                      placeholder="Choose a name"
                      required
                      value={matchResumeTitle}
                    />
                    {matchResumeSaveError && (
                      <p className="cv-preview-error" role="alert">{matchResumeSaveError}</p>
                    )}
                    <button
                      className="cv-preview-primary"
                      disabled={savingMatchResume || matchResumeSaved || !matchResumeTitle.trim()}
                      type="submit"
                    >
                      {savingMatchResume ? 'Saving…' : matchResumeSaved ? 'Saved to My resumes' : 'Save resume'}
                    </button>
                  </form>
                )}
              </aside>
            )}
            <article
              className={`cv-preview-page cv-preview-${template.layout}`}
              style={pageStyle}
              aria-label="Resume preview"
            >
            <header className="cv-preview-person">
              <h1 className={fullName.isPlaceholder ? 'cv-preview-placeholder' : ''}>{fullName.text}</h1>
              <div className="cv-preview-contact">
                {contactPrimary.map((detail, index) => (
                  <span className={detail.isPlaceholder ? 'cv-preview-placeholder' : ''} key={`contact-${index}`}>
                    {detail.text}
                  </span>
                ))}
              </div>
            </header>
            {template.layout === 'two-column' ? (
              <div className="cv-preview-columns">
                <aside>
                  {contactSecondary.length > 0 && (
                    <section className="cv-preview-section cv-preview-sidebar-contact">
                      <h3>Links</h3>
                      {contactSecondary.map((detail, index) => (
                        <p className={detail.isPlaceholder ? 'cv-preview-placeholder' : ''} key={`link-${index}`}>{detail.text}</p>
                      ))}
                    </section>
                  )}
                  {renderEducation()}
                  {renderSkills()}
                </aside>
                <div className="cv-preview-main">{renderExperience()}</div>
              </div>
            ) : (
              <>
                {renderExperience()}
                {renderEducation()}
                {renderSkills()}
              </>
            )}
            </article>
          </div>
        </div>
      </section>
    </div>
  )
}
