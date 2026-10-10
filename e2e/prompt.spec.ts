import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
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

let pages: Server
let origin: string
let model: Server
/** The model steps the fake Claude Code CLI asked for (FAKE_CLAUDE_MODEL_URL). */
let requests: {
  body: {
    model: string
    hasApiKey: boolean
    messages: { content: Block[] }[]
    tools: { name: string }[]
  }
}[]

type Block = { type: string; [key: string]: unknown }
/** The fake model: the content of its next reply, given the conversation so far. */
type Script = (messages: { content: Block[] }[], request: number) => Block[]
const toolUse = (id: string, name: string, input: object): Block => ({
  type: 'tool_use',
  id,
  name,
  input,
})

/** Navigates to /hello, then answers. */
const navigateScript: Script = (messages) =>
  messages.at(-1)!.content.some((block) => block.type === 'tool_result')
    ? [{ type: 'text', text: 'Opened the test page.' }]
    : [toolUse('toolu_1', 'navigate', { url: `${origin}/hello` })]
let script: Script

test.beforeAll(async () => {
  pages = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(
      request.url === '/hello'
        ? '<!doctype html><title>Test page</title><h1>Hello from the test server</h1>'
        : request.url === '/form'
          ? `<!doctype html><title>Form</title>
             <input id="q" aria-label="Search"> <input id="pw" type="password" aria-label="Password">
             <a id="go" href="/hello">Go to hello</a>`
          : '<!doctype html><title>Other</title><p>Another page</p>',
    )
  })
  await new Promise<void>((resolve) => pages.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(pages.address() as AddressInfo).port}`

  // The model behind the fake Claude Code CLI: each step's content, from the test's script.
  model = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => {
      const body = JSON.parse(raw)
      requests.push({ body })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ content: script(body.messages, requests.length) }))
    })
  })
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
})

test.beforeEach(() => {
  requests = []
  script = navigateScript
})

test.afterAll(async () => {
  await Promise.all(
    [pages, model].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

// A fresh profile per launch: settings, history and skills don't leak between tests. The assistant
// runs through the fake Claude Code CLI; an API key in the environment must never reach it.
const launch = (env: Record<string, string> = {}, profile = newProfile()) =>
  electron.launch({
    args: [...args, `--user-data-dir=${profile}`],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'sk-ant-e2e-test',
      CLAUDE_CLI_PATH: resolve(import.meta.dirname, 'fixtures/fake-claude.mjs'),
      FAKE_CLAUDE_MODEL_URL: `http://127.0.0.1:${(model.address() as AddressInfo).port}/`,
      ...env,
    },
  })

const pageUrls = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow, webContents }) => {
    const chromeUi = BrowserWindow.getAllWindows()[0]!.webContents
    return webContents
      .getAllWebContents()
      .filter((contents) => contents !== chromeUi)
      .map((contents) => contents.getURL())
  })

/** Bounds of the page view, or null before the first page is loaded. */
const pageBounds = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    const [view] = window.contentView.children
    return view ? { ...view.getBounds(), windowWidth: window.getContentSize()[0]! } : null
  })

async function openPrompt(app: ElectronApplication, window: Page) {
  const prompt = window.getByRole('textbox', { name: 'Prompt' })
  await expect(async () => {
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('prompt')!.click())
    await expect(prompt).toBeFocused({ timeout: 1000 })
  }).toPass()
  return prompt
}

test('a URL navigates without any model request', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    const prompt = await openPrompt(app, window)
    await prompt.fill(`${origin}/hello`)
    await prompt.press('Enter')
    await expect.poll(() => pageUrls(app)).toContain(`${origin}/hello`)
    expect(requests).toHaveLength(0)
  } finally {
    await app.close()
  }
})

