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
  waitForLoad(timeoutMs: number): Promise<void>
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

/**
 * navigation: like the address bar, never needs approval.
 * read: needs page access. action: needs page access and the user's approval.
 */
export type ToolKind = 'navigation' | 'read' | 'action'

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
    name: 'get_page_state',
    kind: 'navigation',
    replayable: false,
    description: 'Current URL, title, loading state and whether back / forward are possible.',
    input_schema: schema(),
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

/** The tools offered to the model: without page access, navigation only (Edge-style opt-in). */
export function toolsFor(pageAccess: boolean): ToolDefinition[] {
  return toolDefinitions.filter((tool) => pageAccess || tool.kind === 'navigation')
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
    if (typeof value !== spec.type) throw new ToolError(`${name}: ${key} must be a ${spec.type}`)
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
    case 'get_page_state':
      return 'Check the page state'
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

/**
 * Runs one tool. Permission checks (page access, approval) happen in the caller; this only does
 * the work and the per-tool safety rules (no typing into sensitive fields).
 */
export async function executeTool(
  browser: BrowserPort,
  name: string,
  input: Input,
): Promise<ToolOutput> {
  const needsPage = !['navigate', 'get_page_state'].includes(name)
  if (needsPage && !browser.hasPage()) throw new ToolError('No page is loaded. Use navigate first.')

  switch (name) {
    case 'navigate': {
      const url = browser.load(String(input['url']))
      if (url === null) throw new ToolError(`Not a web address: ${String(input['url'])}`)
      await browser.waitForLoad(LOAD_TIMEOUT)
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
