import { getJson, newIdempotencyKey, requestJson } from '../shared/api.ts';
import { clear, el } from '../shared/dom.ts';
import { formatMoney, formatShare, type Milestone } from '../../shared/money.ts';

const LIVE_POLL_MS = 2_000;
const RETRY_DELAY_MS = 3_000;
const MAX_AUTOMATIC_RETRIES = 5;

type Deposit = {
  invoice_number: string;
  killbill_invoice_id: string;
  amount_cents: number;
  balance_cents: number;
  paid: boolean;
  invoice_date: string;
  billing: 'live' | 'unreachable';
};

type ProposalPayload = {
  reference: string;
  project_title: string;
  scope: string;
  fee_cents: number;
  currency: string;
  production_month: string;
  production_month_label: string;
  month_open: boolean;
  milestones: Milestone[];
  status: 'proposal_sent' | 'accepted' | 'deposit_paid' | 'booked';
  expires_at: string;
  deposit: Deposit | null;
};

const token = /^\/p\/([^/]+)$/.exec(window.location.pathname)?.[1] ?? '';
const app = document.getElementById('app') as HTMLElement;

const heading = el('h1', { class: 'proposal-heading', tabindex: -1 });
const summary = el('div', { class: 'proposal-summary' });
const milestoneTable = el('table', { class: 'milestones-table', 'aria-label': 'Milestones' });
const acceptArea = el('div', { class: 'accept-area' });
const depositArea = el('div', { class: 'deposit-area' });
const status = el('p', { class: 'status-line', role: 'status', 'aria-label': 'Proposal status' });

app.append(
  el('div', { class: 'proposal-column' }, [heading, summary, milestoneTable, acceptArea, depositArea, status]),
);

let payKey: string | null = null;
let payKeyName = '';
let acceptPending = false;
let payPending = false;
let polling: number | null = null;
let current: ProposalPayload | null = null;

function copyMonthTaken(label: string): string {
  return `${label} has just been booked by another production. Ask Kettlehole Audio for another month.`;
}

function renderMilestones(milestones: readonly Milestone[]): void {
  clear(milestoneTable);
  milestoneTable.append(
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Milestone' }),
        el('th', { scope: 'col', text: 'Share' }),
        el('th', { scope: 'col', text: 'Amount' }),
      ]),
    ]),
    el(
      'tbody',
      {},
      milestones.map((milestone) =>
        el('tr', {}, [
          el('th', { scope: 'row', text: milestone.name }),
          el('td', { class: 'mono', text: formatShare(milestone.percent) }),
          el('td', { class: 'mono', text: formatMoney(milestone.amount_cents) }),
        ]),
      ),
    ),
  );
}

function renderDeposit(deposit: Deposit, paid: boolean): void {
  clear(depositArea);
  const region = el('div', { class: 'deposit-invoice', role: 'region', 'aria-label': 'Deposit invoice' }, [
    el('p', { class: 'mono', text: `Invoice ${deposit.invoice_number}` }),
    el('p', { class: 'mono deposit-amount', text: `Deposit ${formatMoney(deposit.amount_cents)}` }),
  ]);
  depositArea.append(region);
  if (paid) return;

  const payerId = 'payer-name';
  const payer = el('input', { id: payerId, type: 'text', class: 'payer-name', 'aria-label': 'Name on payment' });
  const pay = el('button', { type: 'button', class: 'primary', text: 'Pay deposit' });
  payer.addEventListener('input', () => {
    if (payer.value !== payKeyName) payKey = null;
  });
  payKey ??= newIdempotencyKey();

  const attempt = async (key: string, attemptsLeft: number): Promise<void> => {
    const result = await requestJson<{ status: string }>('POST', `/api/proposals/${token}/deposit`, {
      body: { payer_name: payer.value, amount_cents: deposit.amount_cents },
      headers: { 'Idempotency-Key': key },
    });
    if (result.ok) {
      payPending = false;
      status.textContent = `Deposit received. ${current?.production_month_label ?? ''} is confirmed. A confirmation email will follow.`;
      payer.remove();
      pay.remove();
      return;
    }
    if (result.status === 0 || result.code === 'request_in_progress') {
      if (attemptsLeft > 0) {
        status.textContent = 'Connection lost. Retrying with the same payment\u2026';
        window.setTimeout(() => void attempt(key, attemptsLeft - 1), RETRY_DELAY_MS);
        return;
      }
      payPending = false;
      pay.disabled = false;
      status.textContent =
        "We couldn't confirm the payment. Press Pay deposit to check again. You won't be charged twice.";
      return;
    }
    payPending = false;
    pay.disabled = false;
    if (result.status === 503) {
      status.textContent = 'Billing is unreachable, so no payment was taken. Try again in a few minutes.';
      return;
    }
    if (result.code === 'illegal_transition') {
      await load();
      return;
    }
    status.textContent = 'The payment request was refused. Reload the page to see the current deposit.';
  };

  pay.addEventListener('click', () => {
    if (payPending) return;
    payPending = true;
    pay.disabled = true;
    payKey ??= newIdempotencyKey();
    payKeyName = payer.value;
    status.textContent = 'Recording payment\u2026';
    void attempt(payKey, MAX_AUTOMATIC_RETRIES);
  });

  depositArea.append(el('div', { class: 'pay-row' }, [el('label', { for: payerId, text: 'Name on payment' }), payer, pay]));
}

