import type { Booking, PackLedger } from '../../shared/types.js';
import { api } from '../api.js';
import { hours } from '../copy.js';
import { clear, el, statusRegion } from '../dom.js';
import { ticketListItem, type TicketContext } from '../ticket.js';

export function ticketsScreen(host: HTMLElement): void {
  const status = statusRegion('Dial status');
  const packBalance = el('p', { class: 'pack-balance mono' }, ['Pack balance 0.00 h']);
  const list = el('ul', { class: 'ticket-list', 'aria-label': 'Booking tickets' });
  const context: TicketContext = {
    status,
    refresh: async () => {
      await load();
    },
  };

  async function load(): Promise<void> {
    const pack = await api.get<PackLedger>('/api/me/pack');
    if (pack.ok) packBalance.textContent = `Pack balance ${hours(pack.data.available_minutes)} h`;
    const result = await api.get<{ bookings: Booking[] }>('/api/bookings');
    clear(list);
    if (!result.ok) return;
    const sorted = [...result.data.bookings].sort((left, right) =>
      right.start_at.localeCompare(left.start_at),
    );
    for (const booking of sorted) list.append(ticketListItem(booking, context));
    if (sorted.length === 0) {
      list.append(el('li', { class: 'rail-empty', role: 'listitem' }, ['No tickets yet.']));
    }
  }

  host.append(
    el('section', { class: 'panel' }, [
      el('h1', {}, ['Tickets']),
      packBalance,
      status,
      el('div', { class: 'table-frame' }, [list]),
    ]),
  );
  void load();
}
