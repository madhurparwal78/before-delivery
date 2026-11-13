import type { WebSocket } from 'ws';
import { nowMs } from './clock';
import { Sql, withTx } from './db';

export type LiveType =
  | 'merge_request'
  | 'thread'
  | 'review'
  | 'approvals'
  | 'checks'
  | 'version'
  | 'pipeline'
  | 'job'
  | 'job_log'
  | 'train'
  | 'board'
  | 'issue'
  | 'epic'
  | 'milestone'
  | 'wiki'
  | 'environment'
  | 'deployment'
  | 'role'
  | 'presence'
  | 'export'
  | 'import'
  | 'instance';

export type LiveMessage = {
  seq: number;
  type: LiveType;
  data: Record<string, unknown>;
  projectId: number;
};

export type Tx = {
  sql: Sql;
  messages: LiveMessage[];
  lastSeq: Map<number, number>;
  quiet: boolean;
};

type Subscriber = { socket: WebSocket; projectId: number; username: string };

const subscribers = new Set<Subscriber>();

export function addSubscriber(socket: WebSocket, projectId: number, username: string): Subscriber {
  const subscriber: Subscriber = { socket, projectId, username };
  subscribers.add(subscriber);
  return subscriber;
}

export function removeSubscriber(subscriber: Subscriber): void {
  subscribers.delete(subscriber);
}

type Leave = { projectId: number; username: string; atMs: number };

const leaves: Leave[] = [];

export function markLeave(projectId: number, username: string): void {
  leaves.push({ projectId, username, atMs: nowMs() });
}

export function dueLeaves(timeoutMs: number): Leave[] {
  const due = leaves.filter((leave) => leave.atMs + timeoutMs <= nowMs());
  for (const leave of due) leaves.splice(leaves.indexOf(leave), 1);
  return due;
}

export function viewersOf(projectId: number): string[] {
  const names = new Set<string>();
  for (const subscriber of subscribers) {
    if (subscriber.projectId === projectId) names.add(subscriber.username);
  }
  return [...names].sort();
}

export function broadcast(messages: LiveMessage[]): void {
  for (const message of messages) {
    const payload = JSON.stringify({ seq: message.seq, type: message.type, data: message.data });
    for (const subscriber of subscribers) {
      if (subscriber.projectId !== message.projectId) continue;
      if (subscriber.socket.readyState !== 1) continue;
      subscriber.socket.send(payload);
    }
  }
}

export async function emit(
  t: Tx,
  projectId: number,
  type: LiveType,
  data: Record<string, unknown>,
): Promise<number> {
  if (t.quiet) return currentSeq(t.sql, projectId);
  const row = await t.sql.one<{ seq: string }>(
    'update projects set seq = seq + 1 where id = $1 returning seq',
    [projectId],
  );
  const seq = Number(row?.seq ?? 0);
  await t.sql.query(
    'insert into live_messages (project_id, seq, type, data, at_ms) values ($1, $2, $3, $4, $5)',
    [projectId, seq, type, JSON.stringify(data), nowMs()],
  );
  t.messages.push({ seq, type, data, projectId });
  t.lastSeq.set(projectId, seq);
  return seq;
}

export async function currentSeq(sql: Sql, projectId: number): Promise<number> {
  const row = await sql.one<{ seq: string }>('select seq from projects where id = $1', [projectId]);
  return Number(row?.seq ?? 0);
}

export async function seqOf(t: Tx, projectId: number): Promise<number> {
  const known = t.lastSeq.get(projectId);
  if (known !== undefined) return known;
  return currentSeq(t.sql, projectId);
}

export async function tx<T>(run: (t: Tx) => Promise<T>): Promise<T> {
  const messages: LiveMessage[] = [];
  const lastSeq = new Map<number, number>();
  const value = await withTx(async (sql) => run({ sql, messages, lastSeq, quiet: false }));
  broadcast(messages);
  return value;
}

export async function quietTx<T>(run: (t: Tx) => Promise<T>): Promise<T> {
  return withTx(async (sql) => run({ sql, messages: [], lastSeq: new Map(), quiet: true }));
}
