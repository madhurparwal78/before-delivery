import { useEffect, useRef, useState } from 'react'
import { DAY_MS, addDays, formatDay, localDate, parseDay } from '../../shared/dates'
import type { DateDay } from '../../shared/types'
import { get, query } from '../api'
import { serverNow } from '../live'
import { useApp } from '../state'
import { Button, Dialog } from '../ui'
import { reasonText } from './room-advice'

interface DateTarget { dest?: string; property?: string; booking?: string }
interface DateRange { in: string | null; out: string | null }

const monthStart = (iso: string): string => `${iso.slice(0, 7)}-01`
const addMonths = (iso: string, n: number): string => {
  const date = new Date(parseDay(monthStart(iso)))
  date.setUTCMonth(date.getUTCMonth() + n)
  return formatDay(date.getTime())
}
const lastOfMonth = (iso: string): string => addDays(addMonths(iso, 1), -1)

function useMonths(): number {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const listener = (): void => setWide(media.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])
  return wide ? 2 : 1
}

/** The published label of a day, from the server's answer for it. */
function dayLabel(app: ReturnType<typeof useApp>, day: DateDay, zone: string, start: string | null): string {
  const date = app.fmt.longDate(day.date, app.lang, zone)
  if (start && day.after_start === 'before') return app.t('day.before', { date })
  if (start && day.after_start === 'short') return app.t('day.short', { date, 'count:night': day.reason?.n ?? 0 })
  if (!day.available && day.reason) return app.t('day.blocked', { date, reason: reasonText(app, day.reason, zone) })
  return app.t('day.available', {
    date, n: day.from_minor === null ? '' : app.fmt.wholeMajor(day.from_minor, app.cur), 'currency words': app.cur, 'count:night': day.min_stay ?? 1,
  })
}

const REASON_FOR = (app: ReturnType<typeof useApp>, day: DateDay, zone: string): string =>
  day.after_start === 'before' ? app.t('day.before', { date: app.fmt.longDate(day.date, app.lang, zone) })
    : day.after_start === 'short' ? app.t('day.short', { date: app.fmt.longDate(day.date, app.lang, zone), 'count:night': day.reason?.n ?? 0 })
      : day.reason ? reasonText(app, day.reason, zone) : ''

