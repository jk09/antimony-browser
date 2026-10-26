import { describe, expect, it, vi } from 'vitest'
import { mapLimit, prefetchHtml, type Fetcher } from './prefetch'

const options = () => ({ timeoutMs: 1000, maxBytes: 10, signal: new AbortController().signal })
const html = (body: string, headers: Record<string, string> = {}, init: ResponseInit = {}) =>
  new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    ...init,
  })

describe('prefetchHtml', () => {
  it('GETs without credentials and reads at most maxBytes of HTML', async () => {
    const fetcher = vi.fn<Fetcher>(async () => html('<p>0123456789abcdef</p>'))
    expect(await prefetchHtml(fetcher, 'https://a.example/', options())).toBe('<p>0123456')
    expect(fetcher).toHaveBeenCalledWith(
      'https://a.example/',
      expect.objectContaining({ method: 'GET', credentials: 'omit' }),
    )
  })

  it('returns null for errors, non-HTML responses and failed requests', async () => {
    const answer = (response: Response | Error) =>
      prefetchHtml(
        async () => {
          if (response instanceof Error) throw response
          return response
        },
        'https://a.example/',
        options(),
      )
    expect(await answer(html('gone', {}, { status: 404 }))).toBeNull()
    expect(await answer(html('%PDF', { 'content-type': 'application/pdf' }))).toBeNull()
    expect(await answer(new Error('net::ERR_NAME_NOT_RESOLVED'))).toBeNull()
  })

  it('decodes the charset the server names', async () => {
    const body = new Uint8Array([0x63, 0x61, 0x66, 0xe9])
    const fetcher: Fetcher = async () =>
      new Response(body, { headers: { 'content-type': 'text/html; charset=iso-8859-1' } })
    expect(await prefetchHtml(fetcher, 'https://a.example/', options())).toBe('café')
  })
})

describe('mapLimit', () => {
  it('runs at most `limit` tasks at once and keeps the order', async () => {
    let running = 0
    let peak = 0
    const results = await mapLimit([1, 2, 3, 4, 5, 6], 4, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5 - (n % 3)))
      running--
      return n * 2
    })
    expect(results).toEqual([2, 4, 6, 8, 10, 12])
    expect(peak).toBe(4)
  })
})
