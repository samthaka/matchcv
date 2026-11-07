import {
  useLayoutEffect,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type UseFormRegister,
} from 'react-hook-form'
import { z } from 'zod'
import type { ResumeInput, ResumeRecord } from './resume-types'
import { DEFAULT_TEMPLATE, templateDesign, type ResumeTemplate } from './template-types'
import { ResumePreview } from './ResumePreview'
import './ResumeEditor.css'

const resumeFormSchema = z.object({
  title: z.string().trim().min(1, 'Enter a resume title.').max(120),
  professionalSummary: z.string().max(3000),
  personalInfo: z.object({
    fullName: z.string().trim().min(1, 'Enter your name.').max(200),
    email: z.union([z.literal(''), z.email()]).refine(
      (email) => email.length <= 320,
      'Email must be 320 characters or fewer.',
    ),
    linkedinUrl: z.string().max(2000),
    githubUrl: z.string().max(2000),
    portfolioUrl: z.string().max(2000),
  }),
  workExperience: z.array(z.object({
    company: z.string().max(2000),
    position: z.string().max(2000),
    title: z.string().max(2000),
    startDate: z.string().max(2000),
    endDate: z.string().max(2000),
    isCurrent: z.boolean(),
    bullets: z.array(z.object({ text: z.string().max(2000) })).max(30),
  })).max(50),
  education: z.array(z.object({
    institution: z.string().max(2000),
    award: z.string().max(2000),
    fieldOfStudy: z.string().max(2000),
    graduationYear: z.string()
      .regex(/^\d{0,4}$/)
      .refine((year) => !year || (Number(year) >= 1900 && Number(year) <= 2200), 'Enter a year from 1900 to 2200.'),
  })).max(30),
  skillsText: z.string()
    .max(10000)
    .refine(
      (text) => text.split(/[,\n]/).filter((skill) => skill.trim()).length <= 100,
      'Use 100 skills or fewer.',
    )
    .refine(
      (text) => text.split(/[,\n]/).every((skill) => skill.trim().length <= 100),
      'Each skill must be 100 characters or fewer.',
    ),
})

type ResumeFormValues = z.infer<typeof resumeFormSchema>

const emptyValues: ResumeFormValues = {
  title: 'My Resume',
  professionalSummary: '',
  personalInfo: {
    fullName: '',
    email: '',
    linkedinUrl: '',
    githubUrl: '',
    portfolioUrl: '',
  },
  workExperience: [],
  education: [],
  skillsText: '',
}

function toFormValues(resume?: ResumeRecord): ResumeFormValues {
  if (!resume) {
    return emptyValues
  }

  return {
    title: resume.title,
    professionalSummary: resume.professionalSummary,
    personalInfo: {
      fullName: resume.personalInfo.fullName ?? '',
      email: resume.personalInfo.email ?? '',
      linkedinUrl: resume.personalInfo.linkedinUrl ?? '',
      githubUrl: resume.personalInfo.githubUrl ?? '',
      portfolioUrl: resume.personalInfo.portfolioUrl ?? '',
    },
    workExperience: resume.workExperience.map((experience) => ({
      company: experience.company ?? '',
      position: experience.position ?? '',
      title: experience.title ?? '',
      startDate: experience.startDate ?? '',
      endDate: experience.endDate ?? '',
      isCurrent: experience.isCurrent,
      bullets: experience.bullets.map((bullet) => ({ text: bullet })),
    })),
    education: resume.education.map((education) => ({
      institution: education.institution ?? '',
      award: education.award ?? '',
      fieldOfStudy: education.fieldOfStudy ?? '',
      graduationYear: education.graduationYear?.toString() ?? '',
    })),
    skillsText: resume.skills.join(', '),
  }
}

function optionalText(value: string): string | null {
  return value.trim() || null
}

