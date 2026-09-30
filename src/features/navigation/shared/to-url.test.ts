import { describe, expect, it } from 'vitest'
import { isWebUrl, toUrl } from './to-url'

describe('toUrl', () => {
  it('keeps full http(s) URLs', () => {
    expect(toUrl('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d')
    expect(toUrl('  http://example.com  ')).toBe('http://example.com/')
    expect(toUrl('https://intranet')).toBe('https://intranet/')
  })

  it('adds https:// to bare hosts, with port and path', () => {
    expect(toUrl('example.com')).toBe('https://example.com/')
    expect(toUrl('www.example.com:8080/a/b')).toBe('https://www.example.com:8080/a/b')
  })

  it('adds http:// to localhost and IP addresses', () => {
    expect(toUrl('localhost')).toBe('http://localhost/')
    expect(toUrl('localhost:3000/app')).toBe('http://localhost:3000/app')
    expect(toUrl('192.168.1.1')).toBe('http://192.168.1.1/')
    expect(toUrl('[::1]:8080')).toBe('http://[::1]:8080/')
  })

  it('rejects empty input, whitespace and single words', () => {
    expect(toUrl('')).toBeNull()
    expect(toUrl('   ')).toBeNull()
    expect(toUrl('hello world')).toBeNull()
    expect(toUrl('example.com/a b')).toBeNull()
    expect(toUrl('antimony')).toBeNull()
  })

  it('rejects other schemes', () => {
    for (const input of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'mailto:someone@example.com',
      'about:blank',
      'data:text/html,hi',
      'ftp://example.com',
      'chrome://settings',
    ]) {
      expect(toUrl(input), input).toBeNull()
    }
  })

  it('returns URLs that parse to themselves', () => {
    const url = toUrl('example.com:8080/a')!
    expect(toUrl(url)).toBe(url)
  })
})

describe('isWebUrl', () => {
  it('accepts http and https only', () => {
    expect(isWebUrl('https://example.com/')).toBe(true)
    expect(isWebUrl('http://localhost:3000/')).toBe(true)
    expect(isWebUrl('file:///etc/passwd')).toBe(false)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isWebUrl('not a url')).toBe(false)
  })
})
