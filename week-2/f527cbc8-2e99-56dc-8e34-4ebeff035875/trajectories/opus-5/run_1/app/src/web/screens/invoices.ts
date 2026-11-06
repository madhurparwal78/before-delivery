import {
  api,
  ApiError,
  newIdempotencyKey,
  type Invoice,
  type Reconciliation,
} from '../api.js';
import { clear, el, money, playSequence, staggerIn, withSkeleton } from '../dom.js';
import { announceWithToast, failureCopy, pending } from '../notices.js';
import { CARD_OPTIONS, copy } from '../copy.js';
import type { ScreenContext } from '../shell.js';

/** `/invoices` — date, horse, kind, total, balance, status and dunning. */
const STATUS_TEXT: Record<Invoice['status'], string> = {
  pending: 'Pending',
  unpaid: 'Unpaid',
  paid: 'Paid',
};

const DUNNING_TEXT: Record<Invoice['dunning_state'], string> = {
  none: '',
  past_due: 'Past due',
  retry_1: 'Retry 1',
  retry_2: 'Retry 2',
  blocked: 'Blocked',
  cleared: 'Cleared',
};

const RECONCILIATION_TEXT: Record<Reconciliation['status'], string> = {
  matched: 'Matched',
  mismatch: 'Mismatch',
  unavailable: 'Unavailable',
};