function toResumeInput(values: ResumeFormValues): ResumeInput {
  return {
    title: values.title.trim(),
    professionalSummary: values.professionalSummary.trim(),
    personalInfo: {
      fullName: values.personalInfo.fullName.trim(),
      email: optionalText(values.personalInfo.email),
      linkedinUrl: optionalText(values.personalInfo.linkedinUrl),
      githubUrl: optionalText(values.personalInfo.githubUrl),
      portfolioUrl: optionalText(values.personalInfo.portfolioUrl),
    },
    workExperience: values.workExperience
      .filter((experience) =>
        experience.company.trim() ||
        experience.position.trim() ||
        experience.title.trim() ||
        experience.startDate.trim() ||
        experience.endDate.trim() ||
        experience.bullets.some((bullet) => bullet.text.trim()),
      )
      .map((experience) => ({
        company: optionalText(experience.company),
        position: optionalText(experience.position),
        title: optionalText(experience.title),
        startDate: optionalText(experience.startDate),
        endDate: experience.isCurrent ? null : optionalText(experience.endDate),
        isCurrent: experience.isCurrent,
        bullets: experience.bullets.map((bullet) => bullet.text.trim()).filter(Boolean),
      })),
    education: values.education
      .filter((education) =>
        education.institution.trim() || education.award.trim() || education.fieldOfStudy.trim() || education.graduationYear,
      )
      .map((education) => ({
        institution: optionalText(education.institution),
        award: optionalText(education.award),
        fieldOfStudy: optionalText(education.fieldOfStudy),
        graduationYear: education.graduationYear ? Number(education.graduationYear) : null,
      })),
    skills: values.skillsText.split(/[,\n]/).map((skill) => skill.trim()).filter(Boolean),
  }
}

