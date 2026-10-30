import { dollars } from "../format";
import { useSession } from "../session";
import type { Invoice } from "../types";
import { kitchenDateTime } from "../format";

/** An invoice's priced lines beside the billing system's id and amount for it. */
export function InvoiceDetail({ invoice }: { invoice: Invoice }) {
  const { kitchen } = useSession();
  return (
    <section role="region" aria-label={`Invoice ${invoice.ref}`} className="detail invoice-detail">
      <h3 className="num">{invoice.ref}</h3>
      <ul className="quote-lines" aria-label="Invoice lines">
        {invoice.lines.map((line, i) =>
          "station_id" in line ? (
            <li key={`${line.station_id}-${line.tier}-${line.paid_by}-${i}`}>
              <span className="line-station">{line.station}</span>
              <span className="num">tier {line.tier}</span>
              <span className="num">{line.hours} h</span>
              <span className="num amount">{line.paid_by === "pack" ? "pack" : dollars(line.amount_cents)}</span>
            </li>
          ) : (
            <li key={`${line.description}-${i}`}>
              <span className="line-station">{line.description}</span>
              <span />
              <span />
              <span className="num amount">{dollars(line.amount_cents)}</span>
            </li>
          ),
        )}
      </ul>
      <dl className="summary">
        <dt>Total</dt>
        <dd className="num owed">{invoice.total}</dd>
        <dt>Issued</dt>
        <dd className="num">{kitchenDateTime(invoice.issued_at, kitchen.timezone)}</dd>
        <dt>Billing invoice</dt>
        <dd className="num">{invoice.killbill_invoice_id ?? "None (nothing charged)"}</dd>
        <dt>Billing amount</dt>
        <dd className="num">
          {invoice.billing_amount_cents === null
            ? invoice.killbill_invoice_id === null
              ? "$0.00"
              : "Billing is unreachable"
            : dollars(invoice.billing_amount_cents)}
        </dd>
      </dl>
    </section>
  );
}
