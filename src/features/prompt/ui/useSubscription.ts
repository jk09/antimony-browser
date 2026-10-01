import { useEffect, useState } from 'react'

/** A value loaded once from main and kept up to date by its change events. */
export function useSubscription<T>(
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
