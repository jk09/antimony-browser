export const channels = {
  run: 'agent:run',
  stop: 'agent:stop',
  approve: 'agent:approve',
  newConversation: 'agent:new-conversation',
  state: 'agent:state',
  settings: 'agent:settings',
  updateSettings: 'agent:update-settings',
  setKey: 'agent:set-key',
  models: 'agent:models',
  debugLog: 'agent:debug-log',
  toggleDebug: 'agent:toggle-debug',
  // main → UI
  stateChanged: 'agent:state-changed',
  settingsChanged: 'agent:settings-changed',
  debugLogChanged: 'agent:debug-log-changed',
  // A command from the menu or /debug, not a state change.
  debugToggled: 'agent:debug-toggled',
} as const

export const claudeModels = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
] as const

export type ClaudeModelId = (typeof claudeModels)[number]['id']
/** A Claude model run through the user's Claude Code CLI (its own login). */
export type CliModelId = `cli:${ClaudeModelId}`
/**
 * Claude through the Anthropic API (API key), `cli:<claude id>` through the Claude Code CLI, or
 * `ollama:<name>` for a model served by local Ollama.
 */
export type ModelId = ClaudeModelId | CliModelId | `ollama:${string}`
export type Provider = 'anthropic' | 'claude-cli' | 'ollama'

const CLI_PREFIX = 'cli:'
const OLLAMA_PREFIX = 'ollama:'
const OLLAMA_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/

export const isClaudeModel = (value: unknown): value is ClaudeModelId =>
  claudeModels.some((model) => model.id === value)

export const isCliModel = (value: unknown): value is CliModelId =>
  typeof value === 'string' &&
  value.startsWith(CLI_PREFIX) &&
  isClaudeModel(value.slice(CLI_PREFIX.length))

export const cliModelId = (model: ClaudeModelId): CliModelId => `${CLI_PREFIX}${model}`

/** The Claude model a `cli:` id runs (what the CLI's --model gets). */
export const cliClaudeModel = (model: CliModelId): ClaudeModelId =>
  model.slice(CLI_PREFIX.length) as ClaudeModelId

/** A well-formed `ollama:<name>` id (the model may not be installed). */
export const isOllamaModel = (value: unknown): value is `ollama:${string}` =>
  typeof value === 'string' &&
  value.startsWith(OLLAMA_PREFIX) &&
  OLLAMA_NAME.test(value.slice(OLLAMA_PREFIX.length))

export const isModelId = (value: unknown): value is ModelId =>
  isClaudeModel(value) || isCliModel(value) || isOllamaModel(value)

export const providerOf = (model: ModelId): Provider =>
  isOllamaModel(model) ? 'ollama' : isCliModel(model) ? 'claude-cli' : 'anthropic'

/** The Ollama model name without the `ollama:` prefix. */
export const ollamaName = (model: `ollama:${string}`): string => model.slice(OLLAMA_PREFIX.length)

export const ollamaId = (name: string): `ollama:${string}` => `${OLLAMA_PREFIX}${name}`

export interface ModelInfo {
  id: ModelId
  label: string
}

/**
 * What the model picker offers: Claude models (API key), the same models through the Claude Code
 * CLI, and Ollama's installed models – or, for the CLI and Ollama, why there are none.
 */
export interface ModelList {
  claude: ModelInfo[]
  cli: { models: ModelInfo[] } | { error: string }
  ollama: { models: ModelInfo[] } | { error: string }
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
  /** Derived from the model. Only 'anthropic' needs the API key; the CLI uses its own login. */
  provider: Provider
  /** Edge-style opt-in: the model may read the page and act on it (with approval). */
  pageAccess: boolean
  /** The model may search browsing history (search_history); on by default. */
  historyAccess: boolean
  hasKey: boolean
  /** False when the key can't be encrypted on this system and lives in memory only. */
  keyPersisted: boolean
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
  /** Stores the Anthropic API key (encrypted), or removes it with null. */
  setKey(key: string | null): Promise<AgentSettings>
  onSettingsChanged(listener: (settings: AgentSettings) => void): () => void
  /** Claude models, the CLI's (asks the CLI if it's logged in) and Ollama's (asks Ollama each time). */
  models(): Promise<ModelList>
  debugLog(): Promise<DebugRun[]>
  onDebugEvent(listener: (event: DebugEvent, label: string) => void): () => void
  /** Shows or hides the debug panel (same as the menu item). */
  toggleDebug(): Promise<void>
  onDebugToggled(listener: () => void): () => void
}
