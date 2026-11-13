import { h, clear } from '../lib/els.js';
import { router } from '../lib/router.js';
import { api } from '../lib/api.js';
import { shortDate, hhmm } from '../lib/fmt.js';
import type { Booking, Ride } from '../lib/types.js';

export async function myRidesPage(): Promise<HTMLElement> {
  const root = h('div');
  const tab = router.query.get('tab') === 'past' ? 'past' : 'upcoming';

  const list = h('div');
  const upcomingTab = h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'upcoming' ? 'true' : 'false', class: 'btn ghost tab', onClick: () => go('upcoming') }, 'Upcoming');
  const pastTab = h('button', { type: 'button', role: 'tab', 'aria-selected': tab === 'past' ? 'true' : 'false', class: 'btn ghost tab', onClick: () => go('past') }, 'Past');

  const tablist = h('div', { role: 'tablist', 'aria-label': 'My rides', class: 'tablist' }, upcomingTab, pastTab);
  const panel = h('div', { role: 'tabpanel', tabindex: '0' }, list);

  // swipe between tabs
  let startX: number | null = null;
  panel.addEventListener('touchstart', (e: TouchEvent) => { startX = e.touches[0].clientX; }, { passive: true });
  panel.addEventListener('touchend', (e: TouchEvent) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (dx <= -60) go('past');
    else if (dx >= 60) go('upcoming');
  });

  const go = (next: 'upcoming' | 'past'): void => {
    router.go('/my-rides', { tab: next === 'upcoming' ? undefined : 'past' });
    void render(next);
  };

  const render = async (which: 'upcoming' | 'past'): Promise<void> => {
    upcomingTab.setAttribute('aria-selected', which === 'upcoming' ? 'true' : 'false');
    pastTab.setAttribute('aria-selected', which === 'past' ? 'true' : 'false');
    clear(list);
    const data = await api<{ bookings: Booking[]; rides: Ride[] }>('GET', `/api/me/bookings?tab=${which}`);
    const items: HTMLElement[] = [];
    for (const b of data.bookings) {
      items.push(h('li', { 'data-id': b.id }, h('a', { href: `/bookings/${b.id}` }, `${b.boarding} to ${b.alighting}, ${shortDate(b.boarding_time)} ${hhmm(b.boarding_time)} — ${b.state.replace(/_/g, ' ')}`)));
    }
    for (const r of data.rides) {
      items.push(h('li', { 'data-id': r.id }, h('a', { href: `/rides/${r.id}` }, `${r.stops[0].city} to ${r.stops[r.stops.length - 1].city}, ${shortDate(r.stops[0].time)} — you drive`)));
    }
    if (items.length === 0) {
      list.append(h('div', { class: 'empty' },
        h('div', null, h('div', { class: 'plate plate-square', style: { maxWidth: '180px', marginLeft: 'auto' } })),
        h('p', { class: 'empty-sentence' }, which === 'upcoming' ? 'No upcoming trips.' : 'No past trips yet.'),
      ));
      return;
    }
    list.append(h('ul', { class: 'list-plain', role: 'list' }, ...items));
  };

  root.append(h('h1', null, 'My rides'), tablist, panel);
  await render(tab);
  return root;
}
