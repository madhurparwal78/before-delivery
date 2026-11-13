import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react'
import '../styles/checkout.css'
import type { Currency } from '../../shared/i18n'
import type { PropertyView, Quote } from '../../shared/types'
import { ApiFailure, api, get, holdPending, newKey, post } from '../api'
import { NightStrip } from '../components/night-strip'
import { PriceDisplayControls, PriceRegion, usePriceDisplay, withParams } from '../components/price-region'
import { Problems, type Problem } from '../components/problems'
import { reasonText } from '../components/room-advice'
import { announce, serverNow, syncServerTime, useLive } from '../live'
import { navigate, useLocation } from '../router'
import { useApp } from '../state'
import { BigWord, Button, Dialog } from '../ui'

type Field = 'given' | 'surname' | 'card' | 'expiry' | 'code'
type Fields = Record<Field, string>

/** The booking fields in page order: the label key, the message key and the server's name for each. */
const FIELDS: { field: Field; label: string; message: string; server: string; autocomplete: string }[] = [
  { field: 'given', label: 'ui.givenName', message: 'field.given', server: 'given_name', autocomplete: 'given-name' },
  { field: 'surname', label: 'ui.surname', message: 'field.surname', server: 'surname', autocomplete: 'family-name' },
  { field: 'card', label: 'ui.cardNumber', message: 'field.card', server: 'card_number', autocomplete: 'cc-number' },
  { field: 'expiry', label: 'ui.expiry', message: 'field.expiry', server: 'expiry', autocomplete: 'cc-exp' },
  { field: 'code', label: 'ui.securityCode', message: 'field.code', server: 'security_code', autocomplete: 'cc-csc' },
]

const VALID: Record<Field, (value: string) => boolean> = {
  given: (value) => value.trim() !== '' && value.length <= 80,
  surname: (value) => value.trim() !== '' && value.length <= 80,
  card: (value) => /^\d{16}$/.test(value.replace(/ /g, '')),
  expiry: (value) => /^(0[1-9]|1[0-2])\/\d{2}$/.test(value),
  code: (value) => /^\d{3}$/.test(value),
}

const THRESHOLDS = [300000, 120000, 60000]

interface Hold { id: string; expiresAt: number }
type Dialogs = { kind: 'ended' } | { kind: 'price'; old: number; new: number; currency: Currency } | { kind: 'taken' } | null

