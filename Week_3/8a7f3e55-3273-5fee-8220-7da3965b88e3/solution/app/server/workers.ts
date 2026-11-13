import type { PoolClient } from "pg";
import type { LineRow } from "./bookings.js";
import { one, transaction } from "./db.js";
import { BillingUnavailable, chargeForLine, ensureAccountId, invoiceItems, postCharge } from "./services/killbill.js";
import { sendMail } from "./services/smtp.js";

const TICK_MS = 4_000;

interface EmailRow {
  id: number;
  to_address: string;
  subject: string;
  body: string;
}

/** Sends queued mail one message at a time; whichever process locks a message first sends it. */
async function sendQueuedEmails(): Promise<void> {
  for (;;) {
    const sent = await transaction(async (client) => {
      const email = await one<EmailRow>(
        client,
        "SELECT id, to_address, subject, body FROM emails WHERE sent_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (email === null) return false;
      await sendMail({ to: email.to_address, subject: email.subject, body: email.body });
      await client.query("UPDATE emails SET sent_at = now() WHERE id = $1", [email.id]);
      return true;
    });
    if (!sent) return;
  }
}

type PendingLine = LineRow & { org_name: string };

async function syncLine(client: PoolClient, line: PendingLine): Promise<void> {
  const accountId = await ensureAccountId(line.org_id, line.org_name);
  let charge = chargeForLine(await invoiceItems(accountId), line.line_ref, line.booking_ref);
  if (charge === undefined) {
    const kind = line.kind === "completed" ? "completed" : "late cancellation";
    await postCharge(accountId, line.amount_cents, `${line.line_ref} ${line.booking_ref} ${kind}`);
    charge = chargeForLine(await invoiceItems(accountId), line.line_ref, line.booking_ref);
  }
  if (charge === undefined) throw new BillingUnavailable("the charge cannot be read back yet");
  await client.query("UPDATE invoice_lines SET kb_item_id = $1 WHERE line_ref = $2", [charge.invoiceItemId, line.line_ref]);
}

/** Posts each pending line to Kill Bill and marks it synced once the charge is read back. */
async function syncPendingLines(): Promise<void> {
  for (;;) {
    const synced = await transaction(async (client) => {
      const line = await one<PendingLine>(
        client,
        `SELECT l.*, b.ref AS booking_ref, o.name AS org_name
           FROM invoice_lines l
           JOIN bookings b ON b.id = l.booking_id
           JOIN organisations o ON o.id = l.org_id
          WHERE l.kb_item_id IS NULL ORDER BY l.id LIMIT 1 FOR UPDATE OF l SKIP LOCKED`,
      );
      if (line === null) return false;
      await syncLine(client, line);
      return true;
    });
    if (!synced) return;
  }
}

/** Runs `task` unless it is already running. A failure is retried on the next tick; a new kind of failure is logged once. */
function recurring(name: string, task: () => Promise<void>): () => void {
  let running = false;
  let lastFailure = "";
  return () => {
    if (running) return;
    running = true;
    task()
      .then(() => {
        lastFailure = "";
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastFailure) console.error(`${name} will retry: ${message}`);
        lastFailure = message;
      })
      .finally(() => {
        running = false;
      });
  };
}

const runEmails = recurring("mail delivery", sendQueuedEmails);
const runBilling = recurring("billing sync", syncPendingLines);

export function startWorkers(): void {
  setInterval(runEmails, TICK_MS).unref();
  setInterval(runBilling, TICK_MS).unref();
}

/** Called after a commit that queued mail or a new invoice line, so delivery does not wait for the next tick. */
export function kickWorkers(): void {
  runEmails();
  runBilling();
}
