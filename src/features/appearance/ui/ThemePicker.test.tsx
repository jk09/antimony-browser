// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, sampleTheme } from '../../../app/renderer/fake-api'
import { AppearanceView } from './AppearanceView'
import { applyTheme } from './apply'
import { ThemeApplier } from './ThemeApplier'
import { ThemePicker } from './ThemePicker'

const root = () => document.documentElement
const panelBg = () => root().style.getPropertyValue('--panel-bg')

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  )
})
afterEach(() => {
  cleanup()
  applyTheme(null)
  vi.unstubAllGlobals()
})

describe('applyTheme and ThemeApplier', () => {
  it('applies the stored theme and follows changes, back to the system default', async () => {
    const { emit } = fakeApi({ theme: sampleTheme() })
    render(<ThemeApplier />)
    await waitFor(() => expect(panelBg()).toBe('#f7f5f0'))
    expect(root().style.getPropertyValue('color-scheme')).toBe('light')
    expect(root().style.getPropertyValue('--card-border')).toBe('rgba(38, 40, 43, 0.14)')
    await act(async () => emit.themeChanged(null))
    expect(panelBg()).toBe('')
    expect(root().style.getPropertyValue('color-scheme')).toBe('')
  })
})

describe('ThemePicker', () => {
  it('generates themes, captures each applied in turn, restores the current theme and shows the screenshots', async () => {
    const { api } = fakeApi()
    const seen: string[] = []
    api.appearance.capture.mockImplementation(async () => {
      seen.push(root().dataset['theme'] ?? 'none')
      return `data:image/jpeg;base64,${seen.length}`
    })
    render(<ThemePicker />)
    fireEvent.change(screen.getByLabelText('Describe what you need'), {
      target: { value: 'a light theme suitable for astigmatism' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show themes' }))
    const gallery = await screen.findByRole('radiogroup', { name: 'Themes' })
    expect(api.appearance.generate).toHaveBeenCalledWith('a light theme suitable for astigmatism')
    expect(seen).toEqual(['Soft daylight', 'Warm paper'])
    // Nothing stays applied after capturing.
    expect(panelBg()).toBe('')
    const cards = within(gallery).getAllByRole('radio')
    expect(cards.map((card) => card.querySelector('img')!.getAttribute('alt'))).toEqual([
      'The browser in Soft daylight, light · lowest text contrast 7.1:1',
      'The browser in Warm paper, light · lowest text contrast 6.4:1',
    ])
    fireEvent.click(cards[1]!)
    await waitFor(() => expect(api.appearance.set).toHaveBeenCalledWith(sampleTheme('Warm paper')))
    await waitFor(() => expect(cards[1]!.getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Use system default' }))
    await waitFor(() => expect(api.appearance.set).toHaveBeenLastCalledWith(null))
  })

  it('offers usability needs as one-click suggestions', async () => {
    const { api } = fakeApi()
    render(<ThemePicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Dark, low glare' }))
    await screen.findByRole('radiogroup', { name: 'Themes' })
    expect(api.appearance.generate).toHaveBeenCalledWith(
      'a dark theme with low glare for light sensitivity',
    )
  })

  it('shows what went wrong and tries again, leaving the stored theme applied', async () => {
    const { api } = fakeApi({ theme: sampleTheme('Mine') })
    render(
      <>
        <ThemeApplier />
        <ThemePicker initialDescription="calm" />
      </>,
    )
    api.appearance.generate.mockRejectedValueOnce(new Error('Claude Code CLI not found.'))
    fireEvent.click(screen.getByRole('button', { name: 'Show themes' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Claude Code CLI not found.')
    api.appearance.capture.mockRejectedValueOnce(new Error('capture failed'))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect((await screen.findByRole('alert')).textContent).toContain('capture failed')
    expect(root().dataset['theme']).toBe('Mine')
  })
})

describe('AppearanceView', () => {
  it('opens over the page area with the need filled in and generating, and closes with Escape', async () => {
    const { api, emit } = fakeApi()
    render(<AppearanceView />)
    expect(screen.queryByRole('region', { name: 'Appearance' })).toBeNull()
    await act(async () => emit.appearanceOpen({ description: 'high contrast' }))
    await screen.findByRole('radiogroup', { name: 'Themes' })
    expect((screen.getByLabelText('Describe what you need') as HTMLInputElement).value).toBe(
      'high contrast',
    )
    expect(api.appearance.generate).toHaveBeenCalledWith('high contrast')
    fireEvent.keyDown(screen.getByRole('region', { name: 'Appearance' }), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Appearance' })).toBeNull()

    await act(async () => emit.appearanceOpen({ description: '' }))
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeTruthy()
    expect(api.appearance.generate).toHaveBeenCalledTimes(1)
  })
})