test('zooming the chrome UI keeps the page view next to the assistant panel', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    const prompt = await openPrompt(app, window)
    await prompt.fill(`${origin}/hello`)
    await prompt.press('Enter')
    await expect.poll(() => pageUrls(app)).toContain(`${origin}/hello`)

    const zoom = (label: string) =>
      app.evaluate(({ BrowserWindow, Menu }, label) => {
        const view = Menu.getApplicationMenu()!.items.find((item) => item.label === 'View')!
        view.submenu!.items.find((item) => item.label === label && item.visible)!.click()
        return BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor()
      }, label)
    // The page view's right edge and the panel's left edge, both in window pixels.
    const edges = async () => {
      const factor = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
      )
      const page = (await pageBounds(app))!
      const panel = (await window.getByRole('complementary', { name: 'Assistant' }).boundingBox())!
      return {
        page: page.x + page.width,
        panel: Math.round(panel.x * factor),
      }
    }
    const meets = async () => {
      const { page, panel } = await edges()
      return Math.abs(page - panel) <= 1
    }

    expect(await zoom('Zoom Out')).toBeCloseTo(0.9)
    expect(await zoom('Zoom Out')).toBeCloseTo(0.8)
    await expect.poll(meets).toBe(true)
    expect(await zoom('Zoom In')).toBeCloseTo(0.9)
    expect(await zoom('Zoom In')).toBeCloseTo(1)
    expect(await zoom('Zoom In')).toBeCloseTo(1.1)
    await expect.poll(meets).toBe(true)
    expect(await zoom('Actual Size')).toBe(1)
    await expect.poll(meets).toBe(true)
  } finally {
    await app.close()
  }
})

test('the menu bar is hidden; its shortcuts work and /menu runs its items', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    const prompt = await openPrompt(app, window)
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.isMenuBarVisible(),
      ),
    ).toBe(process.platform === 'darwin')
    await prompt.fill(`${origin}/hello`)
    await prompt.press('Enter')
    await expect.poll(() => pageUrls(app)).toContain(`${origin}/hello`)

    // Ctrl+L pressed in the page still reaches the hidden menu's accelerator.
    const pressInPage = (keys: { keyCode: string; modifiers?: ['control'] }[]) =>
      app.evaluate(({ BrowserWindow }, keys) => {
        const [view] = BrowserWindow.getAllWindows()[0]!.contentView.children
        const page = (view as Electron.WebContentsView).webContents
        page.focus()
        for (const key of keys) {
          page.sendInputEvent({ type: 'keyDown', ...key })
          page.sendInputEvent({ type: 'keyUp', ...key })
        }
      }, keys)
    await pressInPage([{ keyCode: 'L', modifiers: ['control'] }])
    await expect(prompt).toBeFocused()

    // Ctrl+B in the page hides the assistant and keeps the page focused; again shows it.
    const assistant = window.getByRole('complementary', { name: 'Assistant' })
    await pressInPage([{ keyCode: 'B', modifiers: ['control'] }])
    await expect(assistant).toBeHidden()
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => {
          const [view] = BrowserWindow.getAllWindows()[0]!.contentView.children
          return (view as Electron.WebContentsView).webContents.isFocused()
        }),
      )
      .toBe(true)
    await pressInPage([{ keyCode: 'B', modifiers: ['control'] }])
    await expect(assistant).toBeVisible()
    await expect(prompt).toBeFocused()

    // Alt shows the menu bar (Windows, Linux); the page view shrinks with the window's content.
    const layout = () =>
      app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!
        const [view] = window.contentView.children
        return {
          menuBar: window.isMenuBarVisible(),
          fits: view!.getBounds().height === window.getContentSize()[1],
        }
      })
    if (process.platform !== 'darwin') {
      await pressInPage([{ keyCode: 'Alt' }])
      await expect.poll(layout).toEqual({ menuBar: true, fits: true })
      // Alt again or a click hides it, but the shown menu bar takes the keys sendInputEvent sends.
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setMenuBarVisibility(false),
      )
      await expect.poll(layout).toEqual({ menuBar: false, fits: true })
      await openPrompt(app, window)
    }

    // /menu walks the menu level by level with suggestions, then runs the item.
    await prompt.fill('/menu v')
    await prompt.press('Tab')
    await expect(prompt).toHaveValue('/menu view ')
    await expect(window.getByRole('option', { name: /View › Zoom In/ })).toBeVisible()
    await prompt.fill('/menu view zoom-i')
    await prompt.press('Tab')
    await expect(prompt).toHaveValue('/menu view zoom-in')
    await prompt.press('Enter')
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor(),
        ),
      )
      .toBeCloseTo(1.1)
    await expect(prompt).toHaveValue('')

    await prompt.fill('/menu view nope')
    await prompt.press('Enter')
    await expect(window.getByRole('alert')).toContainText('Pick one of:')
    expect(requests).toHaveLength(0)
  } finally {
    await app.close()
  }
})

