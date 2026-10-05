import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  claudeModels,
  cliClaudeModel,
  isCliModel,
  limits,
  type AgentSettings,
  type AgentState,
  type Attachment,
  type ModelInfo,
  type ModelList,
} from '../../agent/ipc'
import type { VisitedSuggestion } from '../../history/ipc'
import type { MenuEntry } from '../../menu/ipc'
import type { Skill } from '../../skills/ipc'
import { argumentHint } from '../../skills/shared/params'
import type { StackPages, StacksState } from '../../stacks/ipc'
import { promptCommands, type HistoryEntry } from '../ipc'
import { classify } from '../shared/classify'
import { historyText } from '../shared/history'
import {
  MENTION_LIMIT,
  mentionOnly,
  mentionTyped,
  resolveRefs,
  stackRefs,
  suggest,
  suggestMentions,
  withVisited,
  type OptionNode,
  type SuggestCommand,
  type Suggestion,
} from '../shared/suggest'
import { imageUrl, isLongPaste, readImages } from './attachments'
import { runCommand } from './commands'
import { suggestionId, SuggestionList } from './SuggestionList'
import { useSubscription } from './useSubscription'

type Message = { kind: 'error' | 'info'; text: string }

const MAX_INPUT_HEIGHT = 200

/** The application menu as `/menu`'s nested arguments; disabled items say so. */
const menuOptions = (entries: MenuEntry[]): OptionNode[] =>
  entries.map((entry) => ({
    name: entry.name,
    label: entry.label,
    ...((entry.accelerator || !entry.enabled) && {
      detail: entry.enabled ? entry.accelerator : 'Disabled',
    }),
    ...(entry.children && { children: menuOptions(entry.children) }),
  }))

/** How long a handed-over entry stays visible in the prompt before it runs: just long enough to see. */
export const HANDOFF_MS = 140

/** What the field of view hands to the sidebar prompt. */
export interface Handoff {
  /** Distinguishes one handoff from the next, so the same text can be sent twice. */
  id: number
  text: string
  attachments: Attachment[]
}

/** Makes a prompt a composer: Enter sends the entry on instead of running it. */
export interface Compose {
  onSend: (entry: { text: string; attachments: Attachment[] }) => void
  /** Escape with no suggestions open. */
  onEscape: () => void
}

/**
 * The prompt: a Claude-style card at the bottom of the assistant panel. URLs and /commands are
 * handled without the model; everything else goes to the assistant. `focusRequest` changes on
 * every Ctrl/Cmd+L, which focuses the input and selects its text. As a composer (the field of
 * view) it only collects the entry; a new `handoff` makes it run an entry composed elsewhere.
 */
