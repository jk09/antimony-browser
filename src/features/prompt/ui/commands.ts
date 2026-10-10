import { claudeModels, findModel, type AgentSettings } from '../../agent/ipc'
import { themeNeeds } from '../../appearance/ipc'
import type { Skill } from '../../skills/ipc'
import { paramLabel } from '../../skills/shared/params'
import { DEFAULT_HOME } from '../../stacks/ipc'
import { promptCommands } from '../ipc'

export interface CommandResult {
  /** Shown under the prompt. */
  message?: { kind: 'error' | 'info'; text: string }
  /** Clear the message and key field (navigation commands). */
  close?: boolean
}

const signatureOf = (skill: Skill) => [`/${skill.name}`, ...skill.params.map(paramLabel)].join(' ')

/**
 * Runs a built-in command or a skill. Never calls the model. `resolveArgs` turns a macro's `@`
 * references into URLs before it runs.
 */
export async function runCommand(
  name: string,
  args: string,
  {
    skills,
    settings,
    resolveArgs = async (value) => value,
  }: {
    skills: Skill[]
    settings: AgentSettings | null
    resolveArgs?: (args: string) => Promise<string>
  },
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
    case 'model': {
      const model = findModel(args)
      if (!model) {
        const current = claudeModels.find((m) => m.id === settings?.model)
        return (args ? error : info)(
          `${args ? `No model ${args}. ` : current ? `Using ${current.label}. ` : ''}Choose one of: ${claudeModels.map((m) => m.short).join(', ')}.`,
        )
      }
      await api.agent.updateSettings({ model: model.id })
      return info(`Using ${model.label} through your Claude Code CLI.`)
    }
    case 'welcome':
      await api.welcome.requestOpen()
      return { close: true }
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
    case 'history-access':
      if (args !== 'on' && args !== 'off') {
        return info(
          `History access is ${settings?.historyAccess === false ? 'off' : 'on'}. Use /history-access on or off.`,
        )
      }
      await api.agent.updateSettings({ historyAccess: args === 'on' })
      return info(
        args === 'on'
          ? 'History access on: the assistant can search the pages you visited.'
          : "History access off: the assistant can't search your browsing history.",
      )
    case 'home': {
      if (!args) {
        const home = await api.stacks.home()
        return info(
          home
            ? `New stacks open at ${home}. Use /home <url> to change it or /home clear.`
            : 'New stacks open empty. Use /home <url> to set a home page.',
        )
      }
      if (args === 'clear') {
        await api.stacks.setHome(null)
        return info('Home page removed: new stacks open empty.')
      }
      const url = args === 'reset' ? DEFAULT_HOME : api.navigation.toUrl(args)
      if (!url) return error(`${args} is not a web address.`)
      await api.stacks.setHome(url)
      return info(`New stacks open at ${url}.`)
    }
    case 'settings': {
      const [what = '', ...rest] = args.split(/\s+/)
      const value = rest.join(' ')
      switch (what) {
        case '': {
          const theme = await api.appearance.get()
          const model = claudeModels.find((m) => m.id === settings?.model)
          return info(
            [
              `Theme: ${theme ? theme.name : 'system default'} – /settings theme <need>`,
              `Model: ${model?.label ?? 'unknown'} – /settings model haiku|sonnet|opus`,
              `Page access: ${settings?.pageAccess ? 'on' : 'off'} – /settings page-access on|off`,
              `History access: ${settings?.historyAccess === false ? 'off' : 'on'} – /settings history-access on|off`,
            ].join('\n'),
          )
        }
        case 'theme': {
          if (value === 'default') {
            await api.appearance.set(null)
            return info('Theme: system default.')
          }
          const need = themeNeeds.find((n) => n.name === value)
          await api.appearance.requestOpen({ description: need?.description ?? value })
          return { close: true }
        }
        case 'model':
        case 'page-access':
        case 'history-access':
          return runCommand(what, value, { skills, settings, resolveArgs })
        default:
          return error(
            `No setting ${what}. Use /settings theme, model, page-access or history-access.`,
          )
      }
    }
    case 'menu': {
      if (!args) {
        const menus = await api.menu.items()
        return info(`Pick a menu: ${menus.map((menu) => `/menu ${menu.name}`).join(', ')}.`)
      }
      const result = await api.menu.run(args.split(/\s+/))
      if (!result.ok) return error(result.error)
      return { close: true }
    }
    case 'skills': {
      const saved = skills.filter((skill) => !skill.builtin)
      return info(
        saved.length === 0
          ? 'No macros yet. Ask the assistant, e.g. "open a new stack and store it as /ns".'
          : saved
              .map(
                (skill) =>
                  `${signatureOf(skill)}${skill.description ? ` – ${skill.description}` : ''}`,
              )
              .join('\n'),
      )
    }
    case 'config':
      await api.skills.requestConfig()
      return { close: true }
    case 'forget':
      if (!skills.some((skill) => skill.name === args && !skill.builtin)) {
        return error(`No macro /${args}.`)
      }
      await api.skills.delete(args)
      return info(`Deleted /${args}.`)
    case 'forget-history':
      await api.prompt.clearHistory()
      return info('Prompt history cleared.')
    case 'history':
      await api.history.requestOpen({ query: args })
      return { close: true }
    case 'recall':
      await api.history.requestRecall(args)
      return { close: true }
    case 'history-map':
      await api.history.requestMap()
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
  }

  const skill = skills.find((candidate) => candidate.name === name)
  if (!skill) {
    const names = [...promptCommands.map((c) => c.name), ...skills.map((s) => s.name)]
    const close = names.filter((candidate) => name && candidate.startsWith(name[0]!)).slice(0, 4)
    return error(
      `Unknown command /${name}.${close.length ? ` Did you mean ${close.map((c) => `/${c}`).join(', ')}?` : ''}`,
    )
  }
  const result = await api.skills.run(skill.name, skill.builtin ? args : await resolveArgs(args))
  if (!result.ok) return error(result.error ?? `/${skill.name} failed.`)
  return skill.builtin ? { close: true } : {}
}
