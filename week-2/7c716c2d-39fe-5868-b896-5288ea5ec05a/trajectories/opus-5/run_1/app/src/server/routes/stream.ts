import { randomUUID } from 'node:crypto';
import { nowDate } from '../clock.js';
import { db } from '../db.js';
import { requireWorkspace } from '../access.js';
import { hashToken } from '../access.js';
import {
  addSubscriber,
  eventRange,
  recipientsOf,
  removeSubscriber,
  storedEventsAfter,
  type StoredEvent,
  type Subscriber,
} from '../events.js';
import { HANDLED } from '../http.js';
import { sessionRoute, type Route } from '../router.js';

const REPLAY_WINDOW = 1000;

function payloadFor(event: StoredEvent, personId: string): Record<string, unknown> {
  if (event.name !== 'message' && event.name !== 'thread_reply') return event.payload;
  if (event.payload.author_id === personId) return event.payload;
  return { ...event.payload, client_key: null };
}

export const streamRoutes: Route[] = [
  sessionRoute('GET', '/api/events', 'none', async (ctx) => {
    const workspaceId = requireWorkspace(ctx.actor);
    const personId = ctx.actor.id;
    const streamId = randomUUID();
    const openedAt = nowDate().toISOString();
    await db.query(
      'insert into streams (id, person_id, workspace_id, opened_at, last_seen_at) values ($1, $2, $3, $4, $4)',
      [streamId, personId, workspaceId, openedAt],
    );
    const range = await eventRange(workspaceId);

    ctx.request.socket?.setKeepAlive(true, 15000);
    ctx.response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    ctx.response.write(': keepalive\n\n');

    const write = (event: StoredEvent): void => {
      const payload = payloadFor(event, personId);
      ctx.response.write(`id: ${event.id}\nevent: ${event.name}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    let lastSent = range.newest;
    const requested = ctx.lastEventId;
    if (requested !== undefined && /^\d+$/.test(requested)) {
      const after = Number(requested);
      if (range.newest > 0 && after < range.oldest - 1) {
        ctx.response.write(`event: reset\ndata: {}\n\n`);
      } else {
        lastSent = after;
        const missed = await storedEventsAfter(workspaceId, after, REPLAY_WINDOW);
        for (const event of missed) {
          const recipients = await recipientsOf(event);
          lastSent = event.id;
          if (!recipients.has(personId)) continue;
          if (event.name === 'message' || event.name === 'thread_reply') {
            const alive = await db.one<{ id: number }>(
              'select id from messages where id = $1 and deleted = false',
              [event.payload.id],
            );
            if (alive === undefined) continue;
          }
          write(event);
        }
      }
    }

    const subscriber: Subscriber = {
      personId,
      workspaceId,
      lastSent,
      deliver(event) {
        write(event);
        if (event.name === 'revoked' && event.payload.scope === 'workspace') close();
      },
      close() {
        close();
      },
    };

    const live = (): boolean =>
      ctx.response.writable && !ctx.response.destroyed && ctx.request.socket?.destroyed !== true;

    const keepalive = setInterval(() => {
      if (!live()) {
        close();
        return;
      }
      ctx.response.write(': keepalive\n\n');
    }, 15000);

    // A stream that is no longer writable stops refreshing its row, so the
    // person's room releases them after the grace period.
    const heartbeat = setInterval(() => {
      if (!live()) {
        close();
        return;
      }
      void db
        .query('update streams set last_seen_at = $2 where id = $1', [streamId, nowDate().toISOString()])
        .catch(() => undefined);
    }, 7000);

    const tokenHash = hashToken(ctx.sessionToken ?? '');
    const sessionWatch = setInterval(() => {
      void db
        .one<{ token_hash: string }>(
          `select s.token_hash from sessions s join people p on p.id = s.person_id
            where s.token_hash = $1 and s.revoked_at is null and p.removed = false`,
          [tokenHash],
        )
        .then((row) => {
          if (row !== undefined) return;
          ctx.response.write(
            `id: ${subscriber.lastSent}\nevent: revoked\ndata: ${JSON.stringify({
              scope: 'workspace',
              id: workspaceId,
            })}\n\n`,
          );
          close();
        })
        .catch(() => undefined);
    }, 1000);

    let closed = false;
    function close(): void {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      clearInterval(heartbeat);
      clearInterval(sessionWatch);
      removeSubscriber(subscriber);
      void db
        .query('update streams set closed_at = $2 where id = $1 and closed_at is null', [
          streamId,
          nowDate().toISOString(),
        ])
        .catch(() => undefined);
      ctx.response.end();
    }

    ctx.request.on('close', close);
    ctx.request.on('error', close);
    ctx.response.on('close', close);
    addSubscriber(subscriber);
    return HANDLED;
  }),
];
