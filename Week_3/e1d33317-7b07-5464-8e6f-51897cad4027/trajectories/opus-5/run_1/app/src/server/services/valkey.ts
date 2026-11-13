import Redis from 'ioredis';
import { config } from '../config.js';
import type { PresenceCursor, Role, ServerMessage } from '../../shared/types.js';

export interface PresenceRecord {
  name: string;
  role: Role;
  cursor: PresenceCursor | null;
  at: number;
}

/** Internal traffic that is not part of the client protocol. */
export type ChannelMessage = ServerMessage | { type: 'close'; collaboratorId: string };

type Listener = (scoreId: string, message: ChannelMessage) => void;

const RETRY_MS = 5000;

function channelFor(scoreId: string): string {
  return `fairline:score:${scoreId}`;
}

function presenceKeyFor(scoreId: string): string {
  return `fairline:presence:${scoreId}`;
}

function client(): Redis {
  return new Redis(config.valkeyUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: () => RETRY_MS,
  });
}

/**
 * The broadcast channel and presence hash for every score.
 * While Valkey is unreachable `live` is false and broadcasts reach only this instance.
 */
export class Broadcast {
  private readonly publisher = client();
  private readonly subscriber = client();
  private readonly listeners = new Set<Listener>();
  private readonly subscribed = new Set<string>();
  private liveNow = false;
  private readonly liveWatchers = new Set<(live: boolean) => void>();

  start(): void {
    this.subscriber.on('message', (channel: string, payload: string) => {
      const scoreId = channel.slice('fairline:score:'.length);
      const message = JSON.parse(payload) as ChannelMessage;
      for (const listener of this.listeners) listener(scoreId, message);
    });
    for (const connection of [this.publisher, this.subscriber]) {
      connection.on('error', () => this.setLive(false));
      connection.on('end', () => this.setLive(false));
      connection.connect().catch(() => this.setLive(false));
    }
    this.publisher.on('ready', () => {
      void this.checkLive();
    });
    this.subscriber.on('ready', () => {
      for (const scoreId of this.subscribed) {
        this.subscriber.subscribe(channelFor(scoreId)).catch(() => undefined);
      }
      void this.checkLive();
    });
    setInterval(() => void this.checkLive(), RETRY_MS).unref();
  }

  private async checkLive(): Promise<void> {
    try {
      await this.publisher.ping();
      this.setLive(this.subscriber.status === 'ready');
    } catch {
      this.setLive(false);
    }
  }

  private setLive(live: boolean): void {
    if (this.liveNow === live) return;
    this.liveNow = live;
    for (const watcher of this.liveWatchers) watcher(live);
  }

  get live(): boolean {
    return this.liveNow;
  }

  onLiveChange(watcher: (live: boolean) => void): void {
    this.liveWatchers.add(watcher);
  }

  onMessage(listener: Listener): void {
    this.listeners.add(listener);
  }

  async subscribe(scoreId: string): Promise<void> {
    if (this.subscribed.has(scoreId)) return;
    this.subscribed.add(scoreId);
    try {
      await this.subscriber.subscribe(channelFor(scoreId));
    } catch {
      this.setLive(false);
    }
  }

  /** Carries a message to every instance, or to this one alone while Valkey is unreachable. */
  async publish(scoreId: string, message: ChannelMessage): Promise<void> {
    try {
      await this.publisher.publish(channelFor(scoreId), JSON.stringify(message));
    } catch {
      this.setLive(false);
      for (const listener of this.listeners) listener(scoreId, message);
    }
  }

  async writePresence(
    scoreId: string,
    collaboratorId: string,
    record: PresenceRecord,
  ): Promise<void> {
    try {
      await this.publisher.hset(presenceKeyFor(scoreId), collaboratorId, JSON.stringify(record));
    } catch {
      this.setLive(false);
    }
  }

  async dropPresence(scoreId: string, collaboratorId: string): Promise<void> {
    try {
      await this.publisher.hdel(presenceKeyFor(scoreId), collaboratorId);
    } catch {
      this.setLive(false);
    }
  }

  async readPresence(scoreId: string): Promise<Map<string, PresenceRecord> | null> {
    try {
      const raw = await this.publisher.hgetall(presenceKeyFor(scoreId));
      const out = new Map<string, PresenceRecord>();
      for (const [id, payload] of Object.entries(raw)) {
        out.set(id, JSON.parse(payload) as PresenceRecord);
      }
      return out;
    } catch {
      this.setLive(false);
      return null;
    }
  }

  /** Counts accepted operations in the current window; falls back to this instance alone. */
  async countOperations(collaboratorId: string, windowStart: number, amount: number): Promise<number | null> {
    const key = `fairline:throttle:${collaboratorId}:${windowStart}`;
    try {
      const total = await this.publisher.incrby(key, amount);
      await this.publisher.expire(key, 30);
      return total;
    } catch {
      this.setLive(false);
      return null;
    }
  }
}

export const broadcast = new Broadcast();
