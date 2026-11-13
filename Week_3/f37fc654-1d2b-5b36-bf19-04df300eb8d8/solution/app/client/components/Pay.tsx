// The payment sheet (one idempotency key per attempt; a new key after a failure) and the hold
// countdown, which follows the server's remaining seconds and elapsed page time, never the device clock.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatDay, usd } from "../../shared/format";
import { HttpError, call } from "../lib/api";
import { bannerFor } from "../lib/notices";
import { Dialog } from "./Dialog";

interface Hold {
  holdId: string;
  date: string;
  expiresAt: string;
  secondsRemaining: number;
  serverTime: string;
  status: "held" | "expired" | "booked";
}

export const holdEndedText = (date: string): string => `Your hold on ${formatDay(date)} has ended. Pick a day again to finish — your details are still here.`;

/** The hold as the server reports it, counted down by elapsed page time and re-synced every 30 s and on focus. */
export function useHold(commissionId: string): { hold: Hold | null; secondsLeft: number; ended: boolean; refresh: () => Promise<void> } {
  const [hold, setHold] = useState<Hold | null>(null);
  const [synced, setSynced] = useState({ seconds: 0, at: performance.now() });
  const [, setTick] = useState(0);
  const asking = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const fresh = await call<Hold>(`/api/commissions/${commissionId}/hold`);
      setHold(fresh);
      setSynced({ seconds: fresh.secondsRemaining, at: performance.now() });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) setHold(null);
    }
  }, [commissionId]);

  useEffect(() => {
    void refresh();
    const tick = setInterval(() => setTick((n) => n + 1), 250);
    const resync = setInterval(() => void refresh(), 30_000);
    const onFocus = (): void => void refresh();
    addEventListener("focus", onFocus);
    return () => {
      clearInterval(tick);
      clearInterval(resync);
      removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const secondsLeft = hold?.status === "held" ? Math.max(0, synced.seconds - (performance.now() - synced.at) / 1000) : 0;

  useEffect(() => {
    if (hold?.status === "held" && secondsLeft <= 0 && !asking.current) {
      asking.current = true;
      void refresh().finally(() => {
        asking.current = false;
      });
    }
  });

  return { hold, secondsLeft, ended: hold?.status === "expired", refresh };
}

export function Countdown({ seconds }: { seconds: number }) {
  const whole = Math.ceil(seconds);
  const text = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")} left`;
  return <span role="timer" aria-label="Hold time left" className="countdown">{text}</span>;
}

interface PaymentProps {
  amountCents: number;
  path: string;
  holdDate?: string;
  extra?: ReactNode;
  onClose: () => void;
  onPaid: () => void;
}

const newKey = (): string => crypto.randomUUID();

export function PaymentSheet({ amountCents, path, holdDate, extra, onClose, onPaid }: PaymentProps) {
  const [name, setName] = useState("");
  const [card, setCard] = useState("");
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const key = useRef(newKey());

  const pay = async (): Promise<void> => {
    if (busy || paid) return;
    setBusy(true);
    setErrors({});
    setStatus("Confirming payment with the billing system...");
    try {
      await call(path, { json: { nameOnCard: name, cardNumber: card }, headers: { "Idempotency-Key": key.current } });
      setPaid(true);
      setStatus(`Paid ${usd(amountCents)}. Your receipt is on its way.`);
      onPaid();
    } catch (error) {
      key.current = newKey();
      if (!(error instanceof HttpError)) setStatus("The payment didn't go through. Nothing has been charged.");
      else if (error.status === 422) {
        setErrors(error.errors);
        setStatus(Object.values(error.errors)[0] ?? "");
      } else if (error.code === "idempotency_conflict") setStatus("This payment key was already used for a different payment. Close this sheet and try again.");
      else if (error.code === "already_paid") setStatus("This is already paid.");
      else if (error.code === "hold_expired" && holdDate) setStatus(holdEndedText(holdDate));
      else if (error.code === "signed_out") setStatus("");
      else setStatus(bannerFor(error.code) ?? error.message ?? "The payment didn't go through. Nothing has been charged.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pay-scrim" />
      <Dialog label="Payment" className="pay-sheet" onClose={onClose} initialFocus="#pay-name">
        <h2>Payment</h2>
        {extra}
        <p className="muted">Test mode — no real card is charged.</p>
        <form className="stack" noValidate onSubmit={(e) => {
          e.preventDefault();
          void pay();
        }}>
          <div className="field">
            <label htmlFor="pay-name">Name on card</label>
            <input id="pay-name" className="input" autoComplete="cc-name" value={name} onChange={(e) => setName(e.target.value)} aria-describedby={errors.nameOnCard ? "pay-name-error" : undefined} />
            {errors.nameOnCard && <p className="field-error" id="pay-name-error">{errors.nameOnCard}</p>}
          </div>
          <div className="field">
            <label htmlFor="pay-card">Card number</label>
            <input id="pay-card" className="input" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(e.target.value)} aria-describedby={errors.cardNumber ? "pay-card-error" : undefined} />
            {errors.cardNumber && <p className="field-error" id="pay-card-error">{errors.cardNumber}</p>}
          </div>
          <p role="status" aria-label="Payment status" className="status-line">{status}</p>
          <div className="row-actions">
            <button type="submit" className="button primary" disabled={paid} aria-busy={busy || undefined}>Pay {usd(amountCents)}</button>
            <button type="button" className="button" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
