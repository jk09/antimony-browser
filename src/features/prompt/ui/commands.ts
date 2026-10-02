import { isOllamaModel, ollamaId, type AgentSettings, type ModelInfo } from '../../agent/ipc'
import type { Skill } from '../../skills/ipc'
import { DEFAULT_NEW_STACK_PAGE } from '../../stacks/ipc'
import { promptCommands } from '../ipc'

export interface CommandResult {
  /** Shown under the prompt. */
  message?: { kind: 'error' | 'info'; text: string }
  /** Ask for the API key in a password field. */
  keyMode?: boolean
  /** Clear the message and key field (navigation commands). */
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
    case 'menu': {
      if (!args) {
        const menus = await api.menu.items()
        return info(`Pick a menu: ${menus.map((menu) => `/menu ${menu.name}`).join(', ')}.`)
      }
      const result = await api.menu.run(args.split(/\s+/))
      if (!result.ok) return error(result.error)
      return { close: true }
    }
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
    case 'history':
      await api.history.requestOpen({ query: args })
      return { close: true }
    case 'note': {
      const page = await api.history.current()
      if (!args) {
        await api.history.requestOpen({ note: true })
        return { close: true }
      }
      if (!page) return error('This page is not in history, so it can’t have a note.')
      if (args === 'clear') {
        await api.history.setNote(page.id, null)
        return info('Note removed.')
      }
      await api.history.setNote(page.id, args)
      return info(`Noted ${page.title || page.url}.`)
    }
    case 'history-clear':
      if (args !== '' && args !== 'all') return error('Use /history-clear or /history-clear all.')
      await api.history.clear(args === 'all')
      return info(
        args === 'all'
          ? 'Browsing history cleared, notes included.'
          : 'Browsing history cleared; noted pages and their notes are kept.',
      )
    case 'history-summaries': {
      if (args !== 'on' && args !== 'off') {
        const current = await api.history.settings()
        return info(
          `Page summaries are ${current.summaries ? 'on' : 'off'}. Use /history-summaries on or off.`,
        )
      }
      await api.history.updateSettings({ summaries: args === 'on' })
      return info(
        args === 'on'
          ? 'Pages you spend 30 s or more on will be summarised by the selected model (their text and a screenshot are sent to it).'
          : 'Page summaries off.',
      )
    }
    case 'new-stack-page': {
      if (!args) {
        const { newStackPage } = await api.stacks.settings()
        return info(
          newStackPage === null
            ? 'New stacks open empty. Use /new-stack-page <url> to choose a page.'
            : `New stacks open ${newStackPage}. Use /new-stack-page <url>, off or reset.`,
        )
      }
      let page: string | null = null
      if (args !== 'off') {
        page = args === 'reset' ? DEFAULT_NEW_STACK_PAGE : api.navigation.toUrl(args)
        if (page === null) {
          return error(`${args} isn't a web address. Use /new-stack-page <url>, off or reset.`)
        }
      }
      await api.stacks.updateSettings({ newStackPage: page })
      return info(page === null ? 'New stacks open empty.' : `New stacks open ${page}.`)
    }
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
