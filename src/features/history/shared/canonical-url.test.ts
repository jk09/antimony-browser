import { describe, expect, it } from 'vitest'
import {
  adoptCanonicalLink,
  bareInput,
  bareUrl,
  canonicalUrl,
  domainOf,
  hostOf,
  MAX_URL_LENGTH,
} from './canonical-url'

describe('canonicalUrl', () => {
  it.each([
    ['HTTPS://Example.COM', 'https://example.com/'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['http://example.com:80/a', 'http://example.com/a'],
    ['http://example.com:8080/a', 'http://example.com:8080/a'],
    ['https://user:secret@example.com/a', 'https://example.com/a'],
    ['https://bücher.example/a', 'https://xn--bcher-kva.example/a'],
    ['https://example.com/Path/', 'https://example.com/Path/'],
    ['https://example.com/path', 'https://example.com/path'],
  ])('normalises scheme, host, port and credentials: %s', (input, expected) => {
    expect(canonicalUrl(input)).toBe(expected)
  })

  it('drops tracking parameters and sorts the rest, keeping repeated ones in order', () => {
    expect(
      canonicalUrl(
        'https://example.com/a?utm_source=x&b=2&UTM_Medium=y&fbclid=z&a=1&gclid=q&a=0&msclkid=m',
      ),
    ).toBe('https://example.com/a?a=1&a=0&b=2')
    expect(canonicalUrl('https://example.com/a?utm_source=x')).toBe('https://example.com/a')
    expect(canonicalUrl('https://example.com/a?')).toBe('https://example.com/a')
  })

  it('drops site-specific tracking parameters only on those sites', () => {
    expect(canonicalUrl('https://www.youtube.com/watch?v=abc&si=xyz')).toBe(
      'https://www.youtube.com/watch?v=abc',
    )
    expect(canonicalUrl('https://example.com/search?si=1')).toBe('https://example.com/search?si=1')
    expect(canonicalUrl('https://x.com/user/status/1?s=20&t=abc')).toBe(
      'https://x.com/user/status/1',
    )
    expect(canonicalUrl('https://example.com/?s=query')).toBe('https://example.com/?s=query')
  })

  it('drops anchors but keeps hash routes', () => {
    expect(canonicalUrl('https://example.com/docs#section-2')).toBe('https://example.com/docs')
    expect(canonicalUrl('https://example.com/#/inbox/42')).toBe('https://example.com/#/inbox/42')
    expect(canonicalUrl('https://example.com/#!/inbox')).toBe('https://example.com/#!/inbox')
    expect(canonicalUrl('https://example.com/#!inbox')).toBe('https://example.com/#!inbox')
  })

  it('rejects what history should not store', () => {
    for (const input of [
      'about:blank',
      'file:///etc/passwd',
      'data:text/html,hi',
      'javascript:alert(1)',
      'chrome://settings',
      'not a url',
      '',
      `https://example.com/?q=${'x'.repeat(MAX_URL_LENGTH)}`,
    ]) {
      expect(canonicalUrl(input), input).toBeNull()
    }
  })

  it('is idempotent', () => {
    for (const input of [
      'https://Example.com/a?b=2&a=1#x',
      'https://example.com/#/route?x=1',
      'https://bücher.example/ä?ö=ü',
    ]) {
      const once = canonicalUrl(input)!
      expect(canonicalUrl(once)).toBe(once)
    }
  })
})

describe('keys for prefix matching', () => {
  it('strips scheme and www', () => {
    expect(bareUrl('https://www.example.com/a?b=1')).toBe('example.com/a?b=1')
    expect(bareUrl('http://example.com/')).toBe('example.com/')
    expect(bareInput('  HTTPS://www.Example.com/a')).toBe('Example.com/a')
    expect(hostOf('https://www.example.com/a')).toBe('example.com')
  })

  it.each([
    ['en.wikipedia.org', 'wikipedia.org'],
    ['example.com', 'example.com'],
    ['news.bbc.co.uk', 'bbc.co.uk'],
    ['a.b.example.de', 'example.de'],
    ['127.0.0.1', '127.0.0.1'],
    ['localhost', 'localhost'],
    ['[::1]', '[::1]'],
  ])('domainOf(%s) is %s', (host, domain) => {
    expect(domainOf(host)).toBe(domain)
  })
})

describe('adoptCanonicalLink', () => {
  const page = 'https://example.com/article?id=7&session=abc'

  it('adopts a same-page link that only differs in the query', () => {
    expect(adoptCanonicalLink(page, 'https://example.com/article?id=7')).toBe(
      'https://example.com/article?id=7',
    )
    expect(adoptCanonicalLink(page, '/article?id=7')).toBe('https://example.com/article?id=7')
  })

  it('ignores links to another path, origin or scheme, and no-ops', () => {
    expect(adoptCanonicalLink(page, 'https://example.com/')).toBeNull()
    expect(adoptCanonicalLink(page, 'https://example.com/other?id=7')).toBeNull()
    expect(adoptCanonicalLink(page, 'https://evil.example/article?id=7')).toBeNull()
    expect(adoptCanonicalLink(page, 'http://example.com/article?id=7')).toBeNull()
    expect(adoptCanonicalLink(page, null)).toBeNull()
    expect(adoptCanonicalLink(page, '')).toBeNull()
    expect(adoptCanonicalLink('https://example.com/a', 'https://example.com/a#top')).toBeNull()
  })
})
