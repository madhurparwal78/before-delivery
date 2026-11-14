import { Table2 } from 'lucide-react'
import { formatError, type MortiseError } from '../../shared/mortise.ts'
import type { Snapshot } from './store.ts'

const ERROR_CAP = 20

/** The offset of a one-based line and column (columns count characters) in the text. */
export function offsetOf(text: string, line: number, column: number): number {
  const lines = text.split('\n')
  let offset = 0
  for (let i = 0; i < line - 1 && i < lines.length; i++) offset += (lines[i] as string).length + 1
  const own = lines[line - 1] ?? ''
  let units = 0
  for (const char of Array.from(own).slice(0, column - 1)) units += char.length
  return offset + units
}

interface ErrorAreaProps {
  errors: MortiseError[]
  active: boolean
  onPick: (error: MortiseError) => void
}

/** The red bar along the bottom of the text pane and the list of errors: every error is a button that jumps to its place. */
export function ErrorArea({ errors, active, onPick }: ErrorAreaProps) {
  if (!errors.length) return null
  const first = errors[0] as MortiseError
  const shown = errors.slice(0, ERROR_CAP)
  const rest = errors.length - shown.length
  return (
    <section aria-label="Errors" className="error-area" data-tab="text" data-active={active}>
      <ul aria-label="Errors" className="error-list">
        {shown.map((error) => (
          <li key={`${error.line}:${error.column}:${error.message}`}>
            <button type="button" className="error-line" onClick={() => onPick(error)}>
              {formatError(error)}
            </button>
          </li>
        ))}
        {rest ? <li className="error-more">{rest === 1 ? '1 more error' : `${rest} more errors`}</li> : null}
      </ul>
      <div className="error-bar" aria-hidden="true">
        {formatError(first)}
      </div>
    </section>
  )
}

interface EmptyCanvasProps {
  canEdit: boolean
  onAdd: () => void
}

export function EmptyCanvas({ canEdit, onAdd }: EmptyCanvasProps) {
  return (
    <div className="empty-canvas">
      <span className="empty-badge" aria-hidden="true">
        <Table2 size={20} />
      </span>
      <h2>No entities yet</h2>
      <p>Type an entity in the text, or pick a starter template.</p>
      <p>Everything a template adds stays editable.</p>
      {canEdit ? (
        <button type="button" className="btn btn-plus" onClick={onAdd}>
          Add an entity
        </button>
      ) : null}
    </div>
  )
}

export function StaleBanner({ snap }: { snap: Snapshot }) {
  return (
    <div role="status" aria-label="Diagram out of date" className="stale-banner">
      {snap.errors.length ? 'Showing the last diagram without errors. Fix the text to update it.' : ''}
    </div>
  )
}
