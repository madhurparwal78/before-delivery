import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import pg from 'pg';
import { WebSocket, WebSocketServer } from 'ws';
import type { LiveMessage, LiveType, Role } from '../shared/api.js';
import { isOrganizerRole } from '../shared/rules.js';
import { config } from './config.js';
import { iso } from './clock.js';
import { pool, type Db } from './db.js';
import { ApiError } from './errors.js';
import { MSG } from './messages.js';
import { entrantForViewer, forViewer, publicEntrant, publicTournament, tournamentForViewer } from './views.js';
import type { EntrantView, MatchView, PublicEntrantView, TournamentView } from '../shared/api.js';

// The live channel: every change is a row in the per-tournament message log; every instance reads the log and
// delivers each row, shaped for each socket's viewer, in seq order.
export interface Outgoing {
  type: LiveType;
  data: unknown;
  organizersOnly?: boolean;
}

interface Stored { seq: number; type: LiveType; at_ms: number; data: Record<string, unknown>; organizers_only: boolean }

export type Viewer = { kind: 'public'; shareCode: string } | { kind: 'user'; role: Role };
const isOrganizer = (v: Viewer): boolean => v.kind === 'user' && isOrganizerRole(v.role);

interface Subscriber { ws: WebSocket; viewer: Viewer; lastSeq: number; sending: Promise<void> }

const subscribers = new Map<string, Set<Subscriber>>();
const NOTIFY_CHANNEL = 'cupfold_live';

// Append messages to the tournament's log inside the caller's transaction; delivery follows the commit.
export async function publish(db: Db, tournamentId: string, at: number, messages: Outgoing[]): Promise<void> {
  for (const message of messages) {
    const { rows } = await db.query<{ live_seq: number }>(
      'UPDATE tournaments SET live_seq = live_seq + 1 WHERE id = $1 RETURNING live_seq', [tournamentId]);
    await db.query(
      `INSERT INTO live_messages (tournament_id, seq, type, at_ms, data, organizers_only) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tournamentId, rows[0]?.live_seq, message.type, at, JSON.stringify(message.data), message.organizersOnly ?? false]);
  }
  if (messages.length) await db.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, tournamentId]);
}

function shape(stored: Stored, viewer: Viewer): LiveMessage | null {
  const organizer = isOrganizer(viewer);
  if (stored.organizers_only && !organizer) return null;
  const base = { seq: stored.seq, at: iso(stored.at_ms) };
  const data = stored.data;
  switch (stored.type) {
    case 'match.updated':
      return { ...base, type: 'match.updated', data: { match: forViewer(data['match'] as MatchView, organizer) } };
    case 'matches.reset':
      return { ...base, type: 'matches.reset', data: { matches: (data['matches'] as MatchView[]).map((m) => forViewer(m, organizer)) } };
    case 'entrants.updated': {
      const entrants = data['entrants'] as EntrantView[];
      const shaped: Array<EntrantView | PublicEntrantView> = viewer.kind === 'public' ? entrants.map(publicEntrant)
        : entrants.map((e) => entrantForViewer(e, organizer));
      return { ...base, type: 'entrants.updated', data: { entrants: shaped } };
    }
    case 'tournament.updated': {
      const view = data['tournament'] as TournamentView;
      return { ...base, type: 'tournament.updated',
        data: { tournament: viewer.kind === 'public' ? publicTournament(view) : tournamentForViewer(view, viewer.role) } };
    }
    case 'standings.updated':
      return { ...base, type: 'standings.updated', data: data as Extract<LiveMessage, { type: 'standings.updated' }>['data'] };
    case 'checkin.updated':
      return { ...base, type: 'checkin.updated', data: data as Extract<LiveMessage, { type: 'checkin.updated' }>['data'] };
    case 'announcement':
      return { ...base, type: 'announcement', data: data as Extract<LiveMessage, { type: 'announcement' }>['data'] };
  }
}

async function flush(tournamentId: string, subscriber: Subscriber): Promise<void> {
  const { rows } = await pool.query<Stored>(
    `SELECT seq, type, at_ms, data, organizers_only FROM live_messages WHERE tournament_id = $1 AND seq > $2 ORDER BY seq`,
    [tournamentId, subscriber.lastSeq]);
  for (const row of rows) {
    if (subscriber.ws.readyState !== WebSocket.OPEN) return;
    subscriber.lastSeq = row.seq;
    const message = shape(row, subscriber.viewer);
    if (message) subscriber.ws.send(JSON.stringify(message));
  }
}

// Deliver every message the open sockets of a tournament have not seen yet.
export async function deliver(tournamentId: string): Promise<void> {
  const group = subscribers.get(tournamentId);
  if (!group) return;
  await Promise.all([...group].map((s) => {
    s.sending = s.sending.then(() => flush(tournamentId, s)).catch(() => undefined);
    return s.sending;
  }));
}

let listener: pg.Client | null = null;

export function startListening(): void {
  const connect = (): void => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    listener = client;
    const retry = (): void => {
      if (listener === client) listener = null;
      client.end().catch(() => undefined);
      setTimeout(connect, 1000);
    };
    client.on('error', retry);
    client.on('end', retry);
    client.on('notification', (n) => { if (n.payload) void deliver(n.payload); });
    client.connect().then(() => client.query(`LISTEN ${NOTIFY_CHANNEL}`)).catch(retry);
  };
  connect();
}

const wss = new WebSocketServer({ noServer: true });

export function reject(socket: Duplex, error: ApiError): void {
  const body = JSON.stringify(error.body());
  socket.write(`HTTP/1.1 ${error.status} ${error.code}\r\nContent-Type: application/json; charset=utf-8\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  socket.destroy();
}

export async function accept(req: IncomingMessage, socket: Duplex, head: Buffer, tournamentId: string,
  viewer: Viewer, after: number | null): Promise<void> {
  const { rows } = await pool.query<{ live_seq: number }>('SELECT live_seq FROM tournaments WHERE id = $1', [tournamentId]);
  if (!rows[0]) return reject(socket, new ApiError('not_found', MSG.tournamentNotFound));
  const lastSeq = after ?? rows[0].live_seq;
  wss.handleUpgrade(req, socket, head, (ws) => {
    const subscriber: Subscriber = { ws, viewer, lastSeq, sending: Promise.resolve() };
    const group = subscribers.get(tournamentId) ?? new Set<Subscriber>();
    group.add(subscriber);
    subscribers.set(tournamentId, group);
    ws.on('close', () => {
      group.delete(subscriber);
      if (!group.size) subscribers.delete(tournamentId);
    });
    ws.on('error', () => ws.terminate());
    void deliver(tournamentId);
  });
}

// A replaced share link kills the old link's open live connections at once.
export function closeShareSockets(tournamentId: string, shareCode: string): void {
  for (const subscriber of subscribers.get(tournamentId) ?? []) {
    if (subscriber.viewer.kind === 'public' && subscriber.viewer.shareCode === shareCode) {
      subscriber.ws.close(4404, 'link_replaced');
    }
  }
}

const HEARTBEAT_MS = 25000;
export function startHeartbeat(): void {
  setInterval(() => {
    for (const group of subscribers.values()) for (const s of group) if (s.ws.readyState === WebSocket.OPEN) s.ws.ping();
  }, HEARTBEAT_MS).unref();
}
