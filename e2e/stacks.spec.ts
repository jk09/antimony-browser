import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { newProfile } from './profile'

const args = ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])]

// A → B → C by links, C′ from B, and a page that opens a new tab.
const pages: Record<string, string> = {
  '/a': '<!doctype html><title>Page A</title><a href="/b">to B</a>',
  '/b': '<!doctype html><title>Page B</title><a href="/c">to C</a> <a href="/c2">to C2</a>',
  '/c': '<!doctype html><title>Page C</title><a href="/other" target="_blank">new tab</a>',
  '/c2': '<!doctype html><title>Page C2</title>',
  '/other': '<!doctype html><title>Other root</title>',
}

let server: Server
let origin: string

test.beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(pages[request.url ?? ''] ?? '<!doctype html><title>Missing</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const env = { ...process.env, ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' }

/** The URL of the page view in the window (the active tab). */
const shownUrl = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const [view] = BrowserWindow.getAllWindows()[0]!.contentView.children
    return (view as Electron.WebContentsView | undefined)?.webContents.getURL() ?? ''
  })

const pageWindow = (app: ElectronApplication, path: string) =>
  expect
    .poll(() => app.windows().find((candidate) => candidate.url() === `${origin}${path}`))
    .toBeTruthy()
    .then(() => app.windows().find((candidate) => candidate.url() === `${origin}${path}`)!)

test('the header shows a branching stack, goes back by clicks and keeps stacks per tab', async () => {
  const profile = newProfile()
  const launch = () => electron.launch({ args: [...args, `--user-data-dir=${profile}`], env })
  let app = await launch()
  try {
    const window = await app.firstWindow()
    const prompt = window.getByRole('textbox', { name: 'Prompt' })
    const tree = window.getByRole('tree', { name: 'Navigation stack' })
    const rows = () =>
      tree
        .getByRole('treeitem')
        .evaluateAll((items) =>
          items.map(
            (item) =>
              `${item.getAttribute('aria-level')}:${item.querySelector('.stack-row-title')!.textContent}${item.getAttribute('aria-current') ? '*' : ''}`,
          ),
        )

    await expect(prompt).toBeVisible()
    await prompt.fill(`${origin}/a`)
    await prompt.press('Enter')
    await (await pageWindow(app, '/a')).getByRole('link', { name: 'to B' }).click()
    await (await pageWindow(app, '/b')).getByRole('link', { name: 'to C', exact: true }).click()
    await expect.poll(rows).toEqual(['1:Page A', '2:Page B', '3:Page C*'])
    await expect(window.getByRole('button', { name: /@page-a/ })).toBeVisible()

    // Clicking A goes back; every row stays, only A is highlighted.
    await tree.getByText('Page A').click()
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/a`)
    await expect.poll(rows).toEqual(['1:Page A*', '2:Page B', '3:Page C'])

    // From B, another link branches: C and C′ are both children of B.
    await tree.getByText('Page B').click()
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/b`)
    await (await pageWindow(app, '/b')).getByRole('link', { name: 'to C2' }).click()
    await expect.poll(rows).toEqual(['1:Page A', '2:Page B', '3:Page C', '3:Page C2*'])

    // A new-tab link starts a new stack; @name switches back to the first one.
    await tree.getByText('Page C', { exact: true }).click()
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/c`)
    await (await pageWindow(app, '/c')).getByRole('link', { name: 'new tab' }).click()
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/other`)
    await expect.poll(rows).toEqual(['1:Other root*'])
    await prompt.fill('@page-a')
    await prompt.press('Enter')
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/c`)
    await expect.poll(rows).toEqual(['1:Page A', '2:Page B', '3:Page C*', '3:Page C2'])
    await app.close()

    // After a restart the current stack comes back at its active page.
    app = await launch()
    // The restored page's view can be created before the chrome UI: pick the UI by its URL.
    const restarted = app
    await expect
      .poll(() => restarted.windows().some((candidate) => !candidate.url().startsWith(origin)))
      .toBe(true)
    const again = restarted.windows().find((candidate) => !candidate.url().startsWith(origin))!
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/c`)
    await again.getByRole('button', { name: /@page-a/ }).click()
    await expect(again.getByRole('dialog', { name: 'Stacks' })).toContainText('@other-root')
  } finally {
    await app.close()
  }
})

/**
 * Presses Ctrl+`key` as real input in the page (or the chrome UI): Playwright's keyboard goes
 * through DevTools and skips `before-input-event`, where the shortcuts are caught.
 */
const pressCtrl = (app: ElectronApplication, keyCode: string, target: 'page' | 'ui') =>
  app.evaluate(
    ({ BrowserWindow }, { keyCode, target }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const [view] = window.contentView.children
      const contents =
        target === 'page' ? (view as Electron.WebContentsView).webContents : window.webContents
      contents.focus()
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] })
    },
    { keyCode, target },
  )

