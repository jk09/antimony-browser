// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { builtins, fakeApi } from '../../../app/renderer/fake-api'
import { promptCommands } from '../../prompt/ipc'
import type { Skill } from '../ipc'
import { ConfigView } from './ConfigView'

const macro: Skill = {
  name: 'dash',
  description: 'Team dashboard',
  params: [{ name: 'team', hint: 'team name' }],
  steps: [
    { tool: 'new_stack', input: {} },
    { tool: 'navigate', input: { url: 'https://dash.example/{{team}}' } },
  ],
  builtin: false,
}

async function openConfig(skills: Skill[] = [...builtins, macro]) {
  const { api, emit } = fakeApi({ skills })
  render(<ConfigView />)
  expect(screen.queryByRole('region', { name: 'Configuration' })).toBeNull()
  await act(async () => emit.openConfig())
  return { api, emit, page: screen.getByRole('region', { name: 'Configuration' }) }
}

describe('ConfigView', () => {
  afterEach(cleanup)

  it('lists every command, the built-in skills and macros with their scripts', async () => {
    const { page } = await openConfig()
    const system = within(page).getByRole('region', { name: 'System' })
    for (const command of promptCommands) {
      expect(within(system).getByText(`/${command.name}`)).toBeTruthy()
    }
    expect(within(system).getByText('/config')).toBeTruthy()
    expect(within(system).getByText('/reload')).toBeTruthy()
    expect(within(system).queryByRole('button', { name: /Delete/ })).toBeNull()

    const mine = within(page).getByRole('region', { name: 'Your macros' })
    expect(within(mine).getByText('/dash')).toBeTruthy()
    expect(within(mine).getByText('Team dashboard')).toBeTruthy()
    expect(within(mine).getByText('team name')).toBeTruthy()
    const steps = within(within(mine).getByRole('list', { name: 'Script' })).getAllByRole(
      'listitem',
    )
    expect(steps.map((step) => step.textContent)).toEqual([
      'new_stack',
      'navigate {"url":"https://dash.example/{{team}}"}',
    ])
    expect(within(steps[1]!).getByText('{{team}}').tagName).toBe('MARK')
  })

  it('shows an empty state without macros', async () => {
    const { page } = await openConfig(builtins)
    expect(within(page).getByText(/No macros yet/)).toBeTruthy()
  })

  it('filters by name or description', async () => {
    const { page } = await openConfig()
    const filter = within(page).getByRole('searchbox', { name: 'Filter commands and skills' })
    fireEvent.change(filter, { target: { value: 'dashboard' } })
    expect(within(page).getByText('/dash')).toBeTruthy()
    expect(within(page).queryByText('/reload')).toBeNull()
    expect(within(page).queryByRole('region', { name: 'System' })).toBeNull()
    fireEvent.change(filter, { target: { value: 'zzz' } })
    expect(within(page).getByText('Nothing matches.')).toBeTruthy()
  })

  it('deletes a macro and follows list changes', async () => {
    const { api, emit, page } = await openConfig()
    fireEvent.click(within(page).getByRole('button', { name: 'Delete /dash' }))
    expect(api.skills.delete).toHaveBeenCalledWith('dash')
    await act(async () => emit.skills(builtins))
    expect(within(page).queryByText('/dash')).toBeNull()
  })

  it('closes with Escape and ×', async () => {
    const { emit, page } = await openConfig()
    fireEvent.keyDown(page, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Configuration' })).toBeNull()
    await act(async () => emit.openConfig())
    fireEvent.click(screen.getByRole('button', { name: 'Close configuration' }))
    expect(screen.queryByRole('region', { name: 'Configuration' })).toBeNull()
  })
})
