import { describe, expect, it } from 'vitest'
import { decodeEntities, extractPage } from './extract'

describe('extractPage', () => {
  it('reads the title, the description and the visible text without scripts, styles or tags', () => {
    const html = `<!doctype html><html><head>
      <title>Write-ahead &amp; logging</title>
      <meta name="description" content="How WAL &quot;works&quot;">
      <style>p { color: red }</style>
      </head><body>
      <nav><a href="/">Home</a></nav>
      <script>var secret = 'not text'</script>
      <!-- a comment -->
      <h1>WAL</h1><p>Readers do <b>not</b> block&nbsp;writers.</p>
      <footer>© 2026</footer>
      </body></html>`
    expect(extractPage(html, 1500)).toEqual({
      title: 'Write-ahead & logging',
      description: 'How WAL "works"',
      text: 'WAL Readers do not block writers.',
    })
  })

  it('falls back to OpenGraph fields and clips the text', () => {
    const html = `<meta property="og:title" content="OG title"><meta content='OG text' property='og:description'><p>${'x'.repeat(2000)}</p>`
    const page = extractPage(html, 1500)
    expect(page.title).toBe('OG title')
    expect(page.description).toBe('OG text')
    expect(page.text).toHaveLength(1500)
  })

  it('decodes numeric entities and keeps unknown ones', () => {
    expect(decodeEntities('&#233;t&#xE9; &bogus; &#0;')).toBe('été &bogus; &#0;')
  })
})
