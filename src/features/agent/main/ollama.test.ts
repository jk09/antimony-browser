import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OLLAMA_URL, listOllamaModels, ollamaUrl } from './ollama'

describe('ollamaUrl', () => {
  it('reads OLLAMA_HOST the way Ollama does', () => {
    expect(ollamaUrl(undefined)).toBe('http://localhost:11434')
    expect(ollamaUrl('  ')).toBe(DEFAULT_OLLAMA_URL)
    expect(ollamaUrl('0.0.0.0:11434')).toBe('http://127.0.0.1:11434')
    expect(ollamaUrl('0.0.0.0')).toBe('http://127.0.0.1:11434')
    expect(ollamaUrl('gpu-box.lan')).toBe('http://gpu-box.lan:11434')
    expect(ollamaUrl('https://host:1')).toBe('https://host:1')
    expect(ollamaUrl('https://ollama.example.com/')).toBe('https://ollama.example.com')
    expect(ollamaUrl('http://proxy.lan:8080/ollama/')).toBe('http://proxy.lan:8080/ollama')
  })

  it('falls back to the default for anything but http(s)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(ollamaUrl('file:///etc/passwd')).toBe(DEFAULT_OLLAMA_URL)
    expect(ollamaUrl('ftp://host')).toBe(DEFAULT_OLLAMA_URL)
    expect(ollamaUrl('http://[bad')).toBe(DEFAULT_OLLAMA_URL)
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })
})

describe('listOllamaModels', () => {
  const respond = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }))

  it('maps installed models to ids and labels, skipping bad names and duplicates', async () => {
    const fetch = respond({
      models: [{ name: 'qwen3:8b' }, { name: 'qwen3:8b' }, { name: ' bad' }, {}, null],
    })
    expect(await listOllamaModels('http://h:1', fetch)).toEqual({
      models: [{ id: 'ollama:qwen3:8b', label: 'qwen3:8b (Ollama)' }],
    })
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('http://h:1/api/tags')
  })

  it('explains why there are no models', async () => {
    expect(await listOllamaModels('http://h:1', respond({ models: [] }))).toEqual({
      error: 'No models installed (ollama pull <model>).',
    })
    expect(await listOllamaModels('http://h:1', respond({}, 500))).toEqual({
      error: 'Ollama at http://h:1 answered 500.',
    })
    expect(await listOllamaModels('http://h:1', respond({ nope: 1 }))).toEqual({
      error: 'Unexpected answer from Ollama at http://h:1.',
    })
    const down = vi.fn(async () => Promise.reject(new TypeError('fetch failed')))
    expect(await listOllamaModels('http://h:1', down)).toEqual({
      error: "Ollama isn't running at http://h:1.",
    })
  })

  it('gives up after a timeout', async () => {
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )
    vi.useFakeTimers()
    const result = listOllamaModels('http://h:1', fetch as typeof globalThis.fetch)
    await vi.advanceTimersByTimeAsync(3_000)
    vi.useRealTimers()
    expect(await result).toEqual({ error: "Ollama isn't running at http://h:1." })
  })
})
