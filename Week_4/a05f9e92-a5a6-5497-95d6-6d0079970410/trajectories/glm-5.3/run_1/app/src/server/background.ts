// Background work: SLA thresholds, escalation ladders, vote windows, digests,
// auto-closes and storage recovery, all against the server clock.

import { clock } from './db.js';
import type { Ctx } from './server.js';

/** Run every job due between two instants, in time order. */
export async function runDueWork(ctx: Ctx, from: number, to: number): Promise<void> {
  // SLA thresholds and breaches for every running record.
  await checkSlas(ctx, to);
  // Escalation ladders climb when an acknowledge timer passes.
  await escalatePages(ctx, to);
  // Vote windows close undecided steps as rejected.
  await closeVoteWindows(ctx, to);
  // Resolved incidents close after their reopen deadline.
  await autoCloseIncidents(ctx, to);
  // Daily digests deliver at 08:00 in each person's zone.
  await deliverDigests(ctx, to);
  // Queued uploads retry when storage returns.
  await flushQueuedUploads(ctx);
}

async function checkSlas(ctx: Ctx, now: number): Promise<void> {
  void now;
  const { loadSnapshot } = await import('./recordengine.js');
  const { syncSlas } = await import('./slarunner.js');
  const rows = await ctx.db.query(`SELECT DISTINCT record FROM slas WHERE stage IN ('in_progress','paused')`);
  for (const row of rows.rows) {
    const snap = await loadSnapshot(ctx.db, String(row.record));
    if (snap) await syncSlas(ctx.db, snap, ctx.live);
  }
}

async function escalatePages(ctx: Ctx, now: number): Promise<void> {
  const rows = await ctx.db.query(`SELECT * FROM pages WHERE status = 'paging'`);
  for (const page of rows.rows) {
    const levels = page.levels as Array<{ level: number; username: string; ack_due_at: string | null }>;
    const current = Number(page.level);
    const currentLevel = levels.find(l => l.level === current);
    const next = levels.find(l => l.level === current + 1);
    const dueAt = currentLevel?.ack_due_at ? Date.parse(currentLevel.ack_due_at) : null;
    if (dueAt === null || now < dueAt) continue;
    if (next) {
      await ctx.db.query(`UPDATE pages SET level = $2 WHERE id = $1`, [page.id, next.level]);
      const { deliver, loadRules } = await import('./routes/inboxdata.js');
      const rules = await loadRules(ctx.db);
      if (next.username) {
        await deliver(ctx.db, rules, 'page', next.username, `Page for ${String(page.record)}: please acknowledge.`, String(page.record ?? ''));
      }
      ctx.live.publish('inbox', 'updated', {});
    } else {
      await ctx.db.query(`UPDATE pages SET status = 'exhausted' WHERE id = $1`, [page.id]);
      const { deliver, loadRules } = await import('./routes/inboxdata.js');
      const rules = await loadRules(ctx.db);
      await deliver(ctx.db, rules, 'page_exhausted', 'oona', `Page for ${String(page.record)} was not acknowledged at any level.`, String(page.record ?? ''));
      ctx.live.publish('inbox', 'updated', {});
    }
  }
}

async function closeVoteWindows(ctx: Ctx, now: number): Promise<void> {
  const rows = await ctx.db.query(`SELECT id, change, step, closes_at FROM approval_steps WHERE status = 'open' AND closes_at IS NOT NULL`);
  for (const step of rows.rows) {
    const closesAt = new Date(step.closes_at as Date).getTime();
    if (now > closesAt) {
      await ctx.db.query(`UPDATE approval_steps SET status = 'rejected', decided_at = $2 WHERE id = $1`, [step.id, new Date(now)]);
      await ctx.db.query(
        `INSERT INTO activity(record, at, actor, acting_for, kind, text) VALUES ($1,$2,'system',NULL,'state','Vote closed without reaching quorum.')`,
        [step.change, new Date(now)],
      );
      await ctx.db.query(`UPDATE records SET state = 'rejected', updated_at = $2 WHERE number = $1`, [step.change, new Date(now)]);
      await ctx.db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,'rejected',$2)`, [step.change, new Date(now)]);
      ctx.live.publish(`votes:${step.change}`, 'updated', {});
    }
  }
}

async function autoCloseIncidents(ctx: Ctx, now: number): Promise<void> {
  const rows = await ctx.db.query(
    `SELECT number, fields FROM records WHERE "table" = 'incident' AND state = 'resolved'`,
  );
  for (const row of rows.rows) {
    const fields = row.fields as Record<string, unknown>;
    const resolvedAt = fields.resolved_at ? Date.parse(String(fields.resolved_at)) : null;
    if (resolvedAt === null) continue;
    // The reopen deadline is 5 open business days after the resolved date.
    const deadline = await reopenDeadline(ctx, resolvedAt);
    if (deadline !== null && now > deadline) {
      await ctx.db.query(`UPDATE records SET state = 'closed', updated_at = $2 WHERE number = $1`, [row.number, new Date(now)]);
      await ctx.db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,'closed',$2)`, [row.number, new Date(now)]);
      ctx.live.publish(`record:${row.number}`, 'state', { number: row.number, state: 'closed' });
    }
  }
}

