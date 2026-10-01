// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { builtins, fakeApi, idleState } from '../../../app/renderer/fake-api'
import type { HistoryEntry } from '../ipc'
import { Prompt } from './Prompt'

afterEach(cleanup)

async function openPrompt(
  options: Parameters<typeof fakeApi>[0] = {},
  history: HistoryEntry[] = [],
) {
  const fake = fakeApi(options)
  fake.api.prompt.history.mockResolvedValue(history as never)
  render(<Prompt />)
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
  it('is collapsed until Ctrl/Cmd+L, then focused; Escape collapses it', async () => {
    const fake = fakeApi()
    render(<Prompt />)
    expect(screen.queryByRole('textbox', { name: 'Prompt' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open prompt' })).toBeTruthy()
    act(() => fake.emit.open())
    const box = screen.getByRole('textbox', { name: 'Prompt' })
    expect(document.activeElement).toBe(box)
    press(box as HTMLTextAreaElement, 'Escape')
    expect(screen.queryByRole('textbox', { name: 'Prompt' })).toBeNull()
  })

  it('shows the page title and URL when collapsed', async () => {
    const fake = fakeApi()
    render(<Prompt />)
    act(() =>
      fake.emit.navigation({
        url: 'https://example.com/',
        title: 'Example Domain',
        loading: false,
        canGoBack: false,
        canGoForward: false,
      }),
    )
    const bar = screen.getByRole('button', { name: 'Open prompt' })
    expect(bar.textContent).toContain('Example Domain')
    expect(bar.textContent).toContain('https://example.com/')
  })

  it('navigates to URLs without asking the model', async () => {
    const { api, box } = await openPrompt()
    type(box, 'example.com')
    press(box, 'Enter')
    await waitFor(() => expect(api.navigation.go).toHaveBeenCalledWith('https://example.com/'))
    expect(api.agent.run).not.toHaveBeenCalled()
    expect(api.prompt.record).toHaveBeenCalledWith({ kind: 'url', text: 'https://example.com/' })
    expect(screen.queryByRole('textbox', { name: 'Prompt' })).toBeNull()
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

  it('asks for an API key before sending a query without one', async () => {
    const { api, box } = await openPrompt({ settings: { hasKey: false } })
    type(box, 'hello there')
    press(box, 'Enter')
    expect((await screen.findByRole('alert')).textContent).toContain('/key')
    expect(api.agent.run).not.toHaveBeenCalled()
  })

  it('runs built-in skills and collapses', async () => {
    const { api, box } = await openPrompt()
    type(box, '/reload')
    press(box, 'Enter')
    await waitFor(() => expect(api.skills.run).toHaveBeenCalledWith('reload', ''))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Prompt' })).toBeNull())
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

  it('Escape stops a running assistant instead of collapsing', async () => {
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

  it('groups Claude and installed Ollama models in the picker', async () => {
    const { api } = await openPrompt()
    const picker = screen.getByRole('combobox', { name: 'Model' })
    await waitFor(() => expect(within(picker).getAllByRole('group')).toHaveLength(2))
    const [claude, ollama] = within(picker).getAllByRole('group')
    expect(claude!.getAttribute('label')).toBe('Claude')
    expect(
      within(claude!)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Sonnet 5.5', 'Opus 5.5', 'Haiku 4.5'])
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

  it("shows Ollama's error and keeps an unlisted selected Ollama model", async () => {
    await openPrompt({
      settings: { model: 'ollama:llama3.1:latest', provider: 'ollama' },
      models: {
        claude: [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }],
        ollama: { error: "Ollama isn't running at http://localhost:11434." },
      },
    })
    const picker = screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement
    await waitFor(() => expect(picker.textContent).toContain("isn't running"))
    expect(picker.value).toBe('ollama:llama3.1:latest')
    const ollama = within(picker).getAllByRole('group')[1]!
    const options = within(ollama).getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => [o.textContent, o.disabled])).toEqual([
      ['llama3.1:latest (Ollama)', false],
      ["Ollama isn't running at http://localhost:11434.", true],
    ])
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
      'Choose one of: claude-sonnet-5-5, claude-opus-5-5, claude-haiku-4-5, ollama:qwen3:8b',
    )
    expect(api.agent.updateSettings).toHaveBeenCalledTimes(1)
  })

  it('opens by itself when the assistant needs an approval', async () => {
    const fake = fakeApi()
    render(<Prompt />)
    await act(async () => {})
    expect(screen.queryByRole('textbox', { name: 'Prompt' })).toBeNull()
    act(() =>
      fake.emit.state({
        ...idleState,
        status: 'awaiting-approval',
        approval: { description: 'Click' },
      }),
    )
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeTruthy()
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
})
