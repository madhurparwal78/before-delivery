import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { api, ApiFailure, idempotencyKey } from "../api.js";
import { Delayed, Live, type Message } from "../app.js";
import { focusFirst } from "../dialog.js";
import { clock, hours, localDate, money, stampParts } from "../format.js";
import { enter, MOTION } from "../tween.js";
import type { Booking, Hold } from "../types.js";

const BILLING_DELAYED_COPY = "Card payments are delayed while billing is unreachable. Nothing was charged.";

interface CheckoutProps {
  hold: Hold;
  zone: string;
  stationName: string;
  siteName: string;
  onClose: () => void;
  onConfirmed: (bookings: Booking[]) => void;
  onReleased: () => void;
  onExpired: () => void;
}

function confirmError(error: unknown): string {
  if (!(error instanceof ApiFailure)) return "Confirming failed. Try again.";
  switch (error.code) {
    case "hold_expired": return "Your hold ran out before payment. Nothing was charged.";
    case "certificate_required": return `Upload a liability certificate that covers ${((error.body.dates as string[] | undefined) ?? []).join(", ")} before confirming.`;
    case "pay_now_required": return "This booking starts too soon to pay later. Choose Pay now.";
    case "pack_insufficient": return "Your pack no longer covers these hours. Untick Use pack hours or buy a pack.";
    case "billing_unavailable": return BILLING_DELAYED_COPY;
    default: return error.detail;
  }
}

/** The Checkout panel: a non-modal dialog beside the dial (a sheet on phones) that never hides the dial. */
export function Checkout({ hold, zone, stationName, siteName, onClose, onConfirmed, onReleased, onExpired }: CheckoutProps) {
  const panel = useRef<HTMLElement>(null);
  const heading = useId();
  const [usePack, setUsePack] = useState(hold.quote.pack_minutes_available > 0);
  const [payNow, setPayNow] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);
  const [phase, setPhase] = useState<"held" | "busy" | "done" | "gone">(hold.status === "held" ? "held" : "gone");
  const [key] = useState(idempotencyKey);
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return undefined;
    focusFirst(element);
    return enter(element, 12, MOTION.dialogIn);
  }, []);
  const first = hold.occurrences[0];
  const dueBy = first ? `${localDate(zone, first.due_by)} ${clock(zone, first.due_by)}` : "";
  const total = hold.occurrences.reduce((sum, occurrence) => sum + occurrence.minutes, 0);

  const confirmBooking = async (): Promise<void> => {
    if (phase === "busy") return;
    setPhase("busy");
    setMessage({ text: "Confirming…", tone: "pending" });
    try {
      const result = await api<{ bookings: Booking[] }>("POST", `/api/holds/${hold.id}/confirm`, { use_pack: usePack, pay_now: payNow }, key);
      setPhase("done");
      setMessage({ text: "Booking confirmed. Confirmation email queued.", tone: "success" });
      onConfirmed(result.bookings);
    } catch (error) {
      setPhase(error instanceof ApiFailure && error.code === "hold_expired" ? "gone" : "held");
      setMessage({ text: confirmError(error), tone: "error" });
      if (error instanceof ApiFailure && error.code === "hold_expired") onExpired();
    }
  };

  const release = async (): Promise<void> => {
    setMessage({ text: "Releasing…", tone: "pending" });
    try {
      await api("DELETE", `/api/holds/${hold.id}`);
      setPhase("gone");
      setMessage({ text: "Hold released.", tone: "success" });
      onReleased();
    } catch (error) {
      setMessage({ text: error instanceof ApiFailure ? error.detail : "Releasing failed. Try again.", tone: "error" });
    }
  };

  const stamp = phase === "done" ? "Confirmed" : phase === "gone" ? "Expired" : "Held";
  return (
    <section
      ref={panel}
      role="dialog"
      aria-labelledby={heading}
      className="checkout slip"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
    >
      <header className="checkout-head">
        <h2 id={heading}>Checkout</h2>
        <span className={`stamp stamp-${stamp.toLowerCase()}`}>{stamp}</span>
        <button type="button" className="icon-button" aria-label="Close checkout" onClick={onClose}><X aria-hidden="true" size={20} /></button>
      </header>
      <p className="checkout-where">{stationName} · {siteName}</p>
      <ol className="occurrences">
        {hold.occurrences.map((occurrence) => (
          <li key={occurrence.start_at}>
            <span className="mono">{occurrence.date}</span>
            <span className="mono">{stampParts(occurrence.local_start).time} – {stampParts(occurrence.local_end).time}</span>
            <span className="mono">{hours(occurrence.minutes)} h</span>
          </li>
        ))}
      </ol>
      <dl className="quote">
        <div><dt>Time</dt><dd className="mono">{hours(total)} h</dd></div>
        <div><dt>From pack</dt><dd className="mono">{hours(hold.quote.pack_minutes)} h</dd></div>
        <div><dt>By card</dt><dd className="mono">{hours(hold.quote.card_minutes)} h · {money(hold.quote.card_cents)}</dd></div>
        <div><dt>Deposit</dt><dd className="mono">{money(hold.quote.deposit_cents)}</dd></div>
      </dl>
      <p className="quote-note">Quoted with pack hours applied first, in time order.</p>
      {phase === "held" || phase === "busy" ? (
        <>
          <label className="check">
            <input type="checkbox" checked={usePack} onChange={(event) => setUsePack(event.target.checked)} aria-label="Use pack hours" />
            <span>Use pack hours (<span className="mono">{hours(hold.quote.pack_minutes_available)}</span> h available)</span>
          </label>
          <fieldset className="choices">
            <legend>Card payment</legend>
            <div role="radiogroup" aria-label="Card payment" className="radios">
              <label className="check">
                <input type="radio" name={`pay-${hold.id}`} checked={payNow} onChange={() => setPayNow(true)} aria-label="Pay now" />
                <span>Pay now<Delayed /></span>
              </label>
              <label className="check">
                <input type="radio" name={`pay-${hold.id}`} checked={!payNow} onChange={() => setPayNow(false)} aria-label="Pay later" />
                <span>Pay later (due by <span className="mono">{dueBy}</span>)</span>
              </label>
            </div>
          </fieldset>
        </>
      ) : null}
      <Live label="Checkout status" message={message} />
      <div className="actions">
        {phase === "held" || phase === "busy" ? (
          <>
            <button type="button" className="button button-primary" aria-busy={phase === "busy"} onClick={() => void confirmBooking()}>Confirm booking</button>
            <button type="button" className="button" onClick={() => void release()}>Let hold go</button>
          </>
        ) : (
          <button type="button" className="button" onClick={onClose}>Close</button>
        )}
      </div>
      <p className="terms">{hold.terms}</p>
      {phase === "held" || phase === "busy" ? <p className="held-until">Held until <span className="mono">{clock(zone, hold.expires_at)}</span></p> : null}
    </section>
  );
}
