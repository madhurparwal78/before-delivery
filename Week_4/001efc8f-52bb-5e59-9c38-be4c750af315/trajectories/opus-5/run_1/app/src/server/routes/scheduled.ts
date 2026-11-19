import { query, queryOne } from '../db';
import { LIMITS } from '../config';
import { nowDate, nowMs } from '../clock';
import { ApiError, FieldErrors, forbidden, notFound } from '../errors';
import { FIELD_COPY, localTimePast } from '../../shared/copy';
import { memberChannel } from '../domain/channels';
import { canSchedule } from '../domain/users';
import { isUuid } from '../domain/validate';
import {
  occurrencesFrom,
  parseLocalDate,
  parseLocalTime,
  scheduledShape,
  type ScheduledRow,
} from '../domain/scheduled';
import type { Route } from '../http/router';
import { readJsonBody, requireUser, sendJson, type RequestContext } from '../http/context';

const SCHEDULED_COLUMNS = `id, workspace_id, channel_id, created_by, text, state, repeat_rule,
  local_date, local_time, next_fire_at, fired_count, last_message_id`;

async function workspaceZone(workspaceId: string): Promise<string> {
  const row = await queryOne<{ time_zone: string }>('SELECT time_zone FROM workspaces WHERE id = $1', [workspaceId]);
  if (row === null) throw notFound();
  return row.time_zone;
}

async function listScheduled(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  const channel = await memberChannel(user.id, user.workspace_id, channelId);
  if (channel === null) throw notFound();
  const zone = await workspaceZone(user.workspace_id);
  const rows = await query<ScheduledRow>(
    `SELECT ${SCHEDULED_COLUMNS} FROM scheduled_posts WHERE channel_id = $1
     ORDER BY (state IN ('sent','cancelled')) ASC, next_fire_at ASC NULLS LAST, id ASC`,
    [channelId],
  );
  const at = nowMs();
  sendJson(ctx, 200, { scheduled: rows.map((row) => scheduledShape(row, zone, at)) });
}

async function createScheduled(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  const channel = await memberChannel(user.id, user.workspace_id, channelId);
  if (channel === null) throw notFound();
  if (!canSchedule(user.role)) throw forbidden();

  const body = await readJsonBody(ctx);
  const zone = await workspaceZone(user.workspace_id);
  const errors = new FieldErrors();

  const text = typeof body['text'] === 'string' ? (body['text'] as string).trim() : '';
  if (text.length === 0) errors.add('text', FIELD_COPY.textEmpty);
  else if ([...text].length > LIMITS.textCharacters) errors.add('text', FIELD_COPY.textTooLong);

  const rawDate = body['local_date'];
  const rawTime = body['local_time'];
  const date = parseLocalDate(rawDate);
  const time = parseLocalTime(rawTime);
  if (date === null) errors.add('local_date', FIELD_COPY.scheduleWhen);
  if (time === null) errors.add('local_time', FIELD_COPY.scheduleWhen);

  const repeat = body['repeat'];
  if (repeat !== 'none' && repeat !== 'weekly') errors.add('repeat', FIELD_COPY.repeat);

  let fireAt: number | null = null;
  if (date !== null && time !== null && (repeat === 'none' || repeat === 'weekly')) {
    const localDate = rawDate as string;
    const localTime = rawTime as string;
    const occurrences = occurrencesFrom({ local_date: localDate, local_time: localTime, repeat_rule: repeat }, zone, nowMs() + 1, 1);
    const first = occurrences[0];
    if (first === undefined) errors.add('local_time', localTimePast(zone));
    else fireAt = first;
  }
  errors.throwIfAny();

  const row = await queryOne<ScheduledRow>(
    `INSERT INTO scheduled_posts (workspace_id, channel_id, created_by, text, state, repeat_rule, local_date, local_time, next_fire_at, created_at)
     VALUES ($1, $2, $3, $4, 'scheduled', $5, $6, $7, $8, $9)
     RETURNING ${SCHEDULED_COLUMNS}`,
    [
      user.workspace_id,
      channelId,
      user.id,
      text,
      repeat,
      rawDate,
      rawTime,
      new Date(fireAt as number),
      nowDate(),
    ],
  );
  if (row === null) throw new ApiError('internal_error');
  sendJson(ctx, 201, { scheduled: scheduledShape(row, zone, nowMs()) });
}

async function cancelScheduled(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const scheduledId = ctx.params['id'] as string;
  if (!isUuid(scheduledId)) throw notFound();
  const row = await queryOne<ScheduledRow>(
    `SELECT ${SCHEDULED_COLUMNS} FROM scheduled_posts s
     WHERE s.id = $1 AND s.workspace_id = $2
       AND EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = s.channel_id AND cm.user_id = $3)`,
    [scheduledId, user.workspace_id, user.id],
  );
  if (row === null) throw notFound();
  if (!canSchedule(user.role)) throw forbidden();

  const cancelled = await query<ScheduledRow>(
    `UPDATE scheduled_posts SET state = 'cancelled', next_fire_at = NULL
     WHERE id = $1 AND state = 'scheduled' RETURNING ${SCHEDULED_COLUMNS}`,
    [scheduledId],
  );
  const updated = cancelled[0];
  if (updated === undefined) throw new ApiError('schedule_not_pending');
  const zone = await workspaceZone(user.workspace_id);
  sendJson(ctx, 200, { scheduled: scheduledShape(updated, zone, nowMs()) });
}

export const scheduledRoutes: Route[] = [
  { method: 'GET', pattern: '/api/channels/:id/scheduled', handler: listScheduled },
  { method: 'POST', pattern: '/api/channels/:id/scheduled', handler: createScheduled },
  { method: 'DELETE', pattern: '/api/scheduled/:id', handler: cancelScheduled },
];
