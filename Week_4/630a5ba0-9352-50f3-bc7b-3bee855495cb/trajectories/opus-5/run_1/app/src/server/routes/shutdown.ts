import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import type { MemberRow, RoutineRow, SessionRow, TaskRow } from '../db/records.js';
import type { ShutdownPreviewDto, ShutdownResultDto } from '../../shared/types.js';
import { requirePlanner, requireWritable, type RequestContext } from '../http/context.js';
import { digestMail } from '../services/messages.js';
import { enqueue, runItemNow } from '../services/outbox.js';
import { routineRecord } from '../services/planner.js';
import { occurrenceOn } from '../domain/routines.js';
import { addDays, minutesOfDay, todayInZone } from '../../shared/time.js';
import type { Router } from '../http/router.js';

type Queryable = Pick<PoolClient, 'query'>;

async function tomorrowFirst(
  client: Queryable,
  member: MemberRow,
  tomorrow: string,
): Promise<{ title: string; startTime: string } | null> {
  const sessions = await client.query<SessionRow & { title: string }>(
    `select s.*, t.title from task_sessions s join tasks t on t.id = s.task_id
      where s.member_id = $1 and s.local_date = $2`,
    [member.id, tomorrow],
  );
  const routines = await client.query<RoutineRow>('select * from routines where member_id = $1', [member.id]);

  const candidates: { title: string; startTime: string }[] = sessions.rows.map((row) => ({
    title: row.title,
    startTime: row.start_time,
  }));
  for (const row of routines.rows) {
    const occurrence = occurrenceOn(routineRecord(row), tomorrow, member.time_zone);
    if (occurrence) candidates.push({ title: occurrence.name, startTime: occurrence.startTime });
  }
  candidates.sort(
    (left, right) =>
      minutesOfDay(left.startTime) - minutesOfDay(right.startTime) || left.title.localeCompare(right.title),
  );
  return candidates[0] ?? null;
}

async function buildPreview(
  client: Queryable,
  member: MemberRow,
  today: string,
): Promise<ShutdownPreviewDto> {
  const tasks = await client.query<TaskRow>(
    'select * from tasks where member_id = $1 and day_date = $2 order by position, created_at',
    [member.id, today],
  );
  return {
    date: today,
    done: tasks.rows.filter((task) => task.status === 'done').map((task) => ({ id: task.id, title: task.title })),
    carriedOver: tasks.rows
      .filter((task) => task.status === 'open')
      .map((task) => ({ id: task.id, title: task.title })),
    tomorrowFirst: await tomorrowFirst(client, member, addDays(today, 1)),
  };
}

async function preview(context: RequestContext): Promise<ShutdownPreviewDto> {
  const { member } = requirePlanner(context);
  return buildPreview(pool, member, todayInZone(member.time_zone));
}

/**
 * Shutdown moves today's open tasks to the top of tomorrow's column, clears their sessions
 * and queues one digest per member per local date.
 */
async function shutdown(context: RequestContext): Promise<ShutdownResultDto> {
  const { member } = requirePlanner(context);
  requireWritable(context);
  const today = todayInZone(member.time_zone);
  const tomorrow = addDays(today, 1);

  const outcome = await withTransaction(async (tx) => {
    const tasks = await tx.query<TaskRow>(
      'select * from tasks where member_id = $1 and day_date = $2 order by position, created_at for update',
      [member.id, today],
    );
    const done = tasks.rows.filter((task) => task.status === 'done');
    const open = tasks.rows.filter((task) => task.status === 'open');

    if (open.length > 0) {
      await tx.query(
        `update tasks set position = position + $3
          where member_id = $1 and day_date = $2`,
        [member.id, tomorrow, open.length],
      );
      let seat = 0;
      for (const task of open) {
        await tx.query('delete from task_sessions where task_id = $1', [task.id]);
        await tx.query(
          `update tasks set day_date = $2, position = $3, version = version + 1, updated_at = now()
            where id = $1`,
          [task.id, tomorrow, seat],
        );
        seat += 1;
      }
    }

    const first = await tomorrowFirst(tx, member, tomorrow);
    const claimed = await tx.query(
      'insert into digest_log (member_id, local_date, created_at) values ($1, $2, now()) on conflict do nothing',
      [member.id, today],
    );

    let queueId: string | null = null;
    if (claimed.rowCount === 1) {
      queueId = await enqueue(
        tx,
        'mail',
        {
          ...digestMail({
            email: member.email,
            date: today,
            tomorrow,
            done: done.map((task) => task.title),
            carriedOver: open.map((task) => task.title),
            tomorrowFirst: first,
          }),
        },
        `digest:${member.id}:${today}`,
      );
    }

    return {
      date: today,
      done: done.map((task) => ({ id: task.id, title: task.title })),
      carriedOver: open.map((task) => ({ id: task.id, title: task.title })),
      tomorrowFirst: first,
      queueId,
      alreadySent: claimed.rowCount !== 1,
    };
  });

  if (outcome.alreadySent) {
    return {
      date: outcome.date,
      done: outcome.done,
      carriedOver: outcome.carriedOver,
      tomorrowFirst: outcome.tomorrowFirst,
      digest: 'already_sent',
    };
  }
  const sent = await runItemNow(outcome.queueId);
  return {
    date: outcome.date,
    done: outcome.done,
    carriedOver: outcome.carriedOver,
    tomorrowFirst: outcome.tomorrowFirst,
    digest: sent ? 'sent' : 'queued',
  };
}

export function registerShutdownRoutes(router: Router): void {
  router.get('/api/shutdown/preview', preview);
  router.post('/api/shutdown', shutdown);
}
