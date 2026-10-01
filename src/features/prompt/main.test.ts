import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

const userData = mkdtempSync(join(tmpdir(), 'antimony-prompt-'))
const quitListeners: (() => void)[] = []
let created: ((event: unknown, contents: unknown) => void) | null = null
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    on: (event: string, listener: never) => {
      if (event === 'will-quit') quitListeners.push(listener)
      if (event === 'web-contents-created') created = listener
    },
  },
}))

const page = { focus: vi.fn() }
let pageContents: typeof page | null = page
vi.mock('../navigation/main', () => ({ getPage: () => ({ contents: () => pageContents }) }))

const { isToggleKey, register } = await import('./main')

type InputListener = (event: { preventDefault: () => void }, input: Electron.Input) => void
/** A webContents that records its before-input-event listener. */
function fakeContents(session: unknown = {}) {
  const contents = {
    session,
    focus: vi.fn(),
    input: null as InputListener | null,
    on: (event: string, listener: InputListener) => {
      if (event === 'before-input-event') contents.input = listener
    },
  }
  return contents
}

const key = (overrides: Partial<Electron.Input> = {}) =>
  ({
    type: 'keyDown',
    key: 'b',
    control: true,
    meta: false,
    alt: false,
    shift: false,
    isAutoRepeat: false,
    ...overrides,
  }) as Electron.Input
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    window: { webContents: fakeContents() },
    browsingSession: { name: 'browsing' },
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
    fileMenu: [] as MenuItemConstructorOptions[],
  }
  register(ctx as unknown as MainContext)
  return { ctx, call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) }
}

describe('prompt main', () => {
  it('records history, keeps it across restarts and clears it', () => {
    const first = setup()
    first.call(channels.record, { kind: 'url', text: 'https://a.com/' })
    first.call(channels.record, { kind: 'command', text: '/key sk-ant-secret-key' })
    first.call(channels.record, { kind: 'query', text: 'hello' })
    quitListeners.forEach((flush) => flush())
    expect(readFileSync(join(userData, 'prompt-history.json'), 'utf8')).not.toContain('secret')

    const second = setup()
    expect((second.call(channels.history) as { text: string }[]).map((e) => e.text)).toEqual([
      'hello',
      '/key',
      'https://a.com/',
    ])
    second.call(channels.clearHistory)
    expect(second.call(channels.history)).toEqual([])
  })

  it('rejects malformed entries', () => {
    const { call } = setup()
    for (const bad of [
      null,
      { kind: 'secret', text: 'x' },
      { kind: 'query', text: 3 },
      { kind: 'query', text: 'x'.repeat(3000) },
    ]) {
      expect(() => call(channels.record, bad)).toThrow(TypeError)
    }
  })

  it('adds File → Prompt… (Ctrl/Cmd+L), which focuses the chrome UI and opens the prompt', () => {
    const { ctx } = setup()
    const [item] = ctx.fileMenu
    expect(item).toMatchObject({ id: 'prompt', label: 'Prompt…', accelerator: 'CmdOrCtrl+L' })
    ;(item!.click as () => void)()
    expect(ctx.window.webContents.focus).toHaveBeenCalled()
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.open, null)
  })

  it('adds File → Toggle Assistant (Ctrl/Cmd+B), which focuses the chrome UI and toggles', () => {
    const { ctx } = setup()
    const item = ctx.fileMenu.find((entry) => entry.id === 'prompt-toggle')
    expect(item).toMatchObject({ label: 'Toggle Assistant', accelerator: 'CmdOrCtrl+B' })
    ;(item!.click as () => void)()
    expect(ctx.window.webContents.focus).toHaveBeenCalled()
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.toggle, null)
  })

  it('matches Ctrl+B (Cmd+B on macOS) pressed or held, not with other modifiers', () => {
    expect(isToggleKey(key(), 'win32')).toBe(true)
    expect(isToggleKey(key({ key: 'B' }), 'linux')).toBe(true)
    expect(isToggleKey(key({ control: false, meta: true }), 'darwin')).toBe(true)
    expect(isToggleKey(key({ control: false, meta: true }), 'win32')).toBe(false)
    expect(isToggleKey(key(), 'darwin')).toBe(false)
    expect(isToggleKey(key({ isAutoRepeat: true }), 'win32')).toBe(true)
    expect(isToggleKey(key({ type: 'keyUp' }), 'win32')).toBe(false)
    expect(isToggleKey(key({ shift: true }), 'win32')).toBe(false)
    expect(isToggleKey(key({ alt: true }), 'win32')).toBe(false)
    expect(isToggleKey(key({ key: 'l' }), 'win32')).toBe(false)
  })

  it('toggles once on Ctrl/Cmd+B in the chrome UI or a page, before the page or menu sees it', () => {
    const { ctx } = setup()
    const page = fakeContents(ctx.browsingSession)
    const other = fakeContents({ name: 'other' })
    created!({}, page)
    created!({}, other)
    expect(other.input).toBeNull()

    const command = process.platform === 'darwin' ? { control: false, meta: true } : {}
    for (const contents of [ctx.window.webContents, page]) {
      ctx.ipc.send.mockClear()
      const event = { preventDefault: vi.fn() }
      contents.input!(event, key(command))
      expect(event.preventDefault).toHaveBeenCalledOnce()
      expect(ctx.ipc.send).toHaveBeenCalledExactlyOnceWith(channels.toggle, null)
    }

    // Held: the repeats are swallowed too (the menu accelerator would toggle on each) but don't toggle.
    ctx.ipc.send.mockClear()
    const held = { preventDefault: vi.fn() }
    page.input!(held, key({ ...command, isAutoRepeat: true }))
    expect(held.preventDefault).toHaveBeenCalledOnce()
    expect(ctx.ipc.send).not.toHaveBeenCalled()

    ctx.ipc.send.mockClear()
    const typed = { preventDefault: vi.fn() }
    page.input!(typed, key({ key: 'a' }))
    expect(typed.preventDefault).not.toHaveBeenCalled()
    expect(ctx.ipc.send).not.toHaveBeenCalled()
  })

  it('focuses the page on request, and does nothing without one', () => {
    const { call } = setup()
    call(channels.focusPage)
    expect(page.focus).toHaveBeenCalledOnce()
    pageContents = null
    expect(() => call(channels.focusPage)).not.toThrow()
    pageContents = page
  })
})
