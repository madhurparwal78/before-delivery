// Every email is a row in outbound_mail, rendered once when queued and delivered byte for byte.

import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { one, query, transaction } from "./db.js";

/** MAIL_FROM as `Name <address>` or a bare address. */
function parseSender(): Mailbox {
  const named = /^(.*?)\s*<([^<>\s]+)>$/.exec(config.smtp.from);
  return named
    ? { name: (named[1] ?? "").replace(/^"(.*)"$/, "$1"), address: named[2] ?? "" }
    : { name: "", address: config.smtp.from };
}

const SENDER = parseSender();

const MAIL_KINDS = ["receipt", "alert", "proposal", "month_held", "deposit"] as const;
type MailKind = (typeof MAIL_KINDS)[number];
export type DeliveryState = "sent" | "pending" | "cancelled";

/**
 * Proposal-email cancellation, decided here only: a pending proposal email is void once its enquiry is declined
 * or its accept link reaches its expiry instant while still in proposal_sent. Over aliases `e` (enquiries) and
 * `pp` (proposals).
 */
export const PROPOSAL_MAIL_VOID =
  "(e.status = 'declined' OR (e.status = 'proposal_sent' AND pp.expires_at <= clock_timestamp()))";

export interface Mailbox {
  name: string;
  address: string;
}

export interface Letter {
  kind: MailKind;
  enquiryId: string;
  to: Mailbox;
  replyTo?: Mailbox;
  subject: string;
  text: string;
}

const PRINTABLE_ASCII = /^[\u0020-\u007e]*$/;

/** RFC 2047 encoded words, each holding whole UTF-8 characters and at most 45 bytes. */
function encodedWords(text: string): string[] {
  const words: string[] = [];
  let chunk = "";
  for (const character of text) {
    if (Buffer.byteLength(chunk + character) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`);
}

function displayName(name: string): string {
  if (PRINTABLE_ASCII.test(name)) return `"${name.replace(/(["\\])/g, "\\$1")}"`;
  return encodedWords(name).join("\r\n ");
}

function mailbox({ name, address }: Mailbox): string {
  return name ? `${displayName(name)} <${address}>` : `<${address}>`;
}

function subjectHeader(subject: string): string {
  return PRINTABLE_ASCII.test(subject) ? subject : encodedWords(subject).join("\r\n ");
}

function base64Lines(text: string): string {
  const encoded = Buffer.from(text.replace(/\r?\n/g, "\r\n")).toString("base64");
  return encoded.replace(/.{1,76}/g, "$&\r\n");
}

function rfc5322Date(instant: Date): string {
  const [weekday = "", rest = ""] = instant.toUTCString().split(", ");
  return `${weekday}, ${rest.replace("GMT", "+0000")}`;
}

function render(letter: Letter): string {
  const headers = [
    `From: ${mailbox(SENDER)}`,
    `To: ${mailbox(letter.to)}`,
    ...(letter.replyTo ? [`Reply-To: ${mailbox(letter.replyTo)}`] : []),
    `Subject: ${subjectHeader(letter.subject)}`,
    `Date: ${rfc5322Date(new Date())}`,
    `Message-ID: <${randomUUID()}@kettlehole.example>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${base64Lines(letter.text)}`;
}

/**
 * Queues the letter in the caller's transaction, with this instance's MAIL_RETRY_SECONDS as the hold a first
 * failed attempt sets. A second letter of the same kind for one enquiry is ignored.
 */
export async function queueMail(client: PoolClient, letter: Letter, state: DeliveryState = "pending"): Promise<void> {
  await client.query(
    `INSERT INTO outbound_mail (id, kind, enquiry_id, recipient, message, state, sent_at, hold_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'sent' THEN now() END, $7)
     ON CONFLICT (kind, enquiry_id) DO NOTHING`,
    [randomUUID(), letter.kind, letter.enquiryId, letter.to.address, render(letter), state, config.mailRetrySeconds],
  );
}

/** Marks a still-pending proposal email cancelled in the caller's step (a decline); waits out a delivery in flight. */
export async function cancelProposalMail(client: PoolClient, enquiryId: string): Promise<void> {
  await client.query(
    "UPDATE outbound_mail SET state = 'cancelled' WHERE enquiry_id = $1 AND kind = 'proposal' AND state = 'pending'",
    [enquiryId],
  );
}

class SmtpSession {
  private buffer = "";
  private waiting: ((line: string) => void) | null = null;
  private failure: Error | null = null;

  private constructor(private readonly socket: Socket) {
    socket.setEncoding("utf8");
    socket.on("data", (data: string) => {
      this.buffer += data;
      this.flush();
    });
    const stop = (error: Error) => {
      this.failure ??= error;
      this.waiting?.("");
    };
    socket.on("error", stop);
    socket.on("close", () => stop(new Error("SMTP connection closed")));
    socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP timeout")));
  }

  static open(): Promise<SmtpSession> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: config.smtp.host, port: config.smtp.port });
      socket.once("connect", () => resolve(new SmtpSession(socket)));
      socket.once("error", reject);
    });
  }

  private flush(): void {
    const reply = /^(?:\d{3}-[^\r\n]*\r\n)*\d{3}(?: [^\r\n]*)?\r\n/.exec(this.buffer);
    if (reply && this.waiting) {
      this.buffer = this.buffer.slice(reply[0].length);
      const deliver = this.waiting;
      this.waiting = null;
      deliver(reply[0]);
    }
  }

  async reply(expected: string): Promise<string> {
    const text = await new Promise<string>((resolve) => {
      this.waiting = resolve;
      this.flush();
      if (this.failure) resolve("");
    });
    if (this.failure || !text.startsWith(expected)) {
      throw this.failure ?? new Error(`SMTP refused: ${text.slice(0, 80)}`);
    }
    return text;
  }

  async command(line: string, expected: string): Promise<string> {
    this.socket.write(`${line}\r\n`);
    return this.reply(expected);
  }

  close(): void {
    this.socket.end("QUIT\r\n");
  }
}

