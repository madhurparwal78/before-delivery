// `/c/<commission id>` — the commission overview for its client and the producer.
import { useEffect, useState } from "react";
import { INSTALLATIONS } from "../../shared/catalog";
import { formatDay, percent, usd } from "../../shared/format";
import { CueLine } from "../components/CueLine";
import { PaymentSheet } from "../components/Pay";
import { AppLink } from "../components/Shell";
import { HttpError, call } from "../lib/api";
import { onEvent } from "../lib/events";
import { toast } from "../lib/notices";
import { useLocation } from "../lib/router";
import { hasRole, useSession } from "../lib/session";
import { stage } from "../stage/state";
import { Badge, CommissionLinks, Failed, Missing, Skeleton, failureText, useLoad, useScene, type Commission, type Milestone } from "./common";

interface Document { id: string; kind: string; version: number; label: string; status: string; sizeBytes: number | null; sha256: string | null; issuedAt: string | null }
interface LedgerEntry { id: string; payerName: string; label: string; amountCents: number; killbillPaymentId: string; at: string }

const TRANSITION_TOAST: Record<string, string> = {
  concept_approved: "Concept approved.", fabricating: "Fabrication started.", installed: "Installation confirmed.",
  accepted: "Acceptance signed.", cancelled: "Commission cancelled.",
};

/** Moves the commission and says so in Notices; a refused move says why. */
export async function moveCommission(id: string, to: string): Promise<boolean> {
  try {
    await call(`/api/commissions/${id}/transitions`, { json: { to } });
    toast(TRANSITION_TOAST[to]);
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) toast("That step isn't available yet.");
    else if (!(error instanceof HttpError && error.code === "signed_out")) toast(failureText(error));
    return false;
  }
}


function FundersEditor({ c, onSaved }: { c: Commission; onSaved: () => void }) {
  const lead = c.funders.find((f) => f.kind === "client");
  interface Row { id: string | null; kind: "client" | "sponsor"; name: string; email: string; share: string }
  const [rows, setRows] = useState<Row[]>(() => [
    { id: lead?.id ?? null, kind: "client", name: "", email: "", share: percent(lead?.bp ?? 10_000) },
    ...c.funders.filter((f) => f.kind === "sponsor").map((f): Row => ({ id: f.id, kind: "sponsor", name: f.name, email: f.email, share: percent(f.bp) })),
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toBp = (share: string): number => {
    const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(share.trim());
    return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : Number.NaN;
  };

  const save = async (): Promise<void> => {
    setErrors({});
    try {
      await call(`/api/commissions/${c.id}/funders`, {
        method: "PUT",
        json: { funders: rows.map((r) => (r.kind === "client" ? { kind: "client", bp: toBp(r.share) } : { kind: "sponsor", name: r.name, email: r.email, bp: toBp(r.share) })) },
      });
      toast("Funders saved. Invites are on their way.");
      onSaved();
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) {
        setErrors(error.errors);
        toast(Object.values(error.errors)[0] ?? "");
      } else if (error instanceof HttpError && error.code === "funders_locked") toast("Funders are locked once a sponsor accepts or the deposit is paid.");
      else toast(failureText(error));
    }
  };

  const action = async (funderId: string, method: "POST" | "DELETE", done: string): Promise<void> => {
    try {
      await call(`/api/funders/${funderId}/invite`, { method });
      toast(done);
      onSaved();
    } catch (error) {
      toast(failureText(error));
    }
  };

  return (
    <div className="stack">
      {errors.funders && <p className="field-error">{errors.funders}</p>}
      {rows.map((r, i) => (
        <div key={i} className="panel stack">
          <p className="eyebrow">{r.kind === "client" ? "Lead client" : `Sponsor ${i}`}</p>
          {r.kind === "sponsor" && (
            <>
              <div className="field">
                <label htmlFor={`sponsor-name-${i}`}>Sponsor name</label>
                <input id={`sponsor-name-${i}`} className="input" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                {errors[`funders[${i}].name`] && <p className="field-error">{errors[`funders[${i}].name`]}</p>}
              </div>
              <div className="field">
                <label htmlFor={`sponsor-email-${i}`}>Sponsor email</label>
                <input id={`sponsor-email-${i}`} className="input" type="email" value={r.email} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
                {errors[`funders[${i}].email`] && <p className="field-error">{errors[`funders[${i}].email`]}</p>}
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor={`share-${i}`}>Share percent</label>
            <input id={`share-${i}`} className="input" inputMode="decimal" value={r.share} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, share: e.target.value } : x)))} />
            {errors[`funders[${i}].bp`] && <p className="field-error">{errors[`funders[${i}].bp`]}</p>}
          </div>
          {r.kind === "sponsor" && r.id && (
            <div className="row-actions">
              <button type="button" className="button" onClick={() => void action(r.id as string, "POST", "Invite sent again.")}>Resend invite</button>
              <button type="button" className="button graphite" onClick={() => void action(r.id as string, "DELETE", "Invite revoked.")}>Revoke invite</button>
            </div>
          )}
        </div>
      ))}
      <div className="row-actions">
        <button type="button" className="button" disabled={rows.length >= 4} onClick={() => setRows([...rows, { id: null, kind: "sponsor", name: "", email: "", share: "0.00" }])}>Add sponsor</button>
        <button type="button" className="button primary" onClick={() => void save()}>Save funders</button>
      </div>
    </div>
  );
}

