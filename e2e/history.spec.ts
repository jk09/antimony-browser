import { existsSync } from 'node:fs'
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
import { newProfile } from './profile'

// Chromium refuses to run as root with its sandbox on (e.g. in containers); CI runs as a normal user.
const args = ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])]

const pages: Record<string, string> = {
  '/one':
    '<!doctype html><title>First page</title><p>A zebra crossing.</p><a href="/three">Third</a>',
  '/two': '<!doctype html><title>Second page</title><p>Nothing to see.</p>',
  '/three': '<!doctype html><title>Third page</title><p>Reached by a link.</p>',
  '/spa': `<!doctype html><title>App</title>
    <button onclick="history.pushState({}, '', '/spa/item?utm_source=x'); document.title = 'Item view'">Open item</button>`,
}

let server: Server
let origin: string

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? '/').replace(/\?.*$/, '')
    const body = pages[path] ?? pages['/spa']!
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const env = { ...process.env, CLAUDE_CLI_PATH: join(tmpdir(), 'no-such-claude-cli') }

async function prompt(app: ElectronApplication, window: Page) {
  const location = window.getByRole('textbox', { name: 'Prompt' })
  await expect(async () => {
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('prompt')!.click())
    await expect(location).toBeFocused({ timeout: 1000 })
  }).toPass()
  return location
}

const pageView = (app: ElectronApplication, url: string) =>
  expect.poll(() => app.windows().find((candidate) => candidate.url() === url))

test('records visited pages, finds them by text, notes them as bookmarks', async () => {
  const userData = newProfile()
  const app = await electron.launch({ args: [...args, `--user-data-dir=${userData}`], env })
  try {
    const window = await app.firstWindow()
    const location = await prompt(app, window)
    for (const path of ['/one', '/two', '/one']) {
      await location.fill(`${origin}${path}`)
      await location.press('Enter')
      await pageView(app, `${origin}${path}`).toBeTruthy()
    }
    // A link click, and an in-page navigation of a single-page app after a click.
    const first = app.windows().find((candidate) => candidate.url() === `${origin}/one`)!
    await first.waitForLoadState('load')
    // History reads the page's text when it has loaded.
    await window.waitForTimeout(300)
    await first.getByRole('link', { name: 'Third' }).click()
    await pageView(app, `${origin}/three`).toBeTruthy()
    await location.fill(`${origin}/spa`)
    await location.press('Enter')
    await pageView(app, `${origin}/spa`).toBeTruthy()
    const spa = app.windows().find((candidate) => candidate.url() === `${origin}/spa`)!
    await spa.getByRole('button', { name: 'Open item' }).click()
    // The in-page URL becomes a visit once it has stayed for 3 s.
    await window.waitForTimeout(3500)
    expect(existsSync(join(userData, 'history.sqlite'))).toBe(true)

    // The prompt suggests a page reached by a link, by its title.
    await location.fill('127.0.0.1')
    await expect(window.getByRole('listbox', { name: 'Suggestions' })).toContainText('Third page')

    await location.fill('/history')
    await location.press('Enter')
    const view = window.getByRole('region', { name: 'History' })
    const results = view.getByRole('list', { name: 'History results' })
    await expect(results.getByRole('listitem')).toHaveCount(5)
    await expect(results).toContainText('Item view')
    await expect(results).toContainText(`127.0.0.1:${new URL(origin).port}/spa/item`)
    await expect(results).not.toContainText('utm_source')
    await expect(results.getByRole('listitem').filter({ hasText: 'First page' })).toContainText(
      '2 visits',
    )

    const search = view.getByRole('searchbox', { name: 'Search history' })
    await search.fill('zebra')
    await expect(results.getByRole('listitem')).toHaveCount(1)
    await expect(results).toContainText('First page')
    await expect(results.locator('mark')).toHaveText('zebra')

    await results.getByRole('button', { name: 'Add note' }).click()
    await view.getByRole('textbox', { name: 'Note for First page' }).fill('Crossing guide')
    await view.getByRole('button', { name: 'Save note' }).click()
    await expect(results).toContainText('Crossing guide')

    await search.fill('')
    await view.getByRole('checkbox', { name: 'Bookmarks' }).check()
    await expect(view.getByRole('heading')).toHaveText('Bookmarks')
    await expect(results.getByRole('listitem')).toHaveCount(1)
    await expect(results).toContainText('First page')

    await search.press('Escape')
    await expect(view).toBeHidden()
  } finally {
    await app.close()
  }
})
