export const channels = {
  run: 'agent:run',
  stop: 'agent:stop',
  approve: 'agent:approve',
  newConversation: 'agent:new-conversation',
  state: 'agent:state',
  settings: 'agent:settings',
  updateSettings: 'agent:update-settings',
  checkCli: 'agent:check-cli',
  debugLog: 'agent:debug-log',
  toggleDebug: 'agent:toggle-debug',
  // main → UI
  stateChanged: 'agent:state-changed',
  settingsChanged: 'agent:settings-changed',
  debugLogChanged: 'agent:debug-log-changed',
  // A command from the menu or /debug, not a state change.
  debugToggled: 'agent:debug-toggled',
} as const

/** The Claude models the assistant runs through the user's Claude Code CLI, weakest first. */
export const claudeModels = [
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    short: 'haiku',
    description: 'Fastest, for light tasks',
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5',
    short: 'sonnet',
    description: 'Balanced speed and strength',
  },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', short: 'opus', description: 'Strongest, slower' },
] as const

/** A Claude model, run through the user's Claude Code CLI (its own login). */
export type ModelId = (typeof claudeModels)[number]['id']

export const DEFAULT_MODEL: ModelId = 'claude-sonnet-5-5'

export const isModelId = (value: unknown): value is ModelId =>
  claudeModels.some((model) => model.id === value)

/** The model an id, label or short name (`opus`, `Opus 5.5`) names, case-insensitive. */
export function findModel(name: string): (typeof claudeModels)[number] | undefined {
  const wanted = name.trim().toLowerCase()
  return claudeModels.find(
    (model) =>
      model.id === wanted || model.label.toLowerCase() === wanted || model.short === wanted,
  )
}

/** One check of the Claude Code CLI on the welcome page. */
export interface CliCheckStep {
  ok: boolean
  /** Why it failed, meant for the user. */
  error?: string
}

/** The Claude Code CLI checked in order; a step after a failed one is null (not run). */
export interface CliCheck {
  /** The CLI started. */
  found: CliCheckStep
  loggedIn: CliCheckStep | null
  /** It answered a one-line request with the selected model. */
  answered: (CliCheckStep & { model: ModelId; ms?: number }) | null
}

export const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageType = (typeof imageTypes)[number]

export const limits = {
  imageBytes: 5 * 1024 * 1024,
  attachments: 5,
  textAttachmentChars: 200_000,
  promptChars: 100_000,
} as const

export type Attachment =
  | {
      kind: 'image'
      name: string
      mediaType: ImageType
      /** base64, no data: prefix */
      data: string
    }
  | { kind: 'text'; name: string; text: string }

export interface RunInput {
  text: string
  attachments: Attachment[]
}

export type Decision = 'allow' | 'allow-run' | 'deny'

/** One line of the conversation shown above the prompt. */
export type ConversationItem =
  | { kind: 'user'; text: string; attachments: { kind: Attachment['kind']; name: string }[] }
  | { kind: 'assistant'; text: string }
  | {
      kind: 'tool'
      tool: string
      summary: string
      status: 'running' | 'ok' | 'error' | 'denied'
      detail?: string
    }
  | { kind: 'approval'; description: string; decision: Decision | 'stopped' | null }
  | { kind: 'error'; message: string }
  | { kind: 'notice'; text: string }

export type RunStatus = 'idle' | 'running' | 'awaiting-approval'

export interface AgentState {
  status: RunStatus
  items: ConversationItem[]
  /** Set while status is 'awaiting-approval'. */
  approval: { description: string } | null
}

export interface AgentSettings {
  model: ModelId
  /** Edge-style opt-in: the model may read the page and act on it (with approval). */
  pageAccess: boolean
  /** The model may search browsing history (search_history); on by default. */
  historyAccess: boolean
}

export type SettingsUpdate = Partial<Pick<AgentSettings, 'model' | 'pageAccess' | 'historyAccess'>>

export type DebugEventType =
  'request' | 'response' | 'tool-call' | 'approval' | 'tool-result' | 'error' | 'stopped' | 'done'

export interface DebugEvent {
  runId: number
  seq: number
  type: DebugEventType
  title: string
  /** Milliseconds since the run started. */
  at: number
  durationMs?: number
  /** Screenshot thumbnail, as a data: URL. */
  image?: string
  data: unknown
}

export interface DebugRun {
  id: number
  label: string
  startedAt: number
  events: DebugEvent[]
}

export interface AgentApi {
  run(input: RunInput): Promise<void>
  stop(): Promise<void>
  approve(decision: Decision): Promise<void>
  newConversation(): Promise<void>
  state(): Promise<AgentState>
  onStateChanged(listener: (state: AgentState) => void): () => void
  settings(): Promise<AgentSettings>
  updateSettings(update: SettingsUpdate): Promise<AgentSettings>
  onSettingsChanged(listener: (settings: AgentSettings) => void): () => void
  /** Checks that the Claude Code CLI starts, is logged in and answers (the welcome page's test). */
  checkCli(): Promise<CliCheck>
  debugLog(): Promise<DebugRun[]>
  onDebugEvent(listener: (event: DebugEvent, label: string) => void): () => void
  /** Shows or hides the debug panel (same as the menu item). */
  toggleDebug(): Promise<void>
  onDebugToggled(listener: () => void): () => void
}
