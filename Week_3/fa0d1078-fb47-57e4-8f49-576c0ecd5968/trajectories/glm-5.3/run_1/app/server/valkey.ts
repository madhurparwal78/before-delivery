import { createConnection, type Socket } from 'node:net';

// A small RESP client for Valkey. Live fan-out between server processes runs
// through Valkey publish and subscribe. When Valkey is unreachable, duel
// endpoints answer 503 LIVE_UNAVAILABLE, the leaderboard falls back to
// Postgres, and the health check lists "valkey".

export type RespValue = string | null;

interface Waiter {
  resolve(value: RespValue): void;
  reject(err: Error): void;
}

export interface ValkeyService {
  /** Runs one command that answers a bulk value. */
  bulk(args: (string | number)[]): Promise<string | null>;
  /** Runs one command that answers an integer. */
  int(args: (string | number)[]): Promise<number>;
  /** Runs one command that answers an array of bulk values (HGETALL). */
  pairs(args: (string | number)[]): Promise<string[]>;
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, onMessage: (message: string) => void): Promise<void>;
  healthy(): Promise<boolean>;
  close(): Promise<void>;
}

export interface ValkeyOptions {
  valkeyUrl: string;
  onDown?(down: boolean): void;
}

interface Target {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

function parseTarget(valkeyUrl: string): Target {
  const url = new URL(valkeyUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : null,
    password: url.password ? decodeURIComponent(url.password) : null,
  };
}

function encode(args: (string | number)[]): string {
  const parts = args.map((a) => {
    const v = String(a);
    return `$${Buffer.byteLength(v, 'utf8')}\r\n${v}\r\n`;
  });
  return `*${args.length}\r\n${parts.join('')}`;
}

class RespConnection {
  private socket: Socket | null = null;
  private buffer = '';
  private waiters: Waiter[] = [];
  private subscribed = false;
  private handler: ((channel: string, message: string) => void) | null = null;
  private connecting: Promise<Socket> | null = null;

  constructor(
    private readonly target: Target,
    private readonly notifyDown: (down: boolean) => void,
  ) {}

  setHandler(handler: (channel: string, message: string) => void): void {
    this.handler = handler;
  }

  markSubscribed(): void {
    this.subscribed = true;
  }

  // Data arrives as whole or partial frames; parse everything the buffer
  // holds, delivering push frames to the handler and answers to waiters.
  private drain(): void {
    for (;;) {
      const parsed = this.parseOne();
      if (parsed === null) break;
      if (parsed.kind === 'push') continue;
      const waiter = this.waiters.shift();
      if (!waiter) continue;
      if (parsed.kind === 'error') waiter.reject(new Error(String(parsed.value)));
      else waiter.resolve(parsed.value);
    }
  }

  private parseOne(): { kind: 'value' | 'error' | 'push'; value: RespValue } | null {
    if (this.buffer.length === 0) return null;
    const c = this.buffer[0];
    if (c === '+' || c === '-' || c === ':') {
      const end = this.buffer.indexOf('\r\n');
      if (end < 0) return null;
      const value = this.buffer.slice(1, end);
      this.buffer = this.buffer.slice(end + 2);
      return { kind: c === '-' ? 'error' : 'value', value };
    }
    if (c === '$') {
      const end = this.buffer.indexOf('\r\n');
      if (end < 0) return null;
      const len = Number(this.buffer.slice(1, end));
      if (len < 0) {
        this.buffer = this.buffer.slice(end + 2);
        return { kind: 'value', value: null };
      }
      if (this.buffer.length < end + 2 + len + 2) return null;
      const value = this.buffer.slice(end + 2, end + 2 + len);
      this.buffer = this.buffer.slice(end + 2 + len + 2);
      return { kind: 'value', value };
    }
    if (c === '*') {
      const end = this.buffer.indexOf('\r\n');
      if (end < 0) return null;
      const count = Number(this.buffer.slice(1, end));
      let cursor = end + 2;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        // Array elements can be bulk strings or integers (the subscribe
        // confirmation carries its count as an integer).
        if (this.buffer[cursor] === ':') {
          const intEnd = this.buffer.indexOf('\r\n', cursor);
          if (intEnd < 0) return null;
          parts.push(this.buffer.slice(cursor + 1, intEnd));
          cursor = intEnd + 2;
          continue;
        }
        if (this.buffer[cursor] !== '$') return null;
        const lenEnd = this.buffer.indexOf('\r\n', cursor);
        if (lenEnd < 0) return null;
        const len = Number(this.buffer.slice(cursor + 1, lenEnd));
        if (this.buffer.length < lenEnd + 2 + len + 2) return null;
        parts.push(this.buffer.slice(lenEnd + 2, lenEnd + 2 + len));
        cursor = lenEnd + 2 + len + 2;
      }
      this.buffer = this.buffer.slice(cursor);
      if (parts[0] === 'message' && parts.length >= 3) {
        this.handler?.(parts[1], parts[2]);
        return { kind: 'push', value: null };
      }
      // Flat arrays are joined with a separator the service splits itself.
      return { kind: 'value', value: parts.join('\n') };
    }
    return null;
  }

