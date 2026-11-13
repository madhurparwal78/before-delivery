// SSE live stream hub: filtering, replay and a shared monotonic event id.
import { config } from './config.js';

export interface LiveEvent {
  type: string;
  data: Record<string, unknown>;
  id?: number;
}

export interface LiveClient {
  id: string;
  send: (event: LiveEvent) => boolean;
  filter: (event: LiveEvent) => boolean;
}

export class LiveHub {
  private clients = new Map<string, LiveClient>();
  private nextId = 1;
  private recent: LiveEvent[] = [];

  subscribe(client: LiveClient): void {
    this.clients.set(client.id, client);
  }

  unsubscribe(clientId: string): void {
    this.clients.delete(clientId);
  }

  closeAll(): number {
    const count = this.clients.size;
    for (const client of this.clients.values()) {
      try {
        client.send({ type: 'close', data: {} });
      } catch {
        // the dropped stream is removed below
      }
    }
    this.clients.clear();
    return count;
  }

  publish(event: LiveEvent): void {
    const withId: LiveEvent = { ...event, id: this.nextId };
    this.nextId += 1;
    this.recent.push(withId);
    const limit = config().liveReplayLimit;
    if (this.recent.length > limit) this.recent.splice(0, this.recent.length - limit);
    for (const client of [...this.clients.values()]) {
      try {
        client.send(withId);
      } catch {
        this.clients.delete(client.id);
      }
    }
  }

  replayAfter(id: number | null, filter: (event: LiveEvent) => boolean): LiveEvent[] {
    if (id === null) return [];
    return this.recent.filter((event) => event.id !== undefined && event.id > id && filter(event));
  }

  oldestKeptId(): number | null {
    return this.recent.length > 0 ? (this.recent[0].id ?? null) : null;
  }
}
