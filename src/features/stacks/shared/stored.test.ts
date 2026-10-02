import { describe, expect, it } from 'vitest'
import { parseStacksSettings, parseStoredStacks } from './stored'

const stack = (extra: object = {}) => ({
  id: 's',
  name: null,
  nodes: {
    1: {
      id: 1,
      url: 'https://a.example/',
      title: 'A',
      parentId: null,
      children: [],
      lastVisitedAt: 1,
    },
  },
  rootId: 1,
  activeId: 1,
  nextNodeId: 2,
  lastUsedAt: 1,
  ...extra,
})

describe('stored stacks', () => {
  it('reads stacks with and without startRoot', () => {
    expect(parseStoredStacks({ current: 's', stacks: [stack()] }).stacks[0]).not.toHaveProperty(
      'startRoot',
    )
    expect(
      parseStoredStacks({ current: 's', stacks: [stack({ startRoot: true })] }).stacks[0]!
        .startRoot,
    ).toBe(true)
    expect(() =>
      parseStoredStacks({ current: 's', stacks: [stack({ startRoot: 'yes' })] }),
    ).toThrow(TypeError)
  })

  it('accepts an http(s) new-stack page or null, nothing else', () => {
    expect(parseStacksSettings({ newStackPage: 'https://example.com/' })).toEqual({
      newStackPage: 'https://example.com/',
    })
    expect(parseStacksSettings({ newStackPage: null })).toEqual({ newStackPage: null })
    for (const bad of [
      null,
      'https://x',
      {},
      { newStackPage: 'javascript:alert(1)' },
      { newStackPage: 'file:///etc/passwd' },
      { newStackPage: 'https://' },
      { newStackPage: 42 },
    ]) {
      expect(() => parseStacksSettings(bad)).toThrow(TypeError)
    }
  })
})
