import type { ServerResponse } from 'node:http';
import { now } from './clock';
import { pool, rows } from './db';
import { layerInfos } from './infos';
import type { PresenceEntry, SpriteEvent } from '../shared/types';

/** Types of sprite operation that change what a read-only link shows. */
const STAGE_TYPES = new Set(['stroke', 'selection', 'undo', 'redo', 'swatch', 'palette', 'layer', 'frame', 'cel', 'tag', 'restore']);

interface Subscriber {
  res: ServerResponse;
  userId: number | null;
  projectId: number;
  spriteId: number;
  linkId: number | null;
  buffered: SpriteEvent[] | null;
  sent: number;
}

const subscribers = new Set<Subscriber>();
const presence = new Map<number, Map<number, PresenceEntry & { tabs: number }>>();
let joinCounter = 0;

function write(res: ServerResponse, event: string, data: unknown, id?: number): void {
  res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function open(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 500\n\n');
}

const sprites = (spriteId: number): Map<number, PresenceEntry & { tabs: number }> => {
  let list = presence.get(spriteId);
  if (!list) presence.set(spriteId, (list = new Map()));
  return list;
};

export const presenceList = (spriteId: number): PresenceEntry[] =>
  [...sprites(spriteId).values()].sort((a, b) => a.joined - b.joined).map(({ tabs: _tabs, ...entry }) => entry);

export function publishToSprite(spriteId: number, event: string, data: unknown, except?: Subscriber): void {
  for (const subscriber of subscribers) {
    if (subscriber.spriteId !== spriteId || subscriber.linkId !== null || subscriber === except) continue;
    write(subscriber.res, event, data);
  }
}

/** Streams the missed events and then every new one to a member's open workspace. */
export async function joinWorkspace(res: ServerResponse, user: { id: number; name: string }, projectId: number, spriteId: number, since: number): Promise<void> {
  open(res);
  const subscriber: Subscriber = { res, userId: user.id, projectId, spriteId, linkId: null, buffered: [], sent: since };
  subscribers.add(subscriber);
  const list = sprites(spriteId);
  const existing = list.get(user.id);
  if (existing) existing.tabs += 1;
  else {
    const entry = { id: user.id, name: user.name, joined: ++joinCounter, lastActive: now(), cursor: null, tabs: 1 };
    list.set(user.id, entry);
    publishToSprite(spriteId, 'joined', { user: { id: entry.id, name: entry.name, joined: entry.joined, lastActive: entry.lastActive, cursor: null } }, subscriber);
  }
  res.on('close', () => {
    subscribers.delete(subscriber);
    const entry = list.get(user.id);
    if (!entry) return;
    entry.tabs -= 1;
    if (entry.tabs <= 0) {
      list.delete(user.id);
      publishToSprite(spriteId, 'left', { user: { id: user.id, name: user.name } });
    }
  });
  write(res, 'ready', { now: now(), presence: presenceList(spriteId) });
  const missed = await missedEvents(spriteId, since);
  for (const event of missed) {
    write(res, 'op', event, event.seq);
    subscriber.sent = event.seq;
  }
  for (const event of subscriber.buffered ?? []) {
    if (event.seq > subscriber.sent) write(res, 'op', event, event.seq);
    subscriber.sent = Math.max(subscriber.sent, event.seq);
  }
  subscriber.buffered = null;
  write(res, 'layers', { layers: await layerInfos(pool, spriteId) });
}

export function publishOperation(spriteId: number, event: SpriteEvent): void {
  for (const subscriber of subscribers) {
    if (subscriber.spriteId !== spriteId) continue;
    if (subscriber.linkId !== null) {
      if (STAGE_TYPES.has(event.type)) write(subscriber.res, 'stage', { seq: event.seq, type: event.type });
      continue;
    }
    if (subscriber.buffered) subscriber.buffered.push(event);
    else {
      write(subscriber.res, 'op', event, event.seq);
      subscriber.sent = event.seq;
    }
  }
}

export function joinViewer(res: ServerResponse, spriteId: number, linkId: number): void {
  open(res);
  const subscriber: Subscriber = { res, userId: null, projectId: 0, spriteId, linkId, buffered: null, sent: 0 };
  subscribers.add(subscriber);
  res.on('close', () => subscribers.delete(subscriber));
  write(res, 'ready', {});
}

/** A link ended (by date, revocation or replacement): its open viewers move to the ended page. */
export function endViewers(linkId: number): void {
  for (const subscriber of [...subscribers]) {
    if (subscriber.linkId !== linkId) continue;
    write(subscriber.res, 'ended', {});
    subscriber.res.end();
    subscribers.delete(subscriber);
  }
}

export function recordCursor(spriteId: number, userId: number, cursor: { x: number; y: number; frame: number }): void {
  const entry = sprites(spriteId).get(userId);
  if (!entry) return;
  entry.cursor = cursor;
  entry.lastActive = now();
  publishToSprite(spriteId, 'cursor', { id: userId, name: entry.name, ...cursor, lastActive: entry.lastActive });
}

export function touch(spriteId: number, userId: number): void {
  const entry = sprites(spriteId).get(userId);
  if (entry) entry.lastActive = now();
}

export const cursorOf = (spriteId: number, userId: number): { x: number; y: number } => {
  const cursor = sprites(spriteId).get(userId)?.cursor;
  return { x: cursor?.x ?? 0, y: cursor?.y ?? 0 };
};

export function broadcastClock(): void {
  for (const subscriber of subscribers) if (subscriber.linkId === null) write(subscriber.res, 'clock', { now: now() });
}

/** Tells every open session of a person in a project that their role changed, or that they are out. */
export function notifyMember(userId: number, projectId: number, message: { role: string } | { removed: true }): void {
  for (const subscriber of [...subscribers]) {
    if (subscriber.userId !== userId || subscriber.projectId !== projectId) continue;
    write(subscriber.res, 'access', message);
    if ('removed' in message) {
      subscriber.res.end();
      subscribers.delete(subscriber);
    }
  }
}

/** Stored events after `since`, as the events route and the live channel return them. */
export async function missedEvents(spriteId: number, since: number): Promise<SpriteEvent[]> {
  const found = await rows<{ seq: number; type: string; name: string | null; at: number; data: SpriteEvent['data'] }>(
    pool,
    `SELECT e.seq, e.type, u.name, e.at, e.data FROM events e LEFT JOIN users u ON u.id = e.by_user
     WHERE e.sprite_id = $1 AND e.seq > $2 ORDER BY e.seq`,
    [spriteId, since],
  );
  return found.map((e) => ({ seq: e.seq, type: e.type, by: e.name ?? '', at: new Date(e.at).toISOString(), data: e.data }));
}

