import { describe, expect, it, vi } from 'vitest'
import type { AgentState, DebugEvent } from '../ipc'
import { Agent, elideImages, MAX_STEPS, siteOf, type AgentDeps } from './agent'
import type { ContentBlock, ModelRequest, ModelResponse } from './anthropic'
import { fakeBrowser } from './fake-browser'

const response = (content: ContentBlock[], stop_reason = 'end_turn'): ModelResponse => ({
  id: 'msg',
  model: 'claude-sonnet-5-5',
  content,
  stop_reason,
  usage: { input_tokens: 1, output_tokens: 1 },
})
const toolUse = (id: string, name: string, input: unknown): ContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
})

function setup(
  replies: ((request: ModelRequest, signal: AbortSignal) => Promise<ModelResponse>)[],
  options: {
    pageAccess?: boolean
    hasKey?: boolean
    elements?: Parameters<typeof fakeBrowser>[0]
  } = {},
) {
  const { browser, state } = fakeBrowser(options.elements)
  const requests: ModelRequest[] = []
  const states: AgentState[] = []
  const events: DebugEvent[] = []
  const settings = { model: 'claude-sonnet-5-5' as const, pageAccess: options.pageAccess ?? false }
  const deps: AgentDeps = {
    callModel: vi.fn((request, signal) => {
      // Snapshot: the agent keeps appending to the same array.
      requests.push({ ...request, messages: structuredClone(request.messages) })
      const next = replies.shift()
      if (!next) throw new Error('no more replies')
      return next(request, signal)
    }),
    browser: () => browser,
    settings: () => settings,
    hasKey: () => options.hasKey ?? true,
    onState: (value) => states.push(structuredClone(value)),
    onDebug: (event) => events.push(event),
  }
  const agent = new Agent(deps)
  return { agent, browser, state, requests, states, events, settings, deps }
}

const input = (text: string) => ({ text, attachments: [] })
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 1))
  expect(check()).toBe(true)
}

