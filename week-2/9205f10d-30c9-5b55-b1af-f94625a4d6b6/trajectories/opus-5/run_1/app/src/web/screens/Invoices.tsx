import { useState, type ReactNode } from 'react';
import { api } from '../api.js';
import { useDebounced, usePolled } from '../hooks.js';
import type { BillingStatus, InvoiceKind } from '../../shared/types.js';

const KIND_WORD: Record<InvoiceKind, string> = {
  interpreting: 'Interpreting',
  late_cancellation: 'Late cancellation',
};

const BILLING_WORD: Record<BillingStatus, string> = {
  pending: 'Invoice pending',
  posted: 'Posted',
};

export function Invoices(): ReactNode {
  const [search, setSearch] = useState('');
  const [immediate, setImmediate] = useState('');
  const debounced = useDebounced(search);
  const query = immediate !== '' ? immediate : debounced;
  const list = usePolled(
    () => api.invoices(query === '' ? '' : `?q=${encodeURIComponent(query)}`),
    ['invoices', query],
  );

  return (
    <main className="page">
      <h1>Invoices</h1>
      <div className="row-between">
        <div className="field form-6" style={{ marginBottom: 0 }}>
          <label htmlFor="search-invoices">Search invoices</label>
          <input
            id="search-invoices"
            type="search"
            aria-label="Search invoices"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setImmediate('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setImmediate(search);
            }}
          />
        </div>
        <a href={`/api/invoices.csv${query === '' ? '' : `?q=${encodeURIComponent(query)}`}`}>
          Export CSV
        </a>
      </div>
      <table className="stacked-table">
        <caption>Invoices</caption>
        <thead>
          <tr>
            <th scope="col">Reference</th>
            <th scope="col">Organisation</th>
            <th scope="col">Kind</th>
            <th scope="col">Billable minutes</th>
            <th scope="col">Seats</th>
            <th scope="col">Rate</th>
            <th scope="col">Amount</th>
            <th scope="col">Billing status</th>
            <th scope="col">Kill Bill invoice</th>
          </tr>
        </thead>
        <tbody>
          {(list.data?.invoices ?? []).map((invoice) => (
            <tr key={invoice.id}>
              <td data-label="Reference" className="num">
                {invoice.request_reference}
              </td>
              <td data-label="Organisation">{invoice.organisation.name}</td>
              <td data-label="Kind">{KIND_WORD[invoice.kind]}</td>
              <td data-label="Billable minutes" className="num">
                {invoice.billable_minutes}
              </td>
              <td data-label="Seats" className="num">
                {invoice.seats}
              </td>
              <td data-label="Rate" className="num">
                {invoice.hourly_rate}
              </td>
              <td data-label="Amount" className="num">
                {invoice.amount}
              </td>
              <td data-label="Billing status">{BILLING_WORD[invoice.billing_status]}</td>
              <td data-label="Kill Bill invoice" className="num">
                {invoice.killbill_invoice_id ?? '—'}
              </td>
            </tr>
          ))}
          {list.data !== null && list.data.invoices.length === 0 ? (
            <tr>
              <td className="empty" colSpan={9}>
                No invoices match.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="live" role="status" aria-label="Billing status" />
    </main>
  );
}
