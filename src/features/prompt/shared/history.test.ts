import { describe, expect, it } from 'vitest'
import { addEntry, historyText } from './history'

describe('addEntry', () => {
  it('adds at the front, de-duplicates and caps', () => {
    let history = addEntry([], { kind: 'url', text: 'https://a.com/' }, 1)
    history = addEntry(history, { kind: 'query', text: 'hi' }, 2)
    history = addEntry(history, { kind: 'url', text: 'https://a.com/' }, 3)
    expect(history).toEqual([
      { kind: 'url', text: 'https://a.com/', at: 3 },
      { kind: 'query', text: 'hi', at: 2 },
    ])
    for (let i = 0; i < 10; i++) history = addEntry(history, { kind: 'query', text: `${i}` }, i, 5)
    expect(history).toHaveLength(5)
    expect(addEntry(history, { kind: 'query', text: '  ' }, 9, 5)).toBe(history)
  })
})

describe('historyText', () => {
  it('never keeps a key typed after /key', () => {
    expect(historyText('/key sk-ant-secret')).toBe('/key')
    expect(historyText('/key')).toBe('/key')
    expect(historyText(' /keyboard x ')).toBe('/keyboard x')
  })
})
