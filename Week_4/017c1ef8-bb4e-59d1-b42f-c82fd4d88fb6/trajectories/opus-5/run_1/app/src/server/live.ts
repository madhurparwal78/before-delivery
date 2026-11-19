import type { ServerResponse } from 'node:http';
import { businessNowIso } from './clock';
import { config } from './config';

type Client = {
  id: string;
  memberId: string;
  res: ServerResponse;
};

const clients = new Map<string, Client>();

/** Job editor presence and typing are page state, held for the open pages only. */
type Presence = { memberId: string; name: string; openedAt: number; lastSeen: number };
const jobEditors = new Map<string, Map<string, Presence>>();

export function addClient(id: string, memberId: string, res: ServerResponse): void {
  clients.set(id, { id, memberId, res });
}

export function removeClient(id: string): void {
  const client = clients.get(id);
  if (!client) return;
  clients.delete(id);
  const stillOnline = [...clients.values()].some((other) => other.memberId === client.memberId);
  if (stillOnline) return;
  for (const [jobId, editors] of [...jobEditors]) {
    if (!editors.delete(client.memberId)) continue;
    if (editors.size === 0) jobEditors.delete(jobId);
    pushJobPresence(jobId);
  }
}

function write(client: Client, event: string, data: unknown): void {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client.id);
  }
}

export function pushTo(memberIds: Iterable<string>, event: string, data: unknown): void {
  const targets = new Set(memberIds);
  for (const client of clients.values()) {
    if (targets.has(client.memberId)) write(client, event, data);
  }
}

export function pushToAll(event: string, data: unknown): void {
  for (const client of clients.values()) write(client, event, data);
}

/** Returns true when this member has only now joined the job's editors. */
export function markJobEditor(jobId: string, memberId: string, name: string): boolean {
  let editors = jobEditors.get(jobId);
  if (!editors) {
    editors = new Map();
    jobEditors.set(jobId, editors);
  }
  const now = Date.now();
  const existing = editors.get(memberId);
  if (existing && existing.lastSeen >= now - 5000) {
    existing.lastSeen = now;
    return false;
  }
  editors.set(memberId, { memberId, name, openedAt: now, lastSeen: now });
  return true;
}

export function jobEditorList(jobId: string): { id: string; name: string }[] {
  const editors = jobEditors.get(jobId);
  if (!editors) return [];
  const cutoff = Date.now() - 5000;
  const live = [...editors.values()].filter((entry) => entry.lastSeen >= cutoff);
  live.sort((a, b) => a.openedAt - b.openedAt);
  return live.map((entry) => ({ id: entry.memberId, name: entry.name }));
}

export function pushJobPresence(jobId: string): void {
  pushToAll('job_presence', { job_id: jobId, editing: jobEditorList(jobId) });
}

function sweepJobEditors(): void {
  const cutoff = Date.now() - 5000;
  for (const [jobId, editors] of [...jobEditors]) {
    let changed = false;
    for (const [memberId, entry] of [...editors]) {
      if (entry.lastSeen < cutoff) {
        editors.delete(memberId);
        changed = true;
      }
    }
    if (editors.size === 0) jobEditors.delete(jobId);
    if (changed) pushJobPresence(jobId);
  }
}

export function startHeartbeat(): void {
  setInterval(() => {
    pushToAll('tick', { now: businessNowIso() });
    sweepJobEditors();
  }, 1000).unref();
}

export function clockMoved(): void {
  pushToAll('clock', { now: businessNowIso(), time_zone: config.timeZone });
}
