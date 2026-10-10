import type { NavigationState } from '../../navigation/ipc'
import {
  findInPage,
  inspectElement,
  readPage,
  scrollPage,
  type ElementInfo,
  type FindResult,
  type PageSnapshot,
  type ScrollResult,
} from '../shared/page-scripts'

/** What the tools need from the browser; implemented over the navigation page view in browser.ts. */
export interface BrowserPort {
  state(): NavigationState
  /** Loads a URL (checked with toUrl); returns the URL or null if it isn't a web address. */
  load(url: string): string | null
  back(): void
  forward(): void
  reload(): void
  stop(): void
  /** Why the page failed to load (e.g. `ERR_CONNECTION_REFUSED`), or null. */
  waitForLoad(timeoutMs: number): Promise<string | null>
  /** False before the first page is loaded. */
  hasPage(): boolean
  run<A, R>(script: (args: A) => R, args: A): Promise<R>
  /** JPEG screenshot of the page view, plus a small thumbnail for the debug panel. */
  capture(): Promise<{ data: string; thumbnail: string }>
  click(x: number, y: number): Promise<void>
  insertText(text: string): Promise<void>
  pressKey(key: PageKey): Promise<void>
}

export const pageKeys = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Space',
] as const
export type PageKey = (typeof pageKeys)[number]

/** One page of the user's browsing history, as the history feature hands it to the agent. */
export interface HistoryHit {
  title: string
  url: string
  /** Epoch milliseconds. */
  lastVisitAt: number
  visitCount: number
  note: string | null
  description: string | null
  summary: string | null
  /** Text around a full-text match. */
  snippet: string | null
}

export type HistorySearchMode = 'meaning' | 'text'

/** A page recalled from history (recall_history): how well it matches and what it is about. */
export interface RecalledHit {
  title: string
  url: string
  /** Epoch milliseconds. */
  lastVisitAt: number
  /** 0–1. */
  score: number
  keywords: string[]
  note: string | null
}

/** An image the user attached to the current request, as the prompt sent it. */
export interface AttachedImage {
  mediaType: string
  /** base64, no data: prefix */
  data: string
}

export type RecallView = 'words' | 'images'

export interface HistoryRecallRequest {
  query: string
  image: AttachedImage | null
  view: RecallView | null
  /** Open the Recall page with the result. */
  show: boolean
}

export interface HistoryRecall {
  view: RecallView
  /** Best match first. */
  pages: RecalledHit[]
  /** Heaviest first. */
  keywords: { text: string; weight: number }[]
  notice?: string
}

/** A macro (a saved skill) as the agent sees it; its steps are replayable tool calls. */
export interface MacroInfo {
  name: string
  description: string
  params: { name: string; hint: string }[]
  steps: { tool: string; input: Record<string, string | number | boolean> }[]
}

/** The macro store, provided by the skills feature (provideMacros in main.ts). */
export interface MacroPort {
  list(): MacroInfo[]
  /** Validates and stores (creates or replaces) a macro; throws a TypeError the model can read. */
  save(definition: unknown): MacroInfo
  /** Throws a TypeError for unknown or built-in names. */
  delete(name: string): void
}

/** A page of a stack, as the stacks feature lists it for the agent. */
export interface StackPageInfo {
  title: string
  url: string
  /** Depth in the stack's tree (0 = root). */
  depth: number
  /** `@stack/ref` names the page in the prompt. */
  ref: string
  active: boolean
}

/** A stack (the browser's tab) as the stacks feature lists it for the agent. */
export interface StackInfo {
  /** '' for a stack without a name yet ("New tab"). */
  name: string
  rootTitle: string
  current: boolean
  imported: boolean
  /** Its pages in tree order (depth first). */
  pages: StackPageInfo[]
}

/** The stacks, provided by the stacks feature (provideStacks in main.ts). */
export interface StackPort {
  /** Opens a new stack, like Ctrl/Cmd+N. */
  open(): void
  /** Every stack, most recently used first. */
  list(): StackInfo[]
}

/** History's search, provided by the history feature (provideHistorySearch in main.ts). */
export interface HistoryPort {
  search(
    query: string,
    mode: HistorySearchMode,
    bookmarked: boolean,
  ): Promise<{ pages: HistoryHit[]; notice?: string }>
  /** Recall (keywords and scores, by a request and/or an image); rejects with a readable error. */
  recall(request: HistoryRecallRequest, signal?: AbortSignal): Promise<HistoryRecall>
}

