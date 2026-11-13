import { businessNow } from "./clock.js";
import { pool } from "./db.js";
import { finishRefund } from "./refunds.js";
import { attemptVoid, closeLedger, expireAuthorisation, finishCapture, finishSettlement, lapseTransfer, resumeAuthorisationRecord } from "./payments.js";

/** The once-a-second sweep: deadlines, expiries, and every confirmed step that still waits for Kill Bill. */

const references = async (sql: string, params: unknown[] = []): Promise<string[]> =>
  ((await pool.query(sql, params)).rows as { reference: string }[]).map((row) => row.reference);

const running = new Set<string>();

/** Starts work for a key unless the same work is still running; a stuck item never holds up the others. */
const launch = (kind: string, keys: string[], work: (key: string) => Promise<unknown>): void => {
  for (const key of keys) {
    const id = `${kind}:${key}`;
    if (running.has(id)) continue;
    running.add(id);
    void work(key).catch(() => undefined).finally(() => running.delete(id));
  }
};

const sweep = async (): Promise<void> => {
  try {
    launch("lapse", await references("SELECT reference FROM orders WHERE payment_state = 'pending' AND deadline_at <= $1", [businessNow()]), lapseTransfer);
    launch("expire", await references(
      "SELECT reference FROM orders WHERE payment_state IN ('authorised', 'capture_failed') AND auth_expires_at <= now() AND NOT void_pending",
    ), expireAuthorisation);
    launch("void", await references("SELECT reference FROM orders WHERE void_pending"), attemptVoid);
    launch("record", await references(
      "SELECT reference FROM orders WHERE payment_state = 'authorised' AND live AND kb_payment_id IS NULL AND NOT void_pending",
    ), resumeAuthorisationRecord);
    launch("capture", await references(
      "SELECT reference FROM orders WHERE capture_confirmed AND payment_state IN ('authorised', 'capture_failed')",
    ), finishCapture);
    launch("settle", await references("SELECT reference FROM orders WHERE settle_confirmed AND payment_state = 'pending'"), finishSettlement);
    launch("close", await references(
      "SELECT reference FROM orders WHERE payment_state IN ('voided', 'authorisation_expired') AND NOT kb_closed AND kb_payment_id IS NOT NULL",
    ), closeLedger);
    launch("refund", ((await pool.query("SELECT refund_id FROM refunds WHERE gateway_confirmed AND state = 'pending'")).rows as { refund_id: string }[])
      .map((row) => row.refund_id), finishRefund);
  } catch {
    return;
  }
};

export const startSweeper = (): void => {
  setInterval(() => void sweep(), 1000).unref();
};
