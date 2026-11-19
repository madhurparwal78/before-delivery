import { useEffect, useState, type FormEvent } from 'react'
import { act, closeSheet, workspacePath } from '../actions'
import { apiGet, apiWrite } from '../api'
import { COPY } from '../copy'
import { canManage, store, useSelector } from '../state'
import { fieldToHundredths, fieldToMm, hundredthsToField, mmToField } from '../units'
import { Button, Sheet, TextField } from '../ui/primitives'
import { Skeleton } from './skeleton'
import { useLoad } from './use-load'
import type { DisplayUnits, StandardsWithRevision, StandardsProfile } from '../../../shared/domain'

type NumericKey = Exclude<keyof StandardsProfile, 'display_units'>
type Kind = 'length' | 'hundredths' | 'grade' | 'whole'

const FIELDS: Array<{ key: NumericKey; label: string; kind: Kind }> = [
  { key: 'endplate_single_mm', label: 'Single endplate', kind: 'length' },
  { key: 'endplate_double_mm', label: 'Double endplate', kind: 'length' },
  { key: 'double_track_offset_mm', label: 'Double track offset', kind: 'length' },
  { key: 'end_straight_mm', label: 'End straight', kind: 'length' },
  { key: 'min_radius_mm', label: 'Minimum radius', kind: 'length' },
  { key: 'max_grade_tenths_percent', label: 'Maximum grade', kind: 'grade' },
  { key: 'min_frog_number', label: 'Minimum turnout', kind: 'whole' },
  { key: 'reverse_curve_straight_mm', label: 'Reverse curve straight', kind: 'length' },
  { key: 'elevation_step_hundredths_mm', label: 'Elevation step', kind: 'hundredths' },
]

function show(value: number, kind: Kind, units: DisplayUnits): string {
  if (kind === 'length') return mmToField(value, units)
  if (kind === 'hundredths') return hundredthsToField(value, units)
  if (kind === 'grade') return (value / 10).toFixed(1)
  return String(value)
}

function read(text: string, kind: Kind, units: DisplayUnits): number | null {
  if (kind === 'length') return fieldToMm(text, units)
  if (kind === 'hundredths') return fieldToHundredths(text, units)
  const value = Number(text)
  if (text.trim() === '' || !Number.isFinite(value)) return null
  return kind === 'grade' ? Math.round(value * 10) : Math.round(value)
}

type Texts = Record<NumericKey, string>

const textsOf = (profile: StandardsProfile, units: DisplayUnits): Texts =>
  Object.fromEntries(FIELDS.map(({ key, kind }) => [key, show(profile[key], kind, units)])) as Texts

export function StandardsSheet() {
  const role = useSelector(s => s.role)
  const { data } = useLoad(() => apiGet<StandardsWithRevision>(`${workspacePath()}/standards`), [])
  const [units, setUnits] = useState<DisplayUnits>('in')
  const [texts, setTexts] = useState<Texts | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const editable = canManage(role)

  useEffect(() => {
    if (data === null) return
    setUnits(data.display_units)
    setTexts(textsOf(data, data.display_units))
  }, [data])

  function values(): Partial<Record<NumericKey, number>> {
    const found: Partial<Record<NumericKey, number>> = {}
    for (const { key, kind } of FIELDS) {
      const value = texts === null ? null : read(texts[key], kind, units)
      if (value !== null) found[key] = value
    }
    return found
  }

  function switchUnits(next: DisplayUnits): void {
    if (texts === null || data === null || next === units) return
    const parsed = values()
    setTexts(Object.fromEntries(FIELDS.map(({ key, kind }) => [key, show(parsed[key] ?? data[key], kind, next)])) as Texts)
    setUnits(next)
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (data === null) return
    const parsed = values()
    const missing = Object.fromEntries(FIELDS.filter(({ key }) => parsed[key] === undefined).map(({ key }) => [key, 'Enter a number.']))
    const done = await act({
      pending: COPY.savingStandards,
      run: () => apiWrite<StandardsWithRevision>('PUT', `${workspacePath()}/standards`, { ...parsed, ...Object.fromEntries(Object.keys(missing).map(key => [key, null])), display_units: units, revision: store.get().standards?.revision ?? data.revision }),
      success: () => COPY.standardsSaved,
    })
    if (done.ok) {
      setErrors({})
      store.set({ standards: done.value })
    } else {
      setErrors(done.error.fields)
    }
  }

  return (
    <Sheet title="Standards" testId="sheet-standards" onClose={closeSheet}>
      {texts === null ? <Skeleton /> : (
        <form onSubmit={event => void save(event)}>
          <fieldset className="radios">
            <legend>Display units</legend>
            <label className="check"><input type="radio" name="display-units" checked={units === 'in'} disabled={!editable} onChange={() => switchUnits('in')} />Inches</label>
            <label className="check"><input type="radio" name="display-units" checked={units === 'mm'} disabled={!editable} onChange={() => switchUnits('mm')} />Millimetres</label>
          </fieldset>
          {FIELDS.map(({ key, label, kind }) => (
            <TextField
              key={key}
              label={label}
              type="number"
              step={kind === 'whole' ? 1 : 'any'}
              inputMode="decimal"
              value={texts[key]}
              readOnly={!editable}
              error={errors[key]}
              onChange={event => setTexts(current => (current === null ? current : { ...current, [key]: event.target.value }))}
            />
          ))}
          {editable ? <Button type="submit">Save standards</Button> : null}
        </form>
      )}
    </Sheet>
  )
}
