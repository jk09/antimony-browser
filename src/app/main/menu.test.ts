import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { appMenuTemplate } from './menu'

const openLocation: MenuItemConstructorOptions = { id: 'open-location', label: 'Open Location…' }
const labels = (menu: MenuItemConstructorOptions[]) => menu.map((item) => item.role ?? item.label)
const noZoom = () => {}

describe('appMenuTemplate', () => {
  it('puts feature items first in the File menu, then quit', () => {
    const [file] = appMenuTemplate([openLocation], 'linux', noZoom)
    expect(file!.label).toBe('File')
    expect(labels(file!.submenu as MenuItemConstructorOptions[])).toEqual([
      'Open Location…',
      undefined,
      'quit',
    ])
  })

  it('keeps the standard Edit and Window menus and its own View menu', () => {
    expect(labels(appMenuTemplate([], 'win32', noZoom))).toEqual([
      'File',
      'editMenu',
      'View',
      'windowMenu',
    ])
  })

  it('adds the app menu and closes instead of quitting on macOS', () => {
    const menu = appMenuTemplate([], 'darwin', noZoom)
    expect(labels(menu)).toEqual(['appMenu', 'File', 'editMenu', 'View', 'windowMenu'])
    expect(labels(menu[1]!.submenu as MenuItemConstructorOptions[])).toEqual(['close'])
  })

  it('zooms the chrome UI from the View menu and the usual zoom keys', () => {
    const zoom = vi.fn()
    const view = appMenuTemplate([], 'linux', zoom)[2]!.submenu as MenuItemConstructorOptions[]
    expect(labels(view.filter((item) => item.visible !== false))).toEqual([
      'reload',
      'forceReload',
      'toggleDevTools',
      undefined,
      'Actual Size',
      'Zoom In',
      'Zoom Out',
      undefined,
      'togglefullscreen',
    ])
    const directions = Object.fromEntries(
      view
        .filter((item) => item.accelerator)
        .map((item) => {
          zoom.mockClear()
          ;(item.click as () => void)()
          return [item.accelerator, zoom.mock.calls[0]![0]]
        }),
    )
    expect(directions).toEqual({
      'CommandOrControl+0': 0,
      'CommandOrControl+num0': 0,
      'CommandOrControl+Plus': 1,
      'CommandOrControl+=': 1,
      'CommandOrControl+numadd': 1,
      'CommandOrControl+-': -1,
      'CommandOrControl+numsub': -1,
    })
  })
})