export function Prompt({
  focusRequest = 0,
  compose,
  handoff,
}: {
  focusRequest?: number
  compose?: Compose
  handoff?: Handoff | null
}) {
  const api = window.antimony
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [preview, setPreview] = useState<number | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [keyMode, setKeyMode] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selected, setSelected] = useState(-1)
  const [listHidden, setListHidden] = useState(false)
  const [recall, setRecall] = useState(-1)
  const [visited, setVisited] = useState<{ text: string; pages: VisitedSuggestion[] }>({
    text: '',
    pages: [],
  })
  const input = useRef<HTMLTextAreaElement>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)

  const agent = useSubscription<AgentState>(api.agent.state, api.agent.onStateChanged)
  const settings = useSubscription<AgentSettings>(api.agent.settings, api.agent.onSettingsChanged)
  const skillList = useSubscription<Skill[]>(api.skills.list, api.skills.onListChanged)
  const skills = useMemo(() => skillList ?? [], [skillList])
  const stackState = useSubscription<StacksState>(api.stacks.state, api.stacks.onChanged)
  const stacks = useMemo(() => stackState?.stacks ?? [], [stackState])
  // Every stack's pages for `@`, fetched while an `@word` is typed, until stacks change.
  const [pageCache, setPageCache] = useState<{ for: StacksState | null; pages: StackPages[] }>({
    for: null,
    pages: [],
  })
  const stackPages = useMemo<StackPages[] | null>(
    () => (pageCache.for !== null && pageCache.for === stackState ? pageCache.pages : null),
    [pageCache, stackState],
  )
  const [modelList, setModelList] = useState<ModelList | null>(null)
  const [menu, setMenu] = useState<MenuEntry[]>([])
  const running = agent !== null && agent.status !== 'idle'

  // Asks Ollama which models are installed; the picker shows the Claude models meanwhile.
  const refreshModels = useCallback(() => {
    api.agent
      .models()
      .then(setModelList)
      .catch((reason: unknown) => console.error(reason))
  }, [api])

  // Load history and models, and focus, at start and on every request.
  useEffect(() => {
    api.prompt
      .history()
      .then(setHistory)
      .catch((reason: unknown) => console.error(reason))
    api.menu
      .items()
      .then(setMenu)
      .catch((reason: unknown) => console.error(reason))
    refreshModels()
    ;(keyMode ? keyInput : input).current?.focus()
    input.current?.select()
  }, [api, focusRequest, keyMode, refreshModels])

  // Grow the text area with its content, up to a limit.
  useEffect(() => {
    const area = input.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(area.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [text])

  const commands = useMemo<SuggestCommand[]>(() => {
    const saved = skills.filter((skill) => !skill.builtin).map((skill) => skill.name)
    return [
      ...promptCommands.map((command) =>
        command.name === 'forget'
          ? { ...command, options: saved }
          : command.name === 'menu'
            ? { ...command, tree: menuOptions(menu) }
            : command.name === 'model' && modelList
              ? {
                  ...command,
                  options: [
                    ...(command.options ?? []),
                    ...('models' in modelList.cli ? modelList.cli.models.map((m) => m.id) : []),
                    ...('models' in modelList.ollama
                      ? modelList.ollama.models.map((m) => m.id)
                      : []),
                  ],
                }
              : command,
      ),
      ...skills.map((skill) => ({
        name: skill.name,
        usage: skill.params.map((param) => `<${param.name}>`).join(' '),
        description: skill.description || (skill.builtin ? 'Built-in skill' : 'Macro'),
      })),
    ].sort((a, b) => a.name.localeCompare(b.name))
  }, [skills, modelList, menu])

  // Pages from browsing history whose address starts with what's typed.
  useEffect(() => {
    const typed = text.trim()
    if (!typed || typed.startsWith('/') || typed.startsWith('?') || /\s/.test(typed)) return
    let stale = false
    api.history
      .suggest(typed)
      .then((pages) => {
        if (!stale) setVisited({ text, pages })
      })
      .catch((reason: unknown) => console.error(reason))
    return () => {
      stale = true
    }
  }, [api, text])

  // Macros with parameters take `@` references as arguments.
  const macroNames = useMemo(
    () =>
      new Set(
        skills.filter((skill) => !skill.builtin && skill.params.length > 0).map((s) => s.name),
      ),
    [skills],
  )
  const inMacro = useCallback((name: string) => macroNames.has(name), [macroNames])
  const mentioning = mentionTyped(text, inMacro) !== null
  useEffect(() => {
    if (!mentioning || stackPages !== null || stackState === null) return
    let stale = false
    api.stacks
      .pages()
      .then((pages) => {
        if (!stale) setPageCache({ for: stackState, pages })
      })
      .catch((reason: unknown) => console.error(reason))
    return () => {
      stale = true
    }
  }, [api, mentioning, stackPages, stackState])

  // Until the pages arrive, `@` lists the stacks alone.
  const mentionTargets = useMemo<StackPages[]>(
    () =>
      stackPages ??
      stacks.map((stack) => ({
        id: stack.id,
        name: stack.name,
        rootTitle: stack.rootTitle,
        rows: [],
        activeId: null,
      })),
    [stackPages, stacks],
  )

  const { suggestions, more } = useMemo(() => {
    if (listHidden || recall !== -1) return { suggestions: [], more: 0 }
    const mentions = suggestMentions(text, mentionTargets, MENTION_LIMIT, inMacro)
    if (mentions.items.length > 0) return { suggestions: mentions.items, more: mentions.more }
    return {
      suggestions: withVisited(
        suggest(text, history, commands),
        visited.text === text ? visited.pages : [],
        text,
      ),
      more: 0,
    }
  }, [text, history, commands, listHidden, recall, visited, mentionTargets, inMacro])

  // While a macro is typed, its parameters still to type, shown faintly after the text.
  const hint = useMemo(() => {
    const typed = /^\/([a-z][a-z0-9-]*)([^\n]*)$/.exec(text)
    const macro = typed && skills.find((skill) => skill.name === typed[1] && !skill.builtin)
    return macro ? argumentHint(macro.params, typed[2]!) : ''
  }, [text, skills])

  const edit = (value: string) => {
    setText(value)
    setMessage(null)
    setSelected(-1)
    setListHidden(false)
    setRecall(-1)
  }

  /** Clears what's left of the last input once it has been handled. */
  const reset = () => {
    setKeyMode(false)
    setMessage(null)
    setPreview(null)
    setSelected(-1)
    setRecall(-1)
  }

  // The panel stays open, so suggestions pick up each new entry right away.
  const record = (kind: HistoryEntry['kind'], value: string) => {
    api.prompt
      .record({ kind, text: value })
      .then(() => api.prompt.history())
      .then(setHistory)
      .catch((reason: unknown) => console.error(reason))
  }

  const addAttachments = (added: Attachment[], error: string | null) => {
    setAttachments((current) => [...current, ...added])
    if (error) setMessage({ kind: 'error', text: error })
  }

  /** Text attachments with the outline of each stack the text names with `@name`. */
  const stackAttachments = async (value: string): Promise<Attachment[]> => {
    const names = stackRefs(
      value,
      stacks.map((stack) => stack.name),
    )
    const outlines = await Promise.all(names.map((name) => api.stacks.outline(name)))
    return names.flatMap((name, index) => {
      const outline = outlines[index]
      return outline ? [{ kind: 'text' as const, name: `@${name}`, text: outline }] : []
    })
  }

  /** Switches to a stack, or opens one of its pages, without the model. */
  const goTo = async (target: NonNullable<Suggestion['target']>) => {
    if (running) {
      setMessage({ kind: 'error', text: 'Stop the current run first (Esc).' })
      return
    }
    record('command', target.reference)
    setText('')
    reset()
    try {
      if (target.nodeId === undefined) await api.stacks.switch(target.stackId)
      else await api.stacks.openPage(target.stackId, target.nodeId)
    } catch (reason) {
      setMessage({
        kind: 'error',
        text: reason instanceof Error ? reason.message : String(reason),
      })
    }
  }

  /** The stack or page an `@name` or `@name/ref` names, or null. */
  const resolveMention = async (
    value: string,
  ): Promise<NonNullable<Suggestion['target']> | null> => {
    const alone = /^@([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(value.trim())
    if (!alone) return null
    const [reference, name, ref] = alone
    if (ref === undefined) {
      const stack = stacks.find((candidate) => candidate.name === name)
      return stack ? { stackId: stack.id, reference } : null
    }
    // A handed-over entry can arrive before this prompt has the pages.
    const pages = stackPages ?? (await api.stacks.pages())
    const stack = pages.find((candidate) => candidate.name === name)
    const row = stack?.rows.find((candidate) => candidate.ref === ref)
    return stack && row ? { stackId: stack.id, nodeId: row.id, reference } : null
  }

  const submit = async (value = text, entered = attachments) => {
    if (compose) {
      if (value.trim() === '' && entered.length === 0) return
      compose.onSend({ text: value, attachments: entered })
      return
    }
    // `@name` or `@name/ref` alone goes there, without the model.
    const mentioned = await resolveMention(value)
    if (mentioned) {
      await goTo(mentioned)
      return
    }
    const parsed = classify(value, {
      hasAttachments: entered.length > 0,
      toUrl: api.navigation.toUrl,
    })
    try {
      switch (parsed.kind) {
        case 'empty':
          return
        case 'url':
          record('url', parsed.url)
          setText('')
          reset()
          await api.navigation.go(parsed.url)
          return
        case 'query': {
          if (running) {
            setMessage({ kind: 'error', text: 'Stop the current run first (Esc).' })
            return
          }
          if ((settings?.provider ?? 'anthropic') === 'anthropic' && !settings?.hasKey) {
            setMessage({
              kind: 'error',
              text: 'No Anthropic API key yet. Type /key to add one, or pick a Claude Code CLI or Ollama model.',
            })
            return
          }
          const referenced = await stackAttachments(parsed.text)
          if (entered.length + referenced.length > limits.attachments) {
            setMessage({ kind: 'error', text: `At most ${limits.attachments} attachments.` })
            return
          }
          if (parsed.text) record('query', parsed.text)
          await api.agent.run({ text: parsed.text, attachments: [...entered, ...referenced] })
          setText('')
          setAttachments([])
          setPreview(null)
          return
        }
        case 'command': {
          record('command', historyText(value))
          setText('')
          const result = await runCommand(parsed.name, parsed.args, {
            skills,
            settings,
            // `@stack` and `@stack/ref` arguments become the page's URL.
            resolveArgs: async (args) => {
              const names = stackRefs(
                args,
                stacks.map((stack) => stack.name),
              )
              if (names.length === 0) return args
              return resolveRefs(args, stackPages ?? (await api.stacks.pages()))
            },
          })
          setMessage(result.message ?? null)
          if (result.keyMode) setKeyMode(true)
          if (result.close) reset()
          return
        }
      }
    } catch (reason) {
      setMessage({ kind: 'error', text: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  // An entry composed in the field of view runs here, as if typed.
  const handled = useRef<number | null>(null)
  const latestSubmit = useRef(submit)
  useLayoutEffect(() => {
    latestSubmit.current = submit
  })
  useEffect(() => {
    if (!handoff || handled.current === handoff.id) return
    handled.current = handoff.id
    // The entry lands in the input first, then runs; a refused run leaves it there to edit.
    setText(handoff.text)
    setAttachments(handoff.attachments)
    setTimeout(() => void latestSubmit.current(handoff.text, handoff.attachments), HANDOFF_MS)
  }, [handoff])

  const accept = (suggestion: Suggestion, andSubmit: boolean) => {
    // A stack or page picked with nothing else typed goes there at once; else it's inserted.
    if (andSubmit && suggestion.target && mentionOnly(text)) {
      // The field of view hands the reference over; the sidebar prompt goes there.
      if (compose) compose.onSend({ text: suggestion.target.reference, attachments })
      else void goTo(suggestion.target)
      return
    }
    setText(suggestion.text)
    setSelected(-1)
    setListHidden(true)
    input.current?.focus()
    // A command that still needs arguments ends with a space: fill it in, don't run it yet.
    if (andSubmit && !suggestion.text.endsWith(' ')) void submit(suggestion.text)
    else setListHidden(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    const listed = suggestions.length > 0
    switch (event.key) {
      case 'Enter':
        if (event.shiftKey) return
        event.preventDefault()
        if (listed && selected >= 0) accept(suggestions[selected]!, true)
        else void submit()
        return
      case 'Tab':
        // Ctrl+Tab switches stacks.
        if (!listed || event.ctrlKey) return
        event.preventDefault()
        accept(suggestions[Math.max(selected, 0)]!, false)
        return
      case 'ArrowRight':
        if (listed && selected >= 0 && input.current?.selectionStart === text.length) {
          event.preventDefault()
          accept(suggestions[selected]!, false)
        }
        return
      case 'ArrowDown':
        if (listed) {
          event.preventDefault()
          setSelected((index) => (index + 1) % suggestions.length)
        } else if (recall !== -1) {
          event.preventDefault()
          const next = recall - 1
          setRecall(next)
          setText(next === -1 ? '' : history[next]!.text)
        }
        return
      case 'ArrowUp':
        if (listed) {
          event.preventDefault()
          setSelected((index) => (index <= 0 ? suggestions.length - 1 : index - 1))
        } else if ((text === '' || recall !== -1) && recall < history.length - 1) {
          // Like a shell: step back through what was submitted before.
          event.preventDefault()
          const next = recall + 1
          setRecall(next)
          setText(history[next]!.text)
        }
        return
      case 'Escape':
        event.preventDefault()
        if (listed) setListHidden(true)
        else if (compose) compose.onEscape()
        else if (running) void api.agent.stop()
        return
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.files)
    if (images.length > 0) {
      event.preventDefault()
      void readImages(images, attachments.length).then(({ attachments: added, error }) =>
        addAttachments(added, error),
      )
      return
    }
    const pasted = event.clipboardData.getData('text/plain')
    if (isLongPaste(pasted)) {
      event.preventDefault()
      addAttachments([{ kind: 'text', name: 'Pasted text', text: pasted }], null)
    }
  }

  const onDrop = (event: DragEvent) => {
    const dropped = Array.from(event.dataTransfer.files)
    if (dropped.length === 0) return
    event.preventDefault()
    void readImages(dropped, attachments.length).then(({ attachments: added, error }) =>
      addAttachments(added, error),
    )
  }

  const submitKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = keyInput.current?.value ?? ''
    api.agent
      .setKey(value)
      .then((saved) => {
        setKeyMode(false)
        setMessage({
          kind: 'info',
          text: saved.keyPersisted
            ? 'API key saved (encrypted).'
            : 'API key set for this session only (no system keyring).',
        })
      })
      .catch(() => setMessage({ kind: 'error', text: 'That does not look like an API key.' }))
  }

  const status = running ? (
    <span className="prompt-status" role="status">
      <span className="prompt-status-dot" aria-hidden="true" />
      {agent?.status === 'awaiting-approval'
        ? 'Waiting for your approval…'
        : 'Assistant is acting…'}
    </span>
  ) : null

  const hasInput = text.trim() !== '' || attachments.length > 0
  return (
    <div
      className="prompt-card"
      role="group"
      aria-label="Prompt"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {status}
      {message && (
        <p
          className={`prompt-message ${message.kind}`}
          role={message.kind === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
      {attachments.length > 0 && (
        <ul className="prompt-attachments" aria-label="Attachments">
          {attachments.map((attachment, index) => (
            <li key={index} className="prompt-chip">
              <button
                type="button"
                className="prompt-chip-open"
                onClick={() => setPreview(preview === index ? null : index)}
                aria-label={`Preview ${attachment.name}`}
              >
                {attachment.kind === 'image' ? (
                  <img src={imageUrl(attachment)} alt="" />
                ) : (
                  <span className="prompt-chip-text">
                    {attachment.name} · {attachment.text.split('\n').length} lines
                  </span>
                )}
              </button>
              <button
                type="button"
                className="prompt-chip-remove"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => {
                  setAttachments((current) => current.filter((_, i) => i !== index))
                  setPreview(null)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {preview !== null && attachments[preview] && (
        <div className="prompt-preview">
          {attachments[preview].kind === 'image' ? (
            <img src={imageUrl(attachments[preview])} alt={attachments[preview].name} />
          ) : (
            <pre>{attachments[preview].text}</pre>
          )}
        </div>
      )}
      {suggestions.length > 0 && !keyMode && (
        <SuggestionList
          suggestions={suggestions}
          more={more}
          selected={selected}
          onPick={(suggestion) => accept(suggestion, true)}
        />
      )}
      {keyMode ? (
        <form className="prompt-key" onSubmit={submitKey}>
          <input
            ref={keyInput}
            type="password"
            aria-label="Anthropic API key"
            placeholder="Paste your Anthropic API key and press Enter (Esc cancels)"
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setKeyMode(false)
                input.current?.focus()
              }
            }}
          />
        </form>
      ) : (
        <div className="prompt-input-wrap">
          {hint && (
            <div className="prompt-ghost" aria-hidden="true" data-testid="prompt-hint">
              <span className="prompt-ghost-typed">{text}</span>
              <span className="prompt-ghost-hint">{hint}</span>
            </div>
          )}
          <textarea
            ref={input}
            className="prompt-input"
            aria-label="Prompt"
            aria-description={hint ? `Arguments: ${hint.trim()}` : undefined}
            aria-autocomplete="list"
            aria-controls={suggestions.length > 0 ? 'prompt-suggestions' : undefined}
            aria-activedescendant={selected >= 0 ? suggestionId(selected) : undefined}
            placeholder="Ask, type a URL, or / for skills"
            rows={1}
            spellCheck={false}
            value={text}
            onChange={(event) => edit(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </div>
      )}
      <div className="prompt-row">
        <button
          type="button"
          className="prompt-icon"
          title="Attach images"
          aria-label="Attach images"
          onClick={() => files.current?.click()}
        >
          +
        </button>
        <input
          ref={files}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? [])
            event.target.value = ''
            void readImages(chosen, attachments.length).then(({ attachments: added, error }) =>
              addAttachments(added, error),
            )
          }}
        />
        <button
          type="button"
          className="prompt-icon"
          title="Skills and commands"
          aria-label="Skills and commands"
          onClick={() => {
            edit('/')
            input.current?.focus()
          }}
        >
          /
        </button>
        <button
          type="button"
          className="prompt-toggle"
          aria-pressed={settings?.pageAccess ?? false}
          title="Let the assistant read this page and, with your approval, act on it"
          onClick={() =>
            void api.agent.updateSettings({ pageAccess: !(settings?.pageAccess ?? false) })
          }
        >
          {settings?.pageAccess ? 'Page access on' : 'Page access off'}
        </button>
        <span className="prompt-spacer" />
        <ModelPicker
          value={settings?.model ?? claudeModels[0].id}
          list={modelList}
          onFocus={refreshModels}
          onChange={(model) => void api.agent.updateSettings({ model })}
        />
        {running ? (
          <button
            type="button"
            className="prompt-send stop"
            aria-label="Stop"
            title="Stop (Esc)"
            onClick={() => void api.agent.stop()}
          >
            ■
          </button>
        ) : (
          <button
            type="button"
            className="prompt-send"
            aria-label="Send"
            title="Send (Enter)"
            disabled={!hasInput}
            onClick={() => void submit()}
          >
            ↑
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Claude (API key), Claude Code CLI and Ollama models in three groups; the selected model always
 * shows, even if not listed.
 */
function ModelPicker({
  value,
  list,
  onFocus,
  onChange,
}: {
  value: AgentSettings['model']
  list: ModelList | null
  onFocus: () => void
  onChange: (model: AgentSettings['model']) => void
}) {
  const claude: ModelInfo[] = list?.claude ?? claudeModels.map(({ id, label }) => ({ id, label }))
  const cli: ModelInfo[] = list && 'models' in list.cli ? [...list.cli.models] : []
  const cliError = list && 'error' in list.cli ? list.cli.error : null
  const ollama: ModelInfo[] = list && 'models' in list.ollama ? [...list.ollama.models] : []
  const ollamaError = list && 'error' in list.ollama ? list.ollama.error : null
  if (![...claude, ...cli, ...ollama].some((model) => model.id === value)) {
    if (isCliModel(value)) {
      const base = claudeModels.find((model) => model.id === cliClaudeModel(value))
      cli.unshift({ id: value, label: `${base?.label ?? value} (Claude Code)` })
    } else {
      ollama.unshift({ id: value, label: `${value.replace(/^ollama:/, '')} (Ollama)` })
    }
  }
  return (
    <select
      className="prompt-model"
      aria-label="Model"
      value={value}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value as AgentSettings['model'])}
    >
      <optgroup label="Claude (API key)">
        {claude.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </optgroup>
      {(cli.length > 0 || cliError) && (
        <optgroup label="Claude Code CLI">
          {cli.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
          {cliError && (
            <option disabled value="">
              {cliError}
            </option>
          )}
        </optgroup>
      )}
      {(ollama.length > 0 || ollamaError) && (
        <optgroup label="Ollama">
          {ollama.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
          {ollamaError && (
            <option disabled value="">
              {ollamaError}
            </option>
          )}
        </optgroup>
      )}
    </select>
  )
}
