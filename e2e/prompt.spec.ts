import { mkdtempSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
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

let pages: Server
let origin: string
let anthropic: Server
/** Requests the fake Anthropic API received: headers and parsed body. */
let requests: {
  headers: IncomingMessage['headers']
  body: { messages: { content: Block[] }[]; tools: { name: string }[] }
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

  anthropic = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => (raw += chunk))
    request.on('end', () => {
      const body = JSON.parse(raw)
      requests.push({ headers: request.headers, body })
      const content = script(body.messages, requests.length)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          id: `msg_${requests.length}`,
          type: 'message',
          role: 'assistant',
          model: body.model,
          stop_reason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
          content,
        }),
      )
    })
  })
  await new Promise<void>((resolve) => anthropic.listen(0, '127.0.0.1', resolve))
})

test.beforeEach(() => {
  requests = []
  script = navigateScript
})

test.afterAll(async () => {
  await Promise.all(
    [pages, anthropic].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  )
})

// A fresh profile per launch: settings, history and skills don't leak between tests.
const launch = () =>
  electron.launch({
    args: [...args, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'antimony-e2e-'))}`],
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'sk-ant-e2e-test',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${(anthropic.address() as AddressInfo).port}`,
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

test('a question runs the assistant, which drives the browser; the run replays as a skill', async () => {
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
    expect(requests[0]!.headers['x-api-key']).toBe('sk-ant-e2e-test')
    // Page access is off by default: navigation tools only.
    expect(requests[0]!.body.tools.map((tool) => tool.name)).not.toContain('read_page')

    // Save the run as /testpage and replay it: no model request.
    await window.getByRole('button', { name: /Save as skill/ }).click()
    const form = window.getByRole('form', { name: 'Save as skill' })
    await form.getByPlaceholder('my-skill').fill('testpage')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toBeHidden()

    await prompt.fill(`${origin}/other`)
    await prompt.press('Enter')
    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/other`])

    await openPrompt(app, window)
    await prompt.fill('/testpage')
    await expect(window.getByRole('option', { name: /\/testpage/ })).toBeVisible()
    await prompt.press('Escape')
    await prompt.press('Enter')
    await expect.poll(() => pageUrls(app)).toEqual([`${origin}/hello`])
    expect(requests).toHaveLength(2)
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
    expect((await widths()).page).toBe((await widths()).content)
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
    await expect(panel).not.toContainText('sk-ant-e2e-test')
    // The page view narrows to make room for the panel.
    await expect
      .poll(async () => {
        const { content, page } = await widths()
        return content - page
      })
      .toBeGreaterThanOrEqual(280)
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
