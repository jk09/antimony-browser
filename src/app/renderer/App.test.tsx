// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  afterEach(cleanup)

  it('shows the embedded Chromium version', () => {
    window.antimony = { versions: { chrome: '140.0.0.0', electron: '44.0.0' } }
    render(<App />)
    expect(screen.getByTestId('content').textContent).toContain('Chromium 140.0.0.0')
  })
})
