import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A fresh user data directory. New stacks open empty in it, so the tests never reach the
 * default new-stack page (bing.com) and start without a stack.
 */
export function newProfile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'antimony-e2e-'))
  writeFileSync(join(dir, 'stacks-settings.json'), JSON.stringify({ newStackPage: null }))
  return dir
}
