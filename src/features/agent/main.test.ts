import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

const userData = mkdtempSync(join(tmpdir(), 'antimony-agent-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, on: vi.fn() } }))
vi.mock('../navigation/main', () => ({ getPage: () => null }))

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
    .map(
      (line) =>
        JSON.parse(line) as { args: string[]; hasApiKey: boolean; cwd: string; content: unknown },
    )
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

describe('agent main', () => {
  it('stores the settings and tells the chrome UI; there is no key to set', () => {
    const { ctx, call } = setup()
    expect(call(channels.updateSettings, { model: 'claude-opus-5-5' })).toEqual({
      model: 'claude-opus-5-5',
      pageAccess: false,
      historyAccess: true,
    })
    expect(ctx.ipc.send).toHaveBeenCalledWith(
      channels.settingsChanged,
      expect.objectContaining({ model: 'claude-opus-5-5' }),
    )
    expect(call(channels.settings)).toMatchObject({ model: 'claude-opus-5-5' })
    expect(Object.values(channels)).not.toContain('agent:set-key')
  })

  it('rejects malformed arguments', () => {
    const { call } = setup()
    expect(() => call(channels.run, { text: 42, attachments: [] })).toThrow(TypeError)
    expect(() => call(channels.approve, 'maybe')).toThrow(TypeError)
    expect(() => call(channels.updateSettings, { model: 'unknown' })).toThrow(TypeError)
    expect(() => call(channels.updateSettings, { model: 'ollama:qwen3:8b' })).toThrow(TypeError)
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

  it('runs the assistant through the Claude Code CLI, without the API key, and resumes its session', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-from-env'
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      const { call } = setup()
      call(channels.updateSettings, { model: 'claude-haiku-4-5' })
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
      vi.unstubAllGlobals()
    }
  })

  it('answers single requests through the CLI with the selected model, labelled images first', async () => {
    const { call } = setup()
    call(channels.updateSettings, { model: 'claude-sonnet-5-5' })
    expect(await complete({ system: 'sys', text: 'hello', imageJpegBase64: 'AAAA' })).toEqual({
      text: 'CLI echo: hello',
      model: 'claude-sonnet-5-5',
    })
    const run = cliRuns().at(-1)!
    expect(run.args).toContain('--no-session-persistence')
    expect(run.args).toEqual(expect.arrayContaining(['--system-prompt', 'sys']))
    expect(run.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      { type: 'text', text: 'hello' },
    ])

    await complete({
      system: 'sys',
      text: 'which?',
      images: [
        { label: 'Sketch:', jpegBase64: 'SSSS' },
        { label: 'Page 7:', jpegBase64: 'PPPP' },
      ],
    })
    expect(cliRuns().at(-1)!.content).toEqual([
      { type: 'text', text: 'Sketch:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'SSSS' } },
      { type: 'text', text: 'Page 7:' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'PPPP' } },
      { type: 'text', text: 'which?' },
    ])
  })

  it('checks the CLI for the welcome page with the selected model', async () => {
    const { call } = setup()
    call(channels.updateSettings, { model: 'claude-opus-5-5' })
    expect(await call(channels.checkCli)).toEqual({
      found: { ok: true },
      loggedIn: { ok: true },
      answered: { ok: true, model: 'claude-opus-5-5', ms: expect.any(Number) },
    })
    expect(cliRuns().at(-1)!.args).toEqual(expect.arrayContaining(['--model', 'claude-opus-5-5']))
  })

  it('says when the Claude Code CLI is not logged in', async () => {
    process.env['FAKE_CLAUDE_LOGGED_IN'] = '0'
    try {
      const { call } = setup()
      expect(await call(channels.checkCli)).toEqual({
        found: { ok: true },
        loggedIn: {
          ok: false,
          error: "Claude Code isn't logged in. Run `claude` in a terminal and log in.",
        },
        answered: null,
      })
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
