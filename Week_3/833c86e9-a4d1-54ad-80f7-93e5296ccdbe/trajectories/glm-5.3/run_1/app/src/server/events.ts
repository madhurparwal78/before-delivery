import type { ServerResponse } from "node:http";

export type EventName = "clock" | "availability" | "quote.changed" | "hold.expired" | "account.changed";

export type KipEvent = {
  name: EventName;
  /** the contexts (visitor id, or username) this event is for; empty = everyone */
  to: { visitors?: string[]; usernames?: string[] };
  data: unknown;
};

type Client = {
  res: ServerResponse;
  visitorId: string | null;
  username: string | null;
};

/**
 * The live event hub. Each stream is bound to one browser context by its
 * visitor cookie and session, and receives only the events published for it.
 */
export class EventHub {
  private clients = new Set<Client>();
  private queue: { event: KipEvent; at: number }[] = [];

  add(res: ServerResponse, visitorId: string | null, username: string | null): void {
    const client: Client = { res, visitorId, username };
    this.clients.add(client);
    res.on("close", () => { this.clients.delete(client); });
  }

  private matches(client: Client, event: KipEvent): boolean {
    if (event.to.visitors === undefined && event.to.usernames === undefined) return true;
    if (event.to.visitors && client.visitorId && event.to.visitors.includes(client.visitorId)) return true;
    if (event.to.usernames && client.username && event.to.usernames.includes(client.username)) return true;
    return false;
  }

  /** Send to connected clients; queue for a moment so late subscribers on the same context still catch it. */
  publish(event: KipEvent): void {
    const item = { event, at: Date.now() };
    this.queue.push(item);
    if (this.queue.length > 200) this.queue.shift();
    for (const client of this.clients) {
      if (this.matches(client, event)) this.write(client, event);
    }
  }

  private write(client: Client, event: KipEvent): void {
    try {
      client.res.write(`event: ${event.name}\ndata: ${JSON.stringify(event.data)}\n\n`);
    } catch { /* connection gone */ }
  }

  /** The open client responses, for heartbeats. */
  responses(): ServerResponse[] {
    return [...this.clients].map((c) => c.res);
  }

  sendComment(res: ServerResponse): void {
    try { res.write(": heartbeat\n\n"); } catch { /* gone */ }
  }

  /** Replay recent events (last 2 seconds) matching a context, for reconnecting streams. */
  replayFor(res: ServerResponse, visitorId: string | null, username: string | null): void {
    const client: Client = { res, visitorId, username };
    const cutoff = Date.now() - 2000;
    for (const { event, at } of this.queue) {
      if (at < cutoff) continue;
      if (this.matches(client, event)) this.write(client, event);
    }
  }

  broadcastClock(now: string): void {
    this.publish({ name: "clock", to: {}, data: { now } });
  }
}

export const hub = new EventHub();
