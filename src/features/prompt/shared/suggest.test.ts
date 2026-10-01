import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../ipc'
import { suggest, SUGGESTION_LIMIT, type SuggestCommand } from './suggest'

const at = 0
const history: HistoryEntry[] = [
  { kind: 'url', text: 'https://news.example.com/', at },
  { kind: 'query', text: 'summarize the news', at },
  { kind: 'command', text: '/team alpha', at },
  { kind: 'command', text: '/team beta squad', at },
  { kind: 'url', text: 'https://www.github.com/jk09', at },
]
const commands: SuggestCommand[] = [
  { name: 'new', usage: '', description: 'Start a new conversation' },
  {
    name: 'model',
    usage: '<model>',
    description: 'Choose the model',
    options: ['claude-opus-5-5', 'claude-haiku-4-5'],
  },
  { name: 'team', usage: '<name>', description: 'Open the team dashboard' },
  { name: 'reload', usage: '', description: 'Reload the page' },
]

describe('suggest', () => {
  it('suggests nothing for empty input', () => {
    expect(suggest('', history, commands)).toEqual([])
  })

  it('suggests past URLs (matching without scheme or www) and queries', () => {
    expect(suggest('git', history, commands)).toEqual([
      {
        kind: 'url',
        text: 'https://www.github.com/jk09',
        label: 'github.com/jk09',
        detail: 'https://www.github.com/jk09',
      },
    ])
    expect(suggest('news', history, commands).map((s) => s.kind)).toEqual(['url', 'query'])
  })

  it('ranks prefix matches before substring matches', () => {
    expect(suggest('sum', history, commands)[0]!.text).toBe('summarize the news')
    expect(suggest('the news', history, commands)[0]!.text).toBe('summarize the news')
  })

  it('suggests commands and skills after /, with their argument signature', () => {
    const results = suggest('/', history, commands)
    expect(results.map((s) => s.label)).toEqual([
      '/new',
      '/model <model>',
      '/team <name>',
      '/reload',
    ])
    expect(suggest('/re', history, commands)).toEqual([
      { kind: 'command', text: '/reload', label: '/reload', detail: 'Reload the page' },
    ])
    // Commands with arguments leave the cursor after a space.
    expect(suggest('/te', history, commands)[0]!.text).toBe('/team ')
  })

  it('suggests options and past arguments after a command name', () => {
    expect(suggest('/model ', history, commands).map((s) => s.text)).toEqual([
      '/model claude-opus-5-5',
      '/model claude-haiku-4-5',
    ])
    expect(suggest('/model claude-h', history, commands).map((s) => s.text)).toEqual([
      '/model claude-haiku-4-5',
    ])
    expect(suggest('/team b', history, commands).map((s) => s.text)).toEqual(['/team beta squad'])
    expect(suggest('/unknown x', history, commands)).toEqual([])
  })

  it('returns at most the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      kind: 'query' as const,
      text: `q${i}`,
      at,
    }))
    expect(suggest('q', many, commands)).toHaveLength(SUGGESTION_LIMIT)
  })
})
