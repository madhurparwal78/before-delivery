import { api } from '../api.js';
import { escapeHtml, type ShellState } from '../shell.js';
import { formatMoney, formatUtc, holdLabel, ticketLabel } from '../format.js';

export function renderAccountPage(state: ShellState): string {
  if (state.user === null || state.user.role !== 'maker') {
    return `<div class="not-found"><h1>Not on this rack</h1><p>Check the link, or go back to the rack.</p><p><a href="/">Back to the rack</a></p></div>`;
  }
  return `
  <h1 class="page-title">Account</h1>
  <p class="live-status" id="account-loading">Loading ${escapeHtml(state.user.name)}'s work…</p>
  <div id="account-body"></div>`;
}

export function mountAccountPage(): void {
  const host = document.getElementById('account-body') as HTMLElement;

  async function refresh(): Promise<void> {
    const [holds, tickets, invoices] = await Promise.all([
      api.holds().then((r) => r.holds).catch(() => []),
      api.tickets().then((r) => r.tickets).catch(() => []),
      api.invoices().then((r) => r.invoices).catch(() => []),
    ]);
    render(holds, tickets, invoices);
  }

  function render(holds: Array<{ id: string; board: string; status: string; release_reason: string | null; expires_at: string | null; }>,
    tickets: Array<{ id: string; status: string }>,
    invoices: Array<{ id: string; ticket: string; price_cents: number; deposit_cents: number; amount_cents: number; lines: Array<{ label: string; amount_cents: number }> }>): void {
    const holdCards = holds.map((hold) => {
      const active = hold.status === 'held';
      const label = holdLabel(hold);
      return `<div class="card hold-card" data-hold="${hold.id}">
        <div class="row"><a class="tag mono" href="/boards/${encodeURIComponent(hold.board)}">${hold.board}</a><span class="badge" data-label="${label}">${label}</span></div>
        ${active ? `<div class="mono">Held until ${formatUtc(hold.expires_at)}</div>` : ''}
        ${active ? `<div class="hold-actions">
          <button data-pay="${hold.id}"${holdBillingDown() ? ' aria-disabled="true"' : ''}>Pay and cut</button>
          <button data-cancel="${hold.id}"${holdBillingDown() ? ' aria-disabled="true"' : ''}>Cancel hold</button>
          ${holdBillingDown() ? '<span class="mono">Paused while billing is offline.</span>' : ''}
        </div>` : ''}
        ${hold.status === 'released' && hold.release_reason === 'expired' ? '<div class="mono">Hold expired. The deposit was kept.</div>' : ''}
      </div>`;
    }).join('');
    const ticketRows = tickets.map((ticket) => `<div class="card"><div class="row"><a class="mono" href="/tickets/${encodeURIComponent(ticket.id)}">${ticket.id}</a><span class="badge">${ticketLabel(ticket.status)}</span></div></div>`).join('');
    const invoiceRows = invoices.map((invoice) => `<div class="card">
      <div class="row"><span class="mono">${invoice.id}</span><span class="mono">${invoice.ticket}</span><span class="badge">Paid</span></div>
      <div class="mono figures">Price $${formatMoney(invoice.price_cents)} · Deposit $${formatMoney(invoice.deposit_cents)} · Balance paid $${formatMoney(invoice.amount_cents)}</div>
      <ul class="plain" aria-label="Lines on ${invoice.id}">
        ${invoice.lines.map((line) => `<li>${escapeHtml(line.label)} $${formatMoney(line.amount_cents)}</li>`).join('')}
      </ul>
    </div>`).join('');

    host.innerHTML = `
      <div class="section"><h2>Holds</h2>${holdCards || '<p class="live-status">No holds yet.</p>'}</div>
      <div class="section"><h2>Cut tickets</h2>${ticketRows || '<p class="live-status">No cut tickets yet.</p>'}</div>
      <div class="section"><h2>Invoices</h2>${invoiceRows || '<p class="live-status">No invoices yet.</p>'}</div>`;

    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-cancel]')) {
      button.addEventListener('click', () => void cancelHold(button.dataset['cancel'] ?? '', button));
    }
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-pay]')) {
      button.addEventListener('click', () => void payAndCut(button.dataset['pay'] ?? '', button));
    }
  }


  let billingDown = false;
  document.addEventListener('kerfwell-services', ((event: CustomEvent) => {
    billingDown = event.detail.billing === 'down';
    void refresh();
  }) as EventListener);

  function holdBillingDown(): boolean {
    return billingDown;
  }

  async function cancelHold(id: string, button: HTMLButtonElement): Promise<void> {
    if (button.getAttribute('aria-disabled') === 'true') return;
    button.disabled = true;
    button.textContent = 'Cancelling';
    try {
      await api.cancelHold(id);
      await refresh();
      const card = host.querySelector(`[data-hold="${id}"]`);
      const link = card?.querySelector<HTMLAnchorElement>('a');
      link?.focus();
    } catch (error) {
      const apiError = error as { code?: string };
      await refresh();
      if (apiError.code === 'billing_unavailable') {
        // hold stays held; the refresh already shows the paused copy
      }
    }
  }

  async function payAndCut(id: string, button: HTMLButtonElement): Promise<void> {
    if (button.getAttribute('aria-disabled') === 'true') return;
    button.disabled = true;
    button.textContent = 'Paying';
    const key = `purchase-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await api.purchase(id, key);
      await refresh();
    } catch {
      await refresh();
    }
  }

  void refresh();
  window.setInterval(() => void refresh(), 5000);
}
