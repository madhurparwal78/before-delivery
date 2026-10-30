// Background passes shared by every instance: each row is claimed with FOR UPDATE SKIP LOCKED inside the
// transaction that does its work, so no two instances touch it at once and a failure releases it.
import { config } from "../config.js";
import { db } from "../db.js";
import { sendMail } from "./mail.js";
import { deleteObject, listKeys, putObject } from "./storage.js";

const BATCH = 20;

async function uploadPending(): Promise<void> {
  for (let i = 0; i < BATCH; i += 1) {
    const claimed = await db.transaction(async (tx) => {
      const [row] = await tx.query<{ id: string; storage_key: string; content_type: string; pending_bytes: Buffer }>(
        `SELECT id, storage_key, content_type, pending_bytes FROM attachments
          WHERE status = 'pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!row) return false;
      await putObject(row.storage_key, row.pending_bytes, row.content_type);
      await tx.query("UPDATE attachments SET status = 'available', pending_bytes = NULL WHERE id = $1", [row.id]);
      return true;
    });
    if (!claimed) return;
  }
}

async function drainDeletions(): Promise<void> {
  for (let i = 0; i < BATCH; i += 1) {
    const claimed = await db.transaction(async (tx) => {
      const [row] = await tx.query<{ id: string; prefix: string }>(
        "SELECT id, prefix FROM object_deletions WHERE done_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",
      );
      if (!row) return false;
      for (const key of await listKeys(row.prefix)) await deleteObject(key);
      if ((await listKeys(row.prefix)).length === 0) await tx.query("UPDATE object_deletions SET done_at = now() WHERE id = $1", [row.id]);
      return true;
    });
    if (!claimed) return;
  }
}

async function sendOutbox(): Promise<void> {
  for (let i = 0; i < BATCH; i += 1) {
    const claimed = await db.transaction(async (tx) => {
      const [row] = await tx.query<{ id: string; recipient_name: string; recipient_email: string; subject: string; text_body: string; html_body: string }>(
        `SELECT id, recipient_name, recipient_email, subject, text_body, html_body FROM outbox
          WHERE sent_at IS NULL ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (!row) return false;
      await sendMail({ to: { name: row.recipient_name, email: row.recipient_email }, subject: row.subject, text: row.text_body, html: row.html_body });
      await tx.query("UPDATE outbox SET sent_at = now() WHERE id = $1", [row.id]);
      return true;
    });
    if (!claimed) return;
  }
}

type Pass = "attachments" | "outbox";

const PASSES: Record<Pass, { every: number; run: () => Promise<void> }> = {
  attachments: { every: config.attachmentRetrySeconds, run: async () => { await uploadPending(); await drainDeletions(); } },
  outbox: { every: config.outboxRetrySeconds, run: sendOutbox },
};

const running = new Set<Pass>();
const again = new Set<Pass>();

/** Runs a pass now (or right after the one in progress); failures wait for the next interval. */
export function kick(pass: Pass): void {
  if (running.has(pass)) {
    again.add(pass);
    return;
  }
  running.add(pass);
  PASSES[pass].run()
    .catch((error: unknown) => console.log(`${pass} pass will retry: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      running.delete(pass);
      if (again.delete(pass)) kick(pass);
    });
}

export function startWorkers(): void {
  for (const pass of Object.keys(PASSES) as Pass[]) {
    kick(pass);
    setInterval(() => kick(pass), PASSES[pass].every * 1000).unref();
  }
}
