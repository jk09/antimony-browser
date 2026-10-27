import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { newProfile } from './profile'

// Chromium refuses to run as root with its sandbox on (e.g. in containers); CI runs as a normal user.
const args = ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])]

const pages: Record<string, string> = {
  '/article': `<!doctype html><title>Notes</title><nav><a href="/nav">Nav</a></nav>
    <article><h1>WAL</h1><p>Readers do not block writers.</p>
    <p>See <a href="/a">the first page</a>, <a href="/b#part">the second</a> and <a href="/missing">a gone one</a>.</p></article>`,
  '/a': '<!doctype html><title>Checkpoints</title><p>How checkpoints move pages back.</p>',
  '/b': '<!doctype html><title>Recovery</title><p>How a crash is recovered.</p>',
}

let server: Server
let origin: string
const cookies: (string | undefined)[] = []

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? '/').replace(/[?#].*$/, '')
    if (path === '/a' || path === '/b') cookies.push(request.headers.cookie)
    const body = pages[path]
    response.writeHead(body ? 200 : 404, {
      'content-type': 'text/html',
      'set-cookie': 'session=secret; Path=/',
    })
    response.end(body ?? 'not found')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(() => new Promise<void>((done) => server.close(() => done())))

const launch = () =>
  electron.launch({
    args: [...args, `--user-data-dir=${newProfile()}`],
    env: {
      ...process.env,
      CLAUDE_CLI_PATH: resolve(import.meta.dirname, 'fixtures/fake-claude.mjs'),
    },
  })

async function prompt(app: ElectronApplication) {
  const window = await app.firstWindow()
  const location = window.getByRole('textbox', { name: 'Prompt' })
  await expect(async () => {
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('prompt')!.click())
    await expect(location).toBeFocused({ timeout: 1000 })
  }).toPass()
  return { window, location }
}

test('/link-summaries lists the linked pages with summaries in the conversation', async () => {
  const app = await launch()
  try {
    const { window, location } = await prompt(app)
    const url = `${origin}/article`
    await location.fill(url)
    await location.press('Enter')
    await expect.poll(() => app.windows().find((page) => page.url() === url)).toBeTruthy()
    const page = app.windows().find((candidate) => candidate.url() === url)!
    await page.waitForLoadState('load')
    const before = await page.evaluate(() => document.documentElement.outerHTML)

    await location.fill('/page-access on')
    await location.press('Enter')
    await location.fill('/link-summaries')
    await location.press('Enter')

    const conversation = window.getByRole('region', { name: 'Conversation' })
    await expect(conversation).toContainText('Linked pages', { timeout: 20_000 })
    await expect(conversation).toContainText('Fake summary of Checkpoints.')
    await expect(conversation).toContainText('Fake summary of Recovery.')
    await expect(conversation).toContainText('No summary')
    await expect(conversation).not.toContainText('Nav')
    // The page itself is never changed, and prefetching sends none of the site's cookies.
    expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(before)
    expect(cookies.filter(Boolean)).toEqual([])

    await conversation.getByRole('link', { name: 'the first page' }).click()
    await expect.poll(() => app.windows().some((p) => p.url() === `${origin}/a`)).toBe(true)
  } finally {
    await app.close()
  }
})
