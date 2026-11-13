/**
 * One WebSocket per page. Subscribing replays the changes after the page's last
 * version, so nothing is applied twice and nothing is missed.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { query } from './db.js';
import { originIsOwn, readCookies, SESSION_COOKIE } from './http.js';
import { personBySession } from './repo/people.js';
import { loadRole } from './repo/projects.js';
import { pool } from './db.js';
import type { AllowanceRecord, CommentRecord, CutRecord, ExportRecord, LoggedOp, ProjectRecord, Role, ServerMessage } from '../shared/types.js';

interface Live {
  socket: WebSocket;
  session_id: string | null;
  person_id: string | null;
  person_name: string;
  project_id: string | null;
  review_token: string | null;
  review_link_id: string | null;
}

const sockets = new Set<Live>();
const server = new WebSocketServer({ noServer: true });

function send(live: Live, message: ServerMessage): void {
  if (live.socket.readyState === live.socket.OPEN) live.socket.send(JSON.stringify(message));
}


export async function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/api/live' || !originIsOwn(request)) {
    socket.destroy();
    return;
  }
  const reviewToken = url.searchParams.get('review');
  const sessionId = readCookies(request)[SESSION_COOKIE] ?? null;
  let live: Live | null = null;
  if (reviewToken !== null) {
    const link = await query<{ id: string }>(
      `select id from review_links where token = $1 and revoked_at is null and expires_at > now()`,
      [reviewToken],
    );
    if (link.length === 0) {
      socket.destroy();
      return;
    }
    live = {
      socket: null as unknown as WebSocket,
      session_id: null,
      person_id: null,
      person_name: 'Reviewer',
      project_id: null,
      review_token: reviewToken,
      review_link_id: link[0].id,
    };
  } else if (sessionId !== null) {
    const person = await personBySession(sessionId);
    if (person === null) {
      socket.destroy();
      return;
    }
    live = {
      socket: null as unknown as WebSocket,
      session_id: sessionId,
      person_id: person.id,
      person_name: person.name,
      project_id: null,
      review_token: null,
      review_link_id: null,
    };
  }
  if (live === null) {
    socket.destroy();
    return;
  }
  const opened = live;
  server.handleUpgrade(request, socket, head, (websocket) => {
    opened.socket = websocket;
    sockets.add(opened);
    websocket.on('close', () => sockets.delete(opened));
    websocket.on('message', (data) => {
      void onMessage(opened, data.toString());
    });
  });
}

async function onMessage(live: Live, raw: string): Promise<void> {
  let message: { type?: string; project_id?: string; after_version?: number; frame?: number };
  try {
    message = JSON.parse(raw) as typeof message;
  } catch {
    return;
  }
  if (message.type === 'subscribe' && typeof message.project_id === 'string' && live.person_id !== null) {
    const role = await loadRole(pool, message.project_id, live.person_id);
    if (role === null) {
      live.socket.close(4403, 'no access');
      return;
    }
    live.project_id = message.project_id;
    const after = typeof message.after_version === 'number' ? message.after_version : 0;
    const replay = await query<{ version: number; author_id: string; name: string; op: LoggedOp['op']; changes: LoggedOp['changes']; removed: string[] }>(
      `select o.version, o.author_id, p.name, o.op, o.changes, o.removed from ops o join people p on p.id = o.author_id
       where o.project_id = $1 and o.version > $2 order by o.version`,
      [message.project_id, after],
    );
    for (const op of replay) {
      send(live, {
        type: 'op',
        version: op.version,
        author: { id: op.author_id, name: op.name },
        op: op.op,
        changes: op.changes,
        removed: op.removed,
      });
    }
    return;
  }
  if (message.type === 'subscribe_review' && live.review_link_id !== null) {
    const link = await query<{ project_id: string }>(`select project_id from review_links where id = $1`, [
      live.review_link_id,
    ]);
    if (link.length > 0) live.project_id = link[0].project_id;
    return;
  }
  if (message.type === 'playhead' && typeof message.frame === 'number' && live.project_id !== null && live.person_id !== null) {
    for (const other of sockets) {
      if (other !== live && other.project_id === live.project_id && other.person_id !== null) {
        send(other, { type: 'playhead', person: live.person_name, frame: message.frame });
      }
    }
  }
}

export function broadcastOp(
  projectId: string,
  payload: { version: number; author: { id: string; name: string }; op: Record<string, unknown> & { type: string }; changes: LoggedOp['changes']; removed: string[]; project?: ProjectRecord },
): void {
  for (const live of sockets) {
    if (live.project_id !== projectId || live.person_id === null) continue;
    send(live, { type: 'op', ...payload });
  }
}

export function broadcastComment(projectId: string, comment: CommentRecord): void {
  for (const live of sockets) {
    if (live.project_id !== projectId) continue;
    if (live.person_id === null && comment.visibility !== 'review') continue;
    send(live, { type: 'comment', comment });
  }
}

export function broadcastExport(projectId: string, record: ExportRecord): void {
  for (const live of sockets) {
    if (live.project_id === projectId && live.person_id !== null) send(live, { type: 'export', export: record });
  }
}

export function broadcastAllowance(record: AllowanceRecord): void {
  for (const live of sockets) {
    if (live.person_id !== null) send(live, { type: 'allowance', allowance: record });
  }
}

export function broadcastCutShared(projectId: string, cut: CutRecord, linkId: string | null): void {
  for (const live of sockets) {
    if (live.project_id === projectId && live.person_id !== null) send(live, { type: 'cut_shared', cut });
    if (linkId !== null && live.review_link_id === linkId) send(live, { type: 'cut_shared', cut });
  }
}

/** A role change reaches the open screen, then its socket closes with 4403. */
export function closeForRoleChange(projectId: string, personId: string, role: Role | null): void {
  for (const live of [...sockets]) {
    if (live.project_id === projectId && live.person_id === personId) {
      send(live, { type: 'role_changed', role });
      live.socket.close(4403, 'role changed');
      sockets.delete(live);
    }
  }
}

export function closeSession(sessionId: string): void {
  for (const live of [...sockets]) {
    if (live.session_id === sessionId) {
      live.socket.close(4401, 'signed out');
      sockets.delete(live);
    }
  }
}

export function closeReviewLink(linkId: string): void {
  for (const live of [...sockets]) {
    if (live.review_link_id === linkId) {
      live.socket.close(4410, 'link ended');
      sockets.delete(live);
    }
  }
}

export async function closeExpiredReviewSockets(): Promise<void> {
  const live = [...sockets].filter((candidate) => candidate.review_link_id !== null);
  if (live.length === 0) return;
  const ids = [...new Set(live.map((candidate) => candidate.review_link_id as string))];
  const ended = await query<{ id: string }>(
    `select id from review_links where id = any($1::text[]) and (revoked_at is not null or expires_at <= now())`,
    [ids],
  );
  for (const link of ended) closeReviewLink(link.id);
}
