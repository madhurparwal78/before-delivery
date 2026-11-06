// Outbound email: rows queued in PostgreSQL in the same transaction as the change they report,
// delivered to the mail sink exactly once each, and retried while the sink is unreachable.

import { randomUUID } from "node:crypto";
import { formatHours, formatMoney, clock } from "../shared/rules.js";
import { now } from "./clock.js";
import { tx, type Db } from "./db.js";
import { kitchenName, stationName } from "./kitchen.js";
import { sendMail } from "./smtp.js";

type MailKind = "booking_confirmed" | "booking_cancelled" | "expiry_warning" | "invoice_notice";

interface InvoiceNoticeParams {
  amount_cents: number;
  description: string;
}

/** Queues one email per state change; the dedupe key makes a second queueing of the same change a no-op. */
export async function enqueueMail(db: Db, kind: MailKind, dedupeKey: string, ref: string, recipient: string, params: InvoiceNoticeParams | Record<string, never> = {}): Promise<void> {
  await db.query(
    `INSERT INTO mail_outbox (id, dedupe_key, kind, ref, params, recipient, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (dedupe_key) DO NOTHING`,
    [`mail_${randomUUID().replaceAll("-", "")}`, dedupeKey, kind, ref, JSON.stringify(params), recipient, new Date(now())],
  );
}

export async function enqueueInvoiceNotice(db: Db, memberId: string, chargeRef: string, amountCents: number, description: string): Promise<void> {
  const contact = await db.query<{ contact_email: string }>("SELECT contact_email FROM members WHERE id = $1", [memberId]);
  await enqueueMail(db, "invoice_notice", `invoice-notice:${chargeRef}`, chargeRef, contact.rows[0]?.contact_email ?? "", {
    amount_cents: amountCents,
    description,
  });
}

interface OutboxRow {
  id: string;
  kind: MailKind;
  ref: string;
  params: InvoiceNoticeParams;
  recipient: string;
}

interface BookingMailRow {
  station_id: string;
  date: string;
  start_minute: number;
  end_minute: number;
  tail_end_minute: number;
  prepaid_minutes: number;
  overage_cents: number;
  payment: string;
  fee_cents: number | null;
}

async function renderBooking(db: Db, row: OutboxRow): Promise<{ subject: string; text: string }> {
  const found = await db.query<BookingMailRow>(
    `SELECT station_id, date, start_minute, end_minute, tail_end_minute, prepaid_minutes, overage_cents, payment, fee_cents
       FROM bookings WHERE id = $1`,
    [row.ref],
  );
  const b = found.rows[0];
  if (!b) throw new Error(`booking ${row.ref} missing for mail ${row.id}`);
  const station = stationName(b.station_id);
  const span = `${clock(b.start_minute)}–${clock(b.end_minute)}`;
  if (row.kind === "booking_confirmed") {
    const lines = [
      `Your booking at ${kitchenName()} is confirmed.`,
      "",
      `Station: ${station}`,
      `Date: ${b.date}`,
      `Time: ${span}`,
      `Cleaning turnover until ${clock(b.tail_end_minute)}`,
      `Prepaid hours used: ${formatHours(b.prepaid_minutes)}`,
      `Overage: $${formatMoney(b.overage_cents)}`,
    ];
    if (b.payment === "payment_pending") lines.push("Payment pending");
    return { subject: `Booking confirmed: ${station} on ${b.date}`, text: lines.join("\n") };
  }
  const lines = [
    `Your booking at ${kitchenName()} is cancelled.`,
    "",
    `Station: ${station}`,
    `Date: ${b.date}`,
    `Time: ${span}`,
    `Hours returned: ${formatHours(b.prepaid_minutes)}`,
    b.fee_cents === null ? "No cancellation fee" : `Late-cancellation fee: $${formatMoney(b.fee_cents)}`,
  ];
  return { subject: `Booking cancelled: ${station} on ${b.date}`, text: lines.join("\n") };
}

async function renderWarning(db: Db, row: OutboxRow): Promise<{ subject: string; text: string }> {
  const [documentId, days] = row.ref.split("|");
  const found = await db.query<{ kind: string; expires_on: string; crew_name: string | null }>(
    `SELECT d.kind, d.expires_on, u.name AS crew_name FROM documents d LEFT JOIN users u ON u.id = d.crew_cook_id WHERE d.id = $1`,
    [documentId],
  );
  const doc = found.rows[0];
  if (!doc) throw new Error(`document ${documentId} missing for mail ${row.id}`);
  const label = doc.kind === "liability_insurance" ? "Liability insurance" : `Food handler card – ${doc.crew_name ?? ""}`;
  return {
    subject: `Certificate expires in ${days} days: ${label}`,
    text: [
      `${label} on file with ${kitchenName()} expires on ${doc.expires_on}.`,
      "",
      `It covers bookings through ${doc.expires_on}. Upload the renewed certificate on Documents so bookings and check-ins are not refused.`,
    ].join("\n"),
  };
}

async function render(db: Db, row: OutboxRow): Promise<{ subject: string; text: string }> {
  switch (row.kind) {
    case "booking_confirmed":
    case "booking_cancelled":
      return renderBooking(db, row);
    case "expiry_warning":
      return renderWarning(db, row);
    case "invoice_notice": {
      const amount = formatMoney(row.params.amount_cents);
      return {
        subject: `Invoice notice: $${amount} for ${row.params.description}`,
        text: [`A charge of $${amount} for ${row.params.description} was recorded on your ${kitchenName()} billing account.`, "", "Your invoices are listed on Invoices in Passboard."].join("\n"),
      };
    }
  }
}

let delivering = false;
let deliverAgain = false;

/** Sends every queued email once; a row is marked sent in the same transaction that sends it. */
export async function deliverMail(): Promise<void> {
  if (delivering) {
    deliverAgain = true;
    return;
  }
  delivering = true;
  try {
    do {
      deliverAgain = false;
      const queued = await tx((db) => db.query<{ id: string }>("SELECT id FROM mail_outbox WHERE NOT sent ORDER BY created_at LIMIT 50"));
      for (const { id } of queued.rows) {
        await tx(async (db) => {
          const locked = await db.query<OutboxRow>(
            "SELECT id, kind, ref, params, recipient FROM mail_outbox WHERE id = $1 AND NOT sent FOR UPDATE SKIP LOCKED",
            [id],
          );
          const row = locked.rows[0];
          if (!row) return;
          const { subject, text } = await render(db, row);
          await sendMail({ to: row.recipient, subject, text, sentAt: new Date(now()) });
          await db.query("UPDATE mail_outbox SET sent = true WHERE id = $1", [id]);
        });
      }
    } while (deliverAgain);
  } finally {
    delivering = false;
  }
}

export function kickMail(): void {
  deliverMail().catch(() => undefined);
}
