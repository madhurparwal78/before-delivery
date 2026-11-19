import type { PoolClient } from 'pg';
import { withTransaction } from '../db/pool.js';
import type { MeetingRow, TaskRow } from '../db/records.js';
import type { CalendarImportResultDto, TaskImportResultDto } from '../../shared/types.js';
import { requirePlanner, requireWritable, type RequestContext } from '../http/context.js';
import { unprocessable } from '../http/errors.js';
import { newId } from '../services/auth.js';
import { nextPosition } from '../services/planner.js';
import { parseCsv } from '../domain/csv.js';
import { hasTaskExportHeader, importKey, MAX_IMPORT_ROWS, prepareImport } from '../domain/taskImport.js';
import { looksLikeCalendar, parseCalendar } from '../domain/ical.js';
import type { Router } from '../http/router.js';

async function recordBatch(
  tx: PoolClient,
  memberId: string,
  workspaceId: string,
  kind: 'tasks' | 'calendar',
  counts: { created: number; updated: number; unchanged: number; merged: number; rejected: number; skipped: number },
): Promise<string> {
  const id = newId();
  await tx.query(
    `insert into import_batches (id, member_id, workspace_id, kind, created_count, updated_count,
                                 unchanged_count, merged_count, rejected_count, skipped_count, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
    [
      id,
      memberId,
      workspaceId,
      kind,
      counts.created,
      counts.updated,
      counts.unchanged,
      counts.merged,
      counts.rejected,
      counts.skipped,
    ],
  );
  return id;
}

async function importTasks(context: RequestContext): Promise<TaskImportResultDto> {
  const { member, workspace } = requirePlanner(context);
  requireWritable(context);

  const table = parseCsv(context.rawBody.toString('utf8'));
  if (!hasTaskExportHeader(table)) {
    throw unprocessable('not_a_task_export', "That file isn't a task export with external_id and title columns.");
  }
  if (table.rows.length > MAX_IMPORT_ROWS) {
    throw unprocessable('too_many_rows', 'That file has more than 2,000 rows.');
  }

  const prepared = prepareImport(table);

  return withTransaction(async (tx) => {
    const existing = await tx.query<TaskRow>(
      'select * from tasks where member_id = $1 and external_id is not null for update',
      [member.id],
    );
    const byKey = new Map(
      existing.rows.map((row) => [importKey(row.source ?? 'csv', row.external_id ?? ''), row]),
    );

    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    for (const row of prepared.winners) {
      const match = byKey.get(importKey(row.source, row.externalId));
      if (!match) {
        const position = await nextPosition(tx, member.id, null);
        await tx.query(
          `insert into tasks (id, member_id, workspace_id, title, estimate_minutes, day_date, position,
                              status, source, external_id, due_date, version, created_at, updated_at)
           values ($1, $2, $3, $4, $5, null, $6, 'open', $7, $8, $9, 1, now(), now())`,
          [
            newId(),
            member.id,
            workspace.id,
            row.title,
            row.estimateMinutes,
            position,
            row.source,
            row.externalId,
            row.dueDate,
          ],
        );
        createdCount += 1;
        continue;
      }

      const nextEstimate = match.estimate_minutes ?? row.estimateMinutes;
      const changed =
        match.title !== row.title ||
        match.due_date !== row.dueDate ||
        match.estimate_minutes !== nextEstimate;
      if (!changed) {
        unchangedCount += 1;
        continue;
      }
      await tx.query(
        `update tasks set title = $2, due_date = $3, estimate_minutes = $4,
                          version = version + 1, updated_at = now()
          where id = $1`,
        [match.id, row.title, row.dueDate, nextEstimate],
      );
      updatedCount += 1;
    }

    const orphaned = existing.rows
      .filter(
        (row) =>
          row.status === 'open' &&
          row.source !== null &&
          prepared.sources.includes(row.source) &&
          !prepared.keys.has(importKey(row.source, row.external_id ?? '')),
      )
      .map((row) => ({ externalId: row.external_id ?? '', title: row.title }));

    const batchId = await recordBatch(tx, member.id, workspace.id, 'tasks', {
      created: createdCount,
      updated: updatedCount,
      unchanged: unchangedCount,
      merged: prepared.mergedCount,
      rejected: prepared.rejected.length,
      skipped: 0,
    });

    return {
      batchId,
      created: createdCount,
      updated: updatedCount,
      unchanged: unchangedCount,
      merged: prepared.mergedCount,
      rejected: prepared.rejected,
      orphaned,
    };
  });
}

async function importCalendar(context: RequestContext): Promise<CalendarImportResultDto> {
  const { member, workspace } = requirePlanner(context);
  requireWritable(context);

  const text = context.rawBody.toString('utf8');
  if (!looksLikeCalendar(text)) {
    throw unprocessable('not_a_calendar', "That file isn't an iCalendar file.");
  }
  const parsed = parseCalendar(text);

  return withTransaction(async (tx) => {
    const existing = await tx.query<MeetingRow>(
      'select * from meetings where member_id = $1 for update',
      [member.id],
    );
    const byUid = new Map(existing.rows.map((row) => [row.uid, row]));

    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    for (const event of parsed.events) {
      const match = byUid.get(event.uid);
      if (!match) {
        await tx.query(
          `insert into meetings (id, member_id, uid, summary, start_instant, end_instant, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, now(), now())`,
          [newId(), member.id, event.uid, event.summary, event.start, event.end],
        );
        createdCount += 1;
        continue;
      }
      const changed =
        match.summary !== event.summary ||
        match.start_instant.getTime() !== event.start.getTime() ||
        match.end_instant.getTime() !== event.end.getTime();
      if (!changed) {
        unchangedCount += 1;
        continue;
      }
      await tx.query(
        `update meetings set summary = $2, start_instant = $3, end_instant = $4, updated_at = now()
          where id = $1`,
        [match.id, event.summary, event.start, event.end],
      );
      updatedCount += 1;
    }

    const batchId = await recordBatch(tx, member.id, workspace.id, 'calendar', {
      created: createdCount,
      updated: updatedCount,
      unchanged: unchangedCount,
      merged: 0,
      rejected: 0,
      skipped: parsed.skipped,
    });

    return {
      batchId,
      created: createdCount,
      updated: updatedCount,
      unchanged: unchangedCount,
      skipped: parsed.skipped,
    };
  });
}

export function registerImportRoutes(router: Router): void {
  router.post('/api/imports/tasks', importTasks, 'csv');
  router.post('/api/imports/calendar', importCalendar, 'calendar');
}
