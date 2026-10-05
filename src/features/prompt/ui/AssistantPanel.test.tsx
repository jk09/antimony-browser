// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi, idleState } from '../../../app/renderer/fake-api'
import { AssistantPanel, clampWidth, DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH } from './AssistantPanel'

afterEach(cleanup)

async function renderPanel() {
  const fake = fakeApi()
  render(<AssistantPanel conversation={<section aria-label="Conversation">Hello</section>} />)
  await act(async () => {})
  return fake
}

const panel = () => screen.queryByRole('complementary', { name: 'Assistant' })

describe('AssistantPanel', () => {
  it('is shown at start, with no conversation area until there is a conversation', async () => {
    const { emit } = await renderPanel()
    expect(panel()).toBeTruthy()
    expect(screen.queryByText(/Ask about this page/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Conversation' })).toBeNull()
    act(() => emit.state({ ...idleState, items: [{ kind: 'user', text: 'hi', attachments: [] }] }))
    expect(screen.getByRole('region', { name: 'Conversation' })).toBeTruthy()
  })

  it('stacks header, conversation and prompt, with suggestions above the input', async () => {
    const { emit } = await renderPanel()
    act(() => emit.state({ ...idleState, items: [{ kind: 'user', text: 'hi', attachments: [] }] }))
    const box = screen.getByRole('textbox', { name: 'Prompt' })
    fireEvent.change(box, { target: { value: '/re' } })
    const order = [
      screen.getByTestId('page-info'),
      screen.getByRole('region', { name: 'Conversation' }),
      screen.getByRole('listbox'),
      box,
    ]
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
  })

  it('has no close button: it is only hidden', async () => {
    await renderPanel()
    expect(screen.queryByRole('button', { name: /hide|close/i })).toBeNull()
  })

  it('hides with Ctrl/Cmd+B and shows again with Ctrl/Cmd+L, focusing the prompt', async () => {
    const { emit } = await renderPanel()
    act(() => emit.toggle())
    expect(panel()).toBeNull()
    act(() => emit.open())
    expect(panel()).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Prompt' }))
  })

  it('toggles with Ctrl/Cmd+B: hiding focuses the page, showing focuses the prompt', async () => {
    const { api, emit } = await renderPanel()
    act(() => emit.toggle())
    expect(panel()).toBeNull()
    expect(api.prompt.focusPage).toHaveBeenCalledOnce()
    act(() => emit.toggle())
    expect(panel()).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Prompt' }))
    expect(api.prompt.focusPage).toHaveBeenCalledOnce()
  })

  it('toggles every time, even when toggles arrive before a render', async () => {
    const { emit } = await renderPanel()
    act(() => {
      emit.toggle()
      emit.toggle()
    })
    expect(panel()).toBeTruthy()
    act(() => {
      emit.toggle()
      emit.toggle()
      emit.toggle()
    })
    expect(panel()).toBeNull()
    act(() => emit.toggle())
    expect(panel()).toBeTruthy()
  })

  it('stays shown on Ctrl/Cmd+B while an approval is pending', async () => {
    const { api, emit } = await renderPanel()
    act(() =>
      emit.state({ ...idleState, status: 'awaiting-approval', approval: { description: 'Click' } }),
    )
    act(() => emit.toggle())
    expect(panel()).toBeTruthy()
    expect(api.prompt.focusPage).not.toHaveBeenCalled()
    act(() => emit.state(idleState))
    act(() => emit.toggle())
    expect(panel()).toBeNull()
  })

  it('shows itself for an approval', async () => {
    const { emit } = await renderPanel()
    act(() => emit.toggle())
    act(() =>
      emit.state({ ...idleState, status: 'awaiting-approval', approval: { description: 'Click' } }),
    )
    expect(panel()).toBeTruthy()
  })

  it('resizes with the arrow keys on its edge, within the limits', async () => {
    await renderPanel()
    const edge = screen.getByRole('separator', { name: 'Resize assistant' })
    expect(panel()!.style.flexBasis).toBe(`${DEFAULT_WIDTH}px`)
    fireEvent.keyDown(edge, { key: 'ArrowLeft' })
    expect(panel()!.style.flexBasis).toBe(`${DEFAULT_WIDTH + 16}px`)
    fireEvent.keyDown(edge, { key: 'ArrowRight' })
    fireEvent.keyDown(edge, { key: 'ArrowRight' })
    expect(edge.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH - 16))
    for (let i = 0; i < 40; i++) fireEvent.keyDown(edge, { key: 'ArrowRight' })
    expect(panel()!.style.flexBasis).toBe(`${MIN_WIDTH}px`)
  })

  it('clamps widths to its limits', () => {
    expect(clampWidth(0)).toBe(MIN_WIDTH)
    expect(clampWidth(450.4)).toBe(450)
    expect(clampWidth(5000)).toBe(MAX_WIDTH)
  })
})
