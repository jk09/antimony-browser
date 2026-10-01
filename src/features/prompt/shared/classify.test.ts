import { describe, expect, it } from 'vitest'
import { toUrl } from '../../navigation/shared/to-url'
import { classify } from './classify'

const plain = { hasAttachments: false, toUrl }

describe('classify', () => {
  it('routes URL-like input to navigation', () => {
    expect(classify(' example.com ', plain)).toEqual({ kind: 'url', url: 'https://example.com/' })
    expect(classify('localhost:3000/x', plain)).toEqual({
      kind: 'url',
      url: 'http://localhost:3000/x',
    })
  })

  it('routes /commands with their arguments', () => {
    expect(classify('/reload', plain)).toEqual({ kind: 'command', name: 'reload', args: '' })
    expect(classify('/Model  claude-opus-5-5 ', plain)).toEqual({
      kind: 'command',
      name: 'model',
      args: 'claude-opus-5-5',
    })
    expect(classify('/search cats and\ndogs', plain)).toEqual({
      kind: 'command',
      name: 'search',
      args: 'cats and\ndogs',
    })
    expect(classify('/usr/bin', plain)).toEqual({ kind: 'command', name: '', args: 'usr/bin' })
  })

  it('sends ?-prefixed input to the model, even when it looks like a URL', () => {
    expect(classify('? example.com', plain)).toEqual({ kind: 'query', text: 'example.com' })
  })

  it('sends everything else to the model', () => {
    expect(classify('what is on this page?', plain)).toEqual({
      kind: 'query',
      text: 'what is on this page?',
    })
    expect(classify('hello', plain)).toEqual({ kind: 'query', text: 'hello' })
    expect(classify('javascript:alert(1)', plain)).toEqual({
      kind: 'query',
      text: 'javascript:alert(1)',
    })
  })

  it('asks the model about attachments instead of navigating', () => {
    const withImage = { hasAttachments: true, toUrl }
    expect(classify('example.com', withImage)).toEqual({ kind: 'query', text: 'example.com' })
    expect(classify('', withImage)).toEqual({ kind: 'query', text: '' })
  })

  it('ignores empty input', () => {
    expect(classify('   ', plain)).toEqual({ kind: 'empty' })
  })
})
