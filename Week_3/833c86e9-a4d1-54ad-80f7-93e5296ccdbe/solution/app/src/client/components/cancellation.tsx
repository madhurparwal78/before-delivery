import { useEffect, useState } from 'react'
import type { Booking } from '../../shared/types'
import { ApiFailure, get, post } from '../api'
import { announce } from '../live'
import { useApp } from '../state'
import { Button, Dialog } from '../ui'
import { AmountSentence } from './amount-sentence'
import { titleElement } from './page-title'

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone

/** `region "Cancellation"`: every tier with its deadline in the property's clock and the browser's, then the server's refund status. */
export function CancellationRegion({ booking }: { booking: Booking }) {
  const app = useApp()
  const zone = booking.property.zone
  const { status, tiers } = booking.cancellation
  const moment = (instant: string, at: string): string => app.fmt.moment(instant, at, app.lang)
  const sentence = status.kind === 'none' || !status.until_utc
    ? app.t('refund.none')
    : app.t(status.kind === 'free' ? 'refund.free' : 'refund.partial', { p: status.refund_pct, 'moment in property zone': moment(status.until_utc, zone) })
  return (
    <section aria-label={app.t('ui.cancellation')} className="cancellation sage-field">
      <h2>{app.t('ui.cancellation')}</h2>
      <ul className="tiers">
        {tiers.map((tier) => (
          <li key={tier.deadline_utc}>
            <strong>{tier.kind === 'free' ? app.t('tier.free') : tier.kind === 'none' ? app.t('tier.nonrefundable') : app.t('tier.partial', { p: tier.refund_pct })}</strong>
            <span className="deadline" data-deadline-utc={tier.deadline_utc}>
              {app.t('deadline.line', { 'moment in property zone': moment(tier.deadline_utc, zone), zone, 'moment in browser zone': moment(tier.deadline_utc, browserZone) })}
            </span>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" aria-label={app.t('ui.refundStatus')} className="refund-status">{sentence}</p>
    </section>
  )
}

/** The cancel confirmation: the server's refund figure for the chosen rooms, then Confirm cancellation or Keep booking. */
export function CancelDialog({ booking, rooms, whole, onClose, onChanged }: {
  booking: Booking; rooms: number[]; whole: boolean; onClose: () => void; onChanged: (booking: Booking | null) => void
}) {
  const app = useApp()
  const [refund, setRefund] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void get<{ refund_minor: number }>(`/api/bookings/${booking.code}/cancellations/preview?rooms=${rooms.join(',')}`)
      .then((answer) => !cancelled && setRefund(answer.refund_minor))
      .catch(() => {
        if (cancelled) return
        announce('toast', app.t('change.not_now'))
        onChanged(null)
        onClose()
      })
    return () => {
      cancelled = true
    }
  }, [booking.code, booking.version])

  const cancelChosen = async (): Promise<void> => {
    setBusy(true)
    try {
      const done = await post<{ refund_minor: number; booking: Booking }>(`/api/bookings/${booking.code}/cancellations`, { rooms }, { headers: { 'If-Match': `"${booking.version}"` } })
      announce('toast', app.t('toast.cancelled', { amount: app.money(done.refund_minor, 'EUR') }))
      onChanged(done.booking)
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      announce('toast', app.t('change.not_now'))
      onChanged(null)
    }
    onClose()
  }

  return (
    <Dialog label={app.t(whole ? 'ui.cancelBookingQ' : 'ui.cancelRoomQ')} onClose={onClose} returnTo={titleElement} className="dialog-narrow">
      <div className="bk-dialog" aria-busy={busy || refund === null ? 'true' : undefined}>
        <h2>{app.t(whole ? 'ui.cancelBookingQ' : 'ui.cancelRoomQ')}</h2>
        {refund !== null && <AmountSentence id="refund.amount" minor={refund} className="bk-figure" />}
        <div className="btn-row">
          <Button busy={busy} disabled={refund === null} onClick={() => void cancelChosen()}>{app.t('ui.confirmCancellation')}</Button>
          <Button className="quiet" onClick={onClose}>{app.t('ui.keepBooking')}</Button>
        </div>
      </div>
    </Dialog>
  )
}
