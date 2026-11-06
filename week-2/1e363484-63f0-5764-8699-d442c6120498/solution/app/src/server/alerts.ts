// Broken-seal alerts. Queued in the same commit as the break; each queued alert is claimed with a row
// lock (FOR UPDATE SKIP LOCKED) by exactly one instance at a time, and marked sent in the same
// transaction once the mail sink has accepted it.

import type { Project } from "./auth.js";
import { config } from "./config.js";
import { transaction, type Db } from "./db.js";
import { tonnes } from "./domain/derivation.js";
import { nowSeconds } from "./domain/time.js";
import type { StoredFigure } from "./figures.js";
import { MailUnavailable, sendMail } from "./mail.js";

export async function queueBrokenSealAlert(db: Db, project: Project, figure: StoredFigure, moved: number,
  reversedMilli: bigint, now: number): Promise<void> {
  const subject = `Seal broken on ${figure.id} (readings moved: ${moved})`;
  const body = [
    `Figure: ${figure.id}`,
    `Readings moved: ${moved}`,
    `Reversed: ${tonnes(reversedMilli)} tCO2e`,
    `Audit trail: ${config.publicUrl}/projects/${project.slug}/figures/${figure.id}/audit`,
  ].join("\n");
  await db.query(
    `INSERT INTO broken_seal_alerts (figure_id, recipients, subject, body, queued_at)
     SELECT $1, array_agg(DISTINCT email), $2, $3, to_timestamp($4) FROM people WHERE id IN ($5, $6)`,
    [figure.id, subject, body, now, project.leadPersonId, figure.sealed_by]);
}

/** Sends one queued alert; false when none is waiting or the sink refused it. */
async function deliverOne(): Promise<boolean> {
  return transaction(async (db) => {
    const { rows } = await db.query<{ id: number; recipients: string[]; subject: string; body: string }>(
      `SELECT id, recipients, subject, body FROM broken_seal_alerts
        WHERE sent_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const alert = rows[0];
    if (!alert) return false;
    await sendMail({ to: alert.recipients, subject: alert.subject, lines: alert.body.split("\n") });
    await db.query("UPDATE broken_seal_alerts SET sent_at = to_timestamp($2) WHERE id = $1", [alert.id, nowSeconds()]);
    return true;
  }).catch((error: unknown) => {
    if (!(error instanceof MailUnavailable)) console.error(`alert delivery deferred: ${error instanceof Error ? error.name : "error"}`);
    return false;
  });
}

/** Sends queued alerts until none is left or the sink refuses one (it is retried on the next round). */
export async function deliverQueuedAlerts(): Promise<void> {
  while (await deliverOne());
}
