import type { ReactNode } from 'react'
import { useAgentState } from './useAgentState'

/** Draws an accent frame around the page area while the assistant drives the page. */
export function ActingFrame({ children }: { children: ReactNode }) {
  const state = useAgentState()
  const acting = state !== null && state.status !== 'idle'
  return (
    <div className={`acting-frame${acting ? ' acting' : ''}`} data-testid="acting-frame">
      {children}
    </div>
  )
}
