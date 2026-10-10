// Runs the user's Claude Code CLI (`claude -p`) as a subprocess. The CLI signs in with its own
// credentials; Antimony never reads them. Browser tools reach it through a per-run MCP server.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { CliCheck, CliCheckStep, ModelId } from '../ipc'
import type { ApiTool, ContentBlock } from './content'
import { startMcpServer, type McpContent, type McpToolResult } from './mcp-server'

/** The MCP server's name; the CLI calls its tools `mcp__antimony__<tool>`. */
export const MCP_SERVER_NAME = 'antimony'
const STATUS_TIMEOUT_MS = 5_000
/** How long the welcome page's test waits for an answer. */
export const CHECK_TIMEOUT_MS = 60_000
const KILL_GRACE_MS = 2_000
/** Approvals can take a while; the CLI's default MCP tool timeout is shorter. */
const TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000
const STDERR_KEEP = 4_000

export const CLI_NOT_FOUND = 'Claude Code CLI not found. Install it, or set CLAUDE_CLI_PATH.'
export const CLI_NOT_LOGGED_IN =
  "Claude Code isn't logged in. Run `claude` in a terminal and log in."

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

export interface CliOptions {
  /** The CLI executable: CLAUDE_CLI_PATH or `claude` on PATH. */
  command: string
  /** Working directory for the CLI (empty, so it finds no CLAUDE.md). */
  cwd: string
  env: NodeJS.ProcessEnv
  spawn?: SpawnFn
}

/** Thrown for anything the CLI couldn't do; the message is meant for the user. */
export class CliError extends Error {}

/** One stream-json line from the CLI (only the fields Antimony reads are typed). */
export interface CliEvent {
  type: string
  subtype?: string
  session_id?: string
  message?: { content?: ContentBlock[]; [key: string]: unknown }
  parent_tool_use_id?: string | null
  [key: string]: unknown
}

export interface CliResult extends CliEvent {
  type: 'result'
  is_error?: boolean
  result?: string
  stop_reason?: string | null
}

export interface CliOutcome {
  /** Exit code, null when killed by a signal. */
  code: number | null
  stderr: string
  result: CliResult | null
  sessionId: string | null
}

/**
 * The CLI executable: CLAUDE_CLI_PATH, else the first `claude` on PATH or in the folders its
 * installers use (apps started from the macOS Dock get a minimal PATH), else plain `claude`.
 */
export function cliCommand(
  env: NodeJS.ProcessEnv,
  home: string,
  {
    platform = process.platform,
    exists = (path: string) => existsSync(path),
  }: { platform?: NodeJS.Platform; exists?: (path: string) => boolean } = {},
): string {
  const configured = env['CLAUDE_CLI_PATH']?.trim()
  if (configured) return configured
  const name = platform === 'win32' ? 'claude.exe' : 'claude'
  const dirs = [
    ...(env['PATH'] ?? '').split(platform === 'win32' ? ';' : delimiter),
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    ...(platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin']),
  ]
  for (const dir of dirs) {
    if (dir && exists(join(dir, name))) return join(dir, name)
  }
  return name
}

/**
 * Antimony's environment for the CLI, without anything that would make it use an API key or
 * another endpoint instead of its own login, or think it runs inside another Claude Code.
 */
export function cliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const {
    ANTHROPIC_API_KEY: _key,
    ANTHROPIC_AUTH_TOKEN: _token,
    ANTHROPIC_BASE_URL: _url,
    CLAUDECODE: _nested,
    CLAUDE_CODE_SESSION_ID: _session,
    ...rest
  } = env
  return { ...rest, MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_MS) }
}

/** Models that take an effort level. */
const takesEffort = (model: ModelId) => model === 'claude-sonnet-5-5' || model === 'claude-opus-5-5'

/** Flags every CLI request gets: print mode, stream-json both ways, nothing of the user's setup. */
function baseArgs(model: ModelId, system: string): string[] {
  return [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    ...(takesEffort(model) ? ['--effort', 'medium'] : []),
    '--system-prompt',
    system,
    // No built-in tools (shell, files, web), user/project settings, hooks, skills or MCP servers.
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    // Anything not explicitly allowed is denied rather than asked.
    '--permission-prompts',
    'none',
  ]
}

export interface RunArgs {
  model: ModelId
  system: string
  mcpConfigPath: string
  tools: string[]
  maxTurns: number
  resume: string | null
}

export function runArgs({ model, system, mcpConfigPath, tools, maxTurns, resume }: RunArgs) {
  return [
    ...baseArgs(model, system),
    '--mcp-config',
    mcpConfigPath,
    '--allowedTools',
    tools.map((name) => `mcp__${MCP_SERVER_NAME}__${name}`).join(','),
    '--max-turns',
    String(maxTurns),
    ...(resume ? ['--resume', resume] : []),
  ]
}

