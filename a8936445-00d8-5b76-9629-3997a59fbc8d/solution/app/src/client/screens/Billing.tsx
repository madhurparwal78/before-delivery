// Billing: the hour pack and its ledger, invoices with PDFs and payment, and the operator's invoice issue.
import { Download } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Booking, HourPack, Invoice, Ledger, Purchase, Tenant, User } from "../../shared/api";
import { INVOICE_STATUS_WORDS, LEDGER_REASON_WORDS } from "../../shared/kitchen";
import { dollars, hmm, kitchenParts, kitchenStamp } from "../../shared/time";
import { api, download, newIdempotencyKey, serverNow, type ApiFailure } from "../api";
import { loadTenants } from "../data";
import { BILLING_NOTHING_CHARGED, STORAGE_TRY_AGAIN, act, fieldError } from "../feedback";
import { EmptyRow, Eyebrow, Field, PendingLine, describedBy, nextFieldId } from "../ui/parts";

interface BillingData {
  tenants: Tenant[];
  packs: HourPack[];
  ledger: Ledger | null;
  invoices: Invoice[];
  refs: Map<string, string>;
}

export function BillingScreen({ user }: { user: User }) {
  const isOperator = user.role === "operator";
  const [data, setData] = useState<BillingData | null>(null);
  const [picked, setPicked] = useState(user.tenant_id ?? "");
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  const load = async (mode: "load" | "refresh", tenantId: string): Promise<void> => {
    const outcome = await act({ pending: mode === "load" ? "Loading…" : undefined }, async () => {
      const tenants = await loadTenants();
      const tenant = tenantId || tenants[0]?.id || "";
      const scope = isOperator ? `?tenant_id=${encodeURIComponent(tenant)}` : "";
      const [packs, ledger, invoices, bookings] = await Promise.all([
        api<{ packs: HourPack[] }>("GET", "/api/hour-packs"),
        tenant ? api<Ledger>("GET", `/api/hour-ledger${scope}`) : Promise.resolve(null),
        api<{ invoices: Invoice[] }>("GET", `/api/invoices${scope}`),
        api<{ bookings: Booking[] }>("GET", "/api/bookings"),
      ]);
      return {
        tenant,
        data: {
          tenants,
          packs: packs.packs,
          ledger,
          invoices: invoices.invoices,
          refs: new Map(bookings.bookings.map((b) => [b.id, b.ref])),
        },
      };
    });
    if (!outcome.ok) return;
    if (!pickedRef.current) setPicked(outcome.value.tenant);
    setData(outcome.value.data);
  };
  const refresh = (): void => void load("refresh", pickedRef.current);

  useEffect(() => void load("load", picked), []);

  const pick = (tenantId: string): void => {
    setPicked(tenantId);
    void load("refresh", tenantId);
  };

  const tenant = data?.tenants.find((t) => t.id === picked) ?? null;

  return (
    <div class="sheet">
      <PendingLine />
      <header class="screen-head">
        <h1 class="screen-title">Billing</h1>
        {tenant && <p class="tenant-status">{tenant.business_name}</p>}
      </header>
      {isOperator && data && <IssueForm tenants={data.tenants} picked={picked} onPick={pick} onIssued={refresh} />}
      <div class="billing-grid">
        <HourPackPanel data={data} isOwner={user.role === "owner"} onChange={refresh} />
        <InvoicesPanel invoices={data?.invoices ?? null} isOwner={user.role === "owner"} ownerEmail={tenant?.owner_email ?? ""} onChange={refresh} />
      </div>
    </div>
  );
}

