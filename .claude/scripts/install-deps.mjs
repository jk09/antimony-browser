#!/usr/bin/env node
// SessionStart hook: installs npm dependencies in Claude Code cloud sessions, so lint, typecheck
// and unit tests work from the first turn. Local sessions are left alone.
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
if (process.env.CLAUDE_CODE_REMOTE !== 'true') process.exit(0)

const marker = join(root, 'node_modules/.package-lock.json')
const lock = join(root, 'package-lock.json')
if (existsSync(marker) && statSync(marker).mtimeMs >= statSync(lock).mtimeMs) process.exit(0)

try {
  // The Electron binary download is usually blocked in cloud sessions; e2e tests run in CI.
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: root,
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  console.log('Installed npm dependencies (npm ci, without the Electron binary).')
} catch {
  console.log('npm ci failed; run it manually before lint, typecheck or tests.')
}
