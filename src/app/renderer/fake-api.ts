// Test helper: a fake window.antimony whose events tests can fire.
import { vi } from 'vitest'
import type { AgentSettings, AgentState, CliCheck, DebugEvent } from '../../features/agent/ipc'
import type {
  CheckedTheme,
  OpenRequest as AppearanceOpen,
  Theme,
} from '../../features/appearance/ipc'
import { sampleTheme } from '../../features/appearance/shared/sample-theme'
import type {
  HistorySettings,
  OpenRequest,
  MapRequest,
  MapResult,
  RecallRequest,
  RecallResult,
  RecallShown,
} from '../../features/history/ipc'
import type { MenuEntry, RunResult } from '../../features/menu/ipc'
import type { NavigationState } from '../../features/navigation/ipc'
import { toUrl } from '../../features/navigation/shared/to-url'
import type { Skill } from '../../features/skills/ipc'
import type { StackCommand, StackPages, StacksState } from '../../features/stacks/ipc'
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

export const idleState: AgentState = { status: 'idle', items: [], approval: null }
export const defaultSettings: AgentSettings = {
  model: 'claude-sonnet-5-5',
  pageAccess: false,
  historyAccess: true,
}
export const builtins: Skill[] = ['reload', 'stop'].map((name) => ({
  name,
  description: `Built-in ${name}`,
  params: [],
  steps: [{ tool: name, input: {} }],
  builtin: true,
}))

export { sampleTheme } from '../../features/appearance/shared/sample-theme'

export const workingCli: CliCheck = {
  found: { ok: true },
  loggedIn: { ok: true },
  answered: { ok: true, model: 'claude-sonnet-5-5', ms: 1234 },
}

export function fakeApi(
  options: {
    settings?: Partial<AgentSettings>
    skills?: Skill[]
    cliCheck?: CliCheck
    theme?: Theme | null
    candidates?: CheckedTheme[]
    /** The welcome page was finished before (default true, so it doesn't open in other tests). */
    welcomeDone?: boolean
    menu?: MenuEntry[]
    stacks?: StacksState
    stackPages?: StackPages[]
  } = {},
) {
  const open = channel<void>()
  const toggle = channel<void>()
  const fieldOfView = channel<void>()
  const state = channel<AgentState>()
  const settings = channel<AgentSettings>()
  const skills = channel<Skill[]>()
  const openConfig = channel<void>()
  const debugEvent = channel<{ event: DebugEvent; label: string }>()
  const debugToggled = channel<void>()
  const navigation = channel<NavigationState>()
  const historyOpen = channel<OpenRequest>()
  const historyChanged = channel<void>()
  const historySettings = channel<HistorySettings>()
  const recallOpen = channel<string>()
  const recallShown = channel<RecallShown>()
  const mapOpen = channel<void>()
  const stacks = channel<StacksState>()
  const stackCommand = channel<StackCommand>()
  const welcomeOpen = channel<void>()
  const themeChanged = channel<Theme | null>()
  const appearanceOpen = channel<AppearanceOpen>()
  let theme: Theme | null = options.theme ?? null
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
      onSettingsChanged: settings.subscribe,
      checkCli: vi.fn(async () => options.cliCheck ?? workingCli),
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
      map: vi.fn(async (_request: MapRequest): Promise<MapResult> => ({
        nodes: [],
        edges: [],
        groups: [],
        total: 0,
      })),
      requestMap: vi.fn(async () => mapOpen.emit()),
      onOpenMap: mapOpen.subscribe,
      onRecallShown: recallShown.subscribe,
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
      delete: vi.fn(async () => {}),
      run: vi.fn(async () => ({ ok: true })),
      requestConfig: vi.fn(async () => {}),
      onOpenConfig: openConfig.subscribe,
    },
    stacks: {
      state: vi.fn(async () => options.stacks ?? { current: null, stacks: [] }),
      goToNode: vi.fn(async (_nodeId: number) => {}),
      switch: vi.fn(async (_stackId: string) => {}),
      create: vi.fn(async () => {}),
      close: vi.fn(async (_stackId: string) => {}),
      outline: vi.fn(async (name: string) => `Navigation stack @${name}`),
      pages: vi.fn(async () => options.stackPages ?? []),
      openPage: vi.fn(async (_stackId: string, _nodeId: number) => {}),
      closeNode: vi.fn(async (_nodeId: number) => {}),
      home: vi.fn(async () => home),
      setHome: vi.fn(async (url: string | null) => {
        home = url
      }),
      setMuted: vi.fn(async (_stackId: string, _muted: boolean) => {}),
      onChanged: stacks.subscribe,
      onCommand: stackCommand.subscribe,
    },
    appearance: {
      get: vi.fn(async () => theme),
      set: vi.fn(async (next: Theme | null) => {
        theme = next
        themeChanged.emit(next)
        return next
      }),
      onChanged: themeChanged.subscribe,
      generate: vi.fn(
        async (_description: string): Promise<CheckedTheme[]> =>
          options.candidates ?? [
            { theme: sampleTheme('Soft daylight'), minTextContrast: 7.1 },
            { theme: sampleTheme('Warm paper'), minTextContrast: 6.4 },
          ],
      ),
      capture: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
      cancel: vi.fn(async () => {}),
      requestOpen: vi.fn(async (request?: AppearanceOpen) =>
        appearanceOpen.emit(request ?? { description: '' }),
      ),
      onOpen: appearanceOpen.subscribe,
    },
    welcome: {
      state: vi.fn(async () => ({ done: options.welcomeDone ?? true })),
      setDone: vi.fn(async (done: boolean) => ({ done })),
      requestOpen: vi.fn(async () => welcomeOpen.emit()),
      onOpen: welcomeOpen.subscribe,
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
      openConfig: () => openConfig.emit(),
      debugEvent: (event: DebugEvent, label: string) => debugEvent.emit({ event, label }),
      debugToggled: () => debugToggled.emit(),
      navigation: navigation.emit,
      historyOpen: historyOpen.emit,
      historyChanged: () => historyChanged.emit(),
      recallOpen: recallOpen.emit,
      mapOpen: () => mapOpen.emit(),
      recallShown: recallShown.emit,
      stacks: stacks.emit,
      stackCommand: stackCommand.emit,
      welcomeOpen: () => welcomeOpen.emit(),
      themeChanged: themeChanged.emit,
      appearanceOpen: appearanceOpen.emit,
    },
  }
}
