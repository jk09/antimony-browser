import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A fresh user data directory without a home page, so the tests never reach the default one
 * (bing.com) and start without a stack. The welcome page counts as seen unless `welcome` is set,
 * so it doesn't cover the page area in tests about something else.
 */
export function newProfile({ welcome = false }: { welcome?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'antimony-e2e-'))
  writeFileSync(
    join(dir, 'stacks.json'),
    JSON.stringify({ version: 2, current: null, stacks: [], home: null }),
  )
  if (!welcome) writeFileSync(join(dir, 'welcome.json'), JSON.stringify({ done: true }))
  return dir
}
