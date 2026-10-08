export const channels = {
  list: 'skills:list',
  delete: 'skills:delete',
  run: 'skills:run',
  // /config: the UI asks main to open the configuration page (main relays it, as for Recall).
  requestConfig: 'skills:request-config',
  // main → UI
  listChanged: 'skills:list-changed',
  openConfig: 'skills:open-config',
} as const

/** One tool call of a macro; string inputs may contain {{parameter}} placeholders. */
export interface SkillStep {
  tool: string
  input: Record<string, string | number | boolean>
}

/** A parameter typed after `/name`, with a hint of what to type. */
export interface SkillParam {
  name: string
  /** Shown faintly while the macro is typed; '' for none. */
  hint: string
}

/**
 * A `/name` that replays tool calls without the model: a built-in skill or a macro the assistant
 * saved (save_macro).
 */
export interface Skill {
  name: string
  description: string
  /** In the order they are typed. */
  params: SkillParam[]
  steps: SkillStep[]
  /** Shipped with the app (/reload, /stop); can't be changed or deleted. */
  builtin: boolean
}

export interface RunResult {
  ok: boolean
  error?: string
}

export interface SkillsApi {
  /** Built-in skills and macros, sorted by name. */
  list(): Promise<Skill[]>
  onListChanged(listener: (skills: Skill[]) => void): () => void
  delete(name: string): Promise<void>
  /** Runs a skill; `args` is the rest of the prompt line after `/name`, `@` references resolved. */
  run(name: string, args: string): Promise<RunResult>
  /** Opens the configuration page (/config); main answers with an `openConfig` event. */
  requestConfig(): Promise<void>
  onOpenConfig(listener: () => void): () => void
}
