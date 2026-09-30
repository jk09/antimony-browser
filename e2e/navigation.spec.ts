import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

// Chromium refuses to run as root with its sandbox on (e.g. in containers); CI runs as a normal user.
const args = ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])]

let server: Server
let origin: string

test.beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(
      request.url === '/links'
        ? '<!doctype html><title>Links</title><a href="/hello" target="_blank">New window</a>'
        : '<!doctype html><title>Test page</title><h1>Hello from the test server</h1>',
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

/** URLs of every WebContents except the chrome UI's. */
const pageUrls = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, webContents }) => {
    const chromeUi = BrowserWindow.getAllWindows()[0]!.webContents
    return webContents
      .getAllWebContents()
      .filter((contents) => contents !== chromeUi)
      .map((contents) => contents.getURL())
  })

// No API key and no real API: these tests never reach a model.
const env = { ...process.env, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }

// A fresh profile per launch, so prompt history and settings don't leak between tests.
const launch = () =>
  electron.launch({
    args: [...args, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'antimony-e2e-'))}`],
    env,
  })

/** Clicks File → Prompt… until the prompt shows (the UI subscribes after it loads). */
async function openLocation(app: ElectronApplication, window: Page) {
  const location = window.getByRole('textbox', { name: 'Prompt' })
  await expect(async () => {
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('prompt')!.click())
    await expect(location).toBeFocused({ timeout: 1000 })
  }).toPass()
  return location
}

test('File → Prompt… (Ctrl+L) loads a typed URL in the page view', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('textbox', { name: 'Prompt' })).toBeHidden()

    const location = await openLocation(app, window)
    await location.fill(`${origin}/hello`)
    await location.press('Enter')

    await expect(location).toBeHidden()
    await expect.poll(() => pageUrls(app)).toContain(`${origin}/hello`)
  } finally {
    await app.close()
  }
})

test('text that is not a web address goes to the assistant, which needs a key', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    const location = await openLocation(app, window)
    await location.fill('file:///etc/passwd')
    await location.press('Enter')

    await expect(window.getByRole('alert')).toContainText('/key')
    await expect(location).toBeVisible()
    expect(await pageUrls(app)).toEqual([''])

    await location.press('Escape')
    await expect(location).toBeHidden()
  } finally {
    await app.close()
  }
})

test('links that open a new window load in the page view', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    const location = await openLocation(app, window)
    await location.fill(`${origin}/links`)
    await location.press('Enter')
    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/links`])

    const page = app.windows().find((candidate) => candidate.url() === `${origin}/links`)!
    await page.getByRole('link', { name: 'New window' }).click()

    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/hello`])
    expect(app.windows()).toHaveLength(2)
  } finally {
    await app.close()
  }
})
