import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import pg from 'pg';
import { WebSocketServer, type WebSocket } from 'ws';
import { env } from './env.js';
import { pool, query, type Queryable } from './db.js';
import { now, refreshClock } from './clock.js';
import { boardOrder, pinCount } from './domain/pins.js';
import { findBoard, boardVisible } from './domain/visibility.js';
import type { BoardChange, LiveMessage, MemberRole } from '../shared/types.js';

const CHANNEL = 'mothlight';
const INSTANCE = randomUUID();

export type Notice =
  | { k: 'clock' }
  | {
      k: 'board';
      board_id: number;
      seq: number;
      actor: { id: number; name: string };
      change: BoardChange;
      pin: { id: number; title: string } | null;
      section: { id: number; name: string } | null;
    }
  | { k: 'membership'; board_id: number; user_id: number }
  | { k: 'feed'; pin_id: number }
  | { k: 'counts'; pin_id: number }
  | { k: 'follow'; target: 'user' | 'board'; id: number }
  | { k: 'operation_expired'; id: number; actor_id: number }
  | { k: 'viewers'; board_id: number }
  | { k: 'pin_changed'; pin_id: number; version: number };

export async function publish(notice: Notice, db: Queryable | null = null): Promise<void> {
  const payload = JSON.stringify(notice);
  const runner = db ?? pool;
  await runner.query('select pg_notify($1, $2)', [CHANNEL, payload]);
}

interface Connection {
  socket: WebSocket;
  connId: string;
  userId: number;
  boards: Set<number>;
  pins: Set<number>;
  users: Set<number>;
  feed: boolean;
}

const connections = new Set<Connection>();

function send(connection: Connection, message: LiveMessage): void {
  if (connection.socket.readyState === connection.socket.OPEN) {
    connection.socket.send(JSON.stringify(message));
  }
}

function broadcast(message: LiveMessage, keep: (connection: Connection) => boolean): void {
  for (const connection of connections) {
    if (keep(connection)) send(connection, message);
  }
}

async function deliverBoard(notice: Extract<Notice, { k: 'board' }>): Promise<void> {
  const watchers = [...connections].filter((connection) => connection.boards.has(notice.board_id));
  if (watchers.length === 0) return;
  const order = await boardOrder(pool, notice.board_id);
  const count = await pinCount(pool, notice.board_id);
  for (const connection of watchers) {
    const board = await findBoard(pool, notice.board_id, connection.userId);
    if (!board || !boardVisible(board, connection.userId)) continue;
    send(connection, {
      type: 'board',
      board_id: notice.board_id,
      seq: notice.seq,
      actor: notice.actor,
      change: notice.change,
      pin: notice.pin,
      section: notice.section,
      pin_count: count,
      order,
    });
  }
}

async function deliverMembership(notice: Extract<Notice, { k: 'membership' }>): Promise<void> {
  const rows = await query<{ role: MemberRole }>(
    'select role from board_members where board_id = $1 and user_id = $2',
    [notice.board_id, notice.user_id],
  );
  const role = rows[0]?.role ?? null;
  broadcast(
    { type: 'membership', board_id: notice.board_id, role },
    (connection) => connection.userId === notice.user_id,
  );
}

async function deliverFeed(notice: Extract<Notice, { k: 'feed' }>): Promise<void> {
  const watchers = [...connections].filter((connection) => connection.feed);
  if (watchers.length === 0) return;
  const rows = await query<{ uid: number }>(
    `select distinct uid from (
        select fu.follower_id as uid
          from pins p join boards b on b.id = p.board_id
          join follows_users fu on fu.user_id = b.owner_id
         where p.id = $1 and b.visibility = 'public' and b.deleted_at is null
        union
        select fb.follower_id
          from pins p join boards b on b.id = p.board_id
          join follows_boards fb on fb.board_id = b.id
         where p.id = $1 and b.visibility = 'public' and b.deleted_at is null
        union
        select m.user_id
          from pins p join board_members m on m.board_id = p.board_id
         where p.id = $1
        union
        select b.owner_id from pins p join boards b on b.id = p.board_id where p.id = $1
        union
        select p.owner_id from pins p where p.id = $1
      ) eligible`,
    [notice.pin_id],
  );
  const eligible = new Set(rows.map((row) => row.uid));
  for (const connection of watchers) {
    if (eligible.has(connection.userId)) {
      send(connection, { type: 'feed', pin_ids: [notice.pin_id] });
    }
  }
}

