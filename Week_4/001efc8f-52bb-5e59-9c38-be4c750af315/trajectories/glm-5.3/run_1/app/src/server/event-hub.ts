import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppServices } from './context';
import { viewerFromRequest } from './auth';
import { ApiError } from './errors';

interface StreamClient {
  workspaceId: string;
  userId: string;
  reply: FastifyReply;
  lastSentId: number;
  closed: boolean;
}

/**
 * The event stream: each connection polls the PostgreSQL event log for new rows
 * visible to the person, replays any requested backlog first, then continues
 * live. No event is sent twice on one connection.
 */
export class EventHub {
  private clients = new Set<StreamClient>();

  constructor(private readonly services: AppServices) {}

  async handleStream(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const viewer = await viewerFromRequest(this.services.db, request);
    if (!viewer) throw new ApiError('unauthenticated');
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(':ok\n\n');

    const lastIdRaw = (request.headers['last-event-id'] as string | undefined)
      ?? (request.query as Record<string, string | undefined>).last_event_id;
    const client: StreamClient = {
      workspaceId: viewer.workspaceId,
      userId: viewer.id,
      reply,
      lastSentId: 0,
      closed: false,
    };
    this.clients.add(client);

    try {
      const newest = await this.newestLoggedId();
      if (lastIdRaw !== undefined && lastIdRaw !== '') {
        const parsed = Number(lastIdRaw);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > newest) {
          client.lastSentId = newest;
          reply.raw.write(this.formatEvent(newest + 1, 'stream.reset', {}));
        } else {
          const oldestRetained = await this.oldestRetainedId();
          if (parsed < oldestRetained) {
            client.lastSentId = newest;
            reply.raw.write(this.formatEvent(newest + 1, 'stream.reset', {}));
          } else {
            client.lastSentId = parsed;
            await this.replayFrom(client, parsed, newest);
          }
        }
      } else {
        client.lastSentId = newest;
      }

      const memberships = await this.currentMemberships(viewer.id);
      void memberships;

      const tick = async (): Promise<void> => {
        if (client.closed) return;
        try {
          await this.pumpClient(client);
        } catch {
          // stream dies; browser reconnects
        }
        if (!client.closed) {
          reply.raw.write(`event: heartbeat\ndata: {}\n\n`);
          setTimeout(tick, 1000);
        }
      };
      setTimeout(tick, 1000);
      const keepAlive = setInterval(() => {
        if (!client.closed) reply.raw.write(':keepalive\n\n');
      }, 15000);
      request.raw.on('close', () => {
        client.closed = true;
        this.clients.delete(client);
        clearInterval(keepAlive);
      });
    } catch (err) {
      client.closed = true;
      this.clients.delete(client);
      reply.raw.end();
    }
  }

  private async currentMemberships(userId: string): Promise<Set<string>> {
    const res = await this.services.db.pool.query('SELECT channel_id FROM memberships WHERE user_id = $1', [userId]);
    return new Set(res.rows.map((r: { channel_id: string }) => r.channel_id));
  }

  private async newestLoggedId(): Promise<number> {
    const res = await this.services.db.pool.query('SELECT COALESCE(MAX(id), 0)::int AS n FROM event_log');
    return res.rows[0].n;
  }

  private async oldestRetainedId(): Promise<number> {
    const cutoff = new Date(this.services.clock.nowMs() - this.services.config.eventRetentionSeconds * 1000);
    const res = await this.services.db.pool.query(
      'SELECT COALESCE(MIN(id), 0)::int AS n FROM event_log WHERE created_at >= $1',
      [cutoff],
    );
    return res.rows[0].n;
  }

  /** Which logged events a person may receive on resume (DP-21). */
  private async visibleEventsFor(client: StreamClient, afterId: number, upToId: number): Promise<{ id: string; type: string; user_id: string | null; channel_id: string | null; data: Record<string, unknown>; workspace_id: string }[]> {
    const memberships = await this.currentMemberships(client.userId);
    const res = await this.services.db.pool.query(
      `SELECT id, workspace_id, user_id, channel_id, type, data FROM event_log
        WHERE id > $1 AND id <= $2 AND workspace_id = $3
        ORDER BY id ASC`,
      [afterId, upToId, client.workspaceId],
    );
    const out = [];
    for (const row of res.rows) {
      if (this.eventVisible(row, client.userId, memberships)) out.push(row);
    }
    return out;
  }

  private eventVisible(row: { user_id: string | null; channel_id: string | null; type: string }, userId: string, memberships: Set<string>): boolean {
    switch (row.type) {
      case 'channel.updated':
      case 'channel.added':
      case 'session.ended':
        return row.user_id === userId;
      case 'channel.revoked':
        return row.user_id === userId;
      case 'stream.reset':
        return true;
      default:
        return row.channel_id !== null && memberships.has(row.channel_id);
    }
  }

  private async replayFrom(client: StreamClient, fromId: number, toId: number): Promise<void> {
    const rows = await this.visibleEventsFor(client, fromId, toId);
    // A channel the person has lost: only its channel.revoked is sent, and none
    // of its other events, before or after the removal.
    const revokedAt = new Map<string, number>();
    for (const row of rows) {
      if (row.type === 'channel.revoked' && row.channel_id && row.user_id === client.userId) {
        if (!revokedAt.has(row.channel_id)) revokedAt.set(row.channel_id, Number(row.id));
      }
    }
    for (const row of rows) {
      if (row.type === 'channel.revoked' && row.user_id === client.userId) {
        client.reply.raw.write(this.formatEvent(Number(row.id), 'channel.revoked', row.data));
        client.lastSentId = Number(row.id);
        continue;
      }
      if (row.channel_id && revokedAt.has(row.channel_id)) {
        continue;
      }
      client.reply.raw.write(this.formatEvent(Number(row.id), row.type, row.data));
      client.lastSentId = Number(row.id);
    }
  }

  private async pumpClient(client: StreamClient): Promise<void> {
    const newest = await this.newestLoggedId();
    if (newest <= client.lastSentId) return;
    const rows = await this.visibleEventsFor(client, client.lastSentId, newest);
    for (const row of rows) {
      client.reply.raw.write(this.formatEvent(Number(row.id), row.type, row.data));
      client.lastSentId = Number(row.id);
    }
  }

  private formatEvent(id: number, type: string, data: Record<string, unknown>): string {
    return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  }
}
