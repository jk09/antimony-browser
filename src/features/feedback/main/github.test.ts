import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { ghCommand, ghCreateIssue, sendIssue, type SpawnFn } from './github'

const issue = { title: 'Feedback: hi', body: 'hi\n\n### Environment' }

function fakeGh(code: number, stdout: string, stderr = '') {
  const calls: { command: string; args: string[]; stdin: string }[] = []
  const spawn: SpawnFn = (command, args) => {
    const child = new EventEmitter() as ChildProcess
    const stdin = new PassThrough()
    let input = ''
    stdin.on('data', (chunk: Buffer) => (input += chunk.toString()))
    stdin.on('end', () => {
      calls.push({ command, args, stdin: input })
      child.stdout!.emit('data', Buffer.from(stdout))
      child.stderr!.emit('data', Buffer.from(stderr))
      child.emit('close', code)
    })
    Object.assign(child, {
      stdin,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    })
    return child
  }
  return { spawn, calls }
}

describe('ghCommand', () => {
  it('prefers GH_PATH, then PATH and install folders', () => {
    expect(ghCommand({ GH_PATH: '/x/gh' })).toBe('/x/gh')
    expect(ghCommand({ PATH: '/a:/b' }, { platform: 'linux', exists: (p) => p === '/b/gh' })).toBe(
      '/b/gh',
    )
    expect(
      ghCommand({ PATH: '' }, { platform: 'darwin', exists: (p) => p === '/opt/homebrew/bin/gh' }),
    ).toBe('/opt/homebrew/bin/gh')
    expect(ghCommand({}, { platform: 'win32', exists: () => false })).toBe('gh.exe')
  })
})

describe('ghCreateIssue', () => {
  it('passes the title as an argument and the body on stdin, and returns the URL', async () => {
    const gh = fakeGh(0, 'Creating issue\nhttps://github.com/a/b/issues/42\n')
    const url = await ghCreateIssue('a/b', issue, { command: 'gh', spawn: gh.spawn })
    expect(url).toBe('https://github.com/a/b/issues/42')
    expect(gh.calls).toEqual([
      {
        command: 'gh',
        args: ['issue', 'create', '--repo', 'a/b', '--title', 'Feedback: hi', '--body-file', '-'],
        stdin: issue.body,
      },
    ])
  })

  it('rejects when gh fails, with its message', async () => {
    const gh = fakeGh(4, '', 'To get started with GitHub CLI, please run: gh auth login')
    await expect(ghCreateIssue('a/b', issue, { command: 'gh', spawn: gh.spawn })).rejects.toThrow(
      'gh auth login',
    )
  })

  it('rejects when gh is missing', async () => {
    const spawn: SpawnFn = () => {
      const child = new EventEmitter() as ChildProcess
      Object.assign(child, { stdin: new PassThrough(), stdout: null, stderr: null })
      setTimeout(() => child.emit('error', new Error('spawn gh ENOENT')))
      return child
    }
    await expect(ghCreateIssue('a/b', issue, { command: 'gh', spawn })).rejects.toThrow('ENOENT')
  })
})

describe('sendIssue', () => {
  it('uses gh when it works', async () => {
    const openExternal = vi.fn(async () => {})
    const result = await sendIssue('a/b', issue, {
      create: async () => 'https://github.com/a/b/issues/1',
      openExternal,
    })
    expect(result).toEqual({ via: 'gh', url: 'https://github.com/a/b/issues/1' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens the prefilled form otherwise', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const openExternal = vi.fn(async (_url: string) => {})
    const result = await sendIssue('a/b', issue, {
      create: async () => {
        throw new Error('no gh')
      },
      openExternal,
    })
    expect(result.via).toBe('form')
    expect(result.url).toMatch(/^https:\/\/github\.com\/a\/b\/issues\/new\?title=Feedback/)
    expect(openExternal).toHaveBeenCalledWith(result.url)
  })
})
