import { useCallback, useEffect, useRef, useState } from 'react';
import { apiDownload, apiGet, apiSend, saveBlob } from '../api';
import { useFeedback } from '../feedback';
import { Dialog } from '../components/Dialog';
import { formatAmount, formatClock, formatHoursMinutes } from '../kitchenTime';
import type { Booking, DialStation, User } from '../types';

const STATUS_WORDS: Record<Booking['status'], string> = {
  held: 'Held',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

const PAYMENT_WORDS: Record<string, string> = {
  account: 'Account',
  hour_pack: 'Hour pack',
};

export function BookingsScreen({ user }: { user: User }): JSX.Element {
  const { perform, background, fieldErrors } = useFeedback();
  const [query, setQuery] = useState('');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stations, setStations] = useState<Map<string, string>>(new Map());
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [checkOutTarget, setCheckOutTarget] = useState<Booking | null>(null);
  const first = useRef(true);

  const load = useCallback(
    async (search: string, announce: boolean): Promise<void> => {
      const run = (): Promise<{ bookings: Booking[] }> =>
        apiGet<{ bookings: Booking[] }>(
          `/api/bookings${search ? `?q=${encodeURIComponent(search)}` : ''}`,
        );
      const result = announce
        ? await perform({ pending: first.current ? 'Loading…' : 'Searching…', success: () => '', run })
        : await background({ run });
      if (result) setBookings(result.bookings);
      first.current = false;
    },
    [perform, background],
  );

  useEffect(() => {
    void apiGet<{ date: string; stations: DialStation[] }>('/api/dial')
      .then((day) => setStations(new Map(day.stations.map((s) => [s.id, s.name]))))
      .catch(() => setStations(new Map()));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query, true), first.current ? 0 : 250);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  const refresh = (): void => void load(query, false);

  const exportCsv = async (): Promise<void> => {
    const result = await perform({
      pending: 'Preparing export…',
      success: () => 'Export downloaded.',
      run: () =>
        apiDownload(`/api/bookings/export${query ? `?q=${encodeURIComponent(query)}` : ''}`),
    });
    if (result) saveBlob(result.blob, result.fileName);
  };

  const checkIn = async (booking: Booking): Promise<void> => {
    const stationName = stations.get(booking.station_id) ?? booking.station_id;
    await perform({
      pending: 'Checking in…',
      success: () => `Checked in to ${stationName} at ${formatClock()}.`,
      errors: (failure) => {
        if (failure.code === 'outside_check_in_window') {
          return "Check-in isn't open for this booking yet, or it has ended.";
        }
        if (failure.code === 'tenant_not_active') {
          return 'Check-in is blocked: a required document has expired.';
        }
        return null;
      },
      run: () => apiSend<Booking>('POST', `/api/bookings/${booking.id}/check-in`, {}),
    });
    refresh();
  };

  const checkOut = async (booking: Booking, minutes: number): Promise<void> => {
    const result = await perform({
      pending: 'Checking out…',
      success: (updated: Booking) =>
        updated.holdover && updated.holdover.billed_minutes > 0
          ? `Checked out. Hold-over billed: ${updated.holdover.billed_minutes} min (${formatAmount(updated.holdover.amount_cents)}).`
          : 'Checked out. No hold-over billed.',
      errors: (failure) => {
        if (failure.code === 'validation_failed') return 'Enter whole minutes from 0 to 240.';
        if (failure.code === 'billing_unavailable') {
          return 'Billing is unreachable. Nothing was charged; try again in a moment.';
        }
        if (failure.code === 'mail_unavailable') {
          return 'Email is unreachable. Nothing was recorded; try again in a moment.';
        }
        return null;
      },
      run: () =>
        apiSend<Booking>('POST', `/api/bookings/${booking.id}/check-out`, {
          holdover_minutes: minutes,
        }),
    });
    if (result) setCheckOutTarget(null);
    refresh();
  };

  const cancel = async (booking: Booking): Promise<void> => {
    const result = await perform({
      pending: 'Cancelling…',
      success: (updated: Booking) => {
        const outcome = updated.cancellation;
        if (!outcome || !outcome.late) return `Booking ${updated.ref} cancelled. No charge.`;
        if (updated.pay_with === 'hour_pack') {
          return `Booking ${updated.ref} cancelled. ${formatHoursMinutes(outcome.fee_minutes)} kept from your hour pack.`;
        }
        return `Booking ${updated.ref} cancelled. Late cancellation charge: ${formatAmount(outcome.fee_cents)}.`;
      },
      errors: (failure) => {
        if (failure.code === 'already_started') {
          return "This booking has started and can't be cancelled.";
        }
        if (failure.code === 'billing_unavailable') {
          return 'Billing is unreachable. Nothing was charged; try again in a moment.';
        }
        return null;
      },
      run: () => apiSend<Booking>('POST', `/api/bookings/${booking.id}/cancel`, {}),
    });
    if (result) setCancelTarget(null);
    refresh();
  };

  const noShow = async (booking: Booking): Promise<void> => {
    await perform({
      pending: 'Saving…',
      success: () => `Booking ${booking.ref} marked as a no-show.`,
      errors: (failure) =>
        failure.code === 'not_started' ? "This booking hasn't started yet." : null,
      run: () => apiSend<Booking>('POST', `/api/bookings/${booking.id}/no-show`, {}),
    });
    refresh();
  };

  const refundFee = async (booking: Booking): Promise<void> => {
    await perform({
      pending: 'Refunding fee…',
      success: () => `Late fee on ${booking.ref} refunded.`,
      errors: (failure) => {
        if (failure.code === 'invalid_transition' || failure.code === 'fee_invoiced') {
          return 'That fee is already refunded or invoiced.';
        }
        if (failure.code === 'billing_unavailable') {
          return 'Billing is unreachable. Nothing was refunded; try again in a moment.';
        }
        return null;
      },
      run: () => apiSend<Booking>('POST', `/api/bookings/${booking.id}/refund-fee`, {}),
    });
    refresh();
  };

  const operator = user.role === 'operator';

  return (
    <div>
      <h1>Bookings</h1>
      <div className="inline-form">
        <div className="field">
          <label htmlFor="booking-search">Search bookings</label>
          <input
            id="booking-search"
            type="search"
            placeholder={operator ? 'Ref, notes or business' : 'Ref or notes'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button type="button" onClick={() => void exportCsv()}>
          Export CSV
        </button>
      </div>

      <div className="table-wrap">
        <table role="table" aria-label="Bookings">
          <thead role="rowgroup">
            <tr role="row">
              {operator ? <th role="columnheader">Tenant</th> : null}
              <th role="columnheader">Ref</th>
              <th role="columnheader">Station</th>
              <th role="columnheader">Date</th>
              <th role="columnheader">Start</th>
              <th role="columnheader">End</th>
              <th role="columnheader">Status</th>
              <th role="columnheader">Payment</th>
              <th role="columnheader">Amount</th>
              <th role="columnheader">Policy</th>
              <th role="columnheader">Actions</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {bookings.map((booking) => (
              <tr role="row" key={booking.id}>
                {operator ? (
                  <td role="cell" data-label="Tenant">
                    {booking.tenant_name}
                  </td>
                ) : null}
                <td role="cell" data-label="Ref" className="num">
                  {booking.ref}
                </td>
                <td role="cell" data-label="Station">
                  {stations.get(booking.station_id) ?? booking.station_id}
                </td>
                <td role="cell" data-label="Date" className="num">
                  {booking.date}
                </td>
                <td role="cell" data-label="Start" className="num">
                  {booking.start_local}
                </td>
                <td role="cell" data-label="End" className="num">
                  {booking.end_local}
                </td>
                <td role="cell" data-label="Status">
                  {STATUS_WORDS[booking.status]}
                </td>
                <td role="cell" data-label="Payment">
                  {booking.pay_with ? PAYMENT_WORDS[booking.pay_with] : ''}
                </td>
                <td role="cell" data-label="Amount" className="num">
                  {booking.amount_cents === null ? '' : formatAmount(booking.amount_cents)}
                </td>
                <td role="cell" data-label="Policy" className="num">
                  {booking.policy ? `v${booking.policy.version}` : ''}
                </td>
                <td role="cell" data-label="Actions">
                  <div className="row-actions">
                    {booking.status === 'confirmed' ? (
                      <button type="button" onClick={() => void checkIn(booking)}>
                        Check in {booking.ref}
                      </button>
                    ) : null}
                    {booking.status === 'checked_in' ? (
                      <button type="button" onClick={() => setCheckOutTarget(booking)}>
                        Check out {booking.ref}
                      </button>
                    ) : null}
                    {booking.status === 'confirmed' && user.role !== 'cook' ? (
                      <button type="button" onClick={() => setCancelTarget(booking)}>
                        Cancel {booking.ref}
                      </button>
                    ) : null}
                    {operator && booking.status === 'confirmed' ? (
                      <button type="button" onClick={() => void noShow(booking)}>
                        Mark no-show {booking.ref}
                      </button>
                    ) : null}
                    {operator &&
                    booking.cancellation &&
                    booking.cancellation.late &&
                    !booking.cancellation.fee_refunded &&
                    (booking.cancellation.fee_cents > 0 || booking.cancellation.fee_minutes > 0) ? (
                      <button type="button" onClick={() => void refundFee(booking)}>
                        Refund fee {booking.ref}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cancelTarget ? (
        <Dialog
          title={`Cancel booking ${cancelTarget.ref}`}
          onClose={() => setCancelTarget(null)}
        >
          <p>{cancellationWarning(cancelTarget)}</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setCancelTarget(null)}>
              Keep booking
            </button>
            <button type="button" className="primary" onClick={() => void cancel(cancelTarget)}>
              Cancel booking
            </button>
          </div>
        </Dialog>
      ) : null}

      {checkOutTarget ? (
        <CheckOutDialog
          booking={checkOutTarget}
          fieldErrors={fieldErrors}
          onClose={() => setCheckOutTarget(null)}
          onSubmit={(minutes) => void checkOut(checkOutTarget, minutes)}
        />
      ) : null}
    </div>
  );
}

function cancellationWarning(booking: Booking): string {
  const policy = booking.policy;
  if (!policy) return 'This booking has no recorded policy version.';
  const freeUntil = Date.parse(booking.start) - policy.free_window_hours * 3_600_000;
  const late = Date.now() > freeUntil;
  const version = `policy v${policy.version}`;
  if (!late) return `Free cancellation under ${version}. Nothing will be kept.`;
  if (booking.pay_with === 'hour_pack') {
    const kept = Math.floor((booking.elapsed_minutes * policy.late_fee_percent) / 100 + 0.5);
    return `Late cancellation under ${version}: ${formatHoursMinutes(kept)} will be kept from your hour pack.`;
  }
  const fee = Math.floor(((booking.amount_cents ?? 0) * policy.late_fee_percent) / 100 + 0.5);
  return `Late cancellation under ${version}: ${formatAmount(fee)} will be charged.`;
}

function CheckOutDialog({
  booking,
  fieldErrors,
  onClose,
  onSubmit,
}: {
  booking: Booking;
  fieldErrors: Record<string, string>;
  onClose: () => void;
  onSubmit: (minutes: number) => void;
}): JSX.Element {
  const [minutes, setMinutes] = useState('0');
  return (
    <Dialog title={`Check out ${booking.ref}`} onClose={onClose}>
      <div className="field">
        <label htmlFor="holdover-minutes">Minutes past booked end</label>
        <input
          id="holdover-minutes"
          type="number"
          min={0}
          max={240}
          step={1}
          value={minutes}
          aria-describedby={fieldErrors['holdover_minutes'] ? 'holdover-error' : undefined}
          onChange={(event) => setMinutes(event.target.value)}
        />
        {fieldErrors['holdover_minutes'] ? (
          <p className="field-error" id="holdover-error">
            Enter whole minutes from 0 to 240.
          </p>
        ) : null}
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onSubmit(Number.parseInt(minutes, 10))}
        >
          Check out
        </button>
      </div>
    </Dialog>
  );
}
