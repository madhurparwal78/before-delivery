import type { RequestContext } from '../http/types.js';
import type { PageContext } from './render.js';
import { layout, escapeHtml } from './render.js';
import { t, formatAmount, formatDate } from '../locales.js';
import { query, one } from '../db/db.js';
import { getOrderByRef } from '../domain/commerce.js';
import { getModelById } from '../domain/models.js';
import { queueCounts } from '../queue/runner.js';
import { serviceSnapshot } from '../providers/availability.js';

function staffCopy(l: 'en' | 'de'): Record<string, string> {
  const keys = [
    'staff.refund_pending', 'staff.refund_done', 'staff.notices', 'nothing_to_refund', 'billing_unavailable',
    'field.seats', 'error.summary_title', 'staff.no_orders',
  ];
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = t(l, key);
  return out;
}

export async function renderStaff(ctx: PageContext): Promise<string> {
  const l = ctx.locale;
  ctx.title = t(l, 'staff.heading');
  ctx.script = '/assets/staff.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...staffCopy(l) };
  const health = serviceSnapshot();
  const counts = await queueCounts();
  const main = `<div class="staff">
  <h1>${t(l, 'staff.heading')}</h1>
  <section aria-label="${t(l, 'staff.find_orders')}">
    <form id="order-lookup">
      <label for="order-lookup-input">${t(l, 'staff.find_orders')}</label>
      <input type="search" id="order-lookup-input" name="lookup" placeholder="${t(l, 'staff.lookup')}">
      <button type="submit">${t(l, 'common.save')}</button>
      <p class="form-alert" role="alert" hidden></p>
    </form>
    <table class="data-table" id="orders-table" aria-label="${t(l, 'staff.orders')}">
      <thead><tr>
        <th scope="col">${t(l, 'staff.order')}</th><th scope="col">${t(l, 'staff.email')}</th>
        <th scope="col">${t(l, 'staff.licence')}</th><th scope="col">${t(l, 'staff.seats')}</th>
        <th scope="col">${t(l, 'staff.amount')}</th><th scope="col">${t(l, 'staff.refunded')}</th>
        <th scope="col">${t(l, 'staff.status')}</th>
      </tr></thead>
      <tbody>
      </tbody>
    </table>
  </section>
  <p class="visually-hidden" role="status" id="staff-notices" aria-live="polite"></p>
  <section class="health-panel" aria-label="${t(l, 'staff.service_health')}">
    <h2>${t(l, 'staff.service_health')}</h2>
    <p class="mono">${t(l, 'service.database')} ${t(l, health.database === 'up' ? 'service.up' : 'service.down')}</p>
    <p class="mono">${t(l, 'service.storage')} ${t(l, health.storage === 'up' ? 'service.up' : 'service.down')}</p>
    <p class="mono">${t(l, 'service.search')} ${t(l, health.search === 'up' ? 'service.up' : 'service.down')}</p>
    <p class="mono">${t(l, 'service.billing')} ${t(l, health.billing === 'up' ? 'service.up' : 'service.down')}</p>
    <p class="mono">${t(l, 'service.mail')} ${t(l, health.mail === 'up' ? 'service.up' : 'service.down')}</p>
    <p class="mono">${t(l, 'queue.pending', { n: counts.pending })}</p>
    <p class="mono">${t(l, 'queue.running', { n: counts.running })}</p>
    <p class="mono">${t(l, 'queue.failed', { n: counts.failed })}</p>
  </section>
</div>`;
  return layout(ctx, main);
}

export async function renderStaffOrder(ctx: PageContext, request: RequestContext): Promise<string> {
  const ref = request.params['ref'] ?? '';
  const order = await getOrderByRef(ref);
  if (order === null) throw new (await import('../errors.js')).ApiError(404, 'not_found');
  const model = await getModelById(order.model_id);
  const l = ctx.locale;
  ctx.title = `${t(l, 'staff.order')} ${order.order_ref}`;
  ctx.script = '/assets/staff.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...staffCopy(l) };
  const main = `<div class="staff order-detail" data-order="${escapeHtml(order.order_ref)}">
  <h1>${order.order_ref}</h1>
  <p class="mono">${escapeHtml(order.buyer_email)}</p>
  <p>${escapeHtml(model?.title ?? '')}</p>
  <p class="mono">${formatAmount(order.amount_cents, l)} · ${t(l, `order_status.${order.status === 'paid' ? 'paid' : order.status === 'partially_refunded' ? 'partially_refunded' : 'refunded'}`)}</p>
  <p class="mono">${t(l, 'receipt.refunded_line', { amount: formatAmount(order.refunded_cents, l) })}</p>
  <p class="mono">${formatDate(new Date(order.created_at), l)}</p>
  <p class="visually-hidden" role="status" id="staff-notices" aria-live="polite"></p>
  <section aria-label="${t(l, 'staff.refund_full')}">
    <button type="button" id="refund-full" data-order="${escapeHtml(order.order_ref)}">${t(l, 'staff.refund_full')}</button>
  </section>
  <section aria-label="${t(l, 'staff.refund_seats')}">
    <label for="seats-input">${t(l, 'staff.seats_to_refund')}</label>
    <input type="number" id="seats-input" min="1" step="1" value="1">
    <button type="button" id="refund-seats" data-order="${escapeHtml(order.order_ref)}">${t(l, 'staff.refund_seats')}</button>
  </section>
</div>`;
  return layout(ctx, main);
}
