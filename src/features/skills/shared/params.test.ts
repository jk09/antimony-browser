import { describe, expect, it } from 'vitest'
import type { SkillStep } from '../ipc'
import { bindArgs, extractParams, fillParams, parseArgs, signature } from './params'

const steps: SkillStep[] = [
  { tool: 'navigate', input: { url: 'https://dash.example/{{team}}' } },
  { tool: 'type_text', input: { selector: '#q', text: '{{ query }} in {{team}}', submit: true } },
]

describe('skill parameters', () => {
  it('finds parameters in order of first use', () => {
    expect(extractParams(steps)).toEqual(['team', 'query'])
    expect(signature({ name: 'dash', params: ['team', 'query'] })).toBe('/dash <team> <query>')
  })

  it('fills parameters into string inputs only', () => {
    expect(fillParams(steps, { team: 'alpha', query: 'open bugs' })).toEqual([
      { tool: 'navigate', input: { url: 'https://dash.example/alpha' } },
      { tool: 'type_text', input: { selector: '#q', text: 'open bugs in alpha', submit: true } },
    ])
  })

  it('splits arguments with quotes', () => {
    expect(parseArgs(`a "b c" 'd e' f`)).toEqual(['a', 'b c', 'd e', 'f'])
    expect(parseArgs('   ')).toEqual([])
  })

  it('gives the last parameter the rest of the line', () => {
    expect(bindArgs(['team', 'query'], 'alpha open bugs now')).toEqual({
      values: { team: 'alpha', query: 'open bugs now' },
    })
    expect(bindArgs(['team', 'query'], 'alpha')).toEqual({ error: 'Missing <query>' })
    expect(bindArgs([], '')).toEqual({ values: {} })
    expect(bindArgs([], 'x')).toEqual({ error: 'This skill takes no arguments' })
  })
})