export async function renderInvoices(ctx: ScreenContext): Promise<void> {
  const isOwner = ctx.me.role === 'owner';
  const cardPicker = el('select', { 'aria-label': 'Card' }) as HTMLSelectElement;
  for (const option of CARD_OPTIONS) {
    cardPicker.append(el('option', { value: option.token, text: option.label }));
  }
  const table = el('table', { class: 'stacked', 'aria-label': 'Invoices' });

  clear(ctx.main);
  if (isOwner) {
    ctx.main.append(
      el('div', { class: 'inline' }, [el('div', { class: 'field' }, [el('label', { text: 'Card' }), cardPicker])]),
    );
  }
  ctx.main.append(table);

  let invoices: Invoice[] = [];
  const announced = new Set<string>();
  const pendingBefore = new Set<string>();

  const pay = async (invoice: Invoice, button: HTMLButtonElement): Promise<void> => {
    const handle = pending(button, copy.recordingPayment);
    try {
      const paid = await api.post<Invoice>(`/api/invoices/${invoice.id}/payments`, {
        body: { card_token: cardPicker.value },
        idempotencyKey: newIdempotencyKey(),
      });
      handle.done();
      announceWithToast(copy.paymentRecorded(money(invoice.balance_cents).slice(1)));
      await refresh();
      const row = table.querySelector<HTMLElement>(`tr[data-invoice="${invoice.id}"]`);
      if (row !== null) {
        playSequence(row, 'payment-captured', 440);
        if (paid.dunning_state === 'cleared') playSequence(row, 'dunning-cleared', 480);
      }
      table.querySelector<HTMLElement>(`[data-pay="${invoice.id}"]`)?.focus();
    } catch (error) {
      const failure = error instanceof ApiError ? error.failure : null;
      let message = failureCopy(error, copy.networkFailure);
      if (failure !== null && !failure.network) {
        switch (failure.code) {
          case 'already_paid':
            message = copy.alreadyPaid;
            break;
          case 'invoice_pending':
            message = copy.invoicePending;
            break;
          case 'billing_unavailable':
            message = copy.billingUnavailable;
            break;
          case 'card_declined':
            message =
              invoice.dunning_state === 'blocked'
                ? copy.declineWhileBlocked
                : failure.extra.decline_code === 'do_not_honor'
                  ? copy.hardDecline(invoice.horse.name, invoice.business_date)
                  : copy.softDecline(invoice.horse.name, invoice.business_date, invoice.business_date);
            break;
          default:
            break;
        }
      }
      // The row keeps its status and balance and the button re-enables.
      handle.failed(message);
      await refresh();
      table.querySelector<HTMLElement>(`[data-pay="${invoice.id}"]`)?.focus();
    }
  };

  let firstLoad = true;
  const refresh = async (): Promise<void> => {
    invoices = firstLoad
      ? await withSkeleton(ctx.main, 5, () => api.get<Invoice[]>('/api/invoices'))
      : await api.get<Invoice[]>('/api/invoices');
    firstLoad = false;
    clear(table);
    const columns = ['Date', 'Horse', 'Kind', 'Total', 'Balance', 'Status', 'Dunning'];
    if (ctx.me.role === 'farrier') columns.push('Reconciliation');
    if (isOwner) columns.push('Pay');
    table.append(
      el('caption', { text: 'Invoices' }),
      el('thead', {}, [el('tr', {}, columns.map((label) => el('th', { scope: 'col', text: label })))]),
    );
    const body = el('tbody');
    for (const invoice of invoices) {
      const cells = [
        el('td', { 'data-label': 'Date', class: 'num', text: invoice.business_date }),
        el('td', { 'data-label': 'Horse', text: invoice.horse.name }),
        el('td', { 'data-label': 'Kind', text: invoice.kind }),
        el('td', { 'data-label': 'Total', class: 'amount', text: money(invoice.total_cents) }),
        el('td', { 'data-label': 'Balance', class: 'amount', text: money(invoice.balance_cents) }),
        el('td', { 'data-label': 'Status' }, [
          el('span', {
            class: invoice.status === 'pending' ? 'chip pending' : 'chip',
            text: STATUS_TEXT[invoice.status],
          }),
        ]),
        el('td', { 'data-label': 'Dunning', text: DUNNING_TEXT[invoice.dunning_state] }),
      ];
      if (ctx.me.role === 'farrier') {
        cells.push(el('td', { 'data-label': 'Reconciliation', text: '' }));
      }
      if (isOwner) {
        const cell = el('td', { 'data-label': 'Pay' });
        if (invoice.status === 'unpaid') {
          const button = el('button', {
            type: 'button',
            class: 'primary',
            text: `Pay ${invoice.horse.name} ${invoice.business_date}`,
            'data-pay': invoice.id,
          }) as HTMLButtonElement;
          button.addEventListener('click', () => void pay(invoice, button));
          cell.append(button);
        }
        cells.push(cell);
      }
      body.append(el('tr', { 'data-invoice': invoice.id }, cells));
    }
    table.append(body);
    staggerIn([...body.children].filter((node): node is HTMLElement => node instanceof HTMLElement));

    for (const invoice of invoices) {
      const wasPending = pendingBefore.has(invoice.id);
      if (invoice.status === 'pending') pendingBefore.add(invoice.id);
      else pendingBefore.delete(invoice.id);
      if (wasPending && invoice.status !== 'pending' && !announced.has(invoice.id)) {
        announced.add(invoice.id);
        const amount = money(invoice.total_cents).slice(1);
        announceWithToast(
          invoice.kind === 'visit'
            ? copy.invoiceReached(invoice.horse.name, amount)
            : copy.tripInvoiceReached(invoice.horse.name, amount),
        );
        const row = table.querySelector<HTMLElement>(`tr[data-invoice="${invoice.id}"]`);
        if (row !== null) playSequence(row, 'invoice-reconciled', 440);
      }
    }

    // Opening or refreshing the farrier's Invoices page runs the read-back for each row.
    if (ctx.me.role === 'farrier') {
      for (const invoice of invoices) {
        void (async (): Promise<void> => {
          try {
            const result = await api.get<Reconciliation>(`/api/invoices/${invoice.id}/reconciliation`);
            const cell = table.querySelector(
              `tr[data-invoice="${invoice.id}"] td[data-label="Reconciliation"]`,
            );
            if (cell instanceof HTMLElement) cell.textContent = RECONCILIATION_TEXT[result.status];
          } catch {
            // A read-back that cannot be made leaves the cell as it stands.
          }
        })();
      }
    }
  };

  await refresh();
  ctx.onRefresh(refresh, 30000);
  ctx.onRefresh(async () => {
    if (invoices.some((invoice) => invoice.status === 'pending')) await refresh();
  }, 10000);
}