function HourPackPanel({ data, isOwner, onChange }: { data: BillingData | null; isOwner: boolean; onChange: () => void }) {
  const attempts = useRef(new Map<string, string>());
  const [busy, setBusy] = useState<string | null>(null);
  const ledger = data?.ledger ?? null;

  const buy = async (pack: HourPack): Promise<void> => {
    if (busy) return;
    setBusy(pack.id);
    const key = attempts.current.get(pack.id) ?? newIdempotencyKey();
    attempts.current.set(pack.id, key);
    const outcome = await act(
      {
        pending: `Buying ${pack.name}…`,
        services: ["billing"],
        success: (p: Purchase) => `${pack.name} added. Balance: ${hmm(p.balance_minutes)}.`,
        error: (f) => (f.code === "billing_unavailable" ? "Billing is unreachable. Nothing was charged and your balance is unchanged." : null),
      },
      () => api<Purchase>("POST", "/api/hour-packs/purchase", { body: { pack_id: pack.id }, idempotencyKey: key }),
    );
    setBusy(null);
    if (outcome.ok || (outcome.failure.status !== 0 && outcome.failure.status < 500)) attempts.current.delete(pack.id);
    if (outcome.ok) onChange();
  };

  return (
    <section class="panel" aria-label="Hour pack">
      <Eyebrow n={1} label="Hour pack" />
      <header class="panel-head">
        <h2>Hour pack</h2>
        <p class="balance">
          {ledger ? `Balance ${hmm(ledger.balance_minutes)}` : "Balance —"}
        </p>
      </header>
      {isOwner && data && (
        <ul class="pack-list">
          {data.packs.map((pack) => (
            <li key={pack.id}>
              <span class="pack-terms">
                <span class="mono">{hmm(pack.minutes)}</span> hours for <span class="mono">{dollars(pack.price_cents)}</span>
              </span>
              <button type="button" class="btn" disabled={busy !== null} onClick={() => void buy(pack)}>
                Buy {pack.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Eyebrow n={2} label="Hour ledger" />
      <div class="table-wrap">
        <table class="data cards" role="table" aria-label="Hour ledger">
          <thead>
            <tr role="row">
              <th role="columnheader">When</th>
              <th role="columnheader">Movement</th>
              <th role="columnheader">Booking</th>
              <th role="columnheader" class="num">
                Minutes
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger?.entries.length === 0 && <EmptyRow columns={4} text="No hour-pack movements yet." />}
            {ledger?.entries.map((e) => (
              <tr role="row" key={e.id}>
                <td role="cell" data-label="When" class="mono">
                  {kitchenStamp(Date.parse(e.created_at))}
                </td>
                <td role="cell" data-label="Movement">
                  {LEDGER_REASON_WORDS[e.reason]}
                  <span class="cell-note">{e.account === "tenant_pack" ? "Tenant pack" : "Kitchen hours"}</span>
                </td>
                <td role="cell" data-label="Booking" class="mono">
                  {e.booking_id ? (data?.refs.get(e.booking_id) ?? "—") : "—"}
                </td>
                <td role="cell" data-label="Minutes" class="mono num">
                  {e.minutes > 0 ? "+" : "−"}
                  {hmm(Math.abs(e.minutes))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface InvoicesProps {
  invoices: Invoice[] | null;
  isOwner: boolean;
  ownerEmail: string;
  onChange: () => void;
}

function InvoicesPanel({ invoices, isOwner, ownerEmail, onChange }: InvoicesProps) {
  const attempts = useRef(new Map<string, string>());
  const [busy, setBusy] = useState<string | null>(null);

  const pay = async (invoice: Invoice): Promise<void> => {
    if (busy) return;
    setBusy(invoice.id);
    const key = attempts.current.get(invoice.id) ?? newIdempotencyKey();
    attempts.current.set(invoice.id, key);
    const outcome = await act(
      {
        pending: "Paying…",
        services: ["billing"],
        success: () => `Invoice ${invoice.number} paid. A receipt is queued for ${ownerEmail}.`,
        error: (f) => {
          if (f.code === "invoice_paid") return "This invoice is already paid.";
          if (f.code === "billing_unavailable") return BILLING_NOTHING_CHARGED;
          return null;
        },
      },
      () => api<Invoice>("POST", `/api/invoices/${invoice.id}/pay`, { body: {}, idempotencyKey: key }),
    );
    setBusy(null);
    if (outcome.ok || (outcome.failure.status !== 0 && outcome.failure.status < 500)) attempts.current.delete(invoice.id);
    onChange();
  };

  const pdf = (invoice: Invoice): void => {
    void act(
      {
        pending: "Preparing PDF…",
        services: ["storage"],
        error: (f) => (f.code === "storage_unavailable" ? STORAGE_TRY_AGAIN : null),
      },
      () => download(`/api/invoices/${invoice.id}/pdf`, `${invoice.number}.pdf`),
    );
  };

  return (
    <section class="panel">
      <Eyebrow n={3} label="Invoices" />
      <header class="panel-head">
        <h2>Invoices</h2>
      </header>
      <div class="table-wrap">
        <table class="data cards" role="table" aria-label="Invoices">
          <thead>
            <tr role="row">
              <th role="columnheader">Number</th>
              <th role="columnheader">Period</th>
              <th role="columnheader">Lines</th>
              <th role="columnheader" class="num">
                Subtotal
              </th>
              <th role="columnheader" class="num">
                Tax
              </th>
              <th role="columnheader" class="num">
                Total
              </th>
              <th role="columnheader">Status</th>
              <th role="columnheader">Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices?.length === 0 && <EmptyRow columns={8} text="No invoices yet." />}
            {invoices?.map((inv) => (
              <tr role="row" key={inv.id}>
                <td role="cell" data-label="Number" class="mono strong">
                  {inv.number}
                </td>
                <td role="cell" data-label="Period" class="mono">
                  {inv.period}
                </td>
                <td role="cell" data-label="Lines">
                  <ul class="invoice-lines">
                    {inv.lines.map((line, i) => (
                      <li key={i}>
                        <span>{line.description}</span> <span class="mono">{dollars(line.amount_cents)}</span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td role="cell" data-label="Subtotal" class="mono num">
                  {dollars(inv.subtotal_cents)}
                </td>
                <td role="cell" data-label="Tax" class="mono num">
                  {dollars(inv.tax_cents)} <span class="cell-note">{inv.tax_rate_percent}%</span>
                </td>
                <td role="cell" data-label="Total" class="mono num strong">
                  {dollars(inv.total_cents)}
                </td>
                <td role="cell" data-label="Status">
                  <span class={`status invoice-${inv.status}`}>{INVOICE_STATUS_WORDS[inv.status]}</span>
                </td>
                <td role="cell" data-label="Actions" class="row-actions">
                  <a
                    class="file-link"
                    href={`/api/invoices/${inv.id}/pdf`}
                    aria-label={`Download PDF ${inv.number}`}
                    onClick={(e) => {
                      e.preventDefault();
                      pdf(inv);
                    }}
                  >
                    <Download size={16} aria-hidden="true" />
                    PDF
                  </a>
                  {isOwner && inv.status === "issued" && (
                    <button
                      type="button"
                      class="btn btn-small btn-primary"
                      aria-label={`Pay invoice ${inv.number}`}
                      disabled={busy === inv.id}
                      onClick={() => void pay(inv)}
                    >
                      Pay
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface IssueProps {
  tenants: Tenant[];
  picked: string;
  onPick: (tenantId: string) => void;
  onIssued: () => void;
}

function IssueForm({ tenants, picked, onPick, onIssued }: IssueProps) {
  const [period, setPeriod] = useState(kitchenParts(serverNow()).date.slice(0, 7));
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useRef({ tenant: nextFieldId("bill-tenant"), period: nextFieldId("bill-period") }).current;

  const issue = async (event: Event): Promise<void> => {
    event.preventDefault();
    const business = tenants.find((t) => t.id === picked)?.business_name ?? picked;
    setBusy(true);
    const outcome = await act(
      {
        pending: "Issuing invoice…",
        services: ["billing", "storage"],
        success: (inv: Invoice) => `Invoice ${inv.number} issued. Its email notice is queued for ${business}.`,
        error: (f) => {
          if (f.code === "nothing_to_invoice") return `Nothing to invoice for ${period}.`;
          if (f.code === "billing_unavailable") return BILLING_NOTHING_CHARGED;
          if (f.code === "storage_unavailable") return "Document storage is unreachable. No invoice was issued; try again in a moment.";
          return null;
        },
      },
      () => api<Invoice>("POST", "/api/invoices", { body: { tenant_id: picked, period } }),
    );
    setBusy(false);
    setFailure(outcome.ok ? null : outcome.failure);
    if (outcome.ok) onIssued();
  };

  return (
    <form class="issue-form" aria-label="Issue invoice" onSubmit={(e) => void issue(e)}>
      <Field id={ids.tenant} label="Tenant" error={fieldError(failure, "tenant_id")}>
        <select id={ids.tenant} value={picked} onChange={(e) => onPick(e.currentTarget.value)}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.business_name}
            </option>
          ))}
        </select>
      </Field>
      <Field id={ids.period} label="Invoice month" error={fieldError(failure, "period")}>
        <input
          id={ids.period}
          type="month"
          class="mono"
          value={period}
          aria-describedby={describedBy(ids.period, fieldError(failure, "period"))}
          onInput={(e) => setPeriod(e.currentTarget.value)}
        />
      </Field>
      <button type="submit" class="btn btn-primary" disabled={busy || !picked}>
        Issue invoice
      </button>
    </form>
  );
}
