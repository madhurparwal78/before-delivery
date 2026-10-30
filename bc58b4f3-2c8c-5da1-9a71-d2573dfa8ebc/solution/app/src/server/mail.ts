// The email outbox and its SMTP sender. Emails are written to the outbox in the same transaction as the
// change they report, so a retried or replayed request never sends twice; the sender delivers each row once.
import { randomBytes } from "node:crypto";
import { Socket, connect } from "node:net";
import { DateTime } from "luxon";
import { formatRange, formatStamp } from "../shared/time.js";
import { formatDollars } from "../shared/money.js";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { transaction } from "./db.js";
import { type AssignmentRecord, endOf } from "./records.js";
import { seatInitials } from "./views.js";

interface Email {
  subject: string;
  body: string;
}

export async function enqueue(db: Db, recipient: string, email: Email): Promise<void> {
  await db.query("INSERT INTO email_outbox (recipient, subject, body) VALUES ($1, $2, $3)", [
    recipient,
    email.subject,
    email.body,
  ]);
}

function when(record: AssignmentRecord): string {
  return formatRange(record.startAt.toISOString(), endOf(record).toISOString());
}

const SIGN_OFF = "\n\nNorthfold Language Access dispatch\nAll times Central (Chicago).";

export function offerEmail(record: AssignmentRecord): Email {
  const open = record.seats.filter((s) => s.status === "open").length;
  return {
    subject: `Open seat ${record.number}: ${record.languageName}, ${formatStamp(record.startAt.toISOString())}`,
    body:
      `An interpreting appointment is open for claims.\n\n` +
      `Assignment: ${record.number}\nLanguage: ${record.languageName}\nSetting: ${record.setting}\n` +
      `City: ${record.city}\nTime: ${when(record)}\nOpen seats: ${open} of ${record.seats.length}\n\n` +
      `Sign in to Teamseat and open Open seats to claim one. The address and appointment details are shown ` +
      `once a seat is yours.${SIGN_OFF}`,
  };
}

export function seatConfirmedEmail(record: AssignmentRecord, seat: number): Email {
  return {
    subject: `Seat ${seat} confirmed on ${record.number}`,
    body:
      `Seat ${seat} on ${record.number} is yours.\n\n` +
      `Language: ${record.languageName}\nSetting: ${record.setting}\nTime: ${when(record)}\n` +
      `Address: ${record.streetAddress}, ${record.city}\n` +
      `Scheduler: ${record.schedulerName}, ${record.schedulerPhone}\n\n` +
      `The full appointment details are in My seats.${SIGN_OFF}`,
  };
}

export function coveredEmail(record: AssignmentRecord): Email {
  const seats = record.seats
    .map((s) => `Seat ${s.seat}: ${seatInitials(s) ?? "open"}`)
    .join("\n");
  return {
    subject: `${record.number} is fully covered`,
    body:
      `Every seat on ${record.number} is now covered.\n\n` +
      `Language: ${record.languageName}\nTime: ${when(record)}\nCity: ${record.city}\n\n${seats}${SIGN_OFF}`,
  };
}

export function cancelledEmail(record: AssignmentRecord, feeApplies: boolean, feeCents: number): Email {
  const statement = feeApplies ? `A late-cancellation fee of ${formatDollars(feeCents)} applies.` : "No fee applies.";
  return {
    subject: `${record.number} cancelled — ${feeApplies ? "fee applies" : "no fee"}`,
    body:
      `${record.number} (${record.languageName}, ${when(record)}, ${record.city}) has been cancelled.\n\n` +
      `${statement}${SIGN_OFF}`,
  };
}

export function changedEmail(record: AssignmentRecord): Email {
  return {
    subject: `${record.number} changed — no fee`,
    body:
      `${record.number} (${record.languageName}, ${record.city}) has a new time: ${when(record)}.\n` +
      `Every seat was reopened.\n\nNo fee applies.${SIGN_OFF}`,
  };
}

// --- SMTP delivery ---------------------------------------------------------------------------------------

function address(mailbox: string): string {
  const match = /<([^>]+)>/.exec(mailbox);
  return (match ? (match[1] ?? "") : mailbox).trim();
}

function encodedWords(text: string): string {
  const characters = Array.from(text);
  const words: string[] = [];
  for (let index = 0; index < characters.length; index += 18) {
    const piece = characters.slice(index, index + 18).join("");
    words.push(`=?UTF-8?B?${Buffer.from(piece, "utf8").toString("base64")}?=`);
  }
  return words.join("\r\n ");
}

function message(recipient: string, email: Email): string {
  const from = address(config.smtp.from);
  const domain = from.slice(from.indexOf("@") + 1);
  const body = Buffer.from(email.body.replace(/\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${config.smtp.from}`,
    `To: <${recipient}>`,
    `Subject: ${encodedWords(email.subject)}`,
    `Date: ${DateTime.utc().toRFC2822()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** A minimal SMTP conversation: one connection per message, no auth (Mailpit). */
function deliver(recipient: string, email: Email): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = connect(config.smtp.port, config.smtp.host);
    socket.setTimeout(10_000, () => socket.destroy(new Error("SMTP timed out")));
    const steps: Array<[string | null, string]> = [
      [null, "220"],
      ["EHLO teamseat", "250"],
      [`MAIL FROM:<${address(config.smtp.from)}>`, "250"],
      [`RCPT TO:<${recipient}>`, "250"],
      ["DATA", "354"],
      [`${message(recipient, email)}\r\n.`, "250"],
      ["QUIT", "221"],
    ];
    let buffer = "";
    let step = 0;
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length >= 4 && line[3] === "-") continue; // continuation of a multi-line reply
        const expected = steps[step]?.[1];
        if (!expected || !line.startsWith(expected)) {
          socket.destroy();
          reject(new Error(`SMTP refused: ${line}`));
          return;
        }
        step += 1;
        if (step === steps.length) {
          socket.end();
          resolve();
          return;
        }
        socket.write(`${steps[step]?.[0] ?? ""}\r\n`);
      }
    });
  });
}

interface OutboxRow {
  id: number;
  recipient: string;
  subject: string;
  body: string;
}

let draining = false;

/** Send one waiting email under a row lock; false when nothing is waiting. */
async function sendNext(): Promise<boolean> {
  return transaction(async (db) => {
    const waiting = await db.query<OutboxRow>(
      `SELECT id, recipient, subject, body FROM email_outbox
        WHERE sent_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    const row = waiting.rows[0];
    if (!row) return false;
    await deliver(row.recipient, row);
    await db.query("UPDATE email_outbox SET sent_at = now() WHERE id = $1", [row.id]);
    return true;
  });
}

/** Send what is waiting in the outbox; a row stays unsent, and is retried, while SMTP is unreachable. */
async function drainOutbox(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (await sendNext());
  } catch (error) {
    console.warn(`Mail delivery paused: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    draining = false;
  }
}

export function startOutboxSender(): void {
  setInterval(() => void drainOutbox(), 2_000).unref();
}
