/**
 * The booking state machine: the legal transitions, the grace instant, the
 * automatic lapses and the actions offered to a caller at an instant.
 */
import { config } from '../config.js';
import type { BookingAction, BookingRow, Role } from './types.js';

export type Actor = { role: Role; memberId: string | null };

const actionOrder: readonly BookingAction[] = [
  'confirm',
  'cancel',
  'check_in',
  'check_out',
  'no_show',
  'move',
  'release',
  'waive_penalty',
];

/** Later of the block's start and the confirmation, plus the grace period. */
export function graceInstantMs(booking: BookingRow): number {
  const base = Math.max(booking.startMs, booking.confirmedAtMs ?? booking.startMs);
  return base + config.noShowGraceSeconds * 1000;
}

export function isStaff(actor: Actor): boolean {
  return actor.role === 'operator' || actor.role === 'shift_lead';
}

function owns(actor: Actor, booking: BookingRow): boolean {
  return actor.memberId !== null && actor.memberId === booking.memberId;
}

/** Whether the transition table allows the action, ignoring checks that read other records. */
export function transitionAllowed(
  action: BookingAction,
  booking: BookingRow,
  actor: Actor,
  nowMs: number,
): boolean {
  const staff = isStaff(actor);
  const operator = actor.role === 'operator';
  switch (action) {
    case 'confirm':
      return booking.status === 'held' && owns(actor, booking);
    case 'cancel':
      if (booking.status === 'held') return owns(actor, booking);
      if (booking.status === 'confirmed') return owns(actor, booking) || operator;
      return false;
    case 'check_in':
      return (
        booking.status === 'confirmed' &&
        staff &&
        nowMs >= booking.startMs - 60 * 60 * 1000 &&
        nowMs < graceInstantMs(booking)
      );
    case 'check_out':
      return booking.status === 'checked_in' && staff;
    case 'no_show':
      return (
        booking.status === 'confirmed' &&
        staff &&
        nowMs >= booking.startMs &&
        nowMs < graceInstantMs(booking)
      );
    case 'move':
      return booking.status === 'confirmed' && staff;
    case 'release':
      return booking.status === 'confirmed' && booking.conflict && staff;
    case 'waive_penalty':
      return booking.status === 'cancelled_late' && !booking.penaltyWaived && operator;
  }
}

/** The actions the caller may take at this instant, in the published order. */
export function offeredActions(
  booking: BookingRow,
  actor: Actor,
  nowMs: number,
  monthClosed: boolean,
): BookingAction[] {
  const allowed = actionOrder.filter((action) => transitionAllowed(action, booking, actor, nowMs));
  return monthClosed ? allowed.filter((action) => action === 'waive_penalty') : allowed;
}

export type DueLapse = { status: 'expired' | 'no_show' };

/** The automatic change already due on a booking at an instant, if any. */
export function dueLapse(
  booking: BookingRow,
  nowMs: number,
  monthClosed: boolean,
): DueLapse | null {
  if (booking.status === 'held' && booking.holdExpiresAtMs !== null && booking.holdExpiresAtMs <= nowMs) {
    return { status: 'expired' };
  }
  if (booking.status === 'confirmed' && !monthClosed && nowMs >= graceInstantMs(booking)) {
    return { status: 'no_show' };
  }
  return null;
}
