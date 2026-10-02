import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { getPage } from '../navigation/main'
import {
  channels,
  claudeModels,
  cliClaudeModel,
  isCliModel,
  isOllamaModel,
  providerOf,
  type ModelList,
} from './ipc'
import { Agent, type Step } from './main/agent'
import {
  createMessage,
  DEFAULT_BASE_URL,
  type ContentBlock,
  type ModelRequest,
} from './main/anthropic'
import { pageBrowser } from './main/browser'
import {
  cliCommand,
  cliComplete,
  cliEnv,
  cliStatus,
  runCliTurn,
  type CliOptions,
} from './main/claude-cli'
import { listOllamaModels, ollamaUrl } from './main/ollama'
import { toolNamed } from './main/tools'
import {
  defaultSettings,
  parseKey,
  parseSettings,
  parseUpdate,
  SettingsService,
  type KeyCrypto,
} from './main/settings'
import { parseDecision, parseRunInput } from './main/validate'

export type { Step } from './main/agent'

let agent: Agent | null = null
let completer: ((request: CompletionRequest) => Promise<Completion>) | null = null

/** A single model request without tools or conversation (history summaries and search). */
export interface CompletionRequest {
  system: string
  text: string
  /** A JPEG image sent before the text, base64. */
  imageJpegBase64?: string
  signal?: AbortSignal
}

export interface Completion {
  text: string
  /** The model that answered (the one selected in the prompt). */
  model: string
}

/**
 * Asks the model selected in the prompt (Claude via API key or CLI, or Ollama) once. Rejects when
 * no model is usable (Claude without a key, CLI missing or logged out) or the request fails.
 * Callers decide what content they may send.
 */
export function complete(request: CompletionRequest): Promise<Completion> {
  if (!completer) return Promise.reject(new Error('The assistant is not available.'))
  return completer(request)
}

/** Runs recorded steps without the model (skills); rejects while another run is going. */
export function replay(label: string, steps: Step[]): Promise<{ ok: boolean; error?: string }> {
  if (!agent) return Promise.resolve({ ok: false, error: 'The assistant is not available.' })
  return agent.replay(label, steps)
}

/** Replayable steps of the last finished model run (empty if none). */
export function savableSteps(): Step[] {
  return agent?.savableSteps() ?? []
}

/** True for tools a skill may replay (navigation and page actions, not read-only tools). */
export function isReplayableTool(name: string): boolean {
  return toolNamed(name)?.replayable === true
}

const safeStorageCrypto: KeyCrypto = {
  available: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
}

export function register({ ipc, fileMenu }: MainContext): void {
  const store = createJsonStore(join(app.getPath('userData'), 'agent-settings.json'), {
    parse: parseSettings,
    fallback: defaultSettings,
  })
  app.on('will-quit', () => store.flush())
  const settings = new SettingsService(store, safeStorageCrypto, process.env['ANTHROPIC_API_KEY'])
  const baseUrl = process.env['ANTHROPIC_BASE_URL'] || DEFAULT_BASE_URL
  const ollamaBaseUrl = ollamaUrl(process.env['OLLAMA_HOST'])
  const noKey =
    'No Anthropic API key is set. Use /key to add one, or pick a Claude Code CLI or Ollama model.'
  // The user's Claude Code CLI, signed in with its own login (read at startup; the UI can't change it).
  const cli: CliOptions = {
    command: cliCommand(process.env, app.getPath('home')),
    cwd: join(app.getPath('userData'), 'claude-cli'),
    env: cliEnv(process.env),
  }

  const callModel = (request: ModelRequest, signal?: AbortSignal) => {
    if (isCliModel(request.model)) throw new Error('Claude Code CLI models run through the CLI')
    if (isOllamaModel(request.model)) {
      return createMessage(request, { baseUrl: ollamaBaseUrl, ...(signal && { signal }) })
    }
    const apiKey = settings.apiKey()
    if (!apiKey) throw new Error(noKey)
    return createMessage(request, { apiKey, baseUrl, ...(signal && { signal }) })
  }
  completer = async ({ system, text, imageJpegBase64, signal }) => {
    const { model } = settings.get()
    const content: ContentBlock[] = [
      ...(imageJpegBase64
        ? [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: imageJpegBase64 },
            } as const,
          ]
        : []),
      { type: 'text', text },
    ]
    if (isCliModel(model)) {
      const answer = await cliComplete(cli, {
        model: cliClaudeModel(model),
        system,
        content,
        ...(signal && { signal }),
      })
      return { text: answer, model }
    }
    const response = await callModel(
      { model, system, messages: [{ role: 'user', content }], tools: [] },
      signal,
    )
    const answer = response.content
      .flatMap((block) => (block.type === 'text' ? [String(block['text'])] : []))
      .join('')
    return { text: answer, model }
  }

  const current = new Agent({
    callModel,
    runCli: (turn) => runCliTurn(cli, turn),
    browser: () => {
      const page = getPage()
      return page ? pageBrowser(page) : null
    },
    settings: () => settings.get(),
    missingSetup: () =>
      providerOf(settings.get().model) === 'anthropic' && settings.apiKey() === null ? noKey : null,
    onState: (state) => ipc.send(channels.stateChanged, state),
    onDebug: (event, label) => ipc.send(channels.debugLogChanged, { event, label }),
  })
  agent = current

  const publishSettings = () => {
    const value = settings.get()
    ipc.send(channels.settingsChanged, value)
    return value
  }

  ipc.handle(channels.run, (value) => {
    const input = parseRunInput(value)
    if (current.state().status !== 'idle') throw new Error('Stop the current run first')
    void current.run(input)
  })
  ipc.handle(channels.stop, () => current.stop())
  ipc.handle(channels.approve, (value) => current.approve(parseDecision(value)))
  ipc.handle(channels.newConversation, () => current.newConversation())
  ipc.handle(channels.state, () => current.state())
  ipc.handle(channels.settings, () => settings.get())
  ipc.handle(channels.updateSettings, (value) => {
    settings.update(parseUpdate(value))
    return publishSettings()
  })
  ipc.handle(channels.setKey, (value) => {
    settings.setKey(parseKey(value))
    return publishSettings()
  })
  ipc.handle(channels.models, async (): Promise<ModelList> => {
    const [cliModels, ollama] = await Promise.all([cliStatus(cli), listOllamaModels(ollamaBaseUrl)])
    return { claude: claudeModels.map(({ id, label }) => ({ id, label })), cli: cliModels, ollama }
  })
  ipc.handle(channels.debugLog, () => current.debugLog())
  ipc.handle(channels.toggleDebug, () => ipc.send(channels.debugToggled, null))

  fileMenu.push({
    id: 'toggle-debugger',
    label: 'Toggle Assistant Debugger',
    accelerator: 'CmdOrCtrl+Shift+D',
    click: () => ipc.send(channels.debugToggled, null),
  })
}
