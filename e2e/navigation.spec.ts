import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
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
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Test page</title><h1>Hello from the test server</h1>')
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

/** Clicks File → Open Location… until the text box shows (the UI subscribes after it loads). */
async function openLocation(app: ElectronApplication, window: Page) {
  const location = window.getByRole('textbox', { name: 'Location' })
  await expect(async () => {
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.getMenuItemById('open-location')!.click(),
    )
    await expect(location).toBeFocused({ timeout: 1000 })
  }).toPass()
  return location
}

test('File → Open Location… loads the typed URL in the page view', async () => {
  const app = await electron.launch({ args })
  try {
    const window = await app.firstWindow()
    await expect(window.getByRole('textbox', { name: 'Location' })).toBeHidden()

    const location = await openLocation(app, window)
    await location.fill(`${origin}/hello`)
    await location.press('Enter')

    await expect(location).toBeHidden()
    await expect.poll(() => pageUrls(app)).toContain(`${origin}/hello`)
  } finally {
    await app.close()
  }
})

test('invalid input shows an error and loads nothing', async () => {
  const app = await electron.launch({ args })
  try {
    const window = await app.firstWindow()
    const location = await openLocation(app, window)
    await location.fill('file:///etc/passwd')
    await location.press('Enter')

    await expect(window.getByRole('alert')).toContainText('web address')
    await expect(location).toBeVisible()
    expect(await pageUrls(app)).toEqual([''])

    await location.press('Escape')
    await expect(location).toBeHidden()
  } finally {
    await app.close()
  }
})
