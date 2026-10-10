export const channels = {
  history: 'prompt:history',
  record: 'prompt:record',
  clearHistory: 'prompt:clear-history',
  // A command from the application menu (Ctrl/Cmd+L), not a state change.
  open: 'prompt:open',
  // Ctrl/Cmd+B: show the panel if hidden, hide it if shown (main → UI, no payload).
  toggle: 'prompt:toggle',
  focusPage: 'prompt:focus-page',
  // Ctrl/Cmd+I: open the field-of-view prompt over the page, or close it (main → UI, no payload).
  fieldOfView: 'prompt:field-of-view',
  // The field of view hides the page view and gets a snapshot of it; uncover shows it again.
  coverPage: 'prompt:cover-page',
  uncoverPage: 'prompt:uncover-page',
} as const

export type HistoryKind = 'url' | 'query' | 'command'

export interface HistoryEntry {
  kind: HistoryKind
  text: string
  /** Epoch milliseconds of the last use. */
  at: number
}

export const HISTORY_LIMIT = 500

/** A built-in /command. Skills share the namespace, so their names can't be used for macros. */
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
  {
    name: 'model',
    usage: '<model>',
    description: 'Choose the model strength (runs through your Claude Code CLI)',
    options: ['haiku', 'sonnet', 'opus'],
  },
  {
    name: 'settings',
    usage: '<setting> <value>',
    description: 'Show or change the theme, model, page access and history access',
  },
  {
    name: 'welcome',
    usage: '',
    description: 'Open the welcome page: set up the Claude Code CLI, learn the prompt and skills',
  },
  {
    name: 'page-access',
    usage: 'on|off',
    description: 'Let the assistant read and act on the page',
    options: ['on', 'off'],
  },
  {
    name: 'history-access',
    usage: 'on|off',
    description: 'Let the assistant search your browsing history',
    options: ['on', 'off'],
  },
  {
    name: 'home',
    usage: '<url>',
    description:
      'Set the page new stacks open at (Ctrl/Cmd+N); /home clear removes it, /home reset restores bing.com',
    options: ['clear', 'reset'],
  },
  { name: 'menu', usage: '<menu> <item>', description: 'Run an item from the application menu' },
  {
    name: 'skills',
    usage: '',
    description: 'List macros (ask the assistant to make one: "… and store it as /name")',
  },
  {
    name: 'config',
    usage: '',
    description: 'Show all commands, skills and macros with their scripts',
  },
  { name: 'forget', usage: '<macro>', description: 'Delete a macro' },
  { name: 'forget-history', usage: '', description: 'Clear the prompt history' },
  { name: 'history', usage: '<search>', description: 'Search the pages you visited' },
  {
    name: 'recall',
    usage: '<request>',
    description: 'Show pages from history as a keyword or picture cloud (asks the selected model)',
  },
  {
    name: 'history-map',
    usage: '',
    description: 'Show visited pages as a map of groups and relations',
  },
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
  /** Called when the user presses Ctrl/Cmd+B. Returns an unsubscribe function. */
  onToggle(listener: () => void): () => void
  /** Called when the user presses Ctrl/Cmd+I. Returns an unsubscribe function. */
  onFieldOfView(listener: () => void): () => void
  /** Gives keyboard focus to the page view, if there is one. */
  focusPage(): Promise<void>
  /** Hides the page view and returns a snapshot of it (a JPEG data URL), or null without a page. */
  coverPage(): Promise<string | null>
  /** Shows the page view again. */
  uncoverPage(): Promise<void>
}
