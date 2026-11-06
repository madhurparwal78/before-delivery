import { useCallback, useEffect, useState } from "react";
import { call, idempotencyKey } from "../api";
import { dollars, hoursText, kitchenDay } from "../format";
import { usePaused, useSession } from "../session";
import type { Booking, Invoice, Movement, Pack } from "../types";
import { type FormState, FormStatus, Page, Table } from "./common";
import { InvoiceDetail } from "./InvoiceDetail";

const billingAmount = (invoice: Invoice): string =>
  invoice.billing_amount_cents === null ? (invoice.killbill_invoice_id === null ? "—" : "unreachable") : dollars(invoice.billing_amount_cents);

export function BillingScreen() {
  const { user, kitchen } = useSession();
  const memberId = user.member_id ?? "";
  const [pack, setPack] = useState<Pack | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [refs, setRefs] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [buying, setBuying] = useState(false);
  const paused = usePaused("buy_pack");

  const load = useCallback(async () => {
    const [p, i, b] = await Promise.all([
      call<Pack>("GET", `/api/members/${memberId}/pack`),
      call<{ invoices: Invoice[] }>("GET", "/api/invoices"),
      call<{ bookings: Booking[] }>("GET", "/api/bookings"),
    ]);
    setLoading(false);
    if (p.ok) setPack(p.data);
    if (i.ok) setInvoices(i.data.invoices);
    if (b.ok) setRefs(new Map(b.data.bookings.map((x) => [x.id, x.ref])));
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = (): void => {
    setBuying(true);
    setForm({ text: "Adding pack…", tone: "info" });
    void (async () => {
      const result = await call<{ balance_quarters: number }>("POST", `/api/members/${memberId}/packs`, {}, { "Idempotency-Key": idempotencyKey() });
      setBuying(false);
      if (result.ok) {
        setForm({ text: `20-hour pack added. Balance ${hoursText(result.data.balance_quarters)} hours.`, tone: "success" });
        void load();
      } else {
        setForm({
          text: result.error.error === "billing_unavailable" ? "Billing is unreachable. Pack purchases are paused; try again shortly." : result.error.message,
          tone: "error",
        });
      }
    })();
  };

  let running = 0;
  const movements = (pack?.movements ?? []).map((m) => {
    running += m.entries.find((e) => e.account === "member_pack")?.quarters ?? 0;
    return { movement: m, after: running };
  });
  const opened = invoices.find((i) => i.id === open) ?? null;

  return (
    <Page title="Billing">
      <section className="balance">
        <h2>Pack balance</h2>
        <p className="figure">{pack ? `${pack.balance_hours} hours` : "…"}</p>
        <button type="button" className="primary" disabled={buying || paused} onClick={buy}>
          Buy 20-hour pack
        </button>
      </section>
      <FormStatus state={form} />
      <h2 className="section-title">Pack movements</h2>
      <Table
        label="Pack movements"
        loading={loading}
        rows={movements}
        rowKey={(r) => r.movement.id}
        empty="No pack movements yet."
        columns={[
          { label: "Date", cell: (r: { movement: Movement; after: number }) => <span className="num">{kitchenDay(r.movement.created_at, kitchen.timezone)}</span> },
          { label: "Kind", cell: (r) => r.movement.kind },
          { label: "Hours", numeric: true, cell: (r) => `${r.movement.kind === "draw" ? "−" : "+"}${hoursText(r.movement.quarters)}` },
          { label: "Booking", cell: (r) => <span className="num">{r.movement.booking_id ? (refs.get(r.movement.booking_id) ?? "—") : "—"}</span> },
          { label: "Balance after", numeric: true, cell: (r) => hoursText(r.after) },
        ]}
      />
      {/* Invoices appear once loaded, so the movement rows never push them down. */}
      {!loading && (
        <>
          <h2 className="section-title">Invoices</h2>
          <Table
            label="Invoices"
            rows={invoices}
            rowKey={(i) => i.id}
            empty="No invoices yet."
            columns={[
              {
                label: "Invoice",
                cell: (i: Invoice) => (
                  <button type="button" className="link-button num" aria-expanded={open === i.id} onClick={() => setOpen(i.id)}>
                    {i.ref}
                  </button>
                ),
              },
              { label: "Kind", cell: (i) => i.kind },
              { label: "Issued", cell: (i) => <span className="num">{kitchenDay(i.issued_at, kitchen.timezone)}</span> },
              { label: "Total", numeric: true, cell: (i) => <span className="owed">{i.total}</span> },
              { label: "Billing invoice", cell: (i) => <span className="num id">{i.killbill_invoice_id ?? "—"}</span> },
              { label: "Billing amount", numeric: true, cell: (i) => billingAmount(i) },
            ]}
          />
        </>
      )}
      {opened && <InvoiceDetail invoice={opened} />}
    </Page>
  );
}
