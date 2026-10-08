import type { VisitedSuggestion } from '../../history/ipc'
import type { StackPages } from '../../stacks/ipc'
import type { HistoryEntry } from '../ipc'

/** One level of a command's nested arguments, e.g. a menu and its items. */
export interface OptionNode {
  /** What gets typed for this node. */
  name: string
  label: string
  detail?: string
  children?: OptionNode[]
}

/** A /command or skill the prompt can suggest. */
export interface SuggestCommand {
  name: string
  /** Argument placeholders, e.g. `<team>`; '' for none. */
  usage: string
  description: string
  /** Values for the first argument (e.g. model ids, skill names). */
  options?: string[]
  /** Nested arguments (`/menu view zoom-in`), suggested level by level instead of `options`. */
  tree?: OptionNode[]
  /** A macro the user saved; listed before the built-in commands. */
  macro?: boolean
}

export interface Suggestion {
  kind: 'url' | 'query' | 'command' | 'value' | 'stack' | 'page'
  /** What accepting the suggestion puts into the prompt. */
  text: string
  label: string
  detail?: string
  /** A stack or page: where picking it goes, and its `@` reference. */
  target?: { stackId: string; nodeId?: number; reference: string }
  /** A page: its depth in the stack's tree, last of its siblings here, the stack's active page. */
  depth?: number
  last?: boolean
  current?: boolean
}

export const SUGGESTION_LIMIT = 8

const bare = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')

/** Prefix matches first, then substring matches; stable within each group. */
function rank<T>(items: T[], key: (item: T) => string[], needle: string): T[] {
  const lower = needle.toLowerCase()
  const score = (item: T) => {
    const keys = key(item).map((k) => k.toLowerCase())
    if (keys.some((k) => k.startsWith(lower))) return 0
    if (keys.some((k) => k.includes(lower))) return 1
    return 2
  }
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter(({ score }) => score < 2)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ item }) => item)
}

/** Commands and skills matching a bare `/name` being typed, best first; null once arguments start. */
export function commandMatches(input: string, commands: SuggestCommand[]): SuggestCommand[] | null {
  const text = input.trimStart()
  if (!text.startsWith('/') || text.search(/\s/) !== -1) return null
  return rank(commands, (command) => [command.name], text.slice(1))
}

/** Suggestions for what's typed so far: commands and skills after `/`, else past URLs and queries. */
export function suggest(
  input: string,
  history: HistoryEntry[],
  commands: SuggestCommand[],
  limit = SUGGESTION_LIMIT,
): Suggestion[] {
  const text = input.trimStart()
  if (!text) return []

  if (text.startsWith('/')) {
    const space = text.search(/\s/)
    if (space === -1) {
      return commandMatches(text, commands)!
        .slice(0, limit)
        .map((command) => ({
          kind: 'command',
          text: `/${command.name}${command.usage ? ' ' : ''}`,
          label: `/${command.name}${command.usage ? ` ${command.usage}` : ''}`,
          detail: command.description,
        }))
    }
    // After the name: the command's own options, then arguments used with it before.
    const name = text.slice(1, space).toLowerCase()
    const command = commands.find((candidate) => candidate.name === name)
    if (!command) return []
    const typedArgs = text.slice(space).trimStart()
    if (command.tree) return suggestNested(name, command, typedArgs, text, limit)
    const options = (command.options ?? []).map((option) => `/${name} ${option}`)
    const past = history
      .filter(
        (entry) => entry.kind === 'command' && entry.text.toLowerCase().startsWith(`/${name} `),
      )
      .map((entry) => entry.text)
    const lines = [...new Set([...options, ...past])].filter(
      (line) =>
        line
          .slice(name.length + 2)
          .toLowerCase()
          .startsWith(typedArgs.toLowerCase()) && line !== text.trimEnd(),
    )
    return lines.slice(0, limit).map((line) => ({
      kind: 'value',
      text: line,
      label: line,
      detail: command.description,
    }))
  }

  const entries = history.filter((entry) => entry.kind !== 'command' && entry.text !== text)
  return rank(
    entries,
    (entry) => (entry.kind === 'url' ? [entry.text, bare(entry.text)] : [entry.text]),
    text,
  )
    .slice(0, limit)
    .map((entry) => ({
      kind: entry.kind === 'url' ? 'url' : 'query',
      text: entry.text,
      label: entry.kind === 'url' ? bare(entry.text) : entry.text,
      ...(entry.kind === 'url' && { detail: entry.text }),
    }))
}

