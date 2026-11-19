import { usePresented } from '../presenter'
import { useAppState } from '../state'
import { SessionControls } from '../sheets/session-controls'
import type { SessionStatus } from '../../../shared/domain'

// The status is a word, and a glyph that is not colour: play, pause, warning, clock, flag.
function StatusGlyph({ status }: { status: SessionStatus }) {
  const shape: Record<SessionStatus, string> = {
    Running: 'M6 4l14 8-14 8z',
    Held: 'M6 4h4v16H6zM14 4h4v16h-4z',
    Interrupted: 'M12 3l10 18H2zM11 10h2v5h-2zM11 17h2v2h-2z',
    Scheduled: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM11 7h2v5.4l3.6 2.1-1 1.7L11 13z',
    Ended: 'M5 3h2v18H5zM9 4h11l-3 4 3 4H9z',
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" className="status-glyph">
      <path fill="currentColor" d={shape[status]} />
    </svg>
  )
}

const LABELS = [
  ['Occupied', 'counter-occupied', 'occupied_blocks'],
  ['Reserved', 'counter-reserved', 'reserved_blocks'],
  ['Free', 'counter-free', 'free_blocks'],
  ['Trains', 'counter-trains', 'trains'],
  ['Conflicts', 'counter-conflicts', 'open_conflicts'],
] as const

// The fast clock, status, session version and the five counters come only from the server's committed state.
export function Readout() {
  const { session } = useAppState()
  const presented = usePresented()
  if (session === null) return null
  const counters = presented.counters ?? session.counters
  return (
    <div className="readout-group">
      <div className="readout">
        <span className="readout-item num" data-testid="fast-clock">{session.fast_clock_label}</span>
        <span className={`readout-item status-pill status-${session.status.toLowerCase()}`} data-testid="session-status">
          <StatusGlyph status={session.status} />
          {session.status}
        </span>
        <span className="readout-item" data-testid="session-version">{`Session version ${session.session_version}`}</span>
        <div role="group" aria-label="Counters" className="counters">
          {LABELS.map(([label, testId, key]) => (
            <span key={testId} className="counter" data-testid={testId}>
              <span className="counter-label">{label}</span>
              <span className="counter-figure num">{counters[key]}</span>
            </span>
          ))}
        </div>
      </div>
      <SessionControls />
    </div>
  )
}
