import { describe, expect, it } from 'vitest'
import { buildMap, parseKeywords, type MapRow } from './map'

const row = (
  id: number,
  domain: string,
  keywords: string | null,
  overrides: Partial<MapRow> = {},
) => ({
  id,
  url: `https://${domain}/${id}`,
  title: `Page ${id}`,
  domain,
  visitCount: 1,
  lastVisitAt: 1000 - id,
  keywords,
  ...overrides,
})

describe('parseKeywords', () => {
  it('lowercases, trims, deduplicates and caps the keywords', () => {
    expect(parseKeywords(' Lions, lions;SAVANNA ,,a')).toEqual(['lions', 'savanna'])
    expect(parseKeywords(null)).toEqual([])
    expect(parseKeywords(Array.from({ length: 30 }, (_, i) => `word${i}`).join(',')).length).toBe(
      12,
    )
  })
})

describe('buildMap', () => {
  it('groups pages of one domain and pages with keyword overlap ≥ 0.3, leaves the rest ungrouped', () => {
    const map = buildMap(
      [
        row(1, 'a.com', null),
        row(2, 'a.com', null),
        row(3, 'b.org', 'lions, savanna, africa'),
        row(4, 'c.net', 'lions, savanna, zoo'),
        row(5, 'd.io', 'sqlite'),
        row(6, 'e.io', 'cooking, pasta, recipes'),
        row(7, 'f.io', 'lions, cooking, travel, news, sport'),
      ],
      [],
    )
    const byId = new Map(map.nodes.map((node) => [node.id, node.group]))
    expect(byId.get(1)).toBe(byId.get(2))
    expect(byId.get(3)).toBe(byId.get(4))
    expect(byId.get(1)).not.toBe(byId.get(3))
    expect(byId.get(1)).not.toBeNull()
    // 7 shares one of seven keywords with 3 (Jaccard 1/7): not enough.
    expect([byId.get(5), byId.get(6), byId.get(7)]).toEqual([null, null, null])
    expect(map.groups).toHaveLength(2)
  })

  it('labels a group by its most common shared keyword, else by its domain', () => {
    const map = buildMap(
      [
        row(1, 'a.com', null),
        row(2, 'a.com', null),
        row(3, 'b.org', 'lions, savanna'),
        row(4, 'c.net', 'lions, zoo, savanna'),
      ],
      [],
    )
    expect(map.groups.map((group) => group.label).sort()).toEqual(['a.com', 'lions'])
  })

  it('draws link edges once per directed pair from followed links and ignores unknown pages', () => {
    const map = buildMap(
      [row(1, 'a.com', null), row(2, 'b.org', null), row(3, 'c.net', null)],
      [
        { from: 1, to: 2, count: 3 },
        { from: 1, to: 2, count: 1 },
        { from: 2, to: 1, count: 1 },
        { from: 2, to: 2, count: 1 },
        { from: 9, to: 1, count: 1 },
      ],
    )
    expect(map.edges).toEqual([
      { from: 1, to: 2, kind: 'link', weight: 3 },
      { from: 2, to: 1, kind: 'link', weight: 1 },
    ])
  })

  it('joins grouped pages sharing ≥ 2 keywords with a keyword edge unless a link joins them', () => {
    const rows = [
      row(1, 'a.com', 'lions, savanna, africa'),
      row(2, 'b.org', 'lions, savanna, zoo'),
      row(3, 'c.net', 'lions, savanna'),
      row(4, 'd.io', 'zoo, tickets'),
    ]
    const map = buildMap(rows, [{ from: 1, to: 3, count: 1 }])
    expect(map.edges.filter((edge) => edge.kind === 'keyword')).toEqual([
      { from: 1, to: 2, kind: 'keyword', weight: 2 },
      { from: 2, to: 3, kind: 'keyword', weight: 2 },
    ])
    expect(map.edges.filter((edge) => edge.kind === 'link')).toHaveLength(1)
  })

  it('reports the total beyond the pages given', () => {
    expect(buildMap([row(1, 'a.com', null)], [], 500).total).toBe(500)
    expect(buildMap([row(1, 'a.com', null)], []).total).toBe(1)
  })
})