export function Overview({ id }: { id: string }) {
  useScene("working");
  const { state } = useLocation();
  const { me } = useSession();
  const [load, reload] = useLoad<Commission>(`/api/commissions/${id}`);
  const [documents, reloadDocuments] = useLoad<{ documents: Document[] }>(`/api/commissions/${id}/documents`);
  const [ledger, reloadLedger] = useLoad<{ entries: LedgerEntry[] }>(`/api/commissions/${id}/ledger`);
  const [paying, setPaying] = useState<Milestone | null>(null);
  const roomReady = (state as { roomReady?: boolean } | null)?.roomReady === true;

  useEffect(() => {
    if (load.status !== "ready") return;
    const c = load.data;
    stage.set({ roomW: c.room.widthM, roomD: c.room.depthM, silhouette: c.installationType });
  }, [load]);

  useEffect(() => onEvent((event, data) => {
    if (data.commissionId === id && (event === "commission.updated" || event === "payment.confirmed")) {
      void reload();
      void reloadLedger();
      void reloadDocuments();
    }
  }), [id, reload, reloadLedger, reloadDocuments]);

  if (load.status === "missing") return <Missing />;
  if (load.status === "failed") return <Failed message={load.message} />;
  if (load.status === "loading") return <main className="column wide"><Skeleton rows={5} /></main>;
  const c = load.data;
  const producer = hasRole(me, "producer");
  const owner = me?.id === c.clientId;
  const refreshAll = (): void => {
    void reload();
    void reloadLedger();
    void reloadDocuments();
  };
  const move = async (to: string): Promise<void> => {
    if (await moveCommission(c.id, to)) refreshAll();
  };
  const payable = owner ? c.milestones.find((m) => m.id && ["invoiced", "failed", "payment_pending", "retried"].includes(m.state) && m.label !== "Deposit") : undefined;

  return (
    <main className="column wide">
      <header className="page-head">
        <p className="eyebrow">{INSTALLATIONS[c.installationType].label} · {c.venue.name}, {c.venue.city}</p>
        {roomReady ? <CueLine text="Your room is ready." cursor={false} /> : <h1>{c.title}</h1>}
        {roomReady && <h2>{c.title}</h2>}
        <div className="row-actions">
          <Badge state={c.state} on />
          {c.installDay && <span className="badge">Install day {formatDay(c.installDay.date)}</span>}
        </div>
        {roomReady && <div className="row-actions"><AppLink href={`/c/${c.id}/preview`} className="button primary">Get a concept preview</AppLink></div>}
      </header>

      <div className="row-actions">
        {owner && c.state === "contracted" && <button type="button" className="button primary" onClick={() => void move("concept_approved")}>Approve concept</button>}
        {owner && c.state === "installed" && <button type="button" className="button primary" onClick={() => void move("accepted")}>Sign acceptance</button>}
        {producer && c.state === "concept_approved" && <button type="button" className="button primary" onClick={() => void move("fabricating")}>Start fabrication</button>}
        {producer && c.state === "fabricating" && <button type="button" className="button" onClick={() => void move("installed")}>Confirm installation</button>}
        {payable && <button type="button" className="button primary" onClick={() => setPaying(payable)}>Pay {payable.label} {usd(payable.amountCents)}</button>}
        {producer && ["briefed", "previewed", "placed", "held", "contracted", "concept_approved"].includes(c.state) && (
          <button type="button" className="button graphite" onClick={() => void move("cancelled")}>Cancel commission</button>
        )}
      </div>

      <section className="section" aria-labelledby="milestones-title">
        <h2 id="milestones-title">Milestones</h2>
        <p className="table-hint">Scroll the table sideways for every column →</p>
        <div className="table-wrap" role="region" aria-label="Milestones table" tabIndex={0}>
          <table aria-label="Milestones">
            <thead><tr><th>Milestone</th><th className="num">Amount</th><th>Due</th><th>State</th><th>Invoice</th></tr></thead>
            <tbody>
              {c.milestones.map((m) => (
                <tr key={m.label}>
                  <td>{m.label} <span className="muted">({percent(m.scheduleBp)}%)</span></td>
                  <td className="num">{usd(m.amountCents)}</td>
                  <td>{m.dueText ?? "—"}</td>
                  <td><Badge state={m.state} on={m.state === "paid"} /></td>
                  <td>{m.documentId ? <a href={`/api/documents/${m.documentId}/pdf`} target="_blank" rel="noreferrer">Invoice PDF</a> : <span className="muted">Not yet invoiced</span>}</td>
                </tr>
              ))}
              {!c.milestones.length && <tr><td colSpan={5} className="muted">The schedule appears once the quote is saved.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" aria-labelledby="documents-title">
        <h2 id="documents-title">Documents</h2>
        {documents.status === "ready" ? (
          <ul className="list" aria-label="Documents">
            {documents.data.documents.map((d) => (
              <li key={d.id}>
                <div className="section-head">
                  <span>{d.label}</span>
                  <Badge state={d.status} on={d.status === "issued"} />
                </div>
                {d.status === "issued"
                  ? <p className="mono-hash"><a href={`/api/documents/${d.id}/pdf`} target="_blank" rel="noreferrer">Open PDF</a> · {d.sizeBytes} bytes · SHA-256 {d.sha256}</p>
                  : <p className="muted">Being prepared.</p>}
              </li>
            ))}
            {!documents.data.documents.length && <li className="muted">The contract and invoices appear here once you sign.</li>}
          </ul>
        ) : <Skeleton rows={1} />}
      </section>

      <section className="section" aria-labelledby="funders-title">
        <h2 id="funders-title">Funders</h2>
        {producer ? <FundersEditor key={c.funders.map((f) => f.id + f.state).join()} c={c} onSaved={() => void reload()} /> : (
          <ul className="list" aria-label="Funders">
            {c.funders.map((f) => <li key={f.id}>{f.kind === "client" ? "You (lead client)" : f.name} · {percent(f.bp)}% · {usd(f.amountCents)} <Badge state={f.state} /></li>)}
            {!c.funders.length && <li className="muted">You fund this commission in full.</li>}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="ledger-title">
        <h2 id="ledger-title">Ledger</h2>
        <p className="table-hint">Scroll the table sideways for every column →</p>
        <div className="table-wrap" role="region" aria-label="Ledger table" tabIndex={0}>
          <table aria-label="Ledger">
            <thead><tr><th>Paid by</th><th>For</th><th className="num">Amount</th><th>Kill Bill payment</th><th>When</th></tr></thead>
            <tbody>
              {ledger.status === "ready" && ledger.data.entries.map((e) => (
                <tr key={e.id}><td>{e.payerName}</td><td>{e.label}</td><td className="num">{usd(e.amountCents)}</td><td className="mono-hash">{e.killbillPaymentId}</td><td>{e.at.slice(0, 10)}</td></tr>
              ))}
              {ledger.status === "ready" && !ledger.data.entries.length && <tr><td colSpan={5} className="muted">No payments yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" aria-labelledby="go-title">
        <h2 id="go-title">Go to</h2>
        <CommissionLinks id={c.id} />
      </section>

      {paying && paying.id && (
        <PaymentSheet amountCents={paying.amountCents} path={`/api/milestones/${paying.id}/payments`} onClose={() => setPaying(null)} onPaid={refreshAll} />
      )}
    </main>
  );
}
