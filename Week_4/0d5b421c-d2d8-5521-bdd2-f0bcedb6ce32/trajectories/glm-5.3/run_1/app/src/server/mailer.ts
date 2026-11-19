import nodemailer from "nodemailer";
import type { Config } from "./config.js";
import { token } from "./idempotency.js";

export interface QueuedEmail {
  id: string;
  to_email: string;
  subject: string;
  body: string;
}

/** Queue an email in the outbox (part of the committing transaction conceptually; inserted right after commit). */
export async function queueEmail(pool: import("pg").Pool, email: Omit<QueuedEmail, "id">): Promise<QueuedEmail> {
  const id = token(16);
  await pool.query(
    `INSERT INTO outbox_emails (id, to_email, subject, body) VALUES ($1, $2, $3, $4)`,
    [id, email.to_email, email.subject, email.body],
  );
  return { id, ...email };
}

/** Background sender: each queued email is sent exactly once, retried until accepted. */
export class Mailer {
  private transporter: nodemailer.Transporter;
  private from: string;
  private stopped = false;

  constructor(cfg: Config) {
    this.from = cfg.mailFrom;
    this.transporter = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
  }

  async start(pool: import("pg").Pool): Promise<void> {
    // Loop: pick unsent emails in order and deliver them.
    const tick = async () => {
      while (!this.stopped) {
        let next: { id: string; to_email: string; subject: string; body: string } | null = null;
        try {
          const res = await pool.query<{ id: string; to_email: string; subject: string; body: string }>(
            `SELECT id, to_email, subject, body FROM outbox_emails WHERE sent_at IS NULL ORDER BY created_at, id LIMIT 1`,
          );
          if (res.rows.length > 0) next = res.rows[0];
        } catch { /* db hiccup */ }
        if (!next) { await sleep(300); continue; }
        const claimed = await pool.query(
          `UPDATE outbox_emails SET sent_at = now() WHERE id = $1 AND sent_at IS NULL RETURNING id`,
          [next.id],
        );
        if (claimed.rows.length === 0) continue;
        try {
          await this.transporter.sendMail({
            from: this.from,
            to: next.to_email,
            subject: next.subject,
            text: next.body,
          });
        } catch {
          // Delivery failed: retry until accepted.
          await pool.query(`UPDATE outbox_emails SET sent_at = NULL WHERE id = $1`, [next.id]);
          await sleep(1000);
        }
      }
    };
    void tick();
  }

  stop(): void {
    this.stopped = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Email body builders. Each quoted line appears on its own line, character for character. */
/** `<when>`: the slot's Lisbon date and time as `<Ddd> <D> <Mon> at <HH:MM>`. */
export function whenLine(startsAt: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(startsAt);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  const mo = parts.find((p) => p.type === "month")?.value ?? "";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "";
  const mi = parts.find((p) => p.type === "minute")?.value ?? "";
  return `${wd} ${d} ${mo} at ${hh}:${mi}`;
}

/** The offer's expiry in Lisbon time as HH:MM:SS. */
export function offerExpiryLine(expiresAt: Date): string {
  const t = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(expiresAt);
  return t;
}

export function euro(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function confirmationEmail(
  booking: { reference: string; starts_at: Date; party_size: number; table_id: string; room: string },
  manageUrl: string, depositCents: number,
): { subject: string; body: string } {
  const when = whenLine(booking.starts_at);
  const depositLine = depositCents > 0 ? `Deposit paid: €${euro(depositCents)}` : `No deposit`;
  return {
    subject: `Booking confirmed: ${booking.reference}`,
    body: [
      `Your table is booked for ${when}, Lisbon time.`,
      `Party of ${booking.party_size}`,
      `Table ${booking.table_id}, ${booking.room}`,
      `Manage your booking: ${manageUrl}`,
      depositLine,
    ].join("\r\n"),
  };
}

export function cancellationEmail(
  booking: { reference: string; starts_at: Date; deposit_cents: number },
  outcome: "refunded" | "kept" | "none",
): { subject: string; body: string } {
  const when = whenLine(booking.starts_at);
  const line = outcome === "refunded"
    ? `Your deposit of €${euro(booking.deposit_cents)} has been refunded.`
    : outcome === "kept"
      ? `Your deposit of €${euro(booking.deposit_cents)} has been kept under our 24-hour policy.`
      : `No deposit was taken.`;
  return {
    subject: `Booking cancelled: ${booking.reference}`,
    body: [
      `Your booking for ${when} has been cancelled.`,
      line,
    ].join("\r\n"),
  };
}

export function offerEmail(
  offer: { starts_at: Date; table_id: string; room: string; party_size: number; expires_at: Date; deposit_cents: number },
  offerUrl: string,
): { subject: string; body: string } {
  const when = whenLine(offer.starts_at);
  const lines = [
    `Table ${offer.table_id}, ${offer.room}`,
    `Party of ${offer.party_size}`,
    `Claim it here: ${offerUrl}`,
    `This offer ends at ${offerExpiryLine(offer.expires_at)} Lisbon time.`,
  ];
  if (offer.deposit_cents > 0) {
    lines.push(`Claiming charges a deposit of €${euro(offer.deposit_cents)}.`);
  }
  return { subject: `A table is free: ${when}`, body: lines.join("\r\n") };
}

export function lapsedEmail(offer: { starts_at: Date }): { subject: string; body: string } {
  const when = whenLine(offer.starts_at);
  return {
    subject: `Your table offer has lapsed`,
    body: `Your offer for ${when} ended unclaimed.`,
  };
}