test('closes pages with × and Ctrl+W and opens new stacks at the home page with Ctrl+N', async () => {
  const profile = newProfile()
  const app = await electron.launch({ args: [...args, `--user-data-dir=${profile}`], env })
  try {
    const window = await app.firstWindow()
    const prompt = window.getByRole('textbox', { name: 'Prompt' })
    const tree = window.getByRole('tree', { name: 'Navigation stack' })
    const titles = () =>
      tree.locator('.stack-row-title').evaluateAll((items) => items.map((item) => item.textContent))

    await prompt.fill(`${origin}/a`)
    await prompt.press('Enter')
    await (await pageWindow(app, '/a')).getByRole('link', { name: 'to B' }).click()
    const b = await pageWindow(app, '/b')
    await b.getByRole('link', { name: 'to C', exact: true }).click()
    await expect.poll(titles).toEqual(['Page A', 'Page B', 'Page C'])
    await expect(window.getByRole('button', { name: 'Reload page' })).toHaveAttribute(
      'title',
      /Reload page \((Ctrl|Cmd)\+R\)/,
    )

    // Ctrl+W in the page closes the active page; its parent is shown.
    await pageWindow(app, '/c')
    await pressCtrl(app, 'W', 'page')
    await expect.poll(titles).toEqual(['Page A', 'Page B'])
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/b`)

    // The × of a page closes it with everything below it.
    await tree.getByRole('treeitem').filter({ hasText: 'Page B' }).hover()
    await window.getByRole('button', { name: 'Close Page B' }).click()
    await expect.poll(titles).toEqual(['Page A'])
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/a`)

    // Ctrl+N opens a new stack at the home page.
    await prompt.fill(`/home ${origin}/c2`)
    await prompt.press('Enter')
    await pressCtrl(app, 'N', 'ui')
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/c2`)
    await expect.poll(titles).toEqual(['Page C2'])

    // A second later a spare tab waits at the home page: the next Ctrl+N shows it, focused.
    await window.waitForTimeout(1500)
    await pressCtrl(app, 'N', 'ui')
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/c2`)
    await expect.poll(titles).toEqual(['Page C2'])
    await expect(window.getByRole('button', { name: /^@/ })).toBeVisible()
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => {
          const [view] = BrowserWindow.getAllWindows()[0]!.contentView.children
          return (view as Electron.WebContentsView).webContents.isFocused()
        }),
      )
      .toBe(true)
  } finally {
    await app.close()
  }
})

test('Ctrl+Tab switches to the previous stack on release, and back again', async () => {
  const profile = newProfile()
  const app = await electron.launch({ args: [...args, `--user-data-dir=${profile}`], env })
  try {
    const window = await app.firstWindow()
    const prompt = window.getByRole('textbox', { name: 'Prompt' })
    // The header's stack button only: while the Ctrl+Tab list is still open (it closes a moment after
    // the tab has switched) its rows are buttons named `@…` too, and a broader locator matches them.
    const switcher = window.getByTitle('Switch stack (Ctrl+Tab)')

    // Two stacks: A → B → C, and the page C opens in a new tab.
    await prompt.fill(`${origin}/a`)
    await prompt.press('Enter')
    await (await pageWindow(app, '/a')).getByRole('link', { name: 'to B' }).click()
    await (await pageWindow(app, '/b')).getByRole('link', { name: 'to C', exact: true }).click()
    await (await pageWindow(app, '/c')).getByRole('link', { name: 'new tab' }).click()
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/other`)
    await expect(switcher).toHaveText(/@other-root/)

    /** Ctrl down, Tab `times` times, Ctrl up – as real input in the page or the chrome UI. */
    const ctrlTab = (times: number, target: 'page' | 'ui' = 'page') =>
      app.evaluate(
        ({ BrowserWindow }, { times, target }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          const [view] = window.contentView.children
          const page =
            target === 'page' ? (view as Electron.WebContentsView).webContents : window.webContents
          page.focus()
          page.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] })
          for (let i = 0; i < times; i++) {
            page.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['control'] })
            page.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['control'] })
          }
          page.sendInputEvent({ type: 'keyUp', keyCode: 'Control' })
        },
        { times, target },
      )

    await ctrlTab(1)
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/c`)
    await expect(switcher).toHaveText(/@page-a/)
    // Also with focus in the prompt.
    await prompt.focus()
    await ctrlTab(1, 'ui')
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/other`)
    await expect(switcher).toHaveText(/@other-root/)
    // Twice around two stacks lands on the current one: nothing changes.
    await ctrlTab(2)
    await expect(window.getByRole('dialog', { name: 'Stacks' })).toBeHidden()
    await expect.poll(() => shownUrl(app)).toBe(`${origin}/other`)
  } finally {
    await app.close()
  }
})
