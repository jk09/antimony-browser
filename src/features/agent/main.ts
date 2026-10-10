import { join } from 'node:path'
import { app } from 'electron'
import type { MainContext } from '../../app/main/features'
import { createJsonStore } from '../../app/main/json-store'
import { getPage } from '../navigation/main'
import { channels } from './ipc'
import { Agent, type Step } from './main/agent'
import { pageBrowser } from './main/browser'
import {
  checkCli,
  cliCommand,
  cliComplete,
  cliEnv,
  runCliTurn,
  type CliOptions,
} from './main/claude-cli'
import type { ContentBlock } from './main/content'
import {
  toolNamed,
  validateInput,
  type HistoryPort,
  type ImportPort,
  type MacroPort,
  type StackOpener,
} from './main/tools'
import { defaultSettings, parseSettings, parseUpdate } from './main/settings'
import { parseDecision, parseRunInput } from './main/validate'

export type { Step } from './main/agent'
export type {
  AttachedImage,
  HistoryHit,
  HistoryPort,
  HistoryRecall,
  HistoryRecallRequest,
  HistorySearchMode,
  ImportPort,
  MacroInfo,
  MacroPort,
  StackOpener,
} from './main/tools'

let agent: Agent | null = null
let historySearch: HistoryPort | null = null
let macroStore: MacroPort | null = null
let stackOpener: StackOpener | null = null
let importer: ImportPort | null = null
let completer: ((request: CompletionRequest) => Promise<Completion>) | null = null

/** A single model request without tools or conversation (history summaries and search). */
export interface CompletionRequest {
  system: string
  text: string
  /** A JPEG image sent before the text, base64. */
  imageJpegBase64?: string
  /** More JPEG images, each after a text block with its label, before the text. */
  images?: { label: string; jpegBase64: string }[]
  signal?: AbortSignal
}

export interface Completion {
  text: string
  /** The model that answered (the one selected in the prompt). */
  model: string
}

/**
 * Asks the model selected in the prompt once, through the Claude Code CLI. Rejects when the CLI is
 * missing or logged out or the request fails. Callers decide what content they may send.
 */
export function complete(request: CompletionRequest): Promise<Completion> {
  if (!completer) return Promise.reject(new Error('The assistant is not available.'))
  return completer(request)
}

/** Lets the assistant search browsing history (search_history); called by the history feature. */
export function provideHistorySearch(port: HistoryPort): void {
  historySearch = port
}

/** Runs recorded steps without the model (skills); rejects while another run is going. */
export function replay(label: string, steps: Step[]): Promise<{ ok: boolean; error?: string }> {
  if (!agent) return Promise.resolve({ ok: false, error: 'The assistant is not available.' })
  return agent.replay(label, steps)
}

/** Lets the assistant save, list and delete macros (save_macro …); called by the skills feature. */
export function provideMacros(port: MacroPort): void {
  macroStore = port
}

/** Lets the assistant open new stacks (new_stack); called by the stacks feature. */
export function provideStackOpener(opener: StackOpener): void {
  stackOpener = opener
}

/** Lets the assistant and skills import a browsing-data export (import_browsing_data); called by the import feature. */
export function provideImporter(port: ImportPort): void {
  importer = port
}

/** True for tools a skill may replay (navigation and page actions, not read-only tools). */
export function isReplayableTool(name: string): boolean {
  return toolNamed(name)?.replayable === true
}

/**
 * Throws a TypeError unless `step` is a replayable tool call whose input fits the tool's schema
 * (string inputs may still hold {{parameter}} placeholders).
 */
export function checkStep(step: Step): void {
  if (!isReplayableTool(step.tool)) throw new TypeError(`${step.tool} can't be a macro step`)
  try {
    validateInput(step.tool, step.input)
  } catch (error) {
    throw new TypeError(error instanceof Error ? error.message : String(error))
  }
}

export function register({ ipc, fileMenu }: MainContext): void {
  const store = createJsonStore(join(app.getPath('userData'), 'agent-settings.json'), {
    parse: parseSettings,
    fallback: defaultSettings,
  })
  app.on('will-quit', () => store.flush())
  // The user's Claude Code CLI, signed in with its own login. Looked up for every use, so a CLI
  // installed while the browser runs (e.g. from the welcome page) is found; the UI can't change it.
  const cli = (): CliOptions => ({
    command: cliCommand(process.env, app.getPath('home')),
    cwd: join(app.getPath('userData'), 'claude-cli'),
    env: cliEnv(process.env),
  })

  completer = async ({ system, text, imageJpegBase64, images = [], signal }) => {
    const { model } = store.get()
    const jpeg = (data: string) =>
      ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }) as const
    const content: ContentBlock[] = [
      ...(imageJpegBase64 ? [jpeg(imageJpegBase64)] : []),
      ...images.flatMap((image) => [
        { type: 'text', text: image.label } as const,
        jpeg(image.jpegBase64),
      ]),
      { type: 'text', text },
    ]
    const answer = await cliComplete(cli(), { model, system, content, ...(signal && { signal }) })
    return { text: answer, model }
  }

  const current = new Agent({
    runCli: (turn) => runCliTurn(cli(), turn),
    browser: () => {
      const page = getPage()
      return page ? pageBrowser(page) : null
    },
    history: () => historySearch,
    macros: () => macroStore,
    stacks: () => stackOpener,
    importer: () => importer,
    settings: () => store.get(),
    onState: (state) => ipc.send(channels.stateChanged, state),
    onDebug: (event, label) => ipc.send(channels.debugLogChanged, { event, label }),
  })
  agent = current

  ipc.handle(channels.run, (value) => {
    const input = parseRunInput(value)
    if (current.state().status !== 'idle') throw new Error('Stop the current run first')
    void current.run(input)
  })
  ipc.handle(channels.stop, () => current.stop())
  ipc.handle(channels.approve, (value) => current.approve(parseDecision(value)))
  ipc.handle(channels.newConversation, () => current.newConversation())
  ipc.handle(channels.state, () => current.state())
  ipc.handle(channels.settings, () => store.get())
  ipc.handle(channels.updateSettings, (value) => {
    store.set({ ...store.get(), ...parseUpdate(value) })
    const updated = store.get()
    ipc.send(channels.settingsChanged, updated)
    return updated
  })
  ipc.handle(channels.checkCli, () => checkCli(cli(), store.get().model))
  ipc.handle(channels.debugLog, () => current.debugLog())
  ipc.handle(channels.toggleDebug, () => ipc.send(channels.debugToggled, null))

  fileMenu.push({
    id: 'toggle-debugger',
    label: 'Toggle Assistant Debugger',
    accelerator: 'CmdOrCtrl+Shift+D',
    click: () => ipc.send(channels.debugToggled, null),
  })
}
