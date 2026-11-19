import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { currentOutages } from './services.js';

interface Client {
  userId: string;
  teamIds: Set<string>;
  ws: WebSocket;
  alive: boolean;
}

const clients = new Set<Client>();

export function attachLive(server: import('node:http').Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (pathname !== '/api/live') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    authenticateUpgrade(req)
      .then((auth) => {
        if (!auth) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        if (currentOutages().live) {
          socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          const client: Client = { userId: auth.userId, teamIds: auth.teamIds, ws, alive: true };
          clients.add(client);
          ws.on('pong', () => { client.alive = true; });
          ws.on('close', () => clients.delete(client));
          ws.on('error', () => clients.delete(client));
          ws.send(JSON.stringify({ type: 'hello' }));
        });
      })
      .catch(() => {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
      });
  });

  const timer = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { c.ws.terminate(); clients.delete(c); continue; }
      c.alive = false;
      c.ws.ping();
    }
  }, 30000);
  timer.unref();

  // While the live outage is on, close every open socket (Business rules).
  let lastLive = currentOutages().live;
  setInterval(() => {
    const nowLive = currentOutages().live;
    if (nowLive && !lastLive) {
      for (const c of clients) c.ws.close(1011, 'live channel down');
    }
    lastLive = nowLive;
  }, 500).unref();
}

async function authenticateUpgrade(req: IncomingMessage): Promise<{ userId: string; teamIds: Set<string> } | null> {
  const { pool } = await import('./db.js');
  const { userFromSession } = await import('./auth.js');
  const cookieHeader = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)wb_session=([^;]+)/.exec(cookieHeader);
  if (!match) return null;
  const user = await userFromSession(decodeURIComponent(match[1]));
  if (!user) return null;
  const teams = await pool.query<{ team_id: string }>('SELECT team_id FROM team_members WHERE user_id = $1', [user.id]);
  return { userId: user.id, teamIds: new Set(teams.rows.map((r) => r.team_id)) };
}

export interface SaveEvent {
  recipeId: string;
  teamId: string | null;
  ownerUserId: string | null;
  version: number;
  name: string;
  authorId: string;
  authorName: string;
}

/** Pushes version_saved to every socket of every person who can see the recipe (DP-41). */
export function broadcast(event: SaveEvent): void {
  const msg = JSON.stringify({
    type: 'version_saved',
    recipeId: event.recipeId,
    version: event.version,
    name: event.name,
    authorId: event.authorId,
    authorName: event.authorName,
    teamId: event.teamId,
  });
  for (const c of clients) {
    if (c.ws.readyState !== WebSocket.OPEN) continue;
    if (visibleTo(c, event)) c.ws.send(msg);
  }
}

function visibleTo(client: Client, event: SaveEvent): boolean {
  if (event.teamId) return client.teamIds.has(event.teamId);
  return event.ownerUserId === client.userId;
}

export function broadcastMembership(teamId: string): void {
  const msg = JSON.stringify({ type: 'membership_changed', teamId });
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN && c.teamIds.has(teamId)) c.ws.send(msg);
  }
}
