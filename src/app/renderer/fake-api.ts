// Test helper: a fake window.antimony whose events tests can fire.
import { vi } from 'vitest'
import {
  claudeModels,
  type AgentSettings,
  type AgentState,
  type DebugEvent,
  type ModelList,
} from '../../features/agent/ipc'
import type {
  HistorySettings,
  OpenRequest,
  RecallRequest,
  RecallResult,
} from '../../features/history/ipc'
import type { MenuEntry, RunResult } from '../../features/menu/ipc'
import type { NavigationState } from '../../features/navigation/ipc'
import { toUrl } from '../../features/navigation/shared/to-url'
import type { Skill } from '../../features/skills/ipc'
import type { StackCommand, StacksState } from '../../features/stacks/ipc'
import type { AntimonyApi } from '../../shared/api'

type Listener<T> = (value: T) => void

function channel<T>() {
  const listeners = new Set<Listener<T>>()
  return {
    subscribe: (listener: Listener<T>) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: (value: T) => listeners.forEach((listener) => listener(value)),
  }
}

export const idleState: AgentState = { status: 'idle', items: [], approval: null, savableSteps: 0 }
export const defaultSettings: AgentSettings = {
  model: 'claude-sonnet-5-5',
  provider: 'anthropic',
  pageAccess: false,
  historyAccess: true,
  hasKey: true,
  keyPersisted: true,
}
export const builtins: Skill[] = ['reload', 'stop'].map((name) => ({
  name,
  description: `Built-in ${name}`,
  params: [],
  steps: [{ tool: name, input: {} }],
  builtin: true,
}))

export const defaultModels: ModelList = {
  claude: claudeModels.map(({ id, label }) => ({ id, label })),
  cli: { models: [{ id: 'cli:claude-sonnet-5-5', label: 'Sonnet 5.5 (Claude Code)' }] },
  ollama: { models: [{ id: 'ollama:qwen3:8b', label: 'qwen3:8b (Ollama)' }] },
}

