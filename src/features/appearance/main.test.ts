import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'
import { sampleTheme } from './shared/sample-theme'

const userData = mkdtempSync(join(tmpdir(), 'antimony-appearance-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, on: vi.fn() } }))
const complete = vi.fn()
vi.mock('../agent/main', () => ({ complete: (request: unknown) => complete(request) }))
const { register, parseStored } = await import('./main')
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 1600, height: 1000 }),
    resize: vi.fn(() => image),
    toJPEG: vi.fn(() => Buffer.from('jpeg')),
  }
  const ctx = {
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
    window: { webContents: { capturePage: vi.fn(async () => image) } },
    fileMenu: [] as MenuItemConstructorOptions[],
  }
  register(ctx as unknown as MainContext)
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args)
  return { ctx, call, image }
}

describe('appearance main', () => {
  it('stores a checked theme, tells the chrome UI, and resets to the system default', () => {
    const { ctx, call } = setup()
    expect(call(channels.get)).toBeNull()
    const theme = sampleTheme()
    expect(call(channels.set, theme)).toEqual(theme)
    expect(call(channels.get)).toEqual(theme)
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.changed, theme)
    expect(call(channels.set, null)).toBeNull()
    expect(ctx.ipc.send).toHaveBeenLastCalledWith(channels.changed, null)
  })

  it('rejects malformed and unreadable themes', async () => {
    const { call } = setup()
    const theme = sampleTheme()
    expect(() =>
      call(channels.set, { ...theme, colors: { ...theme.colors, text: 'red' } }),
    ).toThrow(TypeError)
    expect(() =>
      call(channels.set, {
        ...theme,
        colors: {
          ...theme.colors,
          'toolbar-bg': '#000000',
          'panel-bg': '#ffffff',
          'card-bg': '#767676',
        },
      }),
    ).toThrow('not readable enough')
    await expect(call(channels.generate, '')).rejects.toThrow(TypeError)
    expect(() => call(channels.requestOpen, { description: 42 })).toThrow(TypeError)
  })

  it('generates themes with the selected model from the description only', async () => {
    complete.mockResolvedValueOnce({
      text: JSON.stringify({ candidates: [sampleTheme('A'), sampleTheme('B')] }),
    })
    const { call } = setup()
    const themes = (await call(channels.generate, '  light, for astigmatism ')) as {
      theme: { name: string }
    }[]
    expect(themes.map((t) => t.theme.name)).toEqual(['A', 'B'])
    expect(complete.mock.calls[0]![0].text).toContain('Need: light, for astigmatism')
  })

  it('Cancel stops the running model request', async () => {
    let signal: AbortSignal | undefined
    complete.mockImplementationOnce(
      (request: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal = request.signal
          signal.addEventListener('abort', () => reject(new Error('Aborted')))
        }),
    )
    const { call } = setup()
    const running = call(channels.generate, 'calm') as Promise<unknown>
    await vi.waitFor(() => expect(signal).toBeDefined())
    call(channels.cancel)
    await expect(running).rejects.toThrow('Aborted')
    expect(signal!.aborted).toBe(true)
  })

  it('captures the chrome UI as a JPEG at most 800 px wide', async () => {
    const { ctx, call, image } = setup()
    expect(await call(channels.capture)).toBe(
      `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`,
    )
    expect(ctx.window.webContents.capturePage).toHaveBeenCalled()
    expect(image.resize).toHaveBeenCalledWith({ width: 800 })
  })

  it('opens the page from /settings theme and from File → Appearance…', () => {
    const { ctx, call } = setup()
    call(channels.requestOpen, { description: 'dark, low glare' })
    call(channels.requestOpen)
    const item = ctx.fileMenu.find((entry) => entry.id === 'appearance')!
    ;(item.click as () => void)()
    expect(ctx.ipc.send.mock.calls).toEqual([
      [channels.open, { description: 'dark, low glare' }],
      [channels.open, { description: '' }],
      [channels.open, { description: '' }],
    ])
  })

  it('ignores a stored theme that no longer parses or passes', () => {
    expect(parseStored({ theme: sampleTheme() }).theme).toEqual(sampleTheme())
    expect(parseStored({ theme: null })).toEqual({ theme: null })
    expect(() => parseStored({ theme: { name: 'x' } })).toThrow()
  })
})
