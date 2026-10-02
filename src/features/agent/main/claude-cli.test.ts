import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  CLI_NOT_FOUND,
  CLI_NOT_LOGGED_IN,
  CliError,
  cliCommand,
  cliComplete,
  cliEnv,
  cliStatus,
  completeArgs,
  describeCliFailure,
  runArgs,
  runCliProcess,
  runCliTurn,
  toMcpResult,
  type CliEvent,
  type CliOptions,
  type CliTurn,
} from './claude-cli'

/** A ChildProcess stand-in: the test writes its stdout and decides when it exits. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    pid: 4242,
    exitCode: null as number | null,
    signalCode: null as string | null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn((signal: string) => {
      child.signalCode = signal
      child.stdout.end()
      setImmediate(() => child.emit('close', null))
      return true
    }),
  })
  let stdin = ''
  child.stdin.on('data', (chunk: Buffer) => (stdin += chunk.toString()))
  return {
    child,
    stdin: () => stdin,
    print: (event: unknown) =>
      child.stdout.write(`${typeof event === 'string' ? event : JSON.stringify(event)}\n`),
    exit: (code: number, stderr = '') => {
      if (stderr) child.stderr.write(stderr)
      child.exitCode = code
      child.stdout.end()
      setImmediate(() => child.emit('close', code))
    },
  }
}

type Fake = ReturnType<typeof fakeChild>

function options(onSpawn: (fake: Fake, args: string[], spawnOptions: SpawnOptions) => void) {
  const calls: { command: string; args: string[]; options: SpawnOptions }[] = []
  const cli: CliOptions = {
    command: 'claude',
    cwd: join(tmpdir(), 'antimony-cli-test'),
    env: { PATH: '/bin' },
    spawn: (command, args, spawnOptions) => {
      calls.push({ command, args, options: spawnOptions })
      const fake = fakeChild()
      setImmediate(() => onSpawn(fake, args, spawnOptions))
      return fake.child as unknown as ChildProcess
    },
  }
  return { cli, calls }
}

const result = (fields: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'ok',
  session_id: 'session-9',
  ...fields,
})

const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

describe('CLI arguments and environment', () => {
  it('runs print mode with stream-json, no built-in tools and none of the user setup', () => {
    const args = runArgs({
      model: 'claude-sonnet-5-5',
      system: 'SYSTEM',
      mcpConfigPath: '/tmp/x/mcp.json',
      tools: ['navigate', 'click'],
      maxTurns: 25,
      resume: null,
    })
    expect(args.slice(0, 6)).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
    ])
    expect(argAfter(args, '--model')).toBe('claude-sonnet-5-5')
    expect(argAfter(args, '--effort')).toBe('medium')
    expect(argAfter(args, '--system-prompt')).toBe('SYSTEM')
    expect(argAfter(args, '--tools')).toBe('')
    expect(argAfter(args, '--setting-sources')).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--disable-slash-commands')
    expect(argAfter(args, '--permission-prompts')).toBe('none')
    expect(argAfter(args, '--mcp-config')).toBe('/tmp/x/mcp.json')
    expect(argAfter(args, '--allowedTools')).toBe('mcp__antimony__navigate,mcp__antimony__click')
    expect(argAfter(args, '--max-turns')).toBe('25')
    expect(args).not.toContain('--resume')
    expect(args).not.toContain('--no-session-persistence')

    const resumed = runArgs({
      model: 'claude-haiku-4-5',
      system: 'S',
      mcpConfigPath: 'm',
      tools: [],
      maxTurns: 25,
      resume: 'session-1',
    })
    expect(argAfter(resumed, '--resume')).toBe('session-1')
    expect(resumed).not.toContain('--effort')
  })

  it('completes in one turn without a session or MCP servers', () => {
    const args = completeArgs('claude-opus-5-5', 'Summarise')
    expect(argAfter(args, '--max-turns')).toBe('1')
    expect(args).toContain('--no-session-persistence')
    expect(args).not.toContain('--mcp-config')
    expect(argAfter(args, '--tools')).toBe('')
  })

  it('uses CLAUDE_CLI_PATH, else finds the CLI on PATH or where its installers put it', () => {
    const files = new Set<string>()
    const exists = (path: string) => files.has(path)
    const linux = { platform: 'linux' as const, exists }
    expect(cliCommand({ CLAUDE_CLI_PATH: ' /opt/claude ', PATH: '/bin' }, '/home/me', linux)).toBe(
      '/opt/claude',
    )
    expect(cliCommand({ PATH: '/bin:/usr/bin' }, '/home/me', linux)).toBe('claude')
    files.add('/home/me/.local/bin/claude')
    expect(cliCommand({ PATH: '/bin:/usr/bin' }, '/home/me', linux)).toBe(
      '/home/me/.local/bin/claude',
    )
    files.add('/usr/bin/claude')
    expect(cliCommand({ PATH: '/bin:/usr/bin', CLAUDE_CLI_PATH: '' }, '/home/me', linux)).toBe(
      '/usr/bin/claude',
    )
    files.add(join('C:\\Users\\me', '.local', 'bin', 'claude.exe'))
    expect(cliCommand({ PATH: '' }, 'C:\\Users\\me', { platform: 'win32', exists })).toBe(
      join('C:\\Users\\me', '.local', 'bin', 'claude.exe'),
    )
  })

  it('gives the CLI no API key, endpoint or parent Claude Code session', () => {
    const env = cliEnv({
      PATH: '/bin',
      HOME: '/home/me',
      ANTHROPIC_API_KEY: 'sk-secret',
      ANTHROPIC_AUTH_TOKEN: 'token',
      ANTHROPIC_BASE_URL: 'http://evil',
      CLAUDECODE: '1',
      CLAUDE_CODE_SESSION_ID: 'abc',
    })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/me', MCP_TOOL_TIMEOUT: '86400000' })
  })
})

describe('runCliProcess', () => {
  it('writes the user message to stdin and reports every stream-json line', async () => {
    let written = ''
    const { cli, calls } = options((fake) => {
      written = fake.stdin()
      fake.print({ type: 'system', subtype: 'init', session_id: 'session-9' })
      fake.print('not json')
      fake.print({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } })
      fake.print(result())
      fake.exit(0)
    })
    const events: CliEvent[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const content = [{ type: 'text', text: 'hello' }]
    const outcome = await runCliProcess(cli, ['-p'], content, (event) => events.push(event))
    warn.mockRestore()

    expect(JSON.parse(written)).toEqual({ type: 'user', message: { role: 'user', content } })
    expect(written.endsWith('\n')).toBe(true)
    expect(calls[0]).toMatchObject({
      command: 'claude',
      args: ['-p'],
      options: { cwd: cli.cwd, env: cli.env, shell: false },
    })
    expect(events.map((event) => event.type)).toEqual(['system', 'assistant', 'result'])
    expect(outcome).toMatchObject({ code: 0, sessionId: 'session-9', result: { result: 'ok' } })
    expect(existsSync(cli.cwd)).toBe(true)
  })

  it('keeps the end of stderr and the exit code when the CLI fails', async () => {
    const { cli } = options((fake) => fake.exit(2, 'error: unknown option --foo'))
    const outcome = await runCliProcess(cli, [], [], () => {})
    expect(outcome).toEqual({
      code: 2,
      stderr: 'error: unknown option --foo',
      result: null,
      sessionId: null,
    })
  })

  it('kills the CLI on abort and rejects with an AbortError', async () => {
    let child: Fake['child'] | null = null
    const { cli } = options((fake) => {
      child = fake.child
      fake.print({ type: 'system', subtype: 'init', session_id: 's' })
    })
    const controller = new AbortController()
    const running = runCliProcess(cli, [], [], () => controller.abort(), controller.signal)
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(child!.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('says the CLI is missing when it cannot be started', async () => {
    const cli: CliOptions = {
      command: join(tmpdir(), 'no-such-claude-cli'),
      cwd: join(tmpdir(), 'antimony-cli-test'),
      env: process.env,
    }
    await expect(runCliProcess(cli, [], [], () => {})).rejects.toEqual(new CliError(CLI_NOT_FOUND))
    expect(await cliStatus(cli)).toEqual({ error: CLI_NOT_FOUND })
  })
})

describe('describeCliFailure', () => {
  it('names a logged-out CLI, a CLI error result and an exit without a result', () => {
    const base = { code: 1, stderr: '', sessionId: null }
    expect(
      describeCliFailure({
        ...base,
        result: { type: 'result', is_error: true, result: 'Not logged in · Please run /login' },
      }),
    ).toBe(CLI_NOT_LOGGED_IN)
    expect(
      describeCliFailure({ ...base, stderr: 'API Error: 401 OAuth token expired', result: null }),
    ).toBe(CLI_NOT_LOGGED_IN)
    expect(
      describeCliFailure({
        ...base,
        result: { type: 'result', is_error: true, result: 'Overloaded' },
      }),
    ).toBe('Claude Code CLI error: Overloaded')
    expect(
      describeCliFailure({
        ...base,
        result: { type: 'result', subtype: 'error_during_execution' },
      }),
    ).toBe('Claude Code CLI error (error_during_execution)')
    expect(describeCliFailure({ ...base, code: null, result: null })).toBe(
      'The Claude Code CLI exited with code none.',
    )
  })
})

describe('cliStatus', () => {
  it('lists the CLI models when logged in, and says why not otherwise', async () => {
    const answers = ['{"loggedIn":true,"authMethod":"claude.ai"}', '{"loggedIn":false}', 'garbage']
    const { cli, calls } = options((fake) => {
      fake.print(answers.shift()!)
      fake.exit(0)
    })
    expect(await cliStatus(cli)).toEqual({
      models: [
        { id: 'cli:claude-sonnet-5-5', label: 'Sonnet 5.5 (Claude Code)' },
        { id: 'cli:claude-opus-5-5', label: 'Opus 5.5 (Claude Code)' },
        { id: 'cli:claude-haiku-4-5', label: 'Haiku 4.5 (Claude Code)' },
      ],
    })
    expect(await cliStatus(cli)).toEqual({ error: CLI_NOT_LOGGED_IN })
    expect(await cliStatus(cli)).toEqual({ error: 'Unexpected answer from claude auth status.' })
    expect(calls[0]!.args).toEqual(['auth', 'status', '--json'])
  })
})

describe('toMcpResult', () => {
  it('turns tool_result blocks into MCP content', () => {
    expect(
      toMcpResult({
        type: 'tool_result',
        tool_use_id: 't',
        content: [
          { type: 'text', text: 'Page' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' } },
        ],
      }),
    ).toEqual({
      content: [
        { type: 'text', text: 'Page' },
        { type: 'image', data: 'AAA', mimeType: 'image/jpeg' },
      ],
    })
    expect(
      toMcpResult({ type: 'tool_result', tool_use_id: 't', content: 'Denied', is_error: true }),
    ).toEqual({ content: [{ type: 'text', text: 'Denied' }], isError: true })
  })
})

describe('runCliTurn', () => {
  it('serves the turn tools over MCP to the CLI and cleans up afterwards', async () => {
    let configPath = ''
    let mcpUrl = ''
    const { cli } = options((fake, args) => {
      void (async () => {
        configPath = argAfter(args, '--mcp-config')!
        const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
          mcpServers: { antimony: { type: string; url: string; headers: Record<string, string> } }
        }
        const server = config.mcpServers.antimony
        expect(server.type).toBe('http')
        mcpUrl = server.url
        const post = async (body: unknown) =>
          (await fetch(server.url, {
            method: 'POST',
            headers: { ...server.headers, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }).then((response) => response.json())) as { result: Record<string, unknown> }
        const list = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
        expect(list.result['tools']).toEqual([
          { name: 'navigate', description: 'Open', inputSchema: { type: 'object' } },
        ])
        const call = await post({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'navigate', arguments: { url: 'a.com' } },
        })
        fake.print({
          type: 'user',
          message: { content: [{ type: 'tool_result', content: call.result['content'] }] },
        })
        fake.print(result({ result: 'Opened' }))
        fake.exit(0)
      })()
    })
    const callTool = vi.fn(async () => ({
      type: 'tool_result',
      tool_use_id: 'x',
      content: [{ type: 'text', text: 'Loaded a.com' }],
    }))
    const events: CliEvent[] = []
    const turn: CliTurn = {
      model: 'claude-sonnet-5-5',
      system: 'S',
      content: [{ type: 'text', text: 'open a.com' }],
      tools: [{ name: 'navigate', description: 'Open', input_schema: { type: 'object' } }],
      maxTurns: 25,
      resume: null,
      signal: new AbortController().signal,
      callTool,
      onEvent: (event) => events.push(event),
    }
    const outcome = await runCliTurn(cli, turn)

    expect(callTool).toHaveBeenCalledWith('navigate', { url: 'a.com' })
    expect(events[0]).toMatchObject({
      type: 'user',
      message: { content: [{ content: [{ type: 'text', text: 'Loaded a.com' }] }] },
    })
    expect(outcome.result).toMatchObject({ result: 'Opened' })
    expect(existsSync(configPath)).toBe(false)
    await expect(fetch(mcpUrl, { method: 'POST' })).rejects.toThrow()
  })
})

describe('cliComplete', () => {
  it('returns the result text, or rejects with what went wrong', async () => {
    const replies = [
      result({ result: 'A summary' }),
      result({ is_error: true, result: 'Overloaded' }),
    ]
    const { cli, calls } = options((fake) => {
      fake.print(replies.shift()!)
      fake.exit(0)
    })
    const request = {
      model: 'claude-haiku-4-5' as const,
      system: 'Summarise',
      content: [{ type: 'text', text: 'page' }],
    }
    expect(await cliComplete(cli, request)).toBe('A summary')
    await expect(cliComplete(cli, request)).rejects.toEqual(
      new CliError('Claude Code CLI error: Overloaded'),
    )
    expect(calls[0]!.args).toContain('--no-session-persistence')
  })
})
