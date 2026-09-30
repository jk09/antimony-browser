import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { models, type AgentSettings, type AgentState, type Attachment } from '../../agent/ipc'
import type { NavigationState } from '../../navigation/ipc'
import type { Skill } from '../../skills/ipc'
import { promptCommands, type HistoryEntry } from '../ipc'
import { classify } from '../shared/classify'
import { historyText } from '../shared/history'
import { suggest, type SuggestCommand, type Suggestion } from '../shared/suggest'
import { imageUrl, isLongPaste, readImages } from './attachments'
import { runCommand } from './commands'
import { suggestionId, SuggestionList } from './SuggestionList'

type Message = { kind: 'error' | 'info'; text: string }

const MAX_INPUT_HEIGHT = 200

function useSubscription<T>(
  load: () => Promise<T>,
  subscribe: (listener: (value: T) => void) => () => void,
): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let live = true
    load()
      .then((initial) => live && setValue((current) => current ?? initial))
      .catch((reason: unknown) => console.error(reason))
    const unsubscribe = subscribe(setValue)
    return () => {
      live = false
      unsubscribe()
    }
    // load and subscribe are stable bridge functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return value
}

/**
 * The prompt: Ctrl/Cmd+L expands a Claude-style card in the toolbar. URLs and /commands are
 * handled without the model; everything else goes to the assistant.
 */
export function Prompt({ conversation }: { conversation?: ReactNode }) {
  const api = window.antimony
  const [open, setOpen] = useState(false)
  const [requests, setRequests] = useState(0)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [preview, setPreview] = useState<number | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [keyMode, setKeyMode] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selected, setSelected] = useState(-1)
  const [listHidden, setListHidden] = useState(false)
  const [recall, setRecall] = useState(-1)
  const input = useRef<HTMLTextAreaElement>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)

  const [navigation, setNavigation] = useState<NavigationState | null>(null)
  useEffect(() => api.navigation.onStateChanged(setNavigation), [api])
  const agent = useSubscription<AgentState>(api.agent.state, api.agent.onStateChanged)
  const settings = useSubscription<AgentSettings>(api.agent.settings, api.agent.onSettingsChanged)
  const skillList = useSubscription<Skill[]>(api.skills.list, api.skills.onListChanged)
  const skills = useMemo(() => skillList ?? [], [skillList])
  const running = agent !== null && agent.status !== 'idle'

  useEffect(
    () =>
      api.prompt.onOpen(() => {
        setOpen(true)
        setRequests((n) => n + 1)
      }),
    [api],
  )

  // An approval is asked in the conversation, so the card stays expanded while one is pending.
  const expanded = open || agent?.status === 'awaiting-approval'

  // Load history on every open, and focus on every request (also when already open).
  useEffect(() => {
    if (!expanded) return
    api.prompt
      .history()
      .then(setHistory)
      .catch((reason: unknown) => console.error(reason))
    ;(keyMode ? keyInput : input).current?.focus()
    input.current?.select()
  }, [api, expanded, requests, keyMode])

  // Grow the text area with its content, up to a limit.
  useEffect(() => {
    const area = input.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(area.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [text, expanded])

  const commands = useMemo<SuggestCommand[]>(() => {
    const saved = skills.filter((skill) => !skill.builtin).map((skill) => skill.name)
    return [
      ...promptCommands.map((command) =>
        command.name === 'forget' ? { ...command, options: saved } : command,
      ),
      ...skills.map((skill) => ({
        name: skill.name,
        usage: skill.params.map((param) => `<${param}>`).join(' '),
        description: skill.description || (skill.builtin ? 'Built-in skill' : 'Saved skill'),
      })),
    ].sort((a, b) => a.name.localeCompare(b.name))
  }, [skills])

  const suggestions = useMemo(
    () => (listHidden || recall !== -1 ? [] : suggest(text, history, commands)),
    [text, history, commands, listHidden, recall],
  )

  const edit = (value: string) => {
    setText(value)
    setMessage(null)
    setSelected(-1)
    setListHidden(false)
    setRecall(-1)
  }

  const close = () => {
    setOpen(false)
    setKeyMode(false)
    setMessage(null)
    setPreview(null)
    setSelected(-1)
    setRecall(-1)
  }

  const record = (kind: HistoryEntry['kind'], value: string) => {
    api.prompt.record({ kind, text: value }).catch((reason: unknown) => console.error(reason))
  }

  const addAttachments = (added: Attachment[], error: string | null) => {
    setAttachments((current) => [...current, ...added])
    if (error) setMessage({ kind: 'error', text: error })
  }

  const submit = async (value = text) => {
    const parsed = classify(value, {
      hasAttachments: attachments.length > 0,
      toUrl: api.navigation.toUrl,
    })
    try {
      switch (parsed.kind) {
        case 'empty':
          return
        case 'url':
          record('url', parsed.url)
          setText('')
          close()
          await api.navigation.go(parsed.url)
          return
        case 'query':
          if (running) {
            setMessage({ kind: 'error', text: 'Stop the current run first (Esc).' })
            return
          }
          if (!settings?.hasKey) {
            setMessage({ kind: 'error', text: 'No Anthropic API key yet. Type /key to add one.' })
            return
          }
          if (parsed.text) record('query', parsed.text)
          await api.agent.run({ text: parsed.text, attachments })
          setText('')
          setAttachments([])
          setPreview(null)
          return
        case 'command': {
          record('command', historyText(value))
          setText('')
          const result = await runCommand(parsed.name, parsed.args, { skills, settings })
          setMessage(result.message ?? null)
          if (result.keyMode) setKeyMode(true)
          if (result.close) close()
          return
        }
      }
    } catch (reason) {
      setMessage({ kind: 'error', text: reason instanceof Error ? reason.message : String(reason) })
    }
  }

  const accept = (suggestion: Suggestion, andSubmit: boolean) => {
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
        if (!listed) return
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
        else if (running) void api.agent.stop()
        else close()
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
      <button type="button" className="prompt-stop" onClick={() => void api.agent.stop()}>
        Stop
      </button>
    </span>
  ) : null

  if (!expanded) {
    const title = navigation?.title || navigation?.url
    return (
      <div className="prompt-collapsed">
        <button
          type="button"
          className="prompt-bar"
          aria-label="Open prompt"
          onClick={() => {
            setOpen(true)
            setRequests((n) => n + 1)
          }}
        >
          {title ? (
            <>
              <span className="prompt-bar-title">{navigation?.title || navigation?.url}</span>
              {navigation?.title && <span className="prompt-bar-url">{navigation.url}</span>}
            </>
          ) : (
            <span className="prompt-bar-placeholder">
              Ask, type a URL, or / for skills (Ctrl+L)
            </span>
          )}
        </button>
        {status}
      </div>
    )
  }

  const hasInput = text.trim() !== '' || attachments.length > 0
  return (
    <div
      className="prompt-card"
      role="group"
      aria-label="Prompt"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {conversation}
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
        <textarea
          ref={input}
          className="prompt-input"
          aria-label="Prompt"
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
      )}
      {suggestions.length > 0 && !keyMode && (
        <SuggestionList
          suggestions={suggestions}
          selected={selected}
          onPick={(suggestion) => accept(suggestion, true)}
        />
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
        <select
          className="prompt-model"
          aria-label="Model"
          value={settings?.model ?? models[0].id}
          onChange={(event) =>
            void api.agent.updateSettings({ model: event.target.value as AgentSettings['model'] })
          }
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
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
