import type { Pool } from "pg";
import type { Config } from "./config.js";
import { createStorage, type Storage } from "./storage.js";
import { sendSmtp } from "./mailer.js";
import { INSTANCE_ID } from "./router.js";

let storageInstance: Storage | null = null;

/** The object storage client. A failed operation reports as unreachable. */
export const storage: Storage = {
  put: async (key, bytes, contentType) => {
    try {
      return await resolveStorage().put(key, bytes, contentType);
    } catch {
      return false;
    }
  },
  get: async (key) => {
    try {
      return await resolveStorage().get(key);
    } catch {
      return null;
    }
  },
  remove: async (key) => {
    try {
      return await resolveStorage().remove(key);
    } catch {
      return false;
    }
  },
  removePrefix: async (prefix) => {
    try {
      return await resolveStorage().removePrefix(prefix);
    } catch {
      return false;
    }
  },
};

function resolveStorage(): Storage {
  if (storageInstance === null) {
    throw new Error("Storage is not initialised");
  }
  return storageInstance;
}

export function initStorage(config: Config): void {
  if (storageInstance === null) {
    storageInstance = createStorage(config);
  }
}

interface PendingAttachmentRow {
  id: string;
  storage_key: string;
  filename: string;
  content_type: string;
  pending_bytes: Buffer | null;
}

/**
 * Claim and upload pending attachments. Every running instance polls the
 * shared database, and each claims a row before it tries (DP-14).
 */
export async function uploadPendingAttachments(pool: Pool, config: Config): Promise<void> {
  const claimed = await pool.query<PendingAttachmentRow>(
    `UPDATE attachments SET claimed_by = $1, claimed_at = now()
     WHERE id IN (
       SELECT id FROM attachments
       WHERE status = 'pending'
         AND (claimed_by IS NULL OR claimed_at < now() - interval '2 minutes')
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 20
     )
     RETURNING id, storage_key, filename, content_type, pending_bytes`,
    [INSTANCE_ID],
  );
  for (const row of claimed.rows) {
    if (row.pending_bytes === null) {
      // Nothing to send; leave it pending for a human look.
      await pool.query("UPDATE attachments SET claimed_by = NULL, claimed_at = NULL WHERE id = $1", [
        row.id,
      ]);
      continue;
    }
    const ok = await storage.put(row.storage_key, row.pending_bytes, row.content_type);
    if (ok) {
      await pool.query(
        `UPDATE attachments SET status = 'available', pending_bytes = NULL,
           claimed_by = NULL, claimed_at = NULL WHERE id = $1`,
        [row.id],
      );
    } else {
      await pool.query("UPDATE attachments SET claimed_by = NULL, claimed_at = NULL WHERE id = $1", [
        row.id,
      ]);
    }
  }
}

interface PendingDeletionRow {
  id: string;
  prefix: string;
}

/** Claim and drain pending object deletions (DP-46). */
export async function drainPendingDeletions(pool: Pool): Promise<void> {
  const claimed = await pool.query<PendingDeletionRow>(
    `UPDATE pending_object_deletions SET claimed_by = $1, claimed_at = now()
     WHERE id IN (
       SELECT id FROM pending_object_deletions
       WHERE done = FALSE
         AND (claimed_by IS NULL OR claimed_at < now() - interval '2 minutes')
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 20
     )
     RETURNING id, prefix`,
    [INSTANCE_ID],
  );
  for (const row of claimed.rows) {
    const empty = await storage.removePrefix(row.prefix);
    if (empty) {
      await pool.query(
        "UPDATE pending_object_deletions SET done = TRUE, claimed_by = NULL, claimed_at = NULL WHERE id = $1",
        [row.id],
      );
    } else {
      await pool.query(
        "UPDATE pending_object_deletions SET claimed_by = NULL, claimed_at = NULL WHERE id = $1",
        [row.id],
      );
    }
  }
}

interface OutboxRow {
  id: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  text_body: string;
  html_body: string;
}

/** Claim and send unsent outbox rows (DP-27, DP-35). */
export async function sendOutbox(pool: Pool, config: Config): Promise<void> {
  const claimed = await pool.query<OutboxRow>(
    `UPDATE outbox SET claimed_by = $1, claimed_at = now()
     WHERE id IN (
       SELECT id FROM outbox
       WHERE sent_at IS NULL
         AND (claimed_by IS NULL OR claimed_at < now() - interval '2 minutes')
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 20
     )
     RETURNING id, to_email, to_name, subject, text_body, html_body`,
    [INSTANCE_ID],
  );
  for (const row of claimed.rows) {
    const sent = await sendSmtp(
      {
        toEmail: row.to_email,
        toName: row.to_name,
        subject: row.subject,
        textBody: row.text_body,
        htmlBody: row.html_body,
      },
      config,
    );
    if (sent) {
      await pool.query(
        "UPDATE outbox SET sent_at = now(), claimed_by = NULL, claimed_at = NULL WHERE id = $1",
        [row.id],
      );
    } else {
      await pool.query("UPDATE outbox SET claimed_by = NULL, claimed_at = NULL WHERE id = $1", [
        row.id,
      ]);
    }
  }
}

export function startWorkers(pool: Pool, config: Config): NodeJS.Timeout[] {
  const attachmentTimer = setInterval(
    () => {
      void uploadPendingAttachments(pool, config).catch(() => undefined);
    },
    config.attachmentRetrySeconds * 1000,
  );
  const deletionTimer = setInterval(
    () => {
      void drainPendingDeletions(pool).catch(() => undefined);
    },
    config.attachmentRetrySeconds * 1000,
  );
  const outboxTimer = setInterval(
    () => {
      void sendOutbox(pool, config).catch(() => undefined);
    },
    config.outboxRetrySeconds * 1000,
  );
  // Each worker also runs once at start so pending work is picked up early.
  void uploadPendingAttachments(pool, config).catch(() => undefined);
  void drainPendingDeletions(pool).catch(() => undefined);
  void sendOutbox(pool, config).catch(() => undefined);
  return [attachmentTimer, deletionTimer, outboxTimer];
}
