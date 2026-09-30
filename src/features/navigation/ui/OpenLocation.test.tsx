// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenLocation } from './OpenLocation'

let requestLocation: () => void
const go = vi.fn(() => Promise.resolve())

beforeEach(() => {
  window.antimony = {
    versions: { chrome: '140.0.0.0', electron: '44.0.0' },
    navigation: {
      go,
      onOpenLocation: (listener) => {
        requestLocation = listener
        return () => {}
      },
    },
  }
})

function openBox() {
  render(<OpenLocation />)
  act(() => requestLocation())
  return screen.getByRole('textbox', { name: 'Location' }) as HTMLInputElement
}

describe('OpenLocation', () => {
  afterEach(() => {
    cleanup()
    go.mockClear()
  })

  it('is hidden until File → Open Location… asks for it, then focused', () => {
    render(<OpenLocation />)
    expect(screen.queryByRole('textbox')).toBeNull()
    act(() => requestLocation())
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Location' }))
  })

  it('shows an error for invalid input without loading, and clears it on typing', () => {
    const box = openBox()
    fireEvent.change(box, { target: { value: 'javascript:alert(1)' } })
    fireEvent.submit(box)
    expect(screen.getByRole('alert').textContent).toContain('web address')
    expect(go).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: 'example.com' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('loads the normalized URL on Enter and hides', () => {
    const box = openBox()
    fireEvent.change(box, { target: { value: ' example.com ' } })
    fireEvent.submit(box)
    expect(go).toHaveBeenCalledWith('https://example.com/')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('hides on Escape without loading and starts empty next time', () => {
    const box = openBox()
    fireEvent.change(box, { target: { value: 'example.com' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(go).not.toHaveBeenCalled()
    act(() => requestLocation())
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('')
  })
})