/** Imports another browser's export, provided by the import feature (provideImporter in main.ts). */
export interface ImportPort {
  /**
   * Imports the file at `path` (an empty path opens a file dialog); resolves with a one-line
   * result, rejects with a readable error.
   */
  run(path: string, signal?: AbortSignal): Promise<string>
}

/**
 * navigation: like the address bar, never needs approval.
 * history: reads the browsing history or the open stacks; no page access or approval, but like reading a page it
 * makes a later cross-site navigation in the run ask first.
 * macro: saves, lists or deletes macros; no page access, approval only after page or history
 * content was read in the run.
 * import: reads a file on the user's computer into history and stacks; no page access, needs no
 * browser; the user approves it when the model calls it (a typed skill is the user's own request).
 * read: needs page access. action: needs page access and the user's approval.
 */
export type ToolKind = 'navigation' | 'history' | 'macro' | 'import' | 'read' | 'action'

/** Read and action tools work on the page and need page access. */
export function needsPageAccess(tool: ToolDefinition): boolean {
  return tool.kind === 'read' || tool.kind === 'action'
}

export interface ToolDefinition {
  name: string
  kind: ToolKind
  /** Replayed by skills (read tools only inform the model). */
  replayable: boolean
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
    additionalProperties: false
  }
}

const schema = (properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ type: 'object', properties, required, additionalProperties: false }) as const
const macroName = {
  type: 'string',
  description: 'Macro name without the slash: lowercase letters, digits and -, up to 32.',
}
const selector = {
  type: 'string',
  description: 'CSS selector of the element, from read_page.',
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'navigate',
    kind: 'navigation',
    replayable: true,
    description:
      'Load a web address (http or https URL, or a host like example.com) in the page and wait for it to load.',
    input_schema: schema({ url: { type: 'string' } }, ['url']),
  },
  {
    name: 'go_back',
    kind: 'navigation',
    replayable: true,
    description: 'Go back one page in history.',
    input_schema: schema(),
  },
  {
    name: 'go_forward',
    kind: 'navigation',
    replayable: true,
    description: 'Go forward one page in history.',
    input_schema: schema(),
  },
  {
    name: 'reload',
    kind: 'navigation',
    replayable: true,
    description: 'Reload the page.',
    input_schema: schema(),
  },
  {
    name: 'stop',
    kind: 'navigation',
    replayable: true,
    description: 'Stop loading the page.',
    input_schema: schema(),
  },
  {
    name: 'new_stack',
    kind: 'navigation',
    replayable: true,
    description:
      'Open a new stack (the browser\'s tabs; like Ctrl/Cmd+N, "open a new window/tab") at the home page, or at url if given, and make it the current page.',
    input_schema: schema({ url: { type: 'string' } }),
  },
  {
    name: 'list_stacks',
    kind: 'history',
    replayable: false,
    description:
      "List the user's open stacks (the browser's tabs), most recently used first, with their root page and number of pages; with stack, list that stack's pages as an outline with their URLs. Use it to count stacks or find which stack holds a page.",
    input_schema: schema({
      stack: { type: 'string', description: 'A stack name, with or without the @.' },
    }),
  },
  {
    name: 'get_page_state',
    kind: 'navigation',
    replayable: false,
    description: 'Current URL, title, loading state and whether back / forward are possible.',
    input_schema: schema(),
  },
  {
    name: 'search_history',
    kind: 'history',
    replayable: false,
    description:
      "Search the user's browsing history (pages they visited before, with their notes). mode 'meaning' (default) finds pages about a topic even without the exact words; 'text' matches exact words in the pages' titles, addresses and text. bookmarked: only pages the user noted. Returns up to 20 pages, best match first. Use it for anything the user read or visited earlier; open a result with navigate.",
    input_schema: schema(
      {
        query: { type: 'string', description: 'What to look for, in a few words.' },
        mode: { type: 'string', enum: ['meaning', 'text'] },
        bookmarked: { type: 'boolean' },
      },
      ['query'],
    ),
  },
  {
    name: 'recall_history',
    kind: 'history',
    replayable: false,
    description:
      "Recall pages from the user's browsing history by a request and/or by an image the user attached to their current message (compared with screenshots of the pages, e.g. \"the page with a picture like this\"). Returns up to 20 pages with a relevance score (0–1) and keywords saying what each is about, and the overall keywords. Unless show is false it also opens the Recall page, where the user sees the result as a keyword cloud (view 'words') or a picture cloud (view 'images'). Use it to show the user what they read about a topic, or to find a page by a picture; use search_history for a quick list. Give query, image or both.",
    input_schema: schema({
      query: { type: 'string', description: "What to recall, in the user's words." },
      image: {
        type: 'integer',
        description:
          "Use the n-th image attached to the user's current message (1 = first) as the picture to look for.",
      },
      view: { type: 'string', enum: ['words', 'images'] },
      show: {
        type: 'boolean',
        description: 'Open the Recall page with the cloud (default true).',
      },
    }),
  },
  {
    name: 'save_macro',
    kind: 'macro',
    replayable: false,
    description:
      "Store a macro the user can run later by typing /name in the prompt, without you. Its steps are browser tool calls replayed in order; only navigate, go_back, go_forward, reload, stop, new_stack, click, type_text, press_key and scroll can be steps, with the same inputs as those tools. A string input may contain {{param}} placeholders, filled from the arguments typed after /name (in order; the last parameter takes the rest of the line; an @stack or @stack/page argument becomes that page's URL). Declare every placeholder in params with a short hint of what to type. Replaces a macro with the same name.",
    input_schema: schema(
      {
        name: macroName,
        description: { type: 'string', description: 'What the macro does, in a few words.' },
        params: {
          type: 'array',
          description: 'Parameters in the order they are typed after /name.',
          items: schema(
            {
              name: {
                type: 'string',
                description: 'Placeholder name: letters, digits and _ (used as {{name}}).',
              },
              hint: { type: 'string', description: 'What to type, e.g. "search term".' },
            },
            ['name', 'hint'],
          ),
        },
        steps: {
          type: 'array',
          items: schema(
            {
              tool: { type: 'string', description: 'A replayable tool name.' },
              input: { type: 'object', description: "The tool's input." },
            },
            ['tool', 'input'],
          ),
        },
      },
      ['name', 'description', 'params', 'steps'],
    ),
  },
  {
    name: 'list_macros',
    kind: 'macro',
    replayable: false,
    description: 'List the saved macros with their parameters and steps.',
    input_schema: schema(),
  },
  {
    name: 'delete_macro',
    kind: 'macro',
    replayable: false,
    description: 'Delete a saved macro.',
    input_schema: schema({ name: macroName }, ['name']),
  },
  {
    name: 'import_browsing_data',
    kind: 'import',
    replayable: true,
    description:
      'Import the file Edge\'s "Export browsing data" created (a .csv) into the user\'s history and stacks: pages are grouped into stacks by site and, when the assistant can tell, by topic. Only call it when the user asked to import a file in this request. Give the path they gave, or no path to open a file dialog where the user chooses. The user is asked to approve it.',
    input_schema: schema({
      path: {
        type: 'string',
        description:
          'Path of the exported .csv file on this computer; omit to let the user choose it in a dialog.',
      },
    }),
  },
  {
    name: 'read_page',
    kind: 'read',
    replayable: false,
    description:
      'Read the visible text of the page and a numbered list of its interactive elements (role, name, CSS selector). Use the selectors with click and type_text.',
    input_schema: schema(),
  },
  {
    name: 'find_in_page',
    kind: 'read',
    replayable: false,
    description:
      'Find text on the page (case-insensitive); returns the number of matches and snippets.',
    input_schema: schema({ text: { type: 'string' } }, ['text']),
  },
  {
    name: 'screenshot',
    kind: 'read',
    replayable: false,
    description: 'Take a screenshot of the visible part of the page.',
    input_schema: schema(),
  },
  {
    name: 'click',
    kind: 'action',
    replayable: true,
    description: 'Click an element. The user must approve each click.',
    input_schema: schema({ selector }, ['selector']),
  },
  {
    name: 'type_text',
    kind: 'action',
    replayable: true,
    description:
      'Replace the content of a text field with `text`, optionally pressing Enter afterwards. The user must approve it. Password and payment card fields are refused.',
    input_schema: schema({ selector, text: { type: 'string' }, submit: { type: 'boolean' } }, [
      'selector',
      'text',
    ]),
  },
  {
    name: 'press_key',
    kind: 'action',
    replayable: true,
    description: 'Press a key in the page (on the focused element). The user must approve it.',
    input_schema: schema({ key: { type: 'string', enum: [...pageKeys] } }, ['key']),
  },
  {
    name: 'scroll',
    kind: 'read',
    replayable: true,
    description: 'Scroll the page by about a screen, or to the top or bottom.',
    input_schema: schema({ direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] } }, [
      'direction',
    ]),
  },
]

