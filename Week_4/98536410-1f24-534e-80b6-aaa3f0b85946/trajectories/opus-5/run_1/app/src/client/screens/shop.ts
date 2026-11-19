import { announce, clear, el, ensureOrder, on } from '../lib/dom.js';
import { ApiFailure, call, get, makeRequestKey, post, put } from '../lib/api.js';
import { COPY, amount, weekdayName, wholeNumber } from '../lib/copy.js';
import { makeLife } from '../lib/life.js';
import { focusByName, focusIdOf, trapFocus } from '../lib/focus.js';
import type { Trap } from '../lib/focus.js';
import { closeWithMotion, openAtOnce, openWithMotion, setFigure } from '../lib/motion.js';
import { loadTabState, saveTabState, dropTabState } from '../lib/state.js';
import { isStorageDown, onStorageChange, pauseControl, rememberStoreNames } from '../components/chrome.js';
import type {
  DayEntry,
  DayPlan,
  Hold,
  Hours,
  Order,
  OrderPage,
  ReturnRecord,
  StockLine,
  Store,
} from '../lib/types.js';
import type { Screen } from '../router.js';

const LIVE_MILLIS = 5000;
const SECTION_NAMES = ['Orders', 'Active holds', 'Stock', 'Opening hours', 'Returns'] as const;
type SectionName = (typeof SECTION_NAMES)[number];

type HoursDraft = {
  effectiveFrom: string;
  days: DayEntry[];
  focusId: string | null;
  errors: Record<string, string>;
};

type ReturnDraft = {
  orderId: string;
  quantities: Record<string, number>;
  reason: string;
  focusId: string | null;
  scroll: number;
};

const ORDER_ACTIONS: { to: Order['status'] | 'return'; label: string; from: Order['status'][] }[] = [
  { to: 'picking', label: 'Start picking', from: ['placed'] },
  { to: 'ready', label: 'Mark ready', from: ['picking'] },
  { to: 'collected', label: 'Hand over', from: ['ready'] },
  { to: 'cancelled', label: 'Cancel', from: ['placed', 'picking', 'ready'] },
  { to: 'return', label: 'Start return', from: ['collected'] },
];

const RETURN_ACTIONS: { to: ReturnRecord['status'] | 'label'; label: string; from: ReturnRecord['status'][] }[] =
  [
    { to: 'received', label: 'Receive', from: ['requested'] },
    { to: 'settled', label: 'Settle', from: ['received'] },
    { to: 'declined', label: 'Decline', from: ['requested'] },
    { to: 'label', label: 'Return label', from: ['requested', 'received'] },
  ];

function sameActions(cell: HTMLElement, wanted: string[]): boolean {
  const present = [...cell.children].map((child) => (child as HTMLElement).dataset['action']);
  return present.length === wanted.length && present.every((name, index) => name === wanted[index]);
}

