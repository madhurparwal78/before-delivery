import { useState } from 'react'
import { addDays } from '../../shared/dates'
import { EURO_MINOR } from '../../shared/rules'
import type { CalendarCell } from '../../shared/types'
import { ApiFailure, api } from '../api'
import { announce } from '../live'
import { useApp } from '../state'
import { Button, Dialog, Spinbutton } from '../ui'
import { Problems, type Problem } from './problems'

interface Values { rate: number; rooms: number; min: number; max: number; cta: boolean; ctd: boolean; stop: boolean }

const MESSAGES: Record<string, string> = { rate_minor: 'edit.rate_min', rooms: 'edit.rooms_sold', max_stay: 'edit.max_below_min', season_name: 'edit.season_name' }
const LABELS: Record<string, string> = { rate_minor: 'ui.rate', rooms: 'ui.roomsCount', max_stay: 'ui.maxStay', season_name: 'ui.seasonName' }
const focusField = (key: string): void => document.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)?.focus()

/** `dialog "Edit nights"` for the selected room types and dates, prefilled from the active cell; only the fields that were changed are sent. */
export function EditNights({ code, zone, roomTypes, from, to, cell, onClose, onSaved }: {
  code: string; zone: string; roomTypes: string[]; from: string; to: string; cell: CalendarCell; onClose: () => void; onSaved: () => void
}) {
  const app = useApp()
  const initial: Values = { rate: Math.round(cell.rate_minor / EURO_MINOR), rooms: cell.allotment, min: cell.min_stay, max: cell.max_stay, cta: cell.closed_to_arrival, ctd: cell.closed_to_departure, stop: cell.stop_sell }
  const [values, setValues] = useState<Values>(initial)
  const [days, setDays] = useState<boolean[]>(Array(7).fill(true))
  const [season, setSeason] = useState('')
  const [problems, setProblems] = useState<Problem[]>([])
  const [overlap, setOverlap] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const weekStart = app.lang === 'ar' ? 6 : 1
  const order = Array.from({ length: 7 }, (_, i) => ((weekStart - 1 + i) % 7) + 1)
  const set = <K extends keyof Values>(key: K, value: Values[K]): void => setValues({ ...values, [key]: value })

  const body = (replace?: string): Record<string, unknown> => ({
    room_types: roomTypes, from, to, weekdays: order.filter((day) => days[day - 1]),
    ...(values.rate !== initial.rate ? { rate_minor: values.rate * EURO_MINOR } : {}),
    ...(values.rooms !== initial.rooms ? { rooms: values.rooms } : {}),
    ...(values.min !== initial.min ? { min_stay: values.min } : {}),
    ...(values.max !== initial.max ? { max_stay: values.max } : {}),
    ...(values.cta !== initial.cta ? { closed_to_arrival: values.cta } : {}),
    ...(values.ctd !== initial.ctd ? { closed_to_departure: values.ctd } : {}),
    ...(values.stop !== initial.stop ? { stop_sell: values.stop } : {}),
    ...(season.trim() ? { season_name: season.trim() } : {}),
    ...(replace ? { replace } : {}),
  })

  const problem = (field: string, message: string): Problem => ({
    field, label: app.t(LABELS[field]), message, focus: () => focusField({ rate_minor: 'edit-rate', rooms: 'edit-rooms', max_stay: 'edit-max', season_name: 'edit-season' }[field] as string),
  })

  const apply = async (replace?: string): Promise<void> => {
    setBusy(true)
    setProblems([])
    setOverlap(null)
    try {
      await api('PATCH', `/api/manage/${code}/nights`, body(replace))
      announce('toast', app.t('toast.nights_saved'))
      onSaved()
      onClose()
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      const { status, body: answer } = error
      if (status === 422) {
        setProblems(Object.keys(MESSAGES).filter((field) => answer.fields?.[field]).map((field) => problem(field, app.t(MESSAGES[field], { n: answer.n ?? 0 }))))
      } else if (status === 409 && answer.error === 'season_overlap') {
        const date = (iso: string): string => app.fmt.longDate(iso, app.lang, zone)
        setProblems([problem('season_name', app.t('season.overlap', { a: answer.season, b: answer.other, from: date(answer.from), to: date(answer.to) }))])
        setOverlap(answer.other)
      } else throw error
      setBusy(false)
    }
  }

  const weekdayName = (day: number): string => app.fmt.weekdayName(addDays('2027-03-01', day - 1), app.lang)
  const check = (label: string, key: 'cta' | 'ctd' | 'stop') => (
    <label className="check"><input type="checkbox" checked={values[key]} onChange={(event) => set(key, event.target.checked)} /><span>{label}</span></label>
  )
  const spin = (label: string, key: 'rate' | 'rooms' | 'min' | 'max', focusKey: string, bounds: [number, number]) => (
    <div className="edit-field"><span>{label}</span><Spinbutton label={label} value={values[key]} min={bounds[0]} max={bounds[1]} data-focus-key={focusKey} onChange={(value) => set(key, value)} /></div>
  )

  return (
    <Dialog label={app.t('ui.editNights')} onClose={onClose} className="dialog-edit">
      <form className="mg-dialog" aria-busy={busy ? 'true' : undefined} onSubmit={(event) => { event.preventDefault(); void apply() }}>
        <h2>{app.t('ui.editNights')}</h2>
        <fieldset className="weekdays-group">
          <legend>{app.t('ui.weekdays')}</legend>
          {order.map((day) => (
            <label key={day} className="check"><input type="checkbox" checked={days[day - 1]} onChange={(event) => setDays(days.map((on, i) => (i === day - 1 ? event.target.checked : on)))} /><span>{weekdayName(day)}</span></label>
          ))}
        </fieldset>
        <div className="edit-grid">
          {spin(app.t('ui.rate'), 'rate', 'edit-rate', [0, 100000])}
          {spin(app.t('ui.roomsCount'), 'rooms', 'edit-rooms', [0, 999])}
          {spin(app.t('ui.minStay'), 'min', 'edit-min', [1, 30])}
          {spin(app.t('ui.maxStay'), 'max', 'edit-max', [1, 30])}
        </div>
        <div className="edit-checks">
          {check(app.t('ui.closedArrival'), 'cta')}
          {check(app.t('ui.closedDeparture'), 'ctd')}
          {check(app.t('ui.stopSell'), 'stop')}
        </div>
        <label className="stack">
          <span>{app.t('ui.seasonName')}</span>
          <input className="field" type="text" autoComplete="off" data-focus-key="edit-season" value={season} onChange={(event) => setSeason(event.target.value)} />
        </label>
        <Problems problems={problems} />
        <div className="btn-row">
          <Button type="submit" busy={busy} disabled={!days.some(Boolean)}>{app.t('ui.apply')}</Button>
          {overlap && <Button className="quiet" busy={busy} onClick={() => void apply(overlap)}>{app.t('ui.replaceSeason', { season: overlap })}</Button>}
          <Button className="quiet" onClick={onClose}>{app.t('ui.close')}</Button>
        </div>
      </form>
    </Dialog>
  )
}
