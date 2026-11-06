// Outbound email: every message is written to the queue in the database first (in the same commit as the
// change it reports) and delivered later by any instance. Bodies carry nothing from the privacy list.
import { coopTime } from "../shared/coop-time.js";
import { dollars } from "../shared/money.js";
import { query, type Client } from "./db.js";
import type { LicenceRow } from "./licence-state.js";

export type MailKind = "alert" | "receipt" | "warning" | "takedown";

interface Draft {
  kind: MailKind;
  essayId: string;
  licenceId: string | null;
  to: string[];
  subject: string;
  body: string;
}

const SIGN_OFF = "\nSaltprint Desk\nSaltprint Picture Co-operative\n";

async function queue(client: Client, draft: Draft): Promise<void> {
  for (const to of new Set(draft.to.map((t) => t.toLowerCase()))) {
    await query(
      `INSERT INTO mail_queue (kind, essay_id, licence_id, recipient, subject, body) VALUES ($1, $2, $3, $4, $5, $6)`,
      [draft.kind, draft.essayId, draft.licenceId, to, draft.subject, draft.body], client);
  }
}

export interface EssayLine {
  id: string;
  title: string;
  creditLine: string;
}

/** The licensing picture editor and every licensing manager of their newsroom. */
export async function licenceRecipients(client: Client, licence: LicenceRow): Promise<string[]> {
  const rows = await query<{ email: string }>(
    `SELECT email FROM people WHERE id = $1
     UNION SELECT email FROM people WHERE newsroom = $2 AND role = 'licensing_manager'`,
    [licence.licensed_by, licence.newsroom], client);
  return rows.map((r) => r.email);
}

export async function queueReceipt(client: Client, essay: EssayLine, licence: LicenceRow): Promise<void> {
  await queue(client, {
    kind: "receipt", essayId: essay.id, licenceId: licence.id, to: await licenceRecipients(client, licence),
    subject: `Licence receipt: ${essay.title}`,
    body: [
      "Your newsroom's licence is active and invoiced.", "",
      `Essay: ${essay.title}`,
      `Credit: ${essay.creditLine}`,
      `Kind: ${licence.kind}`,
      `Window starts: ${coopTime(licence.confirmed_at)}`,
      `Window ends: ${coopTime(licence.window_end)}`,
      `Amount: ${dollars(licence.amount_minor)} USD`,
      `Licence: ${licence.id}`, "",
      "Originals can be downloaded from the Licences screen while the licence runs.", SIGN_OFF,
    ].join("\n"),
  });
}

export async function queueExpiryWarning(client: Client, essay: EssayLine, licence: LicenceRow): Promise<void> {
  await queue(client, {
    kind: "warning", essayId: essay.id, licenceId: licence.id, to: await licenceRecipients(client, licence),
    subject: `Licence ending in 24 hours: ${essay.title}`,
    body: [
      `Your newsroom's ${licence.kind} licence ends in 24 hours.`, "",
      `Essay: ${essay.title}`,
      `Kind: ${licence.kind}`,
      `Ends: ${coopTime(licence.window_end)}`,
      `Licence: ${licence.id}`, "",
      "After the end, originals can no longer be downloaded.", SIGN_OFF,
    ].join("\n"),
  });
}

export async function queueLiftAlert(client: Client, essay: EssayLine, liftAt: Date, to: string[]): Promise<void> {
  await queue(client, {
    kind: "alert", essayId: essay.id, licenceId: null, to,
    subject: `Embargo lifted: ${essay.title}`,
    body: [
      "An essay you follow is now live on the Saltprint contact sheet.", "",
      `Essay: ${essay.title}`,
      `Credit: ${essay.creditLine}`,
      `Lifted: ${coopTime(liftAt)}`, SIGN_OFF,
    ].join("\n"),
  });
}

export async function queueTakedownNotice(client: Client, essay: EssayLine, to: string, licenceIds: string[]): Promise<void> {
  await queue(client, {
    kind: "takedown", essayId: essay.id, licenceId: null, to: [to],
    subject: `Takedown notice: ${essay.title}`,
    body: [
      "Saltprint has taken this essay down after a legal request.", "",
      `Essay: ${essay.title}`,
      `Revoked licences: ${licenceIds.join(", ")}`, "",
      "Stop all use of this essay and delete stored copies.", SIGN_OFF,
    ].join("\n"),
  });
}

/** Cancels every unsent email about an essay (optionally only some kinds). */
export async function cancelEssayMail(client: Client, essayId: string, kinds?: MailKind[]): Promise<void> {
  await query(
    `UPDATE mail_queue SET state = 'cancelled' WHERE essay_id = $1 AND state = 'queued'${kinds ? " AND kind = ANY($2)" : ""}`,
    kinds ? [essayId, kinds] : [essayId], client);
}

/** A licence's receipt state: null before activation, otherwise queued / sent / cancelled across its recipients. */
export function receiptState(states: string[]): "queued" | "sent" | "cancelled" | null {
  if (!states.length) return null;
  if (states.includes("queued")) return "queued";
  if (states.includes("cancelled")) return "cancelled";
  return "sent";
}
