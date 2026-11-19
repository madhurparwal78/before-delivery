import { api, money, type OrderJson } from './api.js';
import { announce, focusTrap, observeEntrances, watchHeaderScroll } from './motion.js';
import { headerRoleLinks, loadMe } from './header.js';

const OUTAGE_COPY: Record<string, string> = {
  killbill: `Kill Bill is unreachable. New purchases, refunds and plan changes are paused; held editions keep their timers.`,
  render_provider: `The render provider is unreachable. New renders wait in the queue and return their credits if they run out of retries.`,
  gotenberg: `Invoice rendering is down. Paid orders keep their invoice numbers and show "Paid, invoice pending" until their PDFs render.`,
  mail: `Mail is down. Receipts and notices wait in the outbox and send once mail is back.`,
  storage: `File storage is unreachable. Renders cannot finish and downloads are paused.`
};

async function main(): Promise<void> {
  watchHeaderScroll(document.querySelector('header.studio-header'));
  const me = await loadMe();
  headerRoleLinks(me);
  if (!me) {
    window.location.href = '/auth/login?return_to=/console';
    return;
  }
  if (!me.roles.includes('founder-operator')) {
    document.querySelector<HTMLElement>('[data-forbidden]')!.hidden = false;
    return;
  }

  const notices = document.querySelector<HTMLElement>('[data-service-notices]');
  const tabs = document.querySelector<HTMLElement>('[data-console-tabs]');
  const panels: Record<string, HTMLElement> = {
    orders: document.querySelector<HTMLElement>('[data-panel-orders]')!,
    credits: document.querySelector<HTMLElement>('[data-panel-credits]')!,
    renders: document.querySelector<HTMLElement>('[data-panel-renders]')!,
    statements: document.querySelector<HTMLElement>('[data-panel-statements]')!
  };

  const paintServices = async (): Promise<void> => {
    const result = await api<{ services: { name: string; reachable: boolean }[] }>('GET', '/api/admin/services');
    if (!result.ok || !notices) return;
    const services = (result.body as { services: { name: string; reachable: boolean }[] }).services;
    notices.innerHTML = '';
    for (const service of services) {
      if (service.reachable) continue;
      const banner = document.createElement('div');
      banner.className = 'outage-banner';
      banner.textContent = OUTAGE_COPY[service.name] ?? '';
      notices.appendChild(banner);
    }
  };
  void paintServices();
  window.setInterval(() => void paintServices(), 10_000);

  tabs?.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest('[role="tab"]');
    if (!tab) return;
    for (const button of Array.from(tabs.querySelectorAll('[role="tab"]'))) {
      button.setAttribute('aria-selected', button === tab ? 'true' : 'false');
    }
    for (const [name, panel] of Object.entries(panels)) {
      panel.hidden = (tab as HTMLElement).dataset.tab !== name;
    }
  });

  // Orders panel.
  const ordersResult = await api<{ orders: OrderJson[] }>('GET', '/api/admin/orders');
  const ordersBody = document.querySelector<HTMLElement>('[data-orders-body]');
  if (ordersResult.ok && ordersBody) {
    const orders = (ordersResult.body as { orders: OrderJson[] }).orders;
    for (const order of orders) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td data-label="Order" class="mono">${order.id.slice(0, 12)}</td>
        <td data-label="Piece">${escapeHtml(order.piece_title)}</td>
        <td data-label="Edition" class="tnum">${order.edition}</td>
        <td data-label="State">${order.state}</td>
        <td data-label="Net" class="money tnum">${money(order.net_cents)}</td>
        <td data-label="Refunded" class="money tnum">${money(order.refunded_net_cents)}</td>
        <td data-label="Invoice" class="mono">${order.invoice_number ?? '—'}</td>
        <td data-label="Action"><button type="button" data-refund data-order="${order.id}" data-remaining="${order.net_cents - order.refunded_net_cents}">Refund</button></td>`;
      ordersBody.appendChild(row);
    }
    ordersBody.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-refund]');
      if (!button) return;
      void openRefund(button);
    });
  }

  // Credit ledger panel.
  const ledgerResult = await api<{ accounts: { account: string; balance: number }[] }>('GET', '/api/admin/credit-ledger');
  const ledgerBody = document.querySelector<HTMLElement>('[data-ledger-body]');
  if (ledgerResult.ok && ledgerBody) {
    const body = ledgerResult.body as { accounts: { account: string; balance: number }[] };
    for (const account of body.accounts) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td data-label="Account" class="mono">${escapeHtml(account.account)}</td>
        <td data-label="Balance" class="money tnum">${signed(account.balance)}</td>`;
      ledgerBody.appendChild(row);
    }
  }

  // Renders panel.
  const rendersResult = await api<{ renders: { id: string; piece_slug: string; state: string; failure_reason: string | null; cost_credits: number; attempts: number }[] }>('GET', '/api/admin/renders');
  const rendersBody = document.querySelector<HTMLElement>('[data-renders-body]');
  if (rendersResult.ok && rendersBody) {
    const renders = (rendersResult.body as { renders: { id: string; piece_slug: string; state: string; failure_reason: string | null; cost_credits: number; attempts: number }[] }).renders;
    for (const render of renders) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td data-label="Render" class="mono">${render.id.slice(0, 12)}</td>
        <td data-label="Piece">${escapeHtml(render.piece_slug)}</td>
        <td data-label="State">${render.state}</td>
        <td data-label="Failure">${render.failure_reason ?? '—'}</td>
        <td data-label="Cost" class="tnum">${render.cost_credits}</td>
        <td data-label="Attempts" class="tnum">${render.attempts}</td>`;
      rendersBody.appendChild(row);
    }
  }

  // Statements panel.
  const statementsBody = document.querySelector<HTMLElement>('[data-statements-body]');
  const statementButton = document.querySelector<HTMLButtonElement>('[data-close-month]');
  const period = '2026-10';
  statementButton?.addEventListener('click', async () => {
    const key = freshKey();
    const result = await api<{ period: string; creators: number }>('POST', '/api/admin/statements', { period }, { idempotencyKey: key });
    if (result.status === 409) {
      const body = result.body as { error: { code: string; message: string } };
      announce(document.querySelector('[data-console-status]'), body.error.message);
      return;
    }
    if (result.ok) {
      const body = result.body as { period: string; creators: number };
      announce(document.querySelector('[data-console-status]'), `Statements for ${monthLabel(period)} sent to ${body.creators} creators.`);
      const row = document.createElement('tr');
      row.innerHTML = `<td data-label="Period">${period}</td><td>closed</td>`;
      statementsBody?.appendChild(row);
    }
  });

  observeEntrances();
}

async function openRefund(button: HTMLButtonElement): Promise<void> {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[data-refund-dialog]')!;
  const amountInput = dialog.querySelector<HTMLInputElement>('[data-refund-amount]')!;
  const remaining = Number(button.dataset.remaining ?? '0');
  amountInput.value = (remaining / 100).toFixed(2);
  dialog.showModal();
  focusTrap(dialog, () => dialog.close(), amountInput);

  const closeBtn = dialog.querySelector<HTMLButtonElement>('[data-refund-close]');
  closeBtn?.addEventListener('click', () => dialog.close());
  const submit = dialog.querySelector<HTMLButtonElement>('[data-issue-refund]')!;
  const key = freshKey();
  const handler = async (): Promise<void> => {
    const amount = Math.round(Number(amountInput.value.replace('$', '')) * 100);
    const result = await api<{ refund: { credit_note_number: string } }>('POST', `/api/admin/orders/${button.dataset.order}/refunds`, { net_cents: amount, reason: '' }, { idempotencyKey: key });
    if (result.status === 409 || result.status === 422) {
      const body = result.body as { error: { message: string } };
      announce(document.querySelector('[data-console-status]'), body.error.message);
    } else if (result.ok) {
      const refund = (result.body as { refund: { credit_note_number: string } }).refund;
      announce(document.querySelector('[data-console-status]'), `Refund issued as ${refund.credit_note_number}.`);
    } else {
      announce(document.querySelector('[data-console-status]'), `Payments are offline right now.`);
    }
    submit.removeEventListener('click', handler);
    dialog.close();
  };
  submit.addEventListener('click', () => void handler());
}

function freshKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function signed(amount: number): string {
  const sign = amount < 0 ? '−' : '+';
  const label = amount < 0 ? 'debit' : 'credit';
  return `${sign}${money(Math.abs(amount))} <span class="sign-label">${label}</span>`;
}

function monthLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${names[month - 1]} ${year}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

void main();
