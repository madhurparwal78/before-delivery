// The live channel and presence. One Server-Sent Events stream per open project.

import type { ServerResponse } from 'node:http';

export interface LiveMessage {
  kind: 'project' | 'presence' | 'comment' | 'export';
  payload: unknown;
}

export class LiveHub {
  private readonly listeners = new Map<string, Set<ServerResponse>>();
  private readonly selected = new Map<string, Map<string, string | null>>(); // projectId -> userId -> itemId
  private readonly seen = new Map<string, Date>(); // `${projectId}:${userId}` -> last seen

  constructor(private readonly presenceTimeoutSeconds: number) {}

  subscribe(projectId: string, userId: string, res: ServerResponse): void {
    const set = this.listeners.get(projectId) ?? new Set();
    set.add(res);
    this.listeners.set(projectId, set);
    const people = this.selected.get(projectId) ?? new Map();
    people.set(userId, null);
    this.selected.set(projectId, people);
    this.seen.set(key(projectId, userId), new Date());
  }

  unsubscribe(projectId: string, userId: string, res: ServerResponse): void {
    const set = this.listeners.get(projectId);
    if (set !== undefined) {
      set.delete(res);
      if (set.size === 0) this.listeners.delete(projectId);
    }
    this.seen.delete(key(projectId, userId));
  }

  heartbeat(projectId: string, userId: string): void {
    this.seen.set(key(projectId, userId), new Date());
  }

  select(projectId: string, userId: string, itemId: string | null): void {
    const people = this.selected.get(projectId);
    if (people !== undefined) people.set(userId, itemId);
    this.seen.set(key(projectId, userId), new Date());
  }

  leave(projectId: string, userId: string): void {
    const people = this.selected.get(projectId);
    if (people !== undefined) people.delete(userId);
    this.seen.delete(key(projectId, userId));
  }

  /** Everyone with the project open, with the bar they have focused. */
  peopleHere(projectId: string): { userId: string; selected: string | null }[] {
    const people = this.selected.get(projectId);
    if (people === undefined) return [];
    const cutoff = Date.now() - this.presenceTimeoutSeconds * 1000;
    const result: { userId: string; selected: string | null }[] = [];
    for (const [userId, selected] of people.entries()) {
      const at = this.seen.get(key(projectId, userId));
      if (at !== undefined && at.getTime() >= cutoff) result.push({ userId, selected });
    }
    return result;
  }

  /** Drop people who stopped sending heartbeats. */
  sweep(): void {
    const cutoff = Date.now() - this.presenceTimeoutSeconds * 1000;
    for (const [k, at] of this.seen.entries()) {
      if (at.getTime() < cutoff) {
        const [projectId, userId] = splitKey(k);
        const people = this.selected.get(projectId);
        if (people !== undefined) people.delete(userId);
        this.seen.delete(k);
      }
    }
  }

  publish(projectId: string, message: LiveMessage): void {
    const set = this.listeners.get(projectId);
    if (set === undefined) return;
    const data = `data: ${JSON.stringify(message)}\n\n`;
    for (const res of set) res.write(data);
  }
}

function key(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

function splitKey(k: string): [string, string] {
  const index = k.indexOf(':');
  return [k.slice(0, index), k.slice(index + 1)];
}
