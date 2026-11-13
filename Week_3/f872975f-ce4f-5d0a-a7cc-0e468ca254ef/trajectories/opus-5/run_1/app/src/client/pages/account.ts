import { getJson, postJson } from '../api';
import { clear, el, setText } from '../dom';
import { HoldCardActions, HoldCardView, holdCard } from '../holdcard';
import { formatAmount } from '../fmt';
import { HOLD_COPY, newIdempotencyKey } from '../holdlogic';
import { navigate } from '../router';
import { Page } from '../shell';
import { refreshServices } from '../store';
import { Hold, Invoice, Sale, Ticket } from '../types';

const TICKET_LABELS: Record<string, string> = { issued: 'Issued', 'at-saw': 'At saw', done: 'Done' };

export async function accountPage(): Promise<Page> {
  const holdsList = el('div', { class: 'cards' });
  const ticketsList = el('div', { class: 'cards' });
  const invoicesList = el('div', { class: 'cards' });
  const holdStatus = el('p', { class: 'live', attrs: { role: 'status', 'aria-label': 'Hold status' } });

  const empty = el('p', { class: 'muted', text: 'No holds yet.' });
  const purchaseKeys = new Map<string, string>();
  let holds: Hold[] = [];
  let poll = 0;

  const cards = new Map<string, HoldCardView>();
  let order: string[] = [];

  function renderHolds(next: Hold[]): void {
    const ids = next.map((hold) => hold.id);
    const sameOrder = ids.length === order.length && ids.every((id, at) => order[at] === id);
    for (const [id, card] of cards) {
      if (!ids.includes(id)) {
        card.root.remove();
        cards.delete(id);
      }
    }
    const actions: HoldCardActions = {
      pay: (hold, button) => void payForCuts(hold, button),
      cancel: (hold, button, link) => void cancelHold(hold, button, link)
    };
    for (const hold of next) {
      const found = cards.get(hold.id);
      if (found === undefined) cards.set(hold.id, holdCard(hold, actions));
      else found.update(hold);
    }
    empty.hidden = next.length > 0;
    if (!sameOrder) {
      for (const id of ids) {
        const card = cards.get(id);
        if (card !== undefined) holdsList.appendChild(card.root);
      }
      order = ids;
    }
    holds = next;
  }

  function applyBillingState(): void {
    for (const card of cards.values()) card.applyBillingState();
  }

  async function loadHolds(): Promise<void> {
    const result = await getJson<{ holds: Hold[] }>('/api/holds');
    if (!result.ok || result.data === null) return;
    renderHolds(result.data.holds);
  }

  async function cancelHold(hold: Hold, button: HTMLButtonElement, link: HTMLElement): Promise<void> {
    button.disabled = true;
    button.textContent = 'Cancelling';
    const result = await postJson<{ hold: Hold }>(`/api/holds/${hold.id}/cancel`, {});
    button.disabled = false;
    button.textContent = 'Cancel hold';
    if (result.ok) {
      setText(holdStatus, HOLD_COPY.released);
      await loadHolds();
      const card = holdsList.querySelector<HTMLElement>(`[data-hold="${hold.id}"] .tag`);
      (card ?? link).focus();
      return;
    }
    const code = result.failure?.error;
    if (code === 'billing_unavailable') {
      setText(holdStatus, HOLD_COPY.billingCancel);
      void refreshServices();
      return;
    }
    if (code === 'hold_not_active') {
      setText(holdStatus, HOLD_COPY.notActive);
      await loadHolds();
      return;
    }
    setText(holdStatus, HOLD_COPY.generic);
  }

  async function payForCuts(hold: Hold, button: HTMLButtonElement): Promise<void> {
    const key = purchaseKeys.get(hold.id) ?? newIdempotencyKey();
    purchaseKeys.set(hold.id, key);
    button.disabled = true;
    button.textContent = 'Paying';
    const result = await postJson<{ sale: Sale }>(`/api/holds/${hold.id}/purchase`, {}, { 'Idempotency-Key': key });
    button.disabled = false;
    button.textContent = 'Pay and cut';
    if (result.ok && result.data !== null) {
      purchaseKeys.delete(hold.id);
      setText(holdStatus, `Paid. Cut ticket ${result.data.sale.ticket} is with the saw.`);
      await Promise.all([loadHolds(), loadTickets(), loadInvoices()]);
      return;
    }
    const code = result.failure?.error;
    if (code === 'billing_unavailable') {
      setText(holdStatus, HOLD_COPY.billingPurchase);
      void refreshServices();
      return;
    }
    if (code === 'storage_unavailable') {
      setText(holdStatus, HOLD_COPY.storage);
      void refreshServices();
      return;
    }
    if (code === 'payment_failed') {
      setText(holdStatus, HOLD_COPY.paymentFailed);
      return;
    }
    if (code === 'hold_not_active') {
      setText(holdStatus, HOLD_COPY.notActive);
      await loadHolds();
      return;
    }
    setText(holdStatus, HOLD_COPY.generic);
  }

  async function loadTickets(): Promise<void> {
    const result = await getJson<{ tickets: Ticket[] }>('/api/tickets');
    clear(ticketsList);
    const tickets = result.data?.tickets ?? [];
    if (tickets.length === 0) {
      ticketsList.appendChild(el('p', { class: 'muted', text: 'No cut tickets yet.' }));
      return;
    }
    for (const ticket of tickets) {
      ticketsList.appendChild(
        el('article', { class: 'card' }, [
          el('a', {
            class: 'tag mono',
            text: ticket.id,
            attrs: { href: `/tickets/${ticket.id}` },
            on: {
              click: (event) => {
                event.preventDefault();
                navigate(`/tickets/${ticket.id}`);
              }
            }
          }),
          el('span', { class: 'badge', text: TICKET_LABELS[ticket.status] ?? ticket.status })
        ])
      );
    }
  }

  async function loadInvoices(): Promise<void> {
    const result = await getJson<{ invoices: Invoice[] }>('/api/invoices');
    clear(invoicesList);
    const invoices = result.data?.invoices ?? [];
    if (invoices.length === 0) {
      invoicesList.appendChild(el('p', { class: 'muted', text: 'No invoices yet.' }));
      return;
    }
    for (const invoice of invoices) {
      invoicesList.appendChild(
        el('article', { class: 'card' }, [
          el('span', { class: 'tag mono', text: invoice.id }),
          el('span', { class: 'mono', text: `Ticket ${invoice.ticket}` }),
          el('span', { class: 'mono', text: `Price $${formatAmount(invoice.price_cents)}` }),
          el('span', { class: 'mono', text: `Deposit $${formatAmount(invoice.deposit_cents)}` }),
          el('span', { class: 'mono', text: `Balance paid $${formatAmount(invoice.amount_cents)}` }),
          el('span', { class: 'badge', text: 'Paid' }),
          el(
            'ul',
            { class: 'lines', attrs: { role: 'list', 'aria-label': `Lines on ${invoice.id}` } },
            invoice.lines.map((line) =>
              el('li', { class: 'mono', attrs: { role: 'listitem' }, text: `${line.label} $${formatAmount(line.amount_cents)}` })
            )
          )
        ])
      );
    }
  }

  const element = el('section', { class: 'page account' }, [
    el('h1', { class: 'page-title', text: 'Your account' }),
    el('h2', { text: 'Holds' }),
    holdStatus,
    empty,
    holdsList,
    el('h2', { text: 'Cut tickets' }),
    ticketsList,
    el('h2', { text: 'Invoices' }),
    invoicesList
  ]);

  await Promise.all([loadHolds(), loadTickets(), loadInvoices()]);

  poll = window.setInterval(() => {
    if (holds.some((hold) => hold.status === 'held' || hold.status === 'pending-payment')) void loadHolds();
  }, 4000);

  return {
    element,
    banners: ['billing'],
    onServices: () => applyBillingState(),
    destroy: () => window.clearInterval(poll)
  };
}
