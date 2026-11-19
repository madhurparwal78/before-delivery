import { announce, el, on } from '../lib/dom.js';
import { get } from '../lib/api.js';
import { COPY, amount } from '../lib/copy.js';
import { makeLife } from '../lib/life.js';
import { setFigure } from '../lib/motion.js';
import { loadTabState } from '../lib/state.js';
import { isStorageDown, onStorageChange, pauseControl } from '../components/chrome.js';
import type { Order } from '../lib/types.js';
import type { Screen } from '../router.js';

type Success = { orderId: string; message: string };

export function orderScreen(params: Record<string, string>): Screen {
  const orderId = params['orderId'] as string;
  const life = makeLife();

  const title = el('h1', { class: 'screen-title', tabindex: '-1' }, 'Order');
  const facts = el('dl', { class: 'order-facts' });
  const orderTotal = el('span', { class: 'figure order-total' });
  const linesBody = el('tbody');
  const linesTable = el('table', { class: 'data-table', 'aria-label': 'Order lines' }, [
    el(
      'thead',
      {},
      el('tr', {}, [
        el('th', {}, 'Item'),
        el('th', {}, 'Quantity'),
        el('th', {}, 'Line total'),
        el('th', {}, 'Returned'),
      ]),
    ),
    linesBody,
  ]);
  const messages = el('p', {
    class: 'live-region',
    role: 'status',
    'aria-label': 'Order messages',
  });
  const download = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'download-document' },
    'Download order document',
  );

  on(download, 'click', () => {
    if (isStorageDown()) {
      announce(messages, COPY.documentPaused);
      return;
    }
    announce(messages, COPY.documentPending);
    void get<unknown>(`/api/orders/${orderId}/document`)
      .then((document_) => {
        const blob = new Blob([JSON.stringify(document_)], { type: 'application/json' });
        const link = el('a', { href: URL.createObjectURL(blob), download: `${orderId}.json` });
        link.click();
        URL.revokeObjectURL(link.href);
      })
      .catch(() =>
        announce(messages, isStorageDown() ? COPY.documentPaused : COPY.somethingWrong),
      );
  });

  onStorageChange((down) => {
    pauseControl(download, 'order-document-pause', COPY.documentPaused, down);
  });

  const node = el('section', { class: 'order-screen' }, [
    title,
    facts,
    el('p', { class: 'order-total-line' }, [el('span', {}, 'Total: '), orderTotal]),
    el('div', { class: 'charcoal-panel table-holder' }, linesTable),
    download,
    messages,
  ]);

  function paint(order: Order): void {
    title.textContent = `Order ${order.number}`;
    facts.replaceChildren(
      el('dt', {}, 'Status'),
      el('dd', {}, order.status),
      el('dt', {}, 'Shop'),
      el('dd', {}, order.store_name),
      el('dt', {}, 'Collection'),
      el('dd', {}, `${order.slot_local_date} at ${order.slot_local_time} (${order.timezone})`),
      el('dt', {}, 'Refunded'),
      el('dd', {}, amount(order.refunded_cents)),
    );
    setFigure(orderTotal, 'order-total', order.total_cents, amount);
    linesBody.replaceChildren(
      ...order.lines.map((line) =>
        el('tr', {}, [
          el('td', {}, `${line.sku} ${line.name}`),
          el('td', {}, String(line.quantity)),
          el('td', {}, amount(line.line_total_cents)),
          el('td', {}, String(line.returned_quantity)),
        ]),
      ),
    );
  }

  return {
    node,
    destroy: () => life.kill(),
    afterMount: () => {
      const success = loadTabState<Success>('order.success');
      if (success && success.orderId === orderId) announce(messages, success.message);
      title.focus();
      void get<Order>(`/api/orders/${orderId}`).then(paint);
    },
  };
}
