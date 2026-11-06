// A licence's state is decided from the server clock on every read, never by a background sweep.
export type LicenceKind = "exclusive" | "standard";
export type LicenceState = "pending_invoice" | "active" | "expired" | "revoked";

export interface LicenceRow {
  id: string;
  essay_id: string;
  newsroom: string;
  licensed_by: string;
  kind: LicenceKind;
  status: "pending" | "active" | "expired" | "removed" | "revoked";
  confirmed_at: Date;
  window_end: Date;
  hold_until: Date;
  amount_minor: number;
  rate_bp: number;
  invoice_raised: boolean;
  attempts: number;
  attempt_started_at: Date | null;
  warning_queued: boolean;
}

/** A charge attempt that started before the hold deadline may take up to 5 seconds; allow margin for the commit. */
export const ATTEMPT_WINDOW_MS = 10_000;

const attemptInFlight = (row: LicenceRow): boolean =>
  row.attempt_started_at !== null && Date.now() - row.attempt_started_at.getTime() < ATTEMPT_WINDOW_MS;

/** The licence's state at `now`, or null when it no longer exists (removed at its hold deadline or by billing). */
export function licenceState(row: LicenceRow, now: Date): LicenceState | null {
  switch (row.status) {
    case "revoked":
      return "revoked";
    case "removed":
      return null;
    case "pending":
      return now < row.hold_until || attemptInFlight(row) ? "pending_invoice" : null;
    case "active":
    case "expired":
      return now < row.window_end ? "active" : "expired";
  }
}

/** Effective end: the hold deadline while pending, the window end once active. */
export const effectiveEnd = (row: LicenceRow): Date => (row.status === "pending" ? row.hold_until : row.window_end);

/** A licence in this state holds the window: pending or active. */
export const holdsWindow = (state: LicenceState | null): boolean => state === "pending_invoice" || state === "active";

export const isStanding = (row: LicenceRow, now: Date): boolean => holdsWindow(licenceState(row, now));
