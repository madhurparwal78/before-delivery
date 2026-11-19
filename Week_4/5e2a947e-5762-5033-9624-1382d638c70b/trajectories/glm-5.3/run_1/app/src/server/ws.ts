import type { IncomingMessage } from 'node:http';
import type { Services } from './services.js';
import { ApiError, NOTICES } from './errors.js';
import { roleOnMap } from './routes/maps.js';
import { now, nowIso } from './clock.js';
import type { Role } from '../shared/types.js';
import { may } from '../shared/permissions.js';

/**
 * The live connection: per-map WebSockets with replay by sequence,
 * presence with colour allocation, and message filtering by what the
 * recipient may see.
 */

interface LiveBundle {
  ws: import('ws').WebSocket;
  req: IncomingMessage;
}

/** Attach a client to a map's live hub. */
export async function liveAttach(svc: Services, bundle: LiveBundle, mapId: string, user: { username: string; guest: boolean } | null, role: Role | null, since: number): Promise<void> {
  if (!user || !role) throw new ApiError('not_found', NOTICES.unknownMap);
  const colour = svc.hub.allocateColour(mapId, user.username);
  const client = {
    ws: bundle.ws,
    mapId,
    username: user.username,
    role,
    guest: user.guest,
    since,
    lastSeqSent: 0,
    followView: false,
  };
  svc.hub.attach(client);
  svc.hub.setPresence(mapId, user.username, {
    mapId, username: user.username, role, guest: user.guest, colour,
    view: { zoom: 1, pan_x: 0, pan_y: 0, width: 800, height: 600 },
    cursor: { x: 0, y: 0, topic_id: null },
  });
  broadcastPresence(svc, mapId);

  bundle.ws.on('message', (data) => {
    try {
      const msg = JSON.parse(String(data)) as { type?: string; x?: number; y?: number; topic_id?: string | null; view?: { zoom: number; pan_x: number; pan_y: number; width: number; height: number } };
      if (msg.type === 'cursor') {
        svc.hub.setPresence(mapId, user.username, {
          mapId, username: user.username, role, guest: user.guest, colour,
          view: msg.view ?? { zoom: 1, pan_x: 0, pan_y: 0, width: 800, height: 600 },
          cursor: { x: msg.x ?? 0, y: msg.y ?? 0, topic_id: msg.topic_id ?? null },
        });
        svc.hub.broadcast(mapId, 'cursor', {
          username: user.username,
          x: msg.x ?? 0, y: msg.y ?? 0, topic_id: msg.topic_id ?? null,
          view: msg.view,
        }, (c) => c.username !== user.username);
      }
    } catch {
      // ignore malformed messages
    }
  });
  bundle.ws.on('close', () => {
    svc.hub.detach(client);
    schedulePresenceRemoval(svc, mapId, user.username);
  });
  bundle.ws.on('error', () => {
    svc.hub.detach(client);
    schedulePresenceRemoval(svc, mapId, user.username);
  });
}

const pendingRemoval = new Map<string, ReturnType<typeof setTimeout>>();

function schedulePresenceRemoval(svc: Services, mapId: string, username: string): void {
  const key = `${mapId}:${username}`;
  const existing = pendingRemoval.get(key);
  if (existing) clearTimeout(existing);
  pendingRemoval.set(key, setTimeout(() => {
    svc.hub.dropPresence(mapId, username);
    broadcastPresence(svc, mapId);
    pendingRemoval.delete(key);
  }, svc.settings.presence_timeout_ms));
}

function broadcastPresence(svc: Services, mapId: string): void {
  const rows = svc.hub.listPresence(mapId);
  svc.hub.broadcast(mapId, 'presence', {
    people: rows.map((r) => ({ username: r.username, role: r.role, guest: r.guest, colour: r.colour })),
  });
}

/** Handle a WebSocket upgrade request for a map or audience session. */
export async function handleUpgrade(svc: Services, req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer, cookies: Record<string, string>): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost`);
  const path = url.pathname;
  const WebSocket = (await import('ws')).WebSocketServer;
  const wss = new WebSocket({ noServer: true });
  const finish = (handler: (bundle: LiveBundle) => Promise<void>) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handler({ ws, req });
    });
  };
  const mapLive = path.match(/^\/api\/maps\/([^/]+)\/live$/);
  if (mapLive) {
    finish(async (bundle) => {
      const mapId = mapLive[1];
      const username = cookies.sprig_session ? await usernameForSession(svc, cookies.sprig_session) : null;
      const guest = cookies.sprig_guest ? await guestFor(svc, cookies.sprig_guest, mapId) : null;
      const who = username ? { username, guest: false } : guest ? { username: guest.username, guest: true } : null;
      const role = username ? await roleOnMap(svc, mapId, username) : guest?.role ?? null;
      if (!who || !role) {
        bundle.ws.close(4404, 'not found');
        return;
      }
      await liveAttach(svc, bundle, mapId, who, role, Number(url.searchParams.get('since') ?? 0));
    });
    return;
  }
  const presLive = path.match(/^\/api\/presentations\/by-code\/([^/]+)\/live$/);
  if (presLive) {
    finish(async (bundle) => {
      const pres = await svc.db.one<{ id: string; map_id: string; state: string; slide_index: number; followers: number }>(
        'SELECT id, map_id, state, slide_index, followers FROM presentations WHERE code = $1', [presLive[1]],
      );
      if (!pres) {
        bundle.ws.close(4404, 'not found');
        return;
      }
      const client = { ws: bundle.ws, mapId: `pres:${pres.id}`, username: `audience-${Math.random().toString(36).slice(2, 8)}`, role: 'viewer', guest: true, since: 0, lastSeqSent: 0, followView: false };
      svc.hub.attach(client);
      await svc.db.query('UPDATE presentations SET followers = followers + 1 WHERE id = $1', [pres.id]);
      const fresh = await svc.db.one<{ followers: number }>('SELECT followers FROM presentations WHERE id = $1', [pres.id]);
      svc.hub.broadcast(pres.map_id, 'presentation', { presentation: { ...pres, followers: Number(fresh?.followers ?? 1) } });
      bundle.ws.on('close', () => {
        svc.hub.detach(client);
        void svc.db.query('UPDATE presentations SET followers = GREATEST(followers - 1, 0) WHERE id = $1', [pres.id]).then(() => {
          void svc.db.one<{ followers: number }>('SELECT followers FROM presentations WHERE id = $1', [pres.id]).then((row) => {
            svc.hub.broadcast(pres.map_id, 'presentation', { presentation: { ...pres, followers: Number(row?.followers ?? 0) } });
          });
        });
      });
      bundle.ws.send(JSON.stringify({ seq: 1, type: 'presentation', presentation: { ...pres, followers: Number(fresh?.followers ?? 1) }, server_time: nowIso() }));
    });
    return;
  }
  socket.destroy();
}

async function usernameForSession(svc: Services, sessionId: string): Promise<string | null> {
  const row = await svc.db.one<{ username: string; expires_at: Date }>(
    'SELECT u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1', [sessionId],
  );
  if (!row) return null;
  if (row.expires_at.getTime() <= now().getTime()) return null;
  return row.username;
}

async function guestFor(svc: Services, token: string, mapId: string): Promise<{ username: string; role: Role } | null> {
  const row = await svc.db.one<{ username: string; role: string }>('SELECT username, role FROM guests WHERE token = $1 AND map_id = $2', [token, mapId]);
  if (!row) return null;
  return { username: row.username, role: row.role as Role };
}
