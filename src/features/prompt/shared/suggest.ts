import type { VisitedSuggestion } from '../../history/ipc'
import type { HistoryEntry } from '../ipc'

/** A /command or skill the prompt can suggest. */
export interface SuggestCommand {
  name: string
  /** Argument placeholders, e.g. `<team>`; '' for none. */
  usage: string
  description: string
  /** Values for the first argument (e.g. model ids, skill names). */
  options?: string[]
}

export interface Suggestion {
  kind: 'url' | 'query' | 'command' | 'value'
  /** What accepting the suggestion puts into the prompt. */
  text: string
  label: string
  detail?: string
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
      const typed = text.slice(1)
      return rank(commands, (command) => [command.name], typed)
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