  // An unreachable Valkey is a health fact: the connect attempt is settled by
  // the caller's timeout rather than an unhandled rejection.
  private tryConnect(timeoutMs: number): Promise<Socket | null> {
    const attempt = this.connect();
    return new Promise<Socket | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      attempt.then((s) => {
        clearTimeout(timer);
        resolve(s);
      }, () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  async healthyOnce(): Promise<boolean> {
    const s = await this.tryConnect(2500);
    if (s === null) return false;
    try {
      const pong = await this.run(['PING']);
      return pong !== null;
    } catch {
      return false;
    }
  }

  private connect(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<Socket>((resolve, reject) => {
      const s = createConnection({ host: this.target.host, port: this.target.port }, () => {
        this.socket = s;
        this.buffer = '';
        this.connecting = null;
        this.notifyDown(false);
        if (this.target.password && this.target.username) {
          s.write(encode(['AUTH', this.target.username, this.target.password]));
        } else if (this.target.password) {
          s.write(encode(['AUTH', this.target.password]));
        }
        if (this.subscribed) s.write(encode(['SUBSCRIBE', 'seam:live']));
        // Drain anything already buffered before this connect callback ran.
        setImmediate(() => this.drain());
        resolve(s);
      });
      s.setNoDelay(true);
      s.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
        this.drain();
      });
      s.on('error', (err) => {
        this.connecting = null;
        this.socket = null;
        this.notifyDown(true);
        for (const w of this.waiters.splice(0)) w.reject(err);
        reject(err);
      });
      s.on('close', () => {
        this.socket = null;
        this.notifyDown(true);
      });
    });
    return this.connecting;
  }

  async run(args: (string | number)[]): Promise<RespValue> {
    const s = await this.connect();
    return new Promise<RespValue>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      s.write(encode(args), (err) => {
        if (err) {
          const idx = this.waiters.findIndex((w) => w.resolve === resolve);
          if (idx >= 0) this.waiters.splice(idx, 1);
          reject(err);
        }
      });
    });
  }

  async close(): Promise<void> {
    this.socket?.destroy();
    this.socket = null;
  }
}

export function createValkey(options: ValkeyOptions): ValkeyService {
  const target = parseTarget(options.valkeyUrl);
  const notify = (down: boolean) => options.onDown?.(down);
  const command = new RespConnection(target, notify);
  const publishConn = new RespConnection(target, notify);
  const subscribeConn = new RespConnection(target, notify);
  subscribeConn.setHandler((_channel, message) => {
    liveHandler?.(message);
  });
  let liveHandler: ((message: string) => void) | null = null;

  return {
    async bulk(args) {
      return command.run(args);
    },
    async int(args) {
      const v = await command.run(args);
      return v === null ? 0 : Number(v);
    },
    async pairs(args) {
      const v = await command.run(args);
      if (v === null) return [];
      return v.split('\n');
    },
    async publish(channel, message) {
      await publishConn.run(['PUBLISH', channel, message]);
    },
    async subscribe(channel, onMessage) {
      liveHandler = onMessage;
      subscribeConn.markSubscribed();
      await subscribeConn.run(['SUBSCRIBE', channel]);
    },
    async healthy() {
      return command.healthyOnce();
    },
    async close() {
      await Promise.allSettled([command.close(), publishConn.close(), subscribeConn.close()]);
    },
  };
}
