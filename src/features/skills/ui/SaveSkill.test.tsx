// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi } from '../../../app/renderer/fake-api'
import { SaveSkill } from './SaveSkill'

afterEach(cleanup)

describe('SaveSkill', () => {
  it('opens with the last run, turns {{params}} into parameters and saves', async () => {
    const { api, emit } = fakeApi()
    api.skills.draft.mockResolvedValue([
      { tool: 'navigate', input: { url: 'https://dash.example/alpha' } },
      { tool: 'click', input: { selector: '#go' } },
    ] as never)
    render(<SaveSkill />)
    act(() => emit.saveRequested('dash'))
    const form = await screen.findByRole('form', { name: 'Save as skill' })
    expect((screen.getByDisplayValue('dash') as HTMLInputElement).value).toBe('dash')

    fireEvent.change(screen.getByDisplayValue('https://dash.example/alpha'), {
      target: { value: 'https://dash.example/{{team}}' },
    })
    expect(form.textContent).toContain('/dash <team>')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.skills.save).toHaveBeenCalledWith({
        name: 'dash',
        description: '',
        steps: [
          { tool: 'navigate', input: { url: 'https://dash.example/{{team}}' } },
          { tool: 'click', input: { selector: '#go' } },
        ],
      }),
    )
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
  })

  it('explains when there is nothing to save and checks the name', async () => {
    const { api, emit } = fakeApi()
    render(<SaveSkill />)
    act(() => emit.saveRequested(''))
    expect((await screen.findByRole('alert')).textContent).toContain('Nothing to save')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

    api.skills.draft.mockResolvedValue([{ tool: 'reload', input: {} }] as never)
    act(() => emit.saveRequested('Bad Name'))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    fireEvent.change(screen.getByPlaceholderText('my-skill'), { target: { value: '1bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toContain('lowercase letters')
    expect(api.skills.save).not.toHaveBeenCalled()
  })
})
