import { useCallback, useEffect, useState } from 'react'

// Fetches on mount and again whenever one of `deps` changes, so a sheet updates live with the layout or session.
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let live = true
    load().then(
      value => {
        if (live) setData(value)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [...deps, nonce])
  const reload = useCallback(() => setNonce(n => n + 1), [])
  return { data, reload }
}
