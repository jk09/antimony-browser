#!/usr/bin/env node
/**
 * Renders the app icons' SVG sources to the PNGs Electron loads (nativeImage can't read SVG).
 * Run after changing an SVG in resources/icons/: node scripts/render-icons.mjs
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from '@playwright/test'

const SIZE = 512
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../resources/icons')

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } })
  for (const theme of ['light', 'dark']) {
    const svg = await readFile(path.join(dir, `antimony-${theme}.svg`), 'utf8')
    await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`)
    await page.locator('svg').screenshot({
      path: path.join(dir, `antimony-${theme}.png`),
      omitBackground: true,
    })
  }
} finally {
  await browser.close()
}
