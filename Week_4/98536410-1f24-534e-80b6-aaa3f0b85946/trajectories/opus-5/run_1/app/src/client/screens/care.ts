import { announce, clear, el, on } from '../lib/dom.js';
import { LatestOnly, get } from '../lib/api.js';
import { COPY, amount } from '../lib/copy.js';
import { makeLife } from '../lib/life.js';
import type { OrderPage } from '../lib/types.js';
import { navigate, type Screen } from '../router.js';

const SEARCH_DEBOUNCE_MILLIS = 333;

export function careSearchScreen(): Screen {
  const life = makeLife();
  const loader = new LatestOnly();
  let timer: number | null = null;
  let nextBefore: string | null = null;
  let shown = 0;
  let total = 0;

  const updates = el('p', { class: 'live-region', role: 'status', 'aria-label': 'Care updates' });

  const search = el('input', {
    type: 'search',
    class: 'text-box',
    'aria-label': 'Find order',
    'data-focus-id': 'find-order',
  });

  const body = el('tbody');
  const table = el('table', { class: 'data-table', 'aria-label': 'Orders' }, [
    el(
      'thead',
      {},
      el('tr', {}, [
        el('th', {}, 'Order'),
        el('th', {}, 'Status'),
        el('th', {}, 'Shop'),
        el('th', {}, 'Customer'),
        el('th', {}, 'Total'),
      ]),
    ),
    body,
  ]);

  const showMore = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'show-more-orders' },
    'Show more orders',
  );
  showMore.hidden = true;

  function appendRows(page: OrderPage): HTMLElement | null {
    let firstLink: HTMLElement | null = null;
    for (const order of page.orders) {
      const link = el(
        'a',
        {
          class: 'order-link',
          href: `/care/orders/${order.id}`,
          'aria-label': `Open order ${order.number}`,
          'data-focus-id': `open-order-${order.number}`,
        },
        order.number,
      );
      on(link, 'click', (event) => {
        event.preventDefault();
        void navigate(`/care/orders/${order.id}`);
      });
      if (!firstLink) firstLink = link;
      body.appendChild(
        el('tr', { 'data-order-id': order.id }, [
          el('td', {}, link),
          el('td', {}, order.status),
          el('td', {}, order.store_name),
          el('td', {}, order.customer_email),
          el('td', {}, amount(order.total_cents)),
        ]),
      );
    }
    return firstLink;
  }

  async function load(): Promise<void> {
    const text = search.value.trim();
    announce(updates, COPY.searching);
    try {
      await loader.run(
        () => get<OrderPage>(`/api/orders?q=${encodeURIComponent(text)}&limit=20`),
        (page) => {
          clear(body);
          shown = page.orders.length;
          total = page.count;
          nextBefore = page.next_before;
          appendRows(page);
          showMore.hidden = nextBefore === null;
          announce(updates, total === 0 ? COPY.noOrders : `${total} orders found.`);
        },
      );
    } catch {
      announce(updates, COPY.somethingWrong);
    }
  }

  on(search, 'input', () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = life.after(SEARCH_DEBOUNCE_MILLIS, () => void load());
  });

  on(showMore, 'click', () => {
    if (!nextBefore) return;
    announce(updates, COPY.loadingMoreOrders);
    const text = search.value.trim();
    void get<OrderPage>(
      `/api/orders?q=${encodeURIComponent(text)}&limit=20&before=${encodeURIComponent(nextBefore)}`,
    )
      .then((page) => {
        const first = appendRows(page);
        shown += page.orders.length;
        total = page.count;
        nextBefore = page.next_before;
        showMore.hidden = nextBefore === null;
        announce(updates, `Showing ${shown} of ${total} orders.`);
        first?.focus();
      })
      .catch(() => announce(updates, COPY.somethingWrong));
  });

  const node = el('section', { class: 'care-screen' }, [
    el('h1', { class: 'screen-title' }, 'Order search'),
    el('label', { class: 'field' }, [el('span', {}, 'Find order'), search]),
    el('div', { class: 'charcoal-panel table-holder' }, table),
    showMore,
    updates,
  ]);

  return {
    node,
    destroy: () => life.kill(),
    afterMount: () => void load(),
  };
}
