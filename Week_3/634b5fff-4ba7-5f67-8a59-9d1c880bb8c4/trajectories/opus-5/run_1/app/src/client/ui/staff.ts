import { errorCopy, plates, staffCopy } from '../../shared/copy.js';
import { formatKroner } from '../../shared/money.js';
import type { BoxState, StaffHit } from '../../shared/types.js';
import { ApiCallFailed, call, upload } from '../api.js';
import { markMotion, markTree, runMotion } from '../motion.js';
import { clear, el, field, wideScreen } from './dom.js';

export interface StaffIdentity {
  username: string;
  roles: ('maker' | 'packer' | 'treasurer')[];
}

export async function readIdentity(): Promise<StaffIdentity | null> {
  try {
    return await call<StaffIdentity>('/api/staff/me');
  } catch {
    return null;
  }
}

/** Whether a new sign-in can be started at all. */
export async function signInAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/auth/login', { redirect: 'manual' });
    return response.status !== 503;
  } catch {
    return false;
  }
}

function status(): HTMLElement {
  const node = el('div', { role: 'status', 'aria-label': 'Staff status', class: 'muted' });
  markMotion(node, 'payment-state');
  return node;
}

function say(node: HTMLElement, text: string): void {
  node.textContent = text;
  runMotion(node, 'payment-state');
}

function report(node: HTMLElement, error: unknown): void {
  if (error instanceof ApiCallFailed) say(node, error.failure.message);
}

interface Column<T> {
  header: string;
  cell: (row: T) => Node | string;
}

/** Ruled table from 768 px, stacked cards below it. */
function listing<T>(label: string, columns: Column<T>[], rows: T[]): HTMLElement {
  if (wideScreen()) {
    const head = el('tr', {}, columns.map((column) => el('th', { scope: 'col', text: column.header })));
    const body = el('tbody', {});
    rows.forEach((row, index) => {
      const line = el('tr', {}, columns.map((column) => el('td', {}, [toNode(column.cell(row))])));
      markMotion(line, 'row');
      markTree(line);
      runMotion(line, 'row', index);
      body.append(line);
    });
    return el('table', { 'aria-label': label }, [el('thead', {}, [head]), body]);
  }
  const cards = el('div', { class: 'cards', 'aria-label': label });
  rows.forEach((row, index) => {
    const pairs = columns.flatMap((column) => [
      el('dt', { text: column.header }),
      el('dd', {}, [toNode(column.cell(row))]),
    ]);
    const card = el('article', {}, [el('dl', {}, pairs)]);
    markMotion(card, 'row');
    markTree(card);
    runMotion(card, 'row', index);
    cards.append(card);
  });
  return cards;
}

function toNode(value: Node | string): Node {
  return typeof value === 'string' ? document.createTextNode(value) : value;
}

export function buildStaffHome(identity: StaffIdentity | null, unreachable: boolean): HTMLElement {
  const sheet = el('div', { class: 'sheet' }, [el('h1', { text: 'The press' })]);
  if (unreachable) {
    sheet.append(el('div', { class: 'alert', role: 'alert', text: errorCopy.identity_unreachable }));
  }
  if (identity === null) {
    sheet.append(el('p', { class: 'muted', text: 'Sign in through the link at the top of the page.' }));
    return sheet;
  }
  sheet.append(el('p', { text: `Signed in as ${identity.username}` }));
  if (identity.roles.length === 0) {
    sheet.append(el('p', { class: 'muted', text: errorCopy.forbidden }));
    return sheet;
  }
  const sections: [string, string][] = [];
  if (identity.roles.includes('packer')) {
    sections.push(['Packing', '/staff/packing'], ['Dead letters', '/staff/dead-letters']);
  }
  if (identity.roles.includes('treasurer')) {
    sections.push(
      ['Refunds', '/staff/refunds'],
      ['Charity rates', '/staff/rates'],
      ['Statements', '/staff/statements'],
    );
  }
  if (identity.roles.includes('maker')) sections.push(['Plates', '/staff/plates']);
  sheet.append(
    el(
      'ul',
      {},
      sections.map(([name, href]) => el('li', {}, [el('a', { href, text: name })])),
    ),
  );
  return sheet;
}

