import { useState, type CSSProperties, type FormEvent } from 'react'
import type { ResumeTemplate } from './template-types'
import './TemplateLibrary.css'

type Props = {
  templates: ResumeTemplate[]
  saving: boolean
  error: string
  onCreate: (template: Omit<ResumeTemplate, 'id' | 'isBuiltIn'>) => Promise<void>
  onUse: (template: ResumeTemplate) => void
  onDelete: (templateId: string) => Promise<void>
}

const initialForm = {
  name: '',
  fontFamily: 'Helvetica' as ResumeTemplate['fontFamily'],
  fontSize: 10,
  accentColor: '#365fce',
  textColor: '#17213a',
  backgroundColor: '#ffffff',
  layout: 'single-column' as ResumeTemplate['layout'],
}

function TemplateCard({
  template,
  onUse,
  onDelete,
}: {
  template: ResumeTemplate
  onUse: () => void
  onDelete?: () => void
}) {
  return (
    <article className="template-card">
      <div
        className={`template-preview template-preview-${template.layout}`}
        style={{
          '--template-accent': template.accentColor,
          '--template-text': template.textColor,
          '--template-paper': template.backgroundColor,
          '--template-font': template.fontFamily,
          '--template-size': `${template.fontSize}px`,
        } as CSSProperties}
        aria-hidden="true"
      >
        <div className="template-preview-page">
          <div className="template-preview-name" />
          <div className="template-preview-contact" />
          <div className="template-preview-body">
            <div className="template-preview-side">
              <i /><i /><i />
            </div>
            <div className="template-preview-main">
              <b /><i /><i /><i /><i />
            </div>
          </div>
        </div>
      </div>
      <div className="template-card-details">
        <div>
          <h3>{template.name}</h3>
          <p>{template.isBuiltIn ? 'Ready to use' : 'Your template'} · {template.layout === 'single-column' ? 'Single column' : 'Two columns'}</p>
        </div>
        <button className="template-use-button" onClick={onUse} type="button">Use template</button>
      </div>
      {onDelete && (
        <button className="template-delete-button" onClick={onDelete} type="button">
          Delete template
        </button>
      )}
    </article>
  )
}

export function TemplateLibrary({ templates, saving, error, onCreate, onUse, onDelete }: Props) {
  const [form, setForm] = useState(initialForm)
  const [formError, setFormError] = useState('')

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    if (!form.name.trim()) {
      setFormError('Enter a name for your template.')
      return
    }

    try {
      await onCreate({ ...form, name: form.name.trim() })
      setForm(initialForm)
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : 'We couldn’t save this template.')
    }
  }

  const builtInTemplates = templates.filter((template) => template.isBuiltIn)
  const customTemplates = templates.filter((template) => !template.isBuiltIn)

  return (
    <section className="template-library" aria-labelledby="template-library-title">
      <div className="workspace-page-heading">
        <p className="form-eyebrow">YOUR RESUME STYLE</p>
        <h1 id="template-library-title">Templates</h1>
        <p className="form-description">Choose a ready-made design or create your own. Templates style your resume without changing its content.</p>
      </div>

      {error && <p className="form-message error-message" role="alert">{error}</p>}

      <section className="template-section" aria-labelledby="built-in-templates-title">
        <div className="workspace-section-heading">
          <div>
            <p className="workspace-section-kicker">START WITH A DESIGN</p>
            <h2 id="built-in-templates-title">Built-in templates</h2>
          </div>
        </div>
        <div className="template-grid">
          {builtInTemplates.map((template) => (
            <TemplateCard key={template.id} template={template} onUse={() => onUse(template)} />
          ))}
        </div>
      </section>

      <section className="template-section" aria-labelledby="custom-templates-title">
        <div className="workspace-section-heading">
          <div>
            <p className="workspace-section-kicker">MADE BY YOU</p>
            <h2 id="custom-templates-title">Your templates <span>{customTemplates.length}</span></h2>
          </div>
        </div>
        {customTemplates.length > 0 ? (
          <div className="template-grid">
            {customTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                onDelete={() => void onDelete(template.id)}
                onUse={() => onUse(template)}
                template={template}
              />
            ))}
          </div>
        ) : (
          <p className="template-empty">Your saved designs will appear here.</p>
        )}
      </section>

      <section className="template-create" aria-labelledby="create-template-title">
        <div className="workspace-section-heading">
          <div>
            <p className="workspace-section-kicker">MAKE IT YOURS</p>
            <h2 id="create-template-title">Create a template</h2>
          </div>
        </div>
        <form className="template-form" onSubmit={(event) => void createTemplate(event)}>
          <label>
            Template name
            <input
              maxLength={60}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="e.g. Product designer"
              value={form.name}
            />
          </label>
          <label>
            Font
            <select
              onChange={(event) => setForm({ ...form, fontFamily: event.target.value as ResumeTemplate['fontFamily'] })}
              value={form.fontFamily}
            >
              <option value="Helvetica">Helvetica</option>
              <option value="Times-Roman">Times</option>
              <option value="Courier">Courier</option>
            </select>
          </label>
          <label>
            Font size
            <select
              onChange={(event) => setForm({ ...form, fontSize: Number(event.target.value) })}
              value={form.fontSize}
            >
              {[9, 10, 11, 12].map((size) => <option key={size} value={size}>{size} pt</option>)}
            </select>
          </label>
          <label>
            Layout
            <select
              onChange={(event) => setForm({ ...form, layout: event.target.value as ResumeTemplate['layout'] })}
              value={form.layout}
            >
              <option value="single-column">Single column</option>
              <option value="two-column">Two columns</option>
            </select>
          </label>
          <label>
            Accent color
            <input
              aria-label="Accent color"
              onChange={(event) => setForm({ ...form, accentColor: event.target.value })}
              type="color"
              value={form.accentColor}
            />
          </label>
          <label>
            Text color
            <input
              aria-label="Text color"
              onChange={(event) => setForm({ ...form, textColor: event.target.value })}
              type="color"
              value={form.textColor}
            />
          </label>
          <label>
            Page color
            <input
              aria-label="Page color"
              onChange={(event) => setForm({ ...form, backgroundColor: event.target.value })}
              type="color"
              value={form.backgroundColor}
            />
          </label>
          <div className="template-form-actions">
            {formError && <p className="form-message error-message" role="alert">{formError}</p>}
            <button className="workspace-primary-button" disabled={saving} type="submit">
              {saving ? 'Saving template…' : 'Save template'}
            </button>
          </div>
        </form>
      </section>
    </section>
  )
}
