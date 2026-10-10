import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { describeResult } from '../ipc'
import { resolveExportPath, runImport, type ImportPorts } from './run'

const dir = mkdtempSync(join(tmpdir(), 'antimony-import-'))
const NOW = Date.parse('2026-10-10T12:00:00Z')
const file = (name: string, content: string) => {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

const csv = [
  'url,title,visit time',
  'https://en.wikipedia.org/wiki/Sourdough,Sourdough,2026-09-01T08:00:00Z',
  'https://de.wikipedia.org/wiki/Brot,Brot,2026-09-03T08:10:00Z',
  'https://flour.example/types,Flour types,2026-09-05T15:00:00Z',
  'https://github.com/a/b,Repo,2026-09-06T15:00:00Z',
  'https://github.com/a/c,Another repo,2026-09-07T15:00:00Z',
  'edge://history,H,2026-09-08T15:01:00Z',
].join('\n')

type Group = { name: string; lastAt: number; pages: { url: string; title: string; at: number }[] }

function ports(complete?: ImportPorts['complete']) {
  const visits = vi.fn((rows: unknown[]) => ({
    visitsImported: rows.length,
    pagesCreated: rows.length - 1,
    pagesUpdated: 1,
    duplicates: 0,
    invalid: 0,
  }))
  const stacks = vi.fn((groups: Group[]) => ({ created: groups.length, skipped: 0 }))
  const all: ImportPorts = {
    importVisits: visits,
    importStacks: stacks,
    ...(complete && { complete }),
  }
  return { ports: all, visits, stacks }
}

describe('resolveExportPath', () => {
  it('expands ~/, strips quotes and requires a full .csv path', () => {
    expect(resolveExportPath('~/Downloads/e.csv', '/home/me')).toBe('/home/me/Downloads/e.csv')
    expect(resolveExportPath(' "/tmp/with space/e.CSV" ', '/home/me')).toBe('/tmp/with space/e.CSV')
    expect(() => resolveExportPath('', '/h')).toThrow('Give the path')
    expect(() => resolveExportPath('e.csv', '/h')).toThrow("isn't a full path")
    expect(() => resolveExportPath('/tmp/e.json', '/h')).toThrow('.csv')
  })
})

describe('runImport', () => {
  it('groups by address without a model: related pages share a stack, single pages stay in history', async () => {
    const { ports: p, visits, stacks } = ports()
    const result = await runImport(file('ok.csv', csv), p, NOW)
    expect(visits.mock.calls[0]![0]).toHaveLength(5)
    const groups = stacks.mock.calls[0]![0]
    expect(groups.map((g) => [g.name, g.pages.map((page) => page.url)])).toEqual([
      ['github', ['https://github.com/a/b', 'https://github.com/a/c']],
      [
        'wikipedia',
        ['https://en.wikipedia.org/wiki/Sourdough', 'https://de.wikipedia.org/wiki/Brot'],
      ],
    ])
    expect(groups[1]).toMatchObject({ lastAt: Date.parse('2026-09-03T08:10:00Z') })
    expect(result).toEqual({
      rows: 6,
      visitsImported: 5,
      pagesCreated: 4,
      pagesUpdated: 1,
      duplicates: 0,
      skipped: { invalid: 0, unsupported: 1 },
      stacksCreated: 2,
      stacksSkipped: 0,
      grouping: 'addresses',
    })
    expect(describeResult(result)).toBe(
      'Imported 5 visits (4 new pages) into history and 2 stacks, grouped by address; skipped 1 row.',
    )
  })

  it('refines the grouping by topic with the model when it answers', async () => {
    const complete = vi.fn(async () => ({
      text: '{"stacks":[{"name":"bread","groups":["g2"],"pages":["p1"]}]}',
    }))
    const { ports: p, stacks } = ports(complete)
    const result = await runImport(file('topics.csv', csv), p, NOW)
    expect(complete).toHaveBeenCalledTimes(1)
    const request = (complete.mock.calls[0] as unknown as [{ text: string }])[0].text
    expect(request).toContain('flour.example/types')
    expect(request).not.toContain('2026-09')
    const groups = stacks.mock.calls[0]![0]
    expect(groups.map((g) => g.name)).toEqual(['bread', 'github'])
    expect(groups[0]!.pages.map((page) => page.title)).toEqual(['Sourdough', 'Brot', 'Flour types'])
    expect(result.grouping).toBe('topics')
    expect(describeResult(result)).toContain('grouped by topic')
  })

  it('falls back to the addresses, and says so, when the model fails or answers nonsense', async () => {
    for (const complete of [
      async () => Promise.reject(new Error('The assistant is not available.')),
      async () => ({ text: 'I cannot do that' }),
    ]) {
      const { ports: p, stacks } = ports(complete)
      const result = await runImport(file('fallback.csv', csv), p, NOW)
      expect(stacks.mock.calls[0]![0].map((g) => g.name)).toEqual(['github', 'wikipedia'])
      expect(result).toMatchObject({ grouping: 'addresses', stacksCreated: 2 })
      expect(result.topicsError).toBeTruthy()
      expect(describeResult(result)).toContain(
        "grouped by address (the assistant wasn't available)",
      )
    }
  })

  it('stops, writing nothing, when the run is stopped while the model works', async () => {
    const controller = new AbortController()
    const complete = vi.fn(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    const { ports: p, visits } = ports(complete)
    await expect(runImport(file('stop.csv', csv), p, NOW, controller.signal)).rejects.toThrow(
      'aborted',
    )
    expect(visits).not.toHaveBeenCalled()
  })

  it('writes nothing for a file it cannot use', async () => {
    const { ports: p, visits, stacks } = ports()
    await expect(runImport(file('pw.csv', 'name,password\na,b\n'), p, NOW)).rejects.toThrow(
      "doesn't look like",
    )
    await expect(runImport(join(dir, 'missing.csv'), p, NOW)).rejects.toThrow("doesn't exist")
    await expect(runImport(dir + '/x.csv/', p, NOW)).rejects.toThrow()
    expect(visits).not.toHaveBeenCalled()
    expect(stacks).not.toHaveBeenCalled()
  })
})
