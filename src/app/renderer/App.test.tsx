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

  it('shows the embedded Chromium version and reports the page area to main', async () => {
    const { api } = fakeApi()
    render(<App />)
    expect(screen.getByTestId('content').textContent).toContain('Chromium 140.0.0.0')
    expect(api.navigation.setInsets).toHaveBeenCalledWith(
      expect.objectContaining({ top: 0, left: 0 }),
    )
    expect(await screen.findByRole('button', { name: 'Open prompt' })).toBeTruthy()
  })
})
