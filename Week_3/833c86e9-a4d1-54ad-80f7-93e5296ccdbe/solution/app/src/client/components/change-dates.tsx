import { useRef, useState } from 'react'
import type { Booking } from '../../shared/types'
import { ApiFailure, newKey, post } from '../api'
import { announce } from '../live'
import { useApp } from '../state'
import { Button, Dialog } from '../ui'
import { AmountSentence } from './amount-sentence'
import { DateGrid } from './date-picker'
import { titleElement } from './page-title'
import { Problems, type Problem } from './problems'
import { reasonText } from './room-advice'

interface Figures { new_total_minor: number; paid_minor: number; pay_minor?: number; refund_minor?: number }
interface Card { number: string; expiry: string; code: string }

const CARD_MESSAGES: Record<string, string> = { declined: 'card.declined', expired: 'card.expired', unknown: 'card.unknown', wrong_code: 'card.wrong_code' }
const grid = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-grid-day][tabindex="0"]')

/** `dialog "Change dates"`: the day grid, then the server's figures and either card fields with Pay or Confirm change. */
export function ChangeDialog({ booking, onClose, onChanged }: { booking: Booking; onClose: () => void; onChanged: (booking: Booking | null) => void }) {
  const app = useApp()
  const zone = booking.property.zone
  const [range, setRange] = useState<{ in: string; out: string } | null>(null)
  const [figures, setFigures] = useState<Figures | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [card, setCard] = useState<Card>({ number: '', expiry: '', code: '' })
  const [stepUp, setStepUp] = useState(false)
  const [stepCode, setStepCode] = useState('')
  const [busy, setBusy] = useState(false)
  const cardRefs = { number: useRef<HTMLInputElement>(null), expiry: useRef<HTMLInputElement>(null), code: useRef<HTMLInputElement>(null) }
  const stepRef = useRef<HTMLInputElement>(null)

  /** Turns a refused request into the Dates problem text, or a card/field problem. */
  const refuse = (failure: ApiFailure): boolean => {
    const { status, body } = failure
    if (status === 422 && body.error === 'restricted') setRefusal(reasonText(app, body.reason, zone))
    else if (status === 422 && body.error === 'nonrefundable') setRefusal(app.t('change.nonrefundable'))
    else if (status === 409 && body.error === 'invalid_state') setRefusal(app.t('change.not_now'))
    else return false
    return true
  }

  const preview = async (next: { in: string; out: string }): Promise<void> => {
    setRange(next)
    setFigures(null)
    setRefusal(null)
    setFields({})
    setStepUp(false)
    try {
      setFigures(await post<Figures>(`/api/bookings/${booking.code}/changes/preview`, next))
    } catch (error) {
      if (!(error instanceof ApiFailure) || !refuse(error)) throw error
    }
  }

  const clientFields = (): Record<string, string> => {
    const found: Record<string, string> = {}
    if (!/^\d{16}$/.test(card.number.replace(/\s/g, ''))) found.number = app.t('field.card')
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(card.expiry)) found.expiry = app.t('field.expiry')
    if (!/^\d{3}$/.test(card.code)) found.code = app.t('field.code')
    return found
  }

  const submit = async (code?: string): Promise<void> => {
    if (!range || !figures) return
    const pays = (figures.pay_minor ?? 0) > 0
    const problems = pays ? clientFields() : {}
    setFields(problems)
    setRefusal(null)
    if (Object.keys(problems).length) return
    setBusy(true)
    const body = pays ? { ...range, card_number: card.number, expiry: card.expiry, security_code: card.code, ...(code ? { step_up_code: code } : {}) } : range
    try {
      const done = await post<Booking>(`/api/bookings/${booking.code}/changes`, body, { headers: { 'If-Match': `"${booking.version}"`, 'Idempotency-Key': newKey() } })
      announce('toast', app.t('toast.changed'))
      onChanged(done)
      onClose()
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      if (error.status === 402) {
        const outcome = String(error.body.outcome)
        if (outcome === 'step_up') setStepUp(true)
        else setFields({ [outcome === 'wrong_code' ? 'step' : 'number']: app.t(CARD_MESSAGES[outcome] ?? 'card.unknown') })
      } else if (error.status === 409 && error.body.error === 'version_conflict') {
        onChanged(null)
        await preview(range)
      } else if (!refuse(error)) throw error
    } finally {
      setBusy(false)
    }
  }

  const problems: Problem[] = [
    ...(refusal ? [{ field: 'dates', label: app.t('ui.dates'), message: refusal, focus: () => grid()?.focus() }] : []),
    ...(['number', 'expiry', 'code'] as const).filter((name) => fields[name]).map((name) => ({
      field: name, label: app.t({ number: 'ui.cardNumber', expiry: 'ui.expiry', code: 'ui.securityCode' }[name]), message: fields[name], focus: () => cardRefs[name].current?.focus(),
    })),
  ]
  const pays = figures !== null && (figures.pay_minor ?? 0) > 0
  const text = (name: 'number' | 'expiry' | 'code', label: string) => (
    <label className="stack">
      <span>{label}</span>
      <input ref={cardRefs[name]} className="field" type="text" inputMode="numeric" autoComplete="off" value={card[name]} onChange={(event) => setCard({ ...card, [name]: event.target.value })} />
    </label>
  )

  return (
    <Dialog label={app.t('ui.changeDates')} onClose={onClose} returnTo={titleElement} className="dialog-change">
      <div className="bk-dialog" aria-busy={busy ? 'true' : undefined}>
        <h2>{app.t('ui.changeDates')}</h2>
        <DateGrid target={{ property: booking.property.code, booking: booking.code }} zone={zone} value={{ in: booking.in, out: booking.out }} onPick={(next) => void preview(next)} />
        <Problems problems={problems} />
        {figures && (
          <div className="bk-figures">
            <AmountSentence id="change.new_total" minor={figures.new_total_minor} className="bk-figure bk-figure-big" />
            <AmountSentence id="change.paid" minor={figures.paid_minor} className="bk-figure" />
            {figures.refund_minor !== undefined && <AmountSentence id="refund.amount" minor={figures.refund_minor} className="bk-figure" />}
            {pays && <AmountSentence id="change.pay" minor={figures.pay_minor as number} className="bk-figure bk-figure-big" />}
          </div>
        )}
        {pays && (
          <div className="bk-card">
            {text('number', app.t('ui.cardNumber'))}
            <div className="bk-pair">{text('expiry', app.t('ui.expiry'))}{text('code', app.t('ui.securityCode'))}</div>
          </div>
        )}
        {stepUp && (
          <div className="bk-card">
            <label className="stack">
              <span>{app.t('ui.code')}</span>
              <input ref={stepRef} className="field" type="text" inputMode="numeric" autoComplete="off" value={stepCode} data-autofocus="" onChange={(event) => setStepCode(event.target.value)} />
              {fields.step && <span className="field-message">{fields.step}</span>}
            </label>
            <Button busy={busy} onClick={() => void submit(stepCode)}>{app.t('ui.confirm')}</Button>
          </div>
        )}
        <div className="btn-row">
          {figures && !pays && <Button busy={busy} onClick={() => void submit()}>{app.t('ui.confirmChange')}</Button>}
          {pays && !stepUp && <Button className="btn-pay" busy={busy} onClick={() => void submit()}>{app.t('ui.pay')}</Button>}
          <Button className="quiet" onClick={onClose}>{app.t('ui.close')}</Button>
        </div>
      </div>
    </Dialog>
  )
}
