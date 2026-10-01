import type { AgentApi } from '../features/agent/ipc'
import type { HistoryApi } from '../features/history/ipc'
import type { MenuApi } from '../features/menu/ipc'
import type { NavigationApi } from '../features/navigation/ipc'
import type { PromptApi } from '../features/prompt/ipc'
import type { SkillsApi } from '../features/skills/ipc'
import type { StacksApi } from '../features/stacks/ipc'

/**
 * The API the preload script exposes to the chrome UI as `window.antimony`.
 * Each feature adds one key, typed by the interface in its `ipc.ts`.
 */
export interface AntimonyApi {
  /** Versions of the embedded runtimes. */
  versions: { chrome: string; electron: string }
  agent: AgentApi
  history: HistoryApi
  menu: MenuApi
  navigation: NavigationApi
  prompt: PromptApi
  skills: SkillsApi
  stacks: StacksApi
}
