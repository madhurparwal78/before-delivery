import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, fieldCopy } from './errors';
import { requireViewer } from './auth';
import { projectUser } from './user-projection';
import type { AppServices } from './context';
import { acceptedFields } from './routes-session';
import { buildChannelView } from './channels-domain';
import { requireChannel } from './messages-domain';
import { isUuid } from './validate';
import { logChannelEvent, logPersonalEvent } from './events';
import type { Role, UserStatus } from '../shared/terms';

export function registerChannelRoutes(app: FastifyInstance, services: AppServices): void {
  app.get('/api/channels', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const res = await services.db.pool.query(
      `SELECT c.id, c.workspace_id, c.name, c.kind, c.private
         FROM channels c JOIN memberships m ON m.channel_id = c.id
        WHERE c.workspace_id = $1 AND m.user_id = $2
        ORDER BY c.name`,
      [viewer.workspaceId, viewer.id],
    );
    const channels = [];
    for (const row of res.rows) {
      channels.push(await buildChannelView(services.db, row, viewer.id));
    }
    return { channels };
  });

  app.get('/api/channels/:id', async (request: FastifyRequest) => {
    const viewer = await requireViewer(services.db, request);
    const channelId = (request.params as Record<string, string>).id;
    const channel = await requireChannel(services.db, channelId, viewer);
    const members = await services.db.pool.query(
      `SELECT u.id, u.workspace_id, u.name, u.handle, u.email, u.role, u.status, m.joined_at
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.channel_id = $1 ORDER BY u.name`,
      [channel.id],
    );
    const channelView = await buildChannelView(services.db, channel, viewer.id);
    return {
      channel: channelView,
      members: members.rows.map((row: { id: string; name: string; handle: string; email: string; role: Role; status: UserStatus; joined_at: Date }) => ({
        user: projectUser(row, viewer),
        joined_at: row.joined_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      })),
    };
  });

  app.post('/api/channels/:id/members', async (request: FastifyRequest, reply: { status: (code: number) => void }) => {
    const viewer = await requireViewer(services.db, request);
    if (viewer.role !== 'ops_manager') throw new ApiError('forbidden');
    const channelId = (request.params as Record<string, string>).id;
    const channel = await requireChannel(services.db, channelId, viewer);
    const body = request.body as Record<string, unknown> | null ?? {};
    const errors: Record<string, string> = {};
    for (const key of acceptedFields(body, ['user_id'])) errors[key] = fieldCopy('unaccepted');
    const userId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!isUuid(userId)) {
      errors.user_id = fieldCopy('userId');
      if (Object.keys(errors).length === 0) errors.user_id = fieldCopy('userId');
    }
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);

    const target = await services.db.pool.query<{ id: string; workspace_id: string; name: string; status: string }>(
      'SELECT id, workspace_id, name, status FROM users WHERE id = $1',
      [userId],
    );
    if (target.rowCount === 0 || target.rows[0].workspace_id !== viewer.workspaceId || target.rows[0].status !== 'active') {
      throw new ApiError('not_found');
    }
    const existing = await services.db.pool.query('SELECT 1 FROM memberships WHERE channel_id = $1 AND user_id = $2', [channel.id, userId]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ApiError('already_member', undefined, { name: target.rows[0].name });
    }
    const now = services.clock.now();
    await services.db.pool.query('INSERT INTO memberships (channel_id, user_id, joined_at) VALUES ($1,$2,$3)', [channel.id, userId, now]);
    await logPersonalEvent(services.db, services.clock, 'channel.added', viewer.workspaceId, userId,
      { channel: await buildChannelView(services.db, channel, userId) });
    reply.status(201);
    const row = await services.db.pool.query(
      'SELECT u.id, u.workspace_id, u.name, u.handle, u.email, u.role, u.status FROM users u WHERE u.id = $1',
      [userId],
    );
    return { member: { user: projectUser(row.rows[0], viewer), joined_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z') } };
  });

  app.delete('/api/channels/:id/members/:userId', async (request: FastifyRequest, reply: { status: (code: number) => void }) => {
    const viewer = await requireViewer(services.db, request);
    if (viewer.role !== 'ops_manager') throw new ApiError('forbidden');
    const channelId = (request.params as Record<string, string>).id;
    const targetId = (request.params as Record<string, string>).userId;
    const channel = await requireChannel(services.db, channelId, viewer);
    const existing = await services.db.pool.query('SELECT 1 FROM memberships WHERE channel_id = $1 AND user_id = $2', [channel.id, targetId]);
    if (!existing.rowCount || existing.rowCount === 0) throw new ApiError('not_found');
    await services.db.pool.query('DELETE FROM memberships WHERE channel_id = $1 AND user_id = $2', [channel.id, targetId]);
    await logPersonalEvent(services.db, services.clock, 'channel.revoked', viewer.workspaceId, targetId, {
      channel_id: channel.id,
      channel_name: channel.name,
    });
    reply.status(204);
    return null;
  });
}