interface PackerOrder {
  reference: string;
  number: number;
  plate: string;
  recipientName: string | null;
  address: { street: string; postcode: string; city: string };
  boxState: BoxState;
  paymentState: string;
  trackingCode: string | null;
}

export function buildPacking(): HTMLElement {
  const staffStatus = status();
  const searchBox = el('input', { type: 'search', 'aria-label': 'Search boxes', autocomplete: 'off' });
  const hits = el('div', {});
  const table = el('div', {});
  const sheet = el('div', { class: 'sheet wide' }, [
    el('h1', { text: 'Packing' }),
    staffStatus,
    el('label', { class: 'field' }, [el('span', { text: 'Search boxes' }), searchBox]),
    hits,
    table,
  ]);

  async function refresh(): Promise<void> {
    try {
      const reply = await call<{ orders: PackerOrder[] }>('/api/staff/orders');
      clear(table);
      table.append(
        listing<PackerOrder>(
          'Orders',
          [
            { header: 'Box', cell: (row) => String(row.number) },
            { header: 'Plate', cell: (row) => row.plate },
            { header: 'Reference', cell: (row) => row.reference },
            { header: 'Recipient', cell: (row) => row.recipientName ?? '' },
            {
              header: 'Address',
              cell: (row) => `${row.address.street}, ${row.address.postcode} ${row.address.city}`,
            },
            { header: 'Box state', cell: (row) => row.boxState },
            { header: 'Payment', cell: (row) => row.paymentState },
            { header: 'Tracking', cell: (row) => row.trackingCode ?? '' },
            { header: 'Act', cell: (row) => actions(row) },
          ],
          reply.orders,
        ),
      );
    } catch (error) {
      report(staffStatus, error);
    }
  }

  function actions(row: PackerOrder): HTMLElement {
    const group = el('div', {});
    if (row.boxState === 'claimed') {
      const pack = el('button', { type: 'button', class: 'primary', text: 'Pack' });
      pack.addEventListener('click', () => {
        runMotion(pack, 'press');
        say(staffStatus, staffCopy.packingStarted(row.number));
        void call<{ boxState: BoxState; packing: string }>(
          `/api/staff/orders/${row.reference}/pack`,
          { method: 'POST' },
        )
          .then((reply) => {
            say(
              staffStatus,
              reply.boxState === 'shipped'
                ? staffCopy.shipped(row.number)
                : reply.boxState === 'packed'
                  ? staffCopy.packed(row.number)
                  : staffCopy.packingStarted(row.number),
            );
            void refresh();
          })
          .catch((error: unknown) => {
            report(staffStatus, error);
            void refresh();
          });
      });
      group.append(pack);
    }
    if (row.boxState === 'returned') {
      const back = el('button', { type: 'button', text: 'Back on the shelf' });
      back.addEventListener('click', () => {
        runMotion(back, 'press');
        void call(`/api/staff/boxes/${row.number}/back-on-shelf`, { method: 'POST' })
          .then(() => {
            say(staffStatus, staffCopy.backOnShelf(row.number));
            void refresh();
          })
          .catch((error: unknown) => report(staffStatus, error));
      });
      group.append(back);
    }
    return group;
  }

  let timer = 0;
  searchBox.addEventListener('input', () => {
    window.clearTimeout(timer);
    const text = searchBox.value.trim();
    timer = window.setTimeout(() => {
      if (text === '') {
        clear(hits);
        return;
      }
      void call<{ hits: StaffHit[]; degraded: boolean }>(
        `/api/staff/search?q=${encodeURIComponent(text)}`,
      )
        .then((reply) => {
          clear(hits);
          if (reply.degraded) say(staffStatus, staffCopy.searchFallback);
          hits.append(
            listing<StaffHit>(
              'Search hits',
              [
                { header: 'Box', cell: (row) => String(row.number) },
                { header: 'Plate', cell: (row) => row.plate },
                { header: 'State', cell: (row) => row.state },
                { header: 'Recipient', cell: (row) => row.recipientName ?? '' },
                { header: 'Reference', cell: (row) => row.reference ?? '' },
              ],
              reply.hits,
            ),
          );
        })
        .catch((error: unknown) => report(staffStatus, error));
    }, 150);
  });

  void refresh();
  return sheet;
}

