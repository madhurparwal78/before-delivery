/** The mail sender and the daily walkthrough summary. The outbox is the
 *  system of record for email; the sender claims each entry and delivers it
 *  exactly once, even across several server processes. */

import { sendMail } from "./smtp.js";
import type { Db } from "./db/schema.js";
import { withTransaction } from "./db/schema.js";
import { config } from "./config.js";
import { addDays, toLocalString, utcIso } from "./times.js";
import { derivedCounts, roomsOf } from "./domain.js";
import type { Membership } from "./context.js";
import { TRADE_LABELS, type TradeKey } from "../shared/types.js";
import { tomorrowOccurrences } from "./visits.js";
import { newId } from "./identity.js";

const CHECK_INTERVAL_MS = 30000;

export function startMail(db: Db): void {
  void sendQueued(db);
  const sender = setInterval(() => {
    void sendQueued(db);
  }, CHECK_INTERVAL_MS);
  sender.unref?.();
}

async function sendQueued(db: Db): Promise<void> {
  const claimer = newId("proc");
  let claimed = true;
  while (claimed) {
    claimed = false;
    await withTransaction(db, async (client) => {
      // Claim one entry at a time; a stale claim from a dead process expires.
      const rows = await client.query<{ id: string; to_email: string; subject: string; body: string }>(
        `UPDATE outbox SET claimed_by = $1, send_after = now() + interval '5 minutes'
         WHERE id = (
           SELECT id FROM outbox WHERE status = 'queued'
             AND (claimed_by IS NULL OR send_after <= now())
             ORDER BY created_at, id LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING id, to_email, subject, body`,
        [claimer],
      );
      const entry = rows.rows[0];
      if (entry === undefined) return;
      claimed = true;
      try {
        const result = await sendMail(entry.to_email, entry.subject, entry.body);
        if (result.ok) {
          await client.query(`UPDATE outbox SET status = 'sent', sent_at = now(), claimed_by = NULL WHERE id = $1`, [entry.id]);
        }
      } catch {
        // Mail unreachable: the entry stays queued and the claim expires.
      }
    });
  }
}

