import type { AuditEntry, Booking } from "../../shared/api";
import { dateTimeOf, formatDollars } from "../lib/format";

export const syncLabel = (status: "synced" | "pending_sync"): string => (status === "synced" ? "Synced" : "Pending sync");

/** The coordinator's Billing panel: the booking's invoice line, its amount and its sync label. */
export function BillingPanel({ booking }: { booking: Booking }) {
  const { charge } = booking;
  return (
    <section className="panel" aria-labelledby="billing-heading">
      <h3 id="billing-heading" className="section-label">
        Billing
      </h3>
      {charge ? (
        <p className="charge-line">
          <span className="mono">{charge.line_ref}</span>
          <span className="mono">{formatDollars(charge.amount_cents)}</span>
          <span className="sync">{syncLabel(charge.sync_status)}</span>
        </p>
      ) : (
        <p className="empty-note">No invoice line yet.</p>
      )}
    </section>
  );
}

/** The requester's Charge line, shown once the booking has one. */
export function ChargeLine({ booking }: { booking: Booking }) {
  const { charge } = booking;
  if (!charge) return null;
  return (
    <section className="panel" aria-labelledby="charge-heading">
      <h3 id="charge-heading" className="section-label">
        Charge
      </h3>
      <p className="charge-line">
        <span className="mono">{charge.line_ref}</span>
        <span className="mono">{formatDollars(charge.amount_cents)}</span>
        <span className="sync">{syncLabel(charge.sync_status)}</span>
      </p>
    </section>
  );
}

/** One entry per successful state-changing action, oldest first. */
export function AuditPanel({ entries }: { entries: AuditEntry[] | undefined }) {
  return (
    <section className="panel" aria-labelledby="audit-heading">
      <h3 id="audit-heading" className="section-label">
        Audit trail
      </h3>
      {entries === undefined ? (
        <p className="empty-note">Loading…</p>
      ) : (
        <ul className="audit mono">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              {dateTimeOf(entry.at)} · {entry.actor_name} · {entry.action.replaceAll("_", " ")}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