async function deliverCounts(notice: Extract<Notice, { k: 'counts' }>): Promise<void> {
  const watchers = [...connections].filter((connection) => connection.pins.has(notice.pin_id));
  if (watchers.length === 0) return;
  const rows = await query<{ saves: number; comments: number; reactions: number }>(
    `select (select count(*)::int from pins sp
               join boards sb on sb.id = sp.board_id
              where sp.root_pin_id = $1 and sp.state = 'live'
                and sb.visibility = 'public' and sb.deleted_at is null) as saves,
            (select count(*)::int from comments c where c.pin_id = $1 and c.deleted = false) as comments,
            (select count(*)::int from reactions r where r.pin_id = $1) as reactions`,
    [notice.pin_id],
  );
  const counts = rows[0];
  if (!counts) return;
  for (const connection of watchers) {
    send(connection, {
      type: 'counts',
      pin_id: notice.pin_id,
      saves: counts.saves,
      comments: counts.comments,
      reactions: counts.reactions,
    });
  }
}

async function deliverFollow(notice: Extract<Notice, { k: 'follow' }>): Promise<void> {
  const rows =
    notice.target === 'user'
      ? await query<{ n: number }>(
          'select count(*)::int as n from follows_users where user_id = $1',
          [notice.id],
        )
      : await query<{ n: number }>(
          'select count(*)::int as n from follows_boards where board_id = $1',
          [notice.id],
        );
  const followers = rows[0]?.n ?? 0;
  const message: LiveMessage = {
    type: 'follow',
    target: notice.target,
    id: notice.id,
    followers,
  };
  broadcast(message, (connection) =>
    notice.target === 'user' ? connection.users.has(notice.id) : connection.boards.has(notice.id),
  );
}

async function deliverViewers(notice: Extract<Notice, { k: 'viewers' }>): Promise<void> {
  const watchers = [...connections].filter((connection) => connection.boards.has(notice.board_id));
  if (watchers.length === 0) return;
  const viewers = await viewerList(notice.board_id);
  for (const connection of watchers) {
    send(connection, { type: 'viewers', board_id: notice.board_id, viewers });
  }
}

export async function viewerList(boardId: number): Promise<{ id: number; name: string }[]> {
  const rows = await query<{ id: number; name: string }>(
    `select u.id, u.name
       from (select user_id, min(started_at) as first_seen
               from board_viewers where board_id = $1 group by user_id) v
       join users u on u.id = v.user_id
      order by v.first_seen, u.id`,
    [boardId],
  );
  return rows;
}

async function handleNotice(notice: Notice): Promise<void> {
  switch (notice.k) {
    case 'clock': {
      await refreshClock();
      broadcast({ type: 'clock', now: now().toISOString() }, () => true);
      return;
    }
    case 'board':
      await deliverBoard(notice);
      return;
    case 'membership':
      await deliverMembership(notice);
      return;
    case 'feed':
      await deliverFeed(notice);
      return;
    case 'counts':
      await deliverCounts(notice);
      return;
    case 'follow':
      await deliverFollow(notice);
      return;
    case 'operation_expired':
      broadcast(
        { type: 'operation_expired', id: notice.id },
        (connection) => connection.userId === notice.actor_id,
      );
      return;
    case 'viewers':
      await deliverViewers(notice);
      return;
    case 'pin_changed':
      broadcast(
        { type: 'pin_changed', pin_id: notice.pin_id, version: notice.version },
        (connection) => connection.pins.has(notice.pin_id),
      );
      return;
  }
}

