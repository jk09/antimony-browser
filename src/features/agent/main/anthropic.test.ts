import { describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  buildRequest,
  createMessage,
  describeError,
  type ModelRequest,
} from './anthropic'

const request = (model: ModelRequest['model']): ModelRequest => ({
  model,
  system: 'system',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  tools: [{ name: 'navigate', description: 'Open a page', input_schema: { type: 'object' } }],
})

const reply = {
  id: 'msg_1',
  model: 'claude-sonnet-5-5',
  content: [],
  stop_reason: 'end_turn',
  usage: {},
}

describe('buildRequest', () => {
  it('uses adaptive thinking, effort and refusal fallbacks on Sonnet and Opus 5.5', () => {
    for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5'] as const) {
      const { body, headers } = buildRequest(request(model))
      expect(body).toMatchObject({
        model,
        max_tokens: 16_000,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: 'medium' },
        fallbacks: 'default',
        cache_control: { type: 'ephemeral' },
      })
      expect(headers).toEqual({ 'anthropic-beta': 'server-side-fallback-2026-07-01' })
    }
  })

  it('sends none of those to Haiku 4.5', () => {
    const { body, headers } = buildRequest(request('claude-haiku-4-5'))
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('output_config')
    expect(body).not.toHaveProperty('fallbacks')
    expect(headers).toEqual({})
  })
})

describe('createMessage', () => {
  it('posts to /v1/messages with the key and version headers', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(reply), { status: 200 }))
    const result = await createMessage(request('claude-sonnet-5-5'), {
      apiKey: 'sk-test',
      baseUrl: 'http://127.0.0.1:9/',
      fetch,
    })
    expect(result).toEqual(reply)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:9/v1/messages')
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    })
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'claude-sonnet-5-5' })
  })

  it('turns API errors into ApiError with status and type', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'authentication_error', message: 'bad key' },
          }),
          { status: 401 },
        ),
    )
    const error = await createMessage(request('claude-haiku-4-5'), { apiKey: 'x', fetch }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, errorType: 'authentication_error' })
    expect(describeError(error)).toContain('/key')
  })

  it('explains rate limits, overload and network failures', () => {
    expect(describeError(new ApiError('slow down', 429, 'rate_limit_error'))).toContain(
      'Rate limited',
    )
    expect(describeError(new ApiError('busy', 529, 'overloaded_error'))).toContain('overloaded')
    expect(describeError(new TypeError('fetch failed'))).toContain("Couldn't reach")
  })
})
