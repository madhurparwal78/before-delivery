import { ApiFailure, api, type SessionView } from '../api.js';
import { applyFocusWish, wireBookingControls, type BookingHost, type FocusWish } from '../booking.js';
import { clear, el, liveRegion, markup } from '../dom.js';
import { restoreScroll, type Page } from '../router.js';
import { pills, seatControls, seatLine, speakerLine, waitlistLine, type RowRefusal } from '../components/sessionRow.js';
import { DAY_INSTANTS, dateClockLabel, rangeLabel, venueTimeLine } from '../venueTime.js';
import { rememberTitles, titleOf } from '../titles.js';
import { startLiveRefresh } from '../live.js';
import { notFoundBlock } from './notFound.js';

export function sessionPage(id: string): Page {
  const element = el('main', { class: 'page page-session', id: 'main' });
  const body = el('div', { class: 'session-body' });
  const bookingRegion = liveRegion('Booking messages');
  let session: SessionView | null = null;
  let refusal: RowRefusal | null = null;
  let speakerBios: Readonly<Record<string, string>> = {};

  const host: BookingHost = {
    messages: bookingRegion,
    reload: async (wish: FocusWish) => {
      await load();
      applyFocusWish(element, wish);
    },
    setRowRefusal: (_sessionId, next) => {
      refusal = next;
    },
    titleOf,
  };

  function detailsTable(current: SessionView): HTMLElement {
    const rows: readonly (readonly [string, string])[] = [
      ['Stage', current.stage_name ?? current.location ?? 'Not set'],
      ['Format', current.format_label ?? 'Not set'],
      ['Starts', dateClockLabel(current.date, current.start_local)],
      ['Ends', dateClockLabel(current.date, current.end_local)],
      ['Capacity', current.seats === null ? 'No reservations' : String(current.seats.capacity)],
      ['Seats left', current.seats === null ? 'No reservations' : String(current.seats.left)],
      ['Waitlist', current.waitlist_count === null ? 'No reservations' : String(current.waitlist_count)],
    ];
    return el('table', { class: 'details', 'aria-label': 'Session details' }, [
      el(
        'tbody',
        {},
        rows.map(([label, value]) =>
          el('tr', {}, [el('th', { scope: 'row', text: label }), el('td', { text: value })]),
        ),
      ),
    ]);
  }

  function paint(): void {
    clear(body);
    if (session === null) return;
    const day = session.day === 2 ? 2 : 1;
    body.append(
      el('p', { class: 'session-when', text: `Day ${day} · ${rangeLabel(session.start_local, session.end_local)}` }),
      el('h1', { class: 'session-title', text: session.title }),
      el('p', { class: 'venue-line', text: venueTimeLine(DAY_INSTANTS[day]) }),
    );
    if (session.speakers.length > 0) {
      const speakers = el('div', { class: 'session-speakers' });
      for (const speaker of session.speakers) {
        const block = el('div', { class: 'session-speaker' }, [
          el('p', { class: 'speaker-name', text: `${speaker.name} - ${speaker.company}` }),
        ]);
        const bio = speakerBios[speaker.name];
        if (bio !== undefined && bio !== '') block.appendChild(markup('p', 'speaker-bio', bio));
        speakers.appendChild(block);
      }
      body.appendChild(speakers);
    } else {
      body.appendChild(el('p', { class: 'row-speakers', text: speakerLine(session) }));
    }
    const pillRow = el('div', { class: 'pill-row' }, pills(session));
    if (pillRow.childElementCount > 0) body.appendChild(pillRow);
    body.appendChild(el('p', { class: 'session-description', text: session.description }));
    body.appendChild(detailsTable(session));
    const seats = seatLine(session);
    if (seats !== null) body.appendChild(seats);
    const waiting = waitlistLine(session);
    if (waiting !== null) body.appendChild(waiting);
    if (session.seats !== null && session.seats.left <= 0 && session.my_hold === null) {
      body.appendChild(el('p', { class: 'row-helper', text: 'Join the waitlist to be next in line.' }));
    }
    for (const node of seatControls(session, { refusal, showPosition: true, showHoldLine: false })) {
      body.appendChild(node);
    }
    wireBookingControls(body, [session], host);
  }

  async function load(): Promise<void> {
    try {
      session = await api.session(id);
      rememberTitles([session]);
      paint();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'not_found') {
        clear(element);
        element.appendChild(notFoundBlock('session'));
        return;
      }
      throw error;
    }
  }

  let stopLive: (() => void) | null = null;

  return {
    element,
    mount: () => {
      element.append(el('p', { class: 'loading', text: 'Loading' }));
      void (async () => {
        try {
          const speakers = await api.speakers();
          speakerBios = Object.fromEntries(speakers.map((speaker) => [speaker.name, speaker.bio_html]));
        } catch {
          speakerBios = {};
        }
        element.querySelector('.loading')?.remove();
        element.append(bookingRegion, body);
        await load().catch(() => undefined);
        restoreScroll();
        stopLive = startLiveRefresh(async () => {
          const before = (document.activeElement as HTMLElement | null)?.dataset['focusKey'] ?? null;
          if (body.querySelector('[aria-disabled="true"]') !== null) return;
          await load();
          if (before !== null && !element.contains(document.activeElement)) {
            applyFocusWish(element, { kind: 'key', key: before });
          }
        });
      })();
    },
    unmount: () => stopLive?.(),
  };
}
