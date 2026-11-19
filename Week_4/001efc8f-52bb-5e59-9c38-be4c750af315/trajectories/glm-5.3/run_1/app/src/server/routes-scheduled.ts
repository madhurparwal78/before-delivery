import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, fieldCopy } from './errors';
import { canSchedule, requireViewer } from './auth';
import type { AppServices } from './context';
import { acceptedFields } from './routes-session';
import { requireChannel } from './messages-domain';
import { buildScheduledView, localTimeToInstant, nextWeeklyAfter } from './scheduled-domain';
import { logChannelEvent } from './events';
import type { FullMessageRow } from './messages-domain';
import { mentionedHandles } from './mentions';

export function registerScheduledRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/api/channels/:id/scheduled', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const channelId = (request.params as Record<string, string>).id;
    const channel = await requireChannel(services.db, channelId, viewer);
    const res = await services.db.pool.query(
      `SELECT * FROM scheduled_posts WHERE channel_id = $1 AND workspace_id = $2 ORDER BY (state = 'sent' OR state = 'cancelled'), next_fire_at ASC NULLS LAST`,
      [channel.id, channel.workspace_id],
    );
    const scheduled = [];
    for (const row of res.rows) scheduled.push(await buildScheduledView(services, row));
    return { scheduled };
  });

  app.post('/api/channels/:id/scheduled', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await requireViewer(services.db, request);
    if (!canSchedule(viewer.role)) throw new ApiError('forbidden');
    const channelId = (request.params as Record<string, string>).id;
    const channel = await requireChannel(services.db, channelId, viewer);
    const body = (request.body as Record<string, unknown> | null) ?? {};
    const errors: Record<string, string> = {};
    for (const key of acceptedFields(body, ['text', 'local_date', 'local_time', 'repeat'])) errors[key] = fieldCopy('unaccepted');

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const localDate = typeof body.local_date === 'string' ? body.local_date : '';
    const localTime = typeof body.local_time === 'string' ? body.local_time : '';
    const repeat = typeof body.repeat === 'string' ? body.repeat : '';
    if (text === '') errors.text = fieldCopy('textEmpty');
    if (text.length > 4000) errors.text = fieldCopy('textTooLong');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !/^\d{2}:\d{2}(:\d{2})?$/.test(localTime)) {
      errors.local_date = fieldCopy('localDateTime');
    }
    if (repeat !== 'none' && repeat !== 'weekly') errors.repeat = fieldCopy('repeat');
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);

    const zone = await workspaceZone(services, channel.workspace_id);
    const time = normaliseTime(localTime);
    const firstAt = localTimeToInstant(zone, localDate, time, services.clock.now());
    if (firstAt.getTime() <= services.clock.now().getTime()) {
      throw new ApiError('validation', undefined, {
        local_time: fieldCopy('localTimePast').replace('{zone}', zone),
      });
    }
    const id = crypto.randomUUID();
    await services.db.pool.query(
      `INSERT INTO scheduled_posts (id, channel_id, workspace_id, created_by, text, state, repeat, local_date, local_time, next_fire_at, fired_count)
       VALUES ($1,$2,$3,$4,$5,'scheduled',$6,$7,$8,$9,0)`,
      [id, channel.id, channel.workspace_id, viewer.id, text, repeat, localDate, time, firstAt],
    );
    const row = await services.db.pool.query('SELECT * FROM scheduled_posts WHERE id = $1', [id]);
    reply.status(201);
    return { scheduled: await buildScheduledView(services, row.rows[0]) };
  });

  app.delete('/api/scheduled/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await requireViewer(services.db, request);
    const id = (request.params as Record<string, string>).id;
    const row = await services.db.pool.query(
      `SELECT sp.*, c.workspace_id AS ws FROM scheduled_posts sp JOIN channels c ON c.id = sp.channel_id WHERE sp.id = $1`,
      [id],
    );
    if (row.rowCount === 0 || row.rows[0].ws !== viewer.workspaceId) throw new ApiError('not_found');
    const post = row.rows[0];
    const member = await services.db.pool.query('SELECT 1 FROM memberships WHERE channel_id = $1 AND user_id = $2', [post.channel_id, viewer.id]);
    if (member.rowCount === 0) throw new ApiError('not_found');
    if (!canSchedule(viewer.role)) throw new ApiError('forbidden');
    if (post.state !== 'scheduled') throw new ApiError('schedule_not_pending');
    const updated = await services.db.tx(async (client) => {
      const res = await client.query(
        `UPDATE scheduled_posts SET state = 'cancelled', next_fire_at = NULL WHERE id = $1 AND state = 'scheduled' RETURNING *`,
        [id],
      );
      return res.rowCount === 1 ? res.rows[0] : null;
    });
    if (!updated) throw new ApiError('schedule_not_pending');
    reply.status(200);
    return { scheduled: await buildScheduledView(services, updated) };
  });
}

function normaliseTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}

export async function workspaceZone(services: AppServices, workspaceId: string): Promise<string> {
  const res = await services.db.pool.query('SELECT time_zone FROM workspaces WHERE id = $1', [workspaceId]);
  return res.rows[0].time_zone;
}