interface DeadLetter {
  eventId: string;
  type: string;
  reference: string;
  boxNumber: number;
  failedAt: string;
  lastError: string;
}

export function buildDeadLetters(): HTMLElement {
  const staffStatus = status();
  const table = el('div', {});
  const sheet = el('div', { class: 'sheet wide' }, [
    el('h1', { text: 'Dead letters' }),
    staffStatus,
    table,
  ]);

  async function refresh(): Promise<void> {
    try {
      const response = await fetch('/api/staff/dead-letters', { credentials: 'same-origin' });
      if (!response.ok) {
        const failed = (await response.json()) as { error: { message: string } };
        say(staffStatus, failed.error.message);
        return;
      }
      const reply = (await response.json()) as { events: DeadLetter[] };
      clear(table);
      if (response.headers.get('X-Press-Events-Waiting') === 'yes') {
        say(staffStatus, staffCopy.eventsWaiting);
      } else if (response.headers.get('X-Press-Alerts-Waiting') === 'yes') {
        say(staffStatus, staffCopy.alertsWaiting);
      } else if (reply.events.length === 0) {
        say(staffStatus, staffCopy.noDeadLetters);
      }
      if (reply.events.length === 0) return;
      table.append(
        listing<DeadLetter>(
          'Dead letters',
          [
            { header: 'Event', cell: (row) => row.eventId },
            { header: 'Type', cell: (row) => row.type },
            { header: 'Box', cell: (row) => String(row.boxNumber) },
            { header: 'Reference', cell: (row) => row.reference },
            { header: 'Failed at', cell: (row) => row.failedAt },
            { header: 'Last error', cell: (row) => row.lastError },
            { header: 'Clear', cell: (row) => clearing(row) },
          ],
          reply.events,
        ),
      );
    } catch (error) {
      report(staffStatus, error);
    }
  }

  function clearing(row: DeadLetter): HTMLElement {
    const note = field('Dismissal note');
    const retry = el('button', { type: 'button', text: 'Retry' });
    retry.addEventListener('click', () => {
      runMotion(retry, 'press');
      void call(`/api/staff/dead-letters/${row.eventId}/retry`, { method: 'POST' })
        .then(() => {
          say(staffStatus, staffCopy.deadLetterRetried);
          void refresh();
        })
        .catch((error: unknown) => report(staffStatus, error));
    });
    const dismiss = el('button', { type: 'button', text: 'Dismiss' });
    dismiss.addEventListener('click', () => {
      runMotion(dismiss, 'press');
      void call(`/api/staff/dead-letters/${row.eventId}/dismiss`, {
        method: 'POST',
        body: { note: note.input.value },
      })
        .then(() => {
          say(staffStatus, staffCopy.deadLetterDismissed);
          void refresh();
        })
        .catch((error: unknown) => report(staffStatus, error));
    });
    return el('div', {}, [note.wrapper, retry, dismiss]);
  }

  void refresh();
  return sheet;
}

interface LedgerOrder {
  reference: string;
  number: number;
  paymentState: string;
  boxState: BoxState;
  grossOre: number;
  rateBasisPoints: number;
}

