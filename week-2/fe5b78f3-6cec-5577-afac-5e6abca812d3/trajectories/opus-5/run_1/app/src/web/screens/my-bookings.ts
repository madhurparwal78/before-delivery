import { ApiRequestError, api } from '../api';
import { h } from '../dom';
import { longDate } from '../format';
import type { Screen, ScreenContext } from '../screen';

export async function renderMyBookings(context: ScreenContext): Promise<Screen> {
  const { main, router } = context;
  const list = h('ul', { class: 'plain-list', 'aria-label': 'My bookings' });
  main.appendChild(h('div', { class: 'panel' }, [h('h1', {}, ['My bookings']), list]));

  const body = await api.myBookings().catch((error: unknown) => {
    if (error instanceof ApiRequestError && error.status === 401) {
      router.go(`/signin?next=${encodeURIComponent('/bookings')}`, true);
      return null;
    }
    throw error;
  });
  if (body === null) return { ribbon: [] };
  if (body.bookings.length === 0) {
    list.appendChild(h('li', {}, ['No bookings yet.']));
    return { ribbon: [] };
  }
  for (const booking of body.bookings) {
    const link = h('a', { href: `/bookings/${booking.pnr}` }, [`PNR ${booking.pnr}`]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      router.go(`/bookings/${booking.pnr}`);
    });
    list.appendChild(h('li', {}, [
      link,
      h('div', { class: 'passenger-note' }, [
        `${booking.train.number} ${booking.train.name} · ${longDate(booking.run_date)} · `
        + `${booking.from} to ${booking.to} · ${booking.summary}`,
      ]),
    ]));
  }
  return { ribbon: [] };
}
