import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MainContext } from '../../app/main/features'
import type { MacroPort } from '../agent/main'

const userData = mkdtempSync(join(tmpdir(), 'antimony-skills-'))
const quitListeners: (() => void)[] = []
vi.mock('electron', () => ({
  app: {
    getPath: () => userData,
    on: (_: string, listener: () => void) => quitListeners.push(listener),
  },
}))
const replay = vi.fn(async (_label: string, _steps: unknown) => ({ ok: true }))
let macros: MacroPort | null = null
const replayable = ['navigate', 'click', 'go_back', 'reload', 'go_forward', 'stop', 'new_stack']
vi.mock('../agent/main', () => ({
  replay: (label: string, steps: unknown) => replay(label, steps),
  provideMacros: (port: MacroPort) => {
    macros = port
  },
  checkStep: (step: { tool: string; input: Record<string, unknown> }) => {
    if (!replayable.includes(step.tool)) throw new TypeError(`${step.tool} can't be a macro step`)
    if (step.tool === 'navigate' && typeof step.input['url'] !== 'string') {
      throw new TypeError('navigate: missing argument url')
    }
  },
}))

const { register } = await import('./main')
const { channels } = await import('./ipc')

function setup() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ctx = {
    ipc: { handle: (channel: string, fn: never) => handlers.set(channel, fn), send: vi.fn() },
  }
  register(ctx as unknown as MainContext)
  return {
    ctx,
    macros: macros!,
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args),
  }
}

const macro = {
  name: 'dash',
  description: 'Team dashboard',
  params: [{ name: 'team', hint: 'team name' }],
  steps: [{ tool: 'navigate', input: { url: 'https://dash.example/{{team}}' } }],
}

describe('skills main', () => {
  beforeEach(() => replay.mockClear())

  it('lists the built-in skills and offers no way to save from the UI', () => {
    const { call } = setup()
    const names = (call(channels.list) as { name: string }[]).map((skill) => skill.name)
    expect(names).toEqual(expect.arrayContaining(['reload', 'stop']))
    expect(Object.values(channels)).toEqual([
      'skills:list',
      'skills:delete',
      'skills:run',
      'skills:list-changed',
    ])
  })

  it('saves macros from the assistant with parameters and hints, persists them and tells the UI', () => {
    const first = setup()
    expect(first.macros.save(macro)).toMatchObject({
      name: 'dash',
      params: [{ name: 'team', hint: 'team name' }],
    })
    expect(first.ctx.ipc.send).toHaveBeenCalledWith(channels.listChanged, expect.any(Array))
    quitListeners.forEach((flush) => flush())
    const second = setup()
    expect(second.call(channels.list)).toContainEqual({ ...macro, builtin: false })
    expect(second.macros.list().map((m) => m.name)).toEqual(['dash'])
  })

  it('rejects invalid and reserved names, unusable steps and mismatched parameters', () => {
    const { macros: port } = setup()
    for (const bad of [
      { ...macro, name: 'Dash!' },
      { ...macro, name: 'key' },
      { ...macro, name: 'reload' },
      { ...macro, steps: [] },
      { ...macro, steps: [{ tool: 'read_page', input: {} }] },
      { ...macro, steps: [{ tool: 'navigate', input: {} }] },
      { ...macro, steps: [{ tool: 'navigate', input: { url: { nested: true } } }] },
      { ...macro, params: [] },
      { ...macro, params: [...macro.params, { name: 'extra', hint: '' }] },
      { ...macro, params: [macro.params[0], macro.params[0]] },
      { ...macro, params: [{ name: 'team', hint: 'x'.repeat(81) }] },
      null,
    ]) {
      expect(() => port.save(bad), JSON.stringify(bad)).toThrow(TypeError)
    }
  })

  it('loads macros stored without params, taking them from the steps', () => {
    writeFileSync(
      join(userData, 'skills.json'),
      JSON.stringify({
        skills: [{ name: 'old', description: '', steps: macro.steps }],
      }),
    )
    const { macros: port } = setup()
    expect(port.list()).toMatchObject([
      { name: 'old', description: '', params: [{ name: 'team', hint: '' }], steps: macro.steps },
    ])
    port.delete('old')
    quitListeners.forEach((flush) => flush())
  })

  it('runs a macro with its arguments through the agent replay', async () => {
    const { call, macros: port } = setup()
    port.save(macro)
    expect(await call(channels.run, 'dash', ' alpha ')).toEqual({ ok: true })
    expect(replay).toHaveBeenCalledWith('/dash alpha', [
      { tool: 'navigate', input: { url: 'https://dash.example/alpha' } },
    ])
    expect(await call(channels.run, 'dash', '')).toEqual({ ok: false, error: 'Missing <team>' })
    await expect(async () => call(channels.run, 'nope', '')).rejects.toThrow('Unknown skill')
  })

  it('runs built-ins, deletes macros (UI or assistant) but not built-ins', async () => {
    const { call, macros: port } = setup()
    await call(channels.run, 'reload', '')
    expect(replay).toHaveBeenCalledWith('/reload', [{ tool: 'reload', input: {} }])
    port.save(macro)
    call(channels.delete, 'dash')
    expect((call(channels.list) as { name: string }[]).some((s) => s.name === 'dash')).toBe(false)
    port.save({ ...macro, name: 'ns', params: [], steps: [{ tool: 'new_stack', input: {} }] })
    port.delete('ns')
    expect(port.list()).toEqual([])
    expect(() => call(channels.delete, 'reload')).toThrow(TypeError)
    expect(() => port.delete('nope')).toThrow(TypeError)
  })
})
