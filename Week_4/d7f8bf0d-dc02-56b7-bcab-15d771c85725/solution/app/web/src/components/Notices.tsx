import { useEffect, useState } from 'react'
import { dismissError } from '../actions'
import { COPY } from '../copy'
import { store, useAppState } from '../state'
import { Button } from '../ui/primitives'

const STATUS_SHOWN_MS = 6000

// The only named live region: every async result is announced here, newest last, polite. The newest line fades from
// the stage after a few seconds; its text stays in the region.
export function StatusRegion() {
  const { status } = useAppState()
  const [quiet, setQuiet] = useState(false)
  useEffect(() => {
    setQuiet(false)
    const timer = window.setTimeout(() => setQuiet(true), STATUS_SHOWN_MS)
    return () => window.clearTimeout(timer)
  }, [status])
  return (
    <div role="status" aria-label="Gandyboard status" aria-live="polite" data-testid="status-region" className="status-region">
      {status.map((message, index) => (
        <p key={`${index}-${message}`} className={index === status.length - 1 ? `status-latest${quiet ? ' quiet' : ''}` : 'sr-only'}>{message}</p>
      ))}
    </div>
  )
}

export function Notices() {
  const { errorSheet, valkeyDown, findings } = useAppState()
  return (
    <div className="notices">
      {valkeyDown ? <p role="alert" data-testid="outage-banner" className="notice outage">{COPY.valkeyDown}</p> : null}
      {errorSheet === null ? null : (
        <div role="alert" data-testid="error-sheet" className="notice error-sheet">
          <p>{errorSheet}</p>
          <Button className="btn-small btn-danger" onClick={dismissError}>Dismiss</Button>
        </div>
      )}
      {findings.length === 0 ? null : (
        <section aria-label="Layout findings" className="notice findings">
          <ul>{findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul>
          <Button className="btn-small btn-ghost" onClick={() => store.set({ findings: [] })}>Close</Button>
        </section>
      )}
    </div>
  )
}