const mmss = (ms: number): string => {
  const seconds = Math.ceil(ms / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/** Milliseconds left on the hold by the server clock; recomputed on clock events and every second, announcing 5, 2 and 1 minutes. */
function useRemaining(expiresAt: number | null): number | null {
  const app = useApp()
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const previous = useRef<number | null>(null)
  const t = useRef(app.t)
  t.current = app.t

  const recompute = (): void => {
    if (expiresAt === null) return
    const left = Math.max(0, expiresAt - serverNow())
    const crossed = THRESHOLDS.filter((limit) => previous.current !== null && previous.current > limit && left <= limit)
    if (crossed.length) announce('hold', t.current('hold.minutes', { 'count:minute': Math.min(...crossed) / 60000 }))
    previous.current = left
    rerender()
  }
  const latest = useRef(recompute)
  latest.current = recompute

  useEffect(() => {
    previous.current = null
    latest.current()
    const timer = setInterval(() => latest.current(), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  useLive('clock', () => latest.current())

  return expiresAt === null ? null : Math.max(0, expiresAt - serverNow())
}

export function CheckoutPage({ params }: { params: string[] }) {
  const app = useApp()
  const loc = useLocation()
  const { taxes } = usePriceDisplay()
  const [quoteId, setQuoteId] = useState(params[0])
  const [quote, setQuote] = useState<Quote | null>(null)
  const [view, setView] = useState<PropertyView | null>(null)
  const [missing, setMissing] = useState(false)
  const [hold, setHold] = useState<Hold | null>(null)
  const [dialog, setDialog] = useState<Dialogs>(null)
  const [fields, setFields] = useState<Fields>({ given: '', surname: '', card: '', expiry: '', code: '' })
  const [problems, setProblems] = useState<Problem[]>([])
  const [advice, setAdvice] = useState('')
  const [reserving, setReserving] = useState(false)
  const [paying, setPaying] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [stepUp, setStepUp] = useState<{ code: string; error: string } | null>(null)
  const [tick, setTick] = useState(0)
  const pinned = useRef<Quote['currency'] | null>(null)
  const latest = useRef({ hold, quote, reserving: false, paying: false })
  latest.current = { ...latest.current, hold, quote }
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useRef<'pay' | 'given' | null>(null)
  const remaining = useRemaining(hold ? hold.expiresAt : null)

  /* The booking page's own ending: the dialogs never replace a hold ended, and each state shows once. */
  const show = (next: NonNullable<Dialogs>): void => setDialog((now) => (now?.kind === 'ended' ? now : next))

  /* Reads the quote in the display currency; without a hold, a night that is closed means the rooms are gone. */
  useEffect(() => {
    const release = holdPending()
    void (async () => {
      try {
        let read: Quote
        if (pinned.current === null) {
          const own = await get<Quote>(`/api/quotes/${quoteId}`)
          pinned.current = own.currency
          read = own.currency === app.cur ? own : await get<Quote>(`/api/quotes/${quoteId}?cur=${app.cur}`)
          setView(await get<PropertyView>(`/api/properties/${own.property}`))
        } else {
          read = await get<Quote>(`/api/quotes/${quoteId}?cur=${app.cur}`)
        }
        setQuote(read)
        if (!latest.current.hold && !latest.current.reserving && read.nights.some((night) => night.state === 'closed')) show({ kind: 'taken' })
      } catch (error) {
        if (!(error instanceof ApiFailure && error.status === 404)) throw error
        setMissing(true)
      } finally {
        release()
      }
    })()
  }, [quoteId, app.cur, tick])

  useLive('availability', (event) => {
    if (event.property === latest.current.quote?.property) setTick((n) => n + 1)
  })
  useLive('quote.changed', (event) => {
    if (event.quote_id === quoteId) show({ kind: 'price', old: event.old_total_minor, new: event.new_total_minor, currency: pinned.current ?? quote?.currency ?? app.cur })
  })
  useLive('hold.expired', (event) => {
    if (event.hold_id === latest.current.hold?.id) setDialog({ kind: 'ended' })
  })

  const loaded = quote !== null && view !== null
  useEffect(() => {
    if (loaded) heading.current?.focus()
  }, [loaded])

  useEffect(() => {
    if (dialog || accepting || !focusAfter.current) return
    const target = focusAfter.current === 'pay' ? document.getElementById('pay') : document.getElementById('field-given')
    focusAfter.current = null
    target?.focus()
  }, [dialog, hold, accepting])

  if (missing) return <BigWord word={app.t('empty.results.word')} sentence={app.t('page.missing')} />
  if (!quote || !view) return <div className="checkout" aria-busy="true" />

  const names = Object.fromEntries(view.room_types.map((room) => [room.code, room.name]))
  const label = (field: Field): string => app.t(FIELDS.find((entry) => entry.field === field)?.label as string)
  const problem = (field: Field, message: string): Problem => ({ field: `field-${field}`, label: label(field), message, focus: () => document.getElementById(`field-${field}`)?.focus() })
  const datesProblem = (message: string): Problem => ({ field: 'dates', label: app.t('ui.dates'), message, focus: () => document.querySelector<HTMLElement>('.night-strip [data-date]')?.focus() })
  const errorOf = (field: Field): string => problems.find((entry) => entry.field === `field-${field}`)?.message ?? ''

  const searchAgain = (release: boolean): void => {
    const to = `/search?${withParams(typeof loc.state.search === 'string' ? loc.state.search : '', { lang: app.lang, cur: app.cur })}`
    if (release && hold) void api('DELETE', `/api/holds/${hold.id}`).catch(() => undefined).then(() => navigate(to))
    else navigate(to)
  }

  const reserve = async (): Promise<void> => {
    latest.current.reserving = true
    setReserving(true)
    try {
      const made = await post<{ id: string; expires_at: string }>('/api/holds', { quote_id: quote.id })
      await syncServerTime()
      focusAfter.current = 'given'
      setHold({ id: made.id, expiresAt: Date.parse(made.expires_at) })
      setTick((n) => n + 1)
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      if (error.status === 409) show({ kind: 'taken' })
      else if (error.status === 410) show({ kind: 'price', old: quote.converted_total_minor, new: quote.converted_total_minor, currency: quote.currency })
      else if (error.body.error === 'restricted') setAdvice(reasonText(app, error.body.reason, view.zone))
    } finally {
      latest.current.reserving = false
      setReserving(false)
    }
  }

  /* Re-quotes the same rooms at today's prices; the hold, if any, moves to the new quote. The dialog closes at once and Pay waits for the reply. */
  const accept = async (): Promise<void> => {
    setAccepting(true)
    setDialog(null)
    try {
      const next = await post<Quote>('/api/quotes', {
        property: quote.property, in: quote.in, out: quote.out, currency: app.cur, hold_id: hold?.id,
        rooms: quote.rooms.map((room) => ({ room_type: room.room_type, plan: room.plan, breakfast: room.breakfast, adults: room.adults, ages: room.ages })),
      })
      pinned.current = next.currency
      /* The page keeps its fields, so only the address changes; the router would remount the page for a new path. */
      history.replaceState(history.state, '', `/checkout/${next.id}${window.location.search}`)
      setQuoteId(next.id as string)
      setQuote(next)
      focusAfter.current = 'pay'
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      show({ kind: 'taken' })
    } finally {
      setAccepting(false)
    }
  }

  const fail = (error: ApiFailure): void => {
    const { status, body } = error
    if (status === 402 && body.outcome === 'step_up') setStepUp({ code: '', error: '' })
    else if (status === 402 && body.outcome === 'wrong_code') setStepUp((now) => now && { ...now, error: app.t('card.wrong_code') })
    else if (status === 402) setProblems([problem('card', app.t(`card.${body.outcome}`))])
    else if (status === 410) setDialog({ kind: 'ended' })
    else if (status === 409 && body.error === 'price_changed') show({ kind: 'price', old: body.old_total_minor, new: body.new_total_minor, currency: pinned.current ?? quote.currency })
    else if (status === 422 && body.error === 'restricted') setProblems([datesProblem(reasonText(app, body.reason, view.zone))])
    else if (status === 422) {
      setProblems(FIELDS.filter((entry) => body.fields[entry.server]).map((entry) => problem(entry.field, app.t(entry.message))))
    }
  }

  const pay = async (code?: string): Promise<void> => {
    if (!hold || latest.current.paying) return
    if (code === undefined) {
      const found = FIELDS.filter((entry) => !VALID[entry.field](fields[entry.field]))
      if (found.length) return setProblems(found.map((entry) => problem(entry.field, app.t(entry.message))))
    }
    latest.current.paying = true
    setPaying(true)
    setProblems([])
    try {
      const booking = await post<{ code: string }>('/api/bookings', {
        hold_id: hold.id, quote_id: quote.id, given_name: fields.given, surname: fields.surname, card_number: fields.card, expiry: fields.expiry,
        security_code: fields.code, ...(code === undefined ? {} : { step_up_code: code }),
      }, { headers: { 'Idempotency-Key': newKey() } })
      navigate(`/bookings/${booking.code}`, { replace: true })
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      fail(error)
    } finally {
      latest.current.paying = false
      setPaying(false)
    }
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void pay()
  }

  return (
    <div className="checkout">
      <header className="checkout-head">
        <h1 ref={heading} tabIndex={-1}>{view.name}</h1>
        <p className="muted">{app.fmt.longDate(quote.in, app.lang, view.zone)} / {app.fmt.longDate(quote.out, app.lang, view.zone)}</p>
      </header>

      <NightStrip nights={quote.nights} currency={quote.currency} taxes={taxes} zone={view.zone} />
      <PriceDisplayControls />

      <div className="checkout-body">
        <div className="checkout-main">
          <section className="room-summary">
            {quote.rooms.map((room, i) => (
              <p key={i} className="room-line">
                <strong>{app.t('ui.roomN', { n: i + 1 })}</strong>
                <span>{names[room.room_type]}</span>
                <span>{app.t(room.plan === 'refundable' ? 'ui.flexible' : 'ui.nonrefundable')}</span>
                {room.breakfast && <span>{app.t('line.breakfast')}</span>}
                <span className="muted">{app.t('ui.adults')} {room.adults}{room.ages.length ? `, ${app.t('ui.children')} ${room.ages.join(', ')}` : ''}</span>
              </p>
            ))}
            <p role="status" aria-live="polite" aria-label={app.t('ui.roomAdvice')} className="advice">{advice}</p>
          </section>

          {hold && remaining !== null && (
            <div className="hold-band">
              <span className="hold-label">{app.t('ui.timeLeft')}</span>
              <span role="timer" aria-label={app.t('ui.timeLeft')} className="hold-time">{mmss(remaining)}</span>
            </div>
          )}

          <Problems problems={problems} takeFocus />

          <form onSubmit={submit} noValidate className="pay-form">
            <fieldset disabled={!hold} className="pay-fields">
              {FIELDS.map((entry) => (
                <label key={entry.field} className={`stack field-${entry.field}`}>
                  <span>{app.t(entry.label)}</span>
                  <input
                    id={`field-${entry.field}`} type="text" className="field" value={fields[entry.field]} autoComplete={entry.autocomplete}
                    inputMode={entry.field === 'card' || entry.field === 'code' ? 'numeric' : undefined} aria-describedby={errorOf(entry.field) ? `error-${entry.field}` : undefined}
                    onChange={(event) => setFields({ ...fields, [entry.field]: event.target.value })}
                  />
                  {errorOf(entry.field) && <span id={`error-${entry.field}`} className="field-error">{errorOf(entry.field)}</span>}
                </label>
              ))}
            </fieldset>
            <Button id="pay" type="submit" className="btn-pay" busy={paying || accepting} disabled={!hold}>{app.t('ui.pay')}</Button>
          </form>
        </div>

        <PriceRegion quote={quote}>
          {!hold && <Button className="btn-accent" busy={reserving} onClick={() => void reserve()}>{app.t('ui.reserve')}</Button>}
        </PriceRegion>
      </div>

      <Dialog label={app.t('ui.confirmPayment')} open={stepUp !== null} onClose={() => setStepUp(null)}>
        <form onSubmit={(event) => { event.preventDefault(); void pay(stepUp?.code) }} noValidate className="step-up">
          <label className="stack">
            <span>{app.t('ui.code')}</span>
            <input
              type="text" className="field" data-autofocus="" autoComplete="one-time-code" inputMode="numeric" value={stepUp?.code ?? ''}
              aria-describedby={stepUp?.error ? 'error-step-up' : undefined} onChange={(event) => setStepUp({ code: event.target.value, error: '' })}
            />
            {stepUp?.error && <span id="error-step-up" className="field-error">{stepUp.error}</span>}
          </label>
          <Button type="submit" className="btn-pay" busy={paying}>{app.t('ui.confirm')}</Button>
        </form>
      </Dialog>

      {dialog?.kind === 'ended' && (
        <Dialog alert label={app.t('ui.holdEnded')}>
          <p>{app.t('hold.ended')}</p>
          <Button onClick={() => searchAgain(false)}>{app.t('ui.searchAgain')}</Button>
        </Dialog>
      )}
      {dialog?.kind === 'price' && (
        <Dialog alert label={app.t('ui.priceChanged')}>
          <p>{dialog.old === dialog.new ? app.t('price.refreshed', { new: app.money(dialog.new, dialog.currency) }) : app.t('price.changed', { old: app.money(dialog.old, dialog.currency), new: app.money(dialog.new, dialog.currency) })}</p>
          <div className="dialog-actions">
            <Button className="btn-accent" busy={accepting} onClick={() => void accept()}>{app.t('ui.acceptNewPrice')}</Button>
            <Button className="quiet" onClick={() => searchAgain(true)}>{app.t('ui.keepSearching')}</Button>
          </div>
        </Dialog>
      )}
      {dialog?.kind === 'taken' && (
        <Dialog alert label={app.t('ui.justTaken')}>
          <p>{app.t('just.taken')}</p>
          <div className="dialog-actions">
            <Button onClick={() => searchAgain(true)}>{app.t('ui.keepSearching')}</Button>
            <Button className="quiet" onClick={() => searchAgain(false)}>{app.t('ui.searchAgain')}</Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
