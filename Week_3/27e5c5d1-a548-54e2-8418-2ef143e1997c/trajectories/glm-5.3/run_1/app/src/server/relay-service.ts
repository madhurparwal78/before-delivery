import { createClient } from 'redis';
import type { AppConfig } from './config.js';

export interface BoardEventEnvelope {
  boardId: string;
  /** The raw change notice; events are shaped per recipient at delivery time. */
  kind:
    | 'card.changed'
    | 'card.moved'
    | 'card.removed'
    | 'card.created'
    | 'list.changed'
    | 'list.created'
    | 'list.updated'
    | 'board.updated';
  cardId?: string;
  fromListId?: string;
  fromRank?: number;
  fromPosition?: number;
  toListId?: string;
  toRank?: number;
  version?: number;
  moverUserId?: string;
  listId?: string;
  listName?: string;
  boardName?: string;
  boardVisibility?: 'workspace' | 'private';
}

export interface UserEventEnvelope {
  kind: 'access' | 'session';
  userId: string;
  workspaceId: string;
  boardIds: string[];
  /** For session events: the one session that stays signed in. */
  keepTokenHash?: string;
}

type RelayMessage = { channel: string; payload: string };

interface MinimalRedisClient {
  publish(channel: string, message: string): Promise<number>;
  pSubscribe(pattern: string, listener: (message: string, channel: string) => void): Promise<unknown>;
  quit(): Promise<unknown>;
  connect(): Promise<unknown>;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

/**
 * The live relay seam: events reach every open stream of a board on either worker.
 * A dedicated subscriber connection and a publisher connection, because a Valkey
 * connection in subscribe mode may only run subscribe-family commands.
 * While Valkey is down, streams stay open, boards get live.paused, and the app retries.
 */
export class RelayService {
  private subscriber: MinimalRedisClient | null = null;
  private publisher: MinimalRedisClient | null = null;
  private connected = false;
  private subscribers: ((message: RelayMessage) => void)[] = [];
  private retryTimer: NodeJS.Timeout | null = null;
  private readonly retryIntervalMs = 3_000;

  constructor(private readonly config: AppConfig) {}

  isUp(): boolean {
    return this.connected;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      void this.reconnect();
    }, this.retryIntervalMs);
    if (typeof this.retryTimer.unref === 'function') this.retryTimer.unref();
  }

  /** Give an unreachable relay a bounded wait so boot never stalls. */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay connect timeout')), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private buildClient(): MinimalRedisClient {
    const client = createClient({
      url: this.config.valkeyUrl,
      socket: { connectTimeout: 1_500, reconnectStrategy: false },
    });
    return client as unknown as MinimalRedisClient;
  }

  async connect(): Promise<void> {
    let subscriber: MinimalRedisClient | null = null;
    let publisher: MinimalRedisClient | null = null;
    try {
      subscriber = this.buildClient();
      publisher = this.buildClient();
      subscriber.on('error', () => {
        this.connected = false;
        this.scheduleRetry();
      });
      publisher.on('error', () => {
        this.connected = false;
        this.scheduleRetry();
      });
      await this.withTimeout(subscriber.connect(), 2_500);
      await this.withTimeout(publisher.connect(), 2_500);
      await this.withTimeout(
        subscriber.pSubscribe('kinfold:*', (payload: string, channel: string) => {
          for (const subscriberHandler of this.subscribers) subscriberHandler({ channel, payload });
        }),
        2_500,
      );
      this.subscriber = subscriber;
      this.publisher = publisher;
      this.connected = true;
      
      if (this.retryTimer) {
        clearInterval(this.retryTimer);
        this.retryTimer = null;
      }
    } catch {
      this.connected = false;
      this.subscriber = null;
      this.publisher = null;
      for (const client of [subscriber, publisher]) this.hardDisconnect(client);
      
      this.scheduleRetry();
    }
  }

  /** Tear down a possibly dead client: a polite quit can hang or throw when the socket is gone. */
  private hardDisconnect(client: MinimalRedisClient | null): void {
    if (!client) return;
    try {
      (client as unknown as { destroy?: () => void }).destroy?.();
    } catch {
      // already gone
    }
  }

  private async reconnect(): Promise<void> {
        if (this.connected) {
      if (this.retryTimer) {
        clearInterval(this.retryTimer);
        this.retryTimer = null;
      }
      return;
    }
    const dying = [this.subscriber, this.publisher];
    this.subscriber = null;
    this.publisher = null;
    for (const client of dying) this.hardDisconnect(client);
    await this.connect();
  }

  subscribe(handler: (message: RelayMessage) => void): void {
    this.subscribers.push(handler);
  }

  async publishBoard(boardId: string, envelope: BoardEventEnvelope): Promise<void> {
    if (!this.publisher || !this.connected) return;
    try {
      await this.publisher.publish(`kinfold:board:${boardId}`, JSON.stringify(envelope));
    } catch {
      this.connected = false;
    }
  }

  async publishUser(userId: string, payload: UserEventEnvelope): Promise<void> {
    if (!this.publisher || !this.connected) return;
    try {
      await this.publisher.publish(`kinfold:user:${userId}`, JSON.stringify(payload));
    } catch {
      this.connected = false;
    }
  }
}
