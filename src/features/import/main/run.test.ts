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
  'https://a.example/,A,2026-10-09T08:00:00Z',
  'https://b.example/,B,2026-10-09T08:10:00Z',
  'https://c.example/,C,2026-10-09T15:00:00Z',
  'edge://history,H,2026-10-09T15:01:00Z',
].join('\n')

function ports(): ImportPorts & {
  visits: ReturnType<typeof vi.fn>
  stacks: ReturnType<typeof vi.fn>
} {
  const visits = vi.fn((rows: unknown[]) => ({
    visitsImported: rows.length,
    pagesCreated: rows.length - 1,
    pagesUpdated: 1,
    duplicates: 0,
    invalid: 0,
  }))
  const stacks = vi.fn((sessions: unknown[]) => ({ created: sessions.length, skipped: 0 }))
  return { importVisits: visits, importStacks: stacks, visits, stacks }
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
  it('writes history and one stack per multi-page session', async () => {
    const p = ports()
    const result = await runImport(file('ok.csv', csv), p, NOW)
    expect(p.visits).toHaveBeenCalledTimes(1)
    expect(p.visits.mock.calls[0]![0]).toHaveLength(3)
    const sessions = p.stacks.mock.calls[0]![0] as { pages: { url: string }[] }[]
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.pages.map((page) => page.url)).toEqual([
      'https://a.example/',
      'https://b.example/',
    ])
    expect(result).toEqual({
      rows: 4,
      visitsImported: 3,
      pagesCreated: 2,
      pagesUpdated: 1,
      duplicates: 0,
      skipped: { invalid: 0, unsupported: 1 },
      stacksCreated: 1,
      stacksSkipped: 0,
    })
    expect(describeResult(result)).toBe(
      'Imported 3 visits (2 new pages) into history and 1 stack; skipped 1 row.',
    )
  })

  it('writes nothing for a file it cannot use', async () => {
    const p = ports()
    await expect(runImport(file('pw.csv', 'name,password\na,b\n'), p, NOW)).rejects.toThrow(
      "doesn't look like",
    )
    await expect(runImport(join(dir, 'missing.csv'), p, NOW)).rejects.toThrow("doesn't exist")
    await expect(runImport(dir + '/x.csv/', p, NOW)).rejects.toThrow()
    expect(p.visits).not.toHaveBeenCalled()
    expect(p.stacks).not.toHaveBeenCalled()
  })
})
