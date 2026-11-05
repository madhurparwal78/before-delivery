// The owner's studio: amounts owed (from Kill Bill), kiln fill, awaiting pickup and damage reports.
import { useEffect, useRef, useState } from "react";
import type { DamageReport, Kiln, Owed, StudioSummary } from "../../shared/api";
import { request } from "../api";
import { Dialog } from "../components/Dialog";
import { EmptySlip } from "../components/EmptySlip";
import { Photo } from "../components/Photo";
import { centsFromDollars, money } from "../format";

type OwedState = { kind: "loading" } | { kind: "ok"; owed: Owed } | { kind: "down" };

const KIND_LABEL: Record<DamageReport["kind"], string> = { glaze_run: "Glaze run", crack: "Crack" };
const REPORT_STATUS: Record<DamageReport["status"], string> = { reported: "Open", charged: "Charged", waived: "Waived" };

function ReportDialog({ report, onClose, onSettled }: { report: DamageReport; onClose: () => void; onSettled: (r: DamageReport) => void }) {
  const [charge, setCharge] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: string }>({ text: "", tone: "" });
  const [busy, setBusy] = useState(false);
  const [settled, setSettled] = useState<DamageReport>(report);
  const [key] = useState(() => crypto.randomUUID());
  const n = report.piece_number;

  const confirmCharge = async () => {
    const cents = centsFromDollars(charge);
    setBusy(true);
    setMessage({ text: "Posting charge…", tone: "" });
    const result = await request<DamageReport>("POST", `/api/damage-reports/${report.id}/confirm`, { amount_cents: cents }, key);
    setBusy(false);
    if (result.ok) {
      setSettled(result.data);
      onSettled(result.data);
      setMessage({ text: `Shelf charge of ${money(result.data.amount_cents ?? 0)} posted to ${report.account_name}.`, tone: "ok" });
    } else if (result.error?.error === "already_settled") {
      setMessage({ text: "This report is already settled.", tone: "error" });
    } else if (result.status === 422) {
      setMessage({ text: result.error?.fields?.amount_cents ?? "Enter a shelf charge from $1.00 to $200.00", tone: "error" });
    } else {
      setMessage({ text: result.error?.message ?? "Charge not posted — billing is unreachable. The report stays open.", tone: "error" });
    }
  };

  const waive = async () => {
    setBusy(true);
    const result = await request<DamageReport>("POST", `/api/damage-reports/${report.id}/waive`, {});
    setBusy(false);
    if (result.ok) {
      setSettled(result.data);
      onSettled(result.data);
      setMessage({ text: `Damage waived for Piece ${n}.`, tone: "ok" });
    } else {
      setMessage({ text: result.error?.error === "already_settled" ? "This report is already settled." : result.error?.message ?? "Not saved — the studio server is unreachable.", tone: "error" });
    }
  };

  const open = settled.status === "reported";
  return (
    <Dialog title={`Damage report for Piece ${n}`} onClose={onClose} wide>
      {(close) => (
        <>
          <div className="evidence">
            <Photo photoId={report.intake_photo_id} alt={`Intake photo of Piece ${n}`} caption={`Piece ${n} · intake photo`} />
            <Photo photoId={report.unload_photo_id} alt={`Unload photo of Piece ${n}`} caption={`Piece ${n} · unload photo`} />
          </div>
          <dl className="facts">
            <dt>Damage</dt>
            <dd>{KIND_LABEL[report.kind]}</dd>
            <dt>Account</dt>
            <dd>{report.account_name}</dd>
            <dt>Reported</dt>
            <dd>
              {report.reported_by} · <span className="num">{report.reported_at_label}</span>
            </dd>
            {report.note ? (
              <>
                <dt>Note</dt>
                <dd>{report.note}</dd>
              </>
            ) : null}
            <dt>Status</dt>
            <dd>
              {REPORT_STATUS[settled.status]}
              {settled.amount_cents !== null ? <span className="num"> {money(settled.amount_cents)}</span> : null}
            </dd>
          </dl>
          <div className="field">
            <label htmlFor="shelf-charge">Shelf charge ($)</label>
            <input id="shelf-charge" className="input num" type="number" inputMode="decimal" min="1" max="200" step="0.01" value={charge} onChange={(e) => setCharge(e.target.value)} disabled={!open} />
            <p className="hint">Replacement kiln shelves cost $60 to $90.</p>
          </div>
          <p role="status" aria-label="Damage result" className={`result${message.tone ? ` is-${message.tone}` : ""}`}>
            {message.text}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-primary" onClick={() => void confirmCharge()} disabled={busy || !open}>
              Confirm and charge
            </button>
            <button type="button" className="btn" onClick={() => void waive()} disabled={busy || !open}>
              Waive
            </button>
            <button type="button" className="btn btn-quiet" onClick={close}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function OwedRow({ account, onPaid, setResult }: { account: Owed["accounts"][number]; onPaid: () => void; setResult: (r: { text: string; tone: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const pay = async () => {
    setBusy(true);
    setResult({ text: "Recording payment…", tone: "" });
    const result = await request<{ paid_cents: number; owed_cents: number }>("POST", `/api/members/${account.member_number}/payments`, {}, key.current);
    setBusy(false);
    if (result.ok) {
      key.current = crypto.randomUUID();
      setResult({ text: `Recorded ${money(result.data.paid_cents)} from ${account.name}.`, tone: "ok" });
      onPaid();
    } else {
      setResult({ text: result.error?.message ?? "Payment not recorded — billing is unreachable.", tone: "error" });
    }
  };
  return (
    <tr>
      <td>
        {account.name}
        <span className="small muted"> · {account.kind === "member" ? `member ${account.member_number}` : `guest, Piece ${account.piece_number}`}</span>
      </td>
      <td className="num right">{money(account.owed_cents)}</td>
      <td className="right">
        {account.kind === "member" ? (
          <button type="button" className="btn" onClick={() => void pay()} disabled={busy || account.owed_cents <= 0} aria-label={`Record payment from ${account.name}`}>
            Record payment
          </button>
        ) : (
          <span className="small muted">Pays at the counter</span>
        )}
      </td>
    </tr>
  );
}

export function Studio() {
  const [owed, setOwed] = useState<OwedState>({ kind: "loading" });
  const [summary, setSummary] = useState<StudioSummary | null>(null);
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [reports, setReports] = useState<DamageReport[] | null>(null);
  const [reviewing, setReviewing] = useState<DamageReport | null>(null);
  const [payment, setPayment] = useState<{ text: string; tone: string }>({ text: "", tone: "" });

  const loadOwed = async () => {
    const r = await request<Owed>("GET", "/api/studio/owed");
    setOwed(r.ok ? { kind: "ok", owed: r.data } : { kind: "down" });
  };
  const loadRest = async () => {
    const [s, k, d] = await Promise.all([request<StudioSummary>("GET", "/api/studio/summary"), request<Kiln[]>("GET", "/api/kilns"), request<DamageReport[]>("GET", "/api/damage-reports")]);
    if (s.ok) setSummary(s.data);
    if (k.ok) setKilns(k.data);
    setReports(d.ok ? d.data : []);
  };

  useEffect(() => {
    void loadOwed();
    void loadRest();
  }, []);

  // Both columns appear together once their first reads answer, so neither pushes the other down.
  const ready = owed.kind !== "loading" && reports !== null;

  return (
    <div className="page studio-page">
      <div className="page-head">
        <h1>Studio</h1>
        <p className="muted">Every figure is read fresh from Kill Bill and the studio records.</p>
      </div>
      {!ready ? <p className="muted">Reading balances from billing…</p> : null}
      {ready ? (
      <div className="studio-layout">
        <div className="studio-left">
          {owed.kind === "down" ? (
            <div role="alert" className="banner">
              Billing is down — we can't show what's owed right now.
            </div>
          ) : null}
          <section className="pane" aria-labelledby="owed-title">
            <div className="pane-head">
              <h2 id="owed-title">Amounts owed</h2>
              {owed.kind === "ok" ? (
                <span>
                  Total <span className="num-strong">{money(owed.owed.total_owed_cents)}</span>
                </span>
              ) : null}
            </div>
            {owed.kind === "down" ? <p className="muted">Amounts appear here again once billing answers.</p> : null}
            {owed.kind === "ok" ? (
              <div className="table-wrap" tabIndex={0}>
                <table className="table" aria-label="Amounts owed">
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col" className="right">
                        Owed
                      </th>
                      <th scope="col">
                        <span className="visually-hidden">Payment</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {owed.owed.accounts.map((account) => (
                      <OwedRow key={`${account.kind}-${account.member_number ?? account.piece_number}`} account={account} onPaid={() => void loadOwed()} setResult={setPayment} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <p role="status" aria-label="Payment result" className={`result${payment.tone ? ` is-${payment.tone}` : ""}`}>
              {payment.text}
            </p>
          </section>
        </div>
        <div className="studio-right">
          <section className="pane" aria-labelledby="kilns-title">
            <div className="pane-head">
              <h2 id="kilns-title">Kilns</h2>
            </div>
            <ul className="kiln-fill-list">
              {kilns.map((kiln) => {
                const figure = summary?.kilns.find((k) => k.kiln_id === kiln.id);
                const fill = figure?.fill_percent ?? null;
                return (
                  <li key={kiln.id}>
                    <span>{kiln.name}</span>
                    {fill === null ? (
                      <span className="muted">No load</span>
                    ) : (
                      <span>
                        Load <span className="num">{fill}%</span> full
                      </span>
                    )}
                    <span className="fill-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(fill ?? 0, 100)}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="pane" aria-labelledby="pickup-title">
            <div className="pane-head">
              <h2 id="pickup-title">Awaiting pickup</h2>
            </div>
            <p className="big-figure">
              <span className="num-strong">{summary ? summary.awaiting_pickup : "…"}</span> <span className="muted small-figure-label">pieces on the pickup shelf</span>
            </p>
          </section>
          <section className="pane" aria-labelledby="damage-title">
            <div className="pane-head">
              <h2 id="damage-title">Damage reports</h2>
              {summary ? (
                <span className="muted">
                  <span className="num">{summary.open_damage_reports}</span> open
                </span>
              ) : null}
            </div>
            {reports !== null && reports.length === 0 ? <EmptySlip>No shelf damage has been reported. Reports filed at unload land here.</EmptySlip> : null}
            <ul className="report-list">
              {(reports ?? []).map((report) => (
                <li key={report.id} className={report.status === "reported" ? "open" : ""}>
                  <div>
                    <span className="num">Piece {report.piece_number}</span> · {KIND_LABEL[report.kind]} · {report.account_name}
                    <div className="small muted">
                      {REPORT_STATUS[report.status]}
                      {report.amount_cents !== null ? <span className="num"> {money(report.amount_cents)}</span> : null} · <span className="num">{report.reported_at_label}</span>
                    </div>
                  </div>
                  <button type="button" className="btn" onClick={() => setReviewing(report)} aria-label={`Review Piece ${report.piece_number}`}>
                    Review
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      ) : null}
      {reviewing ? (
        <ReportDialog
          report={reviewing}
          onClose={() => setReviewing(null)}
          onSettled={(settled) => {
            setReports((current) => (current ?? []).map((r) => (r.id === settled.id ? settled : r)));
            void loadOwed();
            void loadRest();
          }}
        />
      ) : null}
    </div>
  );
}
