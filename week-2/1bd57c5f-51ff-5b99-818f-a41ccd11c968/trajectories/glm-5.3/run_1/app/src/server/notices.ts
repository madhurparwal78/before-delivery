/** Assignment notices and the outbox. Every email is written to the outbox in
 *  the same transaction as the change that caused it. */

import type { PoolClient } from "pg";
import { config } from "./config.js";
import { newId } from "./identity.js";
import type { TradeKey } from "../shared/types.js";
import { TRADE_LABELS } from "../shared/types.js";

export type OutboxKind = "assignment" | "summary";

export async function queueOutboxEntry(
  client: PoolClient,
  jobId: string,
  kind: OutboxKind,
  toEmail: string,
  subject: string,
  body: string,
): Promise<void> {
  await client.query(
    `INSERT INTO outbox (id, job_id, kind, to_email, subject, body, link) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [newId("mail"), jobId, kind, toEmail, subject, body, `${config.publicUrl}/signin`],
  );
}

/** One assignment notice per active member of the trade. */
export async function assignmentNotices(
  client: PoolClient,
  jobId: string,
  item: { number: number; title: string; roomName: string },
  trade: TradeKey,
): Promise<void> {
  const job = await client.query<{ name: string }>(`SELECT name FROM jobs WHERE id = $1`, [jobId]);
  const jobName = job.rows[0]?.name ?? "";
  const members = await client.query<{ email: string }>(
    `SELECT p.email FROM job_members m JOIN people p ON p.id = m.person_id
     WHERE m.job_id = $1 AND m.role = 'trade' AND m.trade = $2 AND m.ended_at IS NULL`,
    [jobId, trade],
  );
  const subject = `Snaglight: new item on ${jobName}`;
  const body = [
    `Item ${item.number}: ${item.title}`,
    `Room: ${item.roomName}`,
    `Sign in to see the details: ${config.publicUrl}/signin`,
  ].join("\n");
  for (const member of members.rows) {
    await queueOutboxEntry(client, jobId, "assignment", member.email, subject, body);
  }
}

export function tradeLabel(trade: TradeKey | null): string {
  return trade === null ? "Crew" : TRADE_LABELS[trade];
}