export function fakeApi(
  options: {
    settings?: Partial<AgentSettings>
    skills?: Skill[]
    models?: ModelList
    menu?: MenuEntry[]
    stacks?: StacksState
  } = {},
) {
  const open = channel<void>()
  const toggle = channel<void>()
  const fieldOfView = channel<void>()
  const state = channel<AgentState>()
  const settings = channel<AgentSettings>()
  const skills = channel<Skill[]>()
  const saveRequested = channel<string>()
  const debugEvent = channel<{ event: DebugEvent; label: string }>()
  const debugToggled = channel<void>()
  const navigation = channel<NavigationState>()
  const historyOpen = channel<OpenRequest>()
  const historyChanged = channel<void>()
  const historySettings = channel<HistorySettings>()
  const recallOpen = channel<string>()
  const stacks = channel<StacksState>()
  const stackCommand = channel<StackCommand>()
  let home: string | null = null
  const currentSettings = { ...defaultSettings, ...options.settings }

  const api = {
    versions: { chrome: '140.0.0.0', electron: '44.0.0' },
    agent: {
      run: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      approve: vi.fn(async () => {}),
      newConversation: vi.fn(async () => {}),
      state: vi.fn(async () => idleState),
      onStateChanged: state.subscribe,
      settings: vi.fn(async () => currentSettings),
      updateSettings: vi.fn(async (update) => ({ ...currentSettings, ...update })),
      setKey: vi.fn(async (key: string | null) => ({ ...currentSettings, hasKey: key !== null })),
      onSettingsChanged: settings.subscribe,
      models: vi.fn(async () => options.models ?? defaultModels),
      debugLog: vi.fn(async () => []),
      onDebugEvent: (listener: (event: DebugEvent, label: string) => void) =>
        debugEvent.subscribe(({ event, label }) => listener(event, label)),
      toggleDebug: vi.fn(async () => debugToggled.emit()),
      onDebugToggled: debugToggled.subscribe,
    },
    history: {
      suggest: vi.fn(async (_text: string) => []),
      search: vi.fn(async (_request) => ({ pages: [] })),
      screenshot: vi.fn(async (_id: number) => null),
      current: vi.fn(async () => null),
      setNote: vi.fn(async (_id: number, _note: string | null) => {}),
      delete: vi.fn(async (_id: number) => {}),
      clear: vi.fn(async (_all: boolean) => {}),
      settings: vi.fn(async () => ({ summaries: false })),
      updateSettings: vi.fn(async (update) => ({ summaries: false, ...update })),
      requestOpen: vi.fn(async (request: OpenRequest) => historyOpen.emit(request)),
      onOpen: historyOpen.subscribe,
      recall: vi.fn(async (_request: RecallRequest): Promise<RecallResult> => ({
        view: 'words',
        pages: [],
        keywords: [],
      })),
      cancelRecall: vi.fn(async () => {}),
      requestRecall: vi.fn(async (query: string) => recallOpen.emit(query)),
      onOpenRecall: recallOpen.subscribe,
      onChanged: historyChanged.subscribe,
      onSettingsChanged: historySettings.subscribe,
    },
    menu: {
      items: vi.fn(async () => options.menu ?? []),
      run: vi.fn(async (_path: string[]): Promise<RunResult> => ({ ok: true })),
    },
    navigation: {
      go: vi.fn(async () => {}),
      back: vi.fn(async () => {}),
      forward: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      setInsets: vi.fn(async () => {}),
      onStateChanged: navigation.subscribe,
      toUrl,
    },
    prompt: {
      history: vi.fn(async () => []),
      record: vi.fn(async () => {}),
      clearHistory: vi.fn(async () => {}),
      onOpen: open.subscribe,
      onToggle: toggle.subscribe,
      onFieldOfView: fieldOfView.subscribe,
      focusPage: vi.fn(async () => {}),
      coverPage: vi.fn(async (): Promise<string | null> => null),
      uncoverPage: vi.fn(async () => {}),
    },
    skills: {
      list: vi.fn(async () => options.skills ?? builtins),
      onListChanged: skills.subscribe,
      draft: vi.fn(async () => []),
      save: vi.fn(async (draft) => ({ ...draft, params: [], builtin: false })),
      delete: vi.fn(async () => {}),
      run: vi.fn(async () => ({ ok: true })),
      requestSave: vi.fn(async (name?: string) => saveRequested.emit(name ?? '')),
      onSaveRequested: saveRequested.subscribe,
    },
    stacks: {
      state: vi.fn(async () => options.stacks ?? { current: null, stacks: [] }),
      goToNode: vi.fn(async (_nodeId: number) => {}),
      switch: vi.fn(async (_stackId: string) => {}),
      create: vi.fn(async () => {}),
      close: vi.fn(async (_stackId: string) => {}),
      outline: vi.fn(async (name: string) => `Navigation stack @${name}`),
      closeNode: vi.fn(async (_nodeId: number) => {}),
      home: vi.fn(async () => home),
      setHome: vi.fn(async (url: string | null) => {
        home = url
      }),
      setMuted: vi.fn(async (_stackId: string, _muted: boolean) => {}),
      onChanged: stacks.subscribe,
      onCommand: stackCommand.subscribe,
    },
  } satisfies AntimonyApi

  window.antimony = api
  return {
    api,
    emit: {
      open: () => open.emit(),
      toggle: () => toggle.emit(),
      fieldOfView: () => fieldOfView.emit(),
      state: state.emit,
      settings: settings.emit,
      skills: skills.emit,
      saveRequested: saveRequested.emit,
      debugEvent: (event: DebugEvent, label: string) => debugEvent.emit({ event, label }),
      debugToggled: () => debugToggled.emit(),
      navigation: navigation.emit,
      historyOpen: historyOpen.emit,
      historyChanged: () => historyChanged.emit(),
      recallOpen: recallOpen.emit,
      stacks: stacks.emit,
      stackCommand: stackCommand.emit,
    },
  }
}
