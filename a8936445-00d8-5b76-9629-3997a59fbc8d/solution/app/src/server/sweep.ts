// The background sweep, at start and every REMINDER_SWEEP_SECONDS: seeded files catch up, reminders are
// queued once, queued emails are delivered and pending Kill Bill reversals are retried.
import { config } from "./config";
import { pool, rows, transaction } from "./db";
import { expiryReminder } from "./emails";
import { ProviderError } from "./errors";
import { deliverQueuedEmails, queueEmail } from "./mail";
import { documentFile } from "./documentFiles";
import { kitchenToday, tenantDocuments, tenantRows, type DocumentRow } from "./records";
import { reminderDue } from "./rules";
import { retryPendingReversals } from "./unitOfWork";

async function storePendingSeedFiles(): Promise<void> {
  for (const doc of await rows<DocumentRow>(pool, "SELECT * FROM documents WHERE file_pending")) await documentFile(pool, doc);
}

async function queueReminders(nowMs: number): Promise<void> {
  const today = kitchenToday(nowMs);
  await transaction(async (db) => {
    const candidates = await rows<DocumentRow>(db, "SELECT * FROM documents WHERE status = 'approved' AND reminder_queued_at IS NULL AND expires_on >= $1 FOR UPDATE SKIP LOCKED", [today]);
    for (const doc of candidates) {
      if (!reminderDue(doc, await tenantDocuments(db, doc.tenant_id), today)) continue;
      const [tenant] = await tenantRows(db, doc.tenant_id);
      await queueEmail(db, expiryReminder(tenant, doc.kind, doc.holder_name, doc.expires_on));
      await db.query("UPDATE documents SET reminder_queued_at = now() WHERE id = $1", [doc.id]);
    }
  });
}

const tasks: (() => Promise<void>)[] = [storePendingSeedFiles, () => queueReminders(Date.now()), deliverQueuedEmails, retryPendingReversals];

let running: Promise<void> | null = null;
let again = false;

async function sweep(): Promise<void> {
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      // An unreachable provider waits for the next sweep; anything else is a defect worth logging.
      if (!(error instanceof ProviderError)) console.error(error);
    }
  }
}

/** Runs a sweep now, or once more right after the one in progress. */
export function kickSweep(): void {
  if (running) {
    again = true;
    return;
  }
  running = sweep().finally(() => {
    running = null;
    if (again) {
      again = false;
      kickSweep();
    }
  });
}

export function startSweeping(): void {
  kickSweep();
  setInterval(kickSweep, config.sweepSeconds * 1000).unref();
}
