import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { newProfile } from './profile'

const args = ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])]

// No Claude Code CLI and no GitHub CLI: issues fall back to the form, which the test intercepts.
const env = {
  ...process.env,
  CLAUDE_CLI_PATH: join(tmpdir(), 'no-such-claude-cli'),
  GH_PATH: join(tmpdir(), 'no-such-gh'),
}

let server: Server
let origin: string

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Test page</title><h1>Hello</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

/**
 * Replaces the popup with "Send report" and the browser opening with a record, so nothing leaves
 * the test. Returns what was recorded so far.
 */
async function intercept(app: ElectronApplication) {
  await app.evaluate(({ dialog, shell }) => {
    const record: { popups: string[]; opened: string[] } = { popups: [], opened: [] }
    Object.assign(globalThis, { feedbackRecord: record })
    shell.openExternal = async (url: string) => {
      record.opened.push(url)
    }
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxOptions
      record.popups.push(`${options.message}\n${options.detail ?? ''}`)
      return { response: 0, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  })
  return () =>
    app.evaluate(
      () =>
        (globalThis as unknown as { feedbackRecord: { popups: string[]; opened: string[] } })
          .feedbackRecord,
    )
}

test('the feedback icon sends feedback; a crashed page offers a crash report', async () => {
  const app = await electron.launch({
    args: [...args, `--user-data-dir=${newProfile()}`],
    env,
  })
  try {
    const window = await app.firstWindow()
    const recorded = await intercept(app)
    const prompt = window.getByRole('textbox', { name: 'Prompt' })
    await expect(prompt).toBeVisible()

    await window.getByRole('button', { name: 'Send feedback' }).click()
    await expect(prompt).toHaveValue('/feedback ')
    await prompt.pressSequentially('The stacks are handy')
    await prompt.press('Escape')
    await prompt.press('Enter')
    await expect(window.getByText('new issue form opened')).toBeVisible()
    const feedbackForm = new URL((await recorded()).opened[0]!)
    expect(feedbackForm.pathname).toBe('/jk09/antimony-browser/issues/new')
    expect(feedbackForm.searchParams.get('title')).toBe('Feedback: The stacks are handy')

    await prompt.fill(`${origin}/`)
    await prompt.press('Enter')
    await expect
      .poll(() =>
        app.evaluate(({ webContents }) =>
          webContents.getAllWebContents().some((c) => c.getURL().startsWith('http://127.0.0.1')),
        ),
      )
      .toBe(true)
    await app.evaluate(async ({ webContents }) => {
      const page = webContents
        .getAllWebContents()
        .find((c) => c.getURL().startsWith('http://127.0.0.1'))!
      page.debugger.attach()
      void page.debugger.sendCommand('Page.crash').catch(() => {})
    })

    await expect.poll(async () => (await recorded()).opened.length).toBe(2)
    const { popups, opened } = await recorded()
    expect(popups[0]).toContain('Send a crash report')
    expect(popups[0]).toContain('page – crashed')
    expect(new URL(opened[1]!).searchParams.get('title')).toBe('Crash: page crashed')
  } finally {
    await app.close()
  }
})
