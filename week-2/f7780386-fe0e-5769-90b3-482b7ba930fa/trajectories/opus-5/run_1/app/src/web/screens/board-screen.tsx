import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { Booking, BoardResponse, Segment } from '../../shared/api.js';
import { addDays, formatBoardDate, formatClock } from '../../shared/time.js';
import { ApiError, NetworkError, api } from '../api.js';
import { UNREACHABLE, useApp, useAction } from '../app-state.js';
import { hasPassed, kitchenNowMinutes, syncServerNow } from '../clock.js';
import { BoardGrid, type PlaceOutcome } from '../components/board-grid.js';
import { Drawer, freeCancelCopy, type DrawerTarget } from '../components/drawer.js';
import { Rail, type RailTicket } from '../components/rail.js';

const POLL_MS = 5000;
const EXPIRY_FADE_MS = 250;
const BILLING_BANNER =
  'Billing is unreachable. Bookings that need a charge are confirmed with payment pending ' +
  'and settle automatically.';

function documentsCopy(date: string): string {
  return (
    `Your liability insurance is not approved and current for ${date}. ` +
    `Renew it on Documents before booking.`
  );
}

const VALIDATION_REASONS: Record<string, string> = {
  in_the_past: 'It starts in the past.',
  too_far_ahead: 'Bookings open 28 days ahead.',
  outside_board_hours: 'The cleaning turnover must finish by 24:00.',
  not_on_grid: 'Pick whole 15-minute cells.',
  end_before_start: 'Pick whole 15-minute cells.',
};

function validationCopy(error: ApiError): string {
  const code = Object.values(error.fields)[0] ?? '';
  return `That slot can't be held. ${VALIDATION_REASONS[code] ?? 'Pick whole 15-minute cells.'}`;
}

