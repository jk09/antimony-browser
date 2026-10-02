import { describe, expect, it } from 'vitest'
import { parseStoredStacks } from './stored'

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

  it('defaults the home page to bing.com only in files without one', () => {
    expect(parseStoredStacks({ current: null, stacks: [] }).home).toBe('https://www.bing.com/')
    expect(parseStoredStacks({ current: null, stacks: [], home: null }).home).toBeNull()
    expect(parseStoredStacks({ current: null, stacks: [], home: 'https://a.example/' }).home).toBe(
      'https://a.example/',
    )
    expect(parseStoredStacks({ current: null, stacks: [], home: 'file:///etc' }).home).toBeNull()
  })
})