const byName = new Map(toolDefinitions.map((tool) => [tool.name, tool]))

export function toolNamed(name: string): ToolDefinition | undefined {
  return byName.get(name)
}

/**
 * The tools offered to the model: without page access no page tools (Edge-style opt-in), without
 * history access no history search.
 */
export function toolsFor(access: {
  pageAccess: boolean
  historyAccess: boolean
}): ToolDefinition[] {
  return toolDefinitions.filter(
    (tool) =>
      (access.pageAccess || !needsPageAccess(tool)) &&
      (access.historyAccess || tool.kind !== 'history'),
  )
}

export class ToolError extends Error {}

type Input = Record<string, unknown>

/** Checks a tool input against the tool's schema (the model or a skill file may send anything). */
export function validateInput(name: string, input: unknown): Input {
  const tool = byName.get(name)
  if (!tool) throw new ToolError(`Unknown tool ${name}`)
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ToolError(`${name} expects an object`)
  }
  const record = input as Input
  const { properties, required } = tool.input_schema
  for (const key of Object.keys(record)) {
    if (!(key in properties)) throw new ToolError(`${name}: unexpected argument ${key}`)
  }
  for (const key of required) {
    if (!(key in record)) throw new ToolError(`${name}: missing argument ${key}`)
  }
  for (const [key, value] of Object.entries(record)) {
    const spec = properties[key] as { type: string; enum?: string[] }
    // Arrays and objects are only checked for their shape here; the tool checks their content.
    const type = Array.isArray(value)
      ? 'array'
      : value === null
        ? 'null'
        : Number.isInteger(value) && spec.type === 'integer'
          ? 'integer'
          : typeof value
    if (type !== spec.type) throw new ToolError(`${name}: ${key} must be a ${spec.type}`)
    if (spec.enum && !spec.enum.includes(value as string)) {
      throw new ToolError(`${name}: ${key} must be one of ${spec.enum.join(', ')}`)
    }
    if (typeof value === 'string' && value.length > 10_000) {
      throw new ToolError(`${name}: ${key} is too long`)
    }
  }
  return record
}

