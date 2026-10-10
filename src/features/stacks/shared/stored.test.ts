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

  it('reads the import time of imported stacks and rejects a wrong one', () => {
    expect(
      parseStoredStacks({ current: null, stacks: [stack({ imported: 1700000000000 })] }).stacks[0]!
        .imported,
    ).toBe(1700000000000)
    expect(parseStoredStacks({ current: null, stacks: [stack()] }).stacks[0]).not.toHaveProperty(
      'imported',
    )
    expect(() =>
      parseStoredStacks({ current: null, stacks: [stack({ imported: 'soon' })] }),
    ).toThrow(TypeError)
  })

  it('keeps the home page of version 2 files, null included', () => {
    const home = (value: unknown) =>
      parseStoredStacks({ version: 2, current: null, stacks: [], home: value }).home
    expect(home(null)).toBeNull()
    expect(home('https://a.example/')).toBe('https://a.example/')
    expect(home('file:///etc')).toBeNull()
  })

  it('defaults the home page to bing.com in older files without a web URL', () => {
    // Older versions saved null when no home page was set.
    expect(parseStoredStacks({ current: null, stacks: [] }).home).toBe('https://www.bing.com/')
    expect(parseStoredStacks({ current: null, stacks: [], home: null }).home).toBe(
      'https://www.bing.com/',
    )
    expect(parseStoredStacks({ current: null, stacks: [], home: 'https://a.example/' }).home).toBe(
      'https://a.example/',
    )
  })
})
