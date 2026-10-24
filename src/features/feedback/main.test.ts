import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

const electron = vi.hoisted(() => ({
  userData: '',
  appListeners: new Map<string, (...args: unknown[]) => void>(),
  showMessageBox: vi.fn(),
  openExternal: vi.fn(async (_url: string) => {}),
  ghCreateIssue: vi.fn(),
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => electron.userData,
    getVersion: () => '0.1.0',
    on: (event: string, listener: (...args: unknown[]) => void) =>
      electron.appListeners.set(event, listener),
  },
  dialog: { showMessageBox: electron.showMessageBox },
  shell: { openExternal: electron.openExternal },
}))
vi.mock('../../shared/build-info', () => ({ buildCommit: 'abc1234' }))
vi.mock('./main/github', async (original) => ({
  ...(await original<typeof import('./main/github')>()),
  ghCreateIssue: electron.ghCreateIssue,
}))
const { register } = await import('./main')
const { channels } = await import('./ipc')

const processListeners = new Map<string, (...args: unknown[]) => void>()

/** One run of the app; pass the previous run's `userData` to reuse its profile. */
function setup({
  visible = true,
  userData = mkdtempSync(join(tmpdir(), 'antimony-feedback-')),
} = {}) {
  electron.userData = userData
  electron.appListeners.clear()
  processListeners.clear()
  vi.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
    processListeners.set(event, listener)
    return process
  }) as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const windowListeners = new Map<string, () => void>()
  const window = {
    webContents: { id: 1 },
    isDestroyed: () => false,
    isVisible: () => visible,
    once: (event: string, listener: () => void) => windowListeners.set(event, listener),
  }
  register({
    window,
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
  } as unknown as MainContext)
  return {
    window,
    userData,
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
    show: () => windowListeners.get('show')!(),
    gone: (contents: unknown, reason: string, exitCode = 1) =>
      electron.appListeners.get('render-process-gone')!({}, contents, { reason, exitCode }),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  electron.showMessageBox.mockReset()
  electron.ghCreateIssue.mockReset()
  electron.openExternal.mockClear()
})

describe('feedback main', () => {
  it('sends feedback text as an issue through gh', async () => {
    const { call } = setup()
    electron.ghCreateIssue.mockResolvedValue('https://github.com/jk09/antimony-browser/issues/7')
    await expect(call(channels.send, 'Love it\nreally')).resolves.toEqual({
      via: 'gh',
      url: 'https://github.com/jk09/antimony-browser/issues/7',
    })
    const [repo, issue] = electron.ghCreateIssue.mock.calls[0]!
    expect(repo).toBe('jk09/antimony-browser')
    expect(issue.title).toBe('Feedback: Love it')
    expect(issue.body).toContain('Antimony 0.1.0 (abc1234)')
  })

  it('opens the prefilled form when gh fails', async () => {
    const { call } = setup()
    electron.ghCreateIssue.mockRejectedValue(new Error('not logged in'))
    const result = (await call(channels.send, 'hi')) as { via: string; url: string }
    expect(result.via).toBe('form')
    expect(electron.openExternal).toHaveBeenCalledWith(result.url)
  })

  it('rejects empty, long or non-text feedback', async () => {
    const { call } = setup()
    await expect(call(channels.send, '  ')).rejects.toThrow(TypeError)
    await expect(call(channels.send, 'x'.repeat(5001))).rejects.toThrow(TypeError)
    await expect(call(channels.send, 42)).rejects.toThrow(TypeError)
    expect(electron.ghCreateIssue).not.toHaveBeenCalled()
  })

  it('offers a crashed page in a popup and sends it on agreement', async () => {
    const { gone, window } = setup()
    electron.showMessageBox.mockResolvedValue({ response: 0 })
    electron.ghCreateIssue.mockResolvedValue('https://github.com/jk09/antimony-browser/issues/8')
    gone(window.webContents, 'crashed', 139)
    await settle()
    const [, popup] = electron.showMessageBox.mock.calls[0]!
    expect(popup.message).toContain('Send a crash report')
    expect(popup.detail).toContain('chrome UI – crashed, exit code 139')
    expect(popup.buttons).toEqual(['Send report', 'Don’t send'])
    const [, issue] = electron.ghCreateIssue.mock.calls[0]!
    expect(issue.title).toBe('Crash: chrome UI crashed')
    expect(electron.showMessageBox.mock.calls[1]![1].detail).toContain('/issues/8')
  })

  it('ignores renderers that exited on purpose', async () => {
    const { gone } = setup()
    gone({}, 'clean-exit')
    gone({}, 'killed')
    await settle()
    expect(electron.showMessageBox).not.toHaveBeenCalled()
  })

  it('drops the reports when the user declines', async () => {
    const { gone, userData } = setup()
    electron.showMessageBox.mockResolvedValue({ response: 1 })
    gone({}, 'oom')
    await settle()
    expect(electron.showMessageBox).toHaveBeenCalledTimes(1)
    expect(electron.ghCreateIssue).not.toHaveBeenCalled()
    // Nothing is offered again at the next start.
    setup({ userData }).show()
    await settle()
    expect(electron.showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('stores a main-process error without the home folder and offers it at the next start', async () => {
    const { userData } = setup({ visible: false })
    processListeners.get('uncaughtException')!(new Error(`cannot read ${homedir()}/notes.txt`))
    processListeners.get('unhandledRejection')!('lost')
    await settle()
    expect(electron.showMessageBox).not.toHaveBeenCalled()

    electron.showMessageBox.mockResolvedValue({ response: 0 })
    electron.ghCreateIssue.mockResolvedValue('https://github.com/jk09/antimony-browser/issues/9')
    setup({ userData }).show()
    await settle()
    expect(electron.showMessageBox.mock.calls[0]![1].detail).toContain(
      'main – uncaught-exception, Error: cannot read ~/notes.txt',
    )
    const [, issue] = electron.ghCreateIssue.mock.calls[0]!
    expect(issue.title).toBe('Crash: main Error')
    expect(issue.body).toContain('### Crash 2: main')
    expect(issue.body).toContain('unhandled-rejection')
    expect(issue.body).not.toContain(homedir())
  })
})
