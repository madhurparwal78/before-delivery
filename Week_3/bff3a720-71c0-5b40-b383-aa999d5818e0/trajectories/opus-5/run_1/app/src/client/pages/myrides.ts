import { api } from '../api.js';
import { copy, seats as seatWord } from '../copy.js';
import { clear, h } from '../dom.js';
import { money } from '../../shared/format.js';
import { dateLabel, timeLabel } from '../../shared/zoned.js';
import { plate } from '../plates.js';
import { navigate, replaceQuery, type RouteContext } from '../router.js';
import { mainRegion } from '../shell.js';
import { currentMember } from '../state.js';
import { onSwipe } from '../components/swipe.js';
import type { Booking, Ride } from '../types.js';

type Tab = 'upcoming' | 'past';

const SWIPE_PX = 60;

export function renderMyRides(ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);
  if (!currentMember()) {
    navigate('/sign-in?next=%2Fmy-rides');
    return;
  }
  let tab: Tab = ctx.query.get('tab') === 'past' ? 'past' : 'upcoming';

  const tablist = h('div', { role: 'tablist', 'aria-label': 'My rides', class: 'tablist' });
  const panel = h('div', { role: 'tabpanel', class: 'tabpanel' });
  const tabs: Record<Tab, HTMLElement> = {
    upcoming: h('div', {
      role: 'tab',
      'aria-label': 'Upcoming',
      tabindex: '0',
      class: 'tab',
      text: 'Upcoming',
    }),
    past: h('div', {
      role: 'tab',
      'aria-label': 'Past',
      tabindex: '-1',
      class: 'tab',
      text: 'Past',
    }),
  };

  const show = (next: Tab) => {
    tab = next;
    for (const name of ['upcoming', 'past'] as Tab[]) {
      tabs[name].setAttribute('aria-selected', name === tab ? 'true' : 'false');
      tabs[name].setAttribute('tabindex', name === tab ? '0' : '-1');
    }
    replaceQuery(`/my-rides?tab=${tab}`);
    void load();
  };

  for (const name of ['upcoming', 'past'] as Tab[]) {
    tabs[name].addEventListener('click', () => show(name));
    tabs[name].addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        show('past');
        tabs.past.focus();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        show('upcoming');
        tabs.upcoming.focus();
      }
    });
    tablist.appendChild(tabs[name]);
  }

  // Right to left moves to Past, left to right back to Upcoming.
  onSwipe(panel, SWIPE_PX, (direction) => {
    if (direction === 'left') show('past');
    else if (direction === 'right') show('upcoming');
  });

  const load = async () => {
    const result = await api<{ bookings: Booking[]; rides: Ride[] }>(
      'GET',
      `/api/me/bookings?tab=${tab}`,
    );
    clear(panel);
    if (!result.ok) return;
    const { bookings, rides } = result.data;
    if (bookings.length === 0 && rides.length === 0) {
      panel.append(
        plate({
          seed: `my-rides-${tab}`,
          leg: 'Kestrevel to Tollemarch',
          kind: 'fields',
          ratio: 1,
          className: 'plate-empty',
        }),
        h('p', {
          class: 'empty-line',
          text: tab === 'upcoming' ? copy.emptyUpcoming : copy.emptyPast,
        }),
      );
      return;
    }
    const list = h('ul', { class: 'my-list' });
    for (const booking of bookings) {
      list.appendChild(
        h(
          'li',
          { 'data-id': booking.id },
          h('a', {
            href: `/bookings/${booking.id}`,
            text: `${timeLabel(booking.boarding_time)} ${dateLabel(booking.boarding_time)} ${
              booking.boarding
            } to ${booking.alighting}, ${seatWord(booking.seats)}, ${money(
              booking.price_cents,
            )}, ${booking.state}`,
          }),
        ),
      );
    }
    for (const ride of rides) {
      const last = ride.stops[ride.stops.length - 1];
      list.appendChild(
        h(
          'li',
          { 'data-id': ride.id },
          h('a', {
            href: `/rides/${ride.id}`,
            text: `${timeLabel(ride.departure)} ${dateLabel(ride.departure)} ${
              ride.stops[0]?.city
            } to ${last?.city}, driving, ${ride.state}`,
          }),
        ),
      );
    }
    panel.appendChild(list);
  };

  main.append(h('h1', { text: 'My rides' }), tablist, panel);
  show(tab);
}
