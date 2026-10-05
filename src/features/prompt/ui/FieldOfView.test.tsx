// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeApi } from '../../../app/renderer/fake-api'
import { AssistantPanel } from './AssistantPanel'
import { FLIGHT_MS } from './FieldOfView'
import { HANDOFF_MS } from './Prompt'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))

const overlay = () => screen.queryByRole('dialog', { name: 'Field of view prompt' })
const boxes = () => screen.getAllByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement[]

async function open(snapshot: string | null = null, options: Parameters<typeof fakeApi>[0] = {}) {
  const fake = fakeApi(options)
  fake.api.prompt.coverPage = vi.fn(async () => snapshot)
  render(<AssistantPanel />)
  await act(async () => {})
  await act(async () => fake.emit.fieldOfView())
  return fake
}

describe('FieldOfView', () => {
  it('opens on Ctrl/Cmd+I with the page covered, its snapshot shown and the prompt focused', async () => {
    const { api } = await open('data:image/jpeg;base64,AAAA')
    expect(api.prompt.coverPage).toHaveBeenCalledOnce()
    expect(overlay()).toBeTruthy()
    expect(overlay()!.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA')
    // The same prompt as the sidebar's: two of them now.
    expect(boxes()).toHaveLength(2)
    expect(document.activeElement).toBe(boxes()[1])
  })

  it('opens without a backdrop when there is no snapshot', async () => {
    await open(null)
    expect(overlay()).toBeTruthy()
    expect(overlay()!.querySelector('img')).toBeNull()
  })

  it('closes on Escape, on Ctrl/Cmd+I again and on a click outside the card, uncovering the page', async () => {
    const { api, emit } = await open()
    fireEvent.keyDown(boxes()[1]!, { key: 'Escape' })
    expect(overlay()).toBeNull()
    expect(api.prompt.uncoverPage).toHaveBeenCalledTimes(1)
    expect(api.prompt.focusPage).toHaveBeenCalledOnce()

    await act(async () => emit.fieldOfView())
    expect(overlay()).toBeTruthy()
    await act(async () => emit.fieldOfView())
    expect(overlay()).toBeNull()
    expect(api.prompt.uncoverPage).toHaveBeenCalledTimes(2)

    await act(async () => emit.fieldOfView())
    fireEvent.pointerDown(overlay()!.querySelector('.fov-dim')!)
    expect(overlay()).toBeNull()
    expect(api.prompt.uncoverPage).toHaveBeenCalledTimes(3)
  })

  it('closes when the sidebar prompt is opened (Ctrl/Cmd+L, Ctrl/Cmd+Alt+I)', async () => {
    const { api, emit } = await open()
    act(() => emit.open())
    expect(overlay()).toBeNull()
    expect(api.prompt.uncoverPage).toHaveBeenCalledOnce()
  })

  it('hands a question to the sidebar prompt after flying to it, then closes', async () => {
    // jsdom has no layout: the card is 600 wide in the page, the sidebar's prompt 300 wide.
    const rect = (left: number, top: number, width: number) =>
      ({ left, top, width, height: 100, right: left + width, bottom: top + 100 }) as DOMRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this.closest('.assistant-panel') ? rect(900, 600, 300) : rect(100, 200, 600)
    })
    const { api } = await open()
    fireEvent.change(boxes()[1]!, { target: { value: 'what is this page?' } })
    fireEvent.keyDown(boxes()[1]!, { key: 'Enter' })
    // Nothing runs from the field of view itself; it is flying.
    expect(api.agent.run).not.toHaveBeenCalled()
    expect(overlay()).toBeTruthy()
    expect(overlay()!.querySelector<HTMLElement>('.fov-card')!.style.transform).toBe(
      'translate(650px, 400px) scale(0.5)',
    )
    // Landed: the entry is copied into the sidebar prompt, which has not run it yet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLIGHT_MS + 30)
    })
    expect(overlay()).toBeNull()
    expect(api.prompt.uncoverPage).toHaveBeenCalledOnce()
    expect(boxes()).toHaveLength(1)
    expect(boxes()[0]!.value).toBe('what is this page?')
    expect(api.agent.run).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HANDOFF_MS + 50)
    })
    expect(api.agent.run).toHaveBeenCalledExactlyOnceWith({
      text: 'what is this page?',
      attachments: [],
    })
    expect(boxes()).toHaveLength(1)
    expect(boxes()[0]!.value).toBe('')
  })

  it('hands URLs and commands over too, and shows a hidden sidebar first', async () => {
    const { api, emit } = await open()
    act(() => emit.toggle())
    expect(screen.queryByRole('complementary', { name: 'Assistant' })).toBeNull()
    fireEvent.change(boxes()[0]!, { target: { value: 'example.com' } })
    fireEvent.keyDown(boxes()[0]!, { key: 'Enter' })
    expect(screen.getByRole('complementary', { name: 'Assistant' })).toBeTruthy()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLIGHT_MS + HANDOFF_MS + 100)
    })
    expect(api.navigation.go).toHaveBeenCalledWith('https://example.com/')
  })

  it('hands a stack or page picked alone over in one click, and the sidebar goes there', async () => {
    const stacks = {
      current: null,
      stacks: [{ id: 's1', name: 'docs', rootTitle: 'Docs', pages: 2, audio: null }],
    }
    const stackPages = [
      {
        id: 's1',
        name: 'docs',
        rootTitle: 'Docs',
        activeId: 1,
        rows: [
          { id: 1, url: 'https://d.example/', title: 'Docs', depth: 0, last: false, ref: 'docs' },
          { id: 2, url: 'https://d.example/g', title: 'Guide', depth: 0, last: true, ref: 'guide' },
        ],
      },
    ]
    const { api } = await open(null, { stacks, stackPages })
    fireEvent.change(boxes()[1]!, { target: { value: '@gui' } })
    const page = await screen.findByRole('option', { name: /^Page Guide/ })
    fireEvent.click(page)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLIGHT_MS + HANDOFF_MS + 100)
    })
    expect(api.stacks.openPage).toHaveBeenCalledWith('s1', 2)
    expect(api.agent.run).not.toHaveBeenCalled()
  })

  it('sends nothing for an empty entry', async () => {
    const { api } = await open()
    fireEvent.keyDown(boxes()[1]!, { key: 'Enter' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FLIGHT_MS + HANDOFF_MS + 100)
    })
    expect(overlay()).toBeTruthy()
    expect(api.agent.run).not.toHaveBeenCalled()
  })

  it('shows the page again if it is closed before the snapshot arrives', async () => {
    const fake = fakeApi()
    let resolve!: (value: string | null) => void
    fake.api.prompt.coverPage = vi.fn(() => new Promise<string | null>((r) => (resolve = r)))
    render(<AssistantPanel />)
    await act(async () => {})
    await act(async () => fake.emit.fieldOfView())
    await act(async () => fake.emit.fieldOfView())
    await act(async () => resolve('data:x'))
    expect(overlay()).toBeNull()
    expect(fake.api.prompt.uncoverPage).toHaveBeenCalled()
  })
})
