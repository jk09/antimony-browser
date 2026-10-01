import { useEffect, useState } from 'react'
import type { AgentState } from '../ipc'

/** The conversation and run status, kept up to date from main. */
export function useAgentState(): AgentState | null {
  const [state, setState] = useState<AgentState | null>(null)
  useEffect(() => {
    let live = true
    window.antimony.agent
      .state()
      .then((initial) => live && setState((current) => current ?? initial))
      .catch((reason: unknown) => console.error(reason))
    const unsubscribe = window.antimony.agent.onStateChanged(setState)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  return state
}
