import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

const userData = mkdtempSync(join(tmpdir(), 'antimony-agent-'))
vi.mock('electron', () => ({
  app: { getPath: () => userData, on: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`),
    decryptString: (buffer: Buffer) => buffer.toString().replace(/^enc:/, ''),
  },
}))
vi.mock('../navigation/main', () => ({ getPage: () => null }))

const { register } = await import('./main')
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
    fileMenu: [] as MenuItemConstructorOptions[],
  }
  register(ctx as unknown as MainContext)
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { ctx, call }
}

describe('agent main', () => {
  it('never sends the API key to the chrome UI', async () => {
    const { ctx, call } = setup()
    const returned = [
      call(channels.setKey, 'sk-ant-very-secret'),
      call(channels.settings),
      call(channels.updateSettings, { pageAccess: true }),
      call(channels.state),
      call(channels.debugLog),
    ]
    expect(returned[0]).toMatchObject({ hasKey: true, keyPersisted: true })
    expect(JSON.stringify(returned)).not.toContain('very-secret')
    expect(JSON.stringify(ctx.ipc.send.mock.calls)).not.toContain('very-secret')
  })

  it('rejects malformed arguments', () => {
    const { call } = setup()
    expect(() => call(channels.run, { text: 42, attachments: [] })).toThrow(TypeError)
    expect(() => call(channels.approve, 'maybe')).toThrow(TypeError)
    expect(() => call(channels.updateSettings, { model: 'unknown' })).toThrow(TypeError)
    expect(() => call(channels.setKey, 12)).toThrow(TypeError)
  })

  it('adds File → Toggle Assistant Debugger, which tells the UI to toggle the panel', () => {
    const { ctx, call } = setup()
    const [item] = ctx.fileMenu
    expect(item).toMatchObject({
      label: 'Toggle Assistant Debugger',
      accelerator: 'CmdOrCtrl+Shift+D',
    })
    ;(item!.click as () => void)()
    call(channels.toggleDebug)
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.debugToggled, null)
    expect(
      ctx.ipc.send.mock.calls.filter(([channel]) => channel === channels.debugToggled),
    ).toHaveLength(2)
  })
})
