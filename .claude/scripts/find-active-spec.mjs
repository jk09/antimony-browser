// Finds the first spec in docs/specs/ whose Status is Active. Shared by the hook scripts.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Metadata row "| **Status** | Active |" from feature-spec-template.md (or a legacy "status: active" line)
const activePattern = /^(\|\s*\*\*Status\*\*\s*\|\s*Active\b|status:\s*active\s*$)/im

/** Returns { path, content } for the active spec (path relative to root, `/`-separated), or null. */
export function findActiveSpec(root) {
  let names
  try {
    names = readdirSync(join(root, 'docs/specs'))
  } catch {
    return null
  }
  for (const name of names
    .filter((n) => n.endsWith('.md') && n !== 'feature-spec-template.md')
    .sort()) {
    const content = readFileSync(join(root, 'docs/specs', name), 'utf8')
    if (activePattern.test(content)) return { path: `docs/specs/${name}`, content }
  }
  return null
}
