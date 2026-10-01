import { join } from 'node:path'
import { app } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { isReplayableTool, replay, savableSteps } from '../agent/main'
import { promptCommands } from '../prompt/ipc'
import { channels, type Skill, type SkillDraft, type SkillStep } from './ipc'
import { builtinSkills } from './shared/builtins'
import { bindArgs, extractParams, fillParams, NAME_PATTERN } from './shared/params'

const MAX_STEPS = 50

const reserved = new Set([
  ...promptCommands.map((command) => command.name),
  ...builtinSkills.map((skill) => skill.name),
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseStep(value: unknown): SkillStep {
  if (!isRecord(value) || typeof value['tool'] !== 'string' || !isRecord(value['input'])) {
    throw new TypeError('a step is { tool, input }')
  }
  if (!isReplayableTool(value['tool'])) throw new TypeError(`${value['tool']} can't be replayed`)
  const input: SkillStep['input'] = {}
  for (const [key, item] of Object.entries(value['input'])) {
    if (!['string', 'number', 'boolean'].includes(typeof item)) {
      throw new TypeError(`step input ${key} must be a string, number or boolean`)
    }
    if (typeof item === 'string' && item.length > 10_000) throw new TypeError(`${key} is too long`)
    input[key] = item as string | number | boolean
  }
  return { tool: value['tool'], input }
}

/** Throws unless `value` is a valid skill to save. */
export function parseDraft(value: unknown): SkillDraft {
  if (!isRecord(value)) throw new TypeError('expected { name, description, steps }')
  const { name, description, steps } = value
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new TypeError('name: lowercase letters, digits and -, starting with a letter, up to 32')
  }
  if (reserved.has(name)) throw new TypeError(`/${name} is a built-in command`)
  if (typeof description !== 'string' || description.length > 200) {
    throw new TypeError('description: up to 200 characters')
  }
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) {
    throw new TypeError(`a skill has 1 to ${MAX_STEPS} steps`)
  }
  return { name, description, steps: steps.map(parseStep) }
}

const toSkill = (draft: SkillDraft): Skill => ({
  ...draft,
  params: extractParams(draft.steps),
  builtin: false,
})

/** skills.json: `{ "skills": [{ name, description, steps }] }`. */
interface StoredSkills {
  skills: SkillDraft[]
}

function parseStore(raw: unknown): StoredSkills {
  if (!isRecord(raw) || !Array.isArray(raw['skills'])) throw new TypeError('expected { skills }')
  return { skills: raw['skills'].map(parseDraft) }
}

export function register({ ipc }: MainContext): void {
  const store = createJsonStore(join(app.getPath('userData'), 'skills.json'), {
    parse: parseStore,
    fallback: (): StoredSkills => ({ skills: [] }),
  })
  const saved = (): Skill[] => store.get().skills.map(toSkill)
  const persist = (skills: Skill[]) => {
    store.set({
      skills: skills.map(({ name, description, steps }) => ({ name, description, steps })),
    })
    ipc.send(channels.listChanged, list())
  }
  app.on('will-quit', () => store.flush())

  const list = (): Skill[] =>
    [...builtinSkills, ...saved()].sort((a, b) => a.name.localeCompare(b.name))
  const find = (name: unknown) => list().find((skill) => skill.name === name)

  ipc.handle(channels.list, () => list())
  ipc.handle(channels.draft, () => savableSteps().map(parseStep))
  ipc.handle(channels.save, (value) => {
    const skill = toSkill(parseDraft(value))
    persist([...saved().filter((other) => other.name !== skill.name), skill])
    return skill
  })
  ipc.handle(channels.delete, (name) => {
    const skill = find(name)
    if (!skill || skill.builtin) throw new TypeError(`No saved skill /${String(name)}`)
    persist(saved().filter((other) => other.name !== skill.name))
  })
  ipc.handle(channels.run, async (name, args) => {
    const skill = find(name)
    if (!skill) throw new TypeError(`Unknown skill /${String(name)}`)
    if (typeof args !== 'string' || args.length > 10_000)
      throw new TypeError('args must be a string')
    const bound = bindArgs(skill.params, args)
    if ('error' in bound) return { ok: false, error: bound.error }
    return replay(
      `/${skill.name}${args.trim() ? ` ${args.trim()}` : ''}`,
      fillParams(skill.steps, bound.values),
    )
  })
  ipc.handle(channels.requestSave, (name) => {
    if (name !== undefined && typeof name !== 'string') throw new TypeError('name must be a string')
    ipc.send(channels.saveRequested, name ?? '')
  })
}
