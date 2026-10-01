// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi } from '../../../app/renderer/fake-api'
import type { DebugEvent } from '../ipc'
import { addEvent, DebugPanel } from './DebugPanel'

afterEach(cleanup)

const event = (
  seq: number,
  type: DebugEvent['type'],
  title: string,
  data: unknown = {},
): DebugEvent => ({
  runId: 1,
  seq,
  type,
  title,
  at: seq * 10,
  data,
})

describe('DebugPanel', () => {
  it('is hidden until toggled, then shows the stored log and live events', async () => {
    const { api, emit } = fakeApi()
    api.agent.debugLog.mockResolvedValue([
      {
        id: 1,
        label: 'open news',
        startedAt: 0,
        events: [event(0, 'request', 'Request 1 · claude-sonnet-5-5')],
      },
    ] as never)
    render(<DebugPanel />)
    expect(screen.queryByRole('complementary', { name: 'Assistant debugger' })).toBeNull()

    act(() => emit.debugToggled())
    const panel = await screen.findByRole('complementary', { name: 'Assistant debugger' })
    await waitFor(() => expect(panel.textContent).toContain('Request 1'))

    act(() =>
      emit.debugEvent(event(1, 'tool-call', 'navigate', { url: 'news.example' }), 'open news'),
    )
    act(() =>
      emit.debugEvent(event(2, 'tool-result', 'navigate · ok', { text: 'URL: x' }), 'open news'),
    )
    expect(panel.textContent).toContain('tool-call')
    expect(panel.textContent).toContain('"url": "news.example"')
    expect(panel.textContent).toContain('+20 ms')

    fireEvent.click(screen.getByRole('button', { name: 'Close debugger' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('shows an empty state before any run', async () => {
    const { emit } = fakeApi()
    render(<DebugPanel />)
    act(() => emit.debugToggled())
    expect((await screen.findByRole('complementary')).textContent).toContain('No runs yet')
  })
})

describe('addEvent', () => {
  it('appends to the run or starts a new one, newest first', () => {
    let runs = addEvent([], event(0, 'request', 'a'), 'first')
    runs = addEvent(runs, event(1, 'response', 'b'), 'first')
    runs = addEvent(runs, { ...event(0, 'request', 'c'), runId: 2 }, 'second')
    expect(runs.map((run) => [run.id, run.label, run.events.length])).toEqual([
      [2, 'second', 1],
      [1, 'first', 2],
    ])
  })
})
