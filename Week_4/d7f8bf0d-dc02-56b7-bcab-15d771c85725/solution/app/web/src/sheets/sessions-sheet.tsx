import { useEffect } from 'react'
import { closeSheet, openSession, refreshWorkspaceLists } from '../actions'
import { canRun, store, useSelector } from '../state'
import { Button, EmptyState, Sheet } from '../ui/primitives'
import { SessionControls } from './session-controls'

export function SessionsSheet() {
  const sessions = useSelector(s => s.sessions)
  const role = useSelector(s => s.role)
  const open = useSelector(s => s.session)
  const status = open?.status

  useEffect(() => {
    void refreshWorkspaceLists().catch(() => undefined)
  }, [status])

  const newSession = canRun(role) ? <Button onClick={() => store.set({ dialog: { kind: 'new-session' } })}>New session</Button> : null

  return (
    <Sheet title="Sessions" testId="sheet-sessions" onClose={closeSheet}>
      {sessions.length === 0 ? <EmptyState>{newSession}</EmptyState> : (
        <>
          {newSession === null ? null : <div className="sheet-actions">{newSession}</div>}
          <ul className="rows">
            {sessions.map(session => (
              <li key={session.id} className="row" data-testid={`session-row-${session.id}`}>
                <div className="row-main">
                  <div className="row-title-line">
                    <span className="row-title">{session.name}</span>
                    <span className="state-word">{session.id === open?.id ? open.status : session.status}</span>
                  </div>
                  <span className="row-meta">{`Tick ${session.id === open?.id ? open.tick : session.tick}, Version ${session.layout_version_number}`}</span>
                </div>
                <div className="row-actions">
                  <Button className="btn-small" onClick={() => {
                    store.set({ sheet: null })
                    void openSession(session.id)
                  }}>Open</Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {open === null ? null : (
        <>
          <h3 className="section-title">{open.name}</h3>
          <SessionControls />
        </>
      )}
    </Sheet>
  )
}
