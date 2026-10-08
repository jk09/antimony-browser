import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { promptCommands, type CommandInfo } from '../../prompt/ipc'
import type { Skill, SkillStep } from '../ipc'
import { paramLabel } from '../shared/params'

const matches = (filter: string, name: string, description: string) => {
  const wanted = filter.trim().toLowerCase()
  return (
    !wanted || name.toLowerCase().includes(wanted) || description.toLowerCase().includes(wanted)
  )
}

/** A step as `tool {input}`, `{{param}}` placeholders marked. */
function Step({ step }: { step: SkillStep }) {
  const input = Object.keys(step.input).length > 0 ? ` ${JSON.stringify(step.input)}` : ''
  return (
    <code>
      <span className="config-tool">{step.tool}</span>
      {input
        .split(/(\{\{\w+\}\})/)
        .map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))}
    </code>
  )
}

function Script({ steps }: { steps: SkillStep[] }) {
  return (
    <ol className="config-script" aria-label="Script">
      {steps.map((step, index) => (
        <li key={index}>
          <Step step={step} />
        </li>
      ))}
    </ol>
  )
}

function Command({ command }: { command: CommandInfo }) {
  return (
    <li className="config-item">
      <div className="config-name">
        <code>/{command.name}</code>
        {command.usage && <span className="config-usage">{command.usage}</span>}
      </div>
      <p>{command.description}</p>
      <p className="config-note">Built into the browser; no script.</p>
    </li>
  )
}

function SkillItem({ skill, onDelete }: { skill: Skill; onDelete?: () => void }) {
  return (
    <li className="config-item">
      <div className="config-name">
        <code>/{skill.name}</code>
        {skill.params.length > 0 && (
          <span className="config-usage">{skill.params.map(paramLabel).join(' ')}</span>
        )}
        {onDelete && (
          <button type="button" aria-label={`Delete /${skill.name}`} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
      {skill.description && <p>{skill.description}</p>}
      {skill.params.length > 0 && (
        <dl className="config-params">
          {skill.params.map((param) => (
            <div key={param.name}>
              <dt>{param.name}</dt>
              <dd>{param.hint || '–'}</dd>
            </div>
          ))}
        </dl>
      )}
      <Script steps={skill.steps} />
    </li>
  )
}

/**
 * The configuration page: every system /command, the built-in skills and the user's macros with
 * the steps they replay, over the page area (the page view is hidden meanwhile). Opened by
 * /config, closed with × or Escape. Macros can be deleted here, not created or changed.
 */
export function ConfigView() {
  const api = window.antimony
  const [open, setOpen] = useState(false)
  const [skills, setSkills] = useState<Skill[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      api.skills.onOpenConfig(() => {
        setOpen(true)
        setError(null)
        api.skills
          .list()
          .then(setSkills)
          .catch((reason: unknown) => console.error(reason))
      }),
    [api],
  )
  useEffect(() => api.skills.onListChanged(setSkills), [api])
  useEffect(() => {
    if (open) field.current?.focus()
  }, [open])

  if (!open) return null

  const close = () => {
    setOpen(false)
    setFilter('')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }
  const remove = (name: string) => {
    setError(null)
    api.skills.delete(name).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const commands = promptCommands.filter((c) => matches(filter, c.name, c.description))
  const shown = skills.filter((s) => matches(filter, s.name, s.description))
  const builtins = shown.filter((skill) => skill.builtin)
  const macros = shown.filter((skill) => !skill.builtin)
  const nothing = commands.length + shown.length === 0

  return (
    <section className="config-view" aria-label="Configuration" onKeyDown={onKeyDown}>
      <header className="config-header">
        <h2>Configuration</h2>
        <button
          type="button"
          className="assistant-hide"
          aria-label="Close configuration"
          onClick={close}
        >
          ×
        </button>
      </header>
      <input
        ref={field}
        type="search"
        className="config-filter"
        aria-label="Filter commands and skills"
        placeholder="Filter by name or description"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {error && (
        <p className="config-notice error" role="alert">
          {error}
        </p>
      )}
      {nothing && <p className="config-notice">Nothing matches.</p>}
      <div className="config-body">
        {(commands.length > 0 || builtins.length > 0) && (
          <section aria-labelledby="config-system">
            <h3 id="config-system">System</h3>
            <ul className="config-list">
              {commands.map((command) => (
                <Command key={command.name} command={command} />
              ))}
              {builtins.map((skill) => (
                <SkillItem key={skill.name} skill={skill} />
              ))}
            </ul>
          </section>
        )}
        {(macros.length > 0 || !filter.trim()) && (
          <section aria-labelledby="config-macros">
            <h3 id="config-macros">Your macros</h3>
            {macros.length === 0 ? (
              <p className="config-notice">
                No macros yet. Ask the assistant: “… and store it as /name”.
              </p>
            ) : (
              <ul className="config-list">
                {macros.map((skill) => (
                  <SkillItem key={skill.name} skill={skill} onDelete={() => remove(skill.name)} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </section>
  )
}
