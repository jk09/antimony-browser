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
      <span className="skills-tool">{step.tool}</span>
      {input
        .split(/(\{\{\w+\}\})/)
        .map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part))}
    </code>
  )
}

function Script({ steps }: { steps: SkillStep[] }) {
  return (
    <ol className="skills-script" aria-label="Script">
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
    <li className="skills-item">
      <div className="skills-name">
        <code>/{command.name}</code>
        {command.usage && <span className="skills-usage">{command.usage}</span>}
      </div>
      <p>{command.description}</p>
      <p className="skills-note">Built into the browser; no script.</p>
    </li>
  )
}

function SkillItem({ skill, onDelete }: { skill: Skill; onDelete?: () => void }) {
  return (
    <li className="skills-item">
      <div className="skills-name">
        <code>/{skill.name}</code>
        <span className="skills-tag" title="Replays its steps without calling the model">
          macro
        </span>
        {skill.params.length > 0 && (
          <span className="skills-usage">{skill.params.map(paramLabel).join(' ')}</span>
        )}
        {onDelete && (
          <button type="button" aria-label={`Delete /${skill.name}`} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
      {skill.description && <p>{skill.description}</p>}
      {skill.params.length > 0 && (
        <dl className="skills-params">
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
 * The skills page: every system /command, the built-in skills and the user's macros with the
 * steps they replay, over the page area (the page view is hidden meanwhile). Opened by
 * /skills, closed with × or Escape. Macros can be deleted here, not created or changed.
 */
export function SkillsView() {
  const api = window.antimony
  const [open, setOpen] = useState(false)
  const [skills, setSkills] = useState<Skill[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      api.skills.onOpen(() => {
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
    <section className="skills-view" aria-label="Skills" onKeyDown={onKeyDown}>
      <header className="skills-header">
        <h2>Skills</h2>
        <button type="button" className="assistant-hide" aria-label="Close skills" onClick={close}>
          ×
        </button>
      </header>
      <input
        ref={field}
        type="search"
        className="skills-filter"
        aria-label="Filter commands and skills"
        placeholder="Filter by name or description"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {error && (
        <p className="skills-notice error" role="alert">
          {error}
        </p>
      )}
      {nothing && <p className="skills-notice">Nothing matches.</p>}
      <div className="skills-body">
        {(commands.length > 0 || builtins.length > 0) && (
          <section className="skills-group skills-system" aria-labelledby="skills-system">
            <h3 id="skills-system">System</h3>
            <ul className="skills-list">
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
          <section className="skills-group" aria-labelledby="skills-macros">
            <h3 id="skills-macros">Your macros</h3>
            {macros.length === 0 ? (
              <p className="skills-notice">
                No macros yet. Ask the assistant: “… and store it as /name”.
              </p>
            ) : (
              <ul className="skills-list">
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
