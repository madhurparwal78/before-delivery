import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Booking, Invoice } from '../../shared/types';
import { formatAmount, formatHours, stateWords } from '../../shared/format';
import { ApiFailure, api } from '../api';
import type { Session } from '../app';
import { useServices } from '../services';
import { Dialog } from '../ui/Dialog';
import { DataTable, type Column } from '../ui/DataTable';

function blockLabel(booking: Booking): string {
  return booking.blocks.map((block) => block.station).join(', ');
}

function timeLabel(booking: Booking): string {
  if (booking.blocks.length === 0) return '';
  const starts = booking.blocks.map((block) => block.start).sort();
  const ends = booking.blocks.map((block) => block.end).sort();
  return `${starts[0]}–${ends[ends.length - 1]}`;
}

export function BookingsScreen({ session }: { session: Session }): ReactNode {
  const { user, kitchen } = session;
  const dayView = user.role !== 'member';
  const [date, setDate] = useState(kitchen.today);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const services = useServices();

  const reload = useCallback(() => {
    void api
      .bookings(dayView ? date : undefined)
      .then(({ bookings: found }) => {
        const ordered = dayView
          ? [...found].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
          : [...found].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
        setBookings(ordered);
      })
      .catch(() => undefined);
  }, [dayView, date]);

  useEffect(reload, [reload]);

  const selected = useMemo(
    () => bookings.find((booking) => booking.id === selectedId) ?? null,
    [bookings, selectedId],
  );

  useEffect(() => {
    setShowInvoice(false);
    setInvoice(null);
    if (!selected || selected.invoice_id === null) return;
    const invoiceId = selected.invoice_id;
    void api
      .invoice(invoiceId)
      .then(({ invoice: found }) => setInvoice(found))
      .catch(() => undefined);
  }, [selected?.id, selected?.invoice_id]);

  const say = (message: string, error = false): void => {
    setStatus(message);
    setStatusError(error);
  };

  const columns: Column<Booking>[] = [
    { label: 'Reference', render: (row) => <span className="num">{row.ref}</span> },
    { label: 'Date', render: (row) => <span className="num">{row.date}</span> },
    { label: 'Stations', render: blockLabel },
    { label: 'Time', render: (row) => <span className="num">{timeLabel(row)}</span> },
    ...(dayView
      ? [{ label: 'Member', render: (row: Booking) => row.business ?? '' }]
      : []),
    { label: 'Hours', num: true, render: (row) => row.hours },
    { label: 'Total', num: true, render: (row) => row.total },
    {
      label: 'State',
      render: (row) => (
        <span className={`pill${row.state === 'confirmed' ? ' lit' : ''}`}>
          {stateWords(row.state)}
        </span>
      ),
    },
  ];

  const step = (booking: Booking, action: 'check-in' | 'complete' | 'no-show'): void => {
    setBusy(true);
    say('Saving…');
    void api
      .bookingStep(booking.id, action)
      .then(({ booking: updated }) => {
        if (action === 'check-in') say(`Checked in ${updated.business ?? ''}.`);
        else if (action === 'complete') say(`Marked ${updated.ref} completed.`);
        else say(`Marked ${updated.ref} as a no-show.`);
        reload();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.body.error === 'invalid_transition') {
          say(
            `${booking.ref} cannot move from ${stateWords(failure.body.from ?? '')} to ${stateWords(failure.body.to ?? '')}.`,
            true,
          );
        } else if (
          failure instanceof ApiFailure &&
          failure.body.error === 'booking_day_not_reached'
        ) {
          say(`${booking.ref} can only be checked in or marked no-show from its booking day.`, true);
        } else if (failure instanceof ApiFailure) {
          say(failure.message, true);
        }
      })
      .finally(() => setBusy(false));
  };

  const inWindow = (booking: Booking): boolean =>
    Date.now() <= new Date(booking.starts_at).getTime() - booking.cancellation_window_hours * 3600000;

  const cancel = (booking: Booking): void => {
    setBusy(true);
    say('Cancelling…');
    void api
      .cancelBooking(booking.id)
      .then(({ booking: updated, refund }) => {
        setCancelOpen(false);
        if (updated.state === 'cancelled_in_window') {
          say(
            `Booking ${updated.ref} cancelled. ${formatHours(refund.pack_quarters)} pack hours and $${formatAmount(refund.amount_cents)} refunded.`,
          );
        } else {
          say(
            `Booking ${updated.ref} cancelled inside the ${updated.cancellation_window_hours}-hour window, so it is still charged.`,
          );
        }
        reload();
      })
      .catch((failure: unknown) => {
        setCancelOpen(false);
        if (failure instanceof ApiFailure && failure.body.error === 'invalid_transition') {
          say(
            `${booking.ref} cannot move from ${stateWords(failure.body.from ?? '')} to ${stateWords(failure.body.to ?? '')}.`,
            true,
          );
        } else if (failure instanceof ApiFailure && failure.body.error === 'billing_unavailable') {
          say(
            'Billing is unreachable. Confirming, cancelling, recurring slots and pack purchases are paused. Brushing and holds still work.',
            true,
          );
        } else if (failure instanceof ApiFailure && failure.body.error === 'mail_unavailable') {
          say('Email is unreachable. Confirming, cancelling and recurring slots are paused.', true);
        } else if (failure instanceof ApiFailure) {
          say(failure.message, true);
        }
      })
      .finally(() => setBusy(false));
  };

  const canCancel =
    selected !== null &&
    selected.state === 'confirmed' &&
    (user.role === 'operator' || user.member_id === selected.member_id);

  return (
    <div className="page">
      <header>
        <h1>Bookings</h1>
        <p>
          {dayView
            ? 'The day sheet for this kitchen, in kitchen time.'
            : 'Your bookings, upcoming first.'}
        </p>
      </header>

      {dayView && (
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="bookings-date">Date</label>
          <input
            id="bookings-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      )}

      <p role="status" aria-label="Form status" className={`status-line${statusError ? ' error' : ''}`}>
        {status}
      </p>

      <DataTable
        label="Bookings"
        columns={columns}
        rows={bookings}
        rowKey={(row) => row.id}
        selectedKey={selectedId}
        onSelect={(row) => setSelectedId(row.id)}
        empty="No bookings here."
      />

      {selected && (
        <section className="detail" aria-label={`Booking ${selected.ref}`}>
          <h3>{selected.ref}</h3>
          <dl>
            <dt>Date</dt>
            <dd className="num">{selected.date}</dd>
            <dt>Stations</dt>
            <dd>
              {selected.blocks.map((block) => (
                <div key={`${block.station_id}-${block.start}`} className="num">
                  {block.station} {block.start}–{block.end} ({block.hours} h)
                </div>
              ))}
            </dd>
            <dt>Hours</dt>
            <dd className="num">{selected.hours}</dd>
            <dt>Total</dt>
            <dd className="num">{selected.total}</dd>
            <dt>Pack hours used</dt>
            <dd className="num">{formatHours(selected.pack_quarters)}</dd>
            <dt>Rate card</dt>
            <dd className="num">{selected.rate_card_id}</dd>
            <dt>Cancellation window</dt>
            <dd className="num">{selected.cancellation_window_hours} hours</dd>
            <dt>State</dt>
            <dd>{stateWords(selected.state)}</dd>
          </dl>

          <ul className="summary-list">
            {selected.lines.map((line, index) => (
              <li key={index}>
                <span>
                  {line.station} · tier {line.tier} · {line.hours} h
                </span>
                <span className="num">
                  {line.paid_by === 'pack' ? 'pack' : `$${formatAmount(line.amount_cents)}`}
                </span>
              </li>
            ))}
          </ul>

          <div className="actions">
            {canCancel && (
              <button type="button" onClick={() => setCancelOpen(true)}>
                Cancel booking
              </button>
            )}
            {user.role === 'operator' && selected.state === 'confirmed' && (
              <>
                <button type="button" disabled={busy} onClick={() => step(selected, 'check-in')}>
                  Check in
                </button>
                <button type="button" disabled={busy} onClick={() => step(selected, 'no-show')}>
                  Mark no-show
                </button>
              </>
            )}
            {user.role === 'operator' && selected.state === 'checked_in' && (
              <button type="button" disabled={busy} onClick={() => step(selected, 'complete')}>
                Mark completed
              </button>
            )}
            {invoice && (
              <a
                href={`/billing?invoice=${invoice.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  setShowInvoice((value) => !value);
                }}
              >
                Invoice {invoice.ref}
              </a>
            )}
          </div>

          {showInvoice && invoice && (
            <section className="detail" aria-label={`Invoice ${invoice.ref}`}>
              <h4>{invoice.ref}</h4>
              <ul className="summary-list">
                {invoice.lines.map((line, index) => (
                  <li key={index}>
                    <span>
                      {'station' in line
                        ? `${line.station} · tier ${line.tier} · ${line.hours} h`
                        : line.description}
                    </span>
                    <span className="num">${formatAmount(line.amount_cents)}</span>
                  </li>
                ))}
                <li>
                  <strong>Total</strong>
                  <strong className="num">{invoice.total}</strong>
                </li>
              </ul>
              <dl>
                <dt>Billing invoice</dt>
                <dd className="num">{invoice.killbill_invoice_id ?? '—'}</dd>
                <dt>Billing amount</dt>
                <dd className="num">
                  {invoice.billing_amount_cents === null
                    ? '—'
                    : `$${formatAmount(invoice.billing_amount_cents)}`}
                </dd>
              </dl>
            </section>
          )}
        </section>
      )}

      {cancelOpen && selected && (
        <Dialog title="Cancel booking" onClose={() => setCancelOpen(false)}>
          <p>
            {inWindow(selected)
              ? `Cancelling now refunds ${formatHours(selected.pack_quarters)} pack hours and $${formatAmount(selected.total_cents)}.`
              : `This is inside the ${selected.cancellation_window_hours}-hour cancellation window. Cancelling now refunds nothing.`}
          </p>
          <div className="actions">
            <button type="button" onClick={() => setCancelOpen(false)}>
              Keep booking
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || services.paused('cancel_booking')}
              onClick={() => cancel(selected)}
            >
              Yes, cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
