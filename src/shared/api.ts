import type { AgentApi } from '../features/agent/ipc'
import type { NavigationApi } from '../features/navigation/ipc'
import type { PromptApi } from '../features/prompt/ipc'
import type { SkillsApi } from '../features/skills/ipc'

/**
 * The API the preload script exposes to the chrome UI as `window.antimony`.
 * Each feature adds one key, typed by the interface in its `ipc.ts`.
 */
export interface AntimonyApi {
  /** Versions of the embedded runtimes. */
  versions: { chrome: string; electron: string }
  agent: AgentApi
  navigation: NavigationApi
  prompt: PromptApi
  skills: SkillsApi
}
