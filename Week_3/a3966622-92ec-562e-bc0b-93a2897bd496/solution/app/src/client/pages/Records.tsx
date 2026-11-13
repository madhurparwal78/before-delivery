// Single records: a ladder report, an invoice, and the not-found page shared by both.
import { useEffect, useState } from "react";
import { DEFECTS, type Invoice, type LadderReport } from "../../shared/types";
import { get } from "../api";
import { navigate } from "../router";
import { useSession } from "../session";
import { Shell } from "../ui/Chrome";
import { clockOf, dateTimeOf, dollars } from "../ui/format";
import { NotFound } from "./NotFound";

export function ReportPage({ id }: { id: string }) {
  const [report, setReport] = useState<LadderReport | null | "missing">(null);
  useEffect(() => {
    void get<LadderReport>(`/api/ladder-reports/${encodeURIComponent(id)}`).then((o) => setReport(o.kind === "ok" ? o.data : "missing"));
  }, [id]);
  if (report === "missing") return <NotFound />;
  return (
    <Shell>
      {report === null ? (
        <p className="muted">Loading report…</p>
      ) : (
        <article className="record">
          <h1>Ladder report {report.id}</h1>
          {report.refused ? <h2 className="alarm">Boarding refused at ladder</h2> : null}
          <dl className="facts">
            <div>
              <dt>Move</dt>
              <dd>
                <a href={`/moves/${encodeURIComponent(report.move_ref)}`} onClick={(e) => { e.preventDefault(); navigate(`/moves/${encodeURIComponent(report.move_ref)}`); }}>
                  {report.move_ref}
                </a>
              </dd>
            </div>
            <div>
              <dt>Ladder</dt>
              <dd className={report.compliant ? undefined : "short"}>{report.compliant ? "Compliant" : "Non-compliant"}</dd>
            </div>
            <div>
              <dt>Filed from</dt>
              <dd>{report.location === "deck" ? "Deck" : "Pilot boat"}</dd>
            </div>
            <div>
              <dt>Filed</dt>
              <dd>
                <span className="num">{dateTimeOf(report.filed_at)}</span> by {report.filed_by}
              </dd>
            </div>
          </dl>
          <h2>Defects</h2>
          {report.defects.length ? (
            <ul className="rows">
              {report.defects.map((code) => (
                <li key={code} className="row">
                  {DEFECTS.find((d) => d.code === code)?.name ?? code}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No defects</p>
          )}
          {report.note ? <p className="note">{report.note}</p> : null}
          <h2>Photos</h2>
          {report.photos.length ? (
            <ul className="photo-grid">
              {report.photos.map((p, i) => (
                <li key={p.photo_id}>
                  <img src={`/api/photos/${encodeURIComponent(p.photo_id)}/content`} alt={`Ladder photo ${i + 1}`} width="160" height="120" />
                  <a href={`/api/photos/${encodeURIComponent(p.photo_id)}/content`} download>
                    Download photo {i + 1}
                  </a>
                  <span className="num hash">SHA-256 {p.sha256}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No photos with this report</p>
          )}
        </article>
      )}
    </Shell>
  );
}

export function InvoicePage({ id }: { id: string }) {
  const { services } = useSession();
  const [invoice, setInvoice] = useState<Invoice | null | "missing">(null);
  useEffect(() => {
    void get<Invoice>(`/api/invoices/${encodeURIComponent(id)}`).then((o) => setInvoice(o.kind === "ok" ? o.data : "missing"));
  }, [id]);
  if (invoice === "missing") return <NotFound />;
  return (
    <Shell>
      {invoice === null ? (
        <p className="muted">Loading invoice…</p>
      ) : (
        <article className="record">
          <h1>Invoice {invoice.id}</h1>
          {invoice.state === "pending" ? <p className="pending-text">Invoice pending provider confirmation</p> : null}
          <dl className="facts">
            <div>
              <dt>State</dt>
              <dd>{invoice.state === "issued" ? "Issued" : "Pending"}</dd>
            </div>
            <div>
              <dt>Number</dt>
              <dd className="num">{invoice.number ?? "-"}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd className="num">{invoice.balance_cents === null ? "-" : dollars(invoice.balance_cents)}</dd>
            </div>
            <div>
              <dt>Move</dt>
              <dd>{invoice.move_ref}</dd>
            </div>
            <div>
              <dt>Charges</dt>
              <dd>{invoice.charge_state === "posted" ? "Charges posted" : "Charges pending"}</dd>
            </div>
          </dl>
          {invoice.state === "issued" && services?.billing === "down" && invoice.balance_confirmed_at ? (
            <p className="muted">Balance last confirmed {clockOf(invoice.balance_confirmed_at)} port time</p>
          ) : null}
          <table className="mini">
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Quantity</th>
                <th scope="col">Unit</th>
                <th scope="col">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, i) => (
                <tr key={`${l.label}-${i}`}>
                  <th scope="row">{l.label}</th>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{dollars(l.unit_cents)}</td>
                  <td className="num">{dollars(l.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Total, priced by {invoice.lines[0]?.tariff_revision ?? ""}
                </th>
                <td className="num">{dollars(invoice.total_cents)}</td>
              </tr>
            </tfoot>
          </table>
        </article>
      )}
    </Shell>
  );
}