/** The reopen deadline: same local wall time, 5 open days later. */
export async function reopenDeadline(ctx: Ctx, resolvedAt: number): Promise<number | null> {
  const sched = await ctx.db.query(`SELECT time_zone, hours, holidays FROM schedules WHERE name = 'Office hours'`);
  if (!sched.rows.length) return null;
  const tz = String(sched.rows[0].time_zone);
  const hours = sched.rows[0].hours as Record<string, Array<[string, string]>>;
  const holidays = (sched.rows[0].holidays ?? []) as string[];

  const { partsOf, civilToEpoch } = await import('../shared/time.js');
  const resolved = partsOf(resolvedAt, tz);
  const openDays: number[] = [];
  let cursor = resolvedAt;
  for (let i = 0; i < 40 && openDays.length < 6; i++) {
    cursor += 86_400_000;
    const p = partsOf(cursor, tz);
    const key = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][p.weekday];
    const dateStr = `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    if (!holidays.includes(dateStr) && (hours[key] ?? []).length > 0) {
      openDays.push(cursor);
    }
  }
  if (openDays.length < 5) return null;
  const fifth = openDays[4];
  const p = partsOf(fifth, tz);
  return civilToEpoch(p.y, p.mo, p.d, resolved.h, resolved.mi, 0, tz);
}

async function deliverDigests(ctx: Ctx, now: number): Promise<void> {
  const people = await ctx.db.query(`SELECT username, time_zone FROM people WHERE digest = 'daily'`);
  for (const person of people.rows) {
    const { partsOf } = await import('../shared/time.js');
    const p = partsOf(now, String(person.time_zone));
    if (p.h !== 8 || p.mi !== 0) continue;
    const held = await ctx.db.query(
      `SELECT count(*)::int AS n FROM inbox_items WHERE username = $1 AND held`,
      [person.username],
    );
    const count = Number(held.rows[0].n);
    if (count > 0) {
      await ctx.db.query(
        `INSERT INTO inbox_items(username, event, text, record, at, read, held) VALUES ($1,'digest',$2,NULL,$3,FALSE,FALSE)`,
        [person.username, `Daily digest: ${count} updates`, new Date(now)],
      );
      await ctx.db.query(`DELETE FROM inbox_items WHERE username = $1 AND held`, [person.username]);
      ctx.live.publish('inbox', 'updated', {});
    }
  }
}

/** Queued uploads finish when storage returns. */
export async function flushQueuedUploads(ctx: Ctx): Promise<void> {
  if (!ctx.storage.isAvailable) return;
  const rows = await ctx.db.query(`SELECT * FROM attachments WHERE status = 'queued' ORDER BY created_at, id`);
  for (const row of rows.rows) {
    const blob = await ctx.db.query(`SELECT data FROM attachment_blobs WHERE id = $1`, [row.id]);
    if (!blob.rows.length) continue;
    const bytes = blob.rows[0].data as Buffer;
    const key = `attachments/${row.record}/${row.id}/${row.name}`;
    const stored = await ctx.storage.put(key, bytes, String(row.type));
    if (stored) {
      await ctx.db.query(`UPDATE attachments SET status = 'stored', stored_at = $2 WHERE id = $1`, [row.id, new Date(clock.nowMs())]);
      await ctx.db.query(`DELETE FROM attachment_blobs WHERE id = $1`, [row.id]);
      ctx.live.publish(`record:${row.record}`, 'attachment', { id: row.id, status: 'stored' });
    }
  }

  // Failed exports retry from the start.
  const failed = await ctx.db.query(`SELECT id FROM exports WHERE status = 'failed' AND error = 'storage_unavailable'`);
  for (const row of failed.rows) {
    const { runExportJob } = await import('./routes/exportjob.js');
    await runExportJob(ctx, Number(row.id));
  }
}
