import type { Sql } from "../db.js";
import { Mailer } from "../mail.js";
import { formatCoopTime, dollarsWithCommas, isoInstant } from "../../shared/time.js";

// Licence mail: receipts on activation, expiry warnings 24 elapsed hours before
// the end instant, embargo-lift alerts and takedown notices. Each person gets
// one message per recipient row.
export interface MailRecipient {
  email: string;
}

export async function licenceRecipients(sql: Sql, newsroomId: number, licensedBy: number): Promise<MailRecipient[]> {
  const rows = await sql`
    SELECT DISTINCT email FROM people
    WHERE id = ${licensedBy} OR (newsroom_id = ${newsroomId} AND role = 'licensing_manager')
    ORDER BY email`;
  return rows as unknown as MailRecipient[];
}

export function receiptSubject(title: string): string {
  return `Licence receipt: ${title}`;
}

export function receiptBody(row: {
  title: string;
  credit_line: string;
  kind: string;
  windowStart: number;
  windowEnd: number;
  amountMinor: number;
  licenceId: string;
}): string {
  return [
    `Saltprint Desk licence receipt`,
    ``,
    `Essay: ${row.title}`,
    `Credit line: ${row.credit_line}`,
    `Kind: ${row.kind}`,
    `Window start: ${formatCoopTime(row.windowStart)}`,
    `Window end: ${formatCoopTime(row.windowEnd)}`,
    `Amount: ${dollarsWithCommas(row.amountMinor)} USD`,
    `Licence: ${row.licenceId}`,
  ].join("\r\n");
}

export function warningSubject(title: string): string {
  return `Licence ending in 24 hours: ${title}`;
}

export function warningBody(row: { title: string; kind: string; windowEnd: number; licenceId: string }): string {
  return [
    `Your Saltprint Desk licence is ending soon.`,
    ``,
    `Essay: ${row.title}`,
    `Kind: ${row.kind}`,
    `Window end: ${formatCoopTime(row.windowEnd)}`,
    `Licence: ${row.licenceId}`,
  ].join("\r\n");
}

export function liftSubject(title: string): string {
  return `Embargo lifted: ${title}`;
}

export function liftBody(row: { title: string; credit_line: string; liftAt: number }): string {
  return [
    `The embargo has lifted on a Saltprint Desk essay.`,
    ``,
    `Essay: ${row.title}`,
    `Credit line: ${row.credit_line}`,
    `Lift: ${formatCoopTime(row.liftAt)}`,
  ].join("\r\n");
}

export function takedownSubject(title: string): string {
  return `Takedown notice: ${title}`;
}

export function takedownBody(row: { title: string; licenceIds: string[] }): string {
  return [
    `A Saltprint Desk essay has been taken down following a legal request.`,
    ``,
    `Essay: ${row.title}`,
    `Revoked licences: ${row.licenceIds.join(", ")}`,
    `Stop all use of this essay and delete stored copies.`,
  ].join("\r\n");
}

export async function queueLicenceMail(
  sql: Sql,
  mailer: Mailer,
  kind: "licence_receipt" | "expiry_warning",
  recipients: MailRecipient[],
  essayId: string,
  licenceId: string,
  subject: string,
  body: string,
): Promise<void> {
  for (const r of recipients) {
    await mailer.queue(sql, { kind, to: r.email, subject, body, essayId, licenceId });
  }
}

export function mailInstant(ms: number): string {
  return `${isoInstant(ms)} (${formatCoopTime(ms)})`;
}