/**
 * The nodes at the level the typed names lead to, filtered by the name being typed. A node with
 * children ends with a space, so accepting it fills it in and suggests the next level.
 */
function suggestNested(
  name: string,
  command: SuggestCommand,
  typedArgs: string,
  input: string,
  limit: number,
): Suggestion[] {
  const segments = typedArgs.split(/\s+/)
  const partial = segments.pop() ?? ''
  const trail: OptionNode[] = []
  let level = command.tree ?? []
  for (const segment of segments) {
    const node = level.find((candidate) => candidate.name === segment.toLowerCase())
    if (!node?.children) return []
    trail.push(node)
    level = node.children
  }
  return rank(level, (node) => [node.name, node.label], partial)
    .map((node): Suggestion => {
      const path = [...trail, node]
      return {
        kind: 'value',
        text: `/${name} ${path.map((n) => n.name).join(' ')}${node.children ? ' ' : ''}`,
        label: `${path.map((n) => n.label).join(' › ')}${node.children ? ' ›' : ''}`,
        detail: node.detail ?? (node.children ? 'Menu' : command.description),
      }
    })
    .filter((suggestion) => suggestion.text !== input.trimEnd())
    .slice(0, limit)
}

/**
 * Adds pages from browsing history to URL suggestions: after the URLs typed into the prompt,
 * before past questions, without duplicates. Nothing changes for /commands.
 */
export function withVisited(
  suggestions: Suggestion[],
  visited: VisitedSuggestion[],
  input: string,
  limit = SUGGESTION_LIMIT,
): Suggestion[] {
  const text = input.trimStart()
  if (!text || text.startsWith('/') || visited.length === 0) return suggestions
  const typed = suggestions.filter((suggestion) => suggestion.kind === 'url')
  const seen = new Set(typed.map((suggestion) => bare(suggestion.text)))
  const pages: Suggestion[] = []
  for (const page of visited) {
    const key = bare(page.url)
    if (seen.has(key) || page.url === text) continue
    seen.add(key)
    pages.push({ kind: 'url', text: page.url, label: page.title || key, detail: key })
  }
  const others = suggestions.filter((suggestion) => suggestion.kind !== 'url')
  return [...typed, ...pages, ...others].slice(0, limit)
}

export const MENTION_LIMIT = 200

const MENTION = /(^|\s)@([a-z0-9-]*(?:\/[a-z0-9-]*)?)$/

/** Which `/commands` take `@` references in their arguments (macros); none by default. */
export type MentionCommands = (name: string) => boolean

/**
 * The `@word` being typed at the end of the input (without `@`), or null; in a /command only in
 * the arguments of a command `inCommand` accepts (a macro).
 */
export function mentionTyped(
  input: string,
  inCommand: MentionCommands = () => false,
): string | null {
  const match = MENTION.exec(input)
  if (!match) return null
  const text = input.trimStart()
  if (!text.startsWith('/')) return match[2]!
  const command = /^\/([a-z][a-z0-9-]*)\s/.exec(text)
  return command && inCommand(command[1]!) ? match[2]! : null
}

/** Whether the input is nothing but an `@word` (spaces aside): picking a stack or page goes there. */
export const mentionOnly = (input: string) => /^@[a-z0-9-]*(?:\/[a-z0-9-]*)?$/.test(input.trim())

export interface Mentions {
  items: Suggestion[]
  /** Matching rows left out over the limit. */
  more: number
}

/**
 * Stacks and their pages for the `@word` being typed, as a tree: each stack, then its pages in
 * tree order. `@text` lists stacks whose name contains it with all their pages, and from other
 * stacks the pages whose ref, title or address contains it, with their ancestors; `@stack/text`
 * searches that stack only. Accepting one completes `@name ` or `@name/ref ` and leaves the rest
 * of the input as it is.
 */
