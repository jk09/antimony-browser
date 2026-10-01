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

/** The assistant conversation shown in the prompt card, with approvals and "Save as skill". */
export function Conversation() {
  const state = useAgentState()
  const list = useRef<HTMLOListElement>(null)
  const items = state?.items ?? []

  useEffect(() => {
    const element = list.current
    if (element) element.scrollTop = element.scrollHeight
  }, [items.length, state?.status])

  if (!state || (items.length === 0 && !state.approval)) return null
  const decide = (decision: Decision) => {
    window.antimony.agent.approve(decision).catch((reason: unknown) => console.error(reason))
  }
  return (
    <section className="conversation" aria-label="Conversation">
      <ol ref={list} className="conversation-items">
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
      {state.status === 'idle' && state.savableSteps > 0 && (
        <button
          type="button"
          className="save-skill"
          onClick={() =>
            window.antimony.skills.requestSave().catch((reason: unknown) => console.error(reason))
          }
        >
          Save as skill ({state.savableSteps} step{state.savableSteps === 1 ? '' : 's'})
        </button>
      )}
    </section>
  )
}