/** One line for the conversation and the approval prompt. */
export function describeCall(name: string, input: Input, element?: ElementInfo): string {
  const target = element?.found
    ? `${element.role ?? element.tag} "${element.name || '(unnamed)'}" (${String(input['selector'])})`
    : String(input['selector'] ?? '')
  switch (name) {
    case 'navigate':
      return `Open ${String(input['url'])}`
    case 'go_back':
      return 'Go back'
    case 'go_forward':
      return 'Go forward'
    case 'reload':
      return 'Reload the page'
    case 'stop':
      return 'Stop loading'
    case 'new_stack':
      return input['url'] ? `Open a new stack at ${String(input['url'])}` : 'Open a new stack'
    case 'get_page_state':
      return 'Check the page state'
    case 'list_stacks':
      return input['stack']
        ? `List the pages of @${String(input['stack']).replace(/^@/, '')}`
        : 'List stacks'
    case 'save_macro': {
      const steps = Array.isArray(input['steps']) ? input['steps'].length : 0
      return `Save macro /${String(input['name'])} (${steps} step${steps === 1 ? '' : 's'})`
    }
    case 'list_macros':
      return 'List macros'
    case 'delete_macro':
      return `Delete macro /${String(input['name'])}`
    case 'search_history':
      return `Search history for "${String(input['query'])}"${input['mode'] === 'text' ? ' by text' : ''}${input['bookmarked'] ? ' in bookmarks' : ''}`
    case 'recall_history': {
      const image = input['image'] !== undefined ? `your image ${String(input['image'])}` : ''
      const query = input['query'] ? `"${String(input['query'])}"` : ''
      return `Recall history for ${[query, image].filter(Boolean).join(' by ')}`
    }
    case 'import_browsing_data':
      return typeof input['path'] === 'string' && input['path'].trim()
        ? `Import browsing data from ${input['path']}`
        : 'Import browsing data (you choose the file)'
    case 'read_page':
      return 'Read the page'
    case 'find_in_page':
      return `Find "${String(input['text'])}" on the page`
    case 'screenshot':
      return 'Take a screenshot'
    case 'click':
      return `Click ${target}`
    case 'type_text':
      return `Type "${String(input['text'])}" into ${target}${input['submit'] ? ' and press Enter' : ''}`
    case 'press_key':
      return `Press ${String(input['key'])}`
    case 'scroll':
      return `Scroll ${String(input['direction'])}`
    default:
      return name
  }
}

