import React, { useEffect, useState } from "react";
import { api, ApiError, cents, pieceNumber, type DamageReport, type User, newIdempotencyKey } from "../api.js";
import { StatusChip } from "../shared.js";

interface OwedAccount {
  kind: "member" | "guest";
  member_number: string | null;
  piece_number: number | null;
  name: string;
  owed_cents: number;
}

interface Summary {
  awaiting_pickup: number;
  open_damage_reports: number;
  kilns: Array<{ kiln_id: string; firing_id: number | null; fill_percent: number }>;
}

export default function Studio(): React.ReactElement {
  const [owed, setOwed] = useState<OwedAccount[] | null>(null);
  const [billingDown, setBillingDown] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [paymentResult, setPaymentResult] = useState<string | null>(null);
  const [reviewReport, setReviewReport] = useState<DamageReport | null>(null);
  const [shelfCharge, setShelfCharge] = useState("");
  const [damageResult, setDamageResult] = useState<string | null>(null);

  const load = () => {
    api
      .get<{ accounts: OwedAccount[] }>("/api/studio/owed")
      .then((d) => {
        setOwed(d.accounts);
        setBillingDown(false);
      })
      .catch(() => setBillingDown(true));
    api.get<Summary>("/api/studio/summary").then(setSummary).catch(() => undefined);
    api.get<DamageReport[]>("/api/damage-reports").then(setReports).catch(() => undefined);
  };

  useEffect(load, []);
  useEffect(() => {
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  const recordPayment = async (account: OwedAccount) => {
    if (account.kind !== "member" || !account.member_number) return;
    setPaymentResult("Recording payment…");
    try {
      const res = await api.post<{ paid_cents: number }>(`/api/members/${account.member_number}/payments`, {}, newIdempotencyKey());
      setPaymentResult(`Recorded ${cents(res.paid_cents)} from ${account.name}.`);
      load();
    } catch (err) {
      if (err instanceof ApiError) {
        setPaymentResult(err.code === "nothing_owed" ? "Nothing is owed." : err.message);
      } else {
        setPaymentResult("Something went wrong.");
      }
    }
  };

  const confirmDamage = async () => {
    if (!reviewReport) return;
    const amountDollars = Number(shelfCharge);
    const amountCents = Math.round(amountDollars * 100);
    setDamageResult("Posting charge…");
    try {
      await api.post(`/api/damage-reports/${reviewReport.id}/confirm`, { amount_cents: amountCents }, newIdempotencyKey());
      setDamageResult(`Shelf charge of ${cents(amountCents)} posted to ${reviewReport.account_name}.`);
      setReviewReport(null);
      load();
    } catch (err) {
      if (err instanceof ApiError) {
        setDamageResult(
          err.code === "already_settled"
            ? "This report is already settled."
            : err.code === "billing_unavailable"
              ? "Charge not posted — billing is unreachable. The report stays open."
              : err.fields?.amount_cents ?? "Enter a valid amount"
        );
      } else {
        setDamageResult("Something went wrong.");
      }
    }
  };

  const waiveDamage = async () => {
    if (!reviewReport) return;
    try {
      await api.post(`/api/damage-reports/${reviewReport.id}/waive`);
      setDamageResult(`Damage waived for Piece ${pieceNumber(reviewReport.piece_number)}.`);
      setReviewReport(null);
      load();
    } catch (err) {
      setDamageResult(err instanceof ApiError && err.code === "already_settled" ? "This report is already settled." : "Something went wrong.");
    }
  };

  const kilnNames: Record<string, string> = { annie: "Big Annie", ned: "Little Ned" };

  return (
    <main>
      <h1>Studio</h1>
      <div className="studio-grid">
        <div>
          <div className="pane" role="region" aria-label="Amounts owed">
            <h2>Amounts owed</h2>
            {billingDown ? (
              <div className="banner" role="alert">
                Billing is down — we can't show what's owed right now.
              </div>
            ) : owed ? (
              <table aria-label="Amounts owed">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Owed</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {owed.map((a) => (
                    <tr key={a.member_number ?? `p${a.piece_number}`} className="hairline-row">
                      <td>{a.name}</td>
                      <td className="num">{a.owed_cents > 0 ? cents(a.owed_cents) : "$0.00"}</td>
                      <td>
                        {a.kind === "member" && a.owed_cents > 0 ? (
                          <button onClick={() => void recordPayment(a)}>Record payment from {a.name}</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>…</p>
            )}
            <div role="status" aria-live="polite" className="status-line" aria-label="Payment result">
              {paymentResult ? <span>{paymentResult}</span> : <span className="sr-only">Payment result</span>}
            </div>
          </div>
        </div>
        <div className="stack">
          <div className="pane" role="region" aria-label="Kilns">
            <h2>Kilns</h2>
            {summary
              ? summary.kilns.map((k) => (
                  <p key={k.kiln_id}>
                    {kilnNames[k.kiln_id] ?? k.kiln_id}:{" "}
                    {k.firing_id ? <span className="num">Load {k.fill_percent}% full</span> : "No load"}
                  </p>
                ))
              : null}
          </div>
          <div className="pane" role="region" aria-label="Awaiting pickup">
            <h2>Awaiting pickup</h2>
            <p className="num" style={{ fontSize: "1.6rem" }}>
              {summary?.awaiting_pickup ?? 0}
            </p>
          </div>
          <div className="pane" role="region" aria-label="Damage reports">
            <h2>Damage reports</h2>
            {reports.length === 0 ? <p>No damage reports.</p> : null}
            {reports.map((r) => (
              <div key={r.id} className="hairline-row" style={{ padding: "0.6rem 0", display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center" }}>
                <span className="num">Piece {pieceNumber(r.piece_number)}</span>
                <StatusChip status={r.status === "reported" ? "queued" : "collected"} label={r.status === "reported" ? "Open" : r.status === "charged" ? "Charged" : "Waived"} />
                <span>{r.kind === "glaze_run" ? "Glaze run" : "Crack"}</span>
                {r.status === "reported" ? (
                  <button onClick={() => { setReviewReport(r); setShelfCharge(""); setDamageResult(null); }}>
                    Review Piece {pieceNumber(r.piece_number)}
                  </button>
                ) : null}
              </div>
            ))}
            <div role="status" aria-live="polite" className="status-line" aria-label="Damage result">
              {damageResult ? <span>{damageResult}</span> : <span className="sr-only">Damage result</span>}
            </div>
          </div>
        </div>
      </div>

      {reviewReport ? (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Damage report for Piece ${pieceNumber(reviewReport.piece_number)}`}
          >
            <h2>
              Damage report for Piece <span className="num">{pieceNumber(reviewReport.piece_number)}</span>
            </h2>
            <p>
              {reviewReport.kind === "glaze_run" ? "Glaze run" : "Crack"} reported by {reviewReport.reported_by} ·{" "}
              <span className="num">{reviewReport.reported_at_label}</span>
            </p>
            <div className="studio-grid">
              <figure className="photo-mat" style={{ margin: 0 }}>
                <img
                  src={`/api/photos/${reviewReport.intake_photo_id}`}
                  alt={`Intake photo of Piece ${pieceNumber(reviewReport.piece_number)}`}
                />
                <figcaption className="photo-caption">
                  Piece {pieceNumber(reviewReport.piece_number)} intake photo
                </figcaption>
              </figure>
              <figure className="photo-mat" style={{ margin: 0 }}>
                <img
                  src={`/api/photos/${reviewReport.unload_photo_id}`}
                  alt={`Unload photo of Piece ${pieceNumber(reviewReport.piece_number)}`}
                />
                <figcaption className="photo-caption">
                  Piece {pieceNumber(reviewReport.piece_number)} unload photo
                </figcaption>
              </figure>
            </div>
            <div className="field" style={{ marginTop: "1rem" }}>
              <label htmlFor="shelf-charge">Shelf charge ($)</label>
              <input
                id="shelf-charge"
                type="number"
                step="0.01"
                min="1"
                max="200"
                value={shelfCharge}
                onChange={(e) => setShelfCharge(e.target.value)}
              />
            </div>
            <div className="field-row">
              <button className="primary" onClick={() => void confirmDamage()}>
                Confirm and charge
              </button>
              <button onClick={() => void waiveDamage()}>Waive</button>
              <button onClick={() => setReviewReport(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
