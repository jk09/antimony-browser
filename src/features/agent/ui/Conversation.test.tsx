// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi, idleState } from '../../../app/renderer/fake-api'
import { ActingFrame } from './ActingFrame'
import { Conversation } from './Conversation'

afterEach(cleanup)

describe('Conversation', () => {
  it('renders nothing for an empty conversation', async () => {
    fakeApi()
    const { container } = render(<Conversation />)
    await act(async () => {})
    expect(container.textContent).toBe('')
  })

  it('shows turns and tool steps, and offers to save a run with steps', async () => {
    const { api, emit } = fakeApi()
    render(<Conversation />)
    act(() =>
      emit.state({
        ...idleState,
        savableSteps: 2,
        items: [
          { kind: 'user', text: 'open news', attachments: [{ kind: 'image', name: 'a.png' }] },
          { kind: 'tool', tool: 'navigate', summary: 'Open news.example', status: 'ok' },
          {
            kind: 'tool',
            tool: 'click',
            summary: 'Click link',
            status: 'error',
            detail: 'Not found',
          },
          { kind: 'assistant', text: 'Here is the news.' },
        ],
      }),
    )
    const text = screen.getByRole('region', { name: 'Conversation' }).textContent
    expect(text).toContain('open news')
    expect(text).toContain('a.png')
    expect(text).toContain('Open news.example')
    expect(text).toContain('Not found')
    expect(text).toContain('Here is the news.')
    fireEvent.click(screen.getByRole('button', { name: 'Save as skill (2 steps)' }))
    expect(api.skills.requestSave).toHaveBeenCalled()
  })

  it('asks for approval and sends the decision', async () => {
    const { api, emit } = fakeApi()
    render(<Conversation />)
    act(() =>
      emit.state({
        status: 'awaiting-approval',
        items: [{ kind: 'approval', description: 'Click button "Buy"', decision: null }],
        approval: { description: 'Click button "Buy"' },
        savableSteps: 0,
      }),
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Approve action' })
    expect(dialog.textContent).toContain('Click button "Buy"')
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(api.agent.approve).toHaveBeenCalledWith('deny')
    fireEvent.click(screen.getByRole('button', { name: 'Allow for this run' }))
    expect(api.agent.approve).toHaveBeenCalledWith('allow-run')
  })
})

describe('ActingFrame', () => {
  it('frames the page while the assistant is acting', () => {
    const { emit } = fakeApi()
    render(<ActingFrame>page</ActingFrame>)
    const frame = screen.getByTestId('acting-frame')
    expect(frame.className).not.toContain('acting ')
    act(() => emit.state({ ...idleState, status: 'running' }))
    expect(frame.classList.contains('acting')).toBe(true)
  })
})