async function transmit(recipient: string, message: string): Promise<void> {
  const session = await SmtpSession.open();
  try {
    await session.reply("220");
    const greeting = await session.command("EHLO earshot.kettlehole.example", "250");
    const utf8 = !PRINTABLE_ASCII.test(recipient) && /SMTPUTF8/i.test(greeting) ? " SMTPUTF8" : "";
    await session.command(`MAIL FROM:<${SENDER.address}>${utf8}`, "250");
    await session.command(`RCPT TO:<${recipient}>`, "25");
    await session.command("DATA", "354");
    const stuffed = message.replace(/\r\n\./g, "\r\n..");
    await session.command(`${stuffed.endsWith("\r\n") ? stuffed : `${stuffed}\r\n`}.`, "250");
  } finally {
    session.close();
  }
}

const DUE = "m.state = 'pending' AND (m.held_until IS NULL OR m.held_until <= now())";

/**
 * One delivery attempt on one due row, holding the row so no other instance or decline acts on it meanwhile.
 * A void proposal email is cancelled instead of sent; a failed first attempt starts the row's hold.
 */
async function attempt(id: string): Promise<void> {
  await transaction(async (client) => {
    const row = await one<{ recipient: string; message: string; cancel: boolean }>(
      `SELECT m.recipient, m.message, (m.kind = 'proposal' AND ${PROPOSAL_MAIL_VOID}) AS cancel
       FROM outbound_mail m JOIN enquiries e ON e.id = m.enquiry_id LEFT JOIN proposals pp ON pp.enquiry_id = m.enquiry_id
       WHERE m.id = $1 AND ${DUE}
       FOR UPDATE OF m SKIP LOCKED`,
      [id],
      client,
    );
    if (!row) return;
    if (row.cancel) {
      await client.query("UPDATE outbound_mail SET state = 'cancelled' WHERE id = $1", [id]);
      return;
    }
    try {
      await transmit(row.recipient, row.message);
    } catch {
      await client.query(
        "UPDATE outbound_mail SET held_until = COALESCE(held_until, now() + make_interval(secs => hold_seconds)) WHERE id = $1",
        [id],
      );
      return;
    }
    await client.query("UPDATE outbound_mail SET state = 'sent', sent_at = now() WHERE id = $1", [id]);
  });
}

/** Tries every due row (optionally only one enquiry's), oldest first. */
async function deliverDue(enquiryId: string | null): Promise<void> {
  const due = await query<{ id: string }>(
    `SELECT m.id FROM outbound_mail m WHERE ${DUE} AND ($1::uuid IS NULL OR m.enquiry_id = $1) ORDER BY m.queued_at`,
    [enquiryId],
  );
  for (const { id } of due) await attempt(id);
}

/** Tries an enquiry's queued letters straight away and reports each kind's state. */
export async function deliverForEnquiry(enquiryId: string): Promise<Map<MailKind, DeliveryState>> {
  await deliverDue(enquiryId).catch(() => undefined);
  const states = await query<{ kind: MailKind; state: DeliveryState }>(
    "SELECT kind, state FROM outbound_mail WHERE enquiry_id = $1",
    [enquiryId],
  );
  return new Map(states.map((row) => [row.kind, row.state]));
}

export function startMailWorker(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    deliverDue(null).catch(() => undefined).finally(() => {
      running = false;
    });
  }, config.mailRetrySeconds * 1000).unref();
}

interface PendingMail {
  kind: MailKind;
  reference_number: number;
  to: string;
  queued_at: Date;
  retry_at: Date | null;
}

/**
 * Every row pending at the moment of the read, a proposal email that reads as cancelled left out; retry_at is the
 * end of the hold the first failed attempt set (null before any failure).
 */
export async function pendingMail(): Promise<PendingMail[]> {
  return query<PendingMail>(
    `SELECT m.kind, e.reference_number, m.recipient AS to, m.queued_at, m.held_until AS retry_at
     FROM outbound_mail m JOIN enquiries e ON e.id = m.enquiry_id LEFT JOIN proposals pp ON pp.enquiry_id = m.enquiry_id
     WHERE m.state = 'pending' AND NOT (m.kind = 'proposal' AND ${PROPOSAL_MAIL_VOID})
     ORDER BY m.queued_at, e.reference_number, array_position($1::text[], m.kind)`,
    [MAIL_KINDS],
  );
}
