import type { EventEmitter } from 'node:events';

export type LiveEvent =
  | { type: 'me'; playerId: string }
  | { type: 'friends'; playerId: string }
  | { type: 'table'; tableId: string; seatPlayerIds: string[] }
  | { type: 'queue'; playerId: string }
  | { type: 'tournament'; tournamentId: string; playerIds: string[] }
  | { type: 'club'; clubId: string; playerIds: string[] }
  | { type: 'presence'; playerIds: string[] }
  | { type: 'leaderboard' };

interface SseClient {
  id: string;
  playerId: string | null;
  send: (event: LiveEvent) => void;
  subscriptions: Set<string>;
}

export class Hub {
  private clients = new Map<string, SseClient>();
  private emitter: EventEmitter;
  private counters = new Map<string, { version: number; data: string }>();

  constructor(emitter: EventEmitter) {
    this.emitter = emitter;
  }

  add(client: SseClient): void {
    this.clients.set(client.id, client);
  }

  remove(clientId: string): void {
    this.clients.delete(clientId);
  }

  publish(event: LiveEvent, ...targets: string[]): void {
    const targetsSet = new Set(targets);
    for (const client of this.clients.values()) {
      if (client.playerId === null) continue;
      if (targetsSet.size === 0 || targetsSet.has(client.playerId)) {
        client.send(event);
      }
    }
    this.emitter.emit('live', event);
  }

  publishAll(event: LiveEvent): void {
    for (const client of this.clients.values()) {
      if (client.playerId === null) continue;
      client.send(event);
    }
  }

  tableSubscribers(tableId: string): string[] {
    const out: string[] = [];
    for (const client of this.clients.values()) {
      if (client.subscriptions.has(`table:${tableId}`)) out.push(client.id);
    }
    return out;
  }

  sub(clientId: string, topic: string): void {
    this.clients.get(clientId)?.subscriptions.add(topic);
  }

  unsub(clientId: string, topic: string): void {
    this.clients.get(clientId)?.subscriptions.delete(topic);
  }
}
