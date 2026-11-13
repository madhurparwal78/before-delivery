import { api, formatPrice, displayDate } from '../api.ts';
import { notice, openDialog, closeDialog, errorSummary, clearErrorSummary, isApiFailure } from '../shell.ts';
import { parseAmountMinor } from './support.ts';

/** Box office: sessions, the ledger, overdue supporters, prices and reconciliation. */

interface ManagerOrder {
  id: string;
  receipt_number: string;
  kind: string;
  user_email: string;
  description: string;
  currency: string;
  amount_minor: number;
  refunded_minor: number;
  status: string;
  receipt_url: string;
  refunds: Array<{ id: string; amount_minor: number; reason: string; at: string }>;
  notes: Array<{ id: string; text: string; author_email: string; at: string }>;
}

export async function initBoxOfficePage(): Promise<void> {
  await renderSessions();
  await renderLedger();
  await renderOverdue();
  await renderAudit();
  await renderReconciliation();
  wireNewSessionForm();
  wirePriceChangeForm();
}

async function renderSessions(): Promise<void> {
  const body = document.querySelector<HTMLElement>('[data-role="manager-sessions"]');
  if (!body) return;
  const res = await api.get<{ sessions: Array<{ id: string; title: string; starts_at_display: string; status: string; seats_left: number; capacity: number }> }>(
    '/api/sessions',
  );
  body.textContent = '';
  for (const session of res.sessions) {
    const row = document.createElement('div');
    row.className = 'row spread';
    const info = document.createElement('div');
    info.textContent = `${session.title} — ${session.starts_at_display} — ${session.status} — ${session.seats_left}/${session.capacity} seats`;
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel session';
    cancel.addEventListener('click', () => {
      const dialog = document.querySelector<HTMLDialogElement>('#dialog-cancel-session');
      if (dialog) {
        (dialog as HTMLDialogElement & { _session?: typeof session })._session = session;
        const input = dialog.querySelector<HTMLInputElement>('[data-role="cancel-reason"]');
        if (input) input.value = '';
        clearErrorSummary(dialog);
        openDialog('dialog-cancel-session', cancel);
      }
    });
    row.append(info, cancel);
    body.appendChild(row);
  }
  wireCancelSessionDialog();
}

function wireCancelSessionDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-cancel-session');
  if (!dialog || dialog.dataset['wired'] === '1') return;
  dialog.dataset['wired'] = '1';
  const button = dialog.querySelector<HTMLButtonElement>('[data-role="confirm-cancel-session"]');
  button?.addEventListener('click', async () => {
    const session = (dialog as HTMLDialogElement & { _session?: { id: string } })._session;
    if (!session) return;
    const reason = dialog.querySelector<HTMLInputElement>('[data-role="cancel-reason"]')?.value ?? '';
    try {
      const res = await api.post<{ refunds: number }>(`/api/manager/sessions/${session.id}/cancel`, { reason });
      notice(`Session cancelled. ${res.refunds} bookings refunded.`);
      closeDialog('dialog-cancel-session');
      await renderSessions();
      await renderLedger();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.fields) errorSummary(dialog, e.message, e.fields);
        else errorSummary(dialog, e.message);
      }
    }
  });
}

async function renderLedger(): Promise<void> {
  const body = document.querySelector<HTMLElement>('[data-role="ledger-body"]');
  if (!body) return;
  const res = await api.get<{ orders: ManagerOrder[] }>('/api/manager/orders');
  body.textContent = '';
  for (const order of res.orders) {
    const tr = document.createElement('tr');
    const receiptCell = document.createElement('td');
    receiptCell.textContent = order.receipt_number;
    const kindCell = document.createElement('td');
    kindCell.textContent = order.kind;
    const emailCell = document.createElement('td');
    emailCell.textContent = order.user_email;
    const amountCell = document.createElement('td');
    amountCell.className = 'num';
    amountCell.textContent = formatPrice(order.amount_minor, order.currency);
    const refundedCell = document.createElement('td');
    refundedCell.className = 'num';
    refundedCell.textContent = formatPrice(order.refunded_minor, order.currency);
    const statusCell = document.createElement('td');
    statusCell.textContent = order.status;
    const actionsCell = document.createElement('td');
    const refundButton = document.createElement('button');
    refundButton.textContent = 'Refund';
    refundButton.addEventListener('click', () => {
      const dialog = document.querySelector<HTMLDialogElement>('#dialog-refund');
      if (dialog) {
        (dialog as HTMLDialogElement & { _order?: ManagerOrder })._order = order;
        const amount = dialog.querySelector<HTMLInputElement>('[data-role="refund-amount"]');
        if (amount) amount.value = '';
        const reason = dialog.querySelector<HTMLInputElement>('[data-role="refund-reason"]');
        if (reason) reason.value = '';
        clearErrorSummary(dialog);
        openDialog('dialog-refund', refundButton);
      }
    });
    const noteButton = document.createElement('button');
    noteButton.textContent = 'Add note';
    noteButton.addEventListener('click', () => {
      const dialog = document.querySelector<HTMLDialogElement>('#dialog-note');
      if (dialog) {
        (dialog as HTMLDialogElement & { _order?: ManagerOrder })._order = order;
        const input = dialog.querySelector<HTMLInputElement>('[data-role="note-text"]');
        if (input) input.value = '';
        clearErrorSummary(dialog);
        openDialog('dialog-note', noteButton);
      }
    });
    actionsCell.append(refundButton, noteButton);
    tr.append(receiptCell, kindCell, emailCell, amountCell, refundedCell, statusCell, actionsCell);
    body.appendChild(tr);
  }
  wireRefundDialog();
  wireNoteDialog();
}

function wireRefundDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-refund');
  if (!dialog || dialog.dataset['wired'] === '1') return;
  dialog.dataset['wired'] = '1';
  const button = dialog.querySelector<HTMLButtonElement>('[data-role="confirm-refund"]');
  button?.addEventListener('click', async () => {
    const order = (dialog as HTMLDialogElement & { _order?: ManagerOrder })._order;
    if (!order) return;
    const amountText = dialog.querySelector<HTMLInputElement>('[data-role="refund-amount"]')?.value ?? '';
    const reason = dialog.querySelector<HTMLInputElement>('[data-role="refund-reason"]')?.value ?? '';
    const minor = parseAmountMinor(amountText, order.currency);
    if (minor === null) {
      errorSummary(dialog, 'Enter an amount such as 25.00, or a whole number for yen.', { amount: 'Enter an amount such as 25.00, or a whole number for yen.' });
      return;
    }
    try {
      const res = await api.post<{ refund: { amount_minor: number } }>(`/api/manager/orders/${order.id}/refunds`, {
        amount_minor: minor,
        reason,
      });
      notice(`Refund of ${formatPrice(res.refund.amount_minor, order.currency)} issued.`);
      closeDialog('dialog-refund');
      await renderLedger();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.fields) errorSummary(dialog, e.message, e.fields);
        else errorSummary(dialog, e.message);
      }
    }
  });
}

function wireNoteDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog-note');
  if (!dialog || dialog.dataset['wired'] === '1') return;
  dialog.dataset['wired'] = '1';
  const button = dialog.querySelector<HTMLButtonElement>('[data-role="confirm-note"]');
  button?.addEventListener('click', async () => {
    const order = (dialog as HTMLDialogElement & { _order?: ManagerOrder })._order;
    if (!order) return;
    const text = dialog.querySelector<HTMLInputElement>('[data-role="note-text"]')?.value ?? '';
    try {
      await api.post(`/api/manager/orders/${order.id}/notes`, { text });
      notice('Note added.');
      closeDialog('dialog-note');
      await renderLedger();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.fields) errorSummary(dialog, e.message, e.fields);
        else errorSummary(dialog, e.message);
      }
    }
  });
}

async function renderOverdue(): Promise<void> {
  const body = document.querySelector<HTMLElement>('[data-role="overdue-body"]');
  if (!body) return;
  const res = await api.get<{ overdue: Array<{ user_email: string; name: string; tier: string; currency: string; amount_due_minor: number; failed_at: string; attempts: number; next_retry_at: string | null }> }>(
    '/api/manager/dunning',
  );
  body.textContent = '';
  for (const row of res.overdue) {
    const tr = document.createElement('tr');
    const emailCell = document.createElement('td');
    emailCell.textContent = row.user_email;
    const nameCell = document.createElement('td');
    nameCell.textContent = row.name;
    const tierCell = document.createElement('td');
    tierCell.textContent = row.tier;
    const amountCell = document.createElement('td');
    amountCell.className = 'num';
    amountCell.textContent = formatPrice(row.amount_due_minor, row.currency);
    const attemptsCell = document.createElement('td');
    attemptsCell.className = 'num';
    attemptsCell.textContent = String(row.attempts);
    const nextCell = document.createElement('td');
    nextCell.textContent = row.next_retry_at ?? '';
    tr.append(emailCell, nameCell, tierCell, amountCell, attemptsCell, nextCell);
    body.appendChild(tr);
  }
}

