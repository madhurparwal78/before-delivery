import { useEffect, useRef, useState } from 'react'
import '../styles/property.css'
import { daysBetween, isRealDay } from '../../shared/dates'
import { MAX_ROOMS } from '../../shared/rules'
import type { Plan, PropertyView, Quote, RoomChoiceRoom } from '../../shared/types'
import { ApiFailure, get, holdPending, post, query } from '../api'
import { Choice } from '../components/choice'
import { DatePicker } from '../components/date-picker'
import { Facts } from '../components/facts'
import { Gallery } from '../components/gallery'
import { NightStrip } from '../components/night-strip'
import { PriceDisplayControls, PriceRegion, usePriceDisplay, withParams } from '../components/price-region'
import { adviceText, reasonText } from '../components/room-advice'
import { useLive } from '../live'
import { navigate, useLocation } from '../router'
import { useApp } from '../state'
import { BigWord, Button, Spinbutton, Tag } from '../ui'


interface Selection { rooms: RoomChoiceRoom[]; plan: Plan[]; breakfast: boolean[] }

const countsOf = (rooms: RoomChoiceRoom[]): Record<string, number> =>
  rooms.reduce<Record<string, number>>((counts, room) => ({ ...counts, [room.room_type]: (counts[room.room_type] ?? 0) + 1 }), {})

const sameCounts = (a: Record<string, number>, b: Record<string, number>): boolean =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((code) => (a[code] ?? 0) === (b[code] ?? 0))

/** A selection for these rooms; plan and breakfast carry over by room position. */
const select = (rooms: RoomChoiceRoom[], previous: Selection | null): Selection => ({
  rooms,
  plan: rooms.map((_, i) => previous?.plan[i] ?? 'refundable'),
  breakfast: rooms.map((_, i) => previous?.breakfast[i] ?? false),
})

