import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

// Entry points live in src/app/<process>/ (composition roots); features are imported from there.
export default defineConfig({
  main: {
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
    root: resolve('src/app/renderer'),
    build: {
      rollupOptions: { input: { index: resolve('src/app/renderer/index.html') } },
    },
    plugins: [react()],
  },
})
