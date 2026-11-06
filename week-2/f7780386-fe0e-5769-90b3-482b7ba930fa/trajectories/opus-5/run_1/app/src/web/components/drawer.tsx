import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { Booking, Segment, StationInfo } from '../../shared/api.js';
import { computeCost, lateCancellationFeeCents } from '../../shared/domain.js';
import { formatHours, formatMoney } from '../../shared/format.js';
import { parseClock } from '../../shared/time.js';
import { formatCountdown, hasPassed, secondsUntil } from '../clock.js';

export interface DrawerTarget {
  segment: Segment;
  stationName: string;
  stationId: string;
  date: string;
  booking: Booking | null;
  focusOn: 'confirm' | 'cancel' | null;
  restoreFocus: () => void;
}

export interface DrawerProps {
  target: DrawerTarget;
  station: StationInfo | undefined;
  balanceMinutes: number;
  canAct: boolean;
  busy: boolean;
  freeCancelLabel: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onRelease: () => void;
  onCancel: () => void;
}

export function Drawer(props: DrawerProps): ReactNode {
  const { target, station } = props;
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setAsking(false);
    if (target.focusOn === 'confirm') confirmRef.current?.focus();
    if (target.focusOn === 'cancel') cancelRef.current?.focus();
  }, [target]);

  const close = (): void => {
    props.onClose();
    target.restoreFocus();
  };

  const segment = target.segment;
  const isHold = segment.kind === 'hold';
  const start = segment.kind === 'occupied' ? '' : segment.start;
  const end = segment.kind === 'occupied' ? '' : segment.end;
  const tailEnd = segment.kind === 'occupied' ? '' : segment.tail_end;

  const rateCents = station === undefined ? 0 : Math.round(Number(station.hourly_rate) * 100);
  const bookedMinutes = (parseClock(end) ?? 0) - (parseClock(start) ?? 0);
  const preview = computeCost(bookedMinutes, props.balanceMinutes, rateCents);
  const booking = target.booking;
  const expiresAt = segment.kind === 'hold' ? segment.expires_at : null;

  return (
    <aside
      className="drawer"
      aria-label="Ticket details"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      <h2>{target.stationName}</h2>
      <dl>
        <dt>Date</dt>
        <dd className="num">{target.date}</dd>
        <dt>Time</dt>
        <dd className="num">
          {start}–{end}
        </dd>
        <dt>Cleaning</dt>
        <dd className="num">Cleaning until {tailEnd}</dd>
        <dt>Prepaid hours</dt>
        <dd className="num">
          {formatHours(booking === null ? preview.prepaid_minutes : booking.prepaid_minutes)} h
        </dd>
        <dt>Overage</dt>
        <dd className="num">
          ${booking === null ? formatMoney(preview.overage_cents) : booking.overage_amount}
        </dd>
        <dt>Status</dt>
        <dd>
          {isHold ? 'Hold' : (booking?.status ?? 'confirmed')}
          {booking?.payment === 'payment_pending' ? ' · Payment pending' : ''}
        </dd>
        {expiresAt === null ? null : (
          <>
            <dt>Hold time left</dt>
            <dd className="num timer">{formatCountdown(secondsUntil(expiresAt))}</dd>
          </>
        )}
      </dl>

      {!isHold && props.freeCancelLabel !== null ? (
        <p className={`fee-line${props.freeCancelLabel.startsWith('Late') ? ' late' : ''}`}>
          {props.freeCancelLabel}
        </p>
      ) : null}

      <div className="actions">
        {isHold && props.canAct && expiresAt !== null && !hasPassed(expiresAt) ? (
          <>
            <button
              type="button"
              className="primary"
              ref={confirmRef}
              disabled={props.busy}
              aria-busy={props.busy}
              onClick={props.onConfirm}
            >
              Confirm booking
            </button>
            <button type="button" disabled={props.busy} onClick={props.onRelease}>
              Release hold
            </button>
          </>
        ) : null}

        {!isHold && props.canAct && booking !== null && booking.status === 'confirmed' ? (
          asking ? (
            <>
              <button
                type="button"
                className="danger"
                disabled={props.busy}
                aria-busy={props.busy}
                onClick={props.onCancel}
              >
                Yes, cancel booking
              </button>
              <button type="button" onClick={() => setAsking(false)}>
                Keep booking
              </button>
            </>
          ) : (
            <button type="button" className="danger" ref={cancelRef} onClick={() => setAsking(true)}>
              Cancel booking
            </button>
          )
        ) : null}

        <button type="button" onClick={close}>
          Close details
        </button>
      </div>
    </aside>
  );
}

/** The fee terms shown before a cancellation is confirmed. */
export function freeCancelCopy(booking: Booking | null): string | null {
  if (booking === null) return null;
  if (hasPassed(booking.free_cancel_until)) {
    const fee =
      booking.fee?.amount ??
      formatMoney(lateCancellationFeeCents(Math.round(Number(booking.list_amount) * 100)));
    return `Late-cancellation fee: $${fee}`;
  }
  const [date, clock] = booking.free_cancel_until.split('T');
  return `Free cancellation until ${date} ${(clock ?? '').slice(0, 5)}`;
}
