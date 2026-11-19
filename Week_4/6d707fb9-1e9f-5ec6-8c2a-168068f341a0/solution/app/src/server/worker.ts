import type { Language } from "../shared/catalog";
import type { Result } from "../shared/api";
import { townName } from "../shared/catalog";
import { addSeconds } from "./figures";
import { config } from "./config";
import { now, pool, transaction } from "./db";
import { deleteObject, sendMail } from "./providers";
import { objectKeysOfLabel, requestMail, resultJson, withdrawPassportsOfLabel } from "./domain";
import { publicAddress } from "./http";
import { storeDossierPdf } from "./routes/dossiers";

const TICK_MS = 1000;

/** Delivers this copy's pending mail; a mail not yet accepted stays queued and is tried again. */
async function deliverMail(): Promise<void> {
  await transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT m.* FROM mail_queue m JOIN labels l ON l.id = m.label_id WHERE l.state = 'open' ORDER BY m.id LIMIT 50 FOR UPDATE OF m SKIP LOCKED`,
    );
    for (const mail of rows) {
      try {
        await sendMail(mail.recipient, mail.subject, mail.body);
      } catch {
        return;
      }
      await tx.query(`DELETE FROM mail_queue WHERE id = $1`, [mail.id]);
    }
  });
}

/** One reminder per address, within 5 seconds after the setting, only while unanswered and not ended. */
async function queueReminders(): Promise<void> {
  const at = now();
  await transaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT r.*, s.name AS style_name, s.label_id, l.name AS label_name FROM requests r
       JOIN styles s ON s.id = r.style_id JOIN labels l ON l.id = s.label_id
       WHERE l.state = 'open' AND r.answered_at IS NULL AND NOT r.ended AND r.reminded_at IS NULL
         AND r.ends_at > $1 AND r.sent_at <= $2 FOR UPDATE OF r SKIP LOCKED`,
      [at, addSeconds(at, -config.reminderAfterSeconds)],
    );
    for (const request of rows) {
      const { subject, body } = requestMail(
        request.language as Language,
        "reminder",
        { label: request.label_name, style: request.style_name, contact: request.contact_name, town: townName(request.town) },
        publicAddress(`/a/${request.token}`),
        request.due_date,
      );
      await tx.query(`INSERT INTO mail_queue (label_id, recipient, subject, body) VALUES ($1, $2, $3, $4)`, [request.label_id, request.contact_email, subject, body]);
      await tx.query(`UPDATE requests SET reminded_at = $2 WHERE id = $1`, [request.id, at]);
    }
  });
}

/** Files of deleted labels are removed from MinIO, retried until confirmed. */
async function removeObjects(labelId: string | null): Promise<boolean> {
  const { rows } = await pool.query(
    labelId === null ? `SELECT object_key FROM object_deletions WHERE label_id IS NULL` : `SELECT object_key FROM object_deletions WHERE label_id = $1`,
    labelId === null ? [] : [labelId],
  );
  let all = true;
  for (const { object_key: key } of rows) {
    if (await deleteObject(key)) await pool.query(`DELETE FROM object_deletions WHERE object_key = $1`, [key]);
    else all = false;
  }
  return all;
}

/** At eraseAt: contacts, queued mail and passports at once; Erased only after MinIO confirmed each deletion. */
async function eraseClosedLabels(): Promise<void> {
  const due = await pool.query(`SELECT id FROM labels WHERE state = 'closed' AND erase_at <= $1`, [now()]);
  for (const { id } of due.rows) {
    await transaction(async (tx) => {
      const label = (await tx.query(`SELECT erase_started FROM labels WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (label.erase_started) return;
      await withdrawPassportsOfLabel(tx, id);
      for (const key of await objectKeysOfLabel(tx, id)) {
        await tx.query(`INSERT INTO object_deletions (object_key, label_id) VALUES ($1, $2) ON CONFLICT (object_key) DO NOTHING`, [key, id]);
      }
      await tx.query(`DELETE FROM mail_queue WHERE label_id = $1`, [id]);
      await tx.query(`UPDATE labels SET contact_name = NULL, contact_email = NULL, erase_started = true WHERE id = $1`, [id]);
      await tx.query(`UPDATE suppliers SET contact_name = NULL, contact_email = NULL WHERE label_id = $1`, [id]);
      await tx.query(`UPDATE requests SET contact_name = '', contact_email = '' WHERE style_id IN (SELECT id FROM styles WHERE label_id = $1)`, [id]);
    });
    if (await removeObjects(id)) {
      await transaction(async (tx) => {
        await tx.query(`DELETE FROM suppliers WHERE label_id = $1`, [id]);
        await tx.query(`DELETE FROM visits WHERE label_id = $1`, [id]);
        await tx.query(`DELETE FROM styles WHERE label_id = $1`, [id]);
        await tx.query(`UPDATE labels SET state = 'erased' WHERE id = $1`, [id]);
      });
    }
  }
}

/** A seeded dossier's PDF, made when Gotenberg and MinIO are first reachable. */
async function makeMissingPdfs(): Promise<void> {
  const { rows } = await pool.query(
    `SELECT d.id, d.assessor_id, s.name, s.gtin, l.name AS label_name, r.* , d.id AS dossier_id
     FROM dossiers d JOIN styles s ON s.id = d.style_id JOIN labels l ON l.id = s.label_id JOIN results r ON r.id = d.result_id
     WHERE NOT d.pdf_stored`,
  );
  for (const row of rows) {
    const result: Result = resultJson(row, row.id);
    try {
      await storeDossierPdf({ name: row.name, gtin: row.gtin, label_name: row.label_name }, result, row.assessor_id, row.dossier_id);
    } catch {
      return;
    }
    await pool.query(`UPDATE dossiers SET pdf_stored = true WHERE id = $1`, [row.dossier_id]);
  }
}

let pdfAttemptAt = 0;

async function tick(): Promise<void> {
  await queueReminders();
  await deliverMail();
  await eraseClosedLabels();
  await removeObjects(null);
  if (Date.now() - pdfAttemptAt > 5000) {
    pdfAttemptAt = Date.now();
    await makeMissingPdfs();
  }
}

export function startWorker(): void {
  const loop = async (): Promise<void> => {
    try {
      await tick();
    } catch (error) {
      console.error(error);
    }
    setTimeout(loop, TICK_MS);
  };
  void loop();
}
