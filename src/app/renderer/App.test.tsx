// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
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
})
