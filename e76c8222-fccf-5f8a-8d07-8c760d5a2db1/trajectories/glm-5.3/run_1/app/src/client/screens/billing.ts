// Billing: timesheet queue with approve, rates, and invoices.
import { api, isFailure, newIdempotencyKey } from '../lib/api.js';
import { h, clear, statusRegion } from '../lib/dom.js';
import { copy, statusLabel } from '../lib/copy.js';
import { cardDate, agencyTime } from '../lib/time.js';
import type { InvoiceView, TimesheetRow } from '../lib/types.js';
import { state } from '../main.js';

export function renderBilling(signal: AbortSignal): HTMLElement {
  const wrap = h('div', { class: 'column' });
  wrap.appendChild(h('h1', {}, 'Billing'));
  const status = statusRegion('Billing status');

  const queueHeading = h('h2', { style: 'font-size:1.3rem' }, 'Timesheets awaiting approval');
  const queue = h('table', { class: 'data', 'aria-label': 'Timesheets awaiting approval' });
  queue.appendChild(h('thead', {}, h('tr', {},
    h('th', {}, 'Ref'), h('th', {}, 'Interpreter'), h('th', {}, 'Actual times'),
    h('th', {}, 'Billed hours'), h('th', {}, 'Status'), h('th', {}, ''))));
  const queueBody = h('tbody', {});
  queue.appendChild(queueBody);
  wrap.appendChild(queueHeading);
  wrap.appendChild(queue);

  const ratesRegion = h('section', { role: 'region', 'aria-label': 'Rates' });
  wrap.appendChild(ratesRegion);

  const approvedAmount = h('p', { class: 'mono', 'aria-live': 'polite', role: 'status' });
  wrap.appendChild(h('h2', { style: 'font-size:1.3rem' }, 'Latest approved'));
  wrap.appendChild(approvedAmount);
  wrap.appendChild(h('p', {}, h('a', { href: '/invoices' }, 'Invoices')));
  wrap.appendChild(status.el);

  async function refresh(): Promise<void> {
    try {
      const res = await api.get<{ timesheets: TimesheetRow[] }>('/timesheets?status=submitted');
      clear(queueBody);
      for (const ts of res.timesheets) {
        const start = new Date(ts.actual_start);
        const end = new Date(ts.actual_end);
        const approveBtn = h('button', {
          'aria-label': `Approve ${ts.ref} for ${ts.interpreter.name}`,
          onclick: async () => {
            approveBtn.setAttribute('disabled', 'true');
            status.set(copy.approve.pending, 'pending');
            try {
              const out = await api.post<{ timesheet: { amount: string } }>(
                `/timesheets/${ts.id}/approve`, {}, { 'Idempotency-Key': newIdempotencyKey() },
              );
              status.set(copy.approve.success(ts.ref, ts.interpreter.name, out.timesheet.amount), undefined);
              approvedAmount.textContent = `Approved ${ts.ref} for ${ts.interpreter.name}: $${out.timesheet.amount}`;
              void refresh();
            } catch (err) {
              approveBtn.removeAttribute('disabled');
              if (isFailure(err) && err.code === 'billing_unavailable') status.set(copy.approve.billing, 'error');
              else if (isFailure(err) && err.code === 'storage_unavailable') status.set(copy.approve.storage, 'error');
              else if (isFailure(err)) status.set(err.message, 'error');
            }
          },
        }, `Approve ${ts.ref} for ${ts.interpreter.name}`);
        queueBody.appendChild(h('tr', {},
          h('td', { class: 'mono', 'data-label': 'Ref' }, ts.ref),
          h('td', { 'data-label': 'Interpreter' }, ts.interpreter.name),
          h('td', { class: 'mono', 'data-label': 'Actual times' }, `${cardDate(start)} ${agencyTime(start)}–${agencyTime(end)}`),
          h('td', { class: 'mono', 'data-label': 'Billed hours' }, ts.billed_hours),
          h('td', { 'data-label': 'Status' }, statusLabel(ts.status)),
          h('td', { 'data-label': '' }, approveBtn),
        ));
      }
    } catch {
      // keep showing the last queue
    }

    try {
      const rates = await api.get<{ rates: Record<string, string> }>('/rates');
      clear(ratesRegion);
      ratesRegion.appendChild(h('h2', { style: 'font-size:1.3rem' }, 'Rates'));
      const inputs: Record<string, HTMLInputElement> = {};
      const settings: Array<[string, string]> = [
        ['medical', 'Medical hourly rate'], ['legal', 'Legal hourly rate'],
        ['education', 'Education hourly rate'], ['community', 'Community hourly rate'],
      ];
      for (const [key, label] of settings) {
        inputs[key] = h('input', { type: 'text', class: 'mono', value: rates.rates[key] ?? '0.00', id: `rate-${key}` }) as HTMLInputElement;
        ratesRegion.appendChild(h('label', { for: `rate-${key}` }, label));
        ratesRegion.appendChild(inputs[key]!);
      }
      ratesRegion.appendChild(h('div', { class: 'btn-row' }, h('button', { onclick: async () => {
        const body: Record<string, string> = {};
        for (const [key] of settings) body[key] = inputs[key]!.value.trim();
        status.set(copy.rates.pending, 'pending');
        try {
          await api.put('/rates', body);
          status.set(copy.rates.success, undefined);
        } catch (err) {
          if (isFailure(err) && err.code === 'validation') status.set(copy.rates.validation, 'error');
          else if (isFailure(err)) status.set(err.message, 'error');
        }
      } }, 'Save rates')));
    } catch {
      // rates unavailable
    }
  }

  void refresh();
  return wrap;
}

