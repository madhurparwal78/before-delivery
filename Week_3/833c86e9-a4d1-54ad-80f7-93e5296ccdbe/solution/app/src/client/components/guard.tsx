import { useEffect } from 'react'
import { navigate, useLocation } from '../router'
import { useApp } from '../state'

/** True for a signed-in visitor; a signed-out one is sent to /signin and comes back here afterwards. */
export function useSignedIn(): boolean {
  const app = useApp()
  const loc = useLocation()
  const signedIn = Boolean(app.me?.user)
  useEffect(() => {
    if (!signedIn) navigate(`/signin?next=${encodeURIComponent(loc.path)}`, { replace: true })
  }, [signedIn, loc.path])
  return signedIn
}