export function completeArgs(model: ModelId, system: string): string[] {
  return [...baseArgs(model, system), '--max-turns', '1', '--no-session-persistence']
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, KILL_GRACE_MS).unref()
}

function startError(error: NodeJS.ErrnoException): CliError {
  return error.code === 'ENOENT'
    ? new CliError(CLI_NOT_FOUND)
    : new CliError(`Couldn't start the Claude Code CLI: ${error.message}`)
}

/**
 * Starts the CLI with `args`, writes one user message to its stdin and reports each stream-json
 * line. Resolves when it exits; rejects with CliError if it can't start, or AbortError on abort.
 */
export function runCliProcess(
  options: CliOptions,
  args: string[],
  content: ContentBlock[],
  onEvent: (event: CliEvent) => void,
  signal?: AbortSignal,
): Promise<CliOutcome> {
  if (signal?.aborted) return Promise.reject(abortError())
  mkdirSync(options.cwd, { recursive: true })
  const spawn = options.spawn ?? nodeSpawn
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(options.command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    } catch (error) {
      reject(startError(error as NodeJS.ErrnoException))
      return
    }
    let stderr = ''
    let result: CliResult | null = null
    let sessionId: string | null = null
    let failed: CliError | null = null
    let code: number | null = null
    // Settle once both the process has exited and its last stdout line was read.
    let exited = false
    let linesClosed = false
    const onAbort = () => kill(child)
    signal?.addEventListener('abort', onAbort, { once: true })
    const finish = () => {
      if (!exited || !linesClosed) return
      signal?.removeEventListener('abort', onAbort)
      if (failed) reject(failed)
      else if (signal?.aborted) reject(abortError())
      else resolve({ code, stderr, result, sessionId })
    }
    const markExited = () => {
      if (exited) return
      exited = true
      finish()
    }

    const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity })
    lines.on('line', (line) => {
      if (!line.trim()) return
      let event: CliEvent
      try {
        event = JSON.parse(line) as CliEvent
      } catch {
        console.warn('Skipping a line the Claude Code CLI printed:', line.slice(0, 200))
        return
      }
      if (typeof event !== 'object' || event === null || typeof event.type !== 'string') return
      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        sessionId = event.session_id
      }
      if (event.type === 'result') {
        result = event as CliResult
        if (event.session_id) sessionId = event.session_id
      }
      try {
        onEvent(event)
      } catch (error) {
        console.error('Handling a Claude Code CLI event failed', error)
      }
    })
    lines.on('close', () => {
      linesClosed = true
      finish()
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_KEEP)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      failed ??= startError(error)
      // A process that never started may not report 'close'.
      if (child.pid === undefined) markExited()
    })
    child.on('close', (exitCode) => {
      code = exitCode
      markExited()
    })
    // The CLI may exit before reading stdin (e.g. a bad flag); that's reported by its exit.
    child.stdin!.on('error', () => {})
    child.stdin!.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`)
  })
}

const LOGIN_PATTERN =
  /not logged in|please run \/login|\/login\b|invalid api key|authentication_error|oauth token|\b401\b/i

/** A sentence for the conversation about a CLI run that ended without a usable result. */
export function describeCliFailure({ code, stderr, result }: CliOutcome): string {
  const text = (result?.result ?? '').trim() || stderr.trim()
  if (LOGIN_PATTERN.test(text)) return CLI_NOT_LOGGED_IN
  const tail = text.slice(-500)
  if (result)
    return `Claude Code CLI error${tail ? `: ${tail}` : ` (${result.subtype ?? 'unknown'})`}`
  return `The Claude Code CLI exited with code ${code ?? 'none'}${tail ? `: ${tail}` : '.'}`
}

/** Whether the CLI starts (`auth status --json`) and is logged in; never rejects. */
export function cliStatus(
  options: CliOptions,
): Promise<{ found: CliCheckStep; loggedIn: CliCheckStep | null }> {
  const spawn = options.spawn ?? nodeSpawn
  const notFound = (error: string) => ({ found: { ok: false, error }, loggedIn: null })
  const login = (loggedIn: CliCheckStep) => ({ found: { ok: true }, loggedIn })
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(options.command, ['auth', 'status', '--json'], {
        env: options.env,
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false,
        windowsHide: true,
      })
    } catch (error) {
      resolve(notFound(startError(error as NodeJS.ErrnoException).message))
      return
    }
    let stdout = ''
    let settled = false
    const done = (value: { found: CliCheckStep; loggedIn: CliCheckStep | null }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      kill(child)
      done(login({ ok: false, error: `The Claude Code CLI (${options.command}) didn't answer.` }))
    }, STATUS_TIMEOUT_MS)
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.on('error', (error: NodeJS.ErrnoException) => done(notFound(startError(error).message)))
    child.on('close', () => {
      let status: { loggedIn?: unknown } | null = null
      try {
        status = JSON.parse(stdout) as { loggedIn?: unknown }
      } catch {
        // handled below
      }
      if (status?.loggedIn === true) done(login({ ok: true }))
      else if (status?.loggedIn === false) done(login({ ok: false, error: CLI_NOT_LOGGED_IN }))
      else {
        done(login({ ok: false, error: `Unexpected answer from ${options.command} auth status.` }))
      }
    })
  })
}

