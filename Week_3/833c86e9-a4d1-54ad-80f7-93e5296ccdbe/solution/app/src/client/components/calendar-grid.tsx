import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { addDays, localDate } from '../../shared/dates'
import type { CalendarCell } from '../../shared/types'
import { ApiFailure, get } from '../api'
import { useLive } from '../live'
import { useApp } from '../state'
import { Button, Money, Tag } from '../ui'
import { EditNights } from './edit-nights'

interface Calendar { room_types: { code: string; name: string; rooms: number }[]; cells: CalendarCell[] }
interface Spot { r: number; c: number }

const DAYS = 28

/** `grid "Rates and availability"`: a 28-day window, one roving tab stop, arrow keys and rectangular selection, Enter edits the selected nights. */
export function CalendarGrid({ code, zone, onMissing }: { code: string; zone: string; onMissing: () => void }) {
  const app = useApp()
  const [from, setFrom] = useState<string | null>(null)
  const [calendar, setCalendar] = useState<Calendar | null>(null)
  const [anchor, setAnchor] = useState<Spot>({ r: 0, c: 0 })
  const [active, setActive] = useState<Spot>({ r: 0, c: 0 })
  const [editing, setEditing] = useState(false)
  const cells = useRef(new Map<string, HTMLElement>())
  const latest = useRef(0)
  const rtl = app.dir === 'rtl'

  useEffect(() => {
    void get<{ now: string }>('/api/time').then((time) => setFrom(localDate(new Date(time.now), zone)))
  }, [zone])

  const load = useCallback(async (start: string): Promise<void> => {
    const ticket = ++latest.current
    try {
      const next = await get<Calendar>(`/api/manage/${code}/calendar?from=${start}&days=${DAYS}`)
      if (ticket === latest.current) setCalendar(next)
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) onMissing()
      else throw error
    }
  }, [code, onMissing])

  useEffect(() => {
    if (from) void load(from)
  }, [from, load])
  useLive('availability', (event) => {
    if (from && event.property === code) void load(from)
  })

  if (!from || !calendar) return null
  const dates = Array.from({ length: DAYS }, (_, i) => addDays(from, i))
  const byKey = new Map(calendar.cells.map((cell) => [`${cell.room_type}|${cell.date}`, cell]))
  const rows = calendar.room_types
  const top = Math.min(anchor.r, active.r)
  const bottom = Math.max(anchor.r, active.r)
  const left = Math.min(anchor.c, active.c)
  const right = Math.max(anchor.c, active.c)
  const keyOf = (spot: Spot): string => `${rows[spot.r].code}|${dates[spot.c]}`

  const go = (to: Spot, extend: boolean): void => {
    const next = { r: Math.max(0, Math.min(rows.length - 1, to.r)), c: Math.max(0, Math.min(DAYS - 1, to.c)) }
    setActive(next)
    if (!extend) setAnchor(next)
    cells.current.get(keyOf(next))?.focus()
  }

  const onKey = (event: KeyboardEvent): void => {
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    const moves: Record<string, Spot> = {
      [forward]: { r: active.r, c: active.c + 1 }, [back]: { r: active.r, c: active.c - 1 },
      ArrowDown: { r: active.r + 1, c: active.c }, ArrowUp: { r: active.r - 1, c: active.c },
      Home: { r: active.r, c: 0 }, End: { r: active.r, c: DAYS - 1 },
    }
    if (event.key === 'Enter') setEditing(true)
    else if (moves[event.key]) go(moves[event.key], event.shiftKey)
    else return
    event.preventDefault()
  }

  const press = (spot: Spot, event: MouseEvent): void => go(spot, event.shiftKey)
  const shift = (days: number): void => {
    setFrom(addDays(from, days))
    setAnchor(active)
  }
  const activeCell = byKey.get(keyOf(active))

  return (
    <section className="calendar">
      <div className="calendar-bar">
        <Button className="quiet" onClick={() => shift(-DAYS)}>{app.t('ui.earlierDates')}</Button>
        <p className="calendar-window num">{app.fmt.dayMonth(dates[0], app.lang, 'UTC')} – {app.fmt.dayMonth(dates[DAYS - 1], app.lang, 'UTC')}</p>
        <Button className="quiet" onClick={() => shift(DAYS)}>{app.t('ui.laterDates')}</Button>
      </div>
      <div className="calendar-frame">
        <div role="grid" aria-label={app.t('ui.ratesGrid')} aria-multiselectable="true" className="calendar-grid" onKeyDown={onKey}>
          <div role="row" className="cal-row cal-head">
            <div role="columnheader" className="cal-corner" />
            {dates.map((date) => (
              <div key={date} role="columnheader" className="cal-day">
                <span className="cal-weekday">{app.fmt.weekdayName(date, app.lang).slice(0, 3)}</span>
                <span className="num">{Number(date.slice(8, 10))}</span>
              </div>
            ))}
          </div>
          {rows.map((room, r) => (
            <div key={room.code} role="row" className="cal-row">
              <div role="rowheader" className="cal-room">{room.name}</div>
              {dates.map((date, c) => {
                const cell = byKey.get(`${room.code}|${date}`)
                const selected = r >= top && r <= bottom && c >= left && c <= right
                const here = r === active.r && c === active.c
                return (
                  <div
                    key={date} role="gridcell" ref={(element) => void (element ? cells.current.set(`${room.code}|${date}`, element) : cells.current.delete(`${room.code}|${date}`))}
                    data-date={date} data-room-type={room.code} data-rate-minor={cell?.rate_minor} data-allotment={cell?.allotment} data-left={cell?.left}
                    data-closed={cell?.stop_sell || undefined} aria-selected={selected} tabIndex={here ? 0 : -1} className="cal-cell"
                    onMouseDown={(event) => press({ r, c }, event)}
                  >
                    {cell && (
                      <>
                        <Money minor={cell.rate_minor} currency="EUR" className="cal-rate" />
                        <span className="num cal-left">{cell.left}/{cell.allotment}</span>
                        <span className="num cal-stay">{cell.min_stay}–{cell.max_stay}</span>
                        {cell.stop_sell && <Tag kind="black">{app.t('state.closed')}</Tag>}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {editing && activeCell && (
        <EditNights
          code={code} zone={zone} roomTypes={rows.slice(top, bottom + 1).map((room) => room.code)} from={dates[left]} to={dates[right]} cell={activeCell}
          onClose={() => setEditing(false)} onSaved={() => void load(from)}
        />
      )}
    </section>
  )
}
