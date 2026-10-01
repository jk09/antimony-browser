// Finding the local Ollama server and the models it has installed.
import { isOllamaModel, ollamaId, type ModelInfo, type ModelList } from '../ipc'

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'
const LIST_TIMEOUT_MS = 3_000

/**
 * The Ollama server address from `OLLAMA_HOST` (read at startup only; the UI can't change it).
 * Follows Ollama's own convention: no scheme means http on port 11434, and 0.0.0.0 (a bind
 * address) means this machine.
 */
export function ollamaUrl(host: string | undefined): string {
  const value = host?.trim()
  if (!value) return DEFAULT_OLLAMA_URL
  try {
    const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    const url = new URL(hasScheme ? value : `http://${value}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('not http')
    if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1'
    if (!hasScheme && !url.port) url.port = '11434'
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    console.warn(`Ignoring OLLAMA_HOST=${value}: not an http(s) address`)
    return DEFAULT_OLLAMA_URL
  }
}

/** Installed models from `GET /api/tags`, or a sentence saying why there are none. */
export async function listOllamaModels(
  baseUrl: string,
  doFetch: typeof fetch = fetch,
): Promise<ModelList['ollama']> {
  const notRunning = { error: `Ollama isn't running at ${baseUrl}.` }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS)
  let json: unknown
  try {
    const response = await doFetch(`${baseUrl}/api/tags`, { signal: controller.signal })
    if (!response.ok) return { error: `Ollama at ${baseUrl} answered ${response.status}.` }
    json = await response.json()
  } catch {
    return notRunning
  } finally {
    clearTimeout(timer)
  }
  const entries = (json as { models?: unknown } | null)?.models
  if (!Array.isArray(entries)) return { error: `Unexpected answer from Ollama at ${baseUrl}.` }
  const models: ModelInfo[] = []
  for (const entry of entries) {
    const name = (entry as { name?: unknown } | null)?.name
    if (typeof name !== 'string') continue
    const id = ollamaId(name)
    if (isOllamaModel(id) && !models.some((model) => model.id === id)) {
      models.push({ id, label: `${name} (Ollama)` })
    }
  }
  if (models.length === 0) return { error: 'No models installed (ollama pull <model>).' }
  return { models }
}
