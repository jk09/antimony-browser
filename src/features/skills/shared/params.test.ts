import { describe, expect, it } from 'vitest'
import type { SkillStep } from '../ipc'
import { argumentHint, bindArgs, extractParams, fillParams, parseArgs, signature } from './params'

const steps: SkillStep[] = [
  { tool: 'navigate', input: { url: 'https://dash.example/{{team}}' } },
  { tool: 'type_text', input: { selector: '#q', text: '{{ query }} in {{team}}', submit: true } },
]

describe('skill parameters', () => {
  it('finds parameters in order of first use', () => {
    expect(extractParams(steps)).toEqual(['team', 'query'])
    expect(
      signature({
        name: 'dash',
        params: [
          { name: 'team', hint: '' },
          { name: 'query', hint: 'search' },
        ],
      }),
    ).toBe('/dash <team> <query>')
  })

  it('hints the parameters still to type', () => {
    const params = [
      { name: 'team', hint: 'team name' },
      { name: 'query', hint: '' },
    ]
    expect(argumentHint(params, '')).toBe(' <team: team name> <query>')
    expect(argumentHint(params, ' ')).toBe('<team: team name> <query>')
    expect(argumentHint(params, ' alpha')).toBe(' <query>')
    expect(argumentHint(params, ' alpha ')).toBe('<query>')
    expect(argumentHint(params, ' alpha open bugs')).toBe('')
    expect(argumentHint(params, ' "two words" ')).toBe('<query>')
    expect(argumentHint([], '')).toBe('')
    // Still typing the command name.
    expect(argumentHint(params, 'x')).toBe('')
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
    const params = [
      { name: 'team', hint: '' },
      { name: 'query', hint: '' },
    ]
    expect(bindArgs(params, 'alpha open bugs now')).toEqual({
      values: { team: 'alpha', query: 'open bugs now' },
    })
    expect(bindArgs(params, 'alpha')).toEqual({ error: 'Missing <query>' })
    expect(bindArgs([], '')).toEqual({ values: {} })
    expect(bindArgs([], 'x')).toEqual({ error: 'This macro takes no arguments' })
  })

  it('lets an optional parameter be left out, and shows it in brackets', () => {
    const params = [{ name: 'file', hint: 'path to the file', optional: true }]
    expect(bindArgs(params, '')).toEqual({ values: { file: '' } })
    expect(bindArgs(params, '~/my file.csv')).toEqual({ values: { file: '~/my file.csv' } })
    expect(signature({ name: 'import-edge', params })).toBe('/import-edge [file]')
    expect(argumentHint(params, '')).toBe(' [file: path to the file]')
    expect(argumentHint(params, ' x')).toBe('')
    const mixed = [{ name: 'a', hint: '' }, ...params]
    expect(bindArgs(mixed, '')).toEqual({ error: 'Missing <a>' })
    expect(bindArgs(mixed, 'x')).toEqual({ values: { a: 'x', file: '' } })
  })
})
