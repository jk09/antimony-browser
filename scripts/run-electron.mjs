#!/usr/bin/env node
/**
 * Runs `electron-vite` with a clean environment.
 *
 * VS Code's integrated terminal sets ELECTRON_RUN_AS_NODE=1 for its own
 * tooling. Electron honors that variable globally, so it makes the app
 * launch as a plain Node process instead of a real Electron app (failing
 * with "SyntaxError: The requested module 'electron' does not provide an
 * export named 'BrowserWindow'"). Strip it here so `npm run dev` / `npm
 * start` work regardless of the shell they're launched from.
 *
 * Usage: node scripts/run-electron.mjs <dev|preview>
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'preview') {
  console.error('Usage: node scripts/run-electron.mjs <dev|preview>')
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const bin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite',
)

// `shell: true` is required on Windows to spawn a `.cmd` shim. `bin` and
// `mode` are both fixed, non-user-controlled values, so the shell-escaping
// caveat that applies to untrusted args doesn't apply here.
const child = spawn(bin, [mode], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
})

child.on('exit', (code) => process.exit(code ?? 0))