describe('Agent.run', () => {
  it('runs tools the model calls and shows the final answer', async () => {
    const { agent, browser, requests } = setup([
      async () => response([toolUse('t1', 'navigate', { url: 'example.com' })], 'tool_use'),
      async () => response([{ type: 'text', text: 'Opened example.com.' }]),
    ])
    await agent.run(input('open example.com'))

    expect(browser.load).toHaveBeenCalledWith('example.com')
    expect(requests).toHaveLength(2)
    const results = requests[1]!.messages.at(-1)!
    expect(results.role).toBe('user')
    expect(results.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' })
    const { items, status, savableSteps } = agent.state()
    expect(status).toBe('idle')
    expect(items.map((item) => item.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(items[1]).toMatchObject({ status: 'ok', summary: 'Open example.com' })
    expect(items[2]).toMatchObject({ text: 'Opened example.com.' })
    expect(savableSteps).toBe(1)
    expect(agent.savableSteps()).toEqual([{ tool: 'navigate', input: { url: 'example.com' } }])
  })

  it('starts each user turn with the browser state and sends attachments as blocks', async () => {
    const { agent, requests, state } = setup([async () => response([{ type: 'text', text: 'ok' }])])
    state.url = 'https://a.com/'
    state.title = 'A'
    await agent.run({
      text: 'what is this?',
      attachments: [
        { kind: 'image', name: 'shot.png', mediaType: 'image/png', data: 'AAAA' },
        { kind: 'text', name: 'Pasted text', text: 'long text' },
      ],
    })
    const [state0, image, pasted, text] = requests[0]!.messages[0]!.content as {
      type: string
      text?: string
    }[]
    expect(state0!.text).toMatch(
      /^<browser_state>\nURL: https:\/\/a.com\/\nTitle: <untrusted_page_content>/,
    )
    expect(state0!.text).toContain('Page access: off')
    expect(image).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    })
    expect(pasted!.text).toContain('long text')
    expect(text).toEqual({ type: 'text', text: 'what is this?' })
  })

  it('offers no page tools and refuses page tool calls while page access is off', async () => {
    const { agent, requests, browser } = setup([
      async () => response([toolUse('t1', 'read_page', {})], 'tool_use'),
      async () => response([{ type: 'text', text: 'I need page access.' }]),
    ])
    browser.load('example.com')
    await agent.run(input('summarize'))
    expect(requests[0]!.tools.map((tool) => tool.name)).not.toContain('read_page')
    expect(browser.run).not.toHaveBeenCalled()
    expect(requests[1]!.messages.at(-1)!.content[0]).toMatchObject({
      is_error: true,
      content: expect.stringContaining('Page access is off'),
    })
    expect(JSON.stringify(requests)).not.toContain('Hello')
  })

  it('waits for approval before a page action and runs it when allowed', async () => {
    const { agent, browser, states } = setup(
      [
        async () => response([toolUse('t1', 'click', { selector: '#buy' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'Clicked.' }]),
      ],
      {
        pageAccess: true,
        elements: {
          '#buy': { found: true, tag: 'button', role: 'button', name: 'Buy', x: 5, y: 6 },
        },
      },
    )
    browser.load('shop.example')
    const running = agent.run(input('buy it'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    expect(agent.state().approval!.description).toBe('Click button "Buy" (#buy)')
    expect(browser.click).not.toHaveBeenCalled()
    expect(states.some((s) => s.status === 'awaiting-approval')).toBe(true)

    agent.approve('allow')
    await running
    expect(browser.click).toHaveBeenCalledWith(5, 6)
    expect(agent.state().items.find((item) => item.kind === 'approval')).toMatchObject({
      decision: 'allow',
    })
  })

  it('tells the model when the user denies an action', async () => {
    const { agent, browser, requests } = setup(
      [
        async () => response([toolUse('t1', 'click', { selector: '#buy' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'OK, not clicking.' }]),
      ],
      { pageAccess: true, elements: { '#buy': { found: true, tag: 'button', x: 5, y: 6 } } },
    )
    browser.load('shop.example')
    const running = agent.run(input('buy it'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    agent.approve('deny')
    await running
    expect(browser.click).not.toHaveBeenCalled()
    expect(requests[1]!.messages.at(-1)!.content[0]).toMatchObject({
      is_error: true,
      content: 'The user denied this action.',
    })
  })

  it('asks only once after "Allow for this run"', async () => {
    const { agent, browser } = setup(
      [
        async () => response([toolUse('t1', 'click', { selector: '#a' })], 'tool_use'),
        async () => response([toolUse('t2', 'press_key', { key: 'Enter' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'Done.' }]),
      ],
      { pageAccess: true, elements: { '#a': { found: true, tag: 'a', x: 1, y: 1 } } },
    )
    browser.load('example.com')
    const running = agent.run(input('go'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    agent.approve('allow-run')
    await running
    expect(browser.pressKey).toHaveBeenCalledWith('Enter')
    expect(agent.state().items.filter((item) => item.kind === 'approval')).toHaveLength(1)
  })

  it('refuses typing into sensitive fields without asking', async () => {
    const { agent, browser, requests } = setup(
      [
        async () =>
          response([toolUse('t1', 'type_text', { selector: '#pw', text: 'x' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'Please type it yourself.' }]),
      ],
      {
        pageAccess: true,
        elements: { '#pw': { found: true, tag: 'input', sensitive: true, x: 1, y: 1 } },
      },
    )
    browser.load('example.com')
    await agent.run(input('log me in'))
    expect(agent.state().items.some((item) => item.kind === 'approval')).toBe(false)
    expect(browser.insertText).not.toHaveBeenCalled()
    expect(requests[1]!.messages.at(-1)!.content[0]).toMatchObject({
      is_error: true,
      content: expect.stringContaining('Refused'),
    })
  })

  it('stop aborts the model request and keeps the history valid', async () => {
    const { agent, requests } = setup([
      (_request, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        ),
      async () => response([{ type: 'text', text: 'hi again' }]),
    ])
    const running = agent.run(input('slow'))
    await waitFor(() => requests.length === 1)
    agent.stop()
    await running
    expect(agent.state().status).toBe('idle')
    expect(agent.state().items.at(-1)).toEqual({ kind: 'notice', text: 'Stopped.' })
    await agent.run(input('again'))
    expect(agent.state().items.at(-1)).toMatchObject({ text: 'hi again' })
  })

  it('stop during an approval answers the pending tool call', async () => {
    const { agent, browser, requests } = setup(
      [
        async () => response([toolUse('t1', 'click', { selector: '#a' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'ok' }]),
      ],
      { pageAccess: true, elements: { '#a': { found: true, tag: 'a', x: 1, y: 1 } } },
    )
    browser.load('example.com')
    const running = agent.run(input('go'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    agent.stop()
    await running
    expect(browser.click).not.toHaveBeenCalled()
    await agent.run(input('next'))
    // The assistant's tool_use got a result before the new user turn.
    const history = requests[1]!.messages
    expect(history.at(-2)!.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' })
  })

  it('ends with an error after the step limit', async () => {
    const replies = Array.from(
      { length: MAX_STEPS },
      (_, i) => async () => response([toolUse(`t${i}`, 'get_page_state', {})], 'tool_use'),
    )
    const { agent, requests } = setup(replies)
    await agent.run(input('loop'))
    expect(requests).toHaveLength(MAX_STEPS)
    expect(agent.state().items.at(-1)).toMatchObject({ kind: 'error' })
  })

  it('shows API errors and asks for a key when there is none', async () => {
    const noKey = setup([], { hasKey: false })
    await noKey.agent.run(input('hi'))
    expect(noKey.requests).toHaveLength(0)
    expect(noKey.agent.state().items.at(-1)).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('/key'),
    })

    const failing = setup([async () => Promise.reject(new TypeError('fetch failed'))])
    await failing.agent.run(input('hi'))
    expect(failing.agent.state().items.at(-1)).toMatchObject({ kind: 'error' })
    expect(failing.events.at(-1)!.type).toBe('error')
  })

  it('rejects a second run while one is going', async () => {
    const { agent } = setup([() => new Promise(() => {})])
    void agent.run(input('first'))
    await expect(agent.run(input('second'))).rejects.toThrow('Stop the current run first')
  })

  it('records request, response, tool and done events for the debugger, without image data', async () => {
    const { agent, browser, events } = setup(
      [
        async () => response([toolUse('t1', 'screenshot', {})], 'tool_use'),
        async () => response([{ type: 'text', text: 'A page.' }]),
      ],
      { pageAccess: true },
    )
    browser.load('example.com')
    await agent.run(input('look'))
    expect(events.map((event) => event.type)).toEqual([
      'request',
      'response',
      'tool-call',
      'tool-result',
      'request',
      'response',
      'done',
    ])
    expect(events[3]!.image).toMatch(/^data:image\/jpeg/)
    expect(JSON.stringify(events)).not.toContain('A'.repeat(300))
    expect(events.every((event, index) => index === 0 || event.at >= events[index - 1]!.at)).toBe(
      true,
    )
  })
})

describe('cross-site navigation after reading a page', () => {
  it('needs approval, while same-site navigation and navigation before reading do not', async () => {
    const { agent, browser } = setup(
      [
        async () =>
          response([toolUse('t1', 'navigate', { url: 'https://shop.example/a' })], 'tool_use'),
        async () => response([toolUse('t2', 'read_page', {})], 'tool_use'),
        async () =>
          response([toolUse('t3', 'navigate', { url: 'www.shop.example/b' })], 'tool_use'),
        async () =>
          response(
            [toolUse('t4', 'navigate', { url: 'https://evil.example/?q=secret' })],
            'tool_use',
          ),
        async () => response([{ type: 'text', text: 'ok' }]),
      ],
      { pageAccess: true },
    )
    const running = agent.run(input('go'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    expect(agent.state().approval!.description).toBe('Open https://evil.example/?q=secret')
    expect(browser.load.mock.calls.map(([url]) => url)).toEqual([
      'https://shop.example/a',
      'www.shop.example/b',
    ])
    agent.approve('deny')
    await running
    expect(browser.load).toHaveBeenCalledTimes(2)
  })

  it('compares hosts without www', () => {
    expect(siteOf('https://www.a.com/x')).toBe('a.com')
    expect(siteOf('a.com/x')).toBe('a.com')
    expect(siteOf('')).toBe('')
  })
})

describe('Agent.replay', () => {
  it('replays navigation steps without the model or approval', async () => {
    const { agent, browser, deps } = setup([])
    const result = await agent.replay('/news', [
      { tool: 'navigate', input: { url: 'news.example' } },
    ])
    expect(result).toEqual({ ok: true })
    expect(browser.load).toHaveBeenCalledWith('news.example')
    expect(deps.callModel).not.toHaveBeenCalled()
  })

  it('needs page access for page steps and one approval for the whole replay', async () => {
    const steps = [
      { tool: 'navigate', input: { url: 'shop.example' } },
      { tool: 'click', input: { selector: '#a' } },
      { tool: 'click', input: { selector: '#a' } },
    ]
    const off = setup([], { elements: { '#a': { found: true, tag: 'a', x: 1, y: 1 } } })
    expect(await off.agent.replay('/shop', steps)).toMatchObject({ ok: false })
    expect(off.browser.load).not.toHaveBeenCalled()

    const on = setup([], {
      pageAccess: true,
      elements: { '#a': { found: true, tag: 'a', x: 1, y: 1 } },
    })
    const running = on.agent.replay('/shop', steps)
    await waitFor(() => on.agent.state().status === 'awaiting-approval')
    expect(on.agent.state().approval!.description).toContain('2 × click')
    on.agent.approve('allow')
    expect(await running).toEqual({ ok: true })
    expect(on.browser.click).toHaveBeenCalledTimes(2)
  })

  it('stops at the first failing step', async () => {
    const { agent, browser } = setup([], { pageAccess: true })
    browser.load('example.com')
    const result = await agent.replay('/x', [
      { tool: 'scroll', input: { direction: 'down' } },
      { tool: 'navigate', input: { url: 'not a url' } },
      { tool: 'reload', input: {} },
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Step 2')
    expect(browser.reload).not.toHaveBeenCalled()
  })
})

describe('elideImages', () => {
  it('replaces long base64 data and keeps everything else', () => {
    expect(
      elideImages({ a: [{ data: 'x'.repeat(2000), media_type: 'image/png' }], data: 'short' }),
    ).toEqual({
      a: [{ data: '<base64 image, 1 KB elided>', media_type: 'image/png' }],
      data: 'short',
    })
  })
})
