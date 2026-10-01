export const channels = {
  history: 'prompt:history',
  record: 'prompt:record',
  clearHistory: 'prompt:clear-history',
  // A command from the application menu (Ctrl/Cmd+L), not a state change.
  open: 'prompt:open',
} as const

export type HistoryKind = 'url' | 'query' | 'command'

export interface HistoryEntry {
  kind: HistoryKind
  text: string
  /** Epoch milliseconds of the last use. */
  at: number
}

export const HISTORY_LIMIT = 500

/** A built-in /command. Skills share the namespace, so their names can't be used for skills. */
export interface CommandInfo {
  name: string
  /** Argument placeholders shown in suggestions, e.g. `<model>`. */
  usage: string
  description: string
  /** Values suggested for the first argument. */
  options?: string[]
}

export const promptCommands: CommandInfo[] = [
  { name: 'new', usage: '', description: 'Start a new conversation' },
  { name: 'debug', usage: '', description: 'Show or hide the assistant debugger' },
  { name: 'key', usage: '', description: 'Set the Anthropic API key (/key clear removes it)' },
  {
    name: 'model',
    usage: '<model>',
    description: 'Choose the model (Claude or Ollama)',
    options: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5'],
  },
  {
    name: 'page-access',
    usage: 'on|off',
    description: 'Let the assistant read and act on the page',
    options: ['on', 'off'],
  },
  { name: 'menu', usage: '<menu> <item>', description: 'Run an item from the application menu' },
  { name: 'save', usage: '<name>', description: 'Save the last run as a skill' },
  { name: 'skills', usage: '', description: 'List saved skills' },
  { name: 'forget', usage: '<skill>', description: 'Delete a saved skill' },
  { name: 'forget-history', usage: '', description: 'Clear the prompt history' },
  { name: 'history', usage: '<search>', description: 'Search the pages you visited' },
  {
    name: 'note',
    usage: '<text>',
    description: 'Note this page (makes it a bookmark); /note clear removes it',
    options: ['clear'],
  },
  {
    name: 'history-clear',
    usage: '[all]',
    description: 'Clear browsing history (keeps noted pages unless all)',
    options: ['all'],
  },
  {
    name: 'history-summaries',
    usage: 'on|off',
    description: 'Summarise pages you spend time on with the selected model',
    options: ['on', 'off'],
  },
]

export interface PromptApi {
  /** Most recent first. */
  history(): Promise<HistoryEntry[]>
  record(entry: { kind: HistoryKind; text: string }): Promise<void>
  clearHistory(): Promise<void>
  /** Called when the user presses Ctrl/Cmd+L. Returns an unsubscribe function. */
  onOpen(listener: () => void): () => void
}
