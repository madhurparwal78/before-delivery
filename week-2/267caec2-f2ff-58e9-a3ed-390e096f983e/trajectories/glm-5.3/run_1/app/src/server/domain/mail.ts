import type { Db } from "../db.js";
import type { Queryable } from "../db.js";
import { newId, rows } from "../db.js";
import type { Mailer } from "../providers/smtp.js";

export type EmailKind = "receipt" | "refund" | "invitation" | "results";

export interface QueuedEmail {
  id: string;
  kind: EmailKind;
  to_email: string;
  subject: string;
  body: string;
  queued_at: Date;
  sent_at: Date | null;
}

/** Enqueue inside the caller's transaction, in the same step as the causing action. */
export async function enqueueEmail(client: Queryable, kind: EmailKind, to: string, subject: string, body: string, queuedAt: Date = new Date()): Promise<void> {
  await (client as { query(text: string, params: unknown[]): Promise<unknown> }).query(
    "INSERT INTO email_queue (id, kind, to_email, subject, body, queued_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [newId("mail"), kind, to, subject, body, queuedAt],
  );
}



export async function sendPendingEmails(db: Db, mailer: Mailer): Promise<number> {
  const pending = await rows<QueuedEmail>(
    db,
    "SELECT * FROM email_queue WHERE sent_at IS NULL ORDER BY queued_at ASC LIMIT 50",
  );
  let sent = 0;
  for (const email of pending) {
    const result = await mailer.send(email.to_email, email.subject, email.body);
    if (result.ok) {
      await db.query("UPDATE email_queue SET sent_at = now(), last_error = NULL WHERE id = $1", [email.id]);
      sent += 1;
    } else {
      await db.query("UPDATE email_queue SET last_error = $2 WHERE id = $1", [email.id, result.error ?? "send failed"]);
      // Retry the rest on the next pass; Mailpit is unreachable.
      break;
    }
  }
  return sent;
}

export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export interface ReceiptEmailData {
  entryNumber: number;
  title: string;
  categoryName: string;
  feeCents: number;
  tierLabel: string;
  invoiceId: string;
  deadlineLabel: string;
}

export function receiptEmail(data: ReceiptEmailData): { subject: string; body: string } {
  return {
    subject: `Cutline receipt: Entry ${data.entryNumber} — ${data.title}`,
    body: [
      `Entry ${data.entryNumber} — ${data.title} (${data.categoryName})`,
      `Entry fee: $${dollars(data.feeCents)} (${data.tierLabel} tier)`,
      `Invoice: ${data.invoiceId}`,
      `Withdraw before ${data.deadlineLabel} for a full refund.`,
    ].join("\n"),
  };
}

export function refundEmail(entryNumber: number, title: string, feeCents: number): { subject: string; body: string } {
  return {
    subject: `Cutline refund: Entry ${entryNumber} — ${title}`,
    body: `Entry ${entryNumber} — ${title} has been withdrawn. $${dollars(feeCents)} refunded.`,
  };
}

export interface InvitationEmailData {
  categoryName: string;
  roundName: string;
  ballotDeadlineLabel: string;
  assigned: number;
}

export function invitationEmail(data: InvitationEmailData): { subject: string; body: string } {
  return {
    subject: `Cutline jury invitation: ${data.categoryName} — ${data.roundName}`,
    body: [
      `You are invited to judge ${data.categoryName} — ${data.roundName}.`,
      `Ballot deadline: ${data.ballotDeadlineLabel}`,
      `${data.assigned} entries assigned.`,
      `Open your ballot at /jury`,
    ].join("\n"),
  };
}

export interface ResultsLine {
  entryNumber: number;
  title: string;
  outcome: string;
  score: string;
}

export function resultsEmail(categoryName: string, year: number, lines: ResultsLine[]): { subject: string; body: string } {
  return {
    subject: `Cutline results: ${categoryName} ${year}`,
    body: lines.map((l) => `Entry ${l.entryNumber} — ${l.title}: ${l.outcome} (${l.score})`).join("\n"),
  };
}