export function suggestMentions(
  input: string,
  stacks: StackPages[],
  limit = MENTION_LIMIT,
  inCommand?: MentionCommands,
): Mentions {
  const typed = mentionTyped(input, inCommand)
  if (typed === null) return { items: [], more: 0 }
  const before = input.slice(0, input.length - typed.length - 1)
  const slash = typed.indexOf('/')
  const named = stacks.filter((stack) => stack.name !== '')
  const lower = (slash === -1 ? typed : typed.slice(slash + 1)).toLowerCase()
  const pageMatches = (row: StackPages['rows'][number]) =>
    [row.ref, row.title.toLowerCase(), bare(row.url).toLowerCase()].some((key) =>
      key.includes(lower),
    )

  // Which stacks, in which order, and whether all their pages show or only matching ones.
  let order: { stack: StackPages; all: boolean }[]
  if (slash !== -1) {
    const stack = named.find((candidate) => candidate.name === typed.slice(0, slash))
    order = stack ? [{ stack, all: lower === '' }] : []
  } else {
    const byName = rank(named, (stack) => [stack.name], typed)
    order = [
      ...byName.map((stack) => ({ stack, all: true })),
      ...named.filter((stack) => !byName.includes(stack)).map((stack) => ({ stack, all: false })),
    ]
  }

  const items: Suggestion[] = []
  for (const { stack, all } of order) {
    const shown = all ? stack.rows : withAncestors(stack.rows, pageMatches)
    if (!all && shown.length === 0) continue
    const lastShown = lastOfSiblings(shown)
    items.push({
      kind: 'stack',
      text: `${before}@${stack.name} `,
      label: `@${stack.name}`,
      detail: [stack.rootTitle, plural(stack.rows.length, 'page')].filter(Boolean).join(' · '),
      target: { stackId: stack.id, reference: `@${stack.name}` },
    })
    shown.forEach((row, index) => {
      const reference = `@${stack.name}/${row.ref}`
      items.push({
        kind: 'page',
        text: `${before}${reference} `,
        label: row.title || bare(row.url),
        detail: bare(row.url),
        target: { stackId: stack.id, nodeId: row.id, reference },
        depth: row.depth,
        last: lastShown[index]!,
        current: row.id === stack.activeId,
      })
    })
  }
  const fresh = items.filter((item) => item.target!.reference !== `@${typed}`)
  return { items: fresh.slice(0, limit), more: Math.max(0, fresh.length - limit) }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/** The rows that match and their ancestors, in tree (depth-first) order. */
function withAncestors<T extends { depth: number }>(rows: T[], matches: (row: T) => boolean): T[] {
  const keep = new Set<number>()
  const path: number[] = []
  rows.forEach((row, index) => {
    path.length = row.depth
    path.push(index)
    if (matches(row)) for (const at of path) keep.add(at)
  })
  return rows.filter((_, index) => keep.has(index))
}

/** For rows in depth-first order: whether each is the last of its siblings among these rows. */
function lastOfSiblings(rows: { depth: number }[]): boolean[] {
  const last: boolean[] = []
  // Walking backwards, `seen[d]` says a later sibling at depth d exists under the same parent.
  const seen: boolean[] = []
  for (let index = rows.length - 1; index >= 0; index--) {
    const depth = rows[index]!.depth
    last[index] = !seen[depth]
    seen.length = depth
    seen[depth] = true
  }
  return last
}

/** The distinct `@name`s and `@name/ref`s in the text whose name is a known stack, in order. */
export function stackRefs(text: string, names: string[]): string[] {
  const known = new Set(names.filter((name) => name !== ''))
  const found: string[] = []
  for (const match of text.matchAll(/(?:^|\s)@([a-z0-9-]+(?:\/[a-z0-9-]+)?)(?=$|[\s.,;:!?)])/g)) {
    const reference = match[1]!
    if (known.has(reference.split('/')[0]!) && !found.includes(reference)) found.push(reference)
  }
  return found
}

/**
 * Macro arguments with each `@name` / `@name/ref` that names a known stack or page replaced by
 * its URL (a stack: its active page, else its first). Unknown `@words` stay as they are.
 */
export function resolveRefs(args: string, stacks: StackPages[]): string {
  return args.replace(
    /(^|\s)@([a-z0-9-]+)(?:\/([a-z0-9-]+))?(?=$|\s)/g,
    (whole, space: string, name: string, ref: string | undefined) => {
      const stack = stacks.find((candidate) => candidate.name === name && name !== '')
      if (!stack) return whole
      const row =
        ref === undefined
          ? (stack.rows.find((candidate) => candidate.id === stack.activeId) ?? stack.rows[0])
          : stack.rows.find((candidate) => candidate.ref === ref)
      return row ? `${space}${row.url}` : whole
    },
  )
}