/**
 * The welcome page's test: the CLI starts, is logged in, and answers a fixed one-line request with
 * `model` (no tools, no session) within `timeoutMs`. Never rejects; failures are in the steps.
 */
export async function checkCli(
  options: CliOptions,
  model: ModelId,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CliCheck> {
  const { found, loggedIn } = await cliStatus(options)
  if (!loggedIn?.ok) return { found, loggedIn, answered: null }
  const started = Date.now()
  try {
    await cliComplete(options, {
      model,
      system: 'You are checking that you can be reached. Reply with the single word OK.',
      content: [{ type: 'text', text: 'Reply with OK.' }],
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { found, loggedIn, answered: { ok: true, model, ms: Date.now() - started } }
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? `No answer within ${Math.ceil(timeoutMs / 1000)} s.`
        : error instanceof Error
          ? error.message
          : String(error)
    return { found, loggedIn, answered: { ok: false, model, error: message } }
  }
}

/** An Anthropic tool_result block as MCP tool-call content. */
export function toMcpResult(block: ContentBlock): McpToolResult {
  const raw = (block as { content?: unknown }).content
  const blocks = typeof raw === 'string' ? [{ type: 'text', text: raw }] : (raw as ContentBlock[])
  const content: McpContent[] = []
  for (const item of blocks ?? []) {
    if (item.type === 'text') content.push({ type: 'text', text: String(item['text']) })
    if (item.type === 'image') {
      const source = item['source'] as { media_type: string; data: string }
      content.push({ type: 'image', data: source.data, mimeType: source.media_type })
    }
  }
  return { content, ...((block as { is_error?: boolean }).is_error && { isError: true }) }
}

export interface CliTurn {
  model: ModelId
  system: string
  /** The user message's content blocks (browser state, attachments, text). */
  content: ContentBlock[]
  tools: ApiTool[]
  maxTurns: number
  /** The CLI session to continue, or null for a new one. */
  resume: string | null
  signal: AbortSignal
  /** Runs a tool call from the CLI; returns the tool_result block (errors included). */
  callTool(name: string, input: unknown): Promise<ContentBlock>
  onEvent(event: CliEvent): void
}

/**
 * One user turn through the CLI: starts the MCP server with the turn's tools, writes the CLI's
 * MCP config to a private temp file, runs the CLI, and cleans both up.
 */
export async function runCliTurn(options: CliOptions, turn: CliTurn): Promise<CliOutcome> {
  const server = await startMcpServer({
    name: MCP_SERVER_NAME,
    tools: () =>
      turn.tools.map(({ name, description, input_schema }) => ({
        name,
        description,
        inputSchema: input_schema,
      })),
    call: async (name, args) => toMcpResult(await turn.callTool(name, args)),
  })
  const dir = await mkdtemp(join(tmpdir(), 'antimony-mcp-'))
  try {
    const mcpConfigPath = join(dir, 'mcp.json')
    const config = {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: server.url,
          headers: { Authorization: `Bearer ${server.token}` },
        },
      },
    }
    await writeFile(mcpConfigPath, JSON.stringify(config), { mode: 0o600 })
    const args = runArgs({
      model: turn.model,
      system: turn.system,
      mcpConfigPath,
      tools: turn.tools.map((tool) => tool.name),
      maxTurns: turn.maxTurns,
      resume: turn.resume,
    })
    return await runCliProcess(options, args, turn.content, turn.onEvent, turn.signal)
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}

/** One request without tools or session (history summaries, search); returns the answer text. */
export async function cliComplete(
  options: CliOptions,
  request: { model: ModelId; system: string; content: ContentBlock[]; signal?: AbortSignal },
): Promise<string> {
  const outcome = await runCliProcess(
    options,
    completeArgs(request.model, request.system),
    request.content,
    () => {},
    request.signal,
  )
  const { result } = outcome
  if (result && !result.is_error && typeof result.result === 'string') return result.result
  throw new CliError(describeCliFailure(outcome))
}
