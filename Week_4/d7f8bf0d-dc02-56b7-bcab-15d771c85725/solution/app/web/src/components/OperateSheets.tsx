import { useEffect, useRef, useState } from 'react'
import type { Conflict } from '../../../shared/domain'
import { act, closeSheet, layoutPath, moveTrain, refreshLayout, saveNote, withdrawRequest } from '../actions'
import { COPY } from '../copy'
import { apiWrite } from '../api'
import { store, useAppState } from '../state'
import { mmToField, fieldToMm } from '../units'
import { Button, EmptyState, SelectField, Sheet, TextField } from '../ui/primitives'

const noteKey = (id: string): string => `gandyboard.conflict-note.${id}`

function ConflictBody({ conflict }: { conflict: Conflict }) {
  const { session } = useAppState()
  const [note, setNote] = useState(() => window.localStorage.getItem(noteKey(conflict.id)) ?? conflict.note)
  if (session === null) return null
  const train = session.trains.find(candidate => candidate.id === conflict.train_id)
  const other = session.trains.find(candidate => candidate.id === conflict.other_train_id)
  const block = session.blocks.find(candidate => candidate.id === conflict.block_id)
  const open = conflict.state === 'Open'
  return (
    <>
      <p className="sheet-note">
        {other === undefined
          ? `Train ${train?.number ?? ''} is refused at ${block?.name ?? ''}: out of service.`
          : `Train ${train?.number ?? ''} is refused at ${block?.name ?? ''}: held by Train ${other.number}.`}
      </p>
      <p className="sheet-note">{open ? 'Save a note, withdraw the request or move a train.' : 'This request is closed.'}</p>
      <label className="field">
        <span className="field-label">Dispatcher note</span>
        <textarea
          className="input"
          aria-label="Dispatcher note"
          value={note}
          onChange={event => {
            setNote(event.target.value)
            window.localStorage.setItem(noteKey(conflict.id), event.target.value)
          }}
        />
      </label>
      <div className="sheet-actions">
        <Button disabled={!open} onClick={() => void saveNote(conflict, note)}>Save note</Button>
        <Button disabled={!open} onClick={() => void withdrawRequest(conflict)}>Withdraw request</Button>
        <Button disabled={train === undefined} onClick={() => void moveTrain(train?.number ?? '', 'back-to-loop')}>Back to loop</Button>
        <Button disabled={train === undefined} onClick={() => void moveTrain(train?.number ?? '', 'recall')}>Recall train</Button>
      </div>
    </>
  )
}

// Non-modal: ticks and re-reads update its facts but never close it, reset its note or move focus.
export function ConflictSheet() {
  const { session, conflictId, selection } = useAppState()
  const open = session?.conflicts.filter(candidate => candidate.state === 'Open') ?? []
  const selectedId = session?.trains.find(train => train.number === selection.trainNumber)?.id
  const conflict = session?.conflicts.find(candidate => candidate.id === conflictId)
    ?? open.find(candidate => candidate.train_id === selectedId) ?? open[open.length - 1]
  return (
    <Sheet title="Conflict" testId="conflict-sheet" onClose={closeSheet} focusOnOpen={false}>
      {conflict === undefined ? <EmptyState /> : <ConflictBody key={conflict.id} conflict={conflict} />}
    </Sheet>
  )
}