test('Ctrl+B hides and shows the assistant, and the page view follows each time', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    const prompt = await openPrompt(app, window)
    await prompt.fill(`${origin}/hello`)
    await prompt.press('Enter')
    await expect.poll(() => pageUrls(app)).toContain(`${origin}/hello`)

    const assistant = window.getByRole('complementary', { name: 'Assistant' })
    /** Presses Ctrl+B in the page view or in the chrome UI, as keyboard input to that view. */
    const pressB = (target: 'page' | 'chrome', repeat = false) =>
      app.evaluate(
        ({ BrowserWindow }, { target, repeat }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          const [view] = window.contentView.children
          const contents =
            target === 'page' ? (view as Electron.WebContentsView).webContents : window.webContents
          contents.focus()
          const key = { keyCode: 'B', modifiers: ['control'] as ['control'] }
          contents.sendInputEvent({ type: 'keyDown', ...key })
          if (repeat) {
            contents.sendInputEvent({
              type: 'keyDown',
              ...key,
              modifiers: ['control', 'isautorepeat'],
            })
          }
          contents.sendInputEvent({ type: 'keyUp', ...key })
        },
        { target, repeat },
      )
    // The page view fills the window's width when hidden, and ends where the panel starts when shown.
    const fullWidth = async () => {
      const page = (await pageBounds(app))!
      return page.x === 0 && page.width === page.windowWidth
    }
    const besidePanel = async () => {
      const page = (await pageBounds(app))!
      const panel = await assistant.boundingBox()
      return (
        panel !== null &&
        page.width < page.windowWidth &&
        Math.abs(page.x + page.width - Math.round(panel.x)) <= 1
      )
    }
    const hidden = async () => {
      await expect(assistant).toBeHidden()
      await expect.poll(fullWidth).toBe(true)
    }
    const shown = async () => {
      await expect(assistant).toBeVisible()
      await expect.poll(besidePanel).toBe(true)
      await expect(prompt).toBeFocused()
    }

    await expect.poll(besidePanel).toBe(true)
    // Covered by a full-width page view, a throttled chrome UI is marked hidden and stops
    // rendering, so it never reports the page area shrinking when the panel comes back. Playwright
    // can't show that: while it is attached the chrome UI counts as captured and is never hidden.
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.getBackgroundThrottling(),
      ),
    ).toBe(false)
    // From the page, several times over: each press toggles once and the page view follows.
    for (let round = 0; round < 3; round++) {
      await pressB('page')
      await hidden()
      await pressB('page')
      await shown()
    }
    // From the prompt (chrome UI focused), then back from the page.
    await pressB('chrome')
    await hidden()
    await pressB('page')
    await shown()
    // A held key doesn't toggle again.
    await pressB('page', true)
    await hidden()
    await pressB('page', true)
    await shown()
    // Ctrl+L shows a hidden panel too.
    await pressB('page')
    await hidden()
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById('prompt')!.click())
    await shown()
    // A resized panel comes back at its new width.
    await assistant.getByRole('separator', { name: 'Resize assistant' }).focus()
    await window.keyboard.press('ArrowLeft')
    await window.keyboard.press('ArrowLeft')
    await expect.poll(besidePanel).toBe(true)
    const width = (await assistant.boundingBox())!.width
    await pressB('page')
    await hidden()
    await pressB('page')
    await shown()
    expect((await assistant.boundingBox())!.width).toBe(width)
  } finally {
    await app.close()
  }
})

