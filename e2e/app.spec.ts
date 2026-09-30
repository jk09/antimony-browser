import { _electron as electron, expect, test } from '@playwright/test'

// Chromium refuses to run as root with its sandbox on (e.g. in containers); CI runs as a normal user.
const args = ['.', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])]

test('opens the browser window with the chrome UI', async () => {
  const app = await electron.launch({ args })
  try {
    const window = await app.firstWindow()
    await expect(window).toHaveTitle(/^Antimony - ([0-9a-f]{7,}|unknown)$/)
    await expect(window.getByTestId('toolbar')).toBeVisible()
    await expect(window.getByTestId('content')).toContainText('Chromium')
  } finally {
    await app.close()
  }
})
