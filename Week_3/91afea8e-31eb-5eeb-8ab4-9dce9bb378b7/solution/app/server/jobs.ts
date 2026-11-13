import { config } from "./config.js";
import { query } from "./db.js";
import { storePendingDocuments } from "./services/documents.js";
import { recordPendingPurchases, recordPendingRefunds, recordPendingReversals } from "./services/ledger.js";
import { refreshAwaitingPayments } from "./services/payments.js";
import { syncIndex } from "./services/search.js";
import { ProviderUnavailable } from "./services/provider.js";

function every(milliseconds: number, name: string, pass: () => Promise<void>): void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await pass();
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) console.error(`${name} pass failed`, error);
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), milliseconds).unref();
  void tick();
}

/** Expired pending sign-ins, sessions, access tokens, code counters and idempotency records go away. */
async function housekeeping(): Promise<void> {
  const now = Date.now();
  await query("DELETE FROM half_signed_in_sessions WHERE expires_at <= $1", [now]);
  await query("DELETE FROM access_tokens WHERE expires_at <= $1", [now]);
  await query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
  await query("DELETE FROM auth_codes WHERE (purpose <> 'reset' AND owner_id NOT IN (SELECT id FROM half_signed_in_sessions)) OR issued_at <= $1", [now - config.seconds.otpTtl * 1000]);
  await query("DELETE FROM code_sends WHERE at <= $1", [now - config.seconds.codeWindow * 1000]);
  await query("DELETE FROM rate_hits WHERE at <= $1", [now - config.seconds.rateWindow * 1000]);
  await query("DELETE FROM idempotency_keys WHERE created_at <= $1", [now - config.seconds.idempotencyTtl * 1000]);
}

/** Background passes coordinate through Postgres row locks, so several instances never do the same work twice. */
export function startJobs(): void {
  every(1000, "search sync", syncIndex);
  every(5000, "ledger", async () => {
    await recordPendingPurchases();
    await recordPendingRefunds();
    await recordPendingReversals();
  });
  every(5000, "payments", () => refreshAwaitingPayments(Date.now()));
  every(5000, "documents", storePendingDocuments);
  every(60_000, "housekeeping", housekeeping);
}
