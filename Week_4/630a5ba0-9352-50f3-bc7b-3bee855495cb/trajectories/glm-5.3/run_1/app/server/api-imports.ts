import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { ApiError } from '../src-shared/errors.js';
import {
  addDays,
  compareDates,
  dayLabel,
  isoInstant,
  isoWeekDates,
  isoWeekOf,
  localDateOf,
  localTimeOf,
  minutesOf,
} from '../src-shared/domain.js';
import { MAX_CSV_ROWS } from '../src-shared/constants.js';
import { parseTaskCsv } from '../src-shared/csv.js';
import { parseIcs } from '../src-shared/ics.js';
import { enqueueOutbox, type OutboxItem } from './outbox.js';
import { newId } from './ids.js';
import {
  loadMemberByEmail,
  queryRows,
  routineOccurrences,
  sessionToApi,
  toApiMember,
  toApiWorkspace,
  routineToApi,
  type MemberRow,
  type MeetingRow,
  type RoutineRow,
  type SessionRow,
  type TaskRow,
} from './repo.js';
import {
  h,
  sendJson,
  memberToday,
  taskDay,
  requireMember,
  requireWritable,
  requireRole,
  requirePlanner,
  isPlainObject,
  type AppDeps,
} from './api-core.js';
import { loadMemberRow, originOf } from './api-routes.js';

// ---------------------------------------------------------------------------
// Imports (CSV tasks and iCalendar meetings)

export function importHandlers(deps: AppDeps) {
  const tasks = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const text = String(req.body);
    const parsed = parseTaskCsv(text, MAX_CSV_ROWS);
    if (parsed.tooManyRows) throw new ApiError('too_many_rows', 'That file has more than 2,000 rows.');
    if (parsed.result === null) throw new ApiError('not_a_task_export', "That file isn't a task export with external_id and title columns.");
    const rows = (parsed.result as { rows: readonly import('../src-shared/csv.js').CsvRowResult[] }).rows;

    // Last row wins per (source, external id); earlier duplicates count as merged.
    const winners = new Map<string, (typeof rows)[number]>();
    const mergedKeys = new Set<string>();
    for (const row of rows) {
      const key = `${row.source}\u0000${row.externalId}`;
      if (winners.has(key)) mergedKeys.add(key);
      winners.set(key, row);
    }

    const today = memberToday(member);
    const result = await deps.db.withTransaction(async (client) => {
      const existing = await queryRows<TaskRow>(client, 'SELECT * FROM tasks WHERE member_id = $1 AND source IS NOT NULL', [member.id]);
      const byKey = new Map(existing.map((t) => [`${t.source}\u0000${t.external_id}`, t]));

      const batchId = newId('batch');
      await client.query('INSERT INTO import_batches (id, member_id, kind, created, updated, unchanged, skipped) VALUES ($1, $2, $3, 0, 0, 0, 0)', [batchId, member.id, 'tasks']);

      let created = 0;
      let updated = 0;
      let unchanged = 0;
      const rejected = (parsed.result as { rejected: readonly { line: number; reason: string }[] }).rejected.map((r) => ({ line: r.line, reason: r.reason }));

      for (const [key, row] of winners) {
        const prior = byKey.get(key);
        if (prior === undefined) {
          const pos = await queryRows<{ n: number }>(client, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM tasks WHERE member_id = $1 AND day_date IS NULL', [member.id]);
          await client.query(
            `INSERT INTO tasks (id, member_id, title, estimate_minutes, day_date, position, status, source, external_id, due_date, version, updated_at)
             VALUES ($1, $2, $3, $4, NULL, $5, 'open', $6, $7, $8, 1, now())`,
            [newId('task'), member.id, row.title, row.estimateMinutes, pos[0]?.n ?? 0, row.source, row.externalId, row.dueDate],
          );
          created++;
        } else {
          const titleChanged = prior.title !== row.title;
          const priorDue = prior.due_date === null ? null : (typeof prior.due_date === 'string' ? prior.due_date.slice(0, 10) : prior.due_date.toISOString().slice(0, 10));
          const dueChanged = priorDue !== row.dueDate;
          const estimateApplies = row.estimateMinutes !== null && prior.estimate_minutes === null;
          if (!titleChanged && !dueChanged && !estimateApplies) {
            unchanged++;
            continue;
          }
          await client.query(
            `UPDATE tasks SET title = $2, due_date = $3, estimate_minutes = COALESCE(estimate_minutes, $4), version = version + 1, updated_at = now() WHERE id = $1`,
            [prior.id, row.title, row.dueDate, row.estimateMinutes],
          );
          updated++;
        }
      }

      // Orphans: open imported tasks whose source appears in this file but whose key is absent.
      const sourcesInFile = new Set([...winners.keys()].map((k) => (k.split('\u0000')[0] ?? '')));
      const orphaned: Array<{ externalId: string; title: string }> = [];
      for (const t of existing) {
        const key = `${t.source}\u0000${t.external_id}`;
        if (t.status !== 'open' || !sourcesInFile.has(t.source ?? '')) continue;
        if (!winners.has(key)) orphaned.push({ externalId: t.external_id ?? '', title: t.title });
      }

      await client.query('UPDATE import_batches SET created = $2, updated = $3, unchanged = $4, skipped = $5 WHERE id = $1', [batchId, created, updated, unchanged, 0]);
      return { batchId, created, updated, unchanged, merged: mergedKeys.size, rejected, orphaned };
    });
    sendJson(res, 200, result);
  };

  const calendar = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const text = String(req.body);
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new ApiError('not_a_calendar', "That file isn't an iCalendar file.");
    const parsed = parseIcs(text);
    const result = await deps.db.withTransaction(async (client) => {
      const existing = await queryRows<MeetingRow>(client, 'SELECT * FROM meetings WHERE member_id = $1', [member.id]);
      const byUid = new Map(existing.map((m) => [m.uid, m]));
      let created = 0;
      let updated = 0;
      let unchanged = 0;
      for (const ev of parsed.imported) {
        const prior = byUid.get(ev.uid);
        if (prior === undefined) {
          await client.query('INSERT INTO meetings (id, member_id, uid, summary, start_at, end_at) VALUES ($1, $2, $3, $4, $5, $6)', [
            newId('meet'), member.id, ev.uid, ev.summary, ev.start, ev.end,
          ]);
          created++;
        } else if (prior.summary !== ev.summary || new Date(prior.start_at).getTime() !== ev.start.getTime() || new Date(prior.end_at).getTime() !== ev.end.getTime()) {
          await client.query('UPDATE meetings SET summary = $2, start_at = $3, end_at = $4 WHERE id = $1', [prior.id, ev.summary, ev.start, ev.end]);
          updated++;
        } else {
          unchanged++;
        }
      }
      const batchId = newId('batch');
      await client.query('INSERT INTO import_batches (id, member_id, kind, created, updated, unchanged, skipped) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
        batchId, member.id, 'calendar', created, updated, unchanged, parsed.skipped,
      ]);
      return { batchId, created, updated, unchanged, skipped: parsed.skipped };
    });
    sendJson(res, 200, result);
  };

  return { tasks, calendar };
}

