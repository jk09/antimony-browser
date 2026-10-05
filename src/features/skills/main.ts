import { join } from 'node:path'
import { app } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { checkStep, provideMacros, replay } from '../agent/main'
import { promptCommands } from '../prompt/ipc'
import { channels, type Skill, type SkillParam, type SkillStep } from './ipc'
import { builtinSkills } from './shared/builtins'
import { bindArgs, extractParams, fillParams, NAME_PATTERN, PARAM_PATTERN } from './shared/params'

const MAX_STEPS = 50
const MAX_PARAMS = 10
const MAX_HINT = 80

const reserved = new Set([
  ...promptCommands.map((command) => command.name),
  ...builtinSkills.map((skill) => skill.name),
])

/** A macro as stored and as save_macro sends it. */
export interface MacroDefinition {
  name: string
  description: string
  params: SkillParam[]
  steps: SkillStep[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseStep(value: unknown): SkillStep {
  if (!isRecord(value) || typeof value['tool'] !== 'string' || !isRecord(value['input'])) {
    throw new TypeError('a step is { tool, input }')
  }
  const input: SkillStep['input'] = {}
  for (const [key, item] of Object.entries(value['input'])) {
    if (!['string', 'number', 'boolean'].includes(typeof item)) {
      throw new TypeError(`step input ${key} must be a string, number or boolean`)
    }
    input[key] = item as string | number | boolean
  }
  const step = { tool: value['tool'], input }
  checkStep(step)
  return step
}

function parseParam(value: unknown): SkillParam {
  if (!isRecord(value) || typeof value['name'] !== 'string' || !PARAM_PATTERN.test(value['name'])) {
    throw new TypeError('a parameter is { name, hint }; name: letters, digits and _, up to 32')
  }
  const hint = value['hint'] ?? ''
  if (typeof hint !== 'string' || hint.length > MAX_HINT) {
    throw new TypeError(`parameter hint: up to ${MAX_HINT} characters`)
  }
  return { name: value['name'].toLowerCase(), hint: hint.trim() }
}

/**
 * Throws a TypeError (read by the model) unless `value` is a valid macro. Without `params`
 * (macros stored by earlier versions) the parameters come from the steps, without hints.
 */
export function parseMacro(value: unknown): MacroDefinition {
  if (!isRecord(value)) throw new TypeError('expected { name, description, params, steps }')
  const { name, description, steps } = value
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new TypeError('name: lowercase letters, digits and -, starting with a letter, up to 32')
  }
  if (reserved.has(name)) throw new TypeError(`/${name} is a built-in command`)
  if (typeof description !== 'string' || description.length > 200) {
    throw new TypeError('description: up to 200 characters')
  }
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) {
    throw new TypeError(`a macro has 1 to ${MAX_STEPS} steps`)
  }
  const parsedSteps = steps.map(parseStep)
  const used = extractParams(parsedSteps)
  const raw = value['params'] ?? used.map((param) => ({ name: param, hint: '' }))
  if (!Array.isArray(raw) || raw.length > MAX_PARAMS) {
    throw new TypeError(`params: a list of up to ${MAX_PARAMS} parameters`)
  }
  const params = raw.map(parseParam)
  const names = params.map((param) => param.name)
  if (new Set(names).size !== names.length) throw new TypeError('parameter names must differ')
  const undeclared = used.filter((param) => !names.includes(param))
  if (undeclared.length > 0) {
    throw new TypeError(`undeclared parameter(s): ${undeclared.map((p) => `{{${p}}}`).join(', ')}`)
  }
  const unused = names.filter((param) => !used.includes(param))
  if (unused.length > 0) {
    throw new TypeError(`parameter(s) not used in any step: ${unused.join(', ')}`)
  }
  return { name, description, params, steps: parsedSteps }
}

const toSkill = (macro: MacroDefinition): Skill => ({ ...macro, builtin: false })

/** skills.json: `{ "skills": [{ name, description, params, steps }] }`. */
interface StoredSkills {
  skills: MacroDefinition[]
}

function parseStore(raw: unknown): StoredSkills {
  if (!isRecord(raw) || !Array.isArray(raw['skills'])) throw new TypeError('expected { skills }')
  return { skills: raw['skills'].map(parseMacro) }
}

export function register({ ipc }: MainContext): void {
  const store = createJsonStore(join(app.getPath('userData'), 'skills.json'), {
    parse: parseStore,
    fallback: (): StoredSkills => ({ skills: [] }),
  })
  const saved = (): Skill[] => store.get().skills.map(toSkill)
  const persist = (skills: Skill[]) => {
    store.set({
      skills: skills.map(({ name, description, params, steps }) => ({
        name,
        description,
        params,
        steps,
      })),
    })
    ipc.send(channels.listChanged, list())
  }
  app.on('will-quit', () => store.flush())

  const list = (): Skill[] =>
    [...builtinSkills, ...saved()].sort((a, b) => a.name.localeCompare(b.name))
  const find = (name: unknown) => list().find((skill) => skill.name === name)
  const remove = (name: unknown) => {
    const skill = find(name)
    if (!skill || skill.builtin) throw new TypeError(`No macro /${String(name)}`)
    persist(saved().filter((other) => other.name !== skill.name))
  }

  // Macros are created and changed only by the assistant, from requests typed in the prompt.
  provideMacros({
    list: saved,
    save(definition) {
      const skill = toSkill(parseMacro(definition))
      persist([...saved().filter((other) => other.name !== skill.name), skill])
      return skill
    },
    delete: remove,
  })

  ipc.handle(channels.list, () => list())
  ipc.handle(channels.delete, (name) => remove(name))
  ipc.handle(channels.run, async (name, args) => {
    const skill = find(name)
    if (!skill) throw new TypeError(`Unknown skill /${String(name)}`)
    if (typeof args !== 'string' || args.length > 10_000)
      throw new TypeError('args must be a string')
    const bound = bindArgs(
      skill.params.map((param) => param.name),
      args,
    )
    if ('error' in bound) return { ok: false, error: bound.error }
    return replay(
      `/${skill.name}${args.trim() ? ` ${args.trim()}` : ''}`,
      fillParams(skill.steps, bound.values),
    )
  })
}