/** What a tool returns to the model. Page content is wrapped as untrusted. */
export interface ToolOutput {
  text: string
  /** base64 JPEG for the model (screenshot). */
  image?: string
  /** data: URL thumbnail for the debug panel. */
  thumbnail?: string
}

export const MAX_PAGE_TEXT = 20_000
const LOAD_TIMEOUT = 15_000

/** Marks text that came from a web page, which the model must treat as data, not instructions. */
export function untrusted(text: string): string {
  // A page can't close the marker early by including it.
  const safe = text.replaceAll('</untrusted_page_content>', '</untrusted_page_content​>')
  return `<untrusted_page_content>\n${safe}\n</untrusted_page_content>`
}

export function formatState(state: NavigationState): string {
  if (state.url === '') return 'No page is loaded.'
  return [
    `URL: ${state.url}`,
    `Title: ${untrusted(state.title)}`,
    `Loading: ${state.loading}`,
    `Can go back: ${state.canGoBack}, can go forward: ${state.canGoForward}`,
  ].join('\n')
}

function formatSnapshot(page: PageSnapshot): string {
  const elements = page.elements.map(
    (element) => `[${element.index}] ${element.role} "${element.name}" → ${element.selector}`,
  )
  return [
    `URL: ${page.url}`,
    untrusted(
      [
        `Title: ${page.title}`,
        '',
        page.text + (page.textTruncated ? `\n[text truncated at ${MAX_PAGE_TEXT} characters]` : ''),
        '',
        'Interactive elements:',
        ...elements,
        ...(page.elementsTruncated ? ['[more elements not listed]'] : []),
      ].join('\n'),
    ),
  ].join('\n')
}

/** Looks an element up for an action; throws a ToolError the model can read if it's missing. */
export async function inspect(browser: BrowserPort, selector: string, focus = false) {
  const info = await browser.run(inspectElement, { selector, focus })
  if (!info.found) throw new ToolError(`${info.error ?? 'Element not found'}: ${selector}`)
  return info
}

export const MAX_HISTORY_QUERY = 500
const MAX_HISTORY_RESULTS = 20

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value
const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim()

/** History results for the model: one page per line, page data marked untrusted. */
export function formatHistory(pages: HistoryHit[], notice?: string): string {
  const lines = pages.slice(0, MAX_HISTORY_RESULTS).map((page, index) => {
    const visits = `${page.visitCount} visit${page.visitCount === 1 ? '' : 's'}`
    const date = new Date(page.lastVisitAt).toISOString().slice(0, 10)
    const about = page.summary ?? page.description
    return [
      `${index + 1}. ${oneLine(clip(page.title, 200)) || '(untitled)'} – ${clip(page.url, 300)}`,
      `last visited ${date}, ${visits}`,
      ...(page.note ? [`note: ${oneLine(clip(page.note, 500))}`] : []),
      ...(about ? [`about: ${oneLine(clip(about, 400))}`] : []),
      ...(page.snippet ? [`match: ${oneLine(clip(page.snippet, 300))}`] : []),
    ].join(' · ')
  })
  const head =
    lines.length === 0
      ? 'No pages in history match.'
      : `${lines.length} page(s) from the browsing history, best match first.`
  return [
    ...(notice ? [notice] : []),
    head,
    ...(lines.length > 0 ? [untrusted(lines.join('\n'))] : []),
  ].join('\n')
}