async function renderAudit(): Promise<void> {
  const body = document.querySelector<HTMLElement>('[data-role="audit-body"]');
  if (!body) return;
  const res = await api.get<{ actions: Array<{ id: string; at: string; actor_email: string; action: string; target_type: string; target_id: string; detail: unknown }> }>(
    '/api/manager/audit',
  );
  body.textContent = '';
  for (const action of res.actions) {
    const tr = document.createElement('tr');
    const timeCell = document.createElement('td');
    timeCell.className = 'num';
    timeCell.textContent = action.at;
    const actorCell = document.createElement('td');
    actorCell.textContent = action.actor_email;
    const actionCell = document.createElement('td');
    actionCell.textContent = action.action;
    const targetCell = document.createElement('td');
    targetCell.textContent = `${action.target_type} ${action.target_id}`;
    const detailCell = document.createElement('td');
    detailCell.textContent = action.detail ? JSON.stringify(action.detail) : '';
    tr.append(timeCell, actorCell, actionCell, targetCell, detailCell);
    body.appendChild(tr);
  }
}

async function renderReconciliation(): Promise<void> {
  const monthSelect = document.querySelector<HTMLSelectElement>('[data-role="reconciliation-month"]');
  const body = document.querySelector<HTMLElement>('[data-role="reconciliation-body"]');
  if (!body || !monthSelect) return;
  const load = async (): Promise<void> => {
    const month = monthSelect.value;
    try {
      const res = await api.get<{ currencies: Array<{ currency: string; ledger_net_minor: number; killbill_net_minor: number; difference_minor: number; matched: boolean }> }>(
        `/api/manager/reconciliation?month=${encodeURIComponent(month)}`,
      );
      body.textContent = '';
      for (const row of res.currencies) {
        const tr = document.createElement('tr');
        const currencyCell = document.createElement('td');
        currencyCell.textContent = row.currency;
        const ledgerCell = document.createElement('td');
        ledgerCell.className = 'num';
        ledgerCell.textContent = formatPrice(row.ledger_net_minor, row.currency);
        const kbCell = document.createElement('td');
        kbCell.className = 'num';
        kbCell.textContent = formatPrice(row.killbill_net_minor, row.currency);
        const statusCell = document.createElement('td');
        statusCell.textContent = row.matched ? 'Matched' : `Difference ${formatPrice(row.difference_minor, row.currency)}`;
        tr.append(currencyCell, ledgerCell, kbCell, statusCell);
        body.appendChild(tr);
      }
    } catch {
      body.textContent = '';
    }
  };
  monthSelect.addEventListener('change', () => void load());
  await load();
}

function wireNewSessionForm(): void {
  const form = document.querySelector<HTMLFormElement>('[data-role="new-session-form"]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = form.querySelector<HTMLInputElement>('[data-role="session-title"]')?.value ?? '';
    const startsAt = form.querySelector<HTMLInputElement>('[data-role="session-start"]')?.value ?? '';
    const duration = Number(form.querySelector<HTMLInputElement>('[data-role="session-duration"]')?.value ?? 0);
    const capacity = Number(form.querySelector<HTMLInputElement>('[data-role="session-capacity"]')?.value ?? 0);
    const { toOffsetIso } = await import('../lisbon.ts');
    const iso = toOffsetIso(startsAt);
    if (iso === null) {
      errorSummary(form as unknown as HTMLElement, 'Choose a time after now.', { starts_at: 'Choose a time after now.' });
      return;
    }
    try {
      await api.post('/api/manager/sessions', { title, starts_at: iso, duration_minutes: duration, capacity });
      notice('Session created.');
      form.reset();
      await renderSessions();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.fields) errorSummary(form as unknown as HTMLElement, e.message, e.fields);
        else errorSummary(form as unknown as HTMLElement, e.message);
      }
    }
  });
}

function wirePriceChangeForm(): void {
  const form = document.querySelector<HTMLFormElement>('[data-role="price-change-form"]');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tier = form.querySelector<HTMLSelectElement>('[data-role="price-tier"]')?.value ?? 'reader';
    const currency = form.querySelector<HTMLSelectElement>('[data-role="price-currency"]')?.value ?? 'EUR';
    const amountText = form.querySelector<HTMLInputElement>('[data-role="price-amount"]')?.value ?? '';
    const effectiveFrom = form.querySelector<HTMLInputElement>('[data-role="price-effective"]')?.value ?? '';
    const minor = parseAmountMinor(amountText, currency);
    if (minor === null) {
      errorSummary(form as unknown as HTMLElement, 'Enter an amount such as 25.00, or a whole number for yen.', { amount_minor: 'Enter an amount such as 25.00, or a whole number for yen.' });
      return;
    }
    try {
      const res = await api.post<{ change: { effective_on: string } }>('/api/manager/plan-prices', {
        tier,
        currency,
        amount_minor: minor,
        effective_on: effectiveFrom,
      });
      notice(`New price scheduled from ${displayDate(res.change.effective_on)}.`);
      form.reset();
    } catch (e) {
      if (isApiFailure(e)) {
        if (e.fields) errorSummary(form as unknown as HTMLElement, e.message, e.fields);
        else errorSummary(form as unknown as HTMLElement, e.message);
      }
    }
  });
}
