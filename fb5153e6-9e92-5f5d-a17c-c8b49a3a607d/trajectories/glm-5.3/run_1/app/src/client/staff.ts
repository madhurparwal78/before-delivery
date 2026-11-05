import { api, copy, announce, wireCore, ApiFailure } from './app-core.js';

/** Staff order lookup by email or order reference. */
function wireOrderLookup(): void {
  const form = document.getElementById('order-lookup') as HTMLFormElement | null;
  if (form === null) return;
  const alert = form.querySelector<HTMLElement>('.form-alert');
  const tbody = document.querySelector<HTMLElement>('#orders-table tbody');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const lookup = (form.querySelector('#order-lookup-input') as HTMLInputElement).value.trim();
    if (lookup === '') {
      if (alert !== null) {
        alert.textContent = copy('field.lookup') === 'field.lookup' ? 'Give either an email or an order reference.' : copy('field.lookup');
        alert.hidden = false;
      }
      return;
    }
    if (alert !== null) alert.hidden = true;
    const query = lookup.includes('@') ? `email=${encodeURIComponent(lookup)}` : `order=${encodeURIComponent(lookup)}`;
    void api<{ orders: OrderRow[] }>(`/api/staff/orders?${query}`)
      .then(result => {
        if (tbody === null) return;
        tbody.innerHTML =
          result.orders.map(row => `<tr>
            <td><a href="/staff/orders/${row.order}">${row.order}</a></td>
            <td>${row.email}</td>
            <td>${row.licence}</td>
            <td class="mono">${row.seats}</td>
            <td class="mono">${row.amount_cents / 100}</td>
            <td class="mono">${row.refunded_cents / 100}</td>
            <td>${copy(`order_status.${row.status === 'paid' ? 'paid' : row.status === 'partially_refunded' ? 'partially_refunded' : 'refunded'}`)}</td>
          </tr>`).join('') || `<tr><td colspan="7">${copy('staff.no_orders')}</td></tr>`;
      })
      .catch(() => {
        if (tbody !== null) tbody.innerHTML = `<tr><td colspan="7">${copy('staff.no_orders')}</td></tr>`;
      });
  });
}

interface OrderRow {
  order: string;
  email: string;
  licence: string;
  seats: number;
  amount_cents: number;
  refunded_cents: number;
  status: string;
}

function wireRefunds(): void {
  const refundFull = document.getElementById('refund-full');
  const refundSeats = document.getElementById('refund-seats');
  const order = document.querySelector<HTMLElement>('.order-detail')?.dataset['order'] ?? '';
  const idemOf = (): string => `ui-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  refundFull?.addEventListener('click', () => {
    announce(document.getElementById('staff-notices'), copy('staff.refund_pending'));
    void api(`/api/staff/orders/${order}/refunds`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemOf() },
      body: JSON.stringify({ kind: 'full' }),
    })
      .then(result => {
        const refund = result as { refund_cents: number; refunded_cents: number; status: string; order: string };
        announce(document.getElementById('staff-notices'), copy('staff.refund_done', { amount: amountOf(refund.refund_cents), 'order ref': refund.order }));
        updateOrderLines(refund.refunded_cents, refund.status);
      })
      .catch(err => {
        const failure = err instanceof ApiFailure ? err : null;
        const message = failure !== null ? (copy(failure.code) === failure.code ? failure.message : copy(failure.code)) : copy('not_found');
        announce(document.getElementById('staff-notices'), message);
      });
  });
  refundSeats?.addEventListener('click', () => {
    const seats = Number((document.getElementById('seats-input') as HTMLInputElement).value);
    announce(document.getElementById('staff-notices'), copy('staff.refund_pending'));
    void api(`/api/staff/orders/${order}/refunds`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idemOf() },
      body: JSON.stringify({ kind: 'seats', seats }),
    })
      .then(result => {
        const refund = result as { refund_cents: number; refunded_cents: number; status: string; order: string };
        announce(document.getElementById('staff-notices'), copy('staff.refund_done', { amount: amountOf(refund.refund_cents), 'order ref': refund.order }));
        updateOrderLines(refund.refunded_cents, refund.status);
      })
      .catch(err => {
        const failure = err instanceof ApiFailure ? err : null;
        const message = failure !== null ? (copy(failure.code) === failure.code ? failure.message : copy(failure.code)) : copy('not_found');
        announce(document.getElementById('staff-notices'), message);
      });
  });
}

function updateOrderLines(refundedCents: number, status: string): void {
  const detail = document.querySelector<HTMLElement>('.order-detail');
  if (detail === null) return;
  const lines = detail.querySelectorAll('.mono');
  const refundedLine = lines[2];
  if (refundedLine !== undefined && refundedLine.textContent !== null) {
    const label = refundedLine.textContent.split(':')[0] ?? '';
    refundedLine.textContent = `${label}: ${amountOf(refundedCents)}`;
  }
  const statusLine = lines[1];
  if (statusLine !== undefined && statusLine.textContent !== null) {
    const parts = statusLine.textContent.split('·');
    parts[2] = ` ${copy(`order_status.${status === 'refunded' ? 'refunded' : status === 'partially_refunded' ? 'partially_refunded' : 'paid'}`)} `;
    statusLine.textContent = parts.join('·');
  }
}

function amountOf(cents: number): string {
  const l = document.documentElement.lang === 'de' ? 'de' : 'en';
  const whole = Math.floor(cents / 100).toLocaleString(l === 'en' ? 'en-US' : 'de-DE');
  const part = String(cents % 100).padStart(2, '0');
  return l === 'en' ? `€${whole}.${part}` : `${whole},${part} €`;
}

wireCore();
wireOrderLookup();
wireRefunds();