export function PropertyPage({ params }: { params: string[] }) {
  const code = params[0]
  const app = useApp()
  const loc = useLocation()
  const search = new URLSearchParams(loc.search)
  const din = search.get('in') ?? ''
  const dout = search.get('out') ?? ''
  const adults = Number(search.get('adults') ?? 2)
  const agesText = search.get('ages') ?? ''
  const ages = agesText ? agesText.split(',').map(Number) : []
  const dated = isRealDay(din) && isRealDay(dout) && dout > din
  const { display, taxes } = usePriceDisplay()

  const [view, setView] = useState<PropertyView | null>(null)
  const [missing, setMissing] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [pending, setPending] = useState<Record<string, number> | null>(null)
  const [advice, setAdvice] = useState('')
  const [busy, setBusy] = useState(false)
  const [reserving, setReserving] = useState(false)
  const [picking, setPicking] = useState(false)
  const [tick, setTick] = useState(0)
  const current = useRef<{ key: string; selection: Selection | null }>({ key: '', selection: null })
  const sequence = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)

  const stay = (chosen: Selection) => ({
    property: code, in: din, out: dout, currency: app.cur, adults, ages,
    rooms: chosen.rooms.map((room, i) => ({ room_type: room.room_type, plan: chosen.plan[i], breakfast: chosen.breakfast[i], adults: room.adults, ages: room.ages })),
  })

  /* Reads the property and prices the selection: the one kept for these dates, else the recommendation. */
  useEffect(() => {
    const release = holdPending()
    const mine = ++sequence.current
    const key = [code, din, dout, adults, agesText].join('|')
    void (async () => {
      try {
        const next = await get<PropertyView>(`/api/properties/${code}?${query({ in: din, out: dout, adults, ages: agesText, cur: app.cur })}`)
        let chosen: Selection | null = null
        let priced: Quote | null = null
        const kept = current.current.key === key ? current.current.selection : null
        if (dated && (next.recommendation || kept)) {
          const recommended = next.recommendation ? select(next.recommendation.rooms, current.current.selection) : null
          for (const candidate of [kept, recommended].filter((option): option is Selection => option !== null)) {
            try {
              priced = await post<Quote>('/api/quotes/preview', stay(candidate))
              chosen = candidate
              break
            } catch (error) {
              if (!(error instanceof ApiFailure)) throw error
            }
          }
        }
        if (mine !== sequence.current) return
        current.current = { key, selection: chosen }
        setView(next)
        setSelection(chosen)
        setQuote(priced)
      } catch (error) {
        if (!(error instanceof ApiFailure && error.status === 404)) throw error
        setMissing(true)
      } finally {
        release()
      }
    })()
  }, [code, din, dout, adults, agesText, app.cur, tick])

  useLive('availability', (event) => {
    if (event.property === code) setTick((n) => n + 1)
  })
  useLive('quote.changed', () => setTick((n) => n + 1))

  const loaded = view !== null
  useEffect(() => {
    if (loaded) heading.current?.focus()
  }, [loaded])

  if (missing) return <BigWord word={app.t('empty.results.word')} sentence={app.t('page.missing')} />
  if (!view) return <div className="property" aria-busy="true" />

  const names = Object.fromEntries(view.room_types.map((room) => [room.code, room.name]))
  const counts = pending ?? (selection ? countsOf(selection.rooms) : {})
  const recommended = Boolean(selection && view.recommendation && sameCounts(countsOf(selection.rooms), countsOf(view.recommendation.rooms)))

  /* A new selection prices at once; only the latest answer is shown. */
  const adjust = async (next: Selection): Promise<void> => {
    const mine = ++sequence.current
    current.current.selection = next
    setSelection(next)
    try {
      const priced = await post<Quote>('/api/quotes/preview', stay(next))
      if (mine === sequence.current) setQuote(priced)
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
    }
  }

  /* Asks the server to place the party in the chosen rooms; a refusal keeps the previous selection and prices. */
  const override = async (room: string, n: number): Promise<void> => {
    if (!selection) return
    const wanted = { ...countsOf(selection.rooms), [room]: n }
    const mine = ++sequence.current
    setPending(wanted)
    setBusy(true)
    try {
      const placed = await post<{ rooms: RoomChoiceRoom[] }>('/api/allocations', { property: code, in: din, out: dout, adults, ages, counts: wanted })
      const next = select(placed.rooms, selection)
      const priced = await post<Quote>('/api/quotes/preview', stay(next))
      if (mine !== sequence.current) return
      current.current.selection = next
      setSelection(next)
      setQuote(priced)
      setAdvice('')
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      if (error.body.error === 'room_advice') setAdvice(adviceText(app, error.body.advice, names))
      else if (error.body.error === 'restricted') setAdvice(reasonText(app, error.body.reason, view.zone))
    } finally {
      setPending(null)
      setBusy(false)
    }
  }

  const restoreRecommended = (): void => {
    if (!selection || !view.recommendation) return
    setAdvice('')
    void adjust(select(view.recommendation.rooms, selection))
  }

  const setPlan = (room: number, plan: Plan): void => {
    if (selection) void adjust({ ...selection, plan: selection.plan.map((was, at) => (at === room ? plan : was)) })
  }

  const setBreakfast = (room: number, on: boolean): void => {
    if (selection) void adjust({ ...selection, breakfast: selection.breakfast.map((was, at) => (at === room ? on : was)) })
  }

  const reserve = async (): Promise<void> => {
    if (!selection) return
    setReserving(true)
    try {
      const saved = await post<Quote>('/api/quotes', stay(selection))
      const carried = withParams('', { lang: app.lang, cur: app.cur, display: display === 'night' ? 'night' : null, tax: taxes ? null : '0' })
      navigate(`/checkout/${saved.id}?${carried}`, { state: { search: loc.search } })
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      if (error.body.error === 'restricted') setAdvice(reasonText(app, error.body.reason, view.zone))
    } finally {
      setReserving(false)
    }
  }

  const datesLabel = dated
    ? app.t('ui.datesRange', { in: app.fmt.dayMonth(din, app.lang, view.zone), out: app.fmt.dayMonth(dout, app.lang, view.zone), 'count:night': daysBetween(din, dout) })
    : app.t('ui.dates')

  return (
    <div className="property">
      <div className="property-main">
        <header className="property-head">
          <h1 ref={heading} tabIndex={-1}>{view.name}</h1>
          <p className="meta">
            <Facts stars={view.stars} score={view.score} distanceKm={view.distance_km} />
          </p>
          <p className="muted">{view.amenities.map((amenity) => app.t(`amen.${amenity}`)).join(', ')}</p>
          <Button className="quiet dates" onClick={() => setPicking(true)}>{datesLabel}</Button>
          <DatePicker
            open={picking} onClose={() => setPicking(false)} target={{ property: code }} zone={view.zone} value={{ in: dated ? din : null, out: dated ? dout : null }}
            onPick={(range) => navigate(`${loc.path}?${withParams(loc.search, { in: range.in, out: range.out })}`)}
          />
        </header>

        {dated && !selection && <BigWord word={app.t('empty.sold.word')} sentence={app.t('empty.sold')} />}

        {selection && quote && (
          <>
            <section className="rooms">
              <div role="group" aria-label={app.t('ui.rooms')} aria-busy={busy ? 'true' : undefined} className="rooms-group">
                <div className="rooms-head">
                  {recommended && <Tag kind="plain">{app.t('ui.recommended')}</Tag>}
                  <Button className="quiet" onClick={restoreRecommended}>{app.t('ui.useRecommended')}</Button>
                </div>
                {view.room_types.map((room) => (
                  <div key={room.code} className="room-type">
                    <span className="room-name">{room.name}</span>
                    <Spinbutton
                      label={app.t('ui.roomsSpin', { 'room type name': room.name })} value={counts[room.code] ?? 0} min={0}
                      max={MAX_ROOMS - Object.entries(counts).reduce((sum, [type, n]) => sum + (type === room.code ? 0 : n), 0)}
                      onChange={(n) => void override(room.code, n)}
                    />
                  </div>
                ))}
              </div>
              <p role="status" aria-live="polite" aria-label={app.t('ui.roomAdvice')} className="advice">{advice}</p>
            </section>

            <section className="room-options">
              {selection.rooms.map((room, i) => (
                <div key={i} className="room-option">
                  <p className="room-title">{app.t('ui.roomN', { n: i + 1 })} <span className="muted">{names[room.room_type]}</span></p>
                  <div role="radiogroup" aria-label={app.t('ui.rateFor', { n: i + 1 })} className="choices">
                    <Choice type="radio" name={`rate-${i}`} checked={selection.plan[i] === 'refundable'} onChange={() => setPlan(i, 'refundable')}>{app.t('ui.flexible')}</Choice>
                    <Choice type="radio" name={`rate-${i}`} checked={selection.plan[i] === 'nonrefundable'} onChange={() => setPlan(i, 'nonrefundable')}>{app.t('ui.nonrefundable')}</Choice>
                  </div>
                  <Choice type="checkbox" checked={selection.breakfast[i]} onChange={(on) => setBreakfast(i, on)}>{app.t('ui.breakfastFor', { n: i + 1 })}</Choice>
                </div>
              ))}
            </section>

            <section className="strip-section">
              <PriceDisplayControls />
              <NightStrip nights={quote.nights} currency={quote.currency} taxes={taxes} zone={view.zone} />
            </section>
          </>
        )}

        <div className="pictures-row"><Gallery pictures={view.pictures} /></div>
      </div>

      {selection && quote && (
        <PriceRegion quote={quote}>
          <Button className="btn-accent" busy={reserving} disabled={busy} onClick={() => void reserve()}>{app.t('ui.reserve')}</Button>
        </PriceRegion>
      )}
    </div>
  )
}