// ---------------------------------------------------------------------------
// Shutdown

export function shutdownHandlers(deps: AppDeps) {
  const preview = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    const today = memberToday(member);
    const shape = await buildPreview(deps, member, today);
    sendJson(res, 200, { date: today, ...shape });
  };

  const run = async (req: Request, res: Response): Promise<void> => {
    const member = requireMember(req);
    requirePlanner(member);
    await requireWritable(deps, member);
    const today = memberToday(member);
    const tomorrow = addDays(today, 1);

    const outcome = await deps.db.withTransaction(async (client) => {
      const done = await queryRows<TaskRow>(client, "SELECT * FROM tasks WHERE member_id = $1 AND status = 'done' AND day_date = $2 ORDER BY position, id", [member.id, today]);
      const open = await queryRows<TaskRow>(client, "SELECT * FROM tasks WHERE member_id = $1 AND status = 'open' AND day_date = $2 ORDER BY position, id", [member.id, today]);

      // Move today's open tasks to the top of tomorrow, clearing their sessions.
      const ids = open.map((t) => t.id);
      if (ids.length > 0) {
        await client.query('UPDATE tasks SET position = position + $2 WHERE member_id = $1 AND day_date = $3', [member.id, ids.length, tomorrow]);
        for (let i = 0; i < open.length; i++) {
          const t = open[i];
          if (t === undefined) continue;
          await client.query('DELETE FROM sessions WHERE task_id = $1', [t.id]);
          await client.query('UPDATE tasks SET day_date = $2, position = $3, version = version + 1, updated_at = now() WHERE id = $1', [t.id, tomorrow, i]);
        }
      }

      const digestRow = await client.query<{ sent_at: string }>('SELECT sent_at FROM digest_log WHERE member_id = $1 AND day_date = $2', [member.id, today]);
      const alreadySent = digestRow.rows.length > 0;
      let digest: 'sent' | 'queued' | 'already_sent' = 'already_sent';
      const outbox: OutboxItem[] = [];
      if (!alreadySent) {
        await client.query('INSERT INTO digest_log (member_id, day_date) VALUES ($1, $2)', [member.id, today]);
        digest = 'queued';
        outbox.push({
          kind: 'email',
          message: {
            kind: 'digest',
            to: member.email,
            dayLabel: dayLabel(today, member.time_zone),
            doneTitles: done.map((t) => t.title),
            carryTitles: open.map((t) => t.title),
            tomorrowLabel: dayLabel(tomorrow, member.time_zone),
            tomorrowFirst: await firstThingTomorrow(client, member, tomorrow),
          },
        });
      }
      await enqueueOutbox(client, outbox);
      return { done, open, digest };
    });

    // Try to send the digest now; the queue covers an unreachable mail service.
    let digest: 'sent' | 'queued' | 'already_sent' = outcome.digest;
    if (outcome.digest === 'queued') {
      const sent = await trySendPending(deps, member.id, today);
      digest = sent ? 'sent' : 'queued';
    }
    const shape = {
      done: outcome.done.map((t) => ({ id: t.id, title: t.title })),
      carriedOver: outcome.open.map((t) => ({ id: t.id, title: t.title })),
      tomorrowFirst: await buildFirstTomorrow(deps, member, tomorrow),
    };
    sendJson(res, 200, { date: today, ...shape, digest });
  };

  async function buildPreview(deps: AppDeps, member: MemberRow, today: string) {
    const tomorrow = addDays(today, 1);
    const done = await deps.db.query<TaskRow>("SELECT id, title FROM tasks WHERE member_id = $1 AND status = 'done' AND day_date = $2 ORDER BY position, id", [member.id, today]);
    const open = await deps.db.query<TaskRow>("SELECT id, title FROM tasks WHERE member_id = $1 AND status = 'open' AND day_date = $2 ORDER BY position, id", [member.id, today]);
    return {
      done: done.map((t) => ({ id: t.id, title: t.title })),
      carriedOver: open.map((t) => ({ id: t.id, title: t.title })),
      tomorrowFirst: await buildFirstTomorrow(deps, member, tomorrow),
    };
  }

  async function buildFirstTomorrow(deps: AppDeps, member: MemberRow, tomorrow: string): Promise<{ title: string; startTime: string } | null> {
    const sessions = await deps.db.query<SessionRow>('SELECT * FROM sessions WHERE member_id = $1', [member.id]);
    const tasks = await deps.db.query<TaskRow>('SELECT * FROM tasks WHERE member_id = $1', [member.id]);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const routines = await deps.db.query<RoutineRow>('SELECT * FROM routines WHERE member_id = $1', [member.id]);
    const occurrences = routineOccurrences(member.id, routines, tomorrow, tomorrow, member.time_zone);
    let best: { title: string; startTime: string } | null = null;
    for (const s of sessions) {
      const date = localDateOf(new Date(s.start_at), member.time_zone);
      if (date !== tomorrow) continue;
      const task = byId.get(s.task_id);
      if (task === undefined) continue;
      const start = localTimeOf(new Date(s.start_at), member.time_zone);
      if (best === null || minutesOf(start) < minutesOf(best.startTime)) best = { title: task.title, startTime: start };
    }
    for (const occ of occurrences) {
      if (best === null || minutesOf(occ.startTime) < minutesOf(best.startTime)) {
        const routine = routines.find((r) => r.id === occ.routineId);
        best = { title: routine?.name ?? '', startTime: occ.startTime };
      }
    }
    return best;
  }

  async function firstThingTomorrow(client: PoolClient, member: MemberRow, tomorrow: string): Promise<{ title: string; startTime: string } | null> {
    const sessions = await queryRows<SessionRow>(client, 'SELECT * FROM sessions WHERE member_id = $1', [member.id]);
    const tasks = await queryRows<TaskRow>(client, 'SELECT * FROM tasks WHERE member_id = $1', [member.id]);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const routines = await queryRows<RoutineRow>(client, 'SELECT * FROM routines WHERE member_id = $1', [member.id]);
    const occurrences = routineOccurrences(member.id, routines, tomorrow, tomorrow, member.time_zone);
    let best: { title: string; startTime: string } | null = null;
    for (const s of sessions) {
      const date = localDateOf(new Date(s.start_at), member.time_zone);
      if (date !== tomorrow) continue;
      const task = byId.get(s.task_id);
      if (task === undefined) continue;
      const start = localTimeOf(new Date(s.start_at), member.time_zone);
      if (best === null || minutesOf(start) < minutesOf(best.startTime)) best = { title: task.title, startTime: start };
    }
    for (const occ of occurrences) {
      if (best === null || minutesOf(occ.startTime) < minutesOf(best.startTime)) {
        const routine = routines.find((r) => r.id === occ.routineId);
        best = { title: routine?.name ?? '', startTime: occ.startTime };
      }
    }
    return best;
  }

  return { preview, run };
}

/** Sends one pending digest now; returns false when mail is unreachable. */
async function trySendPending(deps: AppDeps, memberId: string, today: string): Promise<boolean> {
  const rows = await deps.db.query<{ id: string; payload: OutboxItem }>(
    `SELECT id, payload FROM outbox WHERE status = 'pending' AND kind = 'email' AND payload->>'kind' = 'digest' LIMIT 1`,
    [memberId, today],
  );
  const item = rows[0];
  if (item === undefined) return true;
  try {
    if (item.payload.kind === 'email') {
      await deps.mailer.send(String(item.id), item.payload.message);
      await deps.db.query("UPDATE outbox SET status = 'done', sent_at = now(), attempts = attempts + 1 WHERE id = $1", [item.id]);
      return true;
    }
    return true;
  } catch {
    return false;
  }
}
