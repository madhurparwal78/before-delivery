import { now } from "../clock";
import { newId, pool, transaction, type Db, type TxHandle } from "../db";
import { sendMail } from "../mail";
import type { Email } from "./emails";
import { emitNotice } from "./events";

interface OutboxRow {
  id: string;
  kind: string;
  to_email: string;
  subject: string;
  body: string;
  ride_id: string | null;
  passenger_id: string | null;
}

const NOTICE_KINDS = ["time_change", "cancellation"] as const;
type NoticeKind = (typeof NOTICE_KINDS)[number];

function noticeKind(kind: string): NoticeKind | null {
  return (NOTICE_KINDS as readonly string[]).includes(kind) ? (kind as NoticeKind) : null;
}

/** Write an email row in the caller's transaction; the sender picks it up after commit or on the next sweep. */
export async function enqueue(db: TxHandle, email: Email, attemptAfterCommit = true): Promise<string> {
  const id = newId();
  await db.query(
    `INSERT INTO outbox (id, kind, to_email, subject, body, created_at, ride_id, passenger_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, email.kind, email.to, email.subject, email.body, now(), email.rideId ?? null, email.passengerId ?? null],
  );
  const kind = noticeKind(email.kind);
  if (kind && email.rideId && email.passengerId) {
    const rideId = email.rideId;
    const passengerId = email.passengerId;
    db.afterCommit(() => emitNotice(rideId, passengerId, kind, "queued", null));
  }
  if (attemptAfterCommit) db.afterCommit(() => attemptRows([id], 2000));
  return id;
}

async function attemptOne(id: string): Promise<void> {
  await transaction(async (db) => {
    const { rows } = await db.query<OutboxRow>("SELECT * FROM outbox WHERE id = $1 AND status = 'queued' FOR UPDATE SKIP LOCKED", [id]);
    const row = rows[0];
    if (!row) return;
    try {
      await sendMail(row.to_email, row.subject, row.body);
    } catch {
      await db.query("UPDATE outbox SET attempts = attempts + 1, last_attempt_at = $2 WHERE id = $1", [id, now()]);
      return;
    }
    const sentAt = now();
    await db.query("UPDATE outbox SET status = 'sent', attempts = attempts + 1, last_attempt_at = $2, sent_at = $2 WHERE id = $1", [id, sentAt]);
    const kind = noticeKind(row.kind);
    if (kind && row.ride_id && row.passenger_id) {
      const { ride_id, passenger_id } = row;
      db.afterCommit(() => emitNotice(ride_id, passenger_id, kind, "sent", sentAt));
    }
  });
}

/** Try each row once, in parallel, and give up waiting after `budgetMs` (the attempt itself carries on). */
export async function attemptRows(ids: string[], budgetMs: number): Promise<void> {
  const all = Promise.all(ids.map((id) => attemptOne(id).catch(() => undefined)));
  await Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, budgetMs))]);
}

/** Retry every queued row; several instances may sweep at once and each row is still sent once. */
export async function sweepOutbox(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM outbox WHERE status = 'queued' ORDER BY seq LIMIT 50");
  await Promise.all(rows.map((row) => attemptOne(row.id).catch(() => undefined)));
}

export interface NoticeRow {
  passenger_id: string;
  name: string;
  kind: NoticeKind;
  status: "queued" | "sent";
  sent_at: Date | null;
}

export async function noticesFor(db: Db, outboxIds: string[]): Promise<NoticeRow[]> {
  if (!outboxIds.length) return [];
  const { rows } = await db.query<NoticeRow>(
    `SELECT o.passenger_id, m.display_name AS name, o.kind, o.status, o.sent_at
       FROM outbox o JOIN members m ON m.id = o.passenger_id WHERE o.id = ANY($1) ORDER BY o.seq`,
    [outboxIds],
  );
  return rows;
}

export async function noticesOfRide(db: Db, rideId: string): Promise<NoticeRow[]> {
  const { rows } = await db.query<NoticeRow>(
    `SELECT o.passenger_id, m.display_name AS name, o.kind, o.status, o.sent_at
       FROM outbox o JOIN members m ON m.id = o.passenger_id
      WHERE o.ride_id = $1 AND o.kind = ANY($2) ORDER BY o.seq`,
    [rideId, [...NOTICE_KINDS]],
  );
  return rows;
}
