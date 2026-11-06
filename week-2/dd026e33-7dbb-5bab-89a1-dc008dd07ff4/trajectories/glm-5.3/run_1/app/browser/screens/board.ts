/**
 * Board — occupancy, overdue care and unpaid invoices side by side, with the
 * Record bank transfer dialog.
 */
import { api, ApiFailure, KeyHolder, NoAnswer, randomKey } from '../api.ts';
import { announce, h, patchText, reconcile } from '../ui.ts';
import { openDialog } from '../dialog.ts';
import { Reread } from '../reread.ts';
import { registerReread, markInterrupted } from '../app.ts';
import { buildFloorPlan, type BayData } from '../components/floorplan.ts';
import {
  boardUnpaidLine, occupancyLine, outstandingLine, recordingTransferPending,
  transferPaidCopy, transferRecordedCopy, NO_ANSWER_COPY, billingDownTransferCopy, alreadyPaidCopy,
} from '../../shared/copy.ts';
import type { Screen } from './screen.ts';
import { openEstimateDialog } from './jobs.ts';

interface BoardData {
  occupancy: { occupied: number; total: number };
  bays: BayData[];
  overdue: { car: { id: string; name: string }; bay_code: string; startup: { status: string; next_due: string | null } }[];
  unpaid: {
    invoices: InvoiceData[];
    total: string;
    live: boolean;
    last_confirmed_at: string | null;
  };
}

interface InvoiceData {
  id: string;
  number: string;
  car: { name: string };
  owner: { name: string };
  total: string;
  balance: string;
  balance_live: boolean;
  status_confirmed_at: string | null;
}

