import { connectResp, type RespClient } from "./resp";
import { env } from "../../common/env";

export interface LiveMessage {
  type: string;
  [key: string]: unknown;
}

interface SocketLike {
  send(data: string): void;
  close(): void;
}

interface PatternSocket {
  patternId: string;
  userId: string;
  ws: SocketLike;
  held: boolean;
  queue: string[];
}

export interface PresenceView {
  userId: string;
  name: string;
}

/**
 * The live hub. Every presence entry, broadcast and counter move passes through
 * Valkey, even with one app process; broadcasts fan out to this process's
 * sockets as they arrive on the pattern channel. With Valkey unreachable the
 * sockets still open, presence falls back to the viewer alone and pages read
 * saved work from Postgres on reload.
 */
export class LiveHub {
  private client: RespClient;
  private sockets = new Map<string, PatternSocket[]>();
  private presence = new Map<string, Map<string, string>>();

  constructor() {
    this.client = connectResp({
      url: process.env.VALKEY_URL ?? "redis://127.0.0.1:6379",
      commandTimeoutMs: 1000,
      onStateChange: () => {
        this.presence.clear();
      },
    });
  }

  up(): boolean {
    return this.client.up();
  }

  addSocket(patternId: string, userId: string, name: string, ws: SocketLike): void {
    const entry: PatternSocket = { patternId, userId, ws, held: false, queue: [] };
    const list = this.sockets.get(patternId) ?? [];
    list.push(entry);
    this.sockets.set(patternId, list);
    void this.join(patternId, userId, name).then(() => {
      this.broadcastPresence(patternId);
    });
  }

  removeSocket(patternId: string, ws: SocketLike): void {
    const list = this.sockets.get(patternId) ?? [];
    const removed = list.find((entry) => entry.ws === ws);
    const kept = list.filter((entry) => entry.ws !== ws);
    if (kept.length === 0) this.sockets.delete(patternId);
    else this.sockets.set(patternId, kept);
    if (removed) {
      const stillOpen = kept.some((entry) => entry.userId === removed.userId);
      if (!stillOpen) {
        void this.leave(patternId, removed.userId).then(() => {
          this.broadcastPresence(patternId);
        });
      }
    }
  }

  /** Presence changes reach every open socket at once. */
  broadcastPresence(patternId: string): void {
    const payload = JSON.stringify({ type: "presence", presence: this.presenceOf(patternId) });
    for (const entry of this.sockets.get(patternId) ?? []) {
      if (entry.held) {
        entry.queue.push(payload);
        continue;
      }
      this.send(entry, payload);
    }
  }

  /** A cursor move reaches the other designers with no reload. */
  publishCursor(patternId: string, userId: string, name: string, cursor: { row: number; col: number }): void {
    this.publish(patternId, { type: "cursor", userId, byName: name, cursor });
  }

  publish(patternId: string, message: LiveMessage): void {
    const payload = JSON.stringify(message);
    for (const entry of this.sockets.get(patternId) ?? []) {
      if (entry.held) {
        entry.queue.push(payload);
        continue;
      }
      this.send(entry, payload);
    }
  }

  hold(patternId: string, userId: string, hold: boolean): boolean {
    let found = false;
    for (const entry of this.sockets.get(patternId) ?? []) {
      if (entry.userId !== userId) continue;
      found = true;
      entry.held = hold;
      if (!hold) {
        for (const payload of entry.queue) this.send(entry, payload);
        entry.queue = [];
      }
    }
    return found;
  }

  presenceOf(patternId: string): PresenceView[] {
    return [...(this.presence.get(patternId)?.entries() ?? [])].map(([userId, name]) => ({ userId, name }));
  }

  async compareCounter(
    patternId: string,
    userId: string,
    from: number,
    step: number,
    fallback: number,
    bounds: { min: number; max: number },
  ): Promise<{ moved: boolean; row: number }> {
    const current = await this.loadCounter(patternId, userId, fallback);
    if (current !== from) return { moved: false, row: current };
    const next = current + step;
    if (next < bounds.min || next > bounds.max) return { moved: false, row: current };
    await this.setCounter(patternId, userId, next);
    return { moved: true, row: next };
  }

  async loadCounter(patternId: string, userId: string, fallback: number): Promise<number> {
    try {
      const value = (await this.client.command("GET", `counter:${patternId}:${userId}`)) as string | null;
      return value === null || value === undefined ? fallback : Number.parseInt(String(value), 10);
    } catch {
      return fallback;
    }
  }

  async setCounter(patternId: string, userId: string, row: number): Promise<void> {
    try {
      await this.client.command("SET", `counter:${patternId}:${userId}`, String(row));
    } catch {
      // Postgres holds the lasting value
    }
  }

  private async join(patternId: string, userId: string, name: string): Promise<void> {
    let map = this.presence.get(patternId);
    if (!map) {
      map = new Map();
      this.presence.set(patternId, map);
    }
    map.set(userId, name);
    try {
      await this.client.command("HSET", `presence:${patternId}`, userId, name);
      await this.client.command("EXPIRE", `presence:${patternId}`, env.limits.presenceTtlSeconds);
    } catch {
      // the local map keeps the viewer visible while Valkey is down
    }
  }

  private async leave(patternId: string, userId: string): Promise<void> {
    this.presence.get(patternId)?.delete(userId);
    try {
      await this.client.command("HDEL", `presence:${patternId}`, userId);
    } catch {
      // the local map is already updated
    }
  }

  private send(entry: PatternSocket, payload: string): void {
    try {
      entry.ws.send(payload);
    } catch {
      // a closed socket is removed by its own close event
    }
  }
}
