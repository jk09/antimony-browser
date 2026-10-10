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

  const stacks = {
    current: null,
    stacks: [
      { id: 's1', name: 'hacker-news', rootTitle: 'Hacker News', pages: 3, audio: null },
      { id: 's2', name: 'rust-docs', rootTitle: 'Rust', pages: 2, audio: null },
    ],
  }
  const row = (id: number, title: string, depth: number, last: boolean, ref: string) => ({
    id,
    url: `https://site.example/${ref}`,
    title,
    depth,
    last,
    ref,
  })
  const stackPages = [
    {
      id: 's1',
      name: 'hacker-news',
      rootTitle: 'Hacker News',
      activeId: 3,
      rows: [
        row(1, 'Hacker News', 0, true, 'hacker-news'),
        row(2, 'Kent Beck: Software Engineering', 1, false, 'kent-beck-software-engineering'),
        row(3, 'Comments', 1, true, 'comments'),
      ],
    },
    {
      id: 's2',
      name: 'rust-docs',
      rootTitle: 'Rust',
      activeId: 4,
      rows: [row(4, 'Rust', 0, false, 'rust'), row(5, 'The Book', 0, true, 'the-book')],
    },
  ]
  const optionNames = () =>
    within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.getAttribute('aria-label') ?? option.textContent)

  it('suggests stacks and their pages after @ as a tree; Tab completes, Ctrl+Tab doesn’t', async () => {
    const { box } = await openPrompt({ stacks, stackPages })
    type(box, '@')
    await waitFor(() => expect(optionNames()).toHaveLength(7))
    expect(optionNames()).toEqual([
      'Stack @hacker-news, Hacker News · 3 pages',
      'Page Hacker News, site.example/hacker-news',
      'Page Kent Beck: Software Engineering, site.example/kent-beck-software-engineering',
      'Page Comments, site.example/comments, current page',
      'Stack @rust-docs, Rust · 2 pages',
      'Page Rust, site.example/rust, current page',
      'Page The Book, site.example/the-book',
    ])
    const options = within(screen.getByRole('listbox')).getAllByRole('option')
    expect(options[0]!.className).toContain('prompt-suggestion-stack')
    expect(options[2]!.className).toContain('prompt-suggestion-page')
    expect(options[2]!.textContent).toBe(
      '├Kent Beck: Software Engineeringsite.example/kent-beck-software-engineering',
    )
    expect(options[3]!.textContent?.startsWith('└')).toBe(true)

    type(box, 'compare @ru')
    expect(optionNames()[0]).toBe('Stack @rust-docs, Rust · 2 pages')
    // Ctrl+Tab switches stacks; it doesn't complete.
    press(box, 'Tab', { ctrlKey: true })
    expect(box.value).toBe('compare @ru')
    press(box, 'Tab')
    expect(box.value).toBe('compare @rust-docs ')
    // Tab only completes, even with nothing else typed.
    type(box, '@kent')
    press(box, 'Tab')
    expect(box.value).toBe('@hacker-news ')
  })

  it('goes to a stack or page in one click or Enter when only the @word is typed', async () => {
    const { api, box } = await openPrompt({ stacks, stackPages })
    type(box, '@hack')
    await waitFor(() => expect(optionNames()).toHaveLength(4))
    fireEvent.click(screen.getByRole('option', { name: /^Stack @hacker-news/ }))
    await waitFor(() => expect(api.stacks.switch).toHaveBeenCalledWith('s1'))
    expect(api.stacks.switch).toHaveBeenCalledTimes(1)
    expect(api.prompt.record).toHaveBeenCalledWith({ kind: 'command', text: '@hacker-news' })
    expect(box.value).toBe('')
    expect(screen.queryByRole('listbox')).toBeNull()

    type(box, '@kent')
    await waitFor(() => screen.getByRole('option', { name: /^Page Kent Beck/ }))
    fireEvent.click(screen.getByRole('option', { name: /^Page Kent Beck/ }))
    await waitFor(() => expect(api.stacks.openPage).toHaveBeenCalledWith('s1', 2))
    expect(box.value).toBe('')

    // Enter on a selected page works like a click.
    type(box, '@rust-docs/book')
    press(box, 'ArrowDown')
    press(box, 'ArrowDown')
    press(box, 'Enter')
    await waitFor(() => expect(api.stacks.openPage).toHaveBeenCalledWith('s2', 5))
    expect(api.agent.run).not.toHaveBeenCalled()
  })

  it('inserts the reference when other text is typed, and attaches named stacks and pages', async () => {
    const { api, box } = await openPrompt({ stacks, stackPages })
    type(box, 'Mute all tabs in @hack')
    await waitFor(() => screen.getByRole('option', { name: /^Stack @hacker-news/ }))
    fireEvent.click(screen.getByRole('option', { name: /^Stack @hacker-news/ }))
    expect(box.value).toBe('Mute all tabs in @hacker-news ')
    type(box, 'summarize @kent')
    await waitFor(() => screen.getByRole('option', { name: /^Page Kent Beck/ }))
    fireEvent.click(screen.getByRole('option', { name: /^Page Kent Beck/ }))
    expect(box.value).toBe('summarize @hacker-news/kent-beck-software-engineering ')
    expect(api.stacks.switch).not.toHaveBeenCalled()
    expect(api.stacks.openPage).not.toHaveBeenCalled()

    type(box, 'compare @rust-docs with @hacker-news/comments and @unknown')
    press(box, 'Enter')
    await waitFor(() => expect(api.agent.run).toHaveBeenCalled())
    expect(api.stacks.outline.mock.calls).toEqual([['rust-docs'], ['hacker-news/comments']])
    expect(api.agent.run).toHaveBeenCalledWith({
      text: 'compare @rust-docs with @hacker-news/comments and @unknown',
      attachments: [
        { kind: 'text', name: '@rust-docs', text: 'Navigation stack @rust-docs' },
        {
          kind: 'text',
          name: '@hacker-news/comments',
          text: 'Navigation stack @hacker-news/comments',
        },
      ],
    })
  })

  it('goes to a typed @name or @name/ref on Enter', async () => {
    const { api, box } = await openPrompt({ stacks, stackPages })
    type(box, '@hacker-news')
    press(box, 'Enter')
    await waitFor(() => expect(api.stacks.switch).toHaveBeenCalledWith('s1'))
    type(box, '@rust-docs/the-book')
    press(box, 'Enter')
    await waitFor(() => expect(api.stacks.openPage).toHaveBeenCalledWith('s2', 5))
    expect(api.agent.run).not.toHaveBeenCalled()
    expect(box.value).toBe('')
  })

  it('scrolls long @ lists to the selected row and says how many more match', async () => {
    const scrolled: Element[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this)
    }
    try {
      const big = {
        id: 's1',
        name: 'hacker-news',
        rootTitle: 'Hacker News',
        activeId: null,
        rows: Array.from({ length: 250 }, (_, i) => row(i + 1, `Page ${i}`, 0, i === 249, `p${i}`)),
      }
      const { box } = await openPrompt({ stacks, stackPages: [big] })
      type(box, '@')
      await waitFor(() => expect(optionNames()).toHaveLength(201))
      expect(screen.getByText('⋯ 51 more – type to narrow')).toBeTruthy()
      press(box, 'ArrowUp')
      expect(scrolled.at(-1)?.getAttribute('aria-label')).toBe('Page Page 198, site.example/p198')
    } finally {
      Element.prototype.scrollIntoView = original
    }
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

  it('keeps the text of a command that did not run, so it can be completed or corrected', async () => {
    const { api, box } = await openPrompt({ skills: [...builtins, macro] })
    type(box, '/open-in')
    api.skills.run.mockResolvedValueOnce({ ok: false, error: 'Missing <url> <term>' } as never)
    press(box, 'Enter')
    expect((await screen.findByRole('alert')).textContent).toBe('Missing <url> <term>')
    expect(box.value).toBe('/open-in')
    type(box, '/relaod')
    press(box, 'Enter')
    await screen.findByText(/Unknown command/)
    expect(box.value).toBe('/relaod')
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

  it('/history opens the history view, /config the configuration page; /note notes the current page', async () => {
    const { api, box } = await openPrompt()
    type(box, '/history sqlite wal')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.history.requestOpen).toHaveBeenCalledWith({ query: 'sqlite wal' }),
    )

    type(box, '/config')
    press(box, 'Enter')
    await waitFor(() => expect(api.skills.requestConfig).toHaveBeenCalled())

    type(box, '/recall show all pages about lions')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.history.requestRecall).toHaveBeenCalledWith('show all pages about lions'),
    )

    type(box, '/history-map')
    press(box, 'Enter')
    await waitFor(() => expect(api.history.requestMap).toHaveBeenCalled())

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
      {
        name: 'dash',
        description: 'Team dashboard',
        params: [{ name: 'team', hint: 'team name' }],
        steps: [],
        builtin: false,
      },
    ]
    const { box } = await openPrompt({ skills })
    type(box, '/da')
    const [first] = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(first!.textContent).toContain('/dash <team>')
    press(box, 'Tab')
    expect(box.value).toBe('/dash ')
  })

  it('lists your macros first after a bare /, and says how many more commands match', async () => {
    const extra = Array.from({ length: 10 }, (_, index) => ({
      ...macro,
      name: `zz-${index}`,
    }))
    const { box } = await openPrompt({ skills: [...builtins, ...extra, macro] })
    type(box, '/')
    const options = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(options[0]!.textContent).toContain('/open-in')
    expect(screen.getByText(/more – type to narrow/)).toBeTruthy()
    type(box, '/open')
    expect(screen.queryByText(/more – type to narrow/)).toBeNull()
  })

  const macro = {
    name: 'open-in',
    description: 'Open a page and search it',
    params: [
      { name: 'url', hint: 'page or @stack' },
      { name: 'term', hint: 'search term' },
    ],
    steps: [],
    builtin: false,
  }

  it('shows a faint hint of the macro arguments still to type', async () => {
    const { box } = await openPrompt({ skills: [...builtins, macro] })
    const hint = () => screen.queryByTestId('prompt-hint')?.textContent ?? ''
    type(box, '/open-in')
    expect(hint()).toBe('/open-in <url: page or @stack> <term: search term>')
    expect(box.getAttribute('aria-description')).toBe(
      'Arguments: <url: page or @stack> <term: search term>',
    )
    type(box, '/open-in x')
    expect(hint()).toBe('/open-in x <term: search term>')
    type(box, '/open-in x y z')
    expect(hint()).toBe('')
    type(box, '/reload')
    expect(hint()).toBe('')
  })

  it('suggests @ stacks and pages for macro arguments and runs it with their URLs', async () => {
    const { api, box } = await openPrompt({ skills: [...builtins, macro], stacks, stackPages })
    type(box, '/open-in @rust')
    await waitFor(() => expect(optionNames()).toContain('Stack @rust-docs, Rust · 2 pages'))
    type(box, '/open-in @hacker-news/comments electron apps')
    expect(screen.queryByRole('listbox')).toBeNull()
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.skills.run).toHaveBeenCalledWith(
        'open-in',
        'https://site.example/comments electron apps',
      ),
    )
    type(box, '/open-in @rust-docs @nobody')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.skills.run).toHaveBeenCalledWith('open-in', 'https://site.example/rust @nobody'),
    )
  })

  it("doesn't suggest @ in built-in commands' arguments", async () => {
    const { box } = await openPrompt({ stacks, stackPages })
    type(box, '/history @ru')
    await act(async () => {})
    const options = screen.queryAllByRole('option').map((option) => option.textContent ?? '')
    expect(options.some((text) => text.includes('@rust-docs'))).toBe(false)
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

  it('sends queries without any key; the CLI signs in on its own', async () => {
    const { api, box } = await openPrompt()
    type(box, 'hello there')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.agent.run).toHaveBeenCalledWith({ text: 'hello there', attachments: [] }),
    )
  })

  it('offers exactly the three Claude model strengths in the picker', async () => {
    const { api } = await openPrompt({ settings: { model: 'claude-opus-5-5' } })
    const picker = screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement
    await waitFor(() => expect(picker.value).toBe('claude-opus-5-5'))
    expect(within(picker).queryAllByRole('group')).toHaveLength(0)
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Haiku 4.5', 'Sonnet 5.5', 'Opus 5.5'])
    fireEvent.change(picker, { target: { value: 'claude-haiku-4-5' } })
    expect(api.agent.updateSettings).toHaveBeenCalledWith({ model: 'claude-haiku-4-5' })
  })

  it('/model picks a model by short name, label or id and suggests the short names', async () => {
    const { api, box } = await openPrompt()
    type(box, '/model o')
    const suggested = within(await screen.findByRole('listbox')).getAllByRole('option')
    expect(suggested.map((o) => o.textContent).join(' ')).toContain('opus')

    type(box, '/model opus')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.agent.updateSettings).toHaveBeenCalledWith({ model: 'claude-opus-5-5' }),
    )
    expect((await screen.findByRole('status')).textContent).toContain('Opus 5.5')
    type(box, '/model Haiku 4.5')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.agent.updateSettings).toHaveBeenCalledWith({ model: 'claude-haiku-4-5' }),
    )
    type(box, '/model ollama:qwen3:8b')
    press(box, 'Enter')
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Choose one of: haiku, sonnet, opus',
    )
    expect(api.agent.updateSettings).toHaveBeenCalledTimes(2)
  })

  it('/welcome opens the welcome page', async () => {
    const { api, box } = await openPrompt()
    type(box, '/welcome')
    press(box, 'Enter')
    await waitFor(() => expect(api.welcome.requestOpen).toHaveBeenCalled())
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

  it('/history-access turns history search off and on', async () => {
    const { api, box } = await openPrompt()
    type(box, '/history-access off')
    press(box, 'Enter')
    await waitFor(() =>
      expect(api.agent.updateSettings).toHaveBeenCalledWith({ historyAccess: false }),
    )
    expect((await screen.findByRole('status')).textContent).toContain('History access off')
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