export function DeadlockSheet() {
  const { session } = useAppState()
  const deadlocks = session?.deadlocks.filter(candidate => candidate.state === 'Open') ?? []
  return (
    <Sheet title="Deadlock" testId="deadlock-sheet" onClose={closeSheet} focusOnOpen={false}>
      {deadlocks.length === 0 ? <p className="sheet-note">No deadlock is open.</p> : null}
      {deadlocks.map(deadlock => (
        <section key={deadlock.id}>
          <p className="sheet-note">{`Trains ${deadlock.train_numbers.join(', ')} are deadlocked. Use Back to loop or Recall.`}</p>
          <ul className="rows">
            {deadlock.train_numbers.map(number => (
              <li key={number} className="row">
                <span className="row-title" id={`deadlock-${deadlock.id}-${number}`}>{`Train ${number}`}</span>
                <span className="row-actions">
                  <Button className="btn-small" aria-describedby={`deadlock-${deadlock.id}-${number}`} onClick={() => void moveTrain(number, 'back-to-loop')}>Back to loop</Button>
                  <Button className="btn-small" aria-describedby={`deadlock-${deadlock.id}-${number}`} onClick={() => void moveTrain(number, 'recall')}>Recall train</Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Sheet>
  )
}

const pieceNoteKey = (id: string): string => `gandyboard.piece-note.${id}`

function InspectorBody({ pieceId }: { pieceId: string }) {
  const { layout, standards } = useAppState()
  const found = layout?.content.modules.flatMap(module => module.pieces.map(piece => ({ module, piece }))).find(item => item.piece.id === pieceId)
  const units = standards?.display_units ?? 'in'
  const first = useRef(found)
  const [rise, setRise] = useState(() => mmToField(first.current?.piece.rise_mm ?? 0, units))
  const [blockId, setBlockId] = useState(first.current?.piece.block_id ?? '')
  const [note, setNote] = useState(() => window.localStorage.getItem(pieceNoteKey(pieceId)) ?? first.current?.piece.note ?? '')
  const [error, setError] = useState('')
  useEffect(() => {
    if (layout !== null && found === undefined) store.set(state => ({ sheet: null, selection: { ...state.selection, pieceId: null } }))
  }, [layout, found])
  if (found === undefined || layout === null) return null
  const { module, piece } = found

  async function apply(): Promise<void> {
    const body: Record<string, unknown> = { revision: layout?.module_revisions[module.id] }
    const riseMm = fieldToMm(rise, units)
    if (riseMm === null) {
      setError('Enter a number.')
      return
    }
    if (riseMm !== piece.rise_mm) body.rise_mm = riseMm
    if (blockId !== (piece.block_id ?? '')) body.block_id = blockId === '' ? null : blockId
    if (note !== piece.note) body.note = note
    setError('')
    const done = await act({
      pending: COPY.savingPiece,
      run: () => apiWrite('PATCH', `${layoutPath()}/modules/${module.id}/pieces/${piece.id}`, body),
      success: () => COPY.pieceSaved,
    })
    if (done.ok) {
      window.localStorage.removeItem(pieceNoteKey(piece.id))
      await refreshLayout()
    } else {
      setError(done.error.message)
    }
  }

  async function remove(): Promise<void> {
    const done = await act({
      pending: COPY.removingPiece,
      run: () => apiWrite('POST', `${layoutPath()}/modules/${module.id}/pieces/${piece.id}/remove`, { revision: layout?.module_revisions[module.id] }),
      success: () => COPY.pieceRemoved,
    })
    if (done.ok) {
      window.localStorage.removeItem(pieceNoteKey(piece.id))
      store.set(state => ({ sheet: null, selection: { ...state.selection, pieceId: null } }))
      await refreshLayout()
    }
  }

  return (
    <>
      <TextField label="Rise" type="number" step="any" value={rise} onChange={event => setRise(event.target.value)} error={error} hint={units === 'in' ? 'Inches' : 'Millimetres'} />
      <SelectField
        label="Block"
        value={blockId}
        onChange={event => setBlockId(event.target.value)}
        options={[{ value: '', label: 'No block' }, ...[...layout.content.blocks].sort((a, b) => a.number - b.number).map(block => ({ value: block.id, label: `Block ${block.number} ${block.name}` }))]}
      />
      <label className="field">
        <span className="field-label">Piece note</span>
        <textarea
          className="input"
          aria-label="Piece note"
          value={note}
          onChange={event => {
            setNote(event.target.value)
            window.localStorage.setItem(pieceNoteKey(pieceId), event.target.value)
          }}
        />
      </label>
      <div className="sheet-actions">
        <Button onClick={() => void apply()}>Apply</Button>
        <Button className="btn-danger" onClick={() => void remove()}>Remove piece</Button>
      </div>
    </>
  )
}

// Non-modal: live events update everything else, but the typed values, focus and caret stay until Apply or Close.
export function PieceInspector() {
  const { selection } = useAppState()
  return (
    <Sheet
      title="Piece inspector"
      testId="piece-inspector"
      focusOnOpen={false}
      onClose={() => {
        if (selection.pieceId !== null) window.localStorage.removeItem(pieceNoteKey(selection.pieceId))
        closeSheet()
      }}
    >
      {selection.pieceId === null ? <EmptyState /> : <InspectorBody key={selection.pieceId} pieceId={selection.pieceId} />}
    </Sheet>
  )
}
