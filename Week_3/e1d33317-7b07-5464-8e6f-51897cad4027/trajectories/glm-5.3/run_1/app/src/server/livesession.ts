import crypto from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import http from 'node:http';
import { repo, db, hubFor, hubs, AWARENESS_TTL_SECONDS } from './routes.js';
import { ScoreHub, LiveConnection } from './hub.js';
import { VALKEY } from './services/valkey.js';
import { SOCKET_PING_SECONDS, HEARTBEAT_SECONDS } from '../domain/values.js';

export interface PresenceSweeper {
  start(): void;
  stop(): void;
}

/**
 * Live sessions: one WebSocket per open tab, with presence, heartbeats and the
 * server's ping/pong drop detection. Every socket's resources are released
 * when it closes, including its holds and presence entry.
 */
export function attachWebSockets(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const m = /^\/api\/scores\/([^/]+)\/live$/.exec(url.pathname);
      const token = url.searchParams.get('token');
      if (!m || !token) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      const origin = req.headers.origin;
      const host = req.headers.host;
      if (origin && host) {
        try {
          if (new URL(origin).host !== host) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }
        } catch {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      }
      const collab = await repo.collaboratorBySeat(token);
      if (!collab || collab.status !== 'active') {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const scoreId = decodeURIComponent(m[1]);
      if (!(await repo.scoreExists(scoreId))) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      const hub = await hubFor(scoreId);
      wss.handleUpgrade(req, socket as never, head, (ws) => {
        void openSession(hub, ws, collab.id, collab.name, collab.role);
      });
    })();
  });
}

async function openSession(hub: ScoreHub, ws: WebSocket, collaboratorId: string, name: string, role: string): Promise<void> {
  const id = `conn-${crypto.randomBytes(6).toString('hex')}`;
  const lastPongRef = { at: Date.now() };
  const conn: LiveConnection = {
    id,
    scoreId: hub.scoreId,
    collaboratorId,
    alive: true,
    lastPong: Date.now(),
    send: (message) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    },
    close: () => {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
    ping: () => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    },
  };
  hub.register(conn);
  const collaborators = await repo.collaborators(hub.scoreId);
  const self = collaborators.find((c) => c.id === collaboratorId);
  hub.presence.set(collaboratorId, {
    collaboratorId,
    name: self?.name ?? name,
    role: self?.role ?? role,
    cursor: null,
    lastHeartbeat: Date.now(),
  });
  conn.send({ type: 'welcome', connectionId: id, lamport: hub.model!.lamport, lastSeq: hub.lastSeq, live: VALKEY.isConnected });
  await hub.broadcast({ type: 'presence', entries: hub.presenceSnapshot() });

  ws.on('pong', () => {
    conn.alive = true;
    conn.lastPong = Date.now();
    lastPongRef.at = Date.now();
  });
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString('utf8')) as { type: string; cursor?: unknown; seen?: unknown };
      if (message.type === 'heartbeat') {
        const cursor = message.cursor as { staffId: string; measure: number; beat: number } | null | undefined;
        const entry = hub.presence.get(collaboratorId);
        if (entry) {
          entry.cursor = cursor ?? null;
          entry.lastHeartbeat = Date.now();
        } else {
          hub.presence.set(collaboratorId, {
            collaboratorId,
            name: self?.name ?? name,
            role: self?.role ?? role,
            cursor: cursor ?? null,
            lastHeartbeat: Date.now(),
          });
        }
        if (typeof message.seen === 'number' && message.seen >= 0) {
          void db.query(
            `INSERT INTO acks (score_id, collaborator_id, seen) VALUES ($1,$2,$3)
             ON CONFLICT (score_id, collaborator_id) DO UPDATE SET seen = GREATEST(acks.seen, EXCLUDED.seen)`,
            [hub.scoreId, collaboratorId, Math.floor(message.seen)],
          );
        }
      }
    } catch {
      // malformed messages are ignored
    }
  });
  ws.on('close', () => {
    hub.unregister(conn);
    void broadcastPresence(hub);
  });
  ws.on('error', () => {
    hub.unregister(conn);
  });
}

async function broadcastPresence(hub: ScoreHub): Promise<void> {
  await hub.broadcast({ type: 'presence', entries: hub.presenceSnapshot() });
}

/** Expires presence entries whose heartbeats are older than the window. */
export const presenceSweeper: PresenceSweeper & { timer: NodeJS.Timeout | null } = {
  timer: null,
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void sweepPresence();
    }, 1000);
  },
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  },
};

async function sweepPresence(): Promise<void> {
  const now = Date.now();
  const ttlMs = AWARENESS_TTL_SECONDS * 1000;
  for (const hub of hubs.values()) {
    let changed = false;
    for (const [id, entry] of hub.presence) {
      if (now - entry.lastHeartbeat > ttlMs) {
        hub.presence.delete(id);
        changed = true;
      }
    }
    if (changed) {
      await hub.broadcast({ type: 'presence', entries: hub.presenceSnapshot() });
    }
    // drop sockets that missed the pong window
    for (const conn of hub.connections) {
      if (now - conn.lastPong > SOCKET_PING_SECONDS * 1000 + 2000) {
        conn.close();
      }
    }
  }
}

/** Sends the server ping on the published interval. */
export function startPingLoop(): NodeJS.Timeout {
  return setInterval(() => {
    for (const hub of hubs.values()) {
      for (const conn of hub.connections) {
        if (!conn.alive) {
          conn.close();
          hub.unregister(conn);
          continue;
        }
        conn.alive = false;
        conn.ping();
      }
    }
  }, SOCKET_PING_SECONDS * 1000);
}

export { HEARTBEAT_SECONDS };
