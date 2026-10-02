import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A fresh user data directory without a home page, so the tests never reach the default one
 * (bing.com) and start without a stack.
 */
export function newProfile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'antimony-e2e-'))
  writeFileSync(join(dir, 'stacks.json'), JSON.stringify({ current: null, stacks: [], home: null }))
  return dir
}
