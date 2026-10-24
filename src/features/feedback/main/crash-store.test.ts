import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CrashReport } from '../shared/report'
import { createCrashStore } from './crash-store'

const report = (reason: string): CrashReport => ({ at: 't', process: 'page', reason })

describe('createCrashStore', () => {
  it('adds reports at once, keeps the newest five and clears', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'antimony-crash-')), 'sub', 'crash-reports.json')
    const store = createCrashStore(file)
    expect(store.get()).toEqual([])
    for (const n of [1, 2, 3, 4, 5, 6]) store.add(report(`r${n}`))
    // A new store (the next run) reads them back.
    expect(
      createCrashStore(file)
        .get()
        .map((r) => r.reason),
    ).toEqual(['r2', 'r3', 'r4', 'r5', 'r6'])
    store.clear()
    expect(store.get()).toEqual([])
  })

  it('reads a corrupt file as empty', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'antimony-crash-')), 'crash-reports.json')
    writeFileSync(file, '{not json')
    const store = createCrashStore(file)
    expect(store.get()).toEqual([])
    store.add(report('r'))
    expect(store.get()).toEqual([report('r')])
  })
})
