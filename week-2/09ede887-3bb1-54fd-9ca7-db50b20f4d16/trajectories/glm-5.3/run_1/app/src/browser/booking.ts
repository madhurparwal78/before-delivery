/**
 * Booking actions and their focus rules. Every action works by keyboard alone,
 * keeps the pressed control focused while pending, and moves focus to the
 * published destination when the control is replaced or its row removed.
 */

import * as api from './api.js';
import type { Session, ApiFailure } from './api.js';
import { el, announce } from './dom.js';
import { venueClock } from './venue-display.js';

/** The copy for every refusal, in the published voice. */
export function refusalCopy(failure: api.ApiFailure, sessions: Session[]): string {
  switch (failure.code) {
    case 'session_full':
      return 'This session is full. Join the waitlist to be next in line.';
    case 'time_conflict': {
      const title = sessions.find((s) => s.id === failure.conflicts_with)?.title ?? 'another session';
      return `You already hold a seat in "${title}" at that time.`;
    }
    case 'already_reserved':
      return 'You already have a seat in this session.';
    case 'not_reservable':
      return 'This session does not take reservations. Just turn up.';
    case 'no_reservation':
      return 'You do not hold a seat in this session.';
    case 'already_waitlisted':
      return 'You are already on the waitlist for this session.';
    case 'seats_available':
      return 'Seats are open. Reserve a seat instead.';
    case 'not_waitlisted':
      return 'You are not on the waitlist for this session.';
    case 'no_hold':
      return 'No seat is being held for you in this session.';
    case 'hold_expired':
      return 'Your hold on this seat has ended.';
    case 'request_in_progress':
      return 'Your earlier request is still being handled.';
    case 'idempotency_key_reused':
      return 'That request could not be repeated. Press the button again.';
    case 'below_reserved':
      return `Capacity cannot be lower than the ${failure.reserved ?? 0} seats already reserved or held.`;
    case 'unauthenticated':
      return 'Sign in to continue.';
    case 'forbidden':
      return 'This page is for the organiser only.';
    default:
      return 'Keel Outpost is not reachable right now. Try again in a moment.';
  }
}

export type BookingRegion = {
  /** Where the outcome messages go. */
  messages: HTMLElement | null;
  /** Where the row refusal goes, directly after the row's seat action. */
  rowRefusal: HTMLElement | null;
};

/** Pending copy for each action. */
const PENDING: Record<string, string> = {
  reserve: 'Reserving seat…',
  cancel: 'Cancelling…',
  join: 'Joining waitlist…',
  leave: 'Leaving waitlist…',
  claim: 'Claiming seat…',
  release: 'Releasing hold…',
  save: 'Saving…',
  unsave: 'Saving…',
};

const SUCCESS: Record<string, string> = {
  reserve: 'Seat reserved.',
  cancel: 'Reservation cancelled. Your seat has been released.',
  join: 'You joined the waitlist.',
  leave: 'You left the waitlist.',
  claim: 'Seat claimed. It is yours.',
  release: 'Hold released.',
  save: 'Saved to My Agenda.',
  unsave: 'Removed from My Agenda.',
};

export type Action =
  | 'reserve'
  | 'cancel'
  | 'join'
  | 'leave'
  | 'claim'
  | 'release'
  | 'save'
  | 'unsave';

/** Mark the pressed button pending: unavailable to assistive technology, but focused. */
export function setPending(button: HTMLButtonElement, pending: boolean): void {
  button.setAttribute('aria-disabled', pending ? 'true' : 'false');
  if (pending) button.classList.add('is-pending');
  else button.classList.remove('is-pending');
}

/**
 * Run a booking action, announcing the published outcome copy so the page can
 * re-read the session and move focus.
 */
