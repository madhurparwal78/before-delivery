import { api, type MyAgenda, type SessionView } from '../api.js';
import { applyFocusWish, wireBookingControls, type BookingAction, type BookingHost, type FocusWish } from '../booking.js';
import { EMPTY_COPY, NOT_FOUND_COPY } from '../copy.js';
import { clear, el, liveRegion } from '../dom.js';
import { navigate, type Page } from '../router.js';
import { sessionRow, type RowRefusal } from '../components/sessionRow.js';
import { currentAccount } from '../session.js';
import { rememberTitles, titleOf } from '../titles.js';
import { startLiveRefresh } from '../live.js';

interface GroupSpec {
  readonly key: keyof MyAgenda;
  readonly heading: string;
  readonly empty: string;
  readonly showPosition: boolean;
}

const GROUPS: readonly GroupSpec[] = [
  { key: 'reserved', heading: 'Reserved seats', empty: EMPTY_COPY.reserved, showPosition: false },
  { key: 'held', heading: 'Seats held for you', empty: EMPTY_COPY.held, showPosition: false },
  { key: 'waitlisted', heading: 'Waitlist', empty: EMPTY_COPY.waitlist, showPosition: true },
  { key: 'saved', heading: 'Saved sessions', empty: EMPTY_COPY.saved, showPosition: false },
];

/** The action that takes a row out of each list on this page. */
const REMOVED_FROM: Readonly<Record<string, keyof MyAgenda>> = {
  cancel: 'reserved',
  release: 'held',
  leave: 'waitlisted',
  unsave: 'saved',
};

export function myAgendaPage(): Page {
  const element = el('main', { class: 'page page-my-agenda', id: 'main' });
  const bookingRegion = liveRegion('Booking messages');
  const groupsHost = el('div', { class: 'agenda-groups' });
  const refusals = new Map<string, RowRefusal>();
  let agenda: MyAgenda | null = null;

  const host: BookingHost = {
    messages: bookingRegion,
    reload: async (wish: FocusWish) => {
      await load();
      applyFocusWish(element, wish);
    },
    removalWish: (action: BookingAction, sessionId: string): FocusWish | null => {
      const list = REMOVED_FROM[action];
      if (list === undefined || agenda === null) return null;
      const index = agenda[list].findIndex((session) => session.id === sessionId);
      return index === -1 ? null : { kind: 'slot', list, index };
    },
    setRowRefusal: (sessionId, refusal) => {
      if (refusal === null) refusals.delete(sessionId);
      else refusals.set(sessionId, refusal);
    },
    titleOf,
  };

  function paint(): void {
    if (agenda === null) return;
    clear(groupsHost);
    const all: SessionView[] = [];
    for (const group of GROUPS) {
      const sessions = agenda[group.key];
      all.push(...sessions);
      const section = el('section', { class: 'agenda-group' }, [el('h2', { text: group.heading })]);
      if (sessions.length === 0) {
        section.appendChild(
          el('p', { class: 'empty-line', tabindex: '-1', 'data-empty': group.key, text: group.empty }),
        );
      } else {
        section.appendChild(
          el(
            'ul',
            { class: 'session-list', 'aria-label': group.heading, 'data-list': group.key },
            sessions.map((session) =>
              sessionRow(session, {
                refusal: refusals.get(session.id) ?? null,
                showPosition: group.showPosition,
                showHoldLine: false,
              }),
            ),
          ),
        );
      }
      groupsHost.appendChild(section);
    }
    rememberTitles(all);
    wireBookingControls(groupsHost, all, host);
  }

  async function load(): Promise<void> {
    agenda = await api.myAgenda();
    paint();
  }

  let stopLive: (() => void) | null = null;

  return {
    element,
    mount: () => {
      const account = currentAccount();
      if (account === null) {
        navigate(`/signin?next=${encodeURIComponent('/my-agenda')}`, { replace: true });
        return;
      }
      if (account.role === 'organiser') {
        element.append(
          el('h1', { text: 'My Agenda' }),
          el('p', { class: 'notice', text: NOT_FOUND_COPY.organiserAgenda }),
          el('p', {}, [el('a', { href: '/organiser', text: 'Go to the organiser page' })]),
        );
        return;
      }
      element.append(el('p', { class: 'loading', text: 'Loading' }));
      void (async () => {
        try {
          await load();
        } catch {
          agenda = { reserved: [], held: [], waitlisted: [], saved: [] };
          paint();
        }
        element.querySelector('.loading')?.remove();
        element.append(el('h1', { text: 'My Agenda' }), bookingRegion, groupsHost);
        stopLive = startLiveRefresh(async () => {
          if (groupsHost.querySelector('[aria-disabled="true"]') !== null) return;
          const before = (document.activeElement as HTMLElement | null)?.dataset['focusKey'] ?? null;
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
