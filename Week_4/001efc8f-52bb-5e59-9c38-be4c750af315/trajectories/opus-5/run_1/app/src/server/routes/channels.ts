import { query, queryOne } from '../db';
import { nowDate, isoOf } from '../clock';
import { ApiError, FieldErrors, forbidden, notFound } from '../errors';
import { alreadyMemberMessage, FIELD_COPY } from '../../shared/copy';
import { listChannelsFor, loadChannelFor, memberChannel } from '../domain/channels';
import { isOpsManager, projectUser, type UserRow } from '../domain/users';
import { isUuid } from '../domain/validate';
import { notifyChannelAdded, notifyChannelRevoked } from '../domain/notify';
import type { Route } from '../http/router';
import { readJsonBody, requireUser, sendJson, sendNoContent, viewerOf, type RequestContext } from '../http/context';

async function listChannels(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  sendJson(ctx, 200, { channels: await listChannelsFor(user.id) });
}

async function getChannel(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  if (!isUuid(channelId)) throw notFound();
  const channel = await loadChannelFor(user.id, channelId);
  if (channel === null) throw notFound();
  const viewer = viewerOf(user);
  const rows = await query<UserRow & { joined_at: Date }>(
    `SELECT u.id, u.workspace_id, u.name, u.handle, u.email, u.role, u.status, cm.joined_at
     FROM channel_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id = $1 ORDER BY u.name ASC`,
    [channelId],
  );
  sendJson(ctx, 200, {
    channel,
    members: rows.map((row) => ({ user: projectUser(row, viewer), joined_at: isoOf(row.joined_at) })),
  });
}

async function addMember(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  const channel = await memberChannel(user.id, user.workspace_id, channelId);
  if (channel === null) throw notFound();

  const body = await readJsonBody(ctx);
  const userId = body['user_id'];
  let target: UserRow | null = null;
  if (isUuid(userId)) {
    target = await queryOne<UserRow>(
      `SELECT id, workspace_id, name, handle, email, role, status FROM users
       WHERE id = $1 AND workspace_id = $2 AND status = 'active'`,
      [userId, user.workspace_id],
    );
    if (target === null) throw notFound();
  }
  if (!isOpsManager(user.role)) throw forbidden();
  if (target === null) {
    const errors = new FieldErrors();
    errors.add('user_id', FIELD_COPY.userId);
    errors.throwIfAny();
    return;
  }

  const existing = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id = $2',
    [channelId, target.id],
  );
  if (existing !== null) throw new ApiError('already_member', { message: alreadyMemberMessage(target.name) });

  const joinedAt = nowDate();
  await query('INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES ($1, $2, $3)', [
    channelId,
    target.id,
    joinedAt,
  ]);
  sendJson(ctx, 201, {
    member: { user: projectUser(target, viewerOf(user)), joined_at: isoOf(joinedAt) },
  });
  await notifyChannelAdded(user.workspace_id, channelId, target.id);
}

async function removeMember(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const channelId = ctx.params['id'] as string;
  const channel = await memberChannel(user.id, user.workspace_id, channelId);
  if (channel === null) throw notFound();
  const targetId = ctx.params['userId'] as string;
  if (!isUuid(targetId)) throw notFound();
  const member = await queryOne<{ user_id: string }>(
    'SELECT user_id FROM channel_members WHERE channel_id = $1 AND user_id = $2',
    [channelId, targetId],
  );
  if (member === null) throw notFound();
  if (!isOpsManager(user.role)) throw forbidden();

  await query('DELETE FROM channel_members WHERE channel_id = $1 AND user_id = $2', [channelId, targetId]);
  sendNoContent(ctx);
  await notifyChannelRevoked(user.workspace_id, channelId, targetId);
}

export const channelRoutes: Route[] = [
  { method: 'GET', pattern: '/api/channels', handler: listChannels },
  { method: 'GET', pattern: '/api/channels/:id', handler: getChannel },
  { method: 'POST', pattern: '/api/channels/:id/members', handler: addMember },
  { method: 'DELETE', pattern: '/api/channels/:id/members/:userId', handler: removeMember },
];
