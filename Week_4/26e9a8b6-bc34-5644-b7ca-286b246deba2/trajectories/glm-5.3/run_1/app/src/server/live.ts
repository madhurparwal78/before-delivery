// Live changes over one same-origin connection per page: presence, edits, questions, counts.

import type { ServerResponse } from 'node:http';

export type LiveEvent =
  | { type: 'presence'; guide_id: string; people: { id: string; name: string; step: number | null; at: number }[] }
  | { type: 'edit'; guide_id: string; field: string; value: unknown; revision: number; field_revision?: number; by: string }
  | { type: 'revision'; guide_id: string; revision: number }
  | { type: 'steps'; guide_id: string }
  | { type: 'question'; guide_id: string; question_id: string }
  | { type: 'answer'; guide_id: string; question_id: string }
  | { type: 'like'; guide_id: string; count: number }
  | { type: 'fork'; guide_id: string; count: number }
  | { type: 'version'; guide_id: string; number: number; by: string }
  | { type: 'state'; guide_id: string; state: string }
  | { type: 'guide-status'; guide_id: string; status: string };

export interface LiveClient {
  id: number;
  guideId: string | null;
  accountId: string | null;
  accountName: string | null;
  userId: string;
  step: number | null;
  lastSeen: number;
  response: ServerResponse;
}

let nextClientId = 1;

export interface PresenceEntry {
  id: string;
  name: string;
  step: number | null;
  at: number;
}

export class LiveHub {
  private clients = new Map<number, LiveClient>();
  /** Presence per guide, by account id; dropped after the grace period. */
  private presence = new Map<string, Map<string, PresenceEntry>>();
  private lastEventId = 0;
  private eventLog = new Map<number, LiveEvent>();
  private readonly logSize = 500;

  add(response: ServerResponse, guideId: string | null, accountId: string | null, accountName: string | null, lastEventId: number): LiveClient {
    const client: LiveClient = {
      id: nextClientId++,
      guideId,
      accountId,
      accountName,
      userId: `${accountId ?? 'anon'}-${nextClientId}`,
      step: null,
      lastSeen: Date.now(),
      response,
    };
    this.clients.set(client.id, client);
    if (lastEventId > 0) this.catchUp(client, lastEventId);
    return client;
  }

  remove(client: LiveClient): void {
    this.clients.delete(client.id);
  }

  get(clientId: number): LiveClient | undefined {
    return this.clients.get(clientId);
  }

  setPresence(guideId: string, accountId: string, name: string, step: number | null): void {
    const guide = this.presence.get(guideId) ?? new Map<string, PresenceEntry>();
    guide.set(accountId, { id: accountId, name, step, at: Date.now() });
    this.presence.set(guideId, guide);
  }

  /** Presence of everyone but the viewer; entries older than the grace period drop out. */
  presenceOf(guideId: string, exceptAccountId: string | null, graceSeconds: number): PresenceEntry[] {
    const guide = this.presence.get(guideId);
    if (!guide) return [];
    const now = Date.now();
    const out: PresenceEntry[] = [];
    for (const entry of guide.values()) {
      if (entry.id === exceptAccountId) continue;
      if (now - entry.at > graceSeconds * 1000) {
        guide.delete(entry.id);
        continue;
      }
      out.push(entry);
    }
    return out;
  }

  /** Publishes an event to every interested client and remembers it for catch-up. */
  publish(event: LiveEvent): void {
    this.lastEventId += 1;
    this.eventLog.set(this.lastEventId, event);
    if (this.eventLog.size > this.logSize) {
      const oldest = this.eventLog.keys().next().value;
      if (oldest !== undefined) this.eventLog.delete(oldest);
    }
    const data = `id: ${this.lastEventId}\nevent: live\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients.values()) {
      if (client.guideId !== event.guide_id && !isGlobal(event)) continue;
      writeSse(client, data);
    }
  }

  /** Events missed while a connection was down, from Last-Event-Id. */
  catchUp(client: LiveClient, lastEventId: number): void {
    for (const [id, event] of this.eventLog) {
      if (id <= lastEventId) continue;
      if (client.guideId !== event.guide_id && !isGlobal(event)) continue;
      writeSse(client, `id: ${id}\nevent: live\ndata: ${JSON.stringify(event)}\n\n`);
    }
  }

  currentEventId(): number {
    return this.lastEventId;
  }
}

function isGlobal(event: LiveEvent): boolean {
  return event.type === 'like' || event.type === 'fork';
}

function writeSse(client: LiveClient, data: string): void {
  try {
    client.response.write(data);
  } catch {
    // The socket died; the close handler will clean it up.
  }
}
