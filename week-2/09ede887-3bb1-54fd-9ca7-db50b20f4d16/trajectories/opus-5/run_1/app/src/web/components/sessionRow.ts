import type { SessionView } from '../api.js';
import { el, groupNumber } from '../dom.js';
import { instantClockLabel, rangeLabel } from '../venueTime.js';
import { currentAccount } from '../session.js';
import { refusalCopy } from '../copy.js';

export type SeatState = 'none' | 'reserved' | 'waitlisted' | 'held' | 'full';

export interface RowRefusal {
  readonly code: string;
  readonly conflictTitle: string | null;
  readonly conflictId: string | null;
}

export interface RowOptions {
  readonly refusal: RowRefusal | null;
  readonly showPosition: boolean;
  readonly showHoldLine: boolean;
}

export function seatState(session: SessionView): SeatState {
  if (session.my_hold !== null) return 'held';
  if (session.reserved_by_me) return 'reserved';
  if (session.waitlist_position !== null) return 'waitlisted';
  if (session.seats !== null && session.seats.left <= 0) return 'full';
  return 'none';
}

export function speakerLine(session: SessionView): string {
  return session.speakers.map((speaker) => `${speaker.name} - ${speaker.company}`).join(', ');
}

export function pills(session: SessionView): HTMLElement[] {
  const list: HTMLElement[] = [];
  if (session.stage_name !== null) list.push(el('span', { class: 'pill pill-stage', text: session.stage_name }));
  else if (session.location !== null) list.push(el('span', { class: 'pill pill-location', text: session.location }));
  if (session.format_label !== null) list.push(el('span', { class: 'pill pill-format', text: session.format_label }));
  return list;
}

export function seatLine(session: SessionView): HTMLElement | null {
  const { seats } = session;
  if (seats === null) return null;
  const line = el('p', { class: 'seat-line' }, [
    el('span', { text: `${seats.left} of ${seats.capacity} seats left` }),
  ]);
  if (seats.left <= 0) line.appendChild(el('span', { class: 'seat-full', text: 'Full' }));
  const taken = seats.capacity === 0 ? 0 : ((seats.reserved + seats.held) / seats.capacity) * 100;
  const bar = el('span', { class: 'seat-bar', 'aria-hidden': 'true' }, [
    el('span', { class: 'seat-bar-fill', style: `width: ${Math.min(100, Math.max(0, taken))}%` }),
  ]);
  line.appendChild(bar);
  return line;
}

export function waitlistLine(session: SessionView): HTMLElement | null {
  if (session.waitlist_count === null || session.waitlist_count <= 0) return null;
  return el('p', { class: 'waitlist-line', text: `${session.waitlist_count} on the waitlist` });
}

function labelled(
  accessibleName: string,
  visible: string,
  focusKey: string,
  className: string,
): HTMLButtonElement {
  return el('button', {
    type: 'button',
    class: className,
    'aria-label': accessibleName,
    'data-focus-key': focusKey,
    text: visible,
  });
}

export function seatControls(session: SessionView, options: RowOptions): HTMLElement[] {
  const account = currentAccount();
  if (account !== null && account.role === 'organiser') return [];
  if (session.seats === null) return [];
  const state = seatState(session);
  const nodes: HTMLElement[] = [];
  const actions = el('div', { class: 'row-actions' });

  actions.appendChild(
    labelled(
      session.saved_by_me ? `Saved ${session.title}` : `Save ${session.title}`,
      session.saved_by_me ? 'Saved' : 'Save',
      `save:${session.id}`,
      `button button-save${session.saved_by_me ? ' is-saved' : ''}`,
    ),
  );

  if (state === 'reserved') {
    actions.appendChild(el('span', { class: 'pill pill-reserved', text: 'Reserved' }));
    actions.appendChild(
      labelled(`Cancel reservation for ${session.title}`, 'Cancel reservation', `seat:${session.id}`, 'button'),
    );
  } else if (state === 'held') {
    actions.appendChild(labelled(`Claim seat for ${session.title}`, 'Claim seat', `claim:${session.id}`, 'button button-primary'));
    actions.appendChild(labelled(`Release hold for ${session.title}`, 'Release hold', `release:${session.id}`, 'button'));
  } else if (state === 'waitlisted') {
    if (options.showPosition && session.waitlist_position !== null) {
      actions.appendChild(el('span', { class: 'waitlist-position', text: `Waitlist position ${session.waitlist_position}` }));
    }
    actions.appendChild(labelled(`Leave waitlist for ${session.title}`, 'Leave waitlist', `seat:${session.id}`, 'button'));
  } else if (state === 'full') {
    actions.appendChild(labelled(`Join waitlist for ${session.title}`, 'Join waitlist', `seat:${session.id}`, 'button'));
  } else {
    actions.appendChild(
      labelled(`Reserve seat for ${session.title}`, 'Reserve seat', `seat:${session.id}`, 'button button-primary'),
    );
  }

  if (state === 'held' && session.my_hold !== null) {
    nodes.push(
      el('p', {
        class: 'hold-line',
        text: `Seat held for you until ${instantClockLabel(session.my_hold.held_until)}`,
      }),
    );
  }
  nodes.push(actions);
  if (options.refusal !== null) nodes.push(rowRefusal(options.refusal));
  return nodes;
}

function rowRefusal(refusal: RowRefusal): HTMLElement {
  const node = el('p', { class: 'row-refusal' });
  if (refusal.code === 'time_conflict' && refusal.conflictId !== null) {
    node.appendChild(document.createTextNode('You already hold a seat in "'));
    node.appendChild(
      el('a', { href: `/sessions/${refusal.conflictId}`, text: refusal.conflictTitle ?? refusal.conflictId }),
    );
    node.appendChild(document.createTextNode('" at that time.'));
    return node;
  }
  node.textContent = refusalCopy(refusal.code as never, {
    title: refusal.conflictTitle ?? '',
    reserved: 0,
  });
  return node;
}

export function sessionRow(session: SessionView, options: RowOptions): HTMLLIElement {
  const item = el('li', { class: 'session-row', 'data-session-id': session.id });
  item.appendChild(el('p', { class: 'row-time', text: rangeLabel(session.start_local, session.end_local) }));
  const main = el('div', { class: 'row-main' });
  main.appendChild(
    el('h3', { class: 'row-title' }, [el('a', { href: `/sessions/${session.id}`, text: session.title })]),
  );
  if (session.speakers.length > 0) {
    main.appendChild(el('p', { class: 'row-speakers', text: speakerLine(session) }));
  }
  const pillRow = el('div', { class: 'pill-row' }, pills(session));
  if (pillRow.childElementCount > 0) main.appendChild(pillRow);
  const seats = seatLine(session);
  if (seats !== null) main.appendChild(seats);
  const waiting = waitlistLine(session);
  if (waiting !== null) main.appendChild(waiting);
  if (options.showHoldLine && session.my_hold === null && session.seats !== null && session.seats.left <= 0) {
    main.appendChild(el('p', { class: 'row-helper', text: 'Join the waitlist to be next in line.' }));
  }
  for (const node of seatControls(session, options)) main.appendChild(node);
  item.appendChild(main);
  return item;
}

export function countLabel(total: number): string {
  return total === 1 ? '1 session' : `${groupNumber(total)} sessions`;
}
