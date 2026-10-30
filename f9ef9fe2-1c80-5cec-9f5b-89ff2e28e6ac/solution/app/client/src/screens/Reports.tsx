import { useEffect, useState } from "react";
import { call } from "../api";
import { dollars, monthName } from "../format";
import { useSession } from "../session";
import type { Invoice, UsageReport } from "../types";
import { type FormState, FormStatus, Page, Table } from "./common";

type ReportInvoice = UsageReport["invoices"][number];

export function ReportsScreen() {
  const { kitchen } = useSession();
  const [month, setMonth] = useState(kitchen.today.slice(0, 7));
  const [report, setReport] = useState<UsageReport | null>(null);
  const [amounts, setAmounts] = useState<Map<string, number | null>>(new Map());
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let alive = true;
    setForm({ text: "Loading report…", tone: "info" });
    void (async () => {
      const [r, invoices] = await Promise.all([
        call<UsageReport>("GET", `/api/kitchens/${kitchen.id}/reports/usage?month=${month}`),
        call<{ invoices: Invoice[] }>("GET", "/api/invoices"),
      ]);
      if (!alive) return;
      if (!r.ok) {
        setForm({ text: r.error.message, tone: "error" });
        return;
      }
      setReport(r.data);
      if (invoices.ok) setAmounts(new Map(invoices.data.invoices.map((i) => [i.id, i.billing_amount_cents])));
      const empty = r.data.invoices.length === 0 && r.data.totals.booked_hours === "0.00";
      setForm(empty ? { text: `No bookings in ${monthName(month)}.`, tone: "info" } : null);
    })();
    return () => {
      alive = false;
    };
  }, [month, kitchen.id]);

  const billing = (i: ReportInvoice): string => {
    const cents = amounts.get(i.invoice_id);
    if (i.killbill_invoice_id === null) return "—";
    return cents === null || cents === undefined ? "unreachable" : dollars(cents);
  };

  return (
    <Page title="Reports">
      <div className="toolbar">
        <label className="field inline">
          <span>Month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
        {report && (
          <a className="text-link button-link" href={`/api/kitchens/${kitchen.id}/reports/usage.csv?month=${report.month}`} download>
            Download CSV
          </a>
        )}
      </div>
      <FormStatus state={form} />
      {report && (
        <>
          <p className="report-summary">
            <span>{report.kitchen.name}</span> · <span>{monthName(report.month)}</span> · <span className="num">{report.totals.booked_hours} h</span> booked ·{" "}
            <span className="num">{dollars(report.totals.billed_cents)}</span> billed · <span className="num">{dollars(report.totals.refunded_cents)}</span> refunded
          </p>
          <h2 className="section-title">Usage by member</h2>
          <Table
            label="Usage by member"
            rows={report.members}
            rowKey={(m) => m.member_id}
            empty="No members."
            columns={[
              { label: "Business", cell: (m: UsageReport["members"][number]) => <span className="business">{m.business}</span> },
              { label: "Booked hours", numeric: true, cell: (m) => m.booked_hours },
              { label: "Cancelled in window hours", numeric: true, cell: (m) => m.cancelled_in_window_hours },
              { label: "Billed", numeric: true, cell: (m) => dollars(m.billed_cents) },
              { label: "Refunded", numeric: true, cell: (m) => dollars(m.refunded_cents) },
              { label: "Pack balance", numeric: true, cell: (m) => `${m.pack_balance_hours} h` },
            ]}
          />
          <h2 className="section-title">Station occupancy</h2>
          <Table
            label="Station occupancy"
            rows={report.stations}
            rowKey={(s) => s.station_id}
            empty="No stations."
            columns={[
              { label: "Station", cell: (s: UsageReport["stations"][number]) => s.name },
              { label: "Booked hours", numeric: true, cell: (s) => s.booked_hours },
            ]}
          />
          <h2 className="section-title">Invoices</h2>
          <Table
            label="Invoices"
            rows={report.invoices}
            rowKey={(i) => i.invoice_id}
            empty={`No invoices issued in ${monthName(report.month)}.`}
            columns={[
              { label: "Invoice", cell: (i: ReportInvoice) => <span className="num">{i.ref}</span> },
              { label: "Kind", cell: (i) => `${i.kind} · ${i.business}` },
              { label: "Issued", cell: (i) => <span className="num">{i.issued_on}</span> },
              { label: "Total", numeric: true, cell: (i) => dollars(i.total_cents) },
              { label: "Billing invoice", cell: (i) => <span className="num id">{i.killbill_invoice_id ?? "—"}</span> },
              { label: "Billing amount", numeric: true, cell: billing },
            ]}
          />
        </>
      )}
    </Page>
  );
}