async function searchHistory(history: HistoryPort | null, input: Input): Promise<ToolOutput> {
  if (!history) throw new ToolError('Browsing history is not available.')
  const query = String(input['query']).trim()
  if (!query) throw new ToolError('search_history: query is empty')
  if (query.length > MAX_HISTORY_QUERY) {
    throw new ToolError(`search_history: query is longer than ${MAX_HISTORY_QUERY} characters`)
  }
  const mode = input['mode'] === 'text' ? 'text' : 'meaning'
  const { pages, notice } = await history.search(query, mode, input['bookmarked'] === true)
  return { text: formatHistory(pages, notice) }
}

const MAX_RECALL_KEYWORDS = 20

/** Recall results for the model: pages with score and keywords, then the overall keywords. */
export function formatRecall(result: HistoryRecall, shown: boolean): string {
  const lines = result.pages.slice(0, MAX_HISTORY_RESULTS).map((page, index) => {
    const date = new Date(page.lastVisitAt).toISOString().slice(0, 10)
    return [
      `${index + 1}. ${oneLine(clip(page.title, 200)) || '(untitled)'} – ${clip(page.url, 300)}`,
      `score ${page.score.toFixed(2)}`,
      `last visited ${date}`,
      ...(page.keywords.length > 0 ? [`keywords: ${page.keywords.join(', ')}`] : []),
      ...(page.note ? [`note: ${oneLine(clip(page.note, 500))}`] : []),
    ].join(' · ')
  })
  const keywords = result.keywords
    .slice(0, MAX_RECALL_KEYWORDS)
    .map((keyword) => `${keyword.text} (${keyword.weight})`)
  const head =
    lines.length === 0
      ? 'No pages in history match.'
      : `${lines.length} page(s) recalled from the browsing history, best match first.`
  const page = shown
    ? `The Recall page shows them to the user as a ${result.view === 'images' ? 'picture' : 'keyword'} cloud.`
    : ''
  return [
    ...(result.notice ? [result.notice] : []),
    head,
    ...(page && lines.length > 0 ? [page] : []),
    ...(lines.length > 0
      ? [
          untrusted(
            [...lines, ...(keywords.length ? [`Keywords: ${keywords.join(', ')}`] : [])].join('\n'),
          ),
        ]
      : []),
  ].join('\n')
}

async function recallHistory(ports: ToolPorts, input: Input): Promise<ToolOutput> {
  if (!ports.history) throw new ToolError('Browsing history is not available.')
  const query = typeof input['query'] === 'string' ? input['query'].trim() : ''
  if (query.length > MAX_HISTORY_QUERY) {
    throw new ToolError(`recall_history: query is longer than ${MAX_HISTORY_QUERY} characters`)
  }
  let image: AttachedImage | null = null
  if (input['image'] !== undefined) {
    const images = ports.images ?? []
    const n = Number(input['image'])
    image = images[n - 1] ?? null
    if (!image) {
      throw new ToolError(
        images.length === 0
          ? 'recall_history: no image is attached to the current request; ask the user to attach one.'
          : `recall_history: there is no image ${n}; the current request has ${images.length} image(s).`,
      )
    }
  }
  if (!query && !image) throw new ToolError('recall_history: give a query, an image or both')
  const view = input['view'] === 'words' || input['view'] === 'images' ? input['view'] : null
  const show = input['show'] !== false
  let result: HistoryRecall
  try {
    result = await ports.history.recall({ query, image, view, show }, ports.signal)
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : String(error))
  }
  return { text: formatRecall(result, show) }
}

/** `/name <param> …` */
export const macroSignature = (macro: Pick<MacroInfo, 'name' | 'params'>) =>
  [`/${macro.name}`, ...macro.params.map((param) => `<${param.name}>`)].join(' ')

/** One line per macro for `<browser_state>`, or '' without macros. */
export function formatMacroList(macros: MacroInfo[]): string {
  return macros
    .map((macro) => `${macroSignature(macro)}${macro.description ? ` – ${macro.description}` : ''}`)
    .join('\n')
}

/** Rejections from the macro store (TypeError) become errors the model reads. */
function macroCall<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : String(error))
  }
}

