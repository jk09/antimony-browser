import { describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

interface FakeItem {
  label: string
  role?: string
  type?: string
  visible?: boolean
  enabled?: boolean
  accelerator?: string
  submenu?: { items: FakeItem[] }
  click?: (...args: unknown[]) => void
}

const item = (label: string, extra: Partial<FakeItem> = {}): FakeItem => ({
  label,
  type: extra.submenu ? 'submenu' : 'normal',
  visible: true,
  enabled: true,
  click: vi.fn(),
  ...extra,
})

const zoomIn = item('Zoom In', { accelerator: 'CommandOrControl+Plus' })
const copy = item('', { role: 'copy' })
const menu = {
  items: [
    item('&File', {
      submenu: {
        items: [item('Open Location…'), item('', { type: 'separator' }), item('Quit')],
      },
    }),
    item('Edit', { submenu: { items: [copy, item('Locked', { enabled: false })] } }),
    item('View', {
      submenu: {
        items: [
          zoomIn,
          item('Zoom In', { visible: false }),
          item('Zoom', { submenu: { items: [] } }),
        ],
      },
    }),
  ],
}

let pageContents: object | null = null
vi.mock('electron', () => ({ Menu: { getApplicationMenu: () => menu } }))
vi.mock('../navigation/main', () => ({
  getPage: () => (pageContents ? { contents: () => pageContents } : null),
}))

const { register } = await import('./main')
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    window: { webContents: { id: 'chrome-ui' } },
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
    fileMenu: [],
  }
  register(ctx as unknown as MainContext)
  return { ctx, call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) }
}

describe('menu main', () => {
  it('lists visible items as a named tree without separators or Electron objects', () => {
    const { call } = setup()
    const platformKey = process.platform === 'darwin' ? 'Cmd' : 'Ctrl'
    expect(call(channels.items)).toEqual([
      {
        name: 'file',
        label: 'File',
        enabled: true,
        children: [
          { name: 'open-location', label: 'Open Location…', enabled: true },
          { name: 'quit', label: 'Quit', enabled: true },
        ],
      },
      {
        name: 'edit',
        label: 'Edit',
        enabled: true,
        children: [
          { name: 'copy', label: 'copy', enabled: true },
          { name: 'locked', label: 'Locked', enabled: false },
        ],
      },
      {
        name: 'view',
        label: 'View',
        enabled: true,
        children: [
          {
            name: 'zoom-in',
            label: 'Zoom In',
            accelerator: `${platformKey}+Plus`,
            enabled: true,
          },
          { name: 'zoom', label: 'Zoom', enabled: true, children: [] },
        ],
      },
    ])
  })

  it('runs an item as if clicked with the page focused, or the chrome UI before a page', () => {
    const { ctx, call } = setup()
    expect(call(channels.run, ['view', 'zoom-in'])).toEqual({ ok: true })
    expect(zoomIn.click).toHaveBeenCalledWith({}, ctx.window, ctx.window.webContents)

    pageContents = { id: 'page' }
    expect(call(channels.run, ['edit', 'copy'])).toEqual({ ok: true })
    expect(copy.click).toHaveBeenCalledWith({}, ctx.window, pageContents)
    pageContents = null
  })

  it('reports unknown, disabled and submenu paths without running anything', () => {
    const { call } = setup()
    expect(call(channels.run, ['view', 'nope'])).toEqual({
      ok: false,
      error: 'No “nope” in View. Pick one of: zoom-in, zoom.',
    })
    expect(call(channels.run, ['edit', 'locked'])).toEqual({
      ok: false,
      error: 'Edit › Locked is disabled.',
    })
    expect(call(channels.run, ['file'])).toMatchObject({ ok: false })
  })

  it('reports an item that throws', () => {
    const { call } = setup()
    ;(zoomIn.click as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(call(channels.run, ['view', 'zoom-in'])).toEqual({
      ok: false,
      error: 'View › Zoom In failed: boom',
    })
  })

  it('rejects malformed paths', () => {
    const { call } = setup()
    for (const bad of [
      undefined,
      'view zoom-in',
      [],
      [3],
      [''],
      ['x'.repeat(101)],
      Array(9).fill('view'),
    ]) {
      expect(() => call(channels.run, bad)).toThrow(TypeError)
    }
  })
})
