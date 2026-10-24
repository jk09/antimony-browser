#!/usr/bin/env node
/**
 * Renders the app icons' SVG sources to the files Electron and packagers load:
 * - antimony-{light,dark}.png, 512 px, for the running app (nativeImage can't read SVG);
 * - antimony.ico (Windows) and antimony.icns (macOS) from the dark tile, for packaging.
 * Every size is rendered from the vector. Run after changing an SVG in resources/icons/:
 * node scripts/render-icons.mjs
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from '@playwright/test'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../resources/icons')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
// ICNS entry types and their pixel sizes (the @2x types repeat a size).
const ICNS_ENTRIES = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
]
// The SVG's tile spans 480 of its 512 units; Apple's icon grid puts the tile at 824 of 1024 px.
const MAC_SCALE = 824 / 1024 / (480 / 512)

/** ICO: header, one 16-byte directory entry per image, then the PNGs (Windows Vista and later). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, entry) // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4) // colour planes
    header.writeUInt16LE(32, entry + 6) // bits per pixel
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...pngs.map(({ png }) => png)])
}

/** ICNS: 'icns' + total length, then per entry its type + length (8 bytes included) + PNG. */
function icns(entries) {
  const chunks = entries.map(({ type, png }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'latin1')
    head.writeUInt32BE(png.length + 8, 4)
    return Buffer.concat([head, png])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'latin1')
  head.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  /** The SVG rendered at `size` px, its tile scaled by `scale` around the centre. */
  const render = async (svg, size, scale = 1) => {
    await page.setViewportSize({ width: size, height: size })
    const inner = size * scale
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}` +
        `main{width:${size}px;height:${size}px;display:grid;place-items:center}` +
        `svg{width:${inner}px;height:${inner}px}</style><main>${svg}</main>`,
    )
    return page.locator('main').screenshot({ omitBackground: true })
  }
  const source = async (theme) => readFile(path.join(dir, `antimony-${theme}.svg`), 'utf8')

  for (const theme of ['light', 'dark']) {
    await writeFile(path.join(dir, `antimony-${theme}.png`), await render(await source(theme), 512))
  }

  const dark = await source('dark')
  const icoImages = []
  for (const size of ICO_SIZES) icoImages.push({ size, png: await render(dark, size) })
  await writeFile(path.join(dir, 'antimony.ico'), ico(icoImages))

  const icnsImages = []
  for (const [type, size] of ICNS_ENTRIES) {
    icnsImages.push({ type, png: await render(dark, size, MAC_SCALE) })
  }
  await writeFile(path.join(dir, 'antimony.icns'), icns(icnsImages))
} finally {
  await browser.close()
}
