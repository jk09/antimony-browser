import { isOllamaModel, ollamaId, type AgentSettings, type ModelInfo } from '../../agent/ipc'
import type { Skill } from '../../skills/ipc'
import { promptCommands } from '../ipc'

export interface CommandResult {
  /** Shown under the prompt. */
  message?: { kind: 'error' | 'info'; text: string }
  /** Ask for the API key in a password field. */
  keyMode?: boolean
  /** Collapse the prompt (navigation commands). */
  close?: boolean
}

const signatureOf = (skill: Skill) =>
  [`/${skill.name}`, ...skill.params.map((param) => `<${param}>`)].join(' ')

/** Runs a built-in command or a skill. Never calls the model. */
export async function runCommand(
  name: string,
  args: string,
  { skills, settings }: { skills: Skill[]; settings: AgentSettings | null },
): Promise<CommandResult> {
  const api = window.antimony
  const info = (text: string): CommandResult => ({ message: { kind: 'info', text } })
  const error = (text: string): CommandResult => ({ message: { kind: 'error', text } })

  switch (name) {
    case 'new':
      await api.agent.newConversation()
      return info('Started a new conversation.')
    case 'debug':
      await api.agent.toggleDebug()
      return {}
    case 'key':
      if (args === 'clear') {
        await api.agent.setKey(null)
        return info('API key removed.')
      }
      if (args) {
        const saved = await api.agent.setKey(args)
        return info(
          saved.keyPersisted
            ? 'API key saved.'
            : 'API key set for this session only (no system keyring).',
        )
      }
      return { keyMode: true }
    case 'model': {
      const list = await api.agent.models()
      const available: ModelInfo[] = [
        ...list.claude,
        ...('models' in list.ollama ? list.ollama.models : []),
      ]
      const wanted = args.toLowerCase()
      const model = available.find(
        (m) =>
          m.id === args ||
          m.label.toLowerCase() === wanted ||
          (isOllamaModel(m.id) && m.id === ollamaId(args)),
      )
      if (!model) {
        const ollamaError = 'error' in list.ollama ? ` ${list.ollama.error}` : ''
        return error(`Choose one of: ${available.map((m) => m.id).join(', ')}.${ollamaError}`)
      }
      await api.agent.updateSettings({ model: model.id })
      return info(`Using ${model.label}.`)
    }
    case 'page-access':
      if (args !== 'on' && args !== 'off') {
        return info(
          `Page access is ${settings?.pageAccess ? 'on' : 'off'}. Use /page-access on or off.`,
        )
      }
      await api.agent.updateSettings({ pageAccess: args === 'on' })
      return info(
        args === 'on'
          ? 'Page access on: the assistant can read this page and, with your approval, act on it.'
          : 'Page access off: the assistant only sees the page address and title.',
      )
    case 'save':
      await api.skills.requestSave(args)
      return {}
    case 'skills': {
      const saved = skills.filter((skill) => !skill.builtin)
      return info(
        saved.length === 0
          ? 'No saved skills yet. Run a request, then use /save <name>.'
          : saved
              .map(
                (skill) =>
                  `${signatureOf(skill)}${skill.description ? ` – ${skill.description}` : ''}`,
              )
              .join('\n'),
      )
    }
    case 'forget':
      if (!skills.some((skill) => skill.name === args && !skill.builtin)) {
        return error(`No saved skill /${args}.`)
      }
      await api.skills.delete(args)
      return info(`Deleted /${args}.`)
    case 'forget-history':
      await api.prompt.clearHistory()
      return info('Prompt history cleared.')
  }

  const skill = skills.find((candidate) => candidate.name === name)
  if (!skill) {
    const names = [...promptCommands.map((c) => c.name), ...skills.map((s) => s.name)]
    const close = names.filter((candidate) => name && candidate.startsWith(name[0]!)).slice(0, 4)
    return error(
      `Unknown command /${name}.${close.length ? ` Did you mean ${close.map((c) => `/${c}`).join(', ')}?` : ''}`,
    )
  }
  const result = await api.skills.run(skill.name, args)
  if (!result.ok) return error(result.error ?? `/${skill.name} failed.`)
  return skill.builtin ? { close: true } : {}
}