export { localTimeToInstant };
export async function fireScheduledPosts(services: AppServices): Promise<void> {
  const due = await services.db.pool.query(
    `SELECT * FROM scheduled_posts WHERE state = 'scheduled' AND next_fire_at IS NOT NULL AND next_fire_at <= $1`,
    [services.clock.now()],
  );
  for (const post of due.rows) {
    const claim = await services.db.tx(async (client) => {
      const res = await client.query(
        `UPDATE scheduled_posts SET state = 'firing' WHERE id = $1 AND state = 'scheduled' AND next_fire_at <= $2 RETURNING *`,
        [post.id, services.clock.now()],
      );
      return res.rowCount === 1 ? res.rows[0] : null;
    });
    if (!claim) continue;
    await fireOne(services, claim);
  }
}

async function fireOne(services: AppServices, post: Record<string, unknown>): Promise<void> {
  const channelId = post.channel_id as string;
  const workspaceId = post.workspace_id as string;
  const createdBy = post.created_by as string;
  const scheduler = await services.db.pool.query(
    'SELECT id, status FROM users WHERE id = $1',
    [createdBy],
  );
  const stillMember = scheduler.rowCount === 1 && scheduler.rows[0].status === 'active'
    && (await services.db.pool.query('SELECT 1 FROM memberships WHERE channel_id = $1 AND user_id = $2', [channelId, createdBy])).rowCount === 1;
  if (!stillMember) {
    await services.db.pool.query(`UPDATE scheduled_posts SET state = 'cancelled', next_fire_at = NULL WHERE id = $1`, [post.id]);
    return;
  }
  const sentAt = services.clock.now();
  const messageId = crypto.randomUUID();
  await services.db.tx(async (client) => {
    const inserted = await client.query<FullMessageRow>(
      `INSERT INTO messages (id, channel_id, workspace_id, client_message_id, author_id, text, version, sent_at, thread_root_id, quoted_message_id, deleted)
       VALUES ($1,$2,$3,$4,$5,$6,1,$7,NULL,NULL,false) RETURNING *`,
      [messageId, channelId, workspaceId, crypto.randomUUID(), createdBy, post.text, sentAt],
    );
    const row = inserted.rows[0];
    await client.query(
      'INSERT INTO message_versions (message_id, version, text, edited_by, created_at) VALUES ($1,1,$2,$3,$4)',
      [row.id, post.text, createdBy, sentAt],
    );
    const recipients = await client.query(
      'SELECT user_id FROM memberships WHERE channel_id = $1 AND user_id <> $2 AND joined_at <= $3',
      [channelId, createdBy, sentAt],
    );
    for (const r of recipients.rows) {
      await client.query('INSERT INTO receipts (message_id, user_id, delivered_at) VALUES ($1,$2,NULL) ON CONFLICT DO NOTHING', [row.id, r.user_id]);
    }
    const wanted = mentionedHandles(post.text as string).map((h) => h.toLowerCase());
    if (wanted.length > 0) {
      const members = await client.query<{ id: string; handle: string }>(
        'SELECT u.id, u.handle FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.channel_id = $1',
        [channelId],
      );
      for (const member of members.rows) {
        if (member.id === createdBy) continue;
        if (wanted.includes(member.handle.toLowerCase())) {
          await client.query(
            'INSERT INTO mentions (message_id, channel_id, mentioned_user_id, created_at) VALUES ($1,$2,$3,$4)',
            [row.id, channelId, member.id, sentAt],
          );
        }
      }
    }
    const zone = (await client.query('SELECT time_zone FROM workspaces WHERE id = $1', [workspaceId])).rows[0].time_zone;
    const repeat = post.repeat as string;
    let nextState = 'sent' as string;
    let nextFire: Date | null = null;
    if (repeat === 'weekly') {
      nextState = 'scheduled';
      const [y, mo, d] = (post.local_date as string).split('-').map(Number);
      const [h, mi] = (post.local_time as string).split(':').map(Number);
      nextFire = nextWeeklyAfter(zone, (post.next_fire_at as Date), h, mi);
      void y; void mo; void d;
    }
    await client.query(
      `UPDATE scheduled_posts SET state = $2, next_fire_at = $3, last_fired_at = $4, fired_count = fired_count + 1, last_message_id = $5 WHERE id = $1`,
      [post.id, nextState, nextFire, sentAt, row.id],
    );
  });
  const channelRow = await services.db.pool.query('SELECT workspace_id FROM channels WHERE id = $1', [channelId]);
  const row = await services.db.pool.query<FullMessageRow>('SELECT * FROM messages WHERE id = $1', [messageId]);
  const { buildMessageView, messageCounts } = await import('./messages-domain');
  const message = await buildMessageView(services.db, row.rows[0], services.config.editWindowSeconds);
  await logChannelEvent(services.db, services.clock, 'message.created', channelRow.rows[0].workspace_id, channelId, { message });
  const counts = await messageCounts(services.db, messageId);
  await logChannelEvent(services.db, services.clock, 'receipts.updated', channelRow.rows[0].workspace_id, channelId, {
    message_id: messageId,
    channel_id: channelId,
    ...counts,
  });
  const { announceBadgeChanges } = await import('./routes-read');
  await announceBadgeChanges(services, channelId, workspaceId, createdBy);
}
