// Pure helpers for skill names, parameters and arguments (main and UI).
import type { Skill, SkillStep } from '../ipc'

export const NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/
export const PARAM_PATTERN = /^[a-z][a-z0-9_]{0,31}$/i
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi

/** Parameter names used in the steps' string inputs, in order of first use. */
export function extractParams(steps: SkillStep[]): string[] {
  const names: string[] = []
  for (const step of steps) {
    for (const value of Object.values(step.input)) {
      if (typeof value !== 'string') continue
      for (const [, name] of value.matchAll(PLACEHOLDER)) {
        const key = name!.toLowerCase()
        if (!names.includes(key)) names.push(key)
      }
    }
  }
  return names
}

/** Steps with every {{parameter}} replaced by its value. */
export function fillParams(steps: SkillStep[], values: Record<string, string>): SkillStep[] {
  return steps.map((step) => ({
    tool: step.tool,
    input: Object.fromEntries(
      Object.entries(step.input).map(([key, value]) => [
        key,
        typeof value === 'string'
          ? value.replace(PLACEHOLDER, (_, name: string) => values[name.toLowerCase()] ?? '')
          : value,
      ]),
    ),
  }))
}

/** Splits an argument line on whitespace; "double" or 'single' quotes group words. */
export function parseArgs(line: string): string[] {
  const args: string[] = []
  for (const [, double, single, plain] of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    args.push(double ?? single ?? plain ?? '')
  }
  return args
}

/** Maps arguments to parameters; the last parameter takes the rest of the line. */
export function bindArgs(
  params: string[],
  line: string,
): { values: Record<string, string> } | { error: string } {
  const args = parseArgs(line)
  if (params.length === 0) {
    return args.length === 0 ? { values: {} } : { error: 'This macro takes no arguments' }
  }
  if (args.length < params.length) {
    return {
      error: `Missing ${params
        .slice(args.length)
        .map((p) => `<${p}>`)
        .join(' ')}`,
    }
  }
  const values: Record<string, string> = {}
  params.forEach((param, index) => {
    values[param] = index === params.length - 1 ? args.slice(index).join(' ') : (args[index] ?? '')
  })
  return { values }
}

/** `/name <param> …` */
export function signature(skill: Pick<Skill, 'name' | 'params'>): string {
  return [`/${skill.name}`, ...skill.params.map((param) => `<${param.name}>`)].join(' ')
}

/** `<name: hint>`, or `<name>` without a hint. */
export const paramLabel = (param: Skill['params'][number]) =>
  `<${param.name}${param.hint ? `: ${param.hint}` : ''}>`

/**
 * The faint hint shown after `/name …` while a macro is typed: the parameters not yet started,
 * e.g. `<term: search term>`; '' when nothing is missing. `args` is the text after `/name`
 * (with its leading space). An argument being typed (no space after it yet) counts as started.
 */
export function argumentHint(params: Skill['params'], args: string): string {
  if (params.length === 0) return ''
  if (args !== '' && !/^\s/.test(args)) return ''
  const typed = parseArgs(args).length
  // The last parameter takes the rest of the line, so once it is started nothing is missing.
  const missing = params.slice(typed)
  if (missing.length === 0) return ''
  const label = missing.map(paramLabel).join(' ')
  return args === '' ? ` ${label}` : /\s$/.test(args) ? label : ` ${label}`
}
