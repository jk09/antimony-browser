import { describe, expect, it } from 'vitest'
import { isChromeUiUrl } from './chrome-ui-url'

describe('isChromeUiUrl', () => {
  const packaged = 'file:///opt/antimony/resources/app/out/renderer/index.html'
  const dev = 'http://localhost:5173/'

  it('allows reloading the packaged chrome UI', () => {
    expect(isChromeUiUrl(`${packaged}#settings`, packaged)).toBe(true)
  })

  it('blocks other local files', () => {
    expect(isChromeUiUrl('file:///etc/passwd', packaged)).toBe(false)
  })

  it('allows the dev server origin only', () => {
    expect(isChromeUiUrl('http://localhost:5173/src/main.tsx', dev)).toBe(true)
    expect(isChromeUiUrl('http://localhost:5174/', dev)).toBe(false)
  })

  it('blocks web pages and malformed URLs', () => {
    expect(isChromeUiUrl('https://example.com/', packaged)).toBe(false)
    expect(isChromeUiUrl('not a url', packaged)).toBe(false)
  })
})
