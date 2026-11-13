import { useCallback, useEffect, useRef, useState } from 'react'
import '../styles/booking.css'
import { isActive } from '../../shared/rules'
import type { Booking, BookingRoom } from '../../shared/types'
import { ApiFailure, get, post } from '../api'
import { CancelDialog, CancellationRegion } from '../components/cancellation'
import { ChangeDialog } from '../components/change-dates'
import { Ledger } from '../components/ledger'
import { NightStrip } from '../components/night-strip'
import { DocumentLink } from '../components/outage'
import { PageTitle } from '../components/page-title'
import { announce, useLive } from '../live'
import { useApp } from '../state'
import { Button, Money, Tag } from '../ui'
import { NotFound } from '../app'

/** The booking page: guest, property clock, rooms, Night Strip, totals, cancellation, ledger and invoice. */
export function BookingPage({ params }: { params: string[] }) {
  const app = useApp()
  const code = params[0]
  const [booking, setBooking] = useState<Booking | null>(null)
  const [missing, setMissing] = useState(false)
  const [dialog, setDialog] = useState<{ rooms: number[]; whole: boolean } | 'change' | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)

  /** Re-reads the booking; only the newest answer is kept. */
  const load = useCallback(async (): Promise<void> => {
    const ticket = ++latest.current
    try {
      const next = await get<Booking>(`/api/bookings/${code}`)
      if (ticket === latest.current) setBooking(next)
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true)
      else throw error
    }
  }, [code])

  useEffect(() => void load(), [load])
  useLive('clock', () => void load())

  const changed = useCallback((next: Booking | null): void => {
    if (next) {
      latest.current += 1
      setBooking(next)
    } else void load()
  }, [load])

  if (missing) return <NotFound />
  if (!booking) return null

  const zone = booking.property.zone
  const live = booking.rooms.filter((room) => isActive(room.state))
  const manager = app.me?.user?.manages.includes(booking.property.code) ?? false
  const roomState = (room: BookingRoom): string => app.t(`room.state.${room.state}`)
  const markNoShow = async (): Promise<void> => {
    setBusy(true)
    try {
      changed(await post<Booking>(`/api/bookings/${code}/no-show`, {}, { headers: { 'If-Match': `"${booking.version}"` } }))
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error
      announce('toast', app.t('change.not_now'))
      changed(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="booking">
      <header className="booking-head">
        <PageTitle>{app.t('ui.booking', { code: booking.code })}</PageTitle>
        <dl className="facts">
          <div><dt>{app.t('ui.guestLine')}</dt><dd>{booking.given_name} {booking.surname}</dd></div>
          <div><dt>{app.t('ui.propertyLine')}</dt><dd>{booking.property.name}</dd></div>
          <div><dt>{app.t('ui.zoneLine')}</dt><dd>{zone}</dd></div>
          <div><dt>{app.t('ui.arrival')}</dt><dd>{app.fmt.longDate(booking.in, app.lang, zone)}</dd></div>
          <div><dt>{app.t('ui.departure')}</dt><dd>{app.fmt.longDate(booking.out, app.lang, zone)}</dd></div>
        </dl>
      </header>

      <section className="rooms" aria-label={app.t('ui.rooms')}>
        <h2>{app.t('ui.rooms')}</h2>
        <ul>
          {booking.rooms.map((room) => (
            <li key={room.n} className="room" data-state={room.state}>
              <div className="room-name">
                <strong>{app.t('ui.roomN', { n: room.n })}</strong>
                <span className="muted">{room.room_type} · {app.t(room.plan === 'refundable' ? 'ui.flexible' : 'ui.nonrefundable')}</span>
              </div>
              <Tag kind={isActive(room.state) ? 'sage' : 'plain'}>{roomState(room)}</Tag>
              <Money minor={room.paid_minor - room.refunded_minor} currency="EUR" className="room-paid" />
              {isActive(room.state) && <Button className="quiet no-print" onClick={() => setDialog({ rooms: [room.n], whole: false })}>{app.t('ui.cancelRoom', { n: room.n })}</Button>}
            </li>
          ))}
        </ul>
      </section>

      <NightStrip nights={booking.nights} currency="EUR" zone={zone} />

      <section className="totals">
        <p className="total-name">{app.t('ui.total')}</p>
        <Money minor={booking.total_minor} currency="EUR" className="booking-total" />
      </section>

      <CancellationRegion booking={booking} />

      {live.length > 0 && (
        <div className="btn-row no-print">
          <Button onClick={() => setDialog({ rooms: live.map((room) => room.n), whole: true })}>{app.t('ui.cancelBooking')}</Button>
          <Button className="quiet" onClick={() => setDialog('change')}>{app.t('ui.changeDates')}</Button>
          {manager && booking.no_show_open && <Button className="quiet" busy={busy} onClick={() => void markNoShow()}>{app.t('ui.markNoShow')}</Button>}
        </div>
      )}

      <Ledger booking={booking} />

      <p><DocumentLink href={`/bookings/${booking.code}/invoice`} name={`${booking.code}.html`}>{app.t('ui.invoice')}</DocumentLink></p>

      <section className="print-only">
        {booking.nights.map((night) => (
          <div key={night.date} className="print-night">
            <p><strong>{app.fmt.longDate(night.date, app.lang, zone)}</strong></p>
            <ul>
              {night.lines.map((line) => <li key={line.key}><span>{app.t(`line.${line.key}`)}</span> <Money minor={line.minor} currency="EUR" /></li>)}
            </ul>
          </div>
        ))}
        <p className="print-total"><strong>{app.t('ui.total')}</strong> <Money minor={booking.total_minor} currency="EUR" /></p>
      </section>

      {dialog === 'change' && <ChangeDialog booking={booking} onClose={() => setDialog(null)} onChanged={changed} />}
      {dialog && dialog !== 'change' && <CancelDialog booking={booking} rooms={dialog.rooms} whole={dialog.whole} onClose={() => setDialog(null)} onChanged={changed} />}
    </div>
  )
}