export async function startBus(): Promise<void> {
  const listener = new pg.Client({ connectionString: env.databaseUrl });
  listener.on('notification', (message) => {
    if (message.channel !== CHANNEL || !message.payload) return;
    const notice = JSON.parse(message.payload) as Notice;
    void handleNotice(notice).catch((error: unknown) => {
      process.stderr.write(`live delivery failed: ${String(error)}\n`);
    });
  });
  listener.on('error', () => {
    setTimeout(() => void startBus(), 1000);
  });
  await listener.connect();
  await listener.query(`listen ${CHANNEL}`);
}

async function addViewer(connection: Connection, boardId: number): Promise<void> {
  await pool.query(
    `insert into board_viewers (conn_id, instance_id, board_id, user_id, started_at)
     values ($1, $2, $3, $4, $5)
     on conflict (conn_id) do update set board_id = excluded.board_id, started_at = excluded.started_at`,
    [`${connection.connId}:${boardId}`, INSTANCE, boardId, connection.userId, now().toISOString()],
  );
  await publish({ k: 'viewers', board_id: boardId });
}

async function removeViewer(connection: Connection, boardId: number): Promise<void> {
  await pool.query('delete from board_viewers where conn_id = $1', [
    `${connection.connId}:${boardId}`,
  ]);
  await publish({ k: 'viewers', board_id: boardId });
}

interface WatchMessage {
  type?: unknown;
  board?: unknown;
  pin?: unknown;
  user?: unknown;
  feed?: unknown;
}

async function onMessage(connection: Connection, raw: string): Promise<void> {
  let parsed: WatchMessage;
  try {
    parsed = JSON.parse(raw) as WatchMessage;
  } catch {
    return;
  }
  const watching = parsed.type === 'watch';
  if (!watching && parsed.type !== 'unwatch') return;
  if (typeof parsed.board === 'number') {
    const boardId = parsed.board;
    if (watching) {
      const board = await findBoard(pool, boardId, connection.userId);
      if (!board || !boardVisible(board, connection.userId)) {
        send(connection, { type: 'not_found', board: boardId });
        return;
      }
      connection.boards.add(boardId);
      await addViewer(connection, boardId);
      const viewers = await viewerList(boardId);
      send(connection, { type: 'viewers', board_id: boardId, viewers });
    } else {
      connection.boards.delete(boardId);
      await removeViewer(connection, boardId);
    }
    return;
  }
  if (typeof parsed.pin === 'number') {
    if (watching) connection.pins.add(parsed.pin);
    else connection.pins.delete(parsed.pin);
    return;
  }
  if (typeof parsed.user === 'number') {
    if (watching) connection.users.add(parsed.user);
    else connection.users.delete(parsed.user);
    return;
  }
  if (parsed.feed === true) {
    connection.feed = watching;
  }
}

export const wss = new WebSocketServer({ noServer: true });

export function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  viewer: { id: number },
): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    const connection: Connection = {
      socket: ws,
      connId: randomUUID(),
      userId: viewer.id,
      boards: new Set(),
      pins: new Set(),
      users: new Set(),
      feed: false,
    };
    connections.add(connection);
    send(connection, { type: 'clock', now: now().toISOString() });
    ws.on('message', (data) => {
      void onMessage(connection, data.toString()).catch(() => undefined);
    });
    ws.on('close', () => {
      connections.delete(connection);
      for (const boardId of connection.boards) {
        void removeViewer(connection, boardId).catch(() => undefined);
      }
    });
  });
}

export async function clearInstanceViewers(): Promise<void> {
  await pool.query('delete from board_viewers where instance_id = $1', [INSTANCE]);
}

export function startClockBroadcast(): void {
  setInterval(() => {
    broadcast({ type: 'clock', now: now().toISOString() }, () => true);
  }, 30000).unref();
}
