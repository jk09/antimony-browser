import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { SendResult } from '../ipc'
import { newIssueUrl, type Issue } from '../shared/report'

export const GH_TIMEOUT_MS = 30_000

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess

/**
 * The GitHub CLI: GH_PATH, else the first `gh` on PATH or in the folders its installers use (apps
 * started from the macOS Dock get a minimal PATH), else plain `gh`.
 */
export function ghCommand(
  env: NodeJS.ProcessEnv,
  {
    platform = process.platform,
    exists = (path: string) => existsSync(path),
  }: { platform?: NodeJS.Platform; exists?: (path: string) => boolean } = {},
): string {
  const configured = env['GH_PATH']?.trim()
  if (configured) return configured
  const name = platform === 'win32' ? 'gh.exe' : 'gh'
  const dirs = [
    ...(env['PATH'] ?? '').split(platform === 'win32' ? ';' : delimiter),
    ...(platform === 'win32'
      ? [join(env['ProgramFiles'] ?? 'C:\\Program Files', 'GitHub CLI')]
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']),
  ]
  for (const dir of dirs) {
    if (dir && exists(join(dir, name))) return join(dir, name)
  }
  return name
}

/**
 * Creates the issue with the user's own `gh` login: fixed arguments, the title as one argument and
 * the body on stdin, no shell. Resolves with the issue's URL; rejects if gh is missing, not logged
 * in, fails or takes longer than `timeoutMs`.
 */
export function ghCreateIssue(
  repo: string,
  issue: Issue,
  {
    command,
    spawn = nodeSpawn,
    timeoutMs = GH_TIMEOUT_MS,
  }: { command: string; spawn?: SpawnFn; timeoutMs?: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(
        command,
        ['issue', 'create', '--repo', repo, '--title', issue.title, '--body-file', '-'],
        {
          env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('gh timed out'))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const url = /https:\/\/github\.com\/\S+\/issues\/\d+/.exec(stdout)?.[0]
      if (code === 0 && url) resolve(url)
      else reject(new Error(stderr.trim() || `gh exited with code ${String(code)}`))
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(issue.body)
  })
}

/**
 * Sends an issue: through `gh` when that works, else by opening GitHub's prefilled new-issue form
 * for the user to submit.
 */
export async function sendIssue(
  repo: string,
  issue: Issue,
  {
    create,
    openExternal,
  }: {
    create: (repo: string, issue: Issue) => Promise<string>
    openExternal: (url: string) => Promise<void>
  },
): Promise<SendResult> {
  try {
    return { via: 'gh', url: await create(repo, issue) }
  } catch (error) {
    console.warn('gh could not create the issue; opening the form instead', error)
  }
  const url = newIssueUrl(repo, issue)
  await openExternal(url)
  return { via: 'form', url }
}