test('a question runs the assistant, which drives the browser and stores the action as a macro', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    const prompt = await openPrompt(app, window)
    await prompt.fill('open the test page')
    await prompt.press('Enter')

    const conversation = window.getByRole('region', { name: 'Conversation' })
    await expect(conversation).toContainText('Opened the test page.')
    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/hello`])
    expect(requests).toHaveLength(2)
    // Through the CLI, with its own login: Antimony's environment key is stripped.
    expect(requests[0]!.body.hasApiKey).toBe(false)
    // Page access is off by default: navigation tools only.
    expect(requests[0]!.body.tools.map((tool) => tool.name)).not.toContain('read_page')

    // The page sits left of the assistant panel and keeps its size while the conversation grows.
    await expect(window.getByRole('status')).toHaveCount(0)
    const before = (await pageBounds(app))!
    expect(before).toMatchObject({ x: 0, y: 0 })
    expect(before.width).toBeLessThan(before.windowWidth - 250)
    await prompt.fill('open the test page again, please')
    await prompt.press('Enter')
    await expect(conversation.getByText('Opened the test page.')).toHaveCount(2)
    await expect(window.getByRole('status')).toHaveCount(0)
    await expect.poll(() => pageBounds(app)).toEqual(before)
    requests.length = 0

    // No way to save a run by hand: the assistant stores macros when asked.
    await expect(window.getByRole('button', { name: /Save as skill/ })).toHaveCount(0)
    script = (messages) =>
      messages.at(-1)!.content.some((block) => block.type === 'tool_result')
        ? [{ type: 'text', text: 'Saved /testpage <path>.' }]
        : [
            toolUse('toolu_2', 'save_macro', {
              name: 'testpage',
              description: 'Open a test page',
              params: [{ name: 'path', hint: 'page path' }],
              steps: [{ tool: 'navigate', input: { url: `${origin}/{{path}}` } }],
            }),
          ]
    await prompt.fill('store opening a test page as macro /testpage, with the path as parameter')
    await prompt.press('Enter')
    await expect(conversation).toContainText('Saved /testpage <path>.')
    expect(requests[0]!.body.tools.map((tool) => tool.name)).toContain('save_macro')
    requests.length = 0

    await prompt.fill(`${origin}/other`)
    await prompt.press('Enter')
    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/other`])

    // Typing the macro hints its argument and runs it without the model.
    await openPrompt(app, window)
    await prompt.fill('/testpage')
    await expect(window.getByRole('option', { name: /\/testpage/ })).toBeVisible()
    await expect(window.getByTestId('prompt-hint')).toContainText('<path: page path>')
    await prompt.press('Escape')
    await prompt.fill('/testpage hello')
    await prompt.press('Enter')
    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/hello`])
    expect(requests).toHaveLength(0)
  } finally {
    await app.close()
  }
})

test('the model picker offers the Claude model strengths, all run through the CLI', async () => {
  const app = await launch({ FAKE_CLAUDE_MODEL_URL: '' })
  try {
    const window = await app.firstWindow()
    const prompt = await openPrompt(app, window)
    const picker = window.getByRole('combobox', { name: 'Model' })
    await expect(picker.getByRole('option')).toHaveText(['Haiku 4.5', 'Sonnet 5.5', 'Opus 5.5'])
    await expect(picker).toHaveValue('claude-sonnet-5-5')
    await picker.selectOption('claude-haiku-4-5')
    await expect(picker).toHaveValue('claude-haiku-4-5')

    // The fake CLI without a model script: "open <url>" calls navigate over MCP.
    await prompt.fill(`open ${origin}/hello`)
    await prompt.press('Enter')
    const conversation = window.getByRole('region', { name: 'Conversation' })
    await expect(conversation).toContainText(`Opened ${origin}/hello`)
    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/hello`])
  } finally {
    await app.close()
  }
})

test('a fresh profile opens the welcome page, which tests the CLI and picks the model', async () => {
  const app = await launch({}, newProfile({ welcome: true }))
  try {
    const window = await app.firstWindow()
    const welcome = window.getByRole('region', { name: 'Welcome' })
    await expect(welcome).toBeVisible()
    // The page area is covered: the welcome page takes the place of the page view.
    await welcome.getByRole('button', { name: 'No, not yet' }).click()
    await expect(welcome).toContainText('npm install -g @anthropic-ai/claude-code')
    await welcome.getByRole('button', { name: /installed it – test it/ }).click()
    const checks = welcome.getByRole('status', { name: 'Claude Code CLI test' })
    await expect(checks).toContainText(/Answers with Sonnet 5\.5 in \d+\.\d s/)
    await expect(checks.getByRole('listitem')).toHaveCount(3)
    for (const line of await checks.getByRole('listitem').all()) {
      await expect(line).toHaveAttribute('data-state', 'ok')
    }
    // The test request had no browsing data and no tools.
    expect(requests).toHaveLength(0)

    await welcome.getByRole('button', { name: 'Next' }).click()
    await welcome.getByRole('radio', { name: /Opus 5\.5/ }).check()
    await expect(window.getByRole('combobox', { name: 'Model' })).toHaveValue('claude-opus-5-5')
    await welcome.getByRole('button', { name: 'Next' }).click()
    await expect(welcome).toContainText('Using the prompt')
    await welcome.getByRole('button', { name: 'Next' }).click()
    await expect(welcome).toContainText('store it as /wiki')
    await welcome.getByRole('button', { name: 'Start browsing' }).click()
    await expect(welcome).toBeHidden()

    // /welcome brings it back.
    const prompt = await openPrompt(app, window)
    await prompt.fill('/welcome')
    await prompt.press('Enter')
    await expect(welcome).toBeVisible()
  } finally {
    await app.close()
  }
})

