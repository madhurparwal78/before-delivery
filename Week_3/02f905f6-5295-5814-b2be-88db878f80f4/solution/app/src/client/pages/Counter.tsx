// The counter: log a guest drop-off, then take payment once Kill Bill confirms it.
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Dropoff, Piece, User } from "../../shared/api";
import { request } from "../api";
import { ErrorSummary } from "../components/ErrorSummary";
import { FeePanel, fieldId, IntakeFields, PhotoField, useIntake } from "../components/IntakeForm";
import { Status } from "../components/Status";
import { money } from "../format";

interface Card {
  piece: Piece;
  paid: boolean;
}

function DropoffCard({ card, onPaid }: { card: Card; onPaid: (piece: Piece) => void }) {
  const { piece } = card;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: string }>({ text: "", tone: "" });
  const key = useRef(crypto.randomUUID());

  const pay = async () => {
    setPending(true);
    setMessage({ text: "Recording payment…", tone: "" });
    const result = await request<{ payment_status: "paid"; paid_cents: number; piece: Piece }>("POST", `/api/dropoffs/${piece.number}/payment`, {}, key.current);
    setPending(false);
    if (result.ok) {
      setMessage({ text: `Paid ${money(result.data.paid_cents)} — Piece ${piece.number} is in the queue.`, tone: "ok" });
      onPaid(result.data.piece);
      return;
    }
    if (result.error?.error === "already_paid") setMessage({ text: "Already paid.", tone: "error" });
    else setMessage({ text: result.error?.message ?? "Payment not recorded — billing is unreachable. The piece stays Owed.", tone: "error" });
  };

  return (
    <article className="dropoff-card stub" aria-labelledby={`dropoff-${piece.number}`}>
      <h3 id={`dropoff-${piece.number}`}>
        Drop-off <span className="num">Piece {piece.number}</span>
      </h3>
      <p className="muted">{piece.owner.name}</p>
      <Status status={piece.status} label={piece.status_label} />
      <p className="dropoff-due">
        Amount due <span className="num-strong">{money(piece.fee_cents)}</span>
      </p>
      <p>
        <span className={`badge ${card.paid ? "paid" : "owed"}`}>{card.paid ? "Paid" : "Owed"}</span>
      </p>
      {card.paid ? null : (
        <button type="button" className="btn btn-primary" onClick={() => void pay()} disabled={pending}>
          Take payment
        </button>
      )}
      <p role="status" aria-label="Payment result" className={`result${message.tone ? ` is-${message.tone}` : ""}`}>
        {message.text}
      </p>
    </article>
  );
}

export function Counter({ user }: { user: User }) {
  const intake = useIntake();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; tone: string }>({ text: "", tone: "" });
  const [cards, setCards] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void request<Piece[]>("GET", "/api/pieces?status=awaiting_payment").then((r) => {
      if (r.ok) setCards(r.data.map((piece) => ({ piece, paid: false })));
      setLoaded(true);
    });
  }, []);

  const setGuest = (change: { name?: string; email?: string }) => {
    intake.setDraft({});
    if (change.name !== undefined) setName(change.name);
    if (change.email !== undefined) setEmail(change.email);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!intake.ready || busy) return;
    setBusy(true);
    intake.setErrors({});
    setResult({ text: "Saving photo, charge and receipt…", tone: "" });
    const outcome = await request<Dropoff>("POST", "/api/dropoffs", { ...intake.body(), guest_name: name, guest_email: email }, intake.submissionKey());
    setBusy(false);
    if (outcome.ok) {
      const { piece } = outcome.data;
      setResult({ text: `Piece ${piece.number} logged for ${piece.owner.name}. Amount due ${money(outcome.data.amount_due_cents)}.`, tone: "ok" });
      setCards((current) => [{ piece, paid: false }, ...current.filter((c) => c.piece.number !== piece.number)]);
      intake.reset();
      setName("");
      setEmail("");
    } else if (outcome.status === 422 && outcome.error?.fields) {
      intake.setErrors(outcome.error.fields);
      setResult({ text: "", tone: "" });
    } else {
      setResult({ text: outcome.error?.message ?? "Drop-off not saved — the studio server is unreachable.", tone: "error" });
    }
  };

  const markPaid = (piece: Piece) => setCards((current) => current.map((c) => (c.piece.number === piece.number ? { piece, paid: true } : c)));

  return (
    <div className="page counter-page">
      <div className="page-head">
        <h1>Counter</h1>
        <p className="muted">Firing-only guests drop off here and pay at the desk. Logged by {user.name}.</p>
      </div>
      <div className="counter-layout">
        <form className="pane intake-form" aria-label="Guest drop-off" onSubmit={submit} noValidate>
          <h2>Guest drop-off</h2>
          <ErrorSummary errors={intake.errors} fieldId={fieldId} />
          <div className="field">
            <label htmlFor="guest-name">Guest name</label>
            <input id="guest-name" className="input" autoComplete="off" value={name} onChange={(e) => setGuest({ name: e.target.value })} aria-invalid={intake.errors.guest_name ? true : undefined} aria-describedby={intake.errors.guest_name ? "guest-name-error" : undefined} />
            {intake.errors.guest_name ? <p className="field-error" id="guest-name-error">{intake.errors.guest_name}</p> : null}
          </div>
          <div className="field">
            <label htmlFor="guest-email">Guest email</label>
            <input id="guest-email" className="input" type="email" autoComplete="off" value={email} onChange={(e) => setGuest({ email: e.target.value })} aria-invalid={intake.errors.guest_email ? true : undefined} aria-describedby={intake.errors.guest_email ? "guest-email-error" : undefined} />
            {intake.errors.guest_email ? <p className="field-error" id="guest-email-error">{intake.errors.guest_email}</p> : null}
          </div>
          <IntakeFields intake={intake} />
          <PhotoField intake={intake} />
          <div className="submit-row">
            <button type="submit" className="btn btn-primary" disabled={!intake.ready || busy}>
              Log drop-off
            </button>
            <p role="status" aria-label="Drop-off result" className={`result${result.tone ? ` is-${result.tone}` : ""}`}>
              {result.text}
            </p>
          </div>
        </form>
        <div className="fee-slot inline">
          <FeePanel estimate={intake.estimate} />
        </div>
      </div>
      <section className="pane" aria-labelledby="awaiting-title">
        <div className="pane-head">
          <h2 id="awaiting-title">Awaiting payment</h2>
        </div>
        {loaded && cards.length === 0 ? <p className="muted">No drop-offs are waiting for payment.</p> : null}
        <div className="dropoff-grid">
          {cards.map((card) => (
            <DropoffCard key={card.piece.number} card={card} onPaid={markPaid} />
          ))}
        </div>
      </section>
    </div>
  );
}
