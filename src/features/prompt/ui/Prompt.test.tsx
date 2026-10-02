// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { builtins, fakeApi, idleState } from '../../../app/renderer/fake-api'
import type { HistoryEntry } from '../ipc'
import { AssistantPanel } from './AssistantPanel'

afterEach(cleanup)

async function openPrompt(
  options: Parameters<typeof fakeApi>[0] = {},
  history: HistoryEntry[] = [],
) {
  const fake = fakeApi(options)
  fake.api.prompt.history.mockResolvedValue(history as never)
  render(<AssistantPanel />)
  // Let the initial state, settings and skills load.
  await act(async () => {})
  act(() => fake.emit.open())
  const box = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement
  return { ...fake, box }
}

const type = (box: HTMLTextAreaElement, value: string) =>
  fireEvent.change(box, { target: { value } })
const press = (box: HTMLTextAreaElement, key: string, extra: object = {}) =>
  fireEvent.keyDown(box, { key, ...extra })

describe('Prompt', () => {
  it('is shown and focused at start; Ctrl/Cmd+L refocuses and selects; Escape keeps it', async () => {
    const fake = fakeApi()
    render(<AssistantPanel />)
    await act(async () => {})
    const box = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement
    expect(document.activeElement).toBe(box)
    type(box, 'example')
    box.blur()
    act(() => fake.emit.open())
    expect(document.activeElement).toBe(box)
    expect(box.selectionEnd - box.selectionStart).toBe('example'.length)
    press(box, 'Escape')
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBe(box)
  })

  it('shows the page title and URL in the panel header', async () => {
    const fake = fakeApi()
    render(<AssistantPanel />)
    expect(screen.getByTestId('page-info').textContent).toBe('New tab')
    act(() =>
      fake.emit.navigation({
        url: 'https://example.com/',
        title: 'Example Domain',
        loading: false,
        canGoBack: false,
        canGoForward: false,
      }),
    )
    const header = screen.getByTestId('page-info')
    expect(header.textContent).toContain('Example Domain')
    expect(header.textContent).toContain('https://example.com/')
  })

  it('navigates to URLs without asking the model', async () => {
    const { api, box } = await openPrompt()
    type(box, 'example.com')
    press(box, 'Enter')
    await waitFor(() => expect(api.navigation.go).toHaveBeenCalledWith('https://example.com/'))
    expect(api.agent.run).not.toHaveBeenCalled()
    expect(api.prompt.record).toHaveBeenCalledWith({ kind: 'url', text: 'https://example.com/' })
    expect(box.value).toBe('')
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBe(box)
  })

  it('sends other text to the assistant; Shift+Enter adds a line', async () => {
    const { api, box } = await openPrompt()
    type(box, 'summarize this page')
    press(box, 'Enter', { shiftKey: true })
    expect(api.agent.run).not.toHaveBeenCalled()
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.agent.run).toHaveBeenCalledWith({ text: 'summarize this page', attachments: [] }),
    )
    expect(api.prompt.record).toHaveBeenCalledWith({ kind: 'query', text: 'summarize this page' })
    expect(box.value).toBe('')
  })

  it('suggests stacks after @, switches with @name alone and attaches named stacks', async () => {
    const stacks = {
      current: null,
      stacks: [
        { id: 's1', name: 'hacker-news', rootTitle: 'Hacker News', pages: 3 },
        { id: 's2', name: 'rust-docs', rootTitle: 'Rust', pages: 5 },
      ],
    }
    const { api, box } = await openPrompt({ stacks })
    type(box, 'compare @ru')
    const list = screen.getByRole('listbox')
    expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['↳@rust-docsRust'])
    // Ctrl+Tab switches stacks; it doesn't complete.
    press(box, 'Tab', { ctrlKey: true })
    expect(box.value).toBe('compare @ru')
    press(box, 'Tab')
    expect(box.value).toBe('compare @rust-docs ')

    type(box, 'compare @rust-docs with @hacker-news and @unknown')
    press(box, 'Enter')
    await waitFor(() => expect(api.agent.run).toHaveBeenCalled())
    expect(api.stacks.outline.mock.calls).toEqual([['rust-docs'], ['hacker-news']])
    expect(api.agent.run).toHaveBeenCalledWith({
      text: 'compare @rust-docs with @hacker-news and @unknown',
      attachments: [
        { kind: 'text', name: '@rust-docs', text: 'Navigation stack @rust-docs' },
        { kind: 'text', name: '@hacker-news', text: 'Navigation stack @hacker-news' },
      ],
    })

    type(box, '@hacker-news')
    expect(screen.queryByRole('listbox')).toBeNull()
    press(box, 'Enter')
    await waitFor(() => expect(api.stacks.switch).toHaveBeenCalledWith('s1'))
    expect(api.agent.run).toHaveBeenCalledTimes(1)
    expect(box.value).toBe('')
  })

  it('asks for an API key before sending a query without one', async () => {
    const { api, box } = await openPrompt({ settings: { hasKey: false } })
    type(box, 'hello there')
    press(box, 'Enter')
    expect((await screen.findByRole('alert')).textContent).toContain('/key')
    expect(api.agent.run).not.toHaveBeenCalled()
  })

  it('runs built-in skills and clears the input', async () => {
    const { api, box } = await openPrompt()
    type(box, '/reload')
    press(box, 'Enter')
    await waitFor(() => expect(api.skills.run).toHaveBeenCalledWith('reload', ''))
    expect(box.value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports unknown commands without calling anything', async () => {
    const { api, box } = await openPrompt()
    type(box, '/relaod')
    press(box, 'Enter')
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Unknown command \/relaod.*\/reload/,
    )
    expect(api.skills.run).not.toHaveBeenCalled()
    expect(api.agent.run).not.toHaveBeenCalled()
  })

  it('/key asks for the key in a password field and never records it', async () => {
    const { api, box } = await openPrompt()
    type(box, '/key')
    press(box, 'Enter')
    const key = (await screen.findByLabelText('Anthropic API key')) as HTMLInputElement
    expect(key.type).toBe('password')
    fireEvent.change(key, { target: { value: 'sk-ant-secret-123' } })
    fireEvent.submit(key)
    await waitFor(() => expect(api.agent.setKey).toHaveBeenCalledWith('sk-ant-secret-123'))
    expect(JSON.stringify(api.prompt.record.mock.calls)).not.toContain('secret')
  })

  it('suggests past URLs and runs the chosen one with ↓ and Enter', async () => {
    const { api, box } = await openPrompt({}, [
      { kind: 'url', text: 'https://www.github.com/jk09', at: 0 },
      { kind: 'query', text: 'what is new on github', at: 0 },
    ])
    await waitFor(() => expect(api.prompt.history).toHaveBeenCalled())
    type(box, 'git')
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('github.com/jk09'),
      expect.stringContaining('what is new on github'),
    ])
    press(box, 'ArrowDown')
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.navigation.go).toHaveBeenCalledWith('https://www.github.com/jk09'),
    )
  })

  it('suggests visited pages from browsing history by address prefix', async () => {
    const { api, box } = await openPrompt()
    api.history.suggest.mockResolvedValue([
      { url: 'https://en.wikipedia.org/wiki/SQLite', title: 'SQLite – Wikipedia' },
    ] as never)
    type(box, 'wiki')
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(api.history.suggest).toHaveBeenLastCalledWith('wiki')
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('SQLite – Wikipedia'),
    ])
    fireEvent.click(options[0]!)
    await waitFor(() =>
      expect(api.navigation.go).toHaveBeenCalledWith('https://en.wikipedia.org/wiki/SQLite'),
    )
    api.history.suggest.mockClear()
    type(box, '/hist')
    type(box, 'what is sqlite')
    expect(api.history.suggest).not.toHaveBeenCalled()
  })

  it('/history opens the history view; /note notes the current page', async () => {
    const { api, box } = await openPrompt()
    type(box, '/history sqlite wal')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.history.requestOpen).toHaveBeenCalledWith({ query: 'sqlite wal' }),
    )

    api.history.current.mockResolvedValue({
      id: 7,
      url: 'https://example.com/',
      title: 'Example',
    } as never)
    type(box, '/note compare with Postgres')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.history.setNote).toHaveBeenCalledWith(7, 'compare with Postgres'),
    )
    expect(await screen.findByText('Noted Example.')).toBeTruthy()

    type(box, '/note clear')
    press(box, 'Enter')
    await waitFor(() => expect(api.history.setNote).toHaveBeenLastCalledWith(7, null))

    type(box, '/history-summaries on')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.history.updateSettings).toHaveBeenCalledWith({ summaries: true }),
    )

    type(box, '/history-clear everything')
    press(box, 'Enter')
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(api.history.clear).not.toHaveBeenCalled()
    type(box, '/history-clear')
    press(box, 'Enter')
    await waitFor(() => expect(api.history.clear).toHaveBeenCalledWith(false))
  })

  it('suggests commands and skills after /, and Tab fills one in', async () => {
    const skills = [
      ...builtins,
      { name: 'dash', description: 'Team dashboard', params: ['team'], steps: [], builtin: false },
    ]
    const { box } = await openPrompt({ skills })
    type(box, '/da')
    const [first] = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(first!.textContent).toContain('/dash <team>')
    press(box, 'Tab')
    expect(box.value).toBe('/dash ')
  })

  it('/menu suggests menu items level by level and runs the chosen one', async () => {
    const menu = [
      {
        name: 'view',
        label: 'View',
        enabled: true,
        children: [
          { name: 'zoom-in', label: 'Zoom In', accelerator: 'Ctrl+Plus', enabled: true },
          { name: 'locked', label: 'Locked', enabled: false },
        ],
      },
    ]
    const { api, box } = await openPrompt({ menu })
    type(box, '/men')
    expect(within(await screen.findByRole('listbox')).getByRole('option').textContent).toContain(
      '/menu <menu> <item>',
    )
    press(box, 'Tab')
    expect(box.value).toBe('/menu ')
    type(box, '/menu v')
    press(box, 'Tab')
    expect(box.value).toBe('/menu view ')
    type(box, '/menu view ')
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      '↳View › Zoom InCtrl+Plus',
      '↳View › LockedDisabled',
    ])
    press(box, 'ArrowDown')
    press(box, 'Enter')
    await waitFor(() => expect(api.menu.run).toHaveBeenCalledWith(['view', 'zoom-in']))
    expect(box.value).toBe('')
  })

  it('/menu shows why an item can’t run, and lists the menus on its own', async () => {
    const { api, box } = await openPrompt({
      menu: [{ name: 'file', label: 'File', enabled: true, children: [] }],
    })
    api.menu.run.mockResolvedValueOnce({ ok: false, error: 'No “x” among the menus.' })
    type(box, '/menu x')
    press(box, 'Enter')
    expect((await screen.findByRole('alert')).textContent).toBe('No “x” among the menus.')
    type(box, '/menu')
    press(box, 'Enter')
    expect((await screen.findByRole('status')).textContent).toBe('Pick a menu: /menu file.')
  })

  it('steps back through history with ↑ on an empty prompt', async () => {
    const { box, api } = await openPrompt({}, [
      { kind: 'query', text: 'newest', at: 2 },
      { kind: 'url', text: 'https://older.example/', at: 1 },
    ])
    await waitFor(() => expect(api.prompt.history).toHaveBeenCalled())
    await act(async () => {})
    press(box, 'ArrowUp')
    expect(box.value).toBe('newest')
    press(box, 'ArrowUp')
    expect(box.value).toBe('https://older.example/')
    press(box, 'ArrowDown')
    expect(box.value).toBe('newest')
  })

  it('turns pasted images into chips and sends them with the query', async () => {
    const { api, box } = await openPrompt()
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' })
    fireEvent.paste(box, { clipboardData: { files: [file], getData: () => '' } })
    expect(await screen.findByRole('button', { name: 'Preview shot.png' })).toBeTruthy()
    // With an attachment, even URL-like text is a question about it.
    type(box, 'example.com')
    press(box, 'Enter')
    await waitFor(() => expect(api.agent.run).toHaveBeenCalled())
    expect(api.agent.run.mock.calls[0]).toEqual([
      {
        text: 'example.com',
        attachments: [
          { kind: 'image', name: 'shot.png', mediaType: 'image/png', data: 'iVBORw==' },
        ],
      },
    ])
    expect(api.navigation.go).not.toHaveBeenCalled()
  })

  it('turns long pasted text into a chip and rejects unsupported files', async () => {
    const { box } = await openPrompt()
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
    fireEvent.paste(box, { clipboardData: { files: [], getData: () => long } })
    expect(screen.getByRole('button', { name: 'Preview Pasted text' }).textContent).toContain(
      '30 lines',
    )
    expect(box.value).toBe('')

    const pdf = new File(['%PDF'], 'doc.pdf', { type: 'application/pdf' })
    fireEvent.paste(box, { clipboardData: { files: [pdf], getData: () => '' } })
    expect((await screen.findByRole('alert')).textContent).toContain('only PNG, JPEG, GIF and WebP')
  })

  it('Escape stops a running assistant', async () => {
    const { api, emit, box } = await openPrompt()
    act(() => emit.state({ ...idleState, status: 'running' }))
    expect(screen.getByRole('status').textContent).toContain('Assistant is acting')
    press(box, 'Escape')
    expect(api.agent.stop).toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeTruthy()
  })

  it('changes model and page access from the prompt row', async () => {
    const { api } = await openPrompt()
    fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), {
      target: { value: 'claude-opus-5-5' },
    })
    expect(api.agent.updateSettings).toHaveBeenCalledWith({ model: 'claude-opus-5-5' })
    fireEvent.click(screen.getByRole('button', { name: 'Page access off' }))
    expect(api.agent.updateSettings).toHaveBeenCalledWith({ pageAccess: true })
  })

  it('sends queries to an Ollama model without an API key', async () => {
    const { api, box } = await openPrompt({
      settings: { model: 'ollama:qwen3:8b', provider: 'ollama', hasKey: false },
    })
    type(box, 'hello there')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.agent.run).toHaveBeenCalledWith({ text: 'hello there', attachments: [] }),
    )
  })

  it('sends queries to a Claude Code CLI model without an API key', async () => {
    const { api, box } = await openPrompt({
      settings: { model: 'cli:claude-sonnet-5-5', provider: 'claude-cli', hasKey: false },
    })
    type(box, 'hello there')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.agent.run).toHaveBeenCalledWith({ text: 'hello there', attachments: [] }),
    )
  })

  it('groups Claude (API key), Claude Code CLI and installed Ollama models in the picker', async () => {
    const { api } = await openPrompt()
    const picker = screen.getByRole('combobox', { name: 'Model' })
    await waitFor(() => expect(within(picker).getAllByRole('group')).toHaveLength(3))
    const [claude, cli, ollama] = within(picker).getAllByRole('group')
    expect(claude!.getAttribute('label')).toBe('Claude (API key)')
    expect(
      within(claude!)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Sonnet 5.5', 'Opus 5.5', 'Haiku 4.5'])
    expect(cli!.getAttribute('label')).toBe('Claude Code CLI')
    expect(
      within(cli!)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Sonnet 5.5 (Claude Code)'])
    fireEvent.change(picker, { target: { value: 'cli:claude-sonnet-5-5' } })
    expect(api.agent.updateSettings).toHaveBeenCalledWith({ model: 'cli:claude-sonnet-5-5' })
    expect(ollama!.getAttribute('label')).toBe('Ollama')
    expect(
      within(ollama!)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['qwen3:8b (Ollama)'])
    fireEvent.change(picker, { target: { value: 'ollama:qwen3:8b' } })
    expect(api.agent.updateSettings).toHaveBeenCalledWith({ model: 'ollama:qwen3:8b' })
    // Asks Ollama again when the picker gets focus.
    const calls = api.agent.models.mock.calls.length
    fireEvent.focus(picker)
    expect(api.agent.models).toHaveBeenCalledTimes(calls + 1)
  })

  it("shows the CLI's and Ollama's errors and keeps an unlisted selected Ollama model", async () => {
    await openPrompt({
      settings: { model: 'ollama:llama3.1:latest', provider: 'ollama' },
      models: {
        claude: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }],
        cli: { error: 'Claude Code CLI not found. Install it, or set CLAUDE_CLI_PATH.' },
        ollama: { error: "Ollama isn't running at http://localhost:11434." },
      },
    })
    const picker = screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement
    await waitFor(() => expect(picker.textContent).toContain("isn't running"))
    expect(picker.value).toBe('ollama:llama3.1:latest')
    const [, cli, ollama] = within(picker).getAllByRole('group') as HTMLElement[]
    expect(
      (within(cli!).getAllByRole('option') as HTMLOptionElement[]).map((o) => [
        o.textContent,
        o.disabled,
      ]),
    ).toEqual([['Claude Code CLI not found. Install it, or set CLAUDE_CLI_PATH.', true]])
    const options = within(ollama!).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => [o.textContent, o.disabled])).toEqual([
      ['llama3.1:latest (Ollama)', false],
      ["Ollama isn't running at http://localhost:11434.", true],
    ])
  })

  it('keeps a selected CLI model in the CLI group when the CLI is unavailable', async () => {
    await openPrompt({
      settings: { model: 'cli:claude-opus-5-5', provider: 'claude-cli' },
      models: {
        claude: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }],
        cli: { error: "Claude Code isn't logged in. Run `claude` in a terminal and log in." },
        ollama: { models: [] },
      },
    })
    const picker = screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement
    await waitFor(() => expect(picker.textContent).toContain("isn't logged in"))
    expect(picker.value).toBe('cli:claude-opus-5-5')
    const cli = within(picker).getAllByRole('group')[1]!
    expect(within(cli).getAllByRole('option')[0]!.textContent).toBe('Opus 5.5 (Claude Code)')
  })

  it('/model switches to Claude Code CLI models by id or label and suggests them', async () => {
    const { api, box } = await openPrompt()
    type(box, '/model cli')
    const suggested = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(suggested.map((o) => o.textContent).join(' ')).toContain('cli:claude-sonnet-5-5')

    type(box, '/model cli:claude-sonnet-5-5')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.agent.updateSettings).toHaveBeenCalledWith({ model: 'cli:claude-sonnet-5-5' }),
    )
    expect((await screen.findByRole('status')).textContent).toContain('Sonnet 5.5 (Claude Code)')
  })

  it('/model picks Ollama models by id or bare name and suggests them', async () => {
    const { api, box } = await openPrompt()
    type(box, '/model oll')
    const suggested = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(suggested.map((o) => o.textContent).join(' ')).toContain('ollama:qwen3:8b')

    type(box, '/model qwen3:8b')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.agent.updateSettings).toHaveBeenCalledWith({ model: 'ollama:qwen3:8b' }),
    )
    expect((await screen.findByRole('status')).textContent).toContain('qwen3:8b (Ollama)')

    type(box, '/model ollama:mistral')
    press(box, 'Enter')
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Choose one of: claude-sonnet-5-5, claude-opus-5-5, claude-haiku-4-5, cli:claude-sonnet-5-5, ollama:qwen3:8b',
    )
    expect(api.agent.updateSettings).toHaveBeenCalledTimes(1)
  })

  it('/debug toggles the debugger and /page-access switches page access', async () => {
    const { api, box } = await openPrompt()
    type(box, '/debug')
    press(box, 'Enter')
    await waitFor(() => expect(api.agent.toggleDebug).toHaveBeenCalled())
    type(box, '/page-access on')
    press(box, 'Enter')
    await waitFor(() => expect(api.agent.updateSettings).toHaveBeenCalledWith({ pageAccess: true }))
    expect((await screen.findByRole('status')).textContent).toContain('Page access on')
  })

  it('/home sets, shows, clears and resets the page new stacks open at', async () => {
    const { api, box } = await openPrompt()
    type(box, '/home example.com')
    press(box, 'Enter')
    await waitFor(() => expect(api.stacks.setHome).toHaveBeenCalledWith('https://example.com/'))
    type(box, '/home')
    press(box, 'Enter')
    await waitFor(async () =>
      expect((await screen.findByRole('status')).textContent).toContain(
        'New stacks open at https://example.com/. Use',
      ),
    )
    type(box, '/home clear')
    press(box, 'Enter')
    await waitFor(() => expect(api.stacks.setHome).toHaveBeenLastCalledWith(null))
    type(box, '/home reset')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.stacks.setHome).toHaveBeenLastCalledWith('https://www.bing.com/'),
    )
    type(box, '/home not a url')
    press(box, 'Enter')
    expect((await screen.findByRole('alert')).textContent).toContain('is not a web address')
  })

  it('suggests what was just submitted without reopening', async () => {
    const { api, box } = await openPrompt()
    api.prompt.history.mockResolvedValue([
      { kind: 'url', text: 'https://example.com/', at: 1 },
    ] as never)
    type(box, 'example.com')
    press(box, 'Enter')
    await waitFor(() => expect(api.prompt.record).toHaveBeenCalled())
    type(box, 'exa')
    expect((await screen.findByRole('listbox')).textContent).toContain('https://example.com/')
  })
})
