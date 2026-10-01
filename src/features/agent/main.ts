import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { getPage } from '../navigation/main'
import { channels, claudeModels, isOllamaModel, providerOf, type ModelList } from './ipc'
import { Agent, type Step } from './main/agent'
import { createMessage, DEFAULT_BASE_URL } from './main/anthropic'
import { pageBrowser } from './main/browser'
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
  const noKey = 'No Anthropic API key is set. Use /key to add one, or pick an Ollama model.'

  const current = new Agent({
    callModel: (request, signal) => {
      if (isOllamaModel(request.model)) {
        return createMessage(request, { baseUrl: ollamaBaseUrl, signal })
      }
      const apiKey = settings.apiKey()
      if (!apiKey) throw new Error(noKey)
      return createMessage(request, { apiKey, baseUrl, signal })
    },
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
  ipc.handle(channels.models, async (): Promise<ModelList> => ({
    claude: claudeModels.map(({ id, label }) => ({ id, label })),
    ollama: await listOllamaModels(ollamaBaseUrl),
  }))
  ipc.handle(channels.debugLog, () => current.debugLog())
  ipc.handle(channels.toggleDebug, () => ipc.send(channels.debugToggled, null))

  fileMenu.push({
    id: 'toggle-debugger',
    label: 'Toggle Assistant Debugger',
    accelerator: 'CmdOrCtrl+Shift+D',
    click: () => ipc.send(channels.debugToggled, null),
  })
}
