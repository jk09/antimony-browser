import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Unit tests sit next to the code (*.test.ts / *.test.tsx). UI tests opt into a DOM with
// `// @vitest-environment jsdom`. End-to-end tests live in e2e/ and run with Playwright.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
  },
})
