import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
// A fake Claude Code CLI (logged in unless FAKE_CLAUDE_LOGGED_IN=0); runs are logged here.
const cliLog = join(userData, 'fake-claude.log')
process.env['CLAUDE_CLI_PATH'] = resolve(
  import.meta.dirname,
  '../../../e2e/fixtures/fake-claude.mjs',
)
process.env['FAKE_CLAUDE_LOG'] = cliLog
const cliRuns = () =>
  readFileSync(cliLog, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { args: string[]; hasApiKey: boolean; cwd: string })
const { register, complete } = await import('./main')
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

  it('lists Claude models, the Claude Code CLI models and the models installed in Ollama', async () => {
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
      cli: {
        models: [
          { id: 'cli:claude-sonnet-5-5', label: 'Sonnet 5.5 (Claude Code)' },
          { id: 'cli:claude-opus-5-5', label: 'Opus 5.5 (Claude Code)' },
          { id: 'cli:claude-haiku-4-5', label: 'Haiku 4.5 (Claude Code)' },
        ],
      },
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

  it('answers single requests with the selected model, without tools', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({
        id: 'm2',
        model: 'qwen3:8b',
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'SUMMARY: ' },
          { type: 'text', text: 'ok' },
        ],
        stop_reason: 'end_turn',
        usage: {},
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const { call } = setup()
    call(channels.updateSettings, { model: 'ollama:qwen3:8b' })
    const answer = await complete({ system: 'sys', text: 'hello', imageJpegBase64: 'AAAA' })
    expect(answer).toEqual({ text: 'SUMMARY: ok', model: 'ollama:qwen3:8b' })
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string)
    expect(body).not.toHaveProperty('tools')
    expect(body.system).toBe('sys')
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
          { type: 'text', text: 'hello' },
        ],
      },
    ])

    // Claude without a key: rejected, nothing sent.
    call(channels.setKey, null)
    call(channels.updateSettings, { model: 'claude-sonnet-5-5' })
    await expect(complete({ system: 's', text: 't' })).rejects.toThrow(/key/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('runs Claude Code CLI models through the CLI, without the API key, and resumes its session', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-from-env'
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      const { call } = setup()
      expect(call(channels.updateSettings, { model: 'cli:claude-haiku-4-5' })).toMatchObject({
        provider: 'claude-cli',
      })
      const items = () => JSON.stringify(call(channels.state))
      call(channels.run, { text: 'open example.com', attachments: [] })
      // No page in this test: the tool call reaches the agent over MCP and comes back as an error.
      await vi.waitFor(
        () =>
          expect(items()).toContain(
            'Could not open example.com (The browser page is not available.)',
          ),
        { timeout: 10_000 },
      )
      await vi.waitFor(() => expect(call(channels.state)).toMatchObject({ status: 'idle' }))
      call(channels.run, { text: 'and again', attachments: [] })
      await vi.waitFor(() => expect(items()).toContain('CLI echo: and again'), { timeout: 10_000 })

      const [first, second] = cliRuns().slice(-2)
      expect(first!.hasApiKey).toBe(false)
      expect(first!.cwd).toBe(join(userData, 'claude-cli'))
      expect(first!.args).toEqual(expect.arrayContaining(['--model', 'claude-haiku-4-5']))
      expect(first!.args).not.toContain('--resume')
      expect(second!.args).toEqual(expect.arrayContaining(['--resume']))
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      delete process.env['ANTHROPIC_API_KEY']
    }
  })

  it('answers single requests through the Claude Code CLI', async () => {
    const { call } = setup()
    call(channels.updateSettings, { model: 'cli:claude-sonnet-5-5' })
    expect(await complete({ system: 'sys', text: 'hello', imageJpegBase64: 'AAAA' })).toEqual({
      text: 'CLI echo: hello',
      model: 'cli:claude-sonnet-5-5',
    })
    expect(cliRuns().at(-1)!.args).toContain('--no-session-persistence')
  })

  it('says when the Claude Code CLI is not logged in', async () => {
    process.env['FAKE_CLAUDE_LOGGED_IN'] = '0'
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
      )
      const { call } = setup()
      expect(await call(channels.models)).toMatchObject({
        cli: { error: "Claude Code isn't logged in. Run `claude` in a terminal and log in." },
      })
      call(channels.updateSettings, { model: 'cli:claude-sonnet-5-5' })
      call(channels.run, { text: 'hi', attachments: [] })
      await vi.waitFor(
        () => expect(JSON.stringify(call(channels.state))).toContain("isn't logged in"),
        { timeout: 10_000 },
      )
    } finally {
      delete process.env['FAKE_CLAUDE_LOGGED_IN']
    }
  })
})