export async function renderInvoices(): Promise<HTMLElement> {
  const wrap = h('div', { class: 'column' });
  wrap.appendChild(h('h1', {}, 'Invoices'));
  const status = statusRegion('Invoice status');

  let orgId: string;
  if (state.user?.role === 'billing') {
    const select = h('select', { 'aria-label': 'Organisation' });
    // The billing lead picks the organisation from the requests they can already see.
    const res = await api.get<{ requests: Array<{ org_id: string; org_name: string }> }>('/requests');
    const orgs = [...new Map(res.requests.map((r) => [r.org_id, r.org_name])).entries()];
    for (const [id, name] of orgs) {
      select.appendChild(h('option', { value: id }, name));
    }
    wrap.appendChild(h('label', {}, 'Organisation'));
    wrap.appendChild(select);
    select.addEventListener('change', () => void load(select.value));
    orgId = select.value || '';
  } else {
    orgId = state.user?.org_id ?? '';
  }

  const list = h('div', {});
  wrap.appendChild(list);
  wrap.appendChild(status.el);

  async function load(org: string): Promise<void> {
    if (!org) return;
    clear(list);
    status.set(copy.invoices.pending, 'pending');
    try {
      const res = await api.get<{ org_id: string; killbill_account_id: string; invoices: InvoiceView[]; total: string }>(`/orgs/${org}/invoices`);
      const table = h('table', { class: 'data', 'aria-label': 'Invoices' });
      table.appendChild(h('thead', {}, h('tr', {},
        h('th', {}, 'Number'), h('th', {}, 'Date'), h('th', {}, 'Amount'), h('th', {}, 'Balance'))));
      const tbody = h('tbody', {});
      for (const inv of res.invoices) {
        const row = h('tr', {},
          h('td', { class: 'mono', 'data-label': 'Number' }, inv.invoice_number),
          h('td', { class: 'mono', 'data-label': 'Date' }, inv.invoice_date),
          h('td', { class: 'mono', 'data-label': 'Amount' }, `$${inv.amount}`),
          h('td', { class: 'mono', 'data-label': 'Balance' }, `$${inv.balance}`),
        );
        tbody.appendChild(row);
        for (const item of inv.items) {
          tbody.appendChild(h('tr', {},
            h('td', { colspan: '4', 'data-label': 'Item' }, `${item.description} — $${item.amount}`),
          ));
        }
      }
      table.appendChild(tbody);
      list.appendChild(table);
      status.set(copy.invoices.success(res.invoices.length, res.total), undefined);
    } catch (err) {
      if (isFailure(err) && err.code === 'billing_unavailable') status.set(copy.invoices.billing, 'error');
      else if (isFailure(err)) status.set(err.message, 'error');
    }
  }

  await load(orgId);
  return wrap;
}