interface LedgerView {
  reference: string;
  rateBasisPoints: number;
  grossOre: number;
  courierOre: number;
  totalOre: number;
  lines: {
    kind: string;
    grossOre: number;
    netOre: number;
    vatOre: number;
    charityOre: number;
    makerOre: number;
    settledAt: string;
  }[];
  totals: { grossOre: number; netOre: number; vatOre: number; charityOre: number; makerOre: number };
  gatewayFeeOre: number;
  makerAfterFeesOre: number;
  refunds: { refundId: string; state: string; amountOre: number }[];
  killbill: { invoiceId: string; items: { description: string; amountOre: number }[] } | null;
}

export function buildRefunds(): HTMLElement {
  const staffStatus = status();
  const orders = el('div', {});
  const ledgerRegion = el('div', { role: 'region', 'aria-label': 'Ledger' });
  const amount = field('Refund amount in DKK');
  const refund = el('button', { type: 'submit', class: 'primary', text: 'Refund' });
  const rest = el('button', { type: 'button', text: 'Refund the rest' });
  const form = el('form', { novalidate: true }, [amount.wrapper, refund, rest]);
  form.hidden = true;
  const sheet = el('div', { class: 'sheet wide' }, [
    el('h1', { text: 'Refunds' }),
    staffStatus,
    orders,
    ledgerRegion,
    form,
  ]);

  let chosen: string | null = null;
  let remainder = 0;

  async function showLedger(reference: string): Promise<void> {
    chosen = reference;
    form.hidden = false;
    const ledger = await call<LedgerView>(`/api/staff/orders/${reference}/ledger`);
    remainder =
      ledger.grossOre - ledger.refunds.reduce((sum, item) => sum + item.amountOre, 0);
    clear(ledgerRegion);
    ledgerRegion.append(
      el('h2', { text: `Ledger for ${ledger.reference}` }),
      el('p', { text: `Rate ${ledger.rateBasisPoints / 100}%` }),
      listing(
        'Ledger lines',
        [
          { header: 'Kind', cell: (row: LedgerView['lines'][number]) => row.kind },
          { header: 'Gross', cell: (row: LedgerView['lines'][number]) => formatKroner(row.grossOre) },
          { header: 'Net', cell: (row: LedgerView['lines'][number]) => formatKroner(row.netOre) },
          { header: 'VAT', cell: (row: LedgerView['lines'][number]) => formatKroner(row.vatOre) },
          { header: 'Charity', cell: (row: LedgerView['lines'][number]) => formatKroner(row.charityOre) },
          { header: 'Maker', cell: (row: LedgerView['lines'][number]) => formatKroner(row.makerOre) },
        ],
        ledger.lines,
      ),
      el('p', { text: `Charity total DKK ${formatKroner(ledger.totals.charityOre)}` }),
      el('p', { text: `Maker total DKK ${formatKroner(ledger.totals.makerOre)}` }),
      el('p', { text: `VAT total DKK ${formatKroner(ledger.totals.vatOre)}` }),
      el('p', { text: `Gateway fee DKK ${formatKroner(ledger.gatewayFeeOre)}` }),
      el('p', { text: `Maker after fees DKK ${formatKroner(ledger.makerAfterFeesOre)}` }),
      el('p', { text: `Remaining on this box DKK ${formatKroner(remainder)}` }),
    );
  }

  async function refresh(): Promise<void> {
    try {
      const reply = await call<{ orders: LedgerOrder[] }>('/api/staff/ledger/orders');
      clear(orders);
      orders.append(
        listing<LedgerOrder>(
          'Ledger orders',
          [
            { header: 'Box', cell: (row) => String(row.number) },
            { header: 'Reference', cell: (row) => row.reference },
            { header: 'Payment', cell: (row) => row.paymentState },
            { header: 'Box state', cell: (row) => row.boxState },
            { header: 'Gross', cell: (row) => formatKroner(row.grossOre) },
            { header: 'Rate', cell: (row) => `${row.rateBasisPoints / 100}%` },
            {
              header: 'Ledger',
              cell: (row) => {
                const open = el('button', { type: 'button', text: `Open ${row.reference}` });
                open.addEventListener('click', () => {
                  runMotion(open, 'press');
                  void showLedger(row.reference).catch((error: unknown) => report(staffStatus, error));
                });
                return open;
              },
            },
          ],
          reply.orders,
        ),
      );
    } catch (error) {
      report(staffStatus, error);
    }
  }

  async function send(amountOre: number): Promise<void> {
    if (chosen === null) return;
    say(staffStatus, staffCopy.refundPending);
    try {
      const reply = await call<{ state: string }>(`/api/staff/orders/${chosen}/refunds`, {
        method: 'POST',
        body: { amountOre },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      say(staffStatus, reply.state === 'settled' ? staffCopy.refundSettled : staffCopy.refundPending);
      await showLedger(chosen);
      await refresh();
    } catch (error) {
      report(staffStatus, error);
      runMotion(form, 'shake');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runMotion(refund, 'press');
    const kroner = Number.parseFloat(amount.input.value.replace(',', '.'));
    if (!Number.isFinite(kroner)) {
      say(staffStatus, errorCopy.refund_invalid);
      return;
    }
    void send(Math.round(kroner * 100));
  });

  rest.addEventListener('click', () => {
    runMotion(rest, 'press');
    void send(remainder);
  });

  void refresh();
  return sheet;
}

export function buildRates(): HTMLElement {
  const staffStatus = status();
  const history = el('div', {});
  const rate = field('New rate in percent');
  const from = field('Effective from');
  const schedule = el('button', { type: 'submit', class: 'primary', text: 'Schedule rate' });
  const form = el('form', { novalidate: true }, [rate.wrapper, from.wrapper, schedule]);
  const sheet = el('div', { class: 'sheet wide' }, [
    el('h1', { text: 'Charity rates' }),
    staffStatus,
    history,
    form,
  ]);

  async function refresh(): Promise<void> {
    try {
      const reply = await call<{ rates: { rateBasisPoints: number; effectiveFrom: string }[] }>(
        '/api/staff/charity-rates',
      );
      clear(history);
      history.append(
        listing(
          'Charity rates',
          [
            {
              header: 'Rate',
              cell: (row: { rateBasisPoints: number }) => `${row.rateBasisPoints / 100}%`,
            },
            { header: 'Effective from', cell: (row: { effectiveFrom: string }) => row.effectiveFrom },
          ],
          reply.rates,
        ),
      );
    } catch (error) {
      report(staffStatus, error);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runMotion(schedule, 'press');
    const percent = Number.parseFloat(rate.input.value.replace(',', '.'));
    if (!Number.isFinite(percent)) {
      say(staffStatus, errorCopy.rate_invalid);
      return;
    }
    void call('/api/staff/charity-rates', {
      method: 'POST',
      body: { rateBasisPoints: Math.round(percent * 100), effectiveFrom: from.input.value.trim() },
    })
      .then(() => {
        say(staffStatus, staffCopy.rateScheduled);
        void refresh();
      })
      .catch((error: unknown) => {
        report(staffStatus, error);
        runMotion(form, 'shake');
      });
  });

  void refresh();
  return sheet;
}

interface StatementRow {
  id: string;
  month: string;
  revision: number;
  charityTotalOre: number;
  makerTotalOre: number;
  vatTotalOre: number;
}

interface DeliveryRow {
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
}

export function buildStatements(): HTMLElement {
  const staffStatus = status();
  const list = el('div', {});
  const month = field('Month');
  const issue = el('button', { type: 'submit', class: 'primary', text: 'Issue statement' });
  const issueForm = el('form', { novalidate: true }, [month.wrapper, issue]);
  const endpoint = field('Charity endpoint URL');
  const save = el('button', { type: 'submit', text: 'Save endpoint' });
  const endpointForm = el('form', { novalidate: true }, [endpoint.wrapper, save]);
  const deliveries = el('div', {});
  const sheet = el('div', { class: 'sheet wide' }, [
    el('h1', { text: 'Statements' }),
    staffStatus,
    issueForm,
    list,
    el('h2', { text: 'The charity endpoint' }),
    endpointForm,
    el('h2', { text: 'Deliveries' }),
    deliveries,
  ]);

  async function refresh(): Promise<void> {
    try {
      const reply = await call<{ statements: StatementRow[] }>('/api/staff/statements');
      clear(list);
      list.append(
        listing<StatementRow>(
          'Statements',
          [
            { header: 'Month', cell: (row) => row.month },
            { header: 'Revision', cell: (row) => String(row.revision) },
            { header: 'Charity', cell: (row) => formatKroner(row.charityTotalOre) },
            { header: 'Maker', cell: (row) => formatKroner(row.makerTotalOre) },
            { header: 'VAT', cell: (row) => formatKroner(row.vatTotalOre) },
            {
              header: 'PDF',
              cell: (row) =>
                el('a', {
                  href: `/api/staff/statements/${row.id}/pdf`,
                  text: `Download statement ${row.month} revision ${row.revision}`,
                }),
            },
          ],
          reply.statements,
        ),
      );
    } catch (error) {
      report(staffStatus, error);
    }
    try {
      const reply = await call<{ deliveries: DeliveryRow[] }>('/api/staff/deliveries');
      clear(deliveries);
      deliveries.append(
        listing<DeliveryRow>(
          'Deliveries',
          [
            { header: 'Event', cell: (row) => row.eventId },
            { header: 'Type', cell: (row) => row.eventType },
            { header: 'Status', cell: (row) => row.status },
            { header: 'Attempts', cell: (row) => String(row.attempts) },
            { header: 'Last code', cell: (row) => (row.lastStatusCode ?? '').toString() },
          ],
          reply.deliveries,
        ),
      );
    } catch (error) {
      report(staffStatus, error);
    }
  }

  issueForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runMotion(issue, 'press');
    void call('/api/staff/statements', { method: 'POST', body: { month: month.input.value.trim() } })
      .then(() => {
        say(staffStatus, staffCopy.statementIssued);
        void refresh();
      })
      .catch((error: unknown) => {
        report(staffStatus, error);
        runMotion(issueForm, 'shake');
      });
  });

  endpointForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runMotion(save, 'press');
    void call('/api/staff/charity-endpoint', {
      method: 'PUT',
      body: { url: endpoint.input.value.trim() },
    })
      .then(() => void refresh())
      .catch((error: unknown) => {
        report(staffStatus, error);
        runMotion(endpointForm, 'shake');
      });
  });

  void refresh();
  return sheet;
}