export function startSummaries(db: Db): void {
  void runSummaryCheck(db);
  const timer = setInterval(() => {
    void runSummaryCheck(db);
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
}

/** One summary per homeowner per job-local day, at or after the daily summary
 *  time, once the last change has stayed quiet for SUMMARY_QUIET_SECONDS. */
export async function runSummaryCheck(db: Db): Promise<void> {
  const jobs = await db.query<{ id: string; time_zone: string; status: string; summary_cutoff_at: Date | null }>(
    `SELECT j.id, j.time_zone, j.status, j.summary_cutoff_at FROM jobs j
     WHERE j.status IN ('active', 'walkthrough')
       AND EXISTS (SELECT 1 FROM job_members m WHERE m.job_id = j.id AND m.role = 'homeowner' AND m.ended_at IS NULL)`,
  );
  for (const job of jobs.rows) {
    const now = new Date();
    const localNow = toLocalString(now, job.time_zone);
    const localDate = localNow.slice(0, 10);
    const localMinutes = Number(localNow.slice(11, 13)) * 60 + Number(localNow.slice(14, 16));
    const dueMinutes = Number(config.summaryLocalTime.slice(0, 2)) * 60 + Number(config.summaryLocalTime.slice(3, 5));
    if (localMinutes < dueMinutes) continue;
    const done = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox WHERE job_id = $1 AND kind = 'summary' AND summary_date = $2`,
      [job.id, localDate],
    );
    if ((done.rows[0]?.n ?? 0) > 0) continue;

    const cutoff = await db.query<{ last_change_at: Date | null; summary_cutoff_at: Date | null }>(
      `SELECT last_change_at, summary_cutoff_at FROM jobs WHERE id = $1`, [job.id],
    );
    const lastChange = cutoff.rows[0]?.last_change_at ?? null;
    if (lastChange === null) continue;
    if (Date.now() - lastChange.getTime() < config.summaryQuietSeconds * 1000) continue;

    await queueSummaries(db, job.id, job.time_zone, localDate, cutoff.rows[0]?.summary_cutoff_at ?? null);
  }
}

async function queueSummaries(db: Db, jobId: string, timeZone: string, localDate: string, previousCutoff: Date | null): Promise<void> {
  const homeowners = await db.query<{ id: string; email: string }>(
    `SELECT m.id, p.email FROM job_members m JOIN people p ON p.id = m.person_id
     WHERE m.job_id = $1 AND m.role = 'homeowner' AND m.ended_at IS NULL`,
    [jobId],
  );
  if (homeowners.rows.length === 0) return;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const membership: Membership = { id: "", personId: "", jobId, role: "homeowner", trade: null, name: "", email: "" };
    const progress = (await derivedCounts(client, jobId, membership)).progress;
    const rooms = await roomsOf(client, jobId);
    const roomCounts = new Map((await derivedCounts(client, jobId, membership)).rooms.map((r) => [r.id, r.counts]));
    const jobRow = await client.query<{ name: string }>(`SELECT name FROM jobs WHERE id = $1`, [jobId]);
    const jobName = jobRow.rows[0]?.name ?? "";

    // Changes in the window, from the previous cut-off to this one.
    const changes = await client.query<{ item_id: string; number: number; title: string; kind: string }>(
      `SELECT item_id, number, title, kind FROM item_changes
       WHERE job_id = $1 AND at > COALESCE($2, to_timestamp(0)) AND at <= now()
       ORDER BY at, id`,
      [jobId, previousCutoff === null ? null : previousCutoff.toISOString()],
    );
    if (changes.rows.length === 0) {
      await client.query("COMMIT");
      return;
    }

    const perItem = new Map<string, { number: number; title: string; kinds: string[] }>();
    for (const change of changes.rows) {
      const entry = perItem.get(change.item_id);
      if (entry === undefined) perItem.set(change.item_id, { number: change.number, title: change.title, kinds: [change.kind] });
      else entry.kinds.push(change.kind);
    }

    const listed: { number: number; title: string; status: string }[] = [];
    const items = await client.query<{ id: string; number: number; title: string; status: string; deleted_at: Date | null }>(
      `SELECT id, number, title, status, deleted_at FROM items WHERE job_id = $1 ORDER BY number`, [jobId],
    );
    for (const item of items.rows) {
      const entry = perItem.get(item.id);
      if (entry === undefined) continue;
      const firstKind = entry.kinds[0]!;
      const lastKind = entry.kinds[entry.kinds.length - 1]!;
      if (firstKind === "created" && lastKind === "deleted") continue;
      if (lastKind === "deleted") {
        listed.push({ number: item.number, title: entry.title, status: "Removed" });
      } else {
        listed.push({ number: item.number, title: item.title, status: statusLabel(item.status) });
      }
    }

    const tomorrow = addDays(localDate, 1);
    const visits = await tomorrowOccurrences(client, jobId, timeZone, tomorrow);
    const visitLines = visits.length === 0
      ? ["No site visits tomorrow"]
      : visits.map((v) => `Visit ${v.starts.slice(0, 10)} ${v.starts.slice(11, 16)} to ${v.ends.slice(11, 16)}: ${tradeLabel(v.trade)}`);

    const lines: string[] = [
      `${progress.percent}% verified (${progress.verified} of ${progress.total} items)`,
      ...rooms.map((r) => {
        const counts = roomCounts.get(r.id) ?? { verified: 0, total: 0 };
        return `${r.name}: ${counts.verified} of ${counts.total} verified`;
      }),
      ...visitLines,
      ...listed.map((i) => `Item ${i.number}: ${i.title} — ${i.status}`),
      `Sign in to see the details: ${config.publicUrl}/signin`,
    ];
    const body = lines.join("\n");
    const subject = `Snaglight: walkthrough summary for ${jobName}, ${localDate}`;

    // The partial unique index keeps one summary per homeowner per job-local
    // day, even across several server processes.
    let inserted = 0;
    for (const homeowner of homeowners.rows) {
      const res = await client.query(
        `INSERT INTO outbox (id, job_id, kind, to_email, subject, body, link, summary_date)
         VALUES ($1, $2, 'summary', $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [newId("mail"), jobId, homeowner.email, subject, body, `${config.publicUrl}/signin`, localDate],
      );
      inserted += res.rowCount ?? 0;
    }
    if (inserted === 0) {
      await client.query("COMMIT");
      return;
    }
    await client.query(`UPDATE jobs SET summary_cutoff_at = now(), summary_for_date = $2 WHERE id = $1`, [jobId, localDate]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "open": return "Open";
    case "in_progress": return "In progress";
    case "ready_for_check": return "Ready for check";
    case "verified": return "Verified";
    default: return status;
  }
}

function tradeLabel(trade: TradeKey | null): string {
  return trade === null ? "Crew" : TRADE_LABELS[trade];
}

