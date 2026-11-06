/**
 * Shared page pieces: the seat bar, the pills, the row booking controls and
 * the focus rules that follow every booking answer.
 */

import * as api from '../api.js';
import type { Session } from '../api.js';
import { el } from '../dom.js';
import * as booking from '../booking.js';
import { state } from '../state.js';
import { navigateToSignIn } from './auth-form.js';
import { venueRange } from '../venue-display.js';

export function loadingLine(): HTMLElement {
  return el('p', { class: 'loading' }, 'Loading');
}

export function seatBar(session: Session): HTMLElement {
  const seats = session.seats;
  const bar = el('div', { class: 'seat-bar', 'aria-hidden': 'true' });
  if (seats !== null) {
    const filled = seats.capacity === 0 ? 0 : ((seats.reserved + seats.held) / seats.capacity) * 100;
    bar.append(el('div', { class: 'seat-bar-fill', style: `width:${filled}%` }));
  }
  return bar;
}

export function sessionPills(session: Session): HTMLElement {
  const box = el('span', { class: 'pills' });
  if (session.stage !== null) {
    box.append(el('span', { class: 'pill pill-stage' }, session.stage_name ?? session.stage));
  } else if (session.location !== null) {
    box.append(el('span', { class: 'pill pill-location' }, session.location));
  }
  if (session.format !== null) {
    box.append(el('span', { class: 'pill pill-format' }, session.format_label ?? session.format));
  }
  return box;
}

export function speakerLine(session: Session): string {
  return session.speakers.map((s) => `${s.name} - ${s.company}`).join(', ');
}

export function sessionTime(session: Session): string {
  return venueRange(session);
}

/** A row's seat line: `<left> of <capacity> seats left`, plus `Full` when none. */
export function seatLine(session: Session): HTMLElement {
  const seats = session.seats;
  return el('span', { class: 'seat-line' },
    `${seats === null ? '' : `${seats.left} of ${seats.capacity} seats left`}`,
    seats !== null && seats.left === 0 ? el('span', { class: 'full-flag' }, 'Full') : null,
  );
}

/**
 * A row's booking controls, plus the row refusal that follows the seat action.
 * Visitors see the same controls; pressing one sends them to sign in. The
 * organiser sees none, because the server refuses those calls anyway.
 */
export function rowActions(
  session: Session,
  opts: {
    rowRefusal: HTMLElement;
    onDone: () => Promise<void> | void;
    onResult?: (result: { ok: boolean; code?: string }, action: booking.Action) => void;
  },
): HTMLElement {
  const box = el('div', { class: 'row-actions' });
  if (state.account !== null && state.account.role !== 'attendee') return box;
  const sessions = state.sessions.length > 0 ? state.sessions : [session];
  const region = { messages: state.bookingMessages, rowRefusal: opts.rowRefusal };
  const done = (result: { ok: boolean; code?: string; failure?: api.ApiFailure }, action: booking.Action): void => {
    opts.onResult?.(result, action);
    void Promise.resolve(opts.onDone()).then(() => {
      // The redraw replaced the row, so the refusal lands on the row now on
      // screen, directly after its seat action.
      const slot = document.querySelector(`[data-session-id="${CSS.escape(session.id)}"] .row-refusal`);
      if (result.failure !== undefined) {
        booking.showRowRefusal(
          slot as HTMLElement | null,
          booking.refusalCopy(result.failure, state.sessions),
          result.failure.conflicts_with,
        );
        refusalDestination(action, result.code, session)?.focus();
      } else {
        booking.clearRowRefusal(slot as HTMLElement | null);
        focusDestination(action, session)?.focus();
      }
    });
  };
  const whenSignedOut = (action: booking.Action, label: string): HTMLButtonElement => {
    const button = el('button', { type: 'button', class: 'action', 'aria-label': label },
      visibleActionText(action));
    button.addEventListener('click', () => {
      navigateToSignIn();
    });
    return button;
  };
  if (state.account === null) {
    const seats = session.seats;
    const seatAction: booking.Action =
      session.reserved_by_me || session.my_hold !== null || session.waitlist_position !== null
        ? 'reserve'
        : seats !== null && seats.left > 0
          ? 'reserve'
          : 'join';
    box.append(
      whenSignedOut('save', `Save ${session.title}`),
      whenSignedOut(seatAction,
        seatAction === 'join' ? `Join waitlist for ${session.title}` : `Reserve seat for ${session.title}`),
    );
    return box;
  }
  box.append(booking.bookingButton(
    session.saved_by_me ? 'unsave' : 'save',
    session.saved_by_me ? `Saved ${session.title}` : `Save ${session.title}`,
    session,
    region,
    sessions,
    done,
  ));
  box.append(rowSeatAction(session, region, sessions, done));
  return box;
}

