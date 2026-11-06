import nodemailer, { type Transporter } from "nodemailer";
import type { Config } from "./env.ts";
import type { Client } from "./db.ts";
import { uuid } from "./ids.ts";
import { nowMs } from "./clock.ts";

let transporter: Transporter | null = null;
let lastFailureAt: number | null = null;

export function initMail(cfg: Config): void {
  transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: false,
    from: cfg.mailFrom,
    connectionTimeout: 5000,
    socketTimeout: 10000,
    tls: { rejectUnauthorized: false },
  });
}

export interface OutboxInsert {
  workspaceId: string;
  kind: "invite" | "mention" | "digest";
  toEmail: string;
  subject: string;
  body: string;
  refTable: "invites" | "messages" | null;
  refId: string | null;
}

export async function queueMail(client: Client, msg: OutboxInsert): Promise<void> {
  await client.query(
    "INSERT INTO outbox (id, workspace_id, kind, to_email, subject, body, ref_table, ref_id, status, attempts, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'held',0,$9)",
    [uuid(), msg.workspaceId, msg.kind, msg.toEmail, msg.subject, msg.body, msg.refTable, msg.refId, new Date(nowMs()).toISOString()]
  );
}

export async function countHeld(): Promise<number> {
  const res = await queryHeld();
  return res;
}

async function queryHeld(): Promise<number> {
  const { query } = await import("./db.ts");
  const res = await query<{ n: string }>("SELECT count(*)::text AS n FROM outbox WHERE status = 'held'");
  return Number(res.rows[0].n);
}

/** Deliver held messages to SMTP, one copy of each at a time. Called on a timer. */
export async function deliverOutbox(cfg: Config): Promise<void> {
  const { query } = await import("./db.ts");
  const retrySeconds = Math.max(1, retrySecondsValue);
  // Claim a batch: FOR UPDATE SKIP LOCKED means only one copy delivers each message.
  const claimed = await query<{ id: string; workspace_id: string; to_email: string; subject: string; body: string }>(
    `UPDATE outbox SET attempts = attempts + 1, last_attempt_at = $1
     WHERE id IN (
       SELECT id FROM outbox WHERE status = 'held'
         AND (last_attempt_at IS NULL OR last_attempt_at <= $1::timestamptz - make_interval(secs => $2))
       ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, workspace_id, to_email, subject, body`,
    [new Date(nowMs()).toISOString(), retrySeconds]
  );
  if (claimed.rows.length === 0) return;
  for (const row of claimed.rows) {
    try {
      await sendOne(cfg, row.workspace_id, row.to_email, row.subject, row.body);
      await query("UPDATE outbox SET status = 'sent', sent_at = $1 WHERE id = $2", [
        new Date(nowMs()).toISOString(),
        row.id,
      ]);
      lastFailureAt = null;
    } catch (e) {
      lastFailureAt = nowMs();
      await query("UPDATE outbox SET status = 'held', last_error = $1 WHERE id = $2", [
        String(e).slice(0, 500),
        row.id,
      ]);
    }
  }
}

let retrySecondsValue = 30;
export function setRetrySeconds(n: number): void {
  retrySecondsValue = n;
}

async function sendOne(cfg: Config, workspaceId: string, to: string, subject: string, body: string): Promise<void> {
  if (!transporter) throw new Error("mail not initialised");
  await transporter.sendMail({
    from: cfg.mailFrom,
    to,
    subject,
    text: body,
    headers: { "X-Tallyroom-Workspace": workspaceId },
  });
}

/** Mail is delayed when messages are held or the last attempt failed. */
export function mailDelayed(held: number): boolean {
  return held > 0 || lastFailureRecent();
}

export function lastFailureRecent(): boolean {
  return lastFailureAt !== null && nowMs() - lastFailureAt < 60000;
}
