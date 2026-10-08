#!/usr/bin/env node
// SessionStart hook: installs npm dependencies and the Electron binary in Claude Code cloud
// sessions, so lint, typecheck, unit tests, `dev` and the e2e tests work from the first turn. Local
// sessions are left alone.
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
if (process.env.CLAUDE_CODE_REMOTE !== 'true') process.exit(0)

const marker = join(root, 'node_modules/.package-lock.json')
const lock = join(root, 'package-lock.json')
const electronInstalled = () => existsSync(join(root, 'node_modules/electron/dist'))
const depsCurrent = existsSync(marker) && statSync(marker).mtimeMs >= statSync(lock).mtimeMs
if (depsCurrent && electronInstalled()) process.exit(0)

const run = (command, args, env = {}) =>
  execFileSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  })

if (!depsCurrent) {
  try {
    // Without the binary: it is fetched separately below, so a blocked download can't fail the install.
    run('npm', ['ci', '--no-audit', '--no-fund'], { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' })
    console.log('Installed npm dependencies (npm ci).')
  } catch {
    console.log('npm ci failed; run it manually before lint, typecheck or tests.')
    process.exit(0)
  }
}

if (!electronInstalled()) {
  try {
    run('node', ['node_modules/electron/install.js'], { ELECTRON_SKIP_BINARY_DOWNLOAD: '' })
    console.log('Installed the Electron binary: `dev` and `test:e2e` (xvfb-run -a) can run.')
  } catch {
    console.log('The Electron binary could not be downloaded; e2e tests run in CI only.')
  }
}
