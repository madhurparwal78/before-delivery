/**
 * My Agenda: reserved, held, waitlisted and saved sessions, each in agenda
 * order under its own heading, with a line in words when one list is empty.
 * Cancel, release, leave and unsave remove a row; focus then moves to the
 * next row in that list, the previous row, or the list's empty-state line.
 */

import * as api from '../api.js';
import type { Session } from '../api.js';
import { el } from '../dom.js';
import { state, mergeSessions } from '../state.js';
import { route } from '../router.js';
import { navigateToSignIn } from './auth-form.js';
import * as shared from './shared.js';
import * as booking from '../booking.js';

route(/^\/my-agenda$/, async () => {
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);

  if (state.account === null) {
    navigateToSignIn();
    return;
  }
  if (state.account.role !== 'attendee') {
    main.append(
      el('h1', { class: 'page-title' }, 'My Agenda'),
      el('p', { class: 'empty-line' }, 'My Agenda is for attendees. Use the organiser page instead.'),
      el('p', {}, el('a', { href: '/organiser' }, 'Go to the organiser page')),
    );
    return;
  }

  const messages = el('p', { id: 'booking-messages', role: 'status', 'aria-live': 'polite', 'aria-label': 'Booking messages', class: 'live-region' });
  state.bookingMessages = messages;

  const draw = async (): Promise<void> => {
    const agenda = await api.getMyAgenda().catch(() => null);
    main.textContent = '';
    main.append(el('h1', { class: 'page-title' }, 'My Agenda'));
    if (agenda === null) {
      main.append(el('p', { class: 'loading' }, 'Loading'));
      return;
    }
    state.sessions = mergeSessions(state.sessions, [
      ...agenda.reserved, ...agenda.held, ...agenda.waitlisted, ...agenda.saved,
    ]);
    main.append(group('Reserved seats', agenda.reserved, 'You have not reserved any seats yet.'));
    main.append(group('Seats held for you', agenda.held, 'No seats are being held for you.', true, false));
    main.append(group('Waitlist', agenda.waitlisted, 'You are not on any waitlist.', false, true));
    main.append(group('Saved sessions', agenda.saved, 'Nothing saved yet. Browse the agenda.'));
    main.append(messages);
  };
  await draw();
  state.refresh = draw;
});

function group(
  heading: string,
  sessions: Session[],
  emptyCopy: string,
  showHold = false,
  showPosition = false,
): HTMLElement {
  const section = el('section', { class: 'agenda-group', 'data-group': heading },
    el('h2', { class: 'agenda-heading' }, heading),
  );
  if (sessions.length === 0) {
    section.append(el('p', { class: 'empty-line', tabindex: '-1' }, emptyCopy));
    return section;
  }
  const ids = sessions.map((s) => s.id);
  const list = el('ul', { class: 'session-list agenda-list', role: 'list' });
  for (const session of sessions) {
    const refusal = el('span', { class: 'row-refusal' });
    const seatBox = el('div', { class: 'session-seats' });
    if (showHold && session.my_hold !== null) {
      seatBox.append(el('span', { class: 'hold-line' }, booking.holdLineText(session)));
    }
    if (showPosition && session.waitlist_position !== null) {
      seatBox.append(el('span', { class: 'waitlisted-line' }, `Waitlist position ${session.waitlist_position}`));
    }
    seatBox.append(
      shared.rowActions(session, {
        rowRefusal: refusal,
        onDone: () => Promise.resolve(),
        onResult: (result, action) => {
          if (result.ok) void settleAfter(action, session.id, ids, heading);
        },
      }),
      refusal,
    );
    list.append(
      el('li', { class: 'session-row agenda-row', 'data-session-id': session.id },
        el('span', { class: 'session-time' }, shared.sessionTime(session)),
        el('div', { class: 'session-body' },
          el('h3', { class: 'session-title' },
            el('a', { href: `/sessions/${session.id}` }, session.title)),
          el('p', { class: 'session-speakers' }, shared.speakerLine(session)),
          shared.sessionPills(session),
        ),
        seatBox,
      ),
    );
  }
  section.append(list);
  return section;
}

/**
 * After an action that removed a row, refetch and move focus to the first
 * button of the next row in that list, the previous row, or the list's
 * empty-state line. A claim moves the row to Reserved seats instead.
 */
async function settleAfter(
  action: booking.Action,
  id: string,
  oldIds: string[],
  heading: string,
): Promise<void> {
  const draw = state.refresh;
  if (draw === null) return;
  await draw();
  if (action === 'claim') {
    const moved = document.querySelector(
      `[data-group="Reserved seats"] li[data-session-id="${CSS.escape(id)}"] button`,
    );
    (moved as HTMLElement | null)?.focus();
    return;
  }
  const groupEl = document.querySelector(`[data-group="${CSS.escape(heading)}"]`);
  if (groupEl === null) return;
  if (groupEl.querySelector(`.agenda-row[data-session-id="${CSS.escape(id)}"]`) !== null) {
    // The row stayed; the shared focus rules already ran.
    return;
  }
  const rows = Array.from(groupEl.querySelectorAll<HTMLElement>('.agenda-row button'));
  if (rows.length > 0) {
    rows[0]!.focus();
    return;
  }
  (groupEl.querySelector('.empty-line') as HTMLElement | null)?.focus();
  void oldIds;
}
