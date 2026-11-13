import { useCallback, useEffect, useState } from "react";
import { Placeholder } from "./Placeholder";
import { OFFLINE_COPY, api } from "./api";
import { REFRESH_MS, useInterval } from "./motion";
import type { Invoice } from "./types";
import { useSearch } from "./useSearch";

const KIND = { interpreting: "Interpreting", late_cancellation: "Late cancellation" } as const;

/** Every charge the viewer may see, newest first, searchable by reference and exportable as CSV. */
export function Invoices() {
  const search = useSearch();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await api<{ invoices: Invoice[] }>("GET", `/api/invoices?q=${encodeURIComponent(search.query)}`);
    if (result.ok) {
      setInvoices(result.data.invoices);
      setMessage("");
    } else setMessage(result.error?.message ?? OFFLINE_COPY);
  }, [search.query]);
  useEffect(() => void load(), [load]);
  useInterval(() => void load(), REFRESH_MS);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Invoices</h1>
        <a className="button" href={`/api/invoices.csv?q=${encodeURIComponent(search.query)}`} download>
          Export CSV
        </a>
      </div>
      <div className="search-row">
        <input
          type="search"
          className="input search"
          aria-label="Search invoices"
          placeholder="Reference"
          value={search.text}
          onChange={(e) => search.onChange(e.target.value)}
          onKeyDown={search.onKeyDown}
        />
      </div>
      <p className="live live--alert" role="status" aria-label="Billing status">
        {message}
      </p>
      {invoices === null ? (
        <Placeholder />
      ) : (
        <div className="table-scroll" role="region" aria-label="Invoices, scrollable" tabIndex={0}>
          <table className="data-table stack" aria-label="Invoices">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Organisation</th>
                <th scope="col">Kind</th>
                <th scope="col" className="numeric">
                  Billable minutes
                </th>
                <th scope="col" className="numeric">
                  Seats
                </th>
                <th scope="col" className="numeric">
                  Rate
                </th>
                <th scope="col" className="numeric">
                  Amount
                </th>
                <th scope="col">Billing status</th>
                <th scope="col">Kill Bill invoice</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td data-label="Reference" className="num">
                    {i.request_reference}
                  </td>
                  <td data-label="Organisation">{i.organisation.name}</td>
                  <td data-label="Kind" className={i.kind === "late_cancellation" ? "alert-text" : undefined}>
                    {KIND[i.kind]}
                  </td>
                  <td data-label="Billable minutes" className="num numeric">
                    {i.billable_minutes}
                  </td>
                  <td data-label="Seats" className="num numeric">
                    {i.seats}
                  </td>
                  <td data-label="Rate" className="num numeric">
                    ${i.hourly_rate}
                  </td>
                  <td data-label="Amount" className="num numeric">
                    ${i.amount}
                  </td>
                  <td data-label="Billing status">
                    <span className={`billing-status billing-status--${i.billing_status}`}>{i.billing_status === "posted" ? "Posted" : "Invoice pending"}</span>
                  </td>
                  <td data-label="Kill Bill invoice" className="num invoice-id">
                    {i.killbill_invoice_id ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {invoices?.length === 0 && <p className="empty">{search.query ? `No invoice matches “${search.query}”.` : "No invoices yet."}</p>}
    </div>
  );
}
