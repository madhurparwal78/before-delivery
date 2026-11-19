import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, fieldCopy } from './errors';
import { canPin, requireViewer } from './auth';
import type { AppServices } from './context';
import { acceptedFields } from './routes-session';
import { buildMessageView, isoInstant, requireChannel, requireReadableMessage } from './messages-domain';
import { buildChannelView } from './channels-domain';
import { isUuid } from './validate';
import { logChannelEvent } from './events';
import { parsePaging, encodeCursor } from './paging';
import { PIN_LIMIT } from '../shared/terms';

export function registerPinRoutes(app: FastifyInstance, services: AppServices): void {
  app.post('/api/channels/:id/pins', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await requireViewer(services.db, request);
    if (!canPin(viewer.role)) throw new ApiError('forbidden');
    const channelId = (request.params as Record<string, string>).id;
    const channel = await requireChannel(services.db, channelId, viewer);
    const body = (request.body as Record<string, unknown> | null) ?? {};
    const errors: Record<string, string> = {};
    for (const key of acceptedFields(body, ['message_id'])) errors[key] = fieldCopy('unaccepted');
    const messageId = typeof body.message_id === 'string' ? body.message_id : '';
    if (!isUuid(messageId)) {
      errors.message_id = fieldCopy('messageIdPins');
      if (Object.keys(errors).length === 0) errors.message_id = fieldCopy('messageIdPins');
    }
    if (Object.keys(errors).length > 0) throw new ApiError('validation', undefined, errors);

    const target = await services.db.pool.query(
      'SELECT channel_id, deleted FROM messages WHERE id = $1',
      [messageId],
    );
    if (target.rowCount === 0 || target.rows[0].channel_id !== channel.id || target.rows[0].deleted) {
      throw new ApiError('not_found');
    }

    const inserted = await services.db.tx(async (client) => {
      // Serialise pin requests per channel so simultaneous pins never exceed
      // the limit and duplicates answer already_pinned.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [channel.id]);
      const existing = await client.query('SELECT 1 FROM pins WHERE channel_id = $1 AND message_id = $2', [channel.id, messageId]);
      if (existing.rowCount && existing.rowCount > 0) {
        return 'already_pinned' as const;
      }
      const count = await client.query('SELECT count(*)::int AS n FROM pins WHERE channel_id = $1', [channel.id]);
      if (count.rows[0].n >= PIN_LIMIT) {
        return 'pin_limit' as const;
      }
      await client.query(
        'INSERT INTO pins (channel_id, message_id, pinned_by, pinned_at) VALUES ($1,$2,$3,$4)',
        [channel.id, messageId, viewer.id, services.clock.now()],
      );
      return 'created' as const;
    });
    if (inserted === 'already_pinned') throw new ApiError('already_pinned');
    if (inserted === 'pin_limit') throw new ApiError('pin_limit');

    const message = await services.db.pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
    const view = await buildMessageView(services.db, message.rows[0], services.config.editWindowSeconds);
    await logChannelEvent(services.db, services.clock, 'message.updated', channel.workspace_id, channel.id, { message: view });
    reply.status(201);
    const pins = await services.db.pool.query('SELECT message_id FROM pins WHERE channel_id = $1 ORDER BY pinned_at DESC', [channel.id]);
    return { pinned_message_ids: pins.rows.map((r: { message_id: string }) => r.message_id) };
  });

  app.delete('/api/channels/:id/pins/:messageId', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewer = await requireViewer(services.db, request);
    if (!canPin(viewer.role)) throw new ApiError('forbidden');
    const channelId = (request.params as Record<string, string>).id;
    const messageId = (request.params as Record<string, string>).messageId;
    const channel = await requireChannel(services.db, channelId, viewer);
    const removed = await services.db.tx(async (client) => {
      const res = await client.query('DELETE FROM pins WHERE channel_id = $1 AND message_id = $2 RETURNING message_id', [channel.id, messageId]);
      return (res.rowCount ?? 0) > 0;
    });
    if (!removed) throw new ApiError('not_found');
    const message = await services.db.pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
    if (message.rowCount === 1 && !message.rows[0].deleted) {
      const view = await buildMessageView(services.db, message.rows[0], services.config.editWindowSeconds);
      await logChannelEvent(services.db, services.clock, 'message.updated', channel.workspace_id, channel.id, { message: view });
    }
    reply.status(204);
    return null;
  });
}
