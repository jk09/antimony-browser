import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { appMenuTemplate } from './menu'

const openLocation: MenuItemConstructorOptions = { id: 'open-location', label: 'Open Location…' }
const labels = (menu: MenuItemConstructorOptions[]) => menu.map((item) => item.role ?? item.label)

describe('appMenuTemplate', () => {
  it('puts feature items first in the File menu, then quit', () => {
    const [file] = appMenuTemplate([openLocation], 'linux')
    expect(file!.label).toBe('File')
    expect(labels(file!.submenu as MenuItemConstructorOptions[])).toEqual([
      'Open Location…',
      undefined,
      'quit',
    ])
  })

  it('keeps the standard Edit, View and Window menus', () => {
    expect(labels(appMenuTemplate([], 'win32'))).toEqual([
      'File',
      'editMenu',
      'viewMenu',
      'windowMenu',
    ])
  })

  it('adds the app menu and closes instead of quitting on macOS', () => {
    const menu = appMenuTemplate([], 'darwin')
    expect(labels(menu)).toEqual(['appMenu', 'File', 'editMenu', 'viewMenu', 'windowMenu'])
    expect(labels(menu[1]!.submenu as MenuItemConstructorOptions[])).toEqual(['close'])
  })
})
