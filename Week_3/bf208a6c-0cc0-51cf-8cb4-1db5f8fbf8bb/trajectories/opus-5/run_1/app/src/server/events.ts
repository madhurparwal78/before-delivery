import type { ServerResponse } from 'node:http';
import type { AccessLostEvent, BoardEvent, Role, ServiceStatus } from '../shared/types';
import { boardAccess, linkAccess, type Caller } from './boards';
import { type Db, pool } from './db';
import { ApiError } from './errors';

type Visibility = 'all' | 'held' | 'user';

interface EventRow {
  id: string;
  data: BoardEvent;
  visibility: Visibility;
  subject_id: string | null;
}

export interface StoredEvent {
  id: number;
  data: BoardEvent;
  visibility: Visibility;
  subject_id: string | null;
}

export const recordEvent = async (
  db: Db,
  boardId: string,
  event: BoardEvent,
  visibility: Visibility = 'all',
  subjectId: string | null = null,
): Promise<void> => {
  await db.query('insert into events (board_id, data, visibility, subject_id) values ($1, $2, $3, $4)', [
    boardId,
    JSON.stringify(event),
    visibility,
    subjectId,
  ]);
};

export interface Subscriber {
  boardId: string;
  caller: Caller;
  source: { kind: 'board' } | { kind: 'link'; token: string };
  res: ServerResponse;
  lastSent: number;
}

const subscribers = new Set<Subscriber>();

const write = (subscriber: Subscriber, chunk: string): void => {
  subscriber.res.write(chunk);
};

const sendEvent = (subscriber: Subscriber, id: number, event: BoardEvent): void => {
  write(subscriber, `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
};

const sendAccessLost = (subscriber: Subscriber, reason: AccessLostEvent['reason']): void => {
  write(subscriber, `event: access_lost\ndata: ${JSON.stringify({ reason })}\n\n`);
  subscribers.delete(subscriber);
  subscriber.res.end();
};

const isVisible = (row: StoredEvent, role: Role | null, userId: string | null): boolean => {
  if (row.visibility === 'all') return true;
  if (row.visibility === 'user') return userId !== null && userId === row.subject_id;
  return role === 'moderator' || role === 'owner' || (userId !== null && userId === row.subject_id);
};

export const readEventsSince = async (db: Db, boardId: string, sinceId: number): Promise<StoredEvent[]> => {
  const result = await db.query<EventRow>(
    'select id, data, visibility, subject_id from events where board_id = $1 and id > $2 order by id',
    [boardId, sinceId],
  );
  return result.rows.map((row) => ({ ...row, id: Number(row.id) }));
};

export const latestEventId = async (db: Db, boardId: string): Promise<number> => {
  const result = await db.query<{ id: string | null }>('select max(id) as id from events where board_id = $1', [boardId]);
  const id = result.rows[0]?.id;
  return id === null || id === undefined ? 0 : Number(id);
};

export const filterVisible = (
  rows: StoredEvent[],
  role: Role | null,
  userId: string | null,
): Array<{ id: number; data: BoardEvent }> =>
  rows.filter((row) => isVisible(row, role, userId)).map((row) => ({ id: row.id, data: row.data }));

const resolveAccess = async (subscriber: Subscriber): Promise<Role | null> => {
  if (subscriber.source.kind === 'board') {
    const access = await boardAccess(pool, subscriber.caller, subscriber.boardId);
    return access.role;
  }
  const access = await linkAccess(pool, subscriber.caller, subscriber.source.token, 'share');
  return access.role;
};

export const addSubscriber = (subscriber: Subscriber): void => {
  subscribers.add(subscriber);
  subscriber.res.on('close', () => {
    subscribers.delete(subscriber);
  });
};

/** Pushes every committed event of a board to the screens allowed to see it. */
export const flushBoard = async (boardId: string): Promise<void> => {
  const audience = [...subscribers].filter((subscriber) => subscriber.boardId === boardId);
  if (audience.length === 0) return;
  const earliest = Math.min(...audience.map((subscriber) => subscriber.lastSent));
  const rows = await readEventsSince(pool, boardId, earliest);
  for (const subscriber of audience) {
    let role: Role | null;
    try {
      role = await resolveAccess(subscriber);
    } catch (error) {
      const reason = error instanceof ApiError && error.status === 403 ? 'password_required' : 'not_found';
      sendAccessLost(subscriber, reason);
      continue;
    }
    for (const event of filterVisible(rows, role, subscriber.caller.userId)) {
      if (event.id > subscriber.lastSent) sendEvent(subscriber, event.id, event.data);
    }
    const highest = rows.length > 0 ? rows[rows.length - 1].id : subscriber.lastSent;
    subscriber.lastSent = Math.max(subscriber.lastSent, highest);
  }
};

export const broadcastServices = (services: ServiceStatus): void => {
  for (const subscriber of subscribers) {
    write(subscriber, `data: ${JSON.stringify({ kind: 'services', services } satisfies BoardEvent)}\n\n`);
  }
};

export const keepAlive = (): void => {
  for (const subscriber of subscribers) write(subscriber, ': keep-alive\n\n');
};