export function buildPlates(): HTMLElement {
  const staffStatus = status();
  const stock = el('p', {});
  const sheet = el('div', { class: 'sheet wide' }, [
    el('h1', { text: 'Plates' }),
    staffStatus,
    stock,
  ]);

  for (const plate of plates) {
    const input = el('input', { type: 'file', 'aria-label': `Art file for ${plate}`, accept: 'image/png,image/jpeg' });
    const button = el('button', { type: 'button', text: `Upload art for ${plate}` });
    button.addEventListener('click', () => {
      runMotion(button, 'press');
      const file = input.files?.[0];
      if (file === undefined) {
        say(staffStatus, errorCopy.art_wrong_type);
        return;
      }
      void upload(`/api/staff/plates/${plate.toLowerCase()}/art`, file)
        .then(() => say(staffStatus, staffCopy.artSaved))
        .catch((error: unknown) => report(staffStatus, error));
    });
    sheet.append(
      el('section', {}, [
        el('h2', { text: plate }),
        el('label', { class: 'field' }, [el('span', { text: `Art file for ${plate}` }), input]),
        button,
      ]),
    );
  }

  void call<{ remaining: number; thresholds: number[] }>('/api/staff/stock')
    .then((reply) => {
      stock.textContent = `${reply.remaining} boxes remain. Alerts at ${reply.thresholds.join(', ')}.`;
    })
    .catch((error: unknown) => report(staffStatus, error));

  return sheet;
}
