import { orderStatusLabel } from '../../domain/orders.ts';
import { api, failureOf } from '../api.ts';
import { copy } from '../copy.ts';
import { bigFigure } from '../counters.ts';
import { el, setText } from '../dom.ts';
import type { Screen } from '../screen.ts';
import { getUser } from '../session.ts';
import type { OrderRecord, WindowRecord } from '../types.ts';

/** One order, with its window's remaining ML leading the screen. */

export async function orderPageScreen(orderNumber: string): Promise<Screen> {
  const user = getUser();
  const first = await api.get<{ order: OrderRecord }>(`/api/orders/${encodeURIComponent(orderNumber)}`);

  const remaining = bigFigure('Window remaining ML', '0.000');
  const stateValue = el('span', { class: 'state-value' });
  const stateGroup = el('div', {
    class: 'figure',
    attrs: { role: 'group', 'aria-label': 'Order state' },
    children: [el('span', { class: 'figure-label', text: 'Order state' }), stateValue],
  });

  const details = el('dl', { class: 'details' });
  const conflictLine = el('p', { class: 'conflict-line' });
  const rationedLine = el('p', { class: 'rationed-line' });
  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Order status', 'aria-live': 'polite' },
  });

  const cancel = el('button', { class: 'button', text: 'Cancel order', attrs: { type: 'button' } });
  const cancelHost = el('div', { class: 'actions' });

  const element = el('main', {
    class: 'page',
    children: [
      el('div', { class: 'counter-lead', children: [remaining.element] }),
      el('h1', { text: `Order ${first.order.number}` }),
      el('section', {
        class: 'card',
        children: [stateGroup, details, conflictLine, rationedLine, cancelHost, status],
      }),
    ],
  });

  let order = first.order;
  let cancelling = false;
  let lastSeen = '';

  const paintDetails = (window: WindowRecord): void => {
    const entries: [string, string][] = [
      ['Turnout', order.turnout],
      ['Window', `${window.channel_name}, ${window.label}`],
      ['Volume (ML)', order.volume_ml],
      ['Rate (ML/day)', order.rate_ml_day],
      ['Gate worked by', order.holder_code],
      ['Standby operator', order.standby_code ?? 'No standby'],
    ];
    const wanted = entries.map(([term, value]) => `${term}\u0000${value}`).join('\u0001');
    if (details.dataset.rendered !== wanted) {
      details.dataset.rendered = wanted;
      details.textContent = '';
      for (const [term, value] of entries) {
        details.appendChild(el('dt', { text: term }));
        details.appendChild(el('dd', { class: 'tabular', text: value }));
      }
    }
  };

  const paint = (window: WindowRecord): void => {
    setText(stateValue, orderStatusLabel(order.status));
    setText(remaining.figure, window.remaining_ml);
    paintDetails(window);
    setText(
      conflictLine,
      order.conflict === 'restriction'
        ? copy.conflictRestriction
        : order.conflict === 'lapsed'
          ? copy.conflictLapsed
          : '',
    );
    setText(rationedLine, order.rationed ? copy.rationedFrom(order.requested_ml) : '');

    const showCancel =
      user !== null && user.role === 'grower' && (order.status === 'requested' || order.status === 'scheduled');
    if (showCancel && !cancelHost.contains(cancel)) cancelHost.appendChild(cancel);
    if (!showCancel && cancelHost.contains(cancel)) cancel.remove();
  };

  cancel.addEventListener('click', () => {
    if (cancelling) return;
    cancelling = true;
    cancel.setAttribute('aria-disabled', 'true');
    setText(status, copy.cancelling);
    void (async () => {
      try {
        const reply = await api.post<{ order: OrderRecord; window: WindowRecord }>(
          `/api/orders/${encodeURIComponent(order.number)}/cancel`,
        );
        order = reply.order;
        lastSeen = seenKey(order);
        paint(reply.window);
        setText(status, copy.orderNowClosed(order.number));
      } catch (cause) {
        const failure = failureOf(cause);
        setText(status, failure?.code === 'illegal_transition' ? copy.illegalTransition : failure?.message ?? '');
      } finally {
        cancelling = false;
        cancel.setAttribute('aria-disabled', 'false');
      }
    })();
  });

  const refresh = async (): Promise<void> => {
    const reply = await api.get<{ order: OrderRecord }>(`/api/orders/${encodeURIComponent(orderNumber)}`);
    const window = await api.get<{ window: WindowRecord }>(`/api/windows/${encodeURIComponent(reply.order.window_id)}`);
    const next = seenKey(reply.order);
    const changed = lastSeen !== '' && next !== lastSeen;
    order = reply.order;
    lastSeen = next;
    paint(window.window);
    if (!changed) return;
    setText(
      status,
      order.status === 'closed' && order.conflict === 'lapsed'
        ? copy.orderLapsed(order.number)
        : copy.orderNowStatus(order.number, order.status),
    );
  };

  lastSeen = seenKey(first.order);
  const window = await api.get<{ window: WindowRecord }>(`/api/windows/${encodeURIComponent(first.order.window_id)}`);
  paint(window.window);

  return { element, refresh };
}

function seenKey(order: OrderRecord): string {
  return [order.status, order.conflict ?? '', order.volume_ml, order.rationed, order.holder_code].join('|');
}