export async function runAction(
  action: Action,
  session: Session,
  region: BookingRegion,
  sessions: Session[] = [],
): Promise<{ ok: boolean; code?: string; position?: number; failure?: ApiFailure }> {
  announce(region.messages, PENDING[action] ?? '');
  try {
    let position: number | undefined;
    if (action === 'reserve') await api.reserve(session.id);
    else if (action === 'cancel') await api.cancel(session.id);
    else if (action === 'join') {
      const joined = await api.joinWaitlist(session.id);
      position = joined.waitlist.position;
    } else if (action === 'leave') await api.leaveWaitlist(session.id);
    else if (action === 'claim') await api.claim(session.id);
    else if (action === 'release') await api.release(session.id);
    else if (action === 'save') await api.save(session.id);
    else if (action === 'unsave') await api.unsave(session.id);
    const copy =
      action === 'join' && position !== undefined
        ? `You joined the waitlist. You are number ${position}.`
        : SUCCESS[action]!;
    announce(region.messages, copy);
    return { ok: true, position };
  } catch (err) {
    if (err instanceof api.ApiError) {
      const failure = err.failure;
      if (failure.conflicts_with !== undefined && !sessions.some((s) => s.id === failure.conflicts_with)) {
        const conflicting = await api.getSession(failure.conflicts_with).catch(() => null);
        if (conflicting !== null) sessions.push(conflicting);
      }
      announce(region.messages, refusalCopy(failure, sessions));
      return { ok: false, code: failure.code, failure };
    }
    announce(region.messages, 'Keel Outpost is not reachable right now. Try again in a moment.');
    return { ok: false, code: 'unavailable' };
  }
}

/** A button that runs a booking action and moves focus to the given target. */
export function bookingButton(
  action: Action,
  label: string,
  session: Session,
  region: BookingRegion,
  sessions: Session[],
  onDone: (result: { ok: boolean; code?: string; failure?: ApiFailure }, action: Action) => void,
  extraClass = '',
): HTMLButtonElement {
  const button = el(
    'button',
    { type: 'button', 'aria-label': label, class: `action ${extraClass}`.trim() },
    visibleText(action),
  );
  button.addEventListener('click', () => {
    void press(button, action, session, region, sessions, onDone);
  });
  return button;
}

function visibleText(action: Action): string {
  switch (action) {
    case 'reserve':
      return 'Reserve seat';
    case 'cancel':
      return 'Cancel reservation';
    case 'join':
      return 'Join waitlist';
    case 'leave':
      return 'Leave waitlist';
    case 'claim':
      return 'Claim seat';
    case 'release':
      return 'Release hold';
    case 'save':
      return 'Save';
    case 'unsave':
      return 'Saved';
  }
}

async function press(
  button: HTMLButtonElement,
  action: Action,
  session: Session,
  region: BookingRegion,
  sessions: Session[],
  onDone: (result: { ok: boolean; code?: string; failure?: ApiFailure }, action: Action) => void,
): Promise<void> {
  if (button.getAttribute('aria-disabled') === 'true') return;
  setPending(button, true);
  const result = await runAction(action, session, region, sessions);
  setPending(button, false);
  onDone(result, action);
}

export function showRowRefusal(target: HTMLElement | null, copy: string, conflictsWith?: string): void {
  if (target === null) return;
  target.textContent = '';
  if (conflictsWith !== undefined) {
    const link = el('a', { href: `/sessions/${conflictsWith}`, class: 'row-refusal-link' }, copy);
    target.append(link);
  } else {
    target.append(copy);
  }
}

export function clearRowRefusal(target: HTMLElement | null): void {
  if (target !== null) target.textContent = '';
}

/** The seat line, with `Full` when no seat is left. */
export function seatLineText(session: Session): string {
  const seats = session.seats;
  if (seats === null) return '';
  return seats.left > 0
    ? `${seats.left} of ${seats.capacity} seats left`
    : `${seats.left} of ${seats.capacity} seats left, Full`;
}

/** The hold line: `Seat held for you until 11:42 AM`. */
export function holdLineText(session: Session): string {
  return `Seat held for you until ${venueClock(session.my_hold!.held_until)}`;
}

/** The waitlist line: `3 on the waitlist`. */
export function waitlistLineText(session: Session): string {
  return `${session.waitlist_count} on the waitlist`;
}
