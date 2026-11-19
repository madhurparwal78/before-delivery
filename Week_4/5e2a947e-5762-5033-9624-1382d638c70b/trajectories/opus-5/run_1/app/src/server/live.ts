import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { can } from '../shared/permissions.js';
import { parseCookies, sameOriginOk } from './http.js';
import {
  addAudience,
  addConnection,
  colourForJoin,
  connectionsFor,
  dropAudience,
  dropConnection,
  publish,
  replayMessages,
  sendTo,
  type Connection,
} from './bus.js';
import { optionalActor } from './auth.js';
import { db } from './db.js';
import { loadMap, roleFor } from './mapstore.js';
import { audiencePayload, presentationByCode } from './routes/presentations.js';
import { now } from './clock.js';

const wss = new WebSocketServer({ noServer: true });

function cookieContext(req: IncomingMessage): Parameters<typeof optionalActor>[0] {
  const cookieHeader = Array.isArray(req.headers.cookie)
    ? req.headers.cookie.join('; ')
    : req.headers.cookie;
  return {
    method: 'GET',
    path: req.url ?? '/',
    query: new URLSearchParams(),
    params: {},
    headers: req.headers,
    cookies: parseCookies(cookieHeader),
    body: Buffer.alloc(0),
    setCookie: () => undefined,
    origin: '',
  };
}

export async function presenceList(mapId: string): Promise<Record<string, unknown>[]> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const conn of connectionsFor(mapId)) {
    seen.set(conn.actorKey, {
      key: conn.actorKey,
      name: conn.actorName,
      guest: conn.kind === 'guest',
      role: conn.role,
      colour: conn.colour,
      cursor: conn.cursor,
      view: conn.view,
    });
  }
  return [...seen.values()];
}

export async function broadcastPresence(mapId: string): Promise<void> {
  await publish(mapId, { type: 'presence', payload: { people: await presenceList(mapId) } });
}

export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  if (!sameOriginOk(req)) {
    socket.destroy();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const mapMatch = /^\/api\/maps\/([^/]+)\/live$/.exec(url.pathname);
  const audienceMatch = /^\/api\/presentations\/by-code\/([^/]+)\/live$/.exec(url.pathname);
  if (mapMatch) {
    void handleMapUpgrade(req, socket, head, decodeURIComponent(mapMatch[1]), url);
    return;
  }
  if (audienceMatch) {
    void handleAudienceUpgrade(req, socket, head, decodeURIComponent(audienceMatch[1]));
    return;
  }
  socket.destroy();
}

async function handleMapUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  mapId: string,
  url: URL,
): Promise<void> {
  const actor = await optionalActor(cookieContext(req)).catch(() => null);
  const map = await loadMap(db, mapId);
  if (!map || !actor) {
    socket.destroy();
    return;
  }
  const role = await roleFor(db, map, actor);
  if (role === null) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const conn: Connection = {
      ws,
      mapId,
      actorKey: actor.key,
      actorName: actor.name,
      kind: actor.kind,
      role,
      canSeeRestricted: can(role, 'see_restricted'),
      colour: colourForJoin(mapId),
      cursor: null,
      view: null,
    };
    addConnection(conn);
    const since = Number(url.searchParams.get('since') ?? '0');
    sendTo(conn, { seq: 0, type: 'hello', revision: map.revision, colour: conn.colour });
    void (async () => {
      if (Number.isFinite(since) && since > 0) await replayMessages(conn, since);
      await broadcastPresence(mapId);
    })();
    ws.on('message', (raw) => {
      void handleClientMessage(conn, String(raw));
    });
    ws.on('close', () => {
      dropConnection(conn);
      void broadcastPresence(mapId);
      void markPresenterGone(conn);
    });
  });
}

async function markPresenterGone(conn: Connection): Promise<void> {
  const open = await db.query<{ id: string; presenter: string }>(
    "select id, presenter from presentations where map_id = $1 and state = 'live'",
    [conn.mapId],
  );
  for (const row of open.rows) {
    if (row.presenter !== conn.actorName) continue;
    const stillHere = connectionsFor(conn.mapId).some(
      (other) => other.actorName === row.presenter,
    );
    if (!stillHere) {
      await db.query('update presentations set disconnected_at = $2 where id = $1', [row.id, now()]);
    }
  }
}

async function handleClientMessage(conn: Connection, raw: string): Promise<void> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  if (parsed.type !== 'cursor') return;
  conn.cursor = {
    x: Number(parsed.x ?? 0),
    y: Number(parsed.y ?? 0),
    topic_id: typeof parsed.topic_id === 'string' ? parsed.topic_id : null,
  };
  const view = parsed.view as Record<string, number> | undefined;
  if (view) {
    conn.view = {
      zoom: Number(view.zoom ?? 1),
      pan_x: Number(view.pan_x ?? 0),
      pan_y: Number(view.pan_y ?? 0),
      width: Number(view.width ?? 0),
      height: Number(view.height ?? 0),
    };
  }
  for (const other of connectionsFor(conn.mapId)) {
    if (other === conn) continue;
    sendTo(other, {
      seq: 0,
      type: 'cursor',
      user: conn.actorName,
      key: conn.actorKey,
      colour: conn.colour,
      x: conn.cursor.x,
      y: conn.cursor.y,
      topic_id: conn.cursor.topic_id,
      view: conn.view,
    });
  }
}

async function handleAudienceUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  code: string,
): Promise<void> {
  const row = await presentationByCode(code).catch(() => null);
  if (!row) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    const conn = { ws, code };
    addAudience(conn);
    void (async () => {
      const payload = await audiencePayload(code);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ seq: 0, type: 'presentation', ...payload }));
      }
      await publishFollowers(code);
    })();
    ws.on('close', () => {
      dropAudience(conn);
      void publishFollowers(code);
    });
  });
}

export async function publishFollowers(code: string): Promise<void> {
  const row = await presentationByCode(code).catch(() => null);
  if (!row) return;
  const payload = await audiencePayload(code);
  await publish(row.map_id, {
    type: 'presentation',
    payload: {
      presentation: {
        id: row.id,
        code: row.code,
        state: row.state,
        slide_index: row.slide_index,
        followers: payload.followers,
      },
      slide: payload.slide,
      slide_count: payload.slide_count,
    },
  });
}
