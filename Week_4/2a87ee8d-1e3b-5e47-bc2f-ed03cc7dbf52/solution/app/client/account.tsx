// The signed-in facilitator, the account chrome and the billing banner shared by the account pages and the room.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiFailure, failureText, opId } from "./api.js";
import { instantDate } from "./format.js";
import { Link, navigate } from "./ui.js";
import type { Billing, Facilitator } from "./types.js";

/** Loads the facilitator session; without one the page goes to sign-in. */
export function useFacilitator(): Facilitator | null {
  const [me, setMe] = useState<Facilitator | null>(null);
  useEffect(() => {
    api<{ facilitator: Facilitator }>("GET", "/api/session").then(
      (r) => setMe(r.facilitator),
      (e: unknown) => {
        if (e instanceof ApiFailure && e.status === 401) navigate("/signin", true);
      },
    );
  }, []);
  return me;
}

export function useBilling(enabled = true): [Billing | null, (b: Billing) => void, () => Promise<void>] {
  const [billing, setBilling] = useState<Billing | null>(null);
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setBilling(await api<Billing>("GET", "/api/billing"));
    } catch {
      /* the page shows its own state; the banner stays hidden */
    }
  }, [enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return [billing, setBilling, load];
}

export function AccountShell({ children }: { children: ReactNode }) {
  const signOut = async () => {
    await api("DELETE", "/api/session").catch(() => undefined);
    navigate("/signin");
  };
  return (
    <div className="page">
      <header className="site-header">
        <Link to="/workshops" className="wordmark">
          Lanternfold Rooms
        </Link>
        <nav className="account-nav" aria-label="Account">
          <Link to="/workshops" className="btn btn-quiet account-home">
            Workshops
          </Link>
          <button type="button" className="btn btn-quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}

/**
 * The past-due or read-only banner with "Retry payment". Results go to `report`, which routes them to the
 * hosting page's regions.
 */
export function BillingBanner({
  billing,
  zone,
  onBilling,
  report,
}: {
  billing: Billing | null;
  zone: string;
  onBilling: (b: Billing) => void;
  report: (kind: "ok" | "error", text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!billing || billing.state === "active") return null;
  const retry = async () => {
    setBusy(true);
    try {
      const r = await api<{ billing: Billing }>("POST", "/api/billing/payments", { clientOpId: opId() });
      onBilling(r.billing);
      report("ok", "Payment received. Your workspace is fully editable again.");
    } catch (e) {
      report("error", e instanceof ApiFailure && e.code === "billing_unavailable" ? "Billing is unavailable. Try again shortly." : failureText(e, "You're offline — try again shortly."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="banner" aria-label="Billing notice">
      <p>
        {billing.state === "past_due" && billing.readOnlyAt
          ? `Your last payment didn't go through. Settle it by ${instantDate(billing.readOnlyAt, zone)} to keep editing.`
          : "Your workspace is read-only until the overdue payment is settled."}
      </p>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void retry()}>
        {busy ? "Retrying…" : "Retry payment"}
      </button>
    </section>
  );
}