export function BoardScreen(): ReactNode {
  const app = useApp();
  const act = useAction();
  const user = app.user;
  const [date, setDate] = useState<string>(app.kitchen?.today ?? '');
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [balance, setBalance] = useState<number>(app.balanceMinutes ?? 0);
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMinutes, setNowMinutes] = useState(() => Math.floor(kitchenNowMinutes()));
  const [expiring, setExpiring] = useState<ReadonlySet<string>>(new Set());
  const expiredSeen = useRef(new Set<string>());

  const isMember = user?.role === 'member';

  const refresh = useCallback(async (): Promise<void> => {
    if (date === '') return;
    const next = await api<BoardResponse>(`/api/board?date=${date}`);
    syncServerNow(next.now);
    setBoard(next);
    if (user !== null && user.role !== 'operator') {
      const list = await api<{ bookings: Booking[] }>(
        `/api/bookings?from=${date}&to=${date}`,
      );
      setBookings(list.bookings);
    }
    if (isMember) {
      const me = await api<{ balance_minutes: number | null }>('/api/me');
      setBalance(me.balance_minutes ?? 0);
    }
  }, [date, user, isMember]);

  useEffect(() => {
    if (app.kitchen !== null && date === '') setDate(app.kitchen.today);
  }, [app.kitchen, date]);

  useEffect(() => {
    void refresh().catch(() => undefined);
    const handle = window.setInterval(() => void refresh().catch(() => undefined), POLL_MS);
    return () => window.clearInterval(handle);
  }, [refresh]);

  // The now line steps once per minute, so nothing moves while the user is idle.
  useEffect(() => {
    const handle = window.setInterval(
      () => setNowMinutes(Math.floor(kitchenNowMinutes())),
      1000,
    );
    return () => window.clearInterval(handle);
  }, []);

  // A hold that reaches its server expiry fades out and announces itself,
  // without a reload and within two seconds of the expiry instant.
  useEffect(() => {
    if (board === null) return;
    const handle = window.setInterval(() => {
      for (const station of board.stations) {
        for (const segment of station.segments) {
          if (segment.kind !== 'hold') continue;
          if (!hasPassed(segment.expires_at)) continue;
          if (expiredSeen.current.has(segment.id)) continue;
          expiredSeen.current.add(segment.id);
          app.succeed(`Your hold on ${station.name}, ${segment.start}–${segment.end} expired.`);
          if (app.reducedMotion) {
            void refresh().catch(() => undefined);
          } else {
            setExpiring((current) => new Set(current).add(segment.id));
            window.setTimeout(() => {
              setExpiring((current) => {
                const next = new Set(current);
                next.delete(segment.id);
                return next;
              });
              void refresh().catch(() => undefined);
            }, EXPIRY_FADE_MS);
          }
        }
      }
    }, 500);
    return () => window.clearInterval(handle);
  }, [board, app, refresh]);

  const stationName = useCallback(
    (stationId: string): string =>
      board?.stations.find((station) => station.id === stationId)?.name ?? stationId,
    [board],
  );

  const tickets = useMemo<RailTicket[]>(() => {
    if (board === null || user === null || user.role === 'operator') return [];
    const list: RailTicket[] = [];
    for (const station of board.stations) {
      for (const segment of station.segments) {
        if (segment.kind === 'occupied') continue;
        if (segment.kind === 'hold' && user.role !== 'member') continue;
        const booking =
          segment.kind === 'booking'
            ? (bookings.find((candidate) => candidate.id === segment.id) ?? null)
            : null;
        list.push({
          key: segment.id,
          stationName: station.name,
          date: board.date,
          start: segment.start,
          end: segment.end,
          state:
            segment.kind === 'hold'
              ? 'hold'
              : segment.payment === 'payment_pending'
                ? 'payment pending'
                : 'confirmed',
          expiresAt: segment.kind === 'hold' ? segment.expires_at : null,
          segment,
          booking,
        });
      }
    }
    return list.sort((left, right) => (left.start < right.start ? -1 : 1));
  }, [board, bookings, user]);

  const openSegment = useCallback(
    (segment: Segment, stationId: string, restoreFocus: () => void) => {
      if (segment.kind === 'occupied') return;
      setTarget({
        segment,
        stationId,
        stationName: stationName(stationId),
        date: board?.date ?? date,
        booking:
          segment.kind === 'booking'
            ? (bookings.find((candidate) => candidate.id === segment.id) ?? null)
            : null,
        focusOn: segment.kind === 'hold' ? 'confirm' : 'cancel',
        restoreFocus,
      });
    },
    [board, bookings, date, stationName],
  );

  const placeHold = useCallback(
    async (stationId: string, startMinutes: number, endMinutes: number): Promise<PlaceOutcome> => {
      const start = formatClock(startMinutes);
      const end = formatClock(endMinutes);
      app.pending('Placing hold…');
      try {
        await api('/api/holds', {
          method: 'POST',
          body: { station_id: stationId, date, start, end },
        });
        app.succeed(
          `Hold placed: ${stationName(stationId)}, ${start}–${end}. ` +
            `Confirm it before the timer runs out.`,
        );
        await refresh();
        return 'placed';
      } catch (error) {
        if (error instanceof NetworkError) {
          app.report(UNREACHABLE);
          return 'refused';
        }
        if (!(error instanceof ApiError)) throw error;
        if (error.code === 'slot_taken') {
          app.succeed(
            `Another member took ${stationName(stationId)} at ${start}. ` +
              `Your hold was not placed.`,
          );
          await refresh().catch(() => undefined);
          return 'lost';
        }
        if (error.code === 'documents_not_current') app.report(documentsCopy(date));
        else if (error.code === 'validation_failed') app.report(validationCopy(error));
        else app.report(validationCopy(error));
        return 'refused';
      }
    },
    [app, date, refresh, stationName],
  );

  const resizeHold = useCallback(
    async (holdId: string, endMinutes: number): Promise<void> => {
      await act(
        'Updating hold…',
        async () => {
          const result = await api<{ hold: { end: string } }>(`/api/holds/${holdId}`, {
            method: 'PATCH',
            body: { end: formatClock(endMinutes) },
          });
          await refresh();
          return `Hold now ends at ${result.hold.end}.`;
        },
        (error) => {
          if (error.code === 'slot_taken') {
            return 'That change collides with another booking. The hold is unchanged.';
          }
          if (error.code === 'hold_expired') return 'This hold has expired.';
          return validationCopy(error);
        },
      );
    },
    [act, refresh],
  );

  const releaseHold = useCallback(
    async (holdId: string): Promise<void> => {
      await act(
        'Releasing hold…',
        async () => {
          await api(`/api/holds/${holdId}`, { method: 'DELETE' });
          setTarget(null);
          await refresh();
          return 'Hold released.';
        },
        (error) => (error.code === 'hold_expired' ? 'This hold has expired.' : 'This hold has expired.'),
      );
    },
    [act, refresh],
  );

  const confirmHold = useCallback(
    async (holdId: string): Promise<void> => {
      setBusy(true);
      await act(
        'Confirming booking…',
        async () => {
          const result = await api<{ booking: Booking }>(`/api/holds/${holdId}/confirm`, {
            method: 'POST',
            body: {},
          });
          const booking = result.booking;
          setTarget(null);
          await refresh();
          const base =
            `Booking confirmed: ${booking.station_name}, ${booking.date} ` +
            `${booking.start}–${booking.end}.`;
          return booking.payment === 'payment_pending'
            ? `${base} Payment pending until billing records it.`
            : base;
        },
        (error) => {
          if (error.code === 'hold_expired') {
            return 'This hold expired before it was confirmed. Paint the slot again.';
          }
          if (error.code === 'documents_not_current') return documentsCopy(date);
          return 'This hold expired before it was confirmed. Paint the slot again.';
        },
      );
      setBusy(false);
    },
    [act, date, refresh],
  );

  const cancelBooking = useCallback(
    async (bookingId: string): Promise<void> => {
      setBusy(true);
      await act(
        'Cancelling booking…',
        async () => {
          const result = await api<{ booking: Booking }>(`/api/bookings/${bookingId}/cancel`, {
            method: 'POST',
            body: {},
          });
          const booking = result.booking;
          setTarget(null);
          await refresh();
          const refund = (booking.prepaid_minutes / 60).toFixed(2);
          return booking.status === 'cancelled_with_fee'
            ? `Booking cancelled. ${refund} h returned; late-cancellation fee ` +
                `$${booking.fee?.amount ?? '0.00'}.`
            : `Booking cancelled. ${refund} h returned to your prepaid balance.`;
        },
        (error) =>
          error.code === 'booking_started'
            ? 'This booking has already started and can no longer be cancelled.'
            : 'This booking has already started and can no longer be cancelled.',
      );
      setBusy(false);
    },
    [act, refresh],
  );

  if (board === null || app.kitchen === null) {
    return <h1>Line board</h1>;
  }

  const isToday = board.date === board.today;

  return (
    <>
      <div className="screen-head">
        <h1>Line board</h1>
        <span className="board-date">{formatBoardDate(board.date)}</span>
        <button type="button" onClick={() => setDate(addDays(board.date, -1))}>
          Previous day
        </button>
        <button type="button" onClick={() => setDate(addDays(board.date, 1))}>
          Next day
        </button>
        <button type="button" onClick={() => setDate(board.today)}>
          Today
        </button>
      </div>

      {board.billing === 'down' ? (
        <p className="banner" role="status" aria-label="Billing status">
          {BILLING_BANNER}
        </p>
      ) : null}

      {user?.role === 'operator' ? null : (
        <Rail
          tickets={tickets}
          balanceMinutes={isMember ? balance : null}
          expiringHoldIds={expiring}
          onOpen={(ticket, restoreFocus) =>
            openSegment(
              ticket.segment,
              board.stations.find((station) => station.name === ticket.stationName)?.id ?? '',
              restoreFocus,
            )
          }
        />
      )}

      <div className="board-layout">
        <div className="board-main">
          <BoardGrid
            board={board}
            stations={app.kitchen.stations}
            canPaint={isMember}
            showNames={user?.role === 'operator'}
            balanceMinutes={balance}
            isToday={isToday}
            nowMinutes={nowMinutes}
            reducedMotion={app.reducedMotion}
            expiringHoldIds={expiring}
            onPlaceHold={placeHold}
            onResizeHold={resizeHold}
            onReleaseHold={releaseHold}
            onOpenSegment={(segment, restoreFocus) => {
              const station = board.stations.find((candidate) =>
                candidate.segments.some(
                  (item) => item.kind !== 'occupied' && segment.kind !== 'occupied' && item.id === segment.id,
                ),
              );
              openSegment(segment, station?.id ?? '', restoreFocus);
            }}
          />
        </div>

        {target === null ? null : (
          <Drawer
            target={target}
            station={app.kitchen.stations.find((station) => station.id === target.stationId)}
            balanceMinutes={balance}
            canAct={isMember}
            busy={busy}
            freeCancelLabel={freeCancelCopy(target.booking)}
            onClose={() => setTarget(null)}
            onConfirm={() => {
              if (target.segment.kind === 'hold') void confirmHold(target.segment.id);
            }}
            onRelease={() => {
              if (target.segment.kind === 'hold') void releaseHold(target.segment.id);
            }}
            onCancel={() => {
              if (target.segment.kind === 'booking') void cancelBooking(target.segment.id);
            }}
          />
        )}
      </div>
    </>
  );
}
