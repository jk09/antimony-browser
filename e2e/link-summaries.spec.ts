import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { newProfile } from './profile'

// Chromium refuses to run as root with its sandbox on (e.g. in containers); CI runs as a normal user.
const args = ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])]

const text = 'Readers do not block writers and writers do not block readers. '.repeat(30)
const pages: Record<string, string> = {
  '/article': `<!doctype html><title>Notes</title><nav><a href="/nav">Nav</a></nav>
    <article><h1>WAL</h1><p>${text}</p>
    <p>See <a href="/a">the first page</a>, <a href="/b#part">the second</a> and <a href="/missing">a gone one</a>.</p></article>`,
  '/a': '<!doctype html><title>Checkpoints</title><p>How checkpoints move pages back.</p>',
  '/b': '<!doctype html><title>Recovery</title><p>How a crash is recovered.</p>',
  '/short': '<!doctype html><title>Short</title><p>Tiny.</p><a href="/a">A</a>',
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

async function open(app: ElectronApplication, url: string) {
  const window = await app.firstWindow()
  const location = window.getByRole('textbox', { name: 'Prompt' })
  await expect(async () => {
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('prompt')!.click())
    await expect(location).toBeFocused({ timeout: 1000 })
  }).toPass()
  await location.fill(url)
  await location.press('Enter')
  await expect.poll(() => app.windows().find((page) => page.url() === url)).toBeTruthy()
  return app.windows().find((page) => page.url() === url)!
}

/** Clicks File → Link Summaries once the menu is built; returns whether it is now checked. */
const toggle = async (app: ElectronApplication) => {
  await app.firstWindow()
  await expect
    .poll(() =>
      app.evaluate(({ Menu }) => !!Menu.getApplicationMenu()?.getMenuItemById('link-summaries')),
    )
    .toBe(true)
  return app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.getMenuItemById('link-summaries')!
    item.click()
    return item.checked
  })
}

/** The tooltip's text, read in the feature's isolated world (the page itself can't see it). */
const tooltipText = (app: ElectronApplication, url: string) =>
  app.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
    return page.executeJavaScriptInIsolatedWorld(1003, [
      {
        code: `(() => { const t = window.__antimonyLinkSummaries?.tooltip; return t && !t.hidden ? t.textContent : null })()`,
      },
    ])
  }, url)

test('marks the links of a simple page and shows their summaries as tooltips', async () => {
  const app = await launch()
  try {
    expect(await toggle(app)).toBe(true)
    // The browsing session has a cookie for the site; prefetching must not send it.
    const short = await open(app, `${origin}/short`)
    await short.waitForLoadState('load')
    const url = `${origin}/article`
    const page = await open(app, url)
    const marked = page.locator('a[data-antimony-summary]')
    await expect(marked).toHaveCount(2, { timeout: 20_000 })
    await expect(page.locator('a[href="/missing"]')).not.toHaveAttribute('data-antimony-summary')
    await expect(page.locator('nav a')).not.toHaveAttribute('data-antimony-summary')
    // The page can't read the summaries.
    expect(await page.evaluate(() => document.documentElement.textContent)).not.toContain(
      'Fake summary',
    )
    expect(cookies.filter(Boolean)).toEqual([])

    await page.locator('a[href="/a"]').hover()
    await expect.poll(() => tooltipText(app, url)).toContain('Fake summary of Checkpoints.')
    await page.locator('a[href="/b#part"]').focus()
    await expect.poll(() => tooltipText(app, url)).toContain('Fake summary of Recovery.')

    expect(await toggle(app)).toBe(false)
    await expect(marked).toHaveCount(0)
  } finally {
    await app.close()
  }
})
