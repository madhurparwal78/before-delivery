import { formatPounds } from "../shared/money.js";
import { config } from "./config.js";
import { rows, pool, type Db } from "./db.js";
import { sendMail } from "./mail.js";
import { describe } from "./http.js";
import { newId } from "./people.js";

// The notice ledger (brief: Services › Mail). A notice is recorded in the same transaction as the event
// that makes it due; the sender loop delivers queued notices and retries every 10 s while mail is down.

export type NoticeKind =
  | "pledge_receipt" | "pledge_cancelled" | "funded_charged" | "not_funded"
  | "campaign_cancelled" | "fix_payment" | "dropped" | "settlement_ready";

interface NoticeFacts {
  title: string;
  amount?: number;
  fixCode?: string;
  fixDeadline?: Date;
}

function compose(kind: NoticeKind, f: NoticeFacts): { subject: string; body: string } {
  const amount = formatPounds(f.amount ?? 0);
  const pledges = `${config.publicUrl}/pledges`;
  switch (kind) {
    case "pledge_receipt":
      return { subject: `Pledge held: ${f.title}`, body: `Your pledge of ${amount} to ${f.title} is in place.\n\nYour card is held, not charged. You are charged only if the run is funded by its deadline.\n\nYour pledges: ${pledges}\n` };
    case "pledge_cancelled":
      return { subject: `Pledge cancelled: ${f.title}`, body: `Your pledge of ${amount} to ${f.title} is cancelled. The hold on your card was released.\n\nYour pledges: ${pledges}\n` };
    case "funded_charged":
      return { subject: `Funded and charged: ${f.title}`, body: `${f.title} reached its minimum run. Your card was charged ${amount}.\n\nYour statement will be ready on your pledges page: ${pledges}\n` };
    case "not_funded":
      return { subject: `Not funded, card released: ${f.title}`, body: `${f.title} did not reach its minimum run by the deadline. The hold of ${amount} on your card was released and nothing was charged.\n` };
    case "campaign_cancelled":
      return { subject: `Campaign cancelled: ${f.title}`, body: `The creator cancelled ${f.title}. The hold of ${amount} on your card was released and nothing was charged.\n` };
    case "fix_payment":
      return { subject: `Fix your payment: ${f.title}`, body: `${f.title} is funded, but your card could not be charged ${amount}.\n\nEnter a working card before ${f.fixDeadline?.toISOString()} to keep your pledge:\n${config.publicUrl}/fix/${f.fixCode}\n` };
    case "dropped":
      return { subject: `Pledge dropped: ${f.title}`, body: `The fix window for ${f.title} has closed and ${amount} could not be collected, so your pledge was dropped. Every hold on your card was released.\n` };
    case "settlement_ready":
      return { subject: `Settlement ready: ${f.title}`, body: `The settlement sheet for ${f.title} is ready. Net to creator: ${amount}.\n\nDownload it from the Studio: ${config.publicUrl}/studio\n` };
  }
}

let wake: (() => void) | null = null;

export async function recordNotice(db: Db, campaignId: string, kind: NoticeKind, to: string, facts: NoticeFacts): Promise<void> {
  const { subject, body } = compose(kind, facts);
  await db.query(
    "INSERT INTO notices (id, campaign_id, kind, to_email, subject, body, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)",
    [newId(), campaignId, kind, to, subject, body, new Date()],
  );
  setImmediate(() => wake?.());
}

interface QueuedNotice {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

let lastFailure = 0;
let sending = false;

async function deliverQueued(): Promise<void> {
  if (sending || Date.now() - lastFailure < 10_000) return;
  sending = true;
  try {
    const queued = await rows<QueuedNotice>(pool, "SELECT id, to_email, subject, body FROM notices WHERE status = 'queued' ORDER BY created_at LIMIT 50");
    for (const notice of queued) {
      try {
        await sendMail(notice.to_email, notice.subject, notice.body);
      } catch {
        lastFailure = Date.now();
        return;
      }
      await pool.query("UPDATE notices SET status = 'sent', sent_at = $2 WHERE id = $1", [notice.id, new Date()]);
    }
  } finally {
    sending = false;
  }
}

export function startMailer(): void {
  wake = () => void deliverQueued().catch((error: unknown) => console.error(`mailer: ${describe(error)}`));
  setInterval(wake, 1000);
}
