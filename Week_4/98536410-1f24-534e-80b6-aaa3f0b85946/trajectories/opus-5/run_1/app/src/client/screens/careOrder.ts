import { announce, el, on } from '../lib/dom.js';
import { ApiFailure, get, post } from '../lib/api.js';
import { COPY, amount, lisbonStamp } from '../lib/copy.js';
import { makeLife } from '../lib/life.js';
import { focusByName, focusIdOf, trapFocus } from '../lib/focus.js';
import type { Trap } from '../lib/focus.js';
import { closeWithMotion, openWithMotion, setFigure } from '../lib/motion.js';
import { loadTabState, saveTabState } from '../lib/state.js';
import { isStorageDown, onStorageChange, pauseControl } from '../components/chrome.js';
import type { HistoryEvent, Order } from '../lib/types.js';
import type { Screen } from '../router.js';

type Memory = { historyScroll: number; focusId: string | null; message: string };

export function careOrderScreen(params: Record<string, string>): Screen {
  const orderId = params['orderId'] as string;
  const life = makeLife();

  const updates = el('p', { class: 'live-region', role: 'status', 'aria-label': 'Care updates' });

  const say = (message: string): void => {
    announce(updates, message);
    remember();
  };

  const title = el('h1', { class: 'screen-title' }, 'Order');
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
        el('th', {}, 'VAT'),
        el('th', {}, 'Returned'),
      ]),
    ),
    linesBody,
  ]);

  const historyList = el('ul', { class: 'history-list', 'aria-label': 'Order history' });

  const verify = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'verify-history' },
    'Verify history',
  );
  const download = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'download-document' },
    'Download order document',
  );
  const cancel = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'cancel-order' },
    'Cancel order',
  );

  const confirmCancel = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'confirm-cancel' },
    'Cancel order',
  );
  const keepOrder = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'keep-order' },
    'Keep order',
  );
  const cancelDialog = el(
    'div',
    {
      class: 'dialog cancel-dialog',
      role: 'alertdialog',
      'aria-label': 'Cancel order',
      'aria-modal': 'true',
      'data-state': 'closed',
    },
    [
      el('h2', {}, 'Cancel order'),
      el('p', {}, 'Cancelling returns the units to the shelf.'),
      el('div', { class: 'dialog-actions' }, [confirmCancel, keepOrder]),
    ],
  );

  let cancelTrap: Trap | null = null;
  const closeCancel = (): void => {
    cancelTrap?.release();
    cancelTrap = null;
    closeWithMotion(cancelDialog);
    cancel.focus();
  };
  on(keepOrder, 'click', closeCancel);
  on(cancel, 'click', () => {
    openWithMotion(cancelDialog);
    cancelTrap = trapFocus(cancelDialog, closeCancel);
    keepOrder.focus();
  });

  let orderNumber = '';

  on(confirmCancel, 'click', () => {
    say(COPY.saving);
    void post<Order>(`/api/orders/${orderId}/transitions`, { to: 'cancelled' })
      .then((order) => {
        paint(order);
        say(`Order ${order.number} is now ${order.status}.`);
        closeCancel();
        void loadHistory();
      })
      .catch(() => {
        say(`That step is not possible for order ${orderNumber} now.`);
        closeCancel();
      });
  });

  on(verify, 'click', () => {
    say(COPY.verifyingHistory);
    void get<{ last_seq: number }>(`/api/orders/${orderId}/replay`)
      .then((answer) => say(`History verified: ${answer.last_seq} entries.`))
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.code === 'sequence_broken') {
          say(`History is damaged from entry ${String(error.payload['first_bad_seq'])}.`);
          return;
        }
        say(COPY.somethingWrong);
      });
  });

  on(download, 'click', () => {
    if (isStorageDown()) {
      say(COPY.documentPaused);
      return;
    }
    say(COPY.documentPending);
    void get<unknown>(`/api/orders/${orderId}/document`)
      .then((stored) => {
        const blob = new Blob([JSON.stringify(stored)], { type: 'application/json' });
        const link = el('a', { href: URL.createObjectURL(blob), download: `${orderNumber}.json` });
        link.click();
        URL.revokeObjectURL(link.href);
      })
      .catch(() => say(isStorageDown() ? COPY.documentPaused : COPY.somethingWrong));
  });

  onStorageChange((down) => {
    pauseControl(download, 'care-document-pause', COPY.documentPaused, down);
  });

  const node = el('section', { class: 'care-order-screen' }, [
    el('div', { class: 'care-order-facts' }, [
      title,
      facts,
      el('p', { class: 'order-total-line' }, [el('span', {}, 'Total: '), orderTotal]),
    ]),
    el('div', { class: 'care-order-history' }, [
      el('h2', {}, 'Order history'),
      el('div', { class: 'charcoal-panel history-holder' }, historyList),
      el('div', { class: 'care-actions' }, [verify, download, cancel]),
      updates,
    ]),
    el('div', { class: 'charcoal-panel table-holder care-lines' }, linesTable),
    cancelDialog,
  ]);

  function paint(order: Order): void {
    orderNumber = order.number;
    title.textContent = `Order ${order.number}`;
    facts.replaceChildren(
      el('dt', {}, 'Status'),
      el('dd', {}, order.status),
      el('dt', {}, 'Shop'),
      el('dd', {}, order.store_name),
      el('dt', {}, 'Collection'),
      el('dd', {}, `${order.slot_local_date} at ${order.slot_local_time} (${order.timezone})`),
      el('dt', {}, 'Customer'),
      el('dd', {}, `${order.customer.name} (${order.customer.email})`),
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
          el('td', {}, amount(line.vat_cents)),
          el('td', {}, String(line.returned_quantity)),
        ]),
      ),
    );
  }

  async function loadHistory(): Promise<void> {
    try {
      const answer = await get<{ events: HistoryEvent[] }>(`/api/orders/${orderId}/events`);
      historyList.replaceChildren(
        ...answer.events.map((event) =>
          el(
            'li',
            { class: 'history-item' },
            `#${event.seq} ${event.type} ${lisbonStamp(event.at)}`,
          ),
        ),
      );
    } catch {
      say(COPY.somethingWrong);
    }
  }

  function remember(): void {
    saveTabState<Memory>(`care.order.${orderId}`, {
      historyScroll: historyList.scrollTop,
      focusId: focusIdOf(document.activeElement),
      message: updates.textContent ?? '',
    });
  }
  life.listen(historyList, 'scroll', remember);
  life.listen(node, 'focusin', remember);

  return {
    node,
    destroy: () => life.kill(),
    afterMount: () => {
      const memory = loadTabState<Memory>(`care.order.${orderId}`);
      if (memory?.message) announce(updates, memory.message);
      void Promise.all([get<Order>(`/api/orders/${orderId}`), loadHistory()]).then(([order]) => {
        paint(order);
        if (memory) {
          historyList.scrollTop = memory.historyScroll;
          focusByName(node, memory.focusId);
        }
      });
    },
  };
}
