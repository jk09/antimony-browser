import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

function gitShortHash(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

// Read by src/shared/build-info.ts.
const define = { __BUILD_COMMIT__: JSON.stringify(gitShortHash()) }

// Entry points live in src/app/<process>/ (composition roots); features are imported from there.
export default defineConfig({
  main: {
    define,
    build: {
      rollupOptions: { input: { index: resolve('src/app/main/index.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/app/preload/index.ts') },
        // Sandboxed preload scripts can't be ES modules.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    define,
    root: resolve('src/app/renderer'),
    build: {
      rollupOptions: { input: { index: resolve('src/app/renderer/index.html') } },
    },
    plugins: [react()],
  },
})
