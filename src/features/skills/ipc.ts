export const channels = {
  list: 'skills:list',
  draft: 'skills:draft',
  save: 'skills:save',
  delete: 'skills:delete',
  run: 'skills:run',
  requestSave: 'skills:request-save',
  // main → UI
  listChanged: 'skills:list-changed',
  // A command (/save, "Save as skill"), not a state change.
  saveRequested: 'skills:save-requested',
} as const

/** One recorded tool call; string inputs may contain {{parameter}} placeholders. */
export interface SkillStep {
  tool: string
  input: Record<string, string | number | boolean>
}

export interface Skill {
  name: string
  description: string
  /** Parameter names, in order of first use in the steps. */
  params: string[]
  steps: SkillStep[]
  /** Shipped with the app (/back, /reload…); can't be changed or deleted. */
  builtin: boolean
}

export interface SkillDraft {
  name: string
  description: string
  steps: SkillStep[]
}

export interface RunResult {
  ok: boolean
  error?: string
}

export interface SkillsApi {
  /** Built-in and saved skills, sorted by name. */
  list(): Promise<Skill[]>
  onListChanged(listener: (skills: Skill[]) => void): () => void
  /** The replayable steps of the last assistant run, to start a draft from. */
  draft(): Promise<SkillStep[]>
  save(draft: SkillDraft): Promise<Skill>
  delete(name: string): Promise<void>
  /** Runs a skill; `args` is the rest of the prompt line after `/name`. */
  run(name: string, args: string): Promise<RunResult>
  /** Opens the save form (for /save and the "Save as skill" button). */
  requestSave(name?: string): Promise<void>
  onSaveRequested(listener: (name: string) => void): () => void
}