export function renderBoard(main: HTMLElement): Screen {
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'invoice-updates' });
  const occupancyLineEl = h('p', { class: 'reading', 'data-line': 'occupancy' });
  const planArea = h('div');
  const overdueBody = h('tbody');
  const unpaidBody = h('tbody');
  const unpaidLineEl = h('p', { class: 'unpaid-line', 'data-line': 'unpaid' });

  const fetchBoard = async (): Promise<BoardData | null> => {
    try {
      return (await api.get('/api/board')) as BoardData;
    } catch {
      return null;
    }
  };

  const patch = (data: BoardData): void => {
    patchText(occupancyLineEl, occupancyLine(data.occupancy.occupied, data.occupancy.total));
    const plan = planArea.querySelector('.floorplan');
    if (!plan) {
      const fresh = buildFloorPlan({ bays: data.bays, picker: false, onActivate: () => undefined });
      planArea.replaceChildren(fresh.root);
    }
    reconcile(overdueBody, data.overdue, (row) => row.car.id,
      (row) => h('tr', null, h('td', { text: `${row.car.name}` }), h('td', { text: row.bay_code }), h('td', { text: 'Start-up overdue' })),
      () => undefined);
    reconcile(unpaidBody, data.unpaid.invoices, (invoice) => invoice.id, invoiceRow, patchInvoiceRow);
    patchText(unpaidLineEl, boardUnpaidLine(data.unpaid.total, data.unpaid.live ? null : data.unpaid.last_confirmed_at));
  };

  const invoiceRow = (invoice: InvoiceData): HTMLElement => {
    const recordButton = h('button', {
      text: `Record bank transfer for ${invoice.number}`,
      onclick: (event: Event) => openTransferDialog(event.currentTarget as HTMLElement, invoice),
    });
    return h('tr', null,
      h('td', { text: invoice.number }),
      h('td', { text: invoice.car.name }),
      h('td', { text: invoice.owner.name }),
      h('td', { class: 'num', text: `CHF ${invoice.total}` }),
      h('td', { 'data-cell': 'outstanding', text: outstandingLine(invoice.balance, invoice.balance_live ? null : invoice.status_confirmed_at) }),
      h('td', null, recordButton));
  };

  const patchInvoiceRow = (row: HTMLElement, invoice: InvoiceData): void => {
    patchText(row.querySelector('[data-cell="outstanding"]') as HTMLElement,
      outstandingLine(invoice.balance, invoice.balance_live ? null : invoice.status_confirmed_at));
  };

  const openTransferDialog = (opener: HTMLElement, invoice: InvoiceData): void => {
    const holder = new KeyHolder(randomKey);
    openDialog({
      name: 'Record bank transfer',
      opener,
      fallback: main.querySelector('[aria-label="Unpaid invoices"] h2') as HTMLElement,
      build: (dialog, close) => {
        const summary = h('div');
        const reference = h('input', { type: 'text', 'data-field': 'reference' });
        const amount = h('input', { type: 'text', class: 'mono', 'data-field': 'amount', value: invoice.balance });
        const record = h('button', { class: 'primary', text: 'Record transfer' });
        record.addEventListener('click', async () => {
          summary.replaceChildren();
          announce(region, recordingTransferPending());
          try {
            const response = (await api.postWithKey(`/api/invoices/${invoice.id}/payments`, {
              reference: reference.value,
              amount: amount.value,
            }, holder.current())) as { invoice: InvoiceData };
            holder.discard();
            if (response.invoice.balance === '0.00') {
              announce(region, transferPaidCopy(response.invoice.number));
            } else {
              announce(region, transferRecordedCopy(amount.value, response.invoice.balance));
            }
            close('submit');
            const fresh = await fetchBoard();
            if (fresh) patch(fresh);
          } catch (err) {
            if (err instanceof NoAnswer) {
              announce(region, NO_ANSWER_COPY.recordTransfer);
              return;
            }
            if (err instanceof ApiFailure) {
              const code = err.detail.code;
              if (code === 'session_expired') {
                markInterrupted(holder.peek() ?? '', async () => {
                  announce(region, recordingTransferPending());
                  const response = (await api.postWithKey(`/api/invoices/${invoice.id}/payments`, {
                    reference: reference.value,
                    amount: amount.value,
                  }, holder.current())) as { invoice: InvoiceData };
                  holder.discard();
                  announce(region, response.invoice.balance === '0.00'
                    ? transferPaidCopy(response.invoice.number)
                    : transferRecordedCopy(amount.value, response.invoice.balance));
                  close('submit');
                  const fresh = await fetchBoard();
                  if (fresh) patch(fresh);
                });
                return;
              }
              if (code === 'already_paid') {
                announce(region, alreadyPaidCopy());
                close('submit');
                return;
              }
              if (code === 'billing_unavailable') {
                announce(region, billingDownTransferCopy());
                return;
              }
              if (code === 'idempotency_conflict') {
                announce(region, 'This was already sent with different values. Close this form and check the latest record.');
                return;
              }
              if (err.detail.fields) {
                summary.replaceChildren(h('div', { role: 'alert' },
                  h('p', { class: 'error-summary', text: 'There is a problem' }),
                  h('ul', null, ...Object.entries(err.detail.fields).map(([field, message]) =>
                    h('li', null, h('a', {
                      href: '#',
                      text: message,
                      onclick: (event: Event) => {
                        event.preventDefault();
                        dialog.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
                      },
                    }))))));
                return;
              }
              announce(region, code ?? 'Saving failed.');
            }
          }
        });
        dialog.append(
          h('h2', { text: 'Record bank transfer' }),
          summary,
          h('div', { class: 'field' }, h('label', { text: 'Bank reference' }), reference),
          h('div', { class: 'field' }, h('label', { text: 'Amount (CHF)' }), amount),
          h('div', { class: 'actions' }, record, h('button', { text: 'Close', onclick: () => close('cancel') })),
        );
      },
    });
  };

  const reread = new Reread(async () => {
    const data = await fetchBoard();
    if (data) patch(data);
  }, 10_000);

  const render = async (): Promise<void> => {
    const occupancyPane = h('section', { class: 'panel', 'aria-label': 'Occupancy' },
      h('h2', { text: 'Occupancy' }),
      occupancyLineEl, planArea);
    const overduePane = h('section', { class: 'panel', 'aria-label': 'Overdue care' },
      h('h2', { text: 'Overdue care' }),
      h('table', { class: 'sheet' },
        h('thead', null, h('tr', null, h('th', { text: 'Car' }), h('th', { text: 'Bay' }), h('th', { text: 'Start-up' }))),
        overdueBody));
    const unpaidPane = h('section', { class: 'panel pane-full', 'aria-label': 'Unpaid invoices' },
      h('h2', { text: 'Unpaid invoices', tabindex: '-1' }),
      unpaidLineEl, region,
      h('table', { class: 'sheet' },
        h('thead', null, h('tr', null,
          h('th', { text: 'Invoice' }), h('th', { text: 'Car' }), h('th', { text: 'Owner' }),
          h('th', { class: 'num', text: 'Total' }), h('th', { text: 'Outstanding' }), h('th', { text: '' }))),
        unpaidBody));
    const grid = h('div', { class: 'panes-3' }, occupancyPane, overduePane, unpaidPane);
    main.replaceChildren(h('h1', { text: 'Board' }), grid);
    const applyLayout = (): void => {
      const wide = window.innerWidth >= 768;
      const three = window.innerWidth >= 1200;
      unpaidPane.classList.toggle('pane-full', wide && !three);
    };
    applyLayout();
    window.addEventListener('resize', applyLayout);
    const data = await fetchBoard();
    if (!data) return;
    patch(data);
    registerReread(reread);
    reread.start();
    void openEstimateDialog;
  };

  return {
    render,
    destroy() {
      reread.stop();
    },
  };
}
