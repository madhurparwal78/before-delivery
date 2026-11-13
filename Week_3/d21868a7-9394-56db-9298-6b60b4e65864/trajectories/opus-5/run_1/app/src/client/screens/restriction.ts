import { api } from '../api.ts';
import { copy } from '../copy.ts';
import { bigFigure } from '../counters.ts';
import { clear, el, setText } from '../dom.ts';
import type { Screen } from '../screen.ts';
import type { RestrictionRecord, WindowRecord } from '../types.ts';

/** One published restriction, with the announcement its publish made. */

interface RestrictionReply {
  restriction: RestrictionRecord;
  window: WindowRecord;
  moved_orders: string[];
}

export async function restrictionScreen(restrictionId: string): Promise<Screen> {
  const first = await api.get<RestrictionReply>(`/api/restrictions/${encodeURIComponent(restrictionId)}`);
  const remaining = bigFigure('Window remaining ML', first.window.remaining_ml);
  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Board status', 'aria-live': 'polite' },
  });
  const details = el('dl', { class: 'details' });
  const moved = el('ul', { class: 'plain-list' });

  const element = el('main', {
    class: 'page',
    children: [
      el('div', { class: 'counter-lead', children: [remaining.element] }),
      el('h1', { text: `Restriction ${first.restriction.id}` }),
      el('section', {
        class: 'card',
        children: [details, el('h2', { text: 'Orders moved to requested' }), moved, status],
      }),
    ],
  });

  const paint = (reply: RestrictionReply): void => {
    setText(remaining.figure, reply.window.remaining_ml);
    clear(details);
    const entries: [string, string][] = [
      ['Channel', reply.window.channel_name],
      ['Window', reply.window.label],
      ['Cap (ML/day)', reply.restriction.cap_ml_day],
      ['Reason', reply.restriction.reason],
      ['Effective at', reply.restriction.effective_at],
      ['Cap volume (ML)', reply.window.cap_volume_ml],
    ];
    for (const [term, value] of entries) {
      details.appendChild(el('dt', { text: term }));
      details.appendChild(el('dd', { class: 'tabular', text: value }));
    }
    clear(moved);
    for (const orderNumber of reply.moved_orders) {
      moved.appendChild(
        el('li', { children: [el('a', { text: orderNumber, attrs: { href: `/orders/${orderNumber}` } })] }),
      );
    }
    setText(
      status,
      copy.restrictionPublished(reply.window.channel_name, reply.window.label, reply.moved_orders.length),
    );
  };

  paint(first);

  const refresh = async (): Promise<void> => {
    paint(await api.get<RestrictionReply>(`/api/restrictions/${encodeURIComponent(restrictionId)}`));
  };

  return { element, refresh };
}
