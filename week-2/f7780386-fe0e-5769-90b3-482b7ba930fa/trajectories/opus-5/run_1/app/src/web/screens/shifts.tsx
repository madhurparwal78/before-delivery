import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type { Booking, User } from '../../shared/api.js';
import { api } from '../api.js';
import { useAction, useApp } from '../app-state.js';

export function ShiftsScreen(): ReactNode {
  const app = useApp();
  const act = useAction();
  const user = app.user as User;
  const [shifts, setShifts] = useState<Booking[]>([]);
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    const result = await api<{ bookings: Booking[] }>('/api/bookings');
    setShifts(
      result.bookings.filter(
        (booking) => booking.status !== 'cancelled_free' && booking.status !== 'cancelled_with_fee',
      ),
    );
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const handle = window.setInterval(() => void refresh().catch(() => undefined), 5000);
    return () => window.clearInterval(handle);
  }, [refresh]);

  const checkIn = async (booking: Booking): Promise<void> => {
    setBusy(booking.id);
    await act(
      'Checking in…',
      async () => {
        await api(`/api/bookings/${booking.id}/check-ins`, { method: 'POST', body: {} });
        await refresh();
        return `Checked in for ${booking.station_name}, ${booking.start}–${booking.end}.`;
      },
      (error) => {
        if (error.code === 'food_handler_card_not_current') {
          return 'Your food handler card is not approved and current for this shift.';
        }
        return 'Check-in opens 15 minutes before the shift starts and closes when it ends.';
      },
    );
    setBusy('');
  };

  return (
    <>
      <h1>Shifts</h1>
      <ul className="shifts" aria-label="Upcoming shifts">
        {shifts.map((booking) => {
          const mine = booking.check_ins.find((entry) => entry.crew_cook_id === user.id);
          return (
            <li key={booking.id}>
              <span className="shift-main">
                <span className="shift-station">{booking.station_name}</span>
                <br />
                <span className="num">
                  {booking.date} {booking.start}–{booking.end}
                </span>
                {booking.payment === 'payment_pending' ? (
                  <>
                    <br />
                    <span className="muted">Payment pending</span>
                  </>
                ) : null}
              </span>
              {mine === undefined ? (
                <button
                  type="button"
                  className="primary"
                  disabled={busy === booking.id}
                  aria-busy={busy === booking.id}
                  onClick={() => void checkIn(booking)}
                >
                  Check in: {booking.station_name}, {booking.date} {booking.start}
                </button>
              ) : (
                <span className="num">Checked in {mine.at.slice(11, 16)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
