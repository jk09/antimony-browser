import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

process.env['OLLAMA_HOST'] = '127.0.0.1:11555'
delete process.env['ANTHROPIC_API_KEY']
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

afterEach(() => {
  vi.unstubAllGlobals()
})

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

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

  it('runs Ollama models without an API key, on the OLLAMA_HOST server', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({
        id: 'm1',
        model: 'qwen3:8b',
        content: [{ type: 'text', text: 'Hi from Ollama' }],
        stop_reason: 'end_turn',
        usage: {},
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const { call } = setup()
    call(channels.setKey, null)
    expect(call(channels.updateSettings, { model: 'ollama:qwen3:8b' })).toMatchObject({
      provider: 'ollama',
      hasKey: false,
    })
    call(channels.run, { text: 'hello', attachments: [] })
    await vi.waitFor(() => expect(JSON.stringify(call(channels.state))).toContain('Hi from Ollama'))
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:11555/v1/messages')
    expect(init!.headers).not.toHaveProperty('x-api-key')
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'qwen3:8b' })

    // Claude models still need the key.
    call(channels.updateSettings, { model: 'claude-sonnet-5-5' })
    call(channels.run, { text: 'hello', attachments: [] })
    await vi.waitFor(() => expect(JSON.stringify(call(channels.state))).toContain('/key'))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('lists Claude models and the models installed in Ollama', async () => {
    const fetch = vi.fn(async (_url: string) =>
      json({ models: [{ name: 'qwen3:8b' }, { name: 'llama3.1:latest' }, { name: 42 }] }),
    )
    vi.stubGlobal('fetch', fetch)
    const { call } = setup()
    const list = await call(channels.models)
    expect(list).toEqual({
      claude: [
        { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
        { id: 'claude-opus-5-5', label: 'Opus 5.5' },
        { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
      ],
      ollama: {
        models: [
          { id: 'ollama:qwen3:8b', label: 'qwen3:8b (Ollama)' },
          { id: 'ollama:llama3.1:latest', label: 'llama3.1:latest (Ollama)' },
        ],
      },
    })
    expect(fetch.mock.calls[0]![0]).toBe('http://127.0.0.1:11555/api/tags')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
    )
    expect(await call(channels.models)).toMatchObject({
      ollama: { error: "Ollama isn't running at http://127.0.0.1:11555." },
    })
  })
})
