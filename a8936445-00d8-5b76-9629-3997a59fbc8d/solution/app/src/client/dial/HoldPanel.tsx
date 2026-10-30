// The live hold's panel in the rail: countdown, payment choice, confirm and release.
import { useEffect, useRef, useState } from "preact/hooks";
import type { Booking, Hold, Policy, Tenant } from "../../shared/api";
import type { PayWith } from "../../shared/kitchen";
import { hmm } from "../../shared/time";
import { api, apiNoContent, newIdempotencyKey } from "../api";
import { act } from "../feedback";
import { DOCUMENT_EXPIRES, TENANT_NOT_ACTIVE } from "./holds";
import { countdown } from "./model";

export type HoldEnd = "confirmed" | "released" | "expired";

interface HoldPanelProps {
  hold: Hold;
  stationName: string;
  policy: Policy | null;
  now: number;
  onEnd: (end: HoldEnd) => void;
}

export function HoldPanel({ hold, stationName, policy, now, onEnd }: HoldPanelProps) {
  const [payWith, setPayWith] = useState<PayWith>("account");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<{ payWith: PayWith; key: string } | null>(null);
  const left = Date.parse(hold.expires_at) - now;

  useEffect(() => {
    if (left <= 0) onEnd("expired");
  }, [left <= 0]);

  const confirmHold = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    if (!attempt.current || attempt.current.payWith !== payWith) attempt.current = { payWith, key: newIdempotencyKey() };
    const key = attempt.current.key;
    const outcome = await act(
      {
        pending: "Confirming…",
        services: payWith === "account" ? ["billing", "mail"] : ["mail"],
        success: (email) => `Booked. Confirmation for ${hold.ref} was emailed to ${email}.`,
        error: (f) => {
          if (f.code === "hold_expired") return "This hold expired. Place it again if the time is still free.";
          if (f.code === "invalid_transition") return "This hold is already confirmed.";
          if (f.code === "tenant_not_active") return TENANT_NOT_ACTIVE;
          if (f.code === "document_expires_before_booking") return DOCUMENT_EXPIRES;
          if (f.code === "insufficient_hours") {
            return `Your hour pack has ${hmm(Number(f.details.balance_minutes))} left; this booking needs ${hmm(Number(f.details.needed_minutes))}.`;
          }
          if (f.code === "billing_unavailable") {
            return "Billing is unreachable. Nothing was booked or charged, and your hold is kept until it expires.";
          }
          if (f.code === "mail_unavailable") {
            return "Email is unreachable. Nothing was booked or charged, and your hold is kept until it expires.";
          }
          return null;
        },
      },
      async () => {
        await api<{ ref: string; bookings: Booking[] }>("POST", `/api/holds/${encodeURIComponent(hold.ref)}/confirm`, {
          body: { pay_with: payWith },
          idempotencyKey: key,
        });
        const tenant = await api<Tenant>("GET", `/api/tenants/${encodeURIComponent(hold.tenant_id)}`);
        return tenant.owner_email;
      },
    );
    inFlight.current = false;
    setBusy(false);
    if (outcome.ok) {
      attempt.current = null;
      onEnd("confirmed");
      return;
    }
    const { status, code } = outcome.failure;
    // A refused attempt is finished; only an unanswered or failed-provider attempt is retried with its key.
    if (status !== 0 && status < 500) attempt.current = null;
    if (code === "hold_expired" || code === "invalid_transition") onEnd("expired");
  };

  const release = async (): Promise<void> => {
    const outcome = await act(
      {
        pending: "Releasing hold…",
        success: () => `Hold ${hold.ref} released.`,
        error: (f) => (f.status === 404 ? "That hold is no longer live." : null),
      },
      () => apiNoContent("DELETE", `/api/holds/${encodeURIComponent(hold.ref)}`),
    );
    if (outcome.ok || outcome.failure.status === 404) onEnd("released");
  };

  return (
    <section class="hold-panel" aria-label={`Hold ${hold.ref}`}>
      <header class="hold-head">
        <h3>
          Hold <span class="mono">{hold.ref}</span>
        </h3>
        <p class="hold-timer" role="timer" aria-label="Hold time left">
          Expires in <span class="mono">{countdown(left)}</span>
        </p>
      </header>
      <ul class="hold-bookings">
        {hold.bookings.map((b) => (
          <li key={b.id}>
            <span class="mono">{b.ref}</span>
            <span>{stationName}</span>
            <span class="mono">{b.date}</span>
            <span class="mono">
              {b.start_local}–{b.end_local}
            </span>
          </li>
        ))}
      </ul>
      <div class="pay-with" role="radiogroup" aria-label="Pay with">
        {(["account", "hour_pack"] as const).map((choice) => (
          <label key={choice} class="radio">
            <input
              type="radio"
              name={`pay-${hold.ref}`}
              value={choice}
              checked={payWith === choice}
              onChange={() => setPayWith(choice)}
            />
            {choice === "account" ? "Account" : "Hour pack"}
          </label>
        ))}
      </div>
      {policy && (
        <p class="policy-line">
          {`Cancellation: free until ${policy.free_window_hours} hours before start, then ${policy.late_fee_percent}% charge (policy v${policy.version})`}
        </p>
      )}
      <div class="hold-actions">
        <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void confirmHold()}>
          Confirm booking
        </button>
        <button type="button" class="btn" onClick={() => void release()}>
          Release hold
        </button>
      </div>
    </section>
  );
}
