// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi } from '../../../app/renderer/fake-api'
import type { CliCheck } from '../../agent/ipc'
import { WelcomeView } from './WelcomeView'

const page = () => screen.getByRole('region', { name: 'Welcome' })
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

async function firstLaunch(options: Parameters<typeof fakeApi>[0] = {}) {
  const fake = fakeApi({ welcomeDone: false, ...options })
  render(<WelcomeView />)
  await screen.findByRole('region', { name: 'Welcome' })
  return fake
}

describe('WelcomeView', () => {
  afterEach(cleanup)

  it('opens on the first launch only, and again on request', async () => {
    const { emit } = fakeApi({ welcomeDone: true })
    render(<WelcomeView />)
    await act(async () => {})
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull()
    await act(async () => emit.welcomeOpen())
    expect(page()).toBeTruthy()
  })

  it('asks whether the CLI is installed and shows install and login steps if not', async () => {
    const { api } = await firstLaunch()
    expect(within(page()).getByText('Do you have the Claude Code CLI installed?')).toBeTruthy()
    click('No, not yet')
    const install = screen.getByLabelText('Install the Claude Code CLI')
    expect(install.textContent).toContain('npm install -g @anthropic-ai/claude-code')
    expect(install.textContent).toMatch(/claude\.ai\/install\.(sh|ps1)/)
    expect(api.agent.checkCli).not.toHaveBeenCalled()
    click(/installed it – test it/)
    await waitFor(() => expect(api.agent.checkCli).toHaveBeenCalledTimes(1))
  })

  it('tests a working CLI and shows how long the answer took', async () => {
    const { api } = await firstLaunch()
    click(/Yes, it.s installed/)
    const checks = await screen.findByRole('status', { name: 'Claude Code CLI test' })
    await waitFor(() => expect(checks.textContent).toContain('in 1.2 s'))
    const lines = within(checks).getAllByRole('listitem')
    expect(lines.map((line) => line.getAttribute('data-state'))).toEqual(['ok', 'ok', 'ok'])
    expect(lines[2]!.textContent).toContain('Answers with Sonnet 5.5')
    click('Test again')
    await waitFor(() => expect(api.agent.checkCli).toHaveBeenCalledTimes(2))
  })

  it('says what failed and how to fix it', async () => {
    const loggedOut: CliCheck = {
      found: { ok: true },
      loggedIn: { ok: false, error: "Claude Code isn't logged in." },
      answered: null,
    }
    await firstLaunch({ cliCheck: loggedOut })
    click(/Yes, it.s installed/)
    const checks = await screen.findByRole('status', { name: 'Claude Code CLI test' })
    await waitFor(() => expect(checks.textContent).toContain("isn't logged in"))
    expect(checks.textContent).toContain('Run claude in a terminal, log in')
    const lines = within(checks).getAllByRole('listitem')
    expect(lines.map((line) => line.getAttribute('data-state'))).toEqual([
      'ok',
      'failed',
      'skipped',
    ])
  })

  it('shows the install steps when the CLI is not found', async () => {
    await firstLaunch({
      cliCheck: {
        found: { ok: false, error: 'Claude Code CLI not found.' },
        loggedIn: null,
        answered: null,
      },
    })
    click(/Yes, it.s installed/)
    await screen.findByText('Claude Code CLI not found.')
    expect(screen.getByLabelText('Install the Claude Code CLI')).toBeTruthy()
  })

  it('picks the model strength', async () => {
    const { api } = await firstLaunch()
    click('3 · Model')
    const models = screen.getByRole('radiogroup', { name: 'Model' })
    const options = within(models).getAllByRole('radio') as HTMLInputElement[]
    expect(options.map((option) => option.value)).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
    ])
    await waitFor(() => expect(options[1]!.checked).toBe(true))
    fireEvent.click(options[2]!)
    expect(api.agent.updateSettings).toHaveBeenCalledWith({ model: 'claude-opus-5-5' })
  })

  it('explains the prompt and skills, and finishing marks it done', async () => {
    const { api } = await firstLaunch()
    click('4 · Prompt')
    expect(within(page()).getByText('Using the prompt')).toBeTruthy()
    expect(page().textContent).toContain('/page-access on')
    click('Next')
    expect(within(page()).getByText('Skills and macros')).toBeTruthy()
    expect(page().textContent).toContain('store it as /wiki')
    expect(page().textContent).toContain('/config')
    click('Start browsing')
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull()
    expect(api.welcome.setDone).toHaveBeenCalledWith(true)
  })

  it('closes with × or Escape, which also marks it done', async () => {
    const { api, emit } = await firstLaunch()
    click('Close welcome page')
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull()
    await act(async () => emit.welcomeOpen())
    fireEvent.keyDown(page(), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Welcome' })).toBeNull()
    expect(api.welcome.setDone).toHaveBeenCalledTimes(2)
  })
})
