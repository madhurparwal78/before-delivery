import type { ServerResponse } from 'node:http';
import type { ForensicsLine, Role, RuleBody, Topic } from '../shared/types.js';
import { pool } from './db.js';
import { canSee, loadRules } from './permissions.js';

type ThreadReason = 'message' | 'event' | 'refused' | 'status' | 'attachment' | 'link';

export type HubEvent =
  | { kind: 'thread'; gameId: string; threadId: string; topic: Topic; reason: ThreadReason; purchaseData: boolean }
  | { kind: 'rules'; gameId: string; moderatorId: string };

interface Connection {
  res: ServerResponse;
  userId: string;
  role: Role;
  gameId: string;
  familyId: string;
}

const SWEEP_MS = 1000;
const HEARTBEAT_MS = 20_000;

const connections = new Set<Connection>();
let queue: Promise<void> = Promise.resolve();
let sweeper: NodeJS.Timeout | null = null;
let heartbeat: NodeJS.Timeout | null = null;

function write(connection: Connection, name: string, data: unknown): void {
  connection.res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function endConnection(connection: Connection): void {
  connections.delete(connection);
  connection.res.end();
  if (connections.size === 0) stopTimers();
}

async function sweepFamilies(): Promise<void> {
  const families = [...new Set([...connections].map((c) => c.familyId))];
  if (families.length === 0) return;
  const { rows } = await pool.query<{ id: string }>(
    'select id from refresh_families where id = any($1) and (revoked or expires_at <= now())',
    [families],
  );
  const gone = new Set(rows.map((row) => row.id));
  for (const connection of [...connections]) if (gone.has(connection.familyId)) endConnection(connection);
}

function startTimers(): void {
  sweeper ??= setInterval(() => void sweepFamilies().catch(() => undefined), SWEEP_MS);
  heartbeat ??= setInterval(() => {
    for (const connection of connections) connection.res.write(': ping\n\n');
  }, HEARTBEAT_MS);
}

function stopTimers(): void {
  if (sweeper) clearInterval(sweeper);
  if (heartbeat) clearInterval(heartbeat);
  sweeper = null;
  heartbeat = null;
}

export function addStaffStream(res: ServerResponse, staff: { id: string; role: Role; gameId: string; familyId: string }): void {
  const connection: Connection = { res, userId: staff.id, role: staff.role, gameId: staff.gameId, familyId: staff.familyId };
  connections.add(connection);
  startTimers();
  res.on('close', () => {
    if (connections.delete(connection) && connections.size === 0) stopTimers();
  });
}

async function deliver(event: HubEvent): Promise<void> {
  const audience = [...connections].filter((connection) => connection.gameId === event.gameId);
  if (audience.length === 0) return;
  if (event.kind === 'rules') {
    for (const connection of audience) if (connection.userId === event.moderatorId) write(connection, 'rules', {});
    return;
  }
  const moderators = [...new Set(audience.filter((c) => c.role === 'moderator').map((c) => c.userId))];
  const rules = await loadRules(pool, moderators);
  const frame = { thread_id: event.threadId, reason: event.reason };
  for (const connection of audience) {
    const viewer = { role: connection.role, rules: rules.get(connection.userId) as RuleBody[] };
    if (canSee(viewer, event.topic, event.purchaseData)) write(connection, 'thread', frame);
  }
}

export function publish(event: HubEvent): void {
  queue = queue.then(() => deliver(event)).catch(() => undefined);
}

type LinkWatcher = (line: ForensicsLine) => void;

const linkWatchers = new Map<string, Set<LinkWatcher>>();

export function watchLink(messageId: string, watcher: LinkWatcher): () => void {
  const watchers = linkWatchers.get(messageId) ?? new Set<LinkWatcher>();
  watchers.add(watcher);
  linkWatchers.set(messageId, watchers);
  return () => {
    watchers.delete(watcher);
    if (watchers.size === 0) linkWatchers.delete(messageId);
  };
}

export function publishLink(messageId: string, line: ForensicsLine): void {
  for (const watcher of linkWatchers.get(messageId) ?? []) watcher(line);
}
