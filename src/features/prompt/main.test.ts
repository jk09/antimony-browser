import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

const userData = mkdtempSync(join(tmpdir(), 'antimony-prompt-'))
const quitListeners: (() => void)[] = []
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    on: (_event: string, listener: () => void) => quitListeners.push(listener),
  },
}))

const { register } = await import('./main')
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    window: { webContents: { focus: vi.fn() } },
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
})
