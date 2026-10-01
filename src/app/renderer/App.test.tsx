// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { fakeApi } from './fake-api'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

describe('App', () => {
  afterEach(cleanup)

  it('shows the page area with the assistant panel on its right, and no toolbar', async () => {
    const { api } = fakeApi()
    render(<App />)
    expect(screen.getByTestId('content').textContent).toContain('Chromium 140.0.0.0')
    expect(api.navigation.setInsets).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0, left: 0 }),
    )
    const panel = await screen.findByRole('complementary', { name: 'Assistant' })
    expect(
      screen.getByTestId('content').compareDocumentPosition(panel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeTruthy()
    expect(screen.queryByTestId('toolbar')).toBeNull()
  })

  it('reports the page area again when the chrome UI is zoomed, even with the same insets', () => {
    const { api } = fakeApi()
    render(<App />)
    const calls = vi.mocked(api.navigation.setInsets).mock.calls.length
    act(() => window.dispatchEvent(new Event('resize')))
    expect(api.navigation.setInsets).toHaveBeenCalledTimes(calls)
    const ratio = window.devicePixelRatio
    try {
      Object.defineProperty(window, 'devicePixelRatio', { value: ratio * 0.5, configurable: true })
      act(() => window.dispatchEvent(new Event('resize')))
      expect(api.navigation.setInsets).toHaveBeenCalledTimes(calls + 1)
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true })
    }
  })
})
