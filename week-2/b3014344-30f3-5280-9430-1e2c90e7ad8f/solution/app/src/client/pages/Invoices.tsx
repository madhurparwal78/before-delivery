import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api, downloadLink, RequestError } from "../lib/api";
import { Link } from "../lib/router";
import { COPY } from "../../shared/copy";
import { longDate, type Invoice } from "../../shared/domain";
import { money } from "../../shared/money";
import { FoldMotif } from "./FoldMotif";

const STATUS: Record<Invoice["status"], string> = { paid: "Paid", open: "Open", void: "Void", credit: "Credit" };

export function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<{ invoices: Invoice[] }>("/api/invoices")
      .then((body) => setInvoices(body.invoices))
      .catch(() => setFailed(true));
  }, []);

  const download = async (invoice: Invoice) => {
    setMessage("");
    try {
      const link = await api<{ url: string }>(`/api/invoices/${invoice.id}/links`, { body: {} });
      await downloadLink(link.url, `Pampero-invoice-${invoice.number}.pdf`);
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      setMessage(
        error.code === "link_expired" ? COPY.linkExpired : error.code === "storage_unavailable" || error.status === 0 ? COPY.storageUpload : error.body.message,
      );
    }
  };

  return (
    <div className="ledger-page">
      <p className="eyebrow">Invoices</p>
      <h1>Invoices</h1>
      <p className="muted">Read from billing each time you open this page, newest first.</p>
      {failed ? <p className="notice notice--seam">Billing is unreachable, so we can't show your invoices right now.</p> : null}
      {invoices && invoices.length === 0 ? (
        <div className="empty">
          <FoldMotif />
          <p>No invoices yet. Your first one appears when you pay a deposit or start a care plan.</p>
        </div>
      ) : null}
      {invoices && invoices.length ? (
        <div className="table-frame">
          <table className="ledger-table" aria-label="Invoices">
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Status</th>
                <th scope="col">PDF</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="mono">{invoice.number}</td>
                  <td className="mono">{longDate(invoice.date)}</td>
                  <td>
                    {invoice.description}
                    {invoice.kind === "balance" && invoice.status === "open" && invoice.orderId ? (
                      <>
                        {" "}
                        <Link href={`/checkout/${invoice.orderId}`} className="button button--primary button--small">Pay launch balance</Link>
                      </>
                    ) : null}
                  </td>
                  <td className="num mono">
                    {money(invoice.amount, invoice.currency)}
                    {invoice.status === "open" && invoice.balance !== invoice.amount ? (
                      <span className="cell-note">{money(invoice.balance, invoice.currency)} due</span>
                    ) : null}
                  </td>
                  <td><span className={`pill pill--${invoice.status}`}>{STATUS[invoice.status]}</span></td>
                  <td>
                    {invoice.pdf ? (
                      <button type="button" className="button button--secondary button--small" aria-label={`Download invoice ${invoice.number}`} onClick={() => download(invoice)}>
                        <Download aria-hidden="true" size={16} />
                        Download
                      </button>
                    ) : (
                      <span className="muted">Preparing</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p role="status" aria-label="Download status" className="live">{message}</p>
    </div>
  );
}
