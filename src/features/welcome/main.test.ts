import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

const userData = mkdtempSync(join(tmpdir(), 'antimony-welcome-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, on: vi.fn() } }))
const { register, parseState } = await import('./main')
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

describe('welcome main', () => {
  it('is not done on a new profile, and remembers when it is', () => {
    const { call } = setup()
    expect(call(channels.state)).toEqual({ done: false })
    expect(call(channels.setDone, true)).toEqual({ done: true })
    expect(call(channels.state)).toEqual({ done: true })
    expect(() => call(channels.setDone, 'yes')).toThrow(TypeError)
  })

  it('opens the page from /welcome and from File → Welcome', () => {
    const { ctx, call } = setup()
    call(channels.requestOpen)
    const item = ctx.fileMenu.find((entry) => entry.id === 'welcome')!
    expect(item.label).toBe('Welcome')
    ;(item.click as () => void)()
    expect(ctx.ipc.send.mock.calls).toEqual([
      [channels.open, null],
      [channels.open, null],
    ])
  })

  it('reads only the done flag from the stored file', () => {
    expect(parseState({ done: true, extra: 1 })).toEqual({ done: true })
    expect(parseState({ done: 'yes' })).toEqual({ done: false })
    expect(() => parseState(null)).toThrow()
  })
})