function visibleActionText(action: booking.Action): string {
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

/** Where focus lands after a refusal: on the control now in the row's place. */
function refusalDestination(
  action: booking.Action,
  code: string | undefined,
  session: Session,
): HTMLElement | null {
  const find = (label: string): HTMLElement | null => {
    for (const button of Array.from(document.querySelectorAll('button'))) {
      if (button.getAttribute('aria-label') === label) return button;
    }
    return null;
  };
  // A refused action leaves the pressed control in place where it still exists.
  const pressed = find(pressedLabel(action, session));
  if (code === 'session_full') return find(`Join waitlist for ${session.title}`) ?? pressed;
  if (code === 'seats_available') return find(`Reserve seat for ${session.title}`) ?? pressed;
  if (code === 'hold_expired' || code === 'no_hold') {
    const fresh = state.sessions.find((s) => s.id === session.id);
    const left = fresh?.seats?.left ?? session.seats?.left ?? 0;
    return left > 0
      ? find(`Reserve seat for ${session.title}`) ?? pressed
      : find(`Join waitlist for ${session.title}`) ?? pressed;
  }
  // Any other refusal stays on the pressed control, which the redraw replaced.
  return pressed;
}

/** The accessible name of the pressed control for an action. */
function pressedLabel(action: booking.Action, session: Session): string {
  switch (action) {
    case 'reserve':
      return `Reserve seat for ${session.title}`;
    case 'cancel':
      return `Cancel reservation for ${session.title}`;
    case 'join':
      return `Join waitlist for ${session.title}`;
    case 'leave':
      return `Leave waitlist for ${session.title}`;
    case 'claim':
      return `Claim seat for ${session.title}`;
    case 'release':
      return `Release hold for ${session.title}`;
    case 'save':
      return `Save ${session.title}`;
    case 'unsave':
      return `Saved ${session.title}`;
  }
}

/** The one seat action that fits the attendee's state in this session. */
export function rowSeatAction(
  session: Session,
  region: booking.BookingRegion,
  sessions: Session[],
  done: (result: { ok: boolean; code?: string }, action: booking.Action) => void,
): HTMLElement {
  if (session.reserved_by_me) {
    return el('span', { class: 'seat-state' },
      el('span', { class: 'pill pill-reserved' }, 'Reserved'),
      booking.bookingButton('cancel', `Cancel reservation for ${session.title}`, session, region, sessions, done),
    );
  }
  if (session.my_hold !== null) {
    return el('span', { class: 'seat-state seat-state-held' },
      el('span', { class: 'hold-line' }, booking.holdLineText(session)),
      booking.bookingButton('claim', `Claim seat for ${session.title}`, session, region, sessions, done, 'action-blue'),
      booking.bookingButton('release', `Release hold for ${session.title}`, session, region, sessions, done),
    );
  }
  if (session.waitlist_position !== null) {
    return el('span', { class: 'seat-state' },
      el('span', { class: 'waitlisted-line' }, `Waitlist position ${session.waitlist_position}`),
      booking.bookingButton('leave', `Leave waitlist for ${session.title}`, session, region, sessions, done),
    );
  }
  const seats = session.seats;
  if (seats === null) return el('span', { class: 'seat-state' });
  if (seats.left > 0) {
    return booking.bookingButton('reserve', `Reserve seat for ${session.title}`, session, region, sessions, done);
  }
  return booking.bookingButton('join', `Join waitlist for ${session.title}`, session, region, sessions, done);
}

/** Where focus lands after a successful action, in the row now on screen. */
function focusDestination(action: booking.Action, session: Session): HTMLElement | null {
  const find = (label: string): HTMLElement | null => {
    for (const button of Array.from(document.querySelectorAll('button'))) {
      if (button.getAttribute('aria-label') === label) return button;
    }
    return null;
  };
  switch (action) {
    case 'reserve':
    case 'claim':
      return find(`Cancel reservation for ${session.title}`);
    case 'cancel':
      return find(`Reserve seat for ${session.title}`) ?? find(`Join waitlist for ${session.title}`);
    case 'join':
      return find(`Leave waitlist for ${session.title}`);
    case 'leave':
    case 'release':
      return find(`Join waitlist for ${session.title}`) ?? find(`Reserve seat for ${session.title}`);
    case 'save':
      return find(`Saved ${session.title}`);
    case 'unsave':
      return find(`Save ${session.title}`);
  }
}

export { api };
