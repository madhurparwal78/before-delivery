import { orderStatusLabel } from '../../domain/orders.ts';
import { WINDOW_STATUS_LABELS } from '../../domain/time.ts';
import { api } from '../api.ts';
import { copy } from '../copy.ts';
import { allocationCounter } from '../counters.ts';
import { el, renderWhenChanged, setText } from '../dom.ts';
import type { Screen } from '../screen.ts';
import { dataRow, dataTable } from '../table.ts';
import type { Allocation, OrderRecord, TurnoutRecord, WindowRecord } from '../types.ts';

/** Grower home: the allocation counter, their orders and the windows they can order in. */

export async function growerHomeScreen(): Promise<Screen> {
  const counter = allocationCounter();
  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Order status', 'aria-live': 'polite' },
  });

  const orders = dataTable('Your orders', ['Order', 'Turnout', 'Window', 'Volume (ML)', 'Rate (ML/day)', 'Status']);
  const windowList = el('ul', { class: 'window-list' });

  const element = el('main', {
    class: 'page',
    children: [
      el('div', {
        class: 'grower-grid',
        children: [
          el('div', {
            children: [
              counter.element,
              el('section', {
                class: 'card',
                children: [el('h2', { text: 'Windows on your channels' }), windowList],
              }),
            ],
          }),
          el('section', {
            class: 'card',
            children: [el('h1', { text: 'Your orders' }), orders.element, status],
          }),
        ],
      }),
    ],
  });

  const lastStatus = new Map<string, string>();
  let first = true;

  const paint = (orderRows: OrderRecord[], windows: WindowRecord[], labels: Map<string, string>): void => {
    const orderSignature = orderRows
      .map((order) => [order.number, order.turnout, order.window_id, order.volume_ml, order.rate_ml_day, order.status].join('|'))
      .join('\u0001');
    renderWhenChanged(orders.body, orderSignature, () => {
      for (const order of orderRows) {
        orders.body.appendChild(
          dataRow([
            {
              label: 'Order',
              content: el('a', { text: order.number, attrs: { href: `/orders/${order.number}` } }),
            },
            { label: 'Turnout', content: order.turnout },
            { label: 'Window', content: labels.get(order.window_id) ?? order.window_id },
            { label: 'Volume (ML)', content: el('span', { class: 'tabular', text: order.volume_ml }) },
            { label: 'Rate (ML/day)', content: el('span', { class: 'tabular', text: order.rate_ml_day }) },
            { label: 'Status', content: orderStatusLabel(order.status) },
          ]),
        );
      }
    });

    const windowSignature = windows
      .map((window) => [window.id, window.label, window.status, window.remaining_ml].join('|'))
      .join('\u0001');
    renderWhenChanged(windowList, windowSignature, () => {
      for (const window of windows) {
        windowList.appendChild(
          el('li', {
            class: 'window-item',
            children: [
              el('span', { class: 'window-label', text: `${window.channel_name}, ${window.label}` }),
              el('span', { class: 'window-status', text: WINDOW_STATUS_LABELS[window.status] }),
              el('span', { class: 'tabular counter-value-small', text: `${window.remaining_ml} ML` }),
              el('a', {
                text: 'Order in this window',
                attrs: { href: `/grower/orders/new?window=${window.id}` },
              }),
            ],
          }),
        );
      }
    });
  };

  const refresh = async (): Promise<void> => {
    const [allocation, orderReply, windowReply, turnoutReply] = await Promise.all([
      api.get<Allocation>('/api/me/allocation'),
      api.get<{ orders: OrderRecord[] }>('/api/orders'),
      api.get<{ windows: WindowRecord[] }>('/api/windows'),
      api.get<{ turnouts: TurnoutRecord[] }>('/api/turnouts'),
    ]);
    counter.apply(allocation);

    const ownChannels = new Set(turnoutReply.turnouts.map((turnout) => turnout.channel_id));
    const windows = windowReply.windows.filter((window) => ownChannels.has(window.channel_id));
    const labels = new Map(windowReply.windows.map((window) => [window.id, window.label]));
    const sorted = [...orderReply.orders].sort((a, b) => (a.number < b.number ? 1 : -1));
    paint(sorted, windows, labels);

    for (const order of sorted) {
      const previous = lastStatus.get(order.number);
      const next = `${order.status}:${order.conflict ?? ''}`;
      lastStatus.set(order.number, next);
      if (first || previous === undefined || previous === next) continue;
      setText(
        status,
        order.conflict === 'lapsed' && order.status === 'closed'
          ? copy.orderLapsed(order.number)
          : copy.orderNowStatus(order.number, order.status),
      );
    }
    first = false;
  };

  await refresh();
  return { element, refresh };
}
