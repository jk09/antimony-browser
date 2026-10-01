import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../ipc'
import {
  stackRefs,
  suggest,
  suggestStacks,
  SUGGESTION_LIMIT,
  withVisited,
  type SuggestCommand,
} from './suggest'

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
  {
    name: 'menu',
    usage: '<menu> <item>',
    description: 'Run a menu item',
    tree: [
      { name: 'file', label: 'File', children: [{ name: 'quit', label: 'Quit' }] },
      {
        name: 'view',
        label: 'View',
        children: [
          { name: 'zoom-in', label: 'Zoom In', detail: 'Ctrl+Plus' },
          { name: 'zoom-out', label: 'Zoom Out' },
          {
            name: 'more',
            label: 'More',
            children: [{ name: 'full-screen', label: 'Full Screen' }],
          },
        ],
      },
    ],
  },
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
      '/menu <menu> <item>',
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

  it('suggests nested arguments level by level', () => {
    const texts = (input: string) => suggest(input, history, commands).map((s) => s.text)
    expect(texts('/menu ')).toEqual(['/menu file ', '/menu view '])
    expect(texts('/menu vi')).toEqual(['/menu view '])
    expect(texts('/menu view ')).toEqual([
      '/menu view zoom-in',
      '/menu view zoom-out',
      '/menu view more ',
    ])
    expect(texts('/menu VIEW zoom')).toEqual(['/menu view zoom-in', '/menu view zoom-out'])
    expect(texts('/menu view out')).toEqual(['/menu view zoom-out'])
    expect(texts('/menu view more f')).toEqual(['/menu view more full-screen'])
    expect(texts('/menu view zoom-in')).toEqual([])
    expect(texts('/menu nope ')).toEqual([])
    expect(texts('/menu view zoom-in ')).toEqual([])

    const [zoomIn, , more] = suggest('/menu view ', history, commands)
    expect(zoomIn).toMatchObject({ kind: 'value', label: 'View › Zoom In', detail: 'Ctrl+Plus' })
    expect(more).toMatchObject({ label: 'View › More ›', detail: 'Menu' })
    expect(suggest('/menu view zoom-o', history, commands)[0]!.detail).toBe('Run a menu item')
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

describe('withVisited', () => {
  const visited = [
    { url: 'https://www.github.com/jk09', title: 'jk09 on GitHub' },
    { url: 'https://github.com/anthropics', title: 'Anthropic' },
    { url: 'https://gist.github.com/x', title: '' },
  ]

  it('puts visited pages after typed URLs and before questions, without duplicates', () => {
    const base = suggest('g', history, commands)
    expect(withVisited(base, visited, 'g').map((s) => [s.kind, s.label])).toEqual([
      ['url', 'github.com/jk09'],
      ['url', 'Anthropic'],
      ['url', 'gist.github.com/x'],
    ])
    const withQuestion = suggest('summ', history, commands)
    expect(
      withVisited(withQuestion, [{ url: 'https://summit.example/', title: 'Summit' }], 'summ').map(
        (s) => s.kind,
      ),
    ).toEqual(['url', 'query'])
  })

  it('shows the title as label and the address as detail', () => {
    expect(withVisited([], visited.slice(1, 2), 'git')).toEqual([
      {
        kind: 'url',
        text: 'https://github.com/anthropics',
        label: 'Anthropic',
        detail: 'github.com/anthropics',
      },
    ])
  })

  it('leaves commands and empty input alone, and keeps the limit', () => {
    const commandSuggestions = suggest('/re', history, commands)
    expect(withVisited(commandSuggestions, visited, '/re')).toBe(commandSuggestions)
    expect(withVisited([], visited, '  ')).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => ({
      url: `https://g${i}.example/`,
      title: '',
    }))
    expect(withVisited([], many, 'g')).toHaveLength(SUGGESTION_LIMIT)
  })
})

describe('suggestStacks', () => {
  const stacks = [
    { name: 'hacker-news', rootTitle: 'Hacker News' },
    { name: 'news-today', rootTitle: 'Today' },
    { name: '', rootTitle: 'Unnamed' },
  ]

  it('suggests stacks for the @word at the end, by name prefix first', () => {
    expect(suggestStacks('read @news', stacks).map((s) => s.text)).toEqual([
      'read @news-today ',
      'read @hacker-news ',
    ])
    expect(suggestStacks('@', stacks).map((s) => s.label)).toEqual(['@hacker-news', '@news-today'])
    expect(suggestStacks('@hacker-news', stacks)).toEqual([])
    expect(suggestStacks('mail@news', stacks)).toEqual([])
    expect(suggestStacks('/note @news', stacks)).toEqual([])
    expect(suggestStacks('@news and more', stacks)).toEqual([])
  })

  it('finds the known @names in a text once each', () => {
    expect(
      stackRefs('compare @news-today, @hacker-news and @news-today; @nope a@hacker-news', [
        'hacker-news',
        'news-today',
      ]),
    ).toEqual(['news-today', 'hacker-news'])
  })
})
