import { useEffect, useRef } from 'react'
import type { ConversationItem, Decision } from '../ipc'
import { useAgentState } from './useAgentState'

const statusIcon = { running: '…', ok: '✓', error: '✕', denied: '⊘' } as const
const decisionText: Record<Decision | 'stopped', string> = {
  allow: 'Allowed',
  'allow-run': 'Allowed for this run',
  deny: 'Denied',
  stopped: 'Stopped',
}

function Item({ item }: { item: ConversationItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <li className="turn user">
          <span className="turn-text">{item.text || '(attachments only)'}</span>
          {item.attachments.length > 0 && (
            <span className="turn-attachments">
              {item.attachments
                .map((a) => (a.kind === 'image' ? `🖼 ${a.name}` : `📄 ${a.name}`))
                .join(' · ')}
            </span>
          )}
        </li>
      )
    case 'assistant':
      return <li className="turn assistant">{item.text}</li>
    case 'tool':
      return (
        <li className={`turn tool ${item.status}`} title={item.detail}>
          <span aria-label={item.status}>{statusIcon[item.status]}</span> {item.summary}
          {item.detail && item.status !== 'ok' && (
            <span className="turn-detail"> – {item.detail}</span>
          )}
        </li>
      )
    case 'approval':
      // While pending, the approval box below the list asks the question.
      if (item.decision === null) return null
      return (
        <li className="turn approval">
          Approve: {item.description}
          {item.decision && <span className="turn-detail"> – {decisionText[item.decision]}</span>}
        </li>
      )
    case 'error':
      return <li className="turn error">{item.message}</li>
    case 'notice':
      return <li className="turn notice">{item.text}</li>
  }
}

/** How close to the bottom (px) still counts as "at the newest item". */
const STICK_DISTANCE = 24

/**
 * The assistant conversation, filling the assistant panel above the prompt, with approvals. It
 * follows new items unless the user has scrolled up; a new question follows again.
 */
export function Conversation() {
  const state = useAgentState()
  const list = useRef<HTMLOListElement>(null)
  const stick = useRef(true)
  const items = state?.items ?? []

  useEffect(() => {
    const element = list.current
    if (!element) return
    if (state?.items.at(-1)?.kind === 'user') stick.current = true
    if (stick.current) element.scrollTop = element.scrollHeight
  }, [state])

  // The prompt below grows (suggestions, attachments): keep the newest item in view.
  const listed = state !== null && (state.items.length > 0 || state.approval !== null)
  useEffect(() => {
    const element = list.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (stick.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [listed])

  if (!state || (items.length === 0 && !state.approval)) return null
  const decide = (decision: Decision) => {
    window.antimony.agent.approve(decision).catch((reason: unknown) => console.error(reason))
  }
  return (
    <section className="conversation" aria-label="Conversation">
      <ol
        ref={list}
        className="conversation-items"
        onScroll={(event) => {
          const element = event.currentTarget
          stick.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= STICK_DISTANCE
        }}
      >
        {items.map((item, index) => (
          <Item key={index} item={item} />
        ))}
      </ol>
      {state.approval && (
        <div
          className="approval"
          role="alertdialog"
          aria-label="Approve action"
          aria-live="assertive"
        >
          <p>
            The assistant wants to: <strong>{state.approval.description}</strong>
          </p>
          <div className="approval-buttons">
            <button type="button" onClick={() => decide('allow')} autoFocus>
              Allow
            </button>
            <button type="button" onClick={() => decide('allow-run')}>
              Allow for this run
            </button>
            <button type="button" onClick={() => decide('deny')}>
              Deny
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
