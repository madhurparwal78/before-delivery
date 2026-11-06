import type { Request, Response } from 'express';
import { Router } from 'express';
import { one, query } from '../db/pool.js';
import { buildError, fail } from '../errors.js';
import { type SessionUser, requireUser } from '../http/session.js';
import { tableObject } from '../domain/games.js';
import {
  type StoredEvent,
  type StreamName,
  eventsAfter,
  latestSeq,
  oldestKeptSeq,
  waitForEvent,
} from '../domain/events.js';
import { loadTable } from '../domain/tables.js';
import { scopeByServerId, scopeBySlug, serverObject } from '../domain/servers.js';
import { weatherOf } from '../domain/weather.js';
import { requireWorld, worldObject } from '../domain/world.js';
import { friendsOf } from './session.js';
import { route } from './helpers.js';

export const eventRoutes = Router();

const HEARTBEAT_MS = 15000;
const POLL_MS = 250;

interface Stream {
  readonly serverId: string;
  readonly stream: StreamName;
  readonly scopeId: string;
  readonly user: SessionUser;
  /** The snapshot event a fresh connect receives first. */
  readonly snapshot: () => Promise<{ kind: string; payload: unknown }>;
  /** Rebuilds an event's payload for this subscriber, applying every filter. */
  readonly rebuild?: (event: StoredEvent) => Promise<unknown | null>;
}

function writeEvent(res: Response, id: number, kind: string, payload: unknown): void {
  res.write(`id: ${id}\nevent: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`);
}

async function serve(req: Request, res: Response, stream: Stream): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 2000\n\n');

  const header = req.headers['last-event-id'];
  const offered = Array.isArray(header) ? header[0] : header;
  const resumeFrom = offered === undefined ? null : Number(offered);

  let cursor: number;
  const oldest = await oldestKeptSeq(stream.serverId);
  const needSnapshot =
    resumeFrom === null ||
    !Number.isFinite(resumeFrom) ||
    (oldest > 0 && resumeFrom < oldest - 1);

  if (needSnapshot) {
    cursor = await latestSeq(stream.serverId);
    const snapshot = await stream.snapshot();
    writeEvent(res, cursor, snapshot.kind, snapshot.payload);
  } else {
    cursor = resumeFrom;
  }

  let open = true;
  const close = (): void => {
    open = false;
  };
  req.on('close', close);
  res.on('close', close);

  const heartbeat = setInterval(() => {
    if (open) res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  try {
    while (open) {
      const pending = await eventsAfter(stream.serverId, stream.stream, stream.scopeId, cursor);
      for (const event of pending) {
        cursor = event.seq;
        if (event.audience !== null && !event.audience.includes(stream.user.id)) continue;
        const payload =
          stream.rebuild === undefined ? event.payload : await stream.rebuild(event);
        if (payload === null) continue;
        writeEvent(res, event.seq, event.kind, payload);
      }
      if (!open) break;
      await waitForEvent(stream.serverId, POLL_MS);
    }
  } catch (error) {
    const built = buildError(error);
    res.write(`event: error\ndata: ${JSON.stringify(built.body)}\n\n`);
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

eventRoutes.get(
  '/servers/:slug/events',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);

    await query(
      `INSERT INTO presence (server_id, user_id, open_count) VALUES ($1, $2, 1)
       ON CONFLICT (server_id, user_id) DO UPDATE SET open_count = presence.open_count + 1`,
      [scope.server.id, user.id],
    );
    await publishPresence(scope.server.id, user.handle, true);

    const release = async (): Promise<void> => {
      await query(
        `UPDATE presence SET open_count = greatest(0, open_count - 1), closed_at = now()
          WHERE server_id = $1 AND user_id = $2`,
        [scope.server.id, user.id],
      );
      const left = await one<{ open_count: number }>(
        'SELECT open_count FROM presence WHERE server_id = $1 AND user_id = $2',
        [scope.server.id, user.id],
      );
      if ((left?.open_count ?? 0) === 0) await publishPresence(scope.server.id, user.handle, false);
    };
    res.on('close', () => {
      void release();
    });

    await serve(req, res, {
      serverId: scope.server.id,
      stream: 'server',
      scopeId: scope.server.id,
      user,
      snapshot: async () => ({
        kind: 'snapshot',
        payload: {
          server: await serverObject(scope.server, user.id),
          friends: await friendsOf(scope.server.id),
          weather: weatherOf(scope.server.weather_seed),
        },
      }),
      rebuild: async (event) => {
        if (event.kind !== 'server') return event.payload;
        const { loadServerById } = await import('../domain/servers.js');
        const server = await loadServerById(scope.server.id);
        return server === null ? null : serverObject(server, user.id);
      },
    });
  }),
);

async function publishPresence(
  serverId: string,
  handle: string,
  online: boolean,
): Promise<void> {
  const { appendEvent } = await import('../domain/events.js');
  await appendEvent({
    serverId,
    stream: 'server',
    scopeId: serverId,
    kind: 'presence',
    payload: { handle, online },
  });
  await appendEvent({
    serverId,
    stream: 'server',
    scopeId: serverId,
    kind: 'friends',
    payload: { friends: await friendsOf(serverId) },
  });
}

eventRoutes.get(
  '/servers/:slug/worlds/:world/events',
  route(async (req, res) => {
    const user = await requireUser(req);
    const scope = await scopeBySlug(req.params.slug, user);
    const world = await requireWorld(scope.server.id, req.params.world);
    await serve(req, res, {
      serverId: scope.server.id,
      stream: 'world',
      scopeId: world.id,
      user,
      snapshot: async () => ({
        kind: 'world',
        payload: await worldObject(await requireWorld(scope.server.id, req.params.world)),
      }),
      rebuild: async (event) => {
        if (event.kind !== 'world') return event.payload;
        const payload = event.payload;
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'announcement' in payload &&
          !('world_id' in payload)
        ) {
          return payload;
        }
        return worldObject(await requireWorld(scope.server.id, req.params.world));
      },
    });
  }),
);

eventRoutes.get(
  '/tables/:id/events',
  route(async (req, res) => {
    const user = await requireUser(req);
    const table = await loadTable(req.params.id);
    if (table === null) throw fail('not_found');
    const scope = await scopeByServerId(table.server_id, user);
    await serve(req, res, {
      serverId: scope.server.id,
      stream: 'table',
      scopeId: table.id,
      user,
      snapshot: async () => {
        const current = await loadTable(table.id);
        if (current === null) throw fail('not_found');
        return { kind: 'table', payload: await tableObject(current, user.id) };
      },
      /* Each table event is rebuilt through the card visibility filter, so no
         subscriber ever receives another player's hand. */
      rebuild: async (event) => {
        if (event.kind !== 'table') return event.payload;
        const current = await loadTable(table.id);
        return current === null ? null : tableObject(current, user.id);
      },
    });
  }),
);
