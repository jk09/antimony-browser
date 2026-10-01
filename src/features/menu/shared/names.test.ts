import { describe, expect, it } from 'vitest'
import {
  cleanLabel,
  formatAccelerator,
  nameOf,
  resolve,
  uniqueNames,
  type NamedNode,
} from './names'

describe('names', () => {
  it('removes mnemonics from labels', () => {
    expect(cleanLabel('&File')).toBe('File')
    expect(cleanLabel('Save && &Quit')).toBe('Save & Quit')
  })

  it('turns labels into names', () => {
    expect(nameOf('Zoom In')).toBe('zoom-in')
    expect(nameOf('Open Location…')).toBe('open-location')
    expect(nameOf('Toggle &Developer Tools...')).toBe('toggle-developer-tools')
    expect(nameOf('…')).toBe('item')
  })

  it('numbers repeated names among siblings', () => {
    expect(uniqueNames(['Zoom', 'zoom', 'Other', 'Zoom'])).toEqual([
      'zoom',
      'zoom-2',
      'other',
      'zoom-3',
    ])
  })

  it('formats accelerators for the platform', () => {
    expect(formatAccelerator('CommandOrControl+Plus', 'linux')).toBe('Ctrl+Plus')
    expect(formatAccelerator('CmdOrCtrl+Shift+I', 'darwin')).toBe('Cmd+Shift+I')
    expect(formatAccelerator('Alt+F4', 'win32')).toBe('Alt+F4')
    expect(formatAccelerator('Alt+Command+I', 'darwin')).toBe('Option+Cmd+I')
  })
})

describe('resolve', () => {
  type Node = NamedNode<Node>
  const tree: Node[] = [
    {
      name: 'view',
      label: 'View',
      enabled: true,
      children: [
        { name: 'zoom-in', label: 'Zoom In', enabled: true },
        { name: 'locked', label: 'Locked', enabled: false },
      ],
    },
    { name: 'edit', label: 'Edit', enabled: true, children: [] },
  ]

  it('finds an item by names, ignoring case', () => {
    expect(resolve(tree, ['View', 'zoom-in'])).toEqual({
      item: tree[0]!.children![0],
      labels: ['View', 'Zoom In'],
    })
  })

  it('lists the choices for an unknown name or a submenu', () => {
    expect(resolve(tree, ['file'])).toEqual({
      error: 'No “file” among the menus. Pick one of: view, edit.',
    })
    expect(resolve(tree, ['view', 'zoom'])).toEqual({
      error: 'No “zoom” in View. Pick one of: zoom-in, locked.',
    })
    expect(resolve(tree, ['view'])).toEqual({
      error: 'View has items. Pick one of: zoom-in, locked.',
    })
  })

  it('rejects disabled items and paths past an item', () => {
    expect(resolve(tree, ['view', 'locked'])).toEqual({ error: 'View › Locked is disabled.' })
    expect(resolve(tree, ['view', 'zoom-in', 'more'])).toEqual({
      error: 'View › Zoom In has no items.',
    })
  })
})
