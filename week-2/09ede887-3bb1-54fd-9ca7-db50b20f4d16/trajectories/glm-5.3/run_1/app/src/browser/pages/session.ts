/**
 * One session and its actions. Times read in Port Ashby time, speakers with
 * their rendered bios, the details table, and the same actions as the row.
 */

import * as api from '../api.js';
import { el } from '../dom.js';
import { state, mergeSessions } from '../state.js';
import { route } from '../router.js';
import * as shared from './shared.js';
import * as booking from '../booking.js';
import { venueLine, venueRange, venueStamp } from '../venue-display.js';

route(/^\/sessions\/[^/]+$/, async () => {
  const id = decodeURIComponent(location.pathname.split('/')[2]!);
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);
  main.append(el('p', { class: 'loading' }, 'Loading'));

  const messages = el('p', { id: 'booking-messages', role: 'status', 'aria-live': 'polite', 'aria-label': 'Booking messages', class: 'live-region' });
  state.bookingMessages = messages;

  const draw = async (): Promise<void> => {
    if (state.speakers.length === 0) {
      state.speakers = await api.listSpeakers().catch(() => []);
    }
    const session = await api.getSession(id).catch(() => null);
    main.textContent = '';
    if (session === null) {
      const { renderSessionNotFound } = await import('./notfound.js');
      main.append(renderSessionNotFound());
      return;
    }
    state.sessions = mergeSessions(state.sessions, [session]);
    const refusal = el('p', { class: 'row-refusal' });
    const seats = session.seats;
    const seatBox = el('div', { class: 'session-seats' });
    if (seats !== null) {
      seatBox.append(shared.seatLine(session), shared.seatBar(session));
      if (session.waitlist_count > 0) {
        seatBox.append(el('span', { class: 'waitlist-line' }, booking.waitlistLineText(session)));
      }
    }
    seatBox.append(
      shared.rowActions(session, { rowRefusal: refusal, onDone: () => draw() }),
      refusal,
    );
    main.append(
      el('p', { class: 'session-when' }, `Day ${session.day}, ${venueRange(session)}`),
      el('h1', { class: 'page-title' }, session.title),
      el('p', { class: 'venue-line' }, venueLine(session.date)),
      el('div', { class: 'session-speakers-block' },
        ...session.speakers.map((ref) => {
          const speaker = state.speakers.find((s) => s.name === ref.name);
          return el('div', { class: 'session-speaker' },
            el('h2', { class: 'session-speaker-name' }, ref.name),
            el('p', { class: 'session-speaker-company' }, ref.company),
            speaker !== undefined ? el('div', { class: 'speaker-bio', html: speaker.bio_html }) : null,
          );
        }),
      ),
      shared.sessionPills(session),
      el('p', { class: 'session-description' }, session.description),
      el('table', { class: 'details-table', 'aria-label': 'Session details' },
        el('tbody', {},
          detailRow('Stage', session.stage_name ?? session.location ?? ''),
          detailRow('Format', session.format_label ?? ''),
          detailRow('Starts', venueStamp(session.start_instant)),
          detailRow('Ends', venueStamp(session.end_instant)),
          detailRow('Capacity', seats === null ? '' : String(seats.capacity)),
          detailRow('Seats left', seats === null ? '' : String(seats.left)),
          detailRow('Waitlist', String(session.waitlist_count)),
        ),
      ),
      seatBox,
      messages,
    );
  };
  await draw();
  state.refresh = draw;
});

function detailRow(label: string, value: string): HTMLElement {
  return el('tr', {},
    el('th', { scope: 'row', class: 'details-label' }, label),
    el('td', { class: 'details-value' }, value),
  );
}
