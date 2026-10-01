import { describe, expect, it } from 'vitest'
import { parseDecision, parseRunInput } from './validate'

describe('parseRunInput', () => {
  it('accepts text with image and text attachments', () => {
    const input = {
      text: 'hi',
      attachments: [
        { kind: 'image', name: 'a.png', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
        { kind: 'text', name: 'Pasted text', text: 'long' },
      ],
    }
    expect(parseRunInput(input)).toEqual(input)
  })

  it('rejects malformed prompts and attachments', () => {
    const image = (patch: object) => ({
      text: 'x',
      attachments: [{ kind: 'image', name: 'a', mediaType: 'image/png', data: 'AAAA', ...patch }],
    })
    for (const bad of [
      null,
      { text: 1, attachments: [] },
      { text: '', attachments: [] },
      { text: 'x', attachments: 'no' },
      { text: 'x', attachments: Array(6).fill({ kind: 'text', name: 't', text: 'x' }) },
      image({ mediaType: 'image/svg+xml' }),
      image({ data: 'not base64!' }),
      image({ data: 'A'.repeat(8 * 1024 * 1024) }),
      { text: 'x', attachments: [{ kind: 'file', name: 'x' }] },
    ]) {
      expect(() => parseRunInput(bad), JSON.stringify(bad)?.slice(0, 80)).toThrow(TypeError)
    }
  })
})

describe('parseDecision', () => {
  it('accepts only the three decisions', () => {
    expect(parseDecision('allow-run')).toBe('allow-run')
    expect(() => parseDecision('yes')).toThrow()
  })
})
