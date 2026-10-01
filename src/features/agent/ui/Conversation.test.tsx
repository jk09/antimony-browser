// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { fakeApi, idleState } from '../../../app/renderer/fake-api'
import { ActingFrame } from './ActingFrame'
import { Conversation } from './Conversation'

afterEach(cleanup)

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

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

  it('follows new items unless scrolled up, and follows again on a new question', async () => {
    const { emit } = fakeApi()
    render(<Conversation />)
    const say = (text: string, kind: 'assistant' | 'user' = 'assistant') =>
      kind === 'user' ? { kind, text, attachments: [] } : { kind, text }
    act(() => emit.state({ ...idleState, items: [say('one')] }))
    const list = screen.getByRole('list')
    let height = 1000
    Object.defineProperty(list, 'scrollHeight', { get: () => height })
    Object.defineProperty(list, 'clientHeight', { get: () => 200 })

    act(() => emit.state({ ...idleState, items: [say('one'), say('two')] }))
    expect(list.scrollTop).toBe(1000)

    list.scrollTop = 100
    fireEvent.scroll(list)
    height = 1200
    act(() => emit.state({ ...idleState, items: [say('one'), say('two'), say('three')] }))
    expect(list.scrollTop).toBe(100)

    height = 1400
    act(() =>
      emit.state({ ...idleState, items: [say('one'), say('two'), say('three'), say('q', 'user')] }),
    )
    expect(list.scrollTop).toBe(1400)
  })
})
