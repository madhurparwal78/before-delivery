import { useEffect, useState, type FormEvent } from 'react'
import { act, closeSheet, layoutPath, refreshLayout } from '../actions'
import { apiWrite } from '../api'
import { COPY } from '../copy'
import { canManage, store, useSelector } from '../state'
import { Button, EmptyState, Sheet, TextField } from '../ui/primitives'
import type { TimetableEntry } from '../../../shared/domain'

const toDraft = (entries: TimetableEntry[]): Record<string, string> =>
  Object.fromEntries(entries.map(entry => [entry.id, String(entry.depart_fast_seconds)]))

export function TimetableSheet() {
  const layout = useSelector(s => s.layout)
  const role = useSelector(s => s.role)
  const content = layout?.content
  const entries = content?.timetable.entries ?? []
  const [draft, setDraft] = useState<Record<string, string>>(() => toDraft(entries))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const editable = canManage(role)

  useEffect(() => {
    setDraft(toDraft(entries))
    setErrors({})
  }, [layout?.id, content?.timetable.version])

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    const current = store.get().layout
    if (current === null) return
    const done = await act({
      pending: COPY.savingTimetable,
      run: () => apiWrite('PUT', `${layoutPath()}/timetable`, {
        revision: current.revision,
        entries: entries.map(entry => ({ ...entry, depart_fast_seconds: draft[entry.id] === '' ? null : Number(draft[entry.id]) })),
      }),
      success: () => COPY.timetableSaved,
    })
    if (done.ok) {
      setErrors({})
      await refreshLayout()
    } else {
      const found: Record<string, string> = {}
      entries.forEach((entry, index) => {
        const message = done.error.fields[`entries.${index}.depart_fast_seconds`]
        if (message !== undefined) found[entry.id] = message
      })
      setErrors(found)
    }
  }

  const stationName = (id: string): string => content?.stations.find(station => station.id === id)?.name ?? id
  const trainLabel = (id: string): string => {
    const train = content?.trains.find(candidate => candidate.id === id)
    return train === undefined ? id : `Train ${train.number} ${train.name}`
  }

  return (
    <Sheet title="Timetable" testId="sheet-timetable" onClose={closeSheet}>
      <h3 className="section-title">Stations</h3>
      <ul className="rows">
        {(content?.stations ?? []).map(station => (
          <li key={station.id} className="row" data-testid={`station-row-${station.id}`}>
            <div className="row-main"><span className="row-title">{station.name}</span></div>
            {editable ? (
              <div className="row-actions">
                <Button className="btn-small btn-ghost" onClick={() => store.set({ dialog: { kind: 'rename', target: 'station', id: station.id, name: station.name } })}>Rename</Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <h3 className="section-title">Departures</h3>
      {entries.length === 0 ? <EmptyState /> : (
        <form onSubmit={event => void save(event)}>
          <ul className="rows">
            {entries.map(entry => (
              <li key={entry.id} className="depart-row" data-testid={`timetable-row-${entry.id}`}>
                <div className="row-main">
                  <span className="row-title">{trainLabel(entry.train_id)}</span>
                  <span className="row-meta">{stationName(entry.station_id)}</span>
                </div>
                <TextField
                  label="Depart"
                  type="number"
                  min={0}
                  max={86399}
                  step={1}
                  inputMode="numeric"
                  value={draft[entry.id] ?? ''}
                  readOnly={!editable}
                  error={errors[entry.id]}
                  onChange={event => setDraft(current => ({ ...current, [entry.id]: event.target.value }))}
                />
              </li>
            ))}
          </ul>
          {editable ? <div className="sheet-actions"><Button type="submit">Save timetable</Button></div> : null}
        </form>
      )}
    </Sheet>
  )
}