function runMacroTool(macros: MacroPort | null, name: string, input: Input): ToolOutput {
  if (!macros) throw new ToolError('Macros are not available.')
  switch (name) {
    case 'save_macro': {
      const saved = macroCall(() => macros.save(input))
      return {
        text: `Saved ${macroSignature(saved)} (${saved.steps.length} step(s)). The user runs it by typing ${macroSignature(saved)} in the prompt.`,
      }
    }
    case 'delete_macro':
      macroCall(() => macros.delete(String(input['name'])))
      return { text: `Deleted /${String(input['name'])}.` }
    default: {
      const list = macros.list()
      return {
        text:
          list.length === 0
            ? 'No macros are saved.'
            : JSON.stringify(
                list.map(({ name: macro, description, params, steps }) => ({
                  name: macro,
                  description,
                  params,
                  steps,
                })),
                null,
                1,
              ),
      }
    }
  }
}

async function importBrowsingData(
  importer: ImportPort | null,
  input: Input,
  signal?: AbortSignal,
): Promise<ToolOutput> {
  if (!importer) throw new ToolError('Importing is not available.')
  try {
    return { text: await importer.run(String(input['path'] ?? ''), signal) }
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : String(error))
  }
}

export const MAX_LISTED_PAGES = 200

const stackLabel = (stack: Pick<StackInfo, 'name'>) => (stack.name ? `@${stack.name}` : 'New tab')

/** `<browser_state>`'s stacks line: how many are open and which is current. */
export function formatStackCount(stacks: StackInfo[]): string {
  const current = stacks.find((stack) => stack.current)
  return `Open stacks: ${stacks.length}${current ? ` (current: ${stackLabel(current)})` : ''}`
}

/** All stacks, one line each (list_stacks without a stack). Titles are untrusted. */
export function formatStackList(stacks: StackInfo[]): string {
  if (stacks.length === 0) return 'No stacks are open.'
  const lines = stacks.map((stack) =>
    [
      stackLabel(stack),
      stack.rootTitle,
      `${stack.pages.length} ${stack.pages.length === 1 ? 'page' : 'pages'}`,
      ...(stack.current ? ['current'] : []),
      ...(stack.imported ? ['imported'] : []),
    ].join(' – '),
  )
  return `${stacks.length} open ${stacks.length === 1 ? 'stack' : 'stacks'} (most recently used first):\n${untrusted(lines.join('\n'))}`
}

/** One stack's pages as an outline (list_stacks with a stack). Titles and URLs are untrusted. */
export function formatStackPages(stack: StackInfo): string {
  const shown = stack.pages.slice(0, MAX_LISTED_PAGES)
  const lines = shown.map(
    (page) =>
      `${'  '.repeat(page.depth)}- ${page.title || '(untitled)'} – ${page.url} (@${stack.name}/${page.ref})${page.active ? ' ← current page' : ''}`,
  )
  const more = stack.pages.length - shown.length
  return [
    `${stackLabel(stack)}: ${stack.pages.length} ${stack.pages.length === 1 ? 'page' : 'pages'}${stack.current ? ', the current stack' : ''}`,
    untrusted(lines.join('\n') + (more > 0 ? `\n… ${more} more` : '')),
  ].join('\n')
}

function listStacks(stacks: StackPort | null, input: Input): ToolOutput {
  if (!stacks) throw new ToolError('Stacks are not available.')
  const all = stacks.list()
  if (typeof input['stack'] !== 'string' || !input['stack'].trim()) {
    return { text: formatStackList(all) }
  }
  const name = input['stack'].trim().replace(/^@/, '')
  const stack = all.find((s) => s.name === name)
  if (!stack) throw new ToolError(`No stack is named @${name}. Call list_stacks to see them.`)
  return { text: formatStackPages(stack) }
}

/** What the tools reach besides the page: history's search, the macro store, the stacks. */
export interface ToolPorts {
  history?: HistoryPort | null
  macros?: MacroPort | null
  stacks?: StackPort | null
  importer?: ImportPort | null
  /** Images attached to the current request (recall_history). */
  images?: AttachedImage[]
  /** Aborted when the run stops (tools that wait on a model request). */
  signal?: AbortSignal
}

/**
 * Runs one tool. Permission checks (page access, approval) happen in the caller; this only does
 * the work and the per-tool safety rules (no typing into sensitive fields).
 */
