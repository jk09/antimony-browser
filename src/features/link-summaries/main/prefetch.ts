// Fetching linked pages without the user's cookies (an in-memory session of its own).

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

export interface PrefetchOptions {
  timeoutMs: number
  maxBytes: number
  signal: AbortSignal
}

/** The HTML of `url` (GET, no credentials), or null for errors, non-HTML and non-web redirects. */
export async function prefetchHtml(
  fetcher: Fetcher,
  url: string,
  { timeoutMs, maxBytes, signal }: PrefetchOptions,
): Promise<string | null> {
  try {
    const response = await fetcher(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      headers: { accept: 'text/html' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
    const finalUrl = response.url || url
    if (!/^https?:/i.test(finalUrl) || !response.ok || !response.body) {
      await response.body?.cancel()
      return null
    }
    const type = response.headers.get('content-type') ?? ''
    if (!/^\s*(text\/html|application\/xhtml\+xml)/i.test(type)) {
      await response.body.cancel()
      return null
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
    await reader.cancel()
    const bytes = new Uint8Array(Math.min(size, maxBytes))
    let offset = 0
    for (const chunk of chunks) {
      const part = chunk.subarray(0, bytes.length - offset)
      bytes.set(part, offset)
      offset += part.length
      if (offset >= bytes.length) break
    }
    const charset = /charset=["']?([\w-]+)/i.exec(type)?.[1] ?? 'utf-8'
    let decoder: TextDecoder
    try {
      decoder = new TextDecoder(charset)
    } catch {
      decoder = new TextDecoder('utf-8')
    }
    return decoder.decode(bytes)
  } catch {
    return null
  }
}

/** Runs `task` for every item, at most `limit` at a time, keeping the order of results. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
