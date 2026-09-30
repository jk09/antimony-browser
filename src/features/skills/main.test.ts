import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'

const userData = mkdtempSync(join(tmpdir(), 'antimony-skills-'))
const quitListeners: (() => void)[] = []
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    on: (_: string, listener: () => void) => quitListeners.push(listener),
  },
}))
const replay = vi.fn(async (_label: string, _steps: unknown) => ({ ok: true }))
const savableSteps = vi.fn(() => [
  { tool: 'navigate', input: { url: 'https://dash.example/alpha' } },
  { tool: 'click', input: { selector: '#go' } },
])
vi.mock('../agent/main', () => ({
  replay: (label: string, steps: unknown) => replay(label, steps),
  savableSteps: () => savableSteps(),
  isReplayableTool: (name: string) =>
    ['navigate', 'click', 'go_back', 'reload', 'go_forward', 'stop'].includes(name),
}))

const { register } = await import('./main')
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
  }
  register(ctx as unknown as MainContext)
  return { ctx, call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) }
}

const draft = {
  name: 'dash',
  description: 'Team dashboard',
  steps: [{ tool: 'navigate', input: { url: 'https://dash.example/{{team}}' } }],
}

describe('skills main', () => {
  beforeEach(() => replay.mockClear())

  it('lists the built-in skills', () => {
    const { call } = setup()
    const names = (call(channels.list) as { name: string }[]).map((skill) => skill.name)
    expect(names).toEqual(expect.arrayContaining(['back', 'forward', 'reload', 'stop']))
  })

  it('offers the last run as a draft', () => {
    const { call } = setup()
    expect(call(channels.draft)).toEqual(savableSteps())
  })

  it('saves skills with parameters, persists them and tells the UI', () => {
    const first = setup()
    expect(first.call(channels.save, draft)).toMatchObject({
      name: 'dash',
      params: ['team'],
      builtin: false,
    })
    expect(first.ctx.ipc.send).toHaveBeenCalledWith(channels.listChanged, expect.any(Array))
    quitListeners.forEach((flush) => flush())
    const second = setup()
    expect((second.call(channels.list) as { name: string }[]).some((s) => s.name === 'dash')).toBe(
      true,
    )
  })

  it('rejects invalid and reserved names, unknown or read-only tools and bad inputs', () => {
    const { call } = setup()
    for (const bad of [
      { ...draft, name: 'Dash!' },
      { ...draft, name: 'key' },
      { ...draft, name: 'reload' },
      { ...draft, steps: [] },
      { ...draft, steps: [{ tool: 'read_page', input: {} }] },
      { ...draft, steps: [{ tool: 'navigate', input: { url: { nested: true } } }] },
      null,
    ]) {
      expect(() => call(channels.save, bad), JSON.stringify(bad)).toThrow(TypeError)
    }
  })

  it('runs a skill with its arguments through the agent replay', async () => {
    const { call } = setup()
    call(channels.save, draft)
    expect(await call(channels.run, 'dash', ' alpha ')).toEqual({ ok: true })
    expect(replay).toHaveBeenCalledWith('/dash alpha', [
      { tool: 'navigate', input: { url: 'https://dash.example/alpha' } },
    ])
    expect(await call(channels.run, 'dash', '')).toEqual({ ok: false, error: 'Missing <team>' })
    await expect(async () => call(channels.run, 'nope', '')).rejects.toThrow('Unknown skill')
  })

  it('runs built-ins, deletes saved skills but not built-ins', async () => {
    const { call } = setup()
    await call(channels.run, 'reload', '')
    expect(replay).toHaveBeenCalledWith('/reload', [{ tool: 'reload', input: {} }])
    call(channels.save, draft)
    call(channels.delete, 'dash')
    expect((call(channels.list) as { name: string }[]).some((s) => s.name === 'dash')).toBe(false)
    expect(() => call(channels.delete, 'reload')).toThrow(TypeError)
  })

  it('opens the save form in the UI on request', () => {
    const { ctx, call } = setup()
    call(channels.requestSave, 'dash')
    expect(ctx.ipc.send).toHaveBeenCalledWith(channels.saveRequested, 'dash')
    expect(() => call(channels.requestSave, 3)).toThrow(TypeError)
  })
})