test('the debugger shows requests, responses and tool calls', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    const prompt = await openPrompt(app, window)
    await prompt.fill('open the test page')
    await prompt.press('Enter')
    await expect(window.getByRole('region', { name: 'Conversation' })).toContainText('Opened')

    const widths = () =>
      app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!
        const [content = 0] = window.getContentSize()
        return { content, page: window.contentView.children[0]?.getBounds().width ?? 0 }
      })
    // The assistant panel takes the right edge (400 px at start).
    // Polled: the page view's bounds follow the chrome UI's reported insets, which can arrive a
    // moment after the conversation finishes (CI once measured 404 instead of 400 here).
    await expect
      .poll(async () => {
        const { content, page } = await widths()
        return content - page
      })
      .toBe(400)
    const start = await widths()
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.getMenuItemById('toggle-debugger')!.click(),
    )
    const panel = window.getByRole('complementary', { name: 'Assistant debugger' })
    await expect(panel).toBeVisible()
    for (const type of ['request', 'response', 'tool-call', 'tool-result', 'done']) {
      await expect(
        panel.locator('.debug-type', { hasText: new RegExp(`^${type}$`) }).first(),
      ).toBeVisible()
    }
    // The page view narrows to make room for the debugger, next to the assistant panel.
    await expect.poll(async () => start.page - (await widths()).page).toBeGreaterThanOrEqual(280)
  } finally {
    await app.close()
  }
})

test('with page access, the assistant reads the page and acts on it only after approval', async () => {
  script = (messages, request) => {
    switch (request) {
      case 1:
        return [toolUse('t1', 'read_page', {}), toolUse('t2', 'screenshot', {})]
      case 2:
        return [
          toolUse('t3', 'type_text', { selector: '#pw', text: 'hunter2' }),
          toolUse('t4', 'type_text', { selector: '#q', text: 'cats' }),
        ]
      case 3:
        return [toolUse('t5', 'click', { selector: '#go' })]
      default:
        return [{ type: 'text', text: `Done after ${messages.length} messages.` }]
    }
  }
  const app = await launch()
  try {
    const window = await app.firstWindow()
    const prompt = await openPrompt(app, window)
    await prompt.fill(`${origin}/form`)
    await prompt.press('Enter')
    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/form`])

    await openPrompt(app, window)
    await window.getByRole('button', { name: 'Page access off' }).click()
    await expect(window.getByRole('button', { name: 'Page access on' })).toBeVisible()
    await prompt.fill('search for cats, then go to hello')
    await prompt.press('Enter')

    // Typing into the search field needs approval; the password field is refused without asking.
    const approval = window.getByRole('alertdialog', { name: 'Approve action' })
    await expect(approval).toContainText('Type "cats" into')
    await approval.getByRole('button', { name: 'Allow', exact: true }).click()

    // The click asks again; meanwhile the text is in the search field, not the password field.
    await expect(approval).toContainText('Click link "Go to hello"')
    const page = app.windows().find((candidate) => candidate.url() === `${origin}/form`)!
    await expect(page.locator('#q')).toHaveValue('cats')
    await expect(page.locator('#pw')).toHaveValue('')
    await approval.getByRole('button', { name: 'Allow', exact: true }).click()
    await expect(window.getByRole('region', { name: 'Conversation' })).toContainText('Done after')

    // read_page and screenshot results reached the model, page content marked as untrusted.
    const readResults = JSON.stringify(requests[1]!.body.messages.at(-1))
    expect(readResults).toContain('<untrusted_page_content>')
    expect(readResults).toContain('#go')
    expect(readResults).toContain('"media_type":"image/jpeg"')
    const typeResults = JSON.stringify(requests[2]!.body.messages.at(-1))
    expect(typeResults).toContain('Refused: this is a password or payment field')
    expect(requests[0]!.body.tools.map((tool) => tool.name)).toContain('click')

    // The click followed the link.
    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/hello`])
    await expect(window.getByRole('alertdialog')).toBeHidden()
  } finally {
    await app.close()
  }
})