export async function executeTool(
  browser: BrowserPort | null,
  name: string,
  input: Input,
  ports: ToolPorts = {},
): Promise<ToolOutput> {
  if (name === 'search_history') return searchHistory(ports.history ?? null, input)
  if (name === 'recall_history') return recallHistory(ports, input)
  if (name === 'list_stacks') return listStacks(ports.stacks ?? null, input)
  if (name === 'import_browsing_data')
    return importBrowsingData(ports.importer ?? null, input, ports.signal)
  if (toolNamed(name)?.kind === 'macro') return runMacroTool(ports.macros ?? null, name, input)
  if (!browser) throw new ToolError('The browser page is not available.')
  if (name === 'new_stack') {
    if (!ports.stacks) throw new ToolError('Stacks are not available.')
    ports.stacks.open()
    if (typeof input['url'] === 'string' && input['url'].trim()) {
      const url = browser.load(input['url'])
      if (url === null) throw new ToolError(`Not a web address: ${input['url']}`)
    }
    await settle(browser)
    return { text: `Opened a new stack. ${formatState(browser.state())}` }
  }
  const needsPage = !['navigate', 'get_page_state'].includes(name)
  if (needsPage && !browser.hasPage()) throw new ToolError('No page is loaded. Use navigate first.')

  switch (name) {
    case 'navigate': {
      const url = browser.load(String(input['url']))
      if (url === null) throw new ToolError(`Not a web address: ${String(input['url'])}`)
      const failure = await browser.waitForLoad(LOAD_TIMEOUT)
      if (failure) throw new ToolError(`Could not load ${url}: ${failure}`)
      return { text: formatState(browser.state()) }
    }
    case 'go_back':
    case 'go_forward': {
      const before = browser.state()
      if (name === 'go_back' ? !before.canGoBack : !before.canGoForward) {
        throw new ToolError(`Can't go ${name === 'go_back' ? 'back' : 'forward'}`)
      }
      if (name === 'go_back') browser.back()
      else browser.forward()
      await settle(browser)
      return { text: formatState(browser.state()) }
    }
    case 'reload':
      browser.reload()
      await settle(browser)
      return { text: formatState(browser.state()) }
    case 'stop':
      browser.stop()
      return { text: formatState(browser.state()) }
    case 'get_page_state':
      return { text: formatState(browser.state()) }
    case 'read_page':
      return {
        text: formatSnapshot(
          await browser.run(readPage, { maxText: MAX_PAGE_TEXT, maxElements: 200 }),
        ),
      }
    case 'find_in_page': {
      const result: FindResult = await browser.run(findInPage, {
        text: String(input['text']),
        max: 20,
      })
      return {
        text:
          result.total === 0
            ? 'No matches.'
            : `${result.total} match(es).\n${untrusted(result.matches.join('\n'))}`,
      }
    }
    case 'screenshot': {
      const { data, thumbnail } = await browser.capture()
      return { text: 'Screenshot of the visible page:', image: data, thumbnail }
    }
    case 'click': {
      const info = await inspect(browser, String(input['selector']))
      await browser.click(info.x!, info.y!)
      await settle(browser)
      return { text: `Clicked. ${formatState(browser.state())}` }
    }
    case 'type_text': {
      const info = await inspect(browser, String(input['selector']))
      if (info.sensitive) {
        throw new ToolError(
          'Refused: this is a password or payment field. Ask the user to fill it in.',
        )
      }
      await inspect(browser, String(input['selector']), true)
      await browser.insertText(String(input['text']))
      if (input['submit'] === true) {
        await browser.pressKey('Enter')
        await settle(browser)
      }
      return { text: `Typed. ${formatState(browser.state())}` }
    }
    case 'press_key':
      await browser.pressKey(input['key'] as PageKey)
      await settle(browser)
      return { text: `Pressed ${String(input['key'])}. ${formatState(browser.state())}` }
    case 'scroll': {
      const result: ScrollResult = await browser.run(scrollPage, {
        direction: input['direction'] as 'up' | 'down' | 'top' | 'bottom',
      })
      return {
        text: `Scrolled to ${result.scrollY} of ${result.scrollHeight} px (viewport ${result.viewportHeight} px).`,
      }
    }
    default:
      throw new ToolError(`Unknown tool ${name}`)
  }
}

/** Gives a click or key press a moment to start a navigation, then waits for it to finish. */
async function settle(browser: BrowserPort) {
  await new Promise((resolve) => setTimeout(resolve, 150))
  await browser.waitForLoad(LOAD_TIMEOUT)
}
