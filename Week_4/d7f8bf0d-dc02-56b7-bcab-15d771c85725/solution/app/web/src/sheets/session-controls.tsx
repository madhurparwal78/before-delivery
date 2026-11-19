import { sessionCommand } from '../actions'
import { canAddExtraTrain, nextStatus, type SessionCommand } from '../../../shared/session-states'
import { canRun, store, useSelector } from '../state'
import { Button } from '../ui/primitives'

const COMMANDS: Array<[SessionCommand, string]> = [['start', 'Start'], ['hold', 'Hold'], ['resume', 'Resume'], ['end', 'End session']]

export function SessionControls() {
  const session = useSelector(s => s.session)
  const role = useSelector(s => s.role)
  if (!canRun(role) || session === null) return null
  return (
    <div role="group" aria-label="Session controls" className="session-controls">
      {COMMANDS.map(([command, label]) => (
        <Button key={command} className="btn-small" disabled={nextStatus(session, command) === null} onClick={() => void sessionCommand(command)}>{label}</Button>
      ))}
      <Button className="btn-small" disabled={!canAddExtraTrain(session.status)} onClick={() => store.set({ dialog: { kind: 'add-extra-train' } })}>Add extra train</Button>
    </div>
  )
}
