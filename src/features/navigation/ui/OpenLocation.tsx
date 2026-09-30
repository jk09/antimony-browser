import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { toUrl } from '../shared/to-url'

/** Text box shown in the toolbar by File → Open Location…; Enter loads, Escape hides it. */
export function OpenLocation() {
  const [open, setOpen] = useState(false)
  const [requests, setRequests] = useState(0)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      window.antimony.navigation.onOpenLocation(() => {
        setOpen(true)
        setRequests((n) => n + 1)
      }),
    [],
  )

  // Focus on every request, also when the box is already open.
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    input.current?.select()
  }, [open, requests])

  const close = () => {
    setOpen(false)
    setText('')
    setError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const url = toUrl(text)
    if (url === null) {
      setError('Enter a web address, like example.com or https://example.com')
      return
    }
    close()
    window.antimony.navigation.go(url).catch((reason: unknown) => console.error(reason))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }

  if (!open) return null
  return (
    <form className="open-location" onSubmit={submit}>
      <input
        ref={input}
        type="text"
        aria-label="Location"
        placeholder="Enter a web address"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error !== null}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setError(null)
        }}
        onKeyDown={onKeyDown}
      />
      {error !== null && (
        <span className="open-location-error" role="alert">
          {error}
        </span>
      )}
    </form>
  )
}
