import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const theme = Object.assign(new EventEmitter(), { shouldUseDarkColors: false })
const missing = new Set<string>()
vi.mock('electron', () => ({
  app: { getAppPath: () => '/app' },
  nativeTheme: theme,
  nativeImage: {
    createFromPath: (path: string) => ({ path, isEmpty: () => missing.has(path) }),
  },
}))

const { applyAppIcon, iconPath } = await import('./app-icon')

const light = join('/app', 'resources/icons', 'antimony-light.png')
const dark = join('/app', 'resources/icons', 'antimony-dark.png')

function fakeWindow() {
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    setIcon: vi.fn(),
  })
  applyAppIcon(window as unknown as BrowserWindow)
  const shown = () => window.setIcon.mock.calls.map(([image]) => (image as { path: string }).path)
  return { window, shown }
}

describe('app icon', () => {
  beforeEach(() => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    theme.removeAllListeners()
    theme.shouldUseDarkColors = false
    missing.clear()
  })

  it('names the PNG for each theme in the app folder', () => {
    expect(iconPath(false, '/app')).toBe(light)
    expect(iconPath(true, '/app')).toBe(dark)
  })

  it('shows the light icon in a light system theme and the dark one in a dark theme', () => {
    expect(fakeWindow().shown()).toEqual([light])
    theme.shouldUseDarkColors = true
    expect(fakeWindow().shown()).toEqual([dark])
  })

  it('swaps the icon when the system theme changes, and only then', () => {
    const { shown } = fakeWindow()
    theme.emit('updated')
    theme.shouldUseDarkColors = true
    theme.emit('updated')
    theme.emit('updated')
    theme.shouldUseDarkColors = false
    theme.emit('updated')
    expect(shown()).toEqual([light, dark, light])
  })

  it('keeps the current icon when a file is missing', () => {
    missing.add(dark)
    const { shown } = fakeWindow()
    theme.shouldUseDarkColors = true
    expect(() => theme.emit('updated')).not.toThrow()
    expect(shown()).toEqual([light])
  })

  it('stops following the theme once the window is closed', () => {
    const { window } = fakeWindow()
    window.emit('closed')
    expect(theme.listenerCount('updated')).toBe(0)
  })
})
