import Redis from 'ioredis';
import type { Bullet, LiveMessage } from '../shared/types.js';
import { config } from './config.js';
import { query } from './db.js';
import type { ChangeRecord } from './changes.js';

export interface LiveSocket {
  ownerId: string;
  /** The branch the tab is showing; null is the owner's whole outline. */
  rootId: string | null;
  shareRootId: string | null;
  depthBase: number;
  email: string;
  lastSeq: number;
  sendMessage(message: LiveMessage): void;
  closeSocket(): void;
}

const sockets = new Map<string, Set<LiveSocket>>();
const readerPositions = new Map<string, string>();

let publisher: Redis | null = null;
let reader: Redis | null = null;
let fanoutHealthy = false;

function streamKey(ownerId: string): string {
  return `twig:outline:${ownerId}:changes`;
}

export function fanoutOk(): boolean {
  return fanoutHealthy;
}

function adjust(bullet: Bullet, socket: LiveSocket): Bullet {
  const depth = bullet.depth - socket.depthBase;
  const parentId = socket.shareRootId === bullet.id ? null : bullet.parentId;
  return { ...bullet, depth: depth < 0 ? 0 : depth, parentId };
}

/** A branch sees a bullet when it can be reached inside it; anything else is a removal. */
function messageFor(socket: LiveSocket, record: ChangeRecord): LiveMessage {
  const inBranch = (id: string): boolean =>
    socket.rootId === null || (record.reach[id] ?? []).includes(socket.rootId);
  const bullets: Bullet[] = [];
  const removed: string[] = [];
  for (const bullet of record.bullets) {
    if (inBranch(bullet.id)) bullets.push(adjust(bullet, socket));
    else removed.push(bullet.id);
  }
  for (const gone of record.removed) {
    if (inBranch(gone)) removed.push(gone);
  }
  return { type: 'change', seq: record.seq, bullets, removed };
}

function deliver(ownerId: string, record: ChangeRecord): void {
  for (const socket of sockets.get(ownerId) ?? []) {
    if (socket.lastSeq >= record.seq) continue;
    socket.lastSeq = record.seq;
    socket.sendMessage(messageFor(socket, record));
  }
}

/** Appends a committed change to the outline's stream and trims it to the newest entries. */
export async function publishChange(ownerId: string, record: ChangeRecord): Promise<void> {
  if (publisher === null) return;
  try {
    await publisher.xadd(
      streamKey(ownerId),
      `${record.seq}-0`,
      'seq',
      String(record.seq),
      'change',
      JSON.stringify(record)
    );
    await publisher.xtrim(streamKey(ownerId), 'MAXLEN', config.streamMaxLen);
    fanoutHealthy = true;
  } catch {
    fanoutHealthy = false;
  }
}

async function newestSeq(ownerId: string): Promise<number> {
  const rows = await query<{ seq: string }>(`select seq from outline_sequence where owner_id = $1`, [
    ownerId
  ]);
  return rows[0] === undefined ? 0 : Number(rows[0].seq);
}

/** Sends a tab every change in its branch after the sequence number it last saw. */
export async function replay(socket: LiveSocket): Promise<void> {
  const newest = await newestSeq(socket.ownerId);
  if (newest - socket.lastSeq > config.streamMaxLen) {
    socket.lastSeq = newest;
    socket.sendMessage({ type: 'reload' });
    return;
  }
  const rows = await query<{ seq: string; payload: ChangeRecord }>(
    `select seq, payload from changes where owner_id = $1 and seq > $2 order by seq`,
    [socket.ownerId, socket.lastSeq]
  );
  for (const row of rows) {
    const record = row.payload;
    socket.lastSeq = Number(row.seq);
    socket.sendMessage(messageFor(socket, record));
  }
}

export function registerSocket(socket: LiveSocket): void {
  const set = sockets.get(socket.ownerId) ?? new Set<LiveSocket>();
  set.add(socket);
  sockets.set(socket.ownerId, set);
  const position = `${socket.lastSeq}-0`;
  const current = readerPositions.get(socket.ownerId);
  if (current === undefined || Number(current.split('-')[0]) > socket.lastSeq) {
    readerPositions.set(socket.ownerId, position);
  }
}

export function unregisterSocket(socket: LiveSocket): void {
  const set = sockets.get(socket.ownerId);
  if (set === undefined) return;
  set.delete(socket);
  if (set.size === 0) {
    sockets.delete(socket.ownerId);
    readerPositions.delete(socket.ownerId);
  }
}

/** Ends every open socket of a collaborator whose share has closed. */
export function revokeSockets(ownerId: string, email: string): void {
  for (const socket of sockets.get(ownerId) ?? []) {
    if (socket.email !== email || socket.shareRootId === null) continue;
    socket.sendMessage({ type: 'revoked' });
    socket.closeSocket();
  }
}

async function readerPass(): Promise<void> {
  if (reader === null) return;
  const owners = [...readerPositions.keys()];
  if (owners.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return;
  }
  const keys = owners.map(streamKey);
  const ids = owners.map((owner) => readerPositions.get(owner) ?? '0-0');
  const response = (await reader.xread(
    'COUNT',
    200,
    'BLOCK',
    400,
    'STREAMS',
    ...keys,
    ...ids
  )) as Array<[string, Array<[string, string[]]>]> | null;
  fanoutHealthy = true;
  if (response === null) return;
  for (const [key, entries] of response) {
    const ownerId = key.slice('twig:outline:'.length, -':changes'.length);
    for (const [entryId, fields] of entries) {
      readerPositions.set(ownerId, entryId);
      const index = fields.indexOf('change');
      const payload = index === -1 ? undefined : fields[index + 1];
      if (payload === undefined) continue;
      deliver(ownerId, JSON.parse(payload) as ChangeRecord);
    }
  }
}

async function readerLoop(): Promise<void> {
  for (;;) {
    try {
      await readerPass();
    } catch {
      fanoutHealthy = false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/** When fan-out comes back, every tab is given the changes it missed. */
async function resumeLoop(): Promise<void> {
  let wasHealthy = fanoutHealthy;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (fanoutHealthy && !wasHealthy) {
      for (const owner of sockets.keys()) {
        readerPositions.set(owner, `${await newestSeq(owner)}-0`);
      }
      for (const set of sockets.values()) {
        for (const socket of set) {
          await replay(socket).catch(() => undefined);
        }
      }
    }
    wasHealthy = fanoutHealthy;
  }
}

async function healthLoop(): Promise<void> {
  for (;;) {
    if (publisher !== null) {
      try {
        await publisher.ping();
        fanoutHealthy = true;
      } catch {
        fanoutHealthy = false;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export function startLive(): void {
  if (config.valkeyUrl === '') return;
  const options = {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (): number => 1000,
    reconnectOnError: (): boolean => true
  };
  publisher = new Redis(config.valkeyUrl, options);
  reader = new Redis(config.valkeyUrl, options);
  for (const client of [publisher, reader]) {
    client.on('error', () => {
      fanoutHealthy = false;
    });
    client.on('end', () => {
      fanoutHealthy = false;
    });
  }
  void readerLoop();
  void resumeLoop();
  void healthLoop();
}
