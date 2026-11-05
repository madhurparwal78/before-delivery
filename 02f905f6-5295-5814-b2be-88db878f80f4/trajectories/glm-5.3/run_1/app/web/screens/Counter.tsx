import React, { useEffect, useState } from "react";
import { api, ApiError, cents, pieceNumber, newIdempotencyKey, type Clay, type Piece, type Quote } from "../api.js";
import {
  EMPTY_FORM,
  PhotoPicker,
  PlanAndClay,
  ShapeRadioGroup,
  SizeFields,
  UnitsRadioGroup,
  FeePanel,
  type IntakeFormState
} from "./Intake.js";

interface DropoffResult {
  piece: Piece;
  amount_due_cents: number;
  payment_status: "owed" | "paid";
  tracking_url: string | null;
}

interface DropoffCard {
  piece: Piece;
  amount_due_cents: number;
  payment_status: "owed" | "paid";
}

const FIELD_IDS: Record<string, string> = {
  length: "size-length",
  width: "size-width",
  diameter: "size-diameter",
  height: "size-height",
  clay_id: "clay-body",
  plan: "firing-plan",
  cone: "glaze-cone",
  photo_id: "intake-photo",
  guest_name: "guest-name",
  guest_email: "guest-email"
};

export default function Counter(): React.ReactElement {
  const [form, setForm] = useState<IntakeFormState>(EMPTY_FORM);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [clays, setClays] = useState<Clay[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [photoState, setPhotoState] = useState<"idle" | "uploading" | "attached" | "error">("idle");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ kind: "ok" | "error" | "pending"; text: string } | null>(null);
  const [paymentResult, setPaymentResult] = useState<Record<number, string>>({});
  const [cards, setCards] = useState<DropoffCard[]>([]);
  const [pendingPayment, setPendingPayment] = useState<number | null>(null);
  const [paidSet, setPaidSet] = useState<Set<number>>(new Set());

  // The counter shows drop-off cards still awaiting payment, plus cards the
  // tech just paid so the Paid state stays visible.
  const reloadCards = (paidNumbers: Set<number>) => {
    api
      .get<Piece[]>("/api/pieces")
      .then((pieces) => {
        const next: DropoffCard[] = [];
        for (const p of pieces) {
          if (p.owner.kind !== "guest") continue;
          if (p.status === "awaiting_payment") {
            next.push({ piece: p, amount_due_cents: p.fee_cents, payment_status: "owed" });
          } else if (paidNumbers.has(p.number) && p.status === "queued") {
            next.push({ piece: p, amount_due_cents: p.fee_cents, payment_status: "paid" });
          }
        }
        setCards(next);
      })
      .catch(() => setCards([]));
  };

  useEffect(() => {
    api.get<Clay[]>("/api/clays").then(setClays).catch(() => setClays([]));
    reloadCards(paidSet);
    const timer = setInterval(() => reloadCards(paidSet), 5000);
    return () => clearInterval(timer);
  }, [paidSet]);

  useEffect(() => {
    const body = {
      shape: form.shape,
      unit: form.unit,
      length: form.length,
      width: form.width,
      diameter: form.diameter,
      height: form.height,
      plan: form.plan
    };
    const sizesFilled =
      form.height !== "" &&
      (form.shape === "rectangular" ? form.length !== "" && form.width !== "" : form.diameter !== "");
    if (!sizesFilled) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .post<Quote>("/api/quote", body)
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 60);
    return () => clearTimeout(timer);
  }, [form.shape, form.unit, form.length, form.width, form.diameter, form.height, form.plan]);

  const patch = (p: Partial<IntakeFormState>) => setForm((f) => ({ ...f, ...p }));

  const logDropoff = async () => {
    setResult({ kind: "pending", text: "Saving photo, charge and receipt…" });
    const body = {
      guest_name: guestName,
      guest_email: guestEmail,
      shape: form.shape,
      unit: form.unit,
      length: form.length,
      width: form.width,
      diameter: form.diameter,
      height: form.height,
      plan: form.plan,
      clay_id: form.clay_id,
      cone: form.plan === "bisque_only" ? null : form.cone,
      photo_id: photoId
    };
    try {
      const res = await api.post<DropoffResult>("/api/dropoffs", body, newIdempotencyKey());
      setResult({
        kind: "ok",
        text: `Piece ${pieceNumber(res.piece.number)} logged for ${guestName}. Amount due ${cents(res.amount_due_cents)}.`
      });
      setForm(EMPTY_FORM);
      setGuestName("");
      setGuestEmail("");
      setPhotoId(null);
      setPhotoState("idle");
      setFieldErrors({});
      reloadCards(paidSet);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.fields) {
        setFieldErrors(err.fields);
        setResult({ kind: "error", text: "Check these fields" });
      } else if (err instanceof ApiError) {
        setResult({ kind: "error", text: err.message });
      } else {
        setResult({ kind: "error", text: "Something went wrong." });
      }
    }
  };

  const takePayment = async (number: number) => {
    setPendingPayment(number);
    setPaymentResult((r) => ({ ...r, [number]: "Recording payment…" }));
    try {
      const res = await api.post<{ paid_cents: number }>(`/api/dropoffs/${number}/payment`, {}, newIdempotencyKey());
      setPaymentResult((r) => ({ ...r, [number]: `Paid ${cents(res.paid_cents)} — Piece ${pieceNumber(number)} is in the queue.` }));
      const nextPaid = new Set(paidSet);
      nextPaid.add(number);
      setPaidSet(nextPaid);
      setCards((cs) => cs.map((c) => (c.piece.number === number ? { ...c, payment_status: "paid" as const } : c)));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "already_paid"
            ? "Already paid."
            : err.message
          : "Something went wrong.";
      setPaymentResult((r) => ({ ...r, [number]: msg }));
    } finally {
      setPendingPayment(null);
    }
  };

  const errorKeys = Object.keys(fieldErrors);

  return (
    <main>
      <h1>Counter</h1>
      <form
        aria-label="Guest drop-off"
        onSubmit={(e) => {
          e.preventDefault();
          void logDropoff();
        }}
        noValidate
        className="pane"
      >
        {errorKeys.length > 0 ? (
          <div className="error-summary" role="alert">
            <h3>Check these fields</h3>
            <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {Object.entries(fieldErrors).map(([k, v]) => (
                <li key={k}>
                  <a
                    href={`#${FIELD_IDS[k] ?? k}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(FIELD_IDS[k] ?? k)?.focus();
                    }}
                  >
                    {v}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="field-row">
          <div className="field">
            <label htmlFor="guest-name">Guest name</label>
            <input id="guest-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} />
            {fieldErrors.guest_name ? <p className="error-text">{fieldErrors.guest_name}</p> : null}
          </div>
          <div className="field">
            <label htmlFor="guest-email">Guest email</label>
            <input id="guest-email" type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} />
            {fieldErrors.guest_email ? <p className="error-text">{fieldErrors.guest_email}</p> : null}
          </div>
        </div>
        <ShapeRadioGroup form={form} onChange={patch} />
        <UnitsRadioGroup form={form} onChange={patch} />
        <SizeFields form={form} onChange={patch} errors={fieldErrors} />
        <PlanAndClay form={form} onChange={patch} clays={clays} errors={fieldErrors} />
        <PhotoPicker
          onUploaded={(id) => setPhotoId(id)}
          onStateChange={(s) => setPhotoState(s)}
        />
        {fieldErrors.photo_id ? <p className="error-text">{fieldErrors.photo_id}</p> : null}
        <div className="field-row" style={{ alignItems: "center" }}>
          <button type="submit" className="primary" disabled={!(photoState === "attached" && quote && guestName && guestEmail)}>
            Log drop-off
          </button>
        </div>
        <div role="status" aria-live="polite" className="status-line" aria-label="Drop-off result">
          {result ? (
            <span className={result.kind === "ok" ? "ok" : result.kind === "error" ? "hazard" : ""}>{result.text}</span>
          ) : (
            <span className="sr-only">Drop-off result</span>
          )}
        </div>
        {quote ? (
          <p className="num small-note">
            Fee {quote.minimum_applied ? `${cents(quote.fee_cents)} (order minimum)` : cents(quote.fee_cents)} for {quote.cubic_inches} cubic inches
          </p>
        ) : null}
      </form>

      {cards.length > 0 ? (
        <div className="pane" style={{ marginTop: "1rem" }}>
          <h2>Awaiting payment</h2>
          {cards.map((c) => (
            <article key={c.piece.number} aria-label={`Drop-off Piece ${pieceNumber(c.piece.number)}`} className="hairline-row" style={{ padding: "0.7rem 0" }}>
              <p>
                <strong className="num">Piece {pieceNumber(c.piece.number)}</strong> — {c.piece.owner.name}
              </p>
              <p className="num">Amount due {cents(c.amount_due_cents)}</p>
              <p>{c.payment_status === "paid" ? "Paid" : "Owed"}</p>
              <button onClick={() => void takePayment(c.piece.number)} disabled={pendingPayment === c.piece.number}>
                Take payment
              </button>
              <div role="status" aria-live="polite" className="status-line" aria-label="Payment result">
                {paymentResult[c.piece.number] ? (
                  <span>{paymentResult[c.piece.number]}</span>
                ) : (
                  <span className="sr-only">Payment result</span>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </main>
  );
}
