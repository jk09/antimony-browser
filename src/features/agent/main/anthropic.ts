// Minimal Anthropic Messages API client over fetch (no SDK: no new shipped package, see the spec).
// Also talks to Ollama, which serves the same API at /v1/messages (Ollama 0.14+).
import { isOllamaModel, ollamaName, providerOf, type ModelId, type Provider } from '../ipc'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: string | ContentBlock[]
      is_error?: boolean
    }
  | { type: 'thinking'; thinking: string; signature?: string }
  // Other blocks (redacted thinking, fallback markers…) are kept as-is and sent back unchanged.
  | { type: string; [key: string]: unknown }

export interface ApiMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

export interface ApiTool {
  name: string
  description: string
  input_schema: object
}

export interface ModelRequest {
  model: ModelId
  system: string
  messages: ApiMessage[]
  tools: ApiTool[]
}

export interface ModelResponse {
  id: string
  model: string
  content: ContentBlock[]
  stop_reason: string | null
  stop_details?: { category?: string | null; explanation?: string } | null
  usage: Record<string, unknown>
}

/** Where a failed request went, so the error can name the provider, model and server. */
export interface ErrorContext {
  provider: Provider
  /** The model name as the provider knows it (no `ollama:` prefix). */
  model?: string
  baseUrl?: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status; 0 when the server couldn't be reached. */
    readonly status: number,
    readonly errorType: string,
    readonly context: ErrorContext = { provider: 'anthropic' },
  ) {
    super(message)
  }
}

export const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** Models that take adaptive thinking, effort and server-side refusal fallbacks. */
const current = (model: ModelId) => model === 'claude-sonnet-5-5' || model === 'claude-opus-5-5'

/** The JSON body and extra headers for a Messages API request. */
export function buildRequest(request: ModelRequest): {
  body: Record<string, unknown>
  headers: Record<string, string>
} {
  if (isOllamaModel(request.model)) {
    // Only what Ollama's compatibility layer understands; no caching, thinking or beta features.
    return {
      body: {
        model: ollamaName(request.model),
        max_tokens: 16_000,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
      },
      headers: {},
    }
  }
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: 16_000,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    // Caches the stable prefix (tools, system prompt, earlier turns) between the steps of a run.
    cache_control: { type: 'ephemeral' },
  }
  const headers: Record<string, string> = {}
  if (current(request.model)) {
    // Summaries of the model's reasoning show in the debug panel.
    body['thinking'] = { type: 'adaptive', display: 'summarized' }
    body['output_config'] = { effort: 'medium' }
    // On a safety decline the API retries on a fallback model instead of stopping the run.
    body['fallbacks'] = 'default'
    headers['anthropic-beta'] = FALLBACK_BETA
  }
  return { body, headers }
}

export interface ClientOptions {
  /** Required for Claude models; Ollama takes none. */
  apiKey?: string
  baseUrl?: string
  signal?: AbortSignal
  fetch?: typeof fetch
}

export async function createMessage(
  request: ModelRequest,
  { apiKey, baseUrl = DEFAULT_BASE_URL, signal, fetch: doFetch = fetch }: ClientOptions,
): Promise<ModelResponse> {
  const { body, headers } = buildRequest(request)
  const root = baseUrl.replace(/\/+$/, '')
  const context: ErrorContext = {
    provider: providerOf(request.model),
    model: String(body['model']),
    baseUrl: root,
  }
  let response: Response
  try {
    response = await doFetch(`${root}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...(apiKey !== undefined && { 'x-api-key': apiKey }),
        ...headers,
      },
      body: JSON.stringify(body),
      signal: signal ?? null,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new ApiError(message, 0, 'connection_error', context)
  }
  const text = await response.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  if (!response.ok) {
    // Anthropic (and Ollama's compatibility layer) send {error: {type, message}}; Ollama's own
    // handlers send {error: "message"}.
    const raw = (json as { error?: unknown } | null)?.error
    const error =
      typeof raw === 'string' ? { message: raw } : (raw as { type?: string; message?: string })
    throw new ApiError(
      error?.message ?? (text.slice(0, 200) || response.statusText),
      response.status,
      error?.type ?? 'api_error',
      context,
    )
  }
  const message = json as ModelResponse | null
  if (!message || !Array.isArray(message.content)) {
    throw new ApiError(
      `Unexpected response from ${context.provider === 'ollama' ? 'Ollama' : 'the Anthropic API'}`,
      response.status,
      'invalid_response',
      context,
    )
  }
  return message
}

function describeOllamaError(error: ApiError): string {
  const { model = 'the model', baseUrl = 'its address' } = error.context
  if (error.status === 0)
    return `Couldn't reach Ollama at ${baseUrl}. Is it running (ollama serve)?`
  if (/does not support tools/i.test(error.message)) {
    return `${model} can't use tools; pick a model with tool support (e.g. qwen3, llama3.1).`
  }
  if (/model\b.*\bnot found/i.test(error.message)) {
    return `Ollama has no model ${model}. Pull it with: ollama pull ${model}`
  }
  if (error.status === 404 || error.errorType === 'invalid_response') {
    // Before 0.14 Ollama had no /v1/messages.
    return `Ollama at ${baseUrl} doesn't speak the Messages API; update it to version 0.14 or newer.`
  }
  return `Ollama error ${error.status}: ${error.message}`
}

/** A sentence for the conversation explaining what went wrong. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError && error.context.provider === 'ollama') {
    return describeOllamaError(error)
  }
  if (error instanceof ApiError) {
    switch (error.status) {
      case 0:
        return `Couldn't reach the Anthropic API: ${error.message}`
      case 401:
        return 'The Anthropic API key was rejected. Set a valid one with /key.'
      case 403:
        return `The API key isn't allowed to do this: ${error.message}`
      case 429:
        return 'Rate limited by the Anthropic API. Try again in a moment.'
      case 529:
        return 'The Anthropic API is overloaded. Try again in a moment.'
      default:
        return `Anthropic API error ${error.status} (${error.errorType}): ${error.message}`
    }
  }
  if (error instanceof Error) return `Couldn't reach the Anthropic API: ${error.message}`
  return String(error)
}