function renderAccept(payload: ProposalPayload): void {
  clear(acceptArea);
  if (payload.status !== 'proposal_sent' || !payload.month_open) return;
  const button = el('button', {
    type: 'button',
    class: 'primary',
    text: `Accept and hold ${payload.production_month_label}`,
  });
  button.addEventListener('click', () => {
    if (acceptPending) return;
    acceptPending = true;
    button.disabled = true;
    status.textContent = `Holding ${payload.production_month_label}\u2026`;
    void (async () => {
      const result = await requestJson<{ deposit: Deposit }>('POST', `/api/proposals/${token}/accept`, { body: {} });
      acceptPending = false;
      if (result.ok) {
        const fresh = await getJson<ProposalPayload>(`/api/proposals/${token}`);
        if (fresh.ok) render(fresh.data, false);
        else renderDeposit(result.data.deposit, false);
        status.textContent = `${payload.production_month_label} is held. Pay the deposit to confirm it.`;
        return;
      }
      if (result.code === 'month_taken') {
        clear(acceptArea);
        status.textContent = copyMonthTaken(payload.production_month_label);
        return;
      }
      if (result.code === 'illegal_transition') {
        await load();
        status.textContent = 'This proposal has already been accepted. The deposit invoice is below.';
        return;
      }
      if (result.status === 503) {
        button.disabled = false;
        status.textContent = 'Billing is unreachable, so nothing was held. Try again in a few minutes.';
        return;
      }
      if (result.status === 410) {
        clear(acceptArea);
        status.textContent =
          result.code === 'proposal_expired'
            ? 'This proposal has expired. Ask Kettlehole Audio for a new one.'
            : 'This proposal is no longer open.';
        return;
      }
      button.disabled = false;
      status.textContent = result.message;
    })();
  });
  acceptArea.append(button);
}

function render(payload: ProposalPayload, announce: boolean): void {
  const hadFocusOnAccept = acceptArea.contains(document.activeElement);
  current = payload;
  heading.textContent = `Proposal ${payload.reference}`;
  clear(summary);
  summary.append(
    el('h2', { class: 'proposal-project', text: payload.project_title }),
    el('p', { class: 'proposal-scope', text: payload.scope }),
    el('p', { class: 'proposal-fee mono', text: `Fee ${formatMoney(payload.fee_cents)}` }),
    el('p', { class: 'proposal-month mono', text: payload.production_month_label }),
  );
  renderMilestones(payload.milestones);
  renderAccept(payload);

  const paid = payload.status === 'deposit_paid' || payload.status === 'booked';
  if (payload.deposit !== null) renderDeposit(payload.deposit, paid);
  else clear(depositArea);

  if (announce) {
    if (paid) {
      status.textContent = `Deposit received. ${payload.production_month_label} is confirmed. A confirmation email will follow.`;
    } else if (payload.status === 'accepted') {
      status.textContent = 'This proposal has already been accepted. The deposit invoice is below.';
    } else if (!payload.month_open) {
      status.textContent = copyMonthTaken(payload.production_month_label);
    } else if (payload.deposit?.billing === 'unreachable') {
      status.textContent = 'Billing can\u2019t be reached, so these deposit figures may be out of date.';
    }
  }
  if (hadFocusOnAccept && !acceptArea.contains(document.activeElement)) heading.focus();

  if (payload.status === 'proposal_sent') startPolling();
  else stopPolling();
}

function startPolling(): void {
  if (polling !== null) return;
  polling = window.setInterval(() => {
    if (acceptPending) return;
    void refresh();
  }, LIVE_POLL_MS);
}

function stopPolling(): void {
  if (polling === null) return;
  window.clearInterval(polling);
  polling = null;
}

async function refresh(): Promise<void> {
  const result = await getJson<ProposalPayload>(`/api/proposals/${token}`);
  if (result.ok) {
    const previous = current;
    const changed =
      previous === null ||
      previous.status !== result.data.status ||
      previous.month_open !== result.data.month_open;
    if (changed) render(result.data, true);
    return;
  }
  if (result.status === 410) {
    stopPolling();
    clear(acceptArea);
    status.textContent =
      result.code === 'proposal_expired'
        ? 'This proposal has expired. Ask Kettlehole Audio for a new one.'
        : 'This proposal is no longer open.';
  }
}

async function load(): Promise<void> {
  const result = await getJson<ProposalPayload>(`/api/proposals/${token}`);
  if (result.ok) {
    render(result.data, true);
    return;
  }
  stopPolling();
  heading.textContent = 'Proposal';
  if (result.status === 410) {
    status.textContent =
      result.code === 'proposal_expired'
        ? 'This proposal has expired. Ask Kettlehole Audio for a new one.'
        : 'This proposal is no longer open.';
    return;
  }
  status.textContent = 'This proposal is no longer open.';
}

void load();
