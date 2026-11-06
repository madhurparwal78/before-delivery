// Portal invoice (brief: Owner portal › Invoice; Interactions › Portal invoice page): lines, totals,
// payment status and the outstanding line, re-read every 10 s and each change announced once.
import type { Invoice } from "../../shared/api.js";
import { parseDecimal } from "../../shared/decimal.js";
import { LINE_KIND_LABEL } from "../../shared/domain.js";
import { formatMoment } from "../../shared/zurich.js";
import { get } from "../api.js";
import { applyInPlace, useLoad, usePoll } from "../hooks.js";
import { chf, invoiceStatusLabel, outstandingLine } from "../labels.js";
import { NotFound } from "../ui/NotFound.js";
import { StatusRegion, useNote } from "../ui/Feedback.js";

/** Whether `next` is a smaller amount than `previous` (both two-decimal strings). */
function fell(previous: string, next: string): boolean {
  const a = parseDecimal(previous);
  const b = parseDecimal(next);
  return a !== null && b !== null && b.num * a.den < a.num * b.den;
}

/** The re-read announcement for a changed invoice, or null when nothing worth saying changed. */
function changeCopy(previous: Invoice, next: Invoice): string | null {
  if (previous.status === "awaiting_payment" && next.status === "paid") return `Invoice ${next.number} is paid.`;
  if (previous.status === "paid" && next.status === "awaiting_payment")
    return `Invoice ${next.number} is awaiting payment again. ${chf(next.balance)} outstanding.`;
  if (next.status === "awaiting_payment" && fell(previous.balance, next.balance)) return `Payment received. ${chf(next.balance)} outstanding.`;
  return null;
}

export function PortalInvoice({ invoiceId }: { invoiceId: string }): JSX.Element {
  const { data: invoice, setData: setInvoice, missing } = useLoad(
    () => get<{ invoice: Invoice }>(`/api/invoices/${invoiceId}`, true).then((answer) => answer.invoice),
    [invoiceId],
  );
  const [note, say] = useNote();

  usePoll(
    async () => {
      if (!invoice) return;
      const fresh = (await get<{ invoice: Invoice }>(`/api/invoices/${invoiceId}`)).invoice;
      if (JSON.stringify(fresh) === JSON.stringify(invoice)) return;
      const copy = changeCopy(invoice, fresh);
      applyInPlace(() => setInvoice(fresh));
      if (copy) say(copy);
    },
    10_000,
    invoice !== null,
  );

  if (missing) return <NotFound />;
  if (!invoice) return <div className="screen placeholder" aria-hidden="true" />;

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>
          Invoice <span className="mono-text">{invoice.number}</span>
        </h1>
        <StatusRegion name="Invoice updates" note={note} />
      </header>
      <div className="invoice-sheet">
        <p className="identity-sub">{invoice.car.name}</p>
        <p className="invoice-status">
          <span className={invoice.status === "paid" ? "badge" : "badge badge-alert"}>{invoiceStatusLabel(invoice)}</span>
        </p>
        {invoice.status === "awaiting_payment" ? (
          <p className="outstanding mono-text" role="group" aria-label="Outstanding">
            {outstandingLine(invoice)}
          </p>
        ) : null}
        <table aria-label="Invoice lines" className="table lines-table">
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col" className="numeric">
                Qty
              </th>
              <th scope="col" className="numeric">
                Net
              </th>
              <th scope="col" className="numeric">
                VAT
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.description}
                  <span className="sub">
                    {`${LINE_KIND_LABEL[line.kind]} · `}
                    <span className="mono-text amount">{chf(line.unit_price)}</span>
                  </span>
                </td>
                <td className="numeric mono-text">{line.quantity}</td>
                <td className="numeric mono-text">{line.net}</td>
                <td className="numeric mono-text">{line.vat}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="totals">
          <div>
            <dt>Net</dt>
            <dd className="mono-text">{chf(invoice.net_total)}</dd>
          </div>
          <div>
            <dt>VAT 8.1%</dt>
            <dd className="mono-text">{chf(invoice.vat_total)}</dd>
          </div>
          <div>
            <dt>Rounding</dt>
            <dd className="mono-text">{chf(invoice.rounding)}</dd>
          </div>
          <div className="total-row">
            <dt>Total</dt>
            <dd className="mono-text">{chf(invoice.total)}</dd>
          </div>
        </dl>
        <h2 className="section-heading">Payments</h2>
        {invoice.payments.length === 0 ? <p className="empty">No payments received yet.</p> : null}
        <ul className="plain-list ruled-list">
          {invoice.payments.map((payment, index) => (
            <li key={`${payment.at}-${index}`}>
              <span className="mono-text">{chf(payment.amount)}</span>
              <span className="mono-text">{formatMoment(payment.at)}</span>
              {payment.reference ? <span className="sub mono-text">{payment.reference}</span> : null}
              {payment.refunded !== "0.00" ? <span className="sub">{`Refunded ${chf(payment.refunded)}`}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