export function shopScreen(params: Record<string, string>): Screen {
  const storeId = params['storeId'] as string;
  const life = makeLife();

  let store: Store | null = null;
  let orders: Order[] = [];
  let returns: ReturnRecord[] = [];
  let hours: Hours | null = null;
  let draft: HoursDraft | null = null;
  let operatorStores: { id: string; name: string }[] = [];

  const updates = el('p', { class: 'live-region', role: 'status', 'aria-label': 'Shop updates' });

  const ordersBody = el('tbody');
  const ordersTable = el(
    'table',
    {
      class: 'data-table',
      'aria-label': 'Orders',
      tabindex: '0',
      'data-focus-id': 'orders-table',
    },
    [
      el(
        'thead',
        {},
        el('tr', {}, [
          el('th', {}, 'Order'),
          el('th', {}, 'Status'),
          el('th', {}, 'Collection'),
          el('th', {}, 'Total'),
          el('th', {}, 'Actions'),
        ]),
      ),
      ordersBody,
    ],
  );

  const holdsBody = el('tbody');
  const holdsTable = el('table', { class: 'data-table', 'aria-label': 'Active holds' }, [
    el(
      'thead',
      {},
      el('tr', {}, [el('th', {}, 'Hold'), el('th', {}, 'Items'), el('th', {}, 'Seconds left')]),
    ),
    holdsBody,
  ]);

  const stockBody = el('tbody');
  const stockTable = el('table', { class: 'data-table', 'aria-label': 'Stock' }, [
    el(
      'thead',
      {},
      el('tr', {}, [
        el('th', {}, 'Item'),
        el('th', {}, 'On hand'),
        el('th', {}, 'Held'),
        el('th', {}, 'Available'),
        el('th', {}, 'Actions'),
      ]),
    ),
    stockBody,
  ]);
  const recordTillSale = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'record-till-sale' },
    'Record till sale',
  );

  const returnsBody = el('tbody');
  const returnsTable = el(
    'table',
    {
      class: 'data-table',
      'aria-label': 'Returns',
      tabindex: '0',
      'data-focus-id': 'returns-table',
    },
    [
      el(
        'thead',
        {},
        el('tr', {}, [
          el('th', {}, 'Return'),
          el('th', {}, 'Status'),
          el('th', {}, 'Refund'),
          el('th', {}, 'Actions'),
        ]),
      ),
      returnsBody,
    ],
  );
  const labelOutput = el('pre', { class: 'return-label-output' });

  const effectiveFrom = el('input', {
    type: 'text',
    class: 'text-box',
    'aria-label': 'Effective from',
    placeholder: 'YYYY-MM-DD',
    'aria-describedby': 'effective-from-error',
    'data-focus-id': 'effective-from',
  });
  const effectiveFromError = el('p', { class: 'field-error', id: 'effective-from-error' });
  const publishHours = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'publish-hours' },
    'Publish hours',
  );
  const upcomingNotice = el('p', { class: 'upcoming-notice' });
  const previewDate = el('input', {
    type: 'text',
    class: 'text-box',
    'aria-label': 'Preview date',
    placeholder: 'YYYY-MM-DD',
    'data-focus-id': 'preview-date',
  });
  const slotCount = el('span', { class: 'figure slot-count' });
  const slotsList = el('ul', { class: 'slots-list', 'aria-label': 'Slots on preview date' });
  const timezoneLine = el('p', { class: 'timezone-line' });
  const weekdayRows = el('div', { class: 'weekday-rows' });

  type WeekdayControls = {
    open: HTMLInputElement;
    opens: HTMLInputElement;
    closes: HTMLInputElement;
    opensError: HTMLElement;
    closesError: HTMLElement;
  };
  const weekdayControls: WeekdayControls[] = [];

  for (let weekday = 1; weekday <= 7; weekday += 1) {
    const name = weekdayName(weekday);
    const open = el('input', {
      type: 'checkbox',
      class: 'check-box',
      'aria-label': `Open on ${name}`,
      'data-focus-id': `open-${name}`,
    });
    const opens = el('input', {
      type: 'text',
      class: 'text-box time-box',
      'aria-label': `${name} opens`,
      'aria-describedby': `opens-error-${weekday}`,
      'data-focus-id': `opens-${name}`,
    });
    const closes = el('input', {
      type: 'text',
      class: 'text-box time-box',
      'aria-label': `${name} closes`,
      'aria-describedby': `closes-error-${weekday}`,
      'data-focus-id': `closes-${name}`,
    });
    const opensError = el('p', { class: 'field-error', id: `opens-error-${weekday}` });
    const closesError = el('p', { class: 'field-error', id: `closes-error-${weekday}` });
    weekdayControls.push({ open, opens, closes, opensError, closesError });
    weekdayRows.appendChild(
      el('div', { class: 'weekday-row' }, [
        el('label', { class: 'check-field' }, [open, el('span', {}, name)]),
        el('span', { class: 'time-cell' }, [opens, opensError]),
        el('span', { class: 'time-cell' }, [closes, closesError]),
      ]),
    );
    for (const field of [open, opens, closes]) on(field, 'input', saveDraft);
    on(open, 'change', saveDraft);
  }

  const hoursGroup = el('div', { class: 'hours-group', role: 'group', 'aria-label': 'Opening hours' }, [
    el('div', { class: 'hours-top' }, [
      el('label', { class: 'field' }, [el('span', {}, 'Effective from'), effectiveFrom]),
      publishHours,
    ]),
    effectiveFromError,
    weekdayRows,
    upcomingNotice,
    el('label', { class: 'field' }, [el('span', {}, 'Preview date'), previewDate]),
    el('p', { class: 'slot-count-line' }, [slotCount, el('span', {}, ' slots')]),
    slotsList,
    timezoneLine,
  ]);

  const sectionBodies = new Map<SectionName, HTMLElement>();
  const sectionButtons = new Map<SectionName, HTMLButtonElement>();

  function sectionBlock(name: SectionName, contents: HTMLElement[]): HTMLElement {
    const body = el('div', { class: 'section-body', 'data-state': 'closed' }, contents);
    const toggle = el(
      'button',
      {
        type: 'button',
        class: 'block-button section-toggle',
        'aria-expanded': 'false',
        'data-focus-id': `section-${name}`,
      },
      name,
    ) as HTMLButtonElement;
    on(toggle, 'click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      setSection(name, !open);
      saveSections();
    });
    sectionBodies.set(name, body);
    sectionButtons.set(name, toggle);
    return el('section', { class: 'office-section', 'data-section': name }, [
      toggle,
      el('h2', { class: 'section-heading' }, name),
      body,
    ]);
  }

  function setSection(name: SectionName, open: boolean, atOnce = false): void {
    const body = sectionBodies.get(name);
    const toggle = sectionButtons.get(name);
    if (!body || !toggle) return;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      if (atOnce) openAtOnce(body);
      else openWithMotion(body);
    } else if (atOnce) {
      body.dataset['state'] = 'closed';
    } else {
      closeWithMotion(body);
    }
  }

  function saveSections(): void {
    const open = SECTION_NAMES.filter(
      (name) => sectionButtons.get(name)?.getAttribute('aria-expanded') === 'true',
    );
    saveTabState(`shop.${storeId}.sections`, open);
  }

  const node = el('section', { class: 'shop-screen' }, [
    el('h1', { class: 'screen-title' }, storeId),
    updates,
    sectionBlock('Orders', [el('div', { class: 'charcoal-panel table-holder' }, ordersTable)]),
    sectionBlock('Active holds', [el('div', { class: 'charcoal-panel table-holder' }, holdsTable)]),
    sectionBlock('Stock', [
      recordTillSale,
      el('div', { class: 'charcoal-panel table-holder' }, stockTable),
    ]),
    sectionBlock('Opening hours', [hoursGroup]),
    sectionBlock('Returns', [
      el('div', { class: 'charcoal-panel table-holder' }, returnsTable),
      labelOutput,
    ]),
  ]);

  const countedUnits = el('input', {
    type: 'number',
    class: 'text-box',
    min: '0',
    max: '99999',
    step: '1',
    'aria-label': 'Counted units',
    'data-focus-id': 'counted-units',
  });
  const saveCount = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'save-count' },
    'Save count',
  );
  const countDialog = el(
    'div',
    {
      class: 'dialog',
      role: 'dialog',
      'aria-label': 'Stock count',
      'aria-modal': 'true',
      'data-state': 'closed',
    },
    [
      el('h2', {}, 'Stock count'),
      el('label', { class: 'field' }, [el('span', {}, 'Counted units'), countedUnits]),
      el('div', { class: 'dialog-actions' }, [saveCount]),
    ],
  );

  const itemSelect = el('select', {
    class: 'text-box',
    'aria-label': 'Item',
    'data-focus-id': 'till-item',
  });
  const units = el('input', {
    type: 'number',
    class: 'text-box',
    min: '1',
    max: '999',
    step: '1',
    value: '1',
    'aria-label': 'Units',
    'data-focus-id': 'till-units',
  });
  const recordSale = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'record-sale' },
    'Record sale',
  );
  const tillDialog = el(
    'div',
    {
      class: 'dialog',
      role: 'dialog',
      'aria-label': 'Till sale',
      'aria-modal': 'true',
      'data-state': 'closed',
    },
    [
      el('h2', {}, 'Till sale'),
      el('label', { class: 'field' }, [el('span', {}, 'Item'), itemSelect]),
      el('label', { class: 'field' }, [el('span', {}, 'Units'), units]),
      el('div', { class: 'dialog-actions' }, [recordSale]),
    ],
  );

  const returnReason = el('input', {
    type: 'text',
    class: 'text-box',
    'aria-label': 'Reason',
    'data-focus-id': 'return-reason',
  });
  const requestReturn = el(
    'button',
    { type: 'button', class: 'block-button', 'data-focus-id': 'request-return' },
    'Request return',
  );
  const returnLinesHolder = el('div', { class: 'return-lines' });
  const returnScroller = el('div', { class: 'dialog-scroller' }, [
    el('h2', {}, 'Return items'),
    returnLinesHolder,
    el('label', { class: 'field' }, [el('span', {}, 'Reason'), returnReason]),
    el('div', { class: 'dialog-actions' }, [requestReturn]),
  ]);
  const returnDialog = el(
    'div',
    {
      class: 'dialog return-dialog',
      role: 'dialog',
      'aria-label': 'Return items',
      'aria-modal': 'true',
      'data-state': 'closed',
    },
    returnScroller,
  );

  node.append(countDialog, tillDialog, returnDialog);

  let dialogTrap: Trap | null = null;
  let dialogOpener: HTMLElement | null = null;

  function openDialog(dialog: HTMLElement, opener: HTMLElement, first: HTMLElement, restored = false): void {
    dialogOpener = opener;
    if (restored) openAtOnce(dialog);
    else openWithMotion(dialog);
    dialogTrap?.release();
    dialogTrap = trapFocus(dialog, () => shutDialog(dialog));
    first.focus();
  }

  function shutDialog(dialog: HTMLElement): void {
    dialogTrap?.release();
    dialogTrap = null;
    closeWithMotion(dialog);
    if (dialog === returnDialog) dropTabState(`shop.${storeId}.return`);
    dialogOpener?.focus();
  }

  function anyDialogOpen(): boolean {
    return [countDialog, tillDialog, returnDialog].some(
      (dialog) => dialog.dataset['state'] === 'open' || dialog.dataset['state'] === 'opening',
    );
  }

  const orderRows = new Map<string, HTMLTableRowElement>();

  function paintOrders(): void {
    const wanted = new Set(orders.map((order) => order.id));
    for (const [id, row] of orderRows) {
      if (!wanted.has(id)) {
        row.remove();
        orderRows.delete(id);
      }
    }
    for (const order of orders) {
      let row = orderRows.get(order.id);
      if (!row) {
        row = el('tr', { 'data-order-id': order.id }, [
          el('td', { class: 'cell-number' }),
          el('td', { class: 'cell-status' }),
          el('td', { class: 'cell-collection' }),
          el('td', { class: 'cell-total' }),
          el('td', { class: 'cell-actions' }),
        ]) as HTMLTableRowElement;
        orderRows.set(order.id, row);
        ordersBody.appendChild(row);
      }
      (row.querySelector('.cell-number') as HTMLElement).textContent = order.number;
      (row.querySelector('.cell-status') as HTMLElement).textContent = order.status;
      (row.querySelector('.cell-collection') as HTMLElement).textContent =
        `${order.slot_local_date} ${order.slot_local_time}`;
      (row.querySelector('.cell-total') as HTMLElement).textContent = amount(order.total_cents);

      const actions = row.querySelector('.cell-actions') as HTMLElement;
      const legal = ORDER_ACTIONS.filter((action) => action.from.includes(order.status));
      if (!sameActions(actions, legal.map((action) => action.to))) {
        clear(actions);
        for (const action of legal) {
          const control = el(
            'button',
            {
              type: 'button',
              class: 'block-button row-action',
              'aria-label': `${action.label} ${order.number}`,
              'data-action': action.to,
              'data-focus-id': `order-${order.number}-${action.to}`,
            },
            action.label,
          );
          on(control, 'click', () => {
            const latest = orders.find((candidate) => candidate.id === order.id) ?? order;
            if (action.to === 'return') {
              openReturnDialog(latest, control, null);
              return;
            }
            void moveOrder(latest, action.to as Order['status']);
          });
          actions.appendChild(control);
        }
      }
    }
    ensureOrder(
      ordersBody,
      orders.map((order) => orderRows.get(order.id)).filter(Boolean) as HTMLElement[],
    );
  }

  function focusNextOrderAction(orderId: string): void {
    const row = orderRows.get(orderId);
    const next = row?.querySelector<HTMLElement>('.cell-actions button');
    if (next) next.focus();
    else ordersTable.focus();
  }

  async function moveOrder(order: Order, to: Order['status']): Promise<void> {
    announce(updates, COPY.saving);
    try {
      const updated = await post<Order>(`/api/orders/${order.id}/transitions`, { to });
      orders = orders.map((candidate) => (candidate.id === order.id ? updated : candidate));
      paintOrders();
      await refreshAll();
      announce(updates, `Order ${updated.number} is now ${updated.status}.`);
      focusNextOrderAction(order.id);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'invalid_transition') {
        await refreshAll();
        announce(updates, `That step is not possible for order ${order.number} now.`);
        focusNextOrderAction(order.id);
        return;
      }
      announce(updates, COPY.somethingWrong);
    }
  }

  const returnRows = new Map<string, HTMLTableRowElement>();

  function paintReturns(): void {
    const wanted = new Set(returns.map((item) => item.id));
    for (const [id, row] of returnRows) {
      if (!wanted.has(id)) {
        row.remove();
        returnRows.delete(id);
      }
    }
    for (const item of returns) {
      let row = returnRows.get(item.id);
      if (!row) {
        row = el('tr', { 'data-return-id': item.id }, [
          el('td', { class: 'cell-number' }),
          el('td', { class: 'cell-status' }),
          el('td', { class: 'cell-refund' }),
          el('td', { class: 'cell-actions' }),
        ]) as HTMLTableRowElement;
        returnRows.set(item.id, row);
        returnsBody.appendChild(row);
      }
      (row.querySelector('.cell-number') as HTMLElement).textContent = item.number;
      (row.querySelector('.cell-status') as HTMLElement).textContent = item.status;
      (row.querySelector('.cell-refund') as HTMLElement).textContent = amount(item.refund_cents);

      const actions = row.querySelector('.cell-actions') as HTMLElement;
      const legal = RETURN_ACTIONS.filter((action) => action.from.includes(item.status));
      if (!sameActions(actions, legal.map((action) => action.to))) {
        clear(actions);
        for (const action of legal) {
          const control = el(
            'button',
            {
              type: 'button',
              class: 'block-button row-action',
              'aria-label': `${action.label} ${item.number}`,
              'data-action': action.to,
              'data-focus-id': `return-${item.number}-${action.to}`,
            },
            action.label,
          );
          if (action.to === 'label') {
            on(control, 'click', () => void printLabel(item, control));
            pauseControl(control, `label-pause-${item.number}`, COPY.labelPaused, isStorageDown());
          } else {
            on(control, 'click', () =>
              void moveReturn(
                returns.find((candidate) => candidate.id === item.id) ?? item,
                action.to as ReturnRecord['status'],
              ),
            );
          }
          actions.appendChild(control);
        }
      }
    }
    ensureOrder(
      returnsBody,
      returns.map((item) => returnRows.get(item.id)).filter(Boolean) as HTMLElement[],
    );
  }

  async function moveReturn(item: ReturnRecord, to: ReturnRecord['status']): Promise<void> {
    announce(updates, COPY.saving);
    try {
      const updated = await post<ReturnRecord>(`/api/returns/${item.id}/transitions`, { to });
      returns = returns.map((candidate) => (candidate.id === item.id ? updated : candidate));
      paintReturns();
      await refreshAll();
      announce(updates, `Return ${updated.number} is now ${updated.status}.`);
      if (to === 'received') {
        const settle = returnRows
          .get(item.id)
          ?.querySelector<HTMLElement>('button[data-action="settled"]');
        if (settle) settle.focus();
        else returnsTable.focus();
      } else {
        returnsTable.focus();
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'invalid_transition') {
        await refreshAll();
        announce(updates, `That step is not possible for return ${item.number} now.`);
        return;
      }
      announce(updates, COPY.somethingWrong);
    }
  }

  async function printLabel(item: ReturnRecord, control: HTMLElement): Promise<void> {
    if (isStorageDown()) {
      announce(updates, COPY.labelPaused);
      return;
    }
    announce(updates, COPY.labelPending);
    try {
      const text = await call<string>('POST', `/api/returns/${item.id}/label`, {
        body: {},
        raw: true,
      });
      labelOutput.textContent = text;
      announce(updates, `Return ${item.number} is now ${item.status}.`);
      control.focus();
    } catch {
      announce(updates, isStorageDown() ? COPY.labelPaused : COPY.somethingWrong);
    }
  }

  let returnOrder: Order | null = null;
  const returnQuantityBoxes = new Map<string, HTMLInputElement>();

  function openReturnDialog(order: Order, opener: HTMLElement, restored: ReturnDraft | null): void {
    returnOrder = order;
    clear(returnLinesHolder);
    returnQuantityBoxes.clear();
    for (const line of order.lines) {
      const box = el('input', {
        type: 'number',
        class: 'text-box',
        min: '0',
        max: String(line.quantity - line.returned_quantity),
        step: '1',
        value: String(restored?.quantities[line.sku] ?? 0),
        'aria-label': `Return quantity ${line.sku}`,
        'aria-describedby': `return-error-${line.sku}`,
        'data-focus-id': `return-quantity-${line.sku}`,
      });
      on(box, 'input', saveReturnDraft);
      returnQuantityBoxes.set(line.sku, box);
      returnLinesHolder.appendChild(
        el('div', { class: 'return-line' }, [
          el('span', {}, `${line.sku} ${line.name}`),
          box,
          el('p', { class: 'field-error', id: `return-error-${line.sku}` }),
        ]),
      );
    }
    returnReason.value = restored?.reason ?? '';
    openDialog(returnDialog, opener, returnQuantityBoxes.values().next().value ?? returnReason, restored !== null);
    if (restored) {
      returnScroller.scrollTop = restored.scroll;
      focusByName(returnDialog, restored.focusId);
    }
    saveReturnDraft();
  }

  function saveReturnDraft(): void {
    if (!returnOrder) return;
    const quantities: Record<string, number> = {};
    for (const [sku, box] of returnQuantityBoxes) quantities[sku] = Number(box.value);
    saveTabState<ReturnDraft>(`shop.${storeId}.return`, {
      orderId: returnOrder.id,
      quantities,
      reason: returnReason.value,
      focusId: focusIdOf(document.activeElement),
      scroll: returnScroller.scrollTop,
    });
  }
  on(returnReason, 'input', saveReturnDraft);
  life.listen(returnScroller, 'scroll', saveReturnDraft);
  life.listen(returnDialog, 'focusin', saveReturnDraft);

  on(requestReturn, 'click', () => {
    const order = returnOrder;
    if (!order) return;
    const lines = [...returnQuantityBoxes.entries()]
      .map(([sku, box]) => ({ sku, quantity: Number(box.value) }))
      .filter((line) => line.quantity > 0);
    if (lines.length === 0 || returnReason.value.trim() === '') return;
    announce(updates, COPY.saving);
    void post<ReturnRecord>(`/api/orders/${order.id}/returns`, {
      lines,
      reason: returnReason.value.trim(),
    })
      .then((created) => {
        announce(updates, `Return ${created.number} requested.`);
        shutDialog(returnDialog);
        void refreshAll();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) {
          for (const [sku, box] of returnQuantityBoxes) {
            const index = lines.findIndex((line) => line.sku === sku);
            const message = index === -1 ? null : error.field(`lines.${index}.quantity`);
            const holder = document.getElementById(`return-error-${sku}`);
            if (holder) holder.textContent = message ? COPY.returnTooMany : '';
            if (message) box.setAttribute('aria-invalid', 'true');
            else box.removeAttribute('aria-invalid');
          }
        }
        announce(updates, COPY.somethingWrong);
      });
  });

  const holdRows = new Map<string, HTMLTableRowElement>();

  function paintHolds(holds: Hold[]): void {
    const wanted = new Set(holds.map((hold) => hold.id));
    for (const [id, row] of holdRows) {
      if (!wanted.has(id)) {
        row.remove();
        holdRows.delete(id);
      }
    }
    for (const hold of holds) {
      let row = holdRows.get(hold.id);
      if (!row) {
        row = el('tr', { 'data-hold-id': hold.id }, [
          el('td', {}, hold.id.slice(0, 8)),
          el('td', { class: 'cell-items' }),
          el('td', { class: 'cell-seconds' }),
        ]) as HTMLTableRowElement;
        holdRows.set(hold.id, row);
        holdsBody.appendChild(row);
      }
      (row.querySelector('.cell-items') as HTMLElement).textContent = hold.lines
        .map((line) => `${line.quantity} × ${line.sku}`)
        .join(', ');
      (row.querySelector('.cell-seconds') as HTMLElement).textContent = String(hold.seconds_left);
    }
    ensureOrder(
      holdsBody,
      holds.map((hold) => holdRows.get(hold.id)).filter(Boolean) as HTMLElement[],
    );
  }

  const stockRows = new Map<string, HTMLTableRowElement>();
  const stockFigures = new Map<string, { onHand: HTMLElement; held: HTMLElement; available: HTMLElement }>();
  let countSku: string | null = null;

  function paintStock(lines: StockLine[]): void {
    const wanted = new Set(lines.map((line) => line.sku));
    for (const [sku, row] of stockRows) {
      if (!wanted.has(sku)) {
        row.remove();
        stockRows.delete(sku);
        stockFigures.delete(sku);
      }
    }
    for (const line of lines) {
      let row = stockRows.get(line.sku);
      if (!row) {
        const onHand = el('span', { class: 'figure' });
        const held = el('span', { class: 'figure' });
        const available = el('span', { class: 'figure' });
        const count = el(
          'button',
          {
            type: 'button',
            class: 'block-button row-action',
            'aria-label': `Count ${line.sku}`,
            'data-focus-id': `count-${line.sku}`,
          },
          'Count',
        );
        on(count, 'click', () => {
          countSku = line.sku;
          countedUnits.value = String(line.on_hand);
          openDialog(countDialog, count, countedUnits);
        });
        stockFigures.set(line.sku, { onHand, held, available });
        row = el('tr', { 'data-sku': line.sku }, [
          el('td', {}, `${line.sku} ${line.name}`),
          el('td', {}, onHand),
          el('td', {}, held),
          el('td', {}, available),
          el('td', {}, count),
        ]) as HTMLTableRowElement;
        stockRows.set(line.sku, row);
        stockBody.appendChild(row);
      }
      const figures = stockFigures.get(line.sku)!;
      setFigure(figures.onHand, 'on-hand', line.on_hand, wholeNumber);
      setFigure(figures.held, 'held', line.held, wholeNumber);
      setFigure(figures.available, 'available', line.available, wholeNumber);
    }

    if (itemSelect.options.length !== lines.length) {
      clear(itemSelect);
      for (const line of lines) {
        itemSelect.appendChild(el('option', { value: line.sku }, `${line.sku} ${line.name}`));
      }
    }
  }

  on(saveCount, 'click', () => {
    const sku = countSku;
    if (!sku) return;
    announce(updates, COPY.saving);
    void post(`/api/stores/${storeId}/stock/${sku}/count`, { on_hand: Number(countedUnits.value) })
      .then(() => {
        announce(updates, COPY.countSaved);
        shutDialog(countDialog);
        void refreshAll();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.code === 'below_held') {
          announce(
            updates,
            `${String(error.payload['held'])} units are held for collection; the count cannot be lower.`,
          );
          return;
        }
        announce(updates, COPY.somethingWrong);
      });
  });

  let tillKey: string | null = null;
  let tillBody: unknown = null;

  function tillRequestBody(): { sku: string; quantity: number } {
    return { sku: itemSelect.value, quantity: Number(units.value) };
  }

  function refreshTillKey(): void {
    const wanted = JSON.stringify(tillRequestBody());
    if (JSON.stringify(tillBody) !== wanted) {
      tillKey = makeRequestKey();
      tillBody = JSON.parse(wanted) as unknown;
    }
  }

  on(recordTillSale, 'click', () => {
    tillKey = makeRequestKey();
    tillBody = tillRequestBody();
    openDialog(tillDialog, recordTillSale, itemSelect);
  });
  on(itemSelect, 'change', refreshTillKey);
  on(units, 'input', refreshTillKey);

  on(recordSale, 'click', () => {
    refreshTillKey();
    announce(updates, COPY.saving);
    void call('POST', `/api/stores/${storeId}/till-sales`, {
      body: tillBody,
      requestKey: tillKey as string,
    })
      .then(() => {
        announce(updates, COPY.tillSaleRecorded);
        shutDialog(tillDialog);
        void refreshAll();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.code === 'stock_conflict') {
          announce(
            updates,
            `Only ${String(error.payload['remaining'])} left at ${store?.name ?? storeId}.`,
          );
          return;
        }
        announce(updates, COPY.somethingWrong);
      });
  });

  function readDays(): DayEntry[] {
    return weekdayControls.map((controls, index) => ({
      weekday: index + 1,
      open: controls.open.checked,
      opens: controls.open.checked ? controls.opens.value : null,
      closes: controls.open.checked ? controls.closes.value : null,
    }));
  }

  function saveDraft(): void {
    draft = {
      effectiveFrom: effectiveFrom.value,
      days: readDays(),
      focusId: focusIdOf(document.activeElement),
      errors: currentHoursErrors(),
    };
    saveTabState<HoursDraft>(`shop.${storeId}.hours`, draft);
  }

  function currentHoursErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (effectiveFromError.textContent) errors['effective_from'] = effectiveFromError.textContent;
    weekdayControls.forEach((controls, index) => {
      if (controls.opensError.textContent) errors[`days.${index}.opens`] = controls.opensError.textContent;
      if (controls.closesError.textContent) errors[`days.${index}.closes`] = controls.closesError.textContent;
    });
    return errors;
  }

  function showHoursErrors(errors: Record<string, string>): void {
    effectiveFromError.textContent = errors['effective_from'] ?? '';
    weekdayControls.forEach((controls, index) => {
      controls.opensError.textContent = errors[`days.${index}.opens`] ?? '';
      controls.closesError.textContent = errors[`days.${index}.closes`] ?? '';
      if (controls.opensError.textContent) controls.opens.setAttribute('aria-invalid', 'true');
      else controls.opens.removeAttribute('aria-invalid');
      if (controls.closesError.textContent) controls.closes.setAttribute('aria-invalid', 'true');
      else controls.closes.removeAttribute('aria-invalid');
    });
  }

  function paintHours(next: Hours, useDraft: boolean): void {
    hours = next;
    if (!useDraft) {
      effectiveFrom.value = next.local_today;
      next.days.forEach((day, index) => {
        const controls = weekdayControls[index];
        if (!controls) return;
        controls.open.checked = day.open;
        controls.opens.value = day.opens ?? '';
        controls.closes.value = day.closes ?? '';
      });
    }
    upcomingNotice.textContent = next.upcoming
      ? `New hours start on ${next.upcoming.effective_from}.`
      : '';
  }

  on(publishHours, 'click', () => {
    announce(updates, COPY.publishing);
    showHoursErrors({});
    void put<Hours>(`/api/stores/${storeId}/hours`, {
      effective_from: effectiveFrom.value,
      days: readDays(),
    })
      .then((next) => {
        dropTabState(`shop.${storeId}.hours`);
        draft = null;
        announce(updates, `Opening hours published from ${effectiveFrom.value}.`);
        paintHours(next, false);
        publishHours.focus();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.code === 'validation_failed') {
          const raw = (error.payload['errors'] ?? {}) as Record<string, string>;
          const shown: Record<string, string> = {};
          for (const path of Object.keys(raw)) {
            if (path === 'effective_from') shown[path] = COPY.effectiveFromRange;
            else if (path.endsWith('.closes')) {
              shown[path] =
                raw[path]?.includes('after') ? COPY.closesAfterOpens : COPY.halfHourTimes;
            } else shown[path] = COPY.halfHourTimes;
          }
          showHoursErrors(shown);
          saveDraft();
          return;
        }
        announce(updates, COPY.somethingWrong);
      });
  });

  const slotItems = new Map<string, HTMLLIElement>();

  async function loadPreview(date: string): Promise<void> {
    announce(updates, COPY.loadingSlots);
    try {
      const plan = await get<DayPlan>(`/api/stores/${storeId}/day-plan?date=${date}`);
      const wanted = new Set(plan.slots.map((slot) => slot.start_local));
      for (const [key, item] of slotItems) {
        if (!wanted.has(key)) {
          item.remove();
          slotItems.delete(key);
        }
      }
      const ordered: HTMLElement[] = [];
      for (const slot of plan.slots) {
        let item = slotItems.get(slot.start_local);
        if (!item) {
          item = el('li', { class: 'slot-item' }) as HTMLLIElement;
          slotItems.set(slot.start_local, item);
          slotsList.appendChild(item);
        }
        item.textContent = `${slot.start_local} (UTC${slot.utc_offset}), ${slot.remaining} left`;
        ordered.push(item);
      }
      ensureOrder(slotsList, ordered);
      setFigure(slotCount, 'slot-count', plan.slots.length, wholeNumber);
      announce(
        timezoneLine,
        `Times are local to ${store?.name ?? storeId} (${plan.timezone}).`,
      );
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'validation_failed') {
        announce(updates, COPY.previewDateError);
        return;
      }
      announce(updates, COPY.somethingWrong);
    }
  }

  on(previewDate, 'input', () => {
    const value = previewDate.value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    void loadPreview(value);
  });

  let refreshToken = 0;

  /** Only the newest read paints, so a slower poll never undoes a just-finished action. */
  async function refreshAll(): Promise<void> {
    const mine = ++refreshToken;
    try {
      const [loadedStore, orderPage, holds, stock, returnList, loadedHours] = await Promise.all([
        get<Store>(`/api/stores/${storeId}`),
        get<OrderPage>(`/api/orders?store_id=${storeId}&limit=100`),
        get<{ holds: Hold[] }>(`/api/stores/${storeId}/holds`),
        get<{ lines: StockLine[] }>(`/api/stores/${storeId}/stock`),
        get<{ returns: ReturnRecord[] }>(`/api/returns?store_id=${storeId}`),
        get<Hours>(`/api/stores/${storeId}/hours`),
      ]);
      const details = await Promise.all(
        orderPage.orders.map((summary) => get<Order>(`/api/orders/${summary.id}`)),
      );
      if (mine !== refreshToken) return;

      store = loadedStore;
      rememberStoreNames(operatorStores.length > 0 ? operatorStores : [loadedStore]);
      (node.querySelector('.screen-title') as HTMLElement).textContent = loadedStore.name;

      orders = details;
      paintOrders();

      paintHolds(holds.holds);

      paintStock(stock.lines);
      returns = returnList.returns;
      paintReturns();
      paintHours(loadedHours, draft !== null);
    } catch {
      /* the next read tries again */
    }
  }

  life.every(LIVE_MILLIS, () => {
    void refreshAll();
  });

  life.listen(document, 'keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    if (!anyDialogOpen()) return;
    for (const dialog of [returnDialog, tillDialog, countDialog]) {
      if (dialog.dataset['state'] === 'open' || dialog.dataset['state'] === 'opening') {
        shutDialog(dialog);
        return;
      }
    }
  });

  return {
    node,
    destroy: () => life.kill(),
    afterMount: () => {
      void get<{ stores: Store[] }>('/api/stores').then((answer) => {
        operatorStores = answer.stores.map((shop) => ({ id: shop.id, name: shop.name }));
        rememberStoreNames(operatorStores);
      });
      const openSections = loadTabState<SectionName[]>(`shop.${storeId}.sections`) ?? ['Orders'];
      for (const name of SECTION_NAMES) setSection(name, openSections.includes(name), true);

      draft = loadTabState<HoursDraft>(`shop.${storeId}.hours`);
      if (draft) {
        effectiveFrom.value = draft.effectiveFrom;
        draft.days.forEach((day, index) => {
          const controls = weekdayControls[index];
          if (!controls) return;
          controls.open.checked = day.open;
          controls.opens.value = day.opens ?? '';
          controls.closes.value = day.closes ?? '';
        });
        showHoursErrors(draft.errors ?? {});
      }

      void refreshAll().then(() => {
        if (draft) focusByName(node, draft.focusId);
        const savedReturn = loadTabState<ReturnDraft>(`shop.${storeId}.return`);
        if (!savedReturn) return;
        const order = orders.find((candidate) => candidate.id === savedReturn.orderId);
        if (order) openReturnDialog(order, returnsTable, savedReturn);
      });
    },
  };
}
