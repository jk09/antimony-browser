import { defineConfig } from '@playwright/test'

// Drives the built app (out/) through Playwright's Electron support. Run with `npm run test:e2e`.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { trace: 'retain-on-failure' },
})