/** The day grid (one month on a phone, two elsewhere) with its Date help line; picks an arrival, then a departure. */
export function DateGrid({ target, zone, value, onPick }: { target: DateTarget; zone: string; value: DateRange; onPick: (range: { in: string; out: string }) => void }) {
  const app = useApp()
  const months = useMonths()
  const today = localDate(new Date(serverNow()), zone)
  const initial = value.in ?? today
  const [active, setActive] = useState(initial)
  const [first, setFirst] = useState(monthStart(initial))
  const [arrival, setArrival] = useState<string | null>(null)
  const [days, setDays] = useState<Map<string, DateDay>>(new Map())
  const [loading, setLoading] = useState(true)
  const [help, setHelp] = useState(app.t('date.start'))
  const focusNext = useRef(false)
  const rtl = app.dir === 'rtl'
  const weekStart = app.lang === 'ar' ? 6 : 1 // ISO weekday: Saturday or Monday
  const last = lastOfMonth(addMonths(first, months - 1))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = query({ ...target, from: first, to: last, cur: app.cur, lang: app.lang, start: arrival })
    void get<{ days: DateDay[] }>(`/api/dates?${params}`).then((answer) => {
      if (cancelled) return
      setDays(new Map(answer.days.map((day) => [day.date, day])))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [target.dest, target.property, target.booking, first, last, app.cur, app.lang, arrival])

  useEffect(() => {
    setHelp(arrival ? app.t('date.end', { date: app.fmt.longDate(arrival, app.lang, zone), 'count:night': days.get(arrival)?.min_stay ?? 1 }) : app.t('date.start'))
  }, [arrival, app.lang, days])

  useEffect(() => {
    if (!focusNext.current) return
    focusNext.current = false
    document.querySelector<HTMLElement>(`[data-grid-day][data-date="${active}"]`)?.focus()
  }, [active, first])

  const move = (to: string): void => {
    focusNext.current = true
    setActive(to)
    if (to < first) setFirst(monthStart(to))
    else if (to > last) setFirst(addMonths(monthStart(to), -(months - 1)))
  }

  const weekdayOffset = (iso: string): number => (((new Date(parseDay(iso)).getUTCDay() + 6) % 7) + 1 - weekStart + 7) % 7

  const onKey = (event: React.KeyboardEvent): void => {
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    const offset = weekdayOffset(active)
    const plans: Record<string, string> = {
      [forward]: addDays(active, 1), [back]: addDays(active, -1), ArrowDown: addDays(active, 7), ArrowUp: addDays(active, -7),
      Home: addDays(active, -offset), End: addDays(active, 6 - offset),
    }
    let to = plans[event.key]
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      const direction = event.key === 'PageDown' ? 1 : -1
      const moved = addMonths(active, direction * (event.shiftKey ? 12 : 1))
      const dayOfMonth = Number(active.slice(8, 10))
      to = `${moved.slice(0, 8)}${String(Math.min(dayOfMonth, Number(lastOfMonth(moved).slice(8, 10)))).padStart(2, '0')}`
    }
    if (!to) return
    event.preventDefault()
    move(to)
  }

  const choose = (iso: string): void => {
    const day = days.get(iso)
    setActive(iso)
    if (!day) return
    const blocked = arrival ? !day.available || day.after_start !== null : !day.available
    if (blocked) return void setHelp(REASON_FOR(app, day, zone) || dayLabel(app, day, zone, arrival))
    if (!arrival || iso <= arrival) {
      setArrival(iso)
      return
    }
    onPick({ in: arrival, out: iso })
  }

  const selected = (iso: string): boolean => {
    const from = arrival ?? value.in
    const to = arrival ? arrival : value.out
    return Boolean(from && to && iso >= from && iso <= to)
  }

  const header = Array.from({ length: 7 }, (_, i) => app.fmt.weekdayName(formatDay(parseDay('2027-03-01') + ((weekStart === 6 ? 5 : 0) + i) * DAY_MS), app.lang))

  return (
    <div className="date-grid" aria-busy={loading ? 'true' : undefined}>
      <div className="date-nav">
        <Button className="quiet" onClick={() => setFirst(addMonths(first, -1))}>{app.t('ui.prevMonth')}</Button>
        <Button className="quiet" onClick={() => setFirst(addMonths(first, 1))}>{app.t('ui.nextMonth')}</Button>
      </div>
      <div className="date-months">
        {Array.from({ length: months }, (_, m) => {
          const start = addMonths(first, m)
          const count = Number(lastOfMonth(start).slice(8, 10))
          const cells: (string | null)[] = [...Array(weekdayOffset(start)).fill(null), ...Array.from({ length: count }, (_, d) => addDays(start, d))]
          while (cells.length % 7) cells.push(null)
          const title = app.fmt.monthYear(start, app.lang, 'UTC')
          return (
            <div key={start} className="month">
              <p className="month-title">{title}</p>
              <div role="grid" aria-label={title} onKeyDown={onKey}>
                <div role="row" className="weekdays">
                  {header.map((name) => <span key={name} role="columnheader" aria-label={name}>{name.slice(0, app.lang === 'ar' ? 3 : 2)}</span>)}
                </div>
                {Array.from({ length: cells.length / 7 }, (_, row) => (
                  <div key={row} role="row" className="week">
                    {cells.slice(row * 7, row * 7 + 7).map((iso, i) => {
                      if (!iso) return <div key={i} role="gridcell" aria-hidden="true" className="day-pad" />
                      const day = days.get(iso)
                      const blocked = day ? (arrival ? !day.available || day.after_start !== null : !day.available) : false
                      return (
                        <div key={iso} role="gridcell" aria-selected={selected(iso) ? 'true' : undefined} className="day-cell" data-selected={selected(iso) || undefined}>
                          <button
                            type="button" data-grid-day="" data-date={iso} data-autofocus={iso === active ? '' : undefined} tabIndex={iso === active ? 0 : -1}
                            aria-label={day ? dayLabel(app, day, zone, arrival) : iso} data-blocked={blocked || undefined}
                            className={`day ${blocked ? 'day-blocked' : ''}`} onClick={() => choose(iso)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                choose(iso)
                              }
                            }}
                          >
                            {Number(iso.slice(8, 10))}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <p role="status" aria-live="polite" aria-label={app.t('ui.dateHelp')} className="date-help">{help}</p>
    </div>
  )
}

/** The Dates button's dialog: choose dates. */
export function DatePicker({ open, onClose, ...rest }: { open: boolean; onClose: () => void; target: DateTarget; zone: string; value: DateRange; onPick: (range: { in: string; out: string }) => void }) {
  const app = useApp()
  return (
    <Dialog label={app.t('ui.chooseDates')} open={open} onClose={onClose} className="dialog-dates">
      <DateGrid {...rest} onPick={(range) => { rest.onPick(range); onClose() }} />
    </Dialog>
  )
}
