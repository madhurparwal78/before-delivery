import type { ServerResponse } from 'node:http';

export type EventName =
  | 'rule-in-force'
  | 'access-changed'
  | 'session-ended'
  | 'billing-changed'
  | 'check-finished'
  | 'review-opened'
  | 'review-changed'
  | 'seat-confirmed';

export interface AccessChangedData {
  vault_ids: string[];
  ended: Array<{ vault_id: string; name: string }>;
  cause: 'change' | 'boundary';
}

/**
 * The server's event stream. Each signed-in person's open page listens here;
 * the page never decides any of these from the device clock.
 */
export class EventHub {
  private readonly listeners = new Map<string, Set<ServerResponse>>();

  add(personId: string, res: ServerResponse): void {
    let set = this.listeners.get(personId);
    if (!set) {
      set = new Set();
      this.listeners.set(personId, set);
    }
    set.add(res);
  }

  remove(personId: string, res: ServerResponse): void {
    const set = this.listeners.get(personId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.listeners.delete(personId);
  }

  send(personId: string, event: EventName, data: unknown): void {
    const set = this.listeners.get(personId);
    if (!set) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
  }

  /** Send to every open page of the office manager and managing partner. */
  sendToRoleAudience(personIds: string[], event: EventName, data: unknown): void {
    for (const personId of personIds) {
      this.send(personId, event, data);
    }
  }
}