function filled(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

function GrowingTextarea({
  id,
  maxLength,
  registerRef,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  registerRef: (element: HTMLTextAreaElement | null) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  function resize(element: HTMLTextAreaElement) {
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    resize(textarea)
    if (typeof ResizeObserver === 'undefined') {
      return
    }

    let width = textarea.getBoundingClientRect().width
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width
        resize(textarea)
      }
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [])

  return (
    <textarea
      {...props}
      id={id}
      maxLength={maxLength}
      ref={(element) => {
        textareaRef.current = element
        registerRef(element)
      }}
      rows={1}
      onInput={(event) => resize(event.currentTarget)}
    />
  )
}

function ExperienceFields({
  control,
  register,
  index,
}: {
  control: Control<ResumeFormValues>
  register: UseFormRegister<ResumeFormValues>
  index: number
}) {
  const bullets = useFieldArray({
    control,
    name: `workExperience.${index}.bullets`,
  })

  return (
    <div className="editor-achievements">
      <div className="editor-section-heading">
        <h4>Achievements</h4>
        <button
          className="editor-add-button"
          disabled={bullets.fields.length >= 30}
          onClick={() => bullets.append({ text: '' })}
          type="button"
        >
          Add achievement
        </button>
      </div>
      {bullets.fields.map((field, bulletIndex) => {
        const path = `workExperience.${index}.bullets.${bulletIndex}.text` as const
        const { ref, ...registration } = register(path)
        const id = `experience-${index}-achievement-${bulletIndex}`
        return (
          <div className="editor-achievement" key={field.id}>
            <label htmlFor={id}>Achievement {bulletIndex + 1}</label>
            <GrowingTextarea
              id={id}
              maxLength={2000}
              aria-label={`Achievement ${bulletIndex + 1}`}
              registerRef={ref}
              {...registration}
            />
            <button
              aria-label={`Delete achievement ${bulletIndex + 1}`}
              className="editor-remove-button"
              onClick={() => bullets.remove(bulletIndex)}
              type="button"
            >
              Delete
            </button>
          </div>
        )
      })}
    </div>
  )
}

type Props = {
  resume?: ResumeRecord
  templates: ResumeTemplate[]
  initialTemplate?: ResumeTemplate
  onSave: (input: ResumeInput, resumeId?: string) => Promise<ResumeRecord>
  onExport: (resumeId: string) => Promise<void>
}

export function ResumeEditor({ resume, templates, initialTemplate, onSave, onExport }: Props) {
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const resumeTemplate = resume?.template
  const templateAtStart = resumeTemplate
    ? { ...resumeTemplate, id: 'saved-resume-template' }
    : initialTemplate ?? DEFAULT_TEMPLATE
  const [selectedTemplateId, setSelectedTemplateId] = useState(templateAtStart.id)
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templateAtStart
  const {
    control,
    getValues,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResumeFormValues>({
    resolver: zodResolver(resumeFormSchema),
    defaultValues: toFormValues(resume),
  })
  const experience = useFieldArray({ control, name: 'workExperience' })
  const education = useFieldArray({ control, name: 'education' })
  const values = useWatch({ control })
  const experienceCount = (values.workExperience ?? []).filter((item) =>
    filled(item.company) || filled(item.position) || filled(item.title) || (item.bullets ?? []).some((bullet) => filled(bullet.text)),
  ).length
  const educationCount = (values.education ?? []).filter((item) =>
    filled(item.institution) || filled(item.award) || filled(item.fieldOfStudy),
  ).length
  const skillCount = (values.skillsText ?? '').split(/[,\n]/).filter((skill) => skill.trim()).length

  async function save(values: ResumeFormValues) {
    setSaving(true)
    setFormError('')
    try {
      await onSave({
        ...toResumeInput(values),
        template: templateDesign(selectedTemplate),
      }, resume?.id)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'We couldn’t save this resume.')
    } finally {
      setSaving(false)
    }
  }

  async function exportPdf(values: ResumeFormValues) {
    setExporting(true)
    setFormError('')
    try {
      const savedResume = await onSave({
        ...toResumeInput(values),
        template: templateDesign(selectedTemplate),
      }, resume?.id)
      await onExport(savedResume.id)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'We couldn’t export this PDF.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="resume-editor" aria-labelledby="editor-title">
      <header className="editor-header">
        <div>
          <p className="form-eyebrow">{resume ? 'RESUME EDITOR' : 'NEW RESUME'}</p>
          <h2 id="editor-title">{resume ? 'Edit your resume' : 'Build your resume'}</h2>
          <p>Choose a visual style for your resume. Your content stays separate from the template.</p>
        </div>
        <div className="editor-actions">
          <button
            className="editor-secondary-button"
            disabled={exporting || saving}
            onClick={() => setPreviewOpen(true)}
            type="button"
          >
            Preview resume
          </button>
          <button className="editor-primary-button" disabled={saving || exporting} form="resume-editor-form" type="submit">
            {saving ? 'Saving…' : resume ? 'Save changes' : 'Create resume'}
          </button>
        </div>
      </header>

      <section className="ats-checks" aria-labelledby="ats-title">
        <div>
          <h3 id="ats-title">ATS format checks</h3>
          <p>The exported PDF uses selectable text and standard headings. Your selected template controls its style and layout.</p>
        </div>
        <ul className="ats-check-list">
          <li><span aria-hidden="true">✓</span> {selectedTemplate.layout === 'single-column' ? 'Single-column' : 'Two-column'} layout</li>
          <li><span aria-hidden="true">✓</span> {selectedTemplate.fontFamily} · {selectedTemplate.fontSize} pt</li>
          <li><span aria-hidden="true">✓</span> {selectedTemplate.name} template</li>
          <li className={filled(values.personalInfo?.fullName) ? 'ats-check-pass' : 'ats-check-warning'}>
            <span aria-hidden="true">{filled(values.personalInfo?.fullName) ? '✓' : '!'}</span> Name included
          </li>
          <li className={experienceCount > 0 ? 'ats-check-pass' : 'ats-check-warning'}>
            <span aria-hidden="true">{experienceCount > 0 ? '✓' : '!'}</span> Work experience section
          </li>
          <li className={educationCount > 0 ? 'ats-check-pass' : 'ats-check-warning'}>
            <span aria-hidden="true">{educationCount > 0 ? '✓' : '!'}</span> Education section
          </li>
          <li className={skillCount > 0 ? 'ats-check-pass' : 'ats-check-warning'}>
            <span aria-hidden="true">{skillCount > 0 ? '✓' : '!'}</span> Skills section
          </li>
        </ul>
      </section>

      {formError && <p className="form-message error-message" role="alert">{formError}</p>}
      <form id="resume-editor-form" className="editor-form" onSubmit={handleSubmit(save)}>
        <section className="editor-section">
          <h3>Resume details</h3>
          <label htmlFor="resume-template">Template</label>
          <select
            id="resume-template"
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            value={selectedTemplateId}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}{template.isBuiltIn ? ' · Built-in' : ''}
              </option>
            ))}
            {!templates.some((template) => template.id === selectedTemplateId) && (
              <option value={selectedTemplateId}>{templateAtStart.name} · Saved design</option>
            )}
          </select>
          <label htmlFor="resume-title">Resume title</label>
          <input id="resume-title" {...register('title')} />
          {errors.title && <p className="editor-field-error">{errors.title.message}</p>}
          <label htmlFor="professional-summary">Professional summary</label>
          <textarea
            id="professional-summary"
            maxLength={3000}
            placeholder="Summarize your experience, strengths, and career focus."
            rows={5}
            {...register('professionalSummary')}
          />
          <small className="editor-field-hint">Up to 3,000 characters. This will appear below your name and contact links.</small>
        </section>

        <section className="editor-section">
          <h3>Contact information</h3>
          <div className="editor-field-grid">
            <label>
              Full name
              <input autoComplete="name" {...register('personalInfo.fullName')} />
              {errors.personalInfo?.fullName && <span className="editor-field-error">{errors.personalInfo.fullName.message}</span>}
            </label>
            <label>
              Email
              <input autoComplete="email" type="email" {...register('personalInfo.email')} />
              {errors.personalInfo?.email && <span className="editor-field-error">{errors.personalInfo.email.message}</span>}
            </label>
            <label>LinkedIn URL<input autoComplete="url" placeholder="https://linkedin.com/in/you" type="url" {...register('personalInfo.linkedinUrl')} /></label>
            <label>GitHub URL<input autoComplete="url" placeholder="https://github.com/you" type="url" {...register('personalInfo.githubUrl')} /></label>
            <label>Portfolio URL<input autoComplete="url" placeholder="https://yourportfolio.com" type="url" {...register('personalInfo.portfolioUrl')} /></label>
          </div>
        </section>

        <section className="editor-section" aria-labelledby="experience-title">
          <div className="editor-section-heading">
            <h3 id="experience-title">Work experience</h3>
            <button
              className="editor-add-button"
              onClick={() => experience.append({
                company: '',
                position: '',
                title: '',
                startDate: '',
                endDate: '',
                isCurrent: false,
                bullets: [],
              })}
              type="button"
            >
              Add experience
            </button>
          </div>
          {experience.fields.map((field, index) => (
            <fieldset className="editor-repeat-item" key={field.id}>
              <legend>Experience {index + 1}</legend>
              <button className="editor-remove-button" onClick={() => experience.remove(index)} type="button">
                Remove
              </button>
              <div className="editor-field-grid">
                <label>Position<input {...register(`workExperience.${index}.position`)} /></label>
                <label>Title<input {...register(`workExperience.${index}.title`)} /></label>
                <label>Company<input {...register(`workExperience.${index}.company`)} /></label>
                <label>Start date<input placeholder="e.g. Jan 2022" {...register(`workExperience.${index}.startDate`)} /></label>
                <label>End date<input disabled={values.workExperience?.[index]?.isCurrent} {...register(`workExperience.${index}.endDate`)} /></label>
              </div>
              <label className="editor-current-role">
                <input type="checkbox" {...register(`workExperience.${index}.isCurrent`)} />
                This is my current role
              </label>
              <ExperienceFields control={control} index={index} register={register} />
            </fieldset>
          ))}
        </section>

        <section className="editor-section" aria-labelledby="education-title">
          <div className="editor-section-heading">
            <h3 id="education-title">Education</h3>
            <button
              className="editor-add-button"
              onClick={() => education.append({
                institution: '',
                award: '',
                fieldOfStudy: '',
                graduationYear: '',
              })}
              type="button"
            >
              Add education
            </button>
          </div>
          {education.fields.map((field, index) => (
            <fieldset className="editor-repeat-item" key={field.id}>
              <legend>Education {index + 1}</legend>
              <button className="editor-remove-button" onClick={() => education.remove(index)} type="button">
                Remove
              </button>
              <div className="editor-field-grid">
                <label>Institution<input {...register(`education.${index}.institution`)} /></label>
                <label>Award<input {...register(`education.${index}.award`)} /></label>
                <label>Field of study<input {...register(`education.${index}.fieldOfStudy`)} /></label>
                <label>Graduation year<input inputMode="numeric" {...register(`education.${index}.graduationYear`)} /></label>
              </div>
            </fieldset>
          ))}
        </section>

        <section className="editor-section">
          <h3>Skills</h3>
          <label htmlFor="resume-skills">Separate skills with commas</label>
          <textarea id="resume-skills" rows={3} {...register('skillsText')} />
        </section>

        <div className="editor-footer">
          <p>PDF is recommended for consistent ATS-friendly formatting.</p>
          <button className="editor-primary-button" disabled={saving || exporting} type="submit">
            {saving ? 'Saving…' : resume ? 'Save changes' : 'Create resume'}
          </button>
        </div>
      </form>
      {previewOpen && (
        <ResumePreview
          onClose={() => setPreviewOpen(false)}
          onDownload={resume ? () => { void handleSubmit(exportPdf)() } : undefined}
          resume={{
            ...toResumeInput(getValues()),
            template: templateDesign(selectedTemplate),
          }}
          template={selectedTemplate}
        />
      )}
    </section>
  )
}
