import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResumePreview } from './ResumePreview'
import { BUILT_IN_TEMPLATES } from './template-types'

afterEach(cleanup)

describe('resume preview', () => {
  it('shows placeholders for missing information with the selected template layout', () => {
    render(
      <ResumePreview
        onClose={vi.fn()}
        resume={{
          title: 'My Resume',
          personalInfo: {
            fullName: null,
            email: null,
            phone: null,
            location: null,
            linkedinUrl: null,
            githubUrl: null,
          },
          workExperience: [],
          education: [],
          skills: [],
        }}
        template={BUILT_IN_TEMPLATES[1]!}
      />,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Your name')).toBeInTheDocument()
    expect(screen.getByText('Email address')).toBeInTheDocument()
    expect(screen.getByText('Job title')).toBeInTheDocument()
    expect(screen.getByText('Company')).toBeInTheDocument()
    expect(screen.getByText('School or institution')).toBeInTheDocument()
    expect(screen.getByText('Add your skills here')).toBeInTheDocument()
    expect(screen.getByLabelText('Resume preview')).toHaveClass('cv-preview-two-column')
  })

  it('allows closing the preview and exposes edit and download actions', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onEdit = vi.fn()
    const onDownload = vi.fn()
    render(
      <ResumePreview
        onClose={onClose}
        onDownload={onDownload}
        onEdit={onEdit}
        resume={{
          title: 'Ada Resume',
          personalInfo: {
            fullName: 'Ada Lovelace',
            email: 'ada@example.com',
            phone: null,
            location: null,
            linkedinUrl: null,
            githubUrl: null,
          },
          workExperience: [],
          education: [],
          skills: [],
        }}
        template={BUILT_IN_TEMPLATES[0]!}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit resume' }))
    await user.click(screen.getByRole('button', { name: 'Download PDF' }))
    await user.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onDownload).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
