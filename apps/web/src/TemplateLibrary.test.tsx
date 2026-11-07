import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateLibrary } from './TemplateLibrary'
import { BUILT_IN_TEMPLATES } from './template-types'

afterEach(cleanup)

describe('template library', () => {
  it('creates a custom template from font, color, size, and layout choices', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn().mockResolvedValue(undefined)
    render(
      <TemplateLibrary
        error=""
        onCreate={onCreate}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onUse={vi.fn()}
        saving={false}
        templates={BUILT_IN_TEMPLATES}
      />,
    )

    await user.type(screen.getByLabelText('Template name'), 'Product designer')
    await user.selectOptions(screen.getByLabelText('Font'), 'Times-Roman')
    await user.selectOptions(screen.getByLabelText('Font size'), '11')
    await user.selectOptions(screen.getByLabelText('Layout'), 'two-column')
    await user.click(screen.getByRole('button', { name: 'Save template' }))

    expect(onCreate).toHaveBeenCalledWith({
      name: 'Product designer',
      fontFamily: 'Times-Roman',
      fontSize: 11,
      accentColor: '#365fce',
      textColor: '#17213a',
      backgroundColor: '#ffffff',
      layout: 'two-column',
    })
  })

  it('lets a user start with a built-in template', async () => {
    const user = userEvent.setup()
    const onUse = vi.fn()
    render(
      <TemplateLibrary
        error=""
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onUse={onUse}
        saving={false}
        templates={BUILT_IN_TEMPLATES}
      />,
    )

    await user.click(screen.getAllByRole('button', { name: 'Use template' })[0]!)
    expect(onUse).toHaveBeenCalledWith(BUILT_IN_TEMPLATES[0])
  })
})
