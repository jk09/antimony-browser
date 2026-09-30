import { useEffect, useState, type FormEvent } from 'react'
import type { SkillStep } from '../ipc'
import { extractParams, NAME_PATTERN, signature } from '../shared/params'

/**
 * Form opened by /save or "Save as skill": the last run's replayable steps, with editable
 * arguments. `{{name}}` in an argument makes it a parameter of the skill.
 */
export function SaveSkill() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState<SkillStep[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () =>
      window.antimony.skills.onSaveRequested((requested) => {
        window.antimony.skills
          .draft()
          .then((draft) => {
            setName(requested)
            setDescription('')
            setSteps(draft)
            setError(
              draft.length === 0
                ? 'Nothing to save: the last assistant run didn’t navigate or act on the page.'
                : null,
            )
            setOpen(true)
          })
          .catch((reason: unknown) => console.error(reason))
      }),
    [],
  )

  if (!open) return null

  const params = extractParams(steps)
  const setInput = (index: number, key: string, value: string) =>
    setSteps((current) =>
      current.map((step, i) =>
        i === index ? { ...step, input: { ...step.input, [key]: value } } : step,
      ),
    )

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!NAME_PATTERN.test(name)) {
      setError('Name: lowercase letters, digits and -, starting with a letter (up to 32).')
      return
    }
    window.antimony.skills
      .save({ name, description, steps })
      .then(() => setOpen(false))
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message.replace(/^Error invoking remote method '[^']+': (TypeError: )?/, '')
            : String(reason),
        ),
      )
  }

  return (
    <form className="save-skill-form" aria-label="Save as skill" onSubmit={save}>
      <h2>Save as skill</h2>
      <div className="save-skill-fields">
        <label>
          Name
          <span className="save-skill-slash">
            /
            <input
              value={name}
              onChange={(event) => setName(event.target.value.toLowerCase())}
              placeholder="my-skill"
              autoFocus
              spellCheck={false}
            />
          </span>
        </label>
        <label>
          Description
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
      </div>
      <ol className="save-skill-steps">
        {steps.map((step, index) => (
          <li key={index}>
            <code>{step.tool}</code>
            {Object.entries(step.input).map(([key, value]) =>
              typeof value === 'string' ? (
                <label key={key}>
                  {key}
                  <input
                    value={value}
                    onChange={(event) => setInput(index, key, event.target.value)}
                    spellCheck={false}
                  />
                </label>
              ) : (
                <span key={key}>
                  {key}: {String(value)}
                </span>
              ),
            )}
          </li>
        ))}
      </ol>
      <p className="save-skill-hint">
        Replace a value with <code>{'{{name}}'}</code> to make it a parameter.
        {params.length > 0 && name && (
          <>
            {' '}
            Usage: <code>{signature({ name, params })}</code>
          </>
        )}
      </p>
      {error && (
        <p className="save-skill-error" role="alert">
          {error}
        </p>
      )}
      <div className="save-skill-buttons">
        <button type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" disabled={steps.length === 0}>
          Save
        </button>
      </div>
    </form>
  )
}
