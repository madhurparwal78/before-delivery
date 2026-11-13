import net from 'node:net';

/**
 * A minimal RESP client for Valkey: pub/sub plus a few commands. While Valkey
 * is unreachable, `live` is false and callers degrade; every operation tries
 * afresh so the service returns on its own.
 */
export class Valkey {
  private socket: net.Socket | null = null;
  private subSocket: net.Socket | null = null;
  private connected = false;
  private buffer: Buffer = Buffer.alloc(0);
  private pending: { resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
  private subscribers: ((channel: string, message: string) => void)[] = [];
  private url = '';
  private retryTimer: NodeJS.Timeout | null = null;
  private pendingAuth: Promise<void> | null = null;
  private authResolve: (() => void) | null = null;
  private wasLive = false;

  async connect(): Promise<boolean> {
    this.url = process.env.VALKEY_URL ?? '';
    return this.tryConnect();
  }

  private parseUrl(): { host: string; port: number; username: string; password: string; db: number } {
    const u = new URL(this.url);
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      username: decodeURIComponent(u.username || ''),
      password: decodeURIComponent(u.password || ''),
      db: Number(u.pathname.slice(1) || 0),
    };
  }

  private tryConnect(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.url) {
        resolve(false);
        return;
      }
      const { host, port, username, password, db } = this.parseUrl();
      const socket = net.createConnection({ host, port });
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (ok) {
          this.socket = socket;
          this.connected = true;
          if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
          }
          if (!this.wasLive) {
            this.wasLive = true;
            this.notifyLive(true);
          }
        } else {
          socket.destroy();
        }
        resolve(ok);
      };
      socket.setTimeout(5000, () => {
        if (!settled) done(false);
      });
      socket.once('connect', () => {
        if (password) {
          // wait for the AUTH (and optional SELECT) replies before declaring ready
          this.pendingAuth = new Promise<void>((authResolve) => {
            this.authResolve = authResolve;
          });
          socket.write(username ? resp(['AUTH', username, password]) : resp(['AUTH', password]));
          void this.pendingAuth
            .then(() => {
              if (db > 0) {
                return new Promise<void>((selectResolve) => {
                  this.authResolve = selectResolve;
                  socket.write(resp(['SELECT', String(db)]));
                });
              }
            })
            .then(() => done(true))
            .catch(() => done(false));
        } else {
          done(true);
        }
      });
      socket.once('error', () => {
        if (!settled) done(false);
        this.connected = false;
      });
      socket.on('data', (chunk: string | Buffer) => this.feed(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk));
      socket.on('close', () => {
        this.connected = false;
        this.socket = null;
        if (this.wasLive) {
          this.wasLive = false;
          this.notifyLive(false);
        }
        this.scheduleRetry();
      });
      socket.on('error', () => {
        this.connected = false;
      });
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      void this.tryConnect();
    }, 5000);
  }

  private liveListeners: ((live: boolean) => void)[] = [];

  onLiveChange(cb: (live: boolean) => void): void {
    this.liveListeners.push(cb);
  }

  private notifyLive(live: boolean): void {
    for (const cb of this.liveListeners) cb(live);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async command(...args: string[]): Promise<string | null> {
    if (!this.connected || !this.socket) return null;
    return new Promise((resolve) => {
      // every wait is bounded so a lost connection can never hang a caller
      const timer = setTimeout(() => resolve(''), 3000);
      this.pending.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: () => {
          clearTimeout(timer);
          resolve('');
        },
      });
      this.socket?.write(resp(args));
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.command('PUBLISH', channel, message);
  }

  async subscribe(channel: string, cb: (channel: string, message: string) => void): Promise<void> {
    if (!this.subscribers.includes(cb)) this.subscribers.push(cb);
    if (!this.subSocket) {
      const { host, port, username, password } = this.parseUrl();
      const socket = net.createConnection({ host, port });
      await new Promise<void>((resolve) => {
        socket.once('connect', () => resolve());
        socket.once('error', () => resolve());
      });
      if (password) {
        await new Promise<void>((resolve) => {
          let authed = false;
          socket.once('data', () => {
            if (!authed) {
              authed = true;
              resolve();
            }
          });
          socket.write(username ? resp(['AUTH', username, password]) : resp(['AUTH', password]));
          setTimeout(() => {
            if (!authed) {
              authed = true;
              resolve();
            }
          }, 1000);
        });
      }
      socket.on('data', (chunk: string | Buffer) => this.feedSub(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk));
      socket.on('close', () => {
        this.subSocket = null;
      });
      socket.on('error', () => {
        // retried with the main connection
      });
      this.subSocket = socket;
    }
    this.subSocket?.write(resp(['SUBSCRIBE', channel]));
  }

  private feed(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const line = this.buffer.indexOf('\r\n');
      if (line === -1) return;
      const head = this.buffer.subarray(0, line).toString('utf8');
      const kind = head[0];
      if (kind === '+' || kind === ':' || kind === '-') {
        this.buffer = this.buffer.subarray(line + 2);
        if (this.authResolve && (head === '+OK' || kind === '-')) {
          // the AUTH handshake reply
          const resolve = this.authResolve;
          this.authResolve = null;
          this.pendingAuth = null;
          resolve();
          continue;
        }
        const waiter = this.pending.shift();
        if (waiter) {
          if (kind === '-') waiter.reject(new Error(head.slice(1)));
          else waiter.resolve(head.slice(1));
        }
      } else if (kind === '$') {
        const len = Number(head.slice(1));
        if (len < 0) {
          this.buffer = this.buffer.subarray(line + 2);
          const waiter = this.pending.shift();
          waiter?.resolve('');
          continue;
        }
        if (this.buffer.length < line + 4 + len) return;
        const payload = this.buffer.subarray(line + 2, line + 2 + len).toString('utf8');
        this.buffer = this.buffer.subarray(line + 2 + len + 2);
        const waiter = this.pending.shift();
        waiter?.resolve(payload);
      } else if (kind === '*') {
        const count = Number(head.slice(1));
        const result = this.parseArray(line + 2, count);
        if (result === null) return;
        this.buffer = this.buffer.subarray(result.end);
        const waiter = this.pending.shift();
        waiter?.resolve(result.value.join(' '));
      } else {
        // unknown line; drop
        this.buffer = this.buffer.subarray(line + 2);
      }
    }
  }

  private parseArray(start: number, count: number): { value: string[]; end: number } | null {
    let cursor = start;
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
      const line = this.buffer.indexOf('\r\n', cursor);
      if (line === -1) return null;
      const head = this.buffer.subarray(cursor, line).toString('utf8');
      if (head[0] === '$') {
        const len = Number(head.slice(1));
        if (this.buffer.length < line + 4 + len) return null;
        values.push(this.buffer.subarray(line + 2, line + 2 + len).toString('utf8'));
        cursor = line + 2 + len + 2;
      } else {
        values.push(head.slice(1));
        cursor = line + 2;
      }
    }
    return { value: values, end: cursor };
  }

  private subBuffer: Buffer = Buffer.alloc(0);

  private feedSub(chunk: Buffer): void {
    this.subBuffer = this.subBuffer.length ? Buffer.concat([this.subBuffer, chunk]) : chunk;
    for (;;) {
      const parsed = this.parseSubMessage();
      if (!parsed) return;
      if (parsed.kind === 'message') {
        for (const cb of this.subscribers) cb(parsed.channel!, parsed.message!);
      }
    }
  }

  private parseSubMessage(): { kind: string; channel?: string; message?: string } | null {
    const line = this.subBuffer.indexOf('\r\n');
    if (line === -1) return null;
    const head = this.subBuffer.subarray(0, line).toString('utf8');
    if (head[0] !== '*') {
      this.subBuffer = this.subBuffer.subarray(line + 2);
      return { kind: head.slice(1) };
    }
    const count = Number(head.slice(1));
    const result = this.parseArraySub(line + 2, count);
    if (!result) return null;
    this.subBuffer = this.subBuffer.subarray(result.end);
    const values = result.value;
    if (values.length >= 3 && values[0] === 'message') {
      return { kind: 'message', channel: values[1], message: values[2] };
    }
    return { kind: values[0] ?? 'other' };
  }

  private parseArraySub(start: number, count: number): { value: string[]; end: number } | null {
    let cursor = start;
    const values: string[] = [];
    for (let i = 0; i < count; i++) {
      const line = this.subBuffer.indexOf('\r\n', cursor);
      if (line === -1) return null;
      const head = this.subBuffer.subarray(cursor, line).toString('utf8');
      if (head[0] === '$') {
        const len = Number(head.slice(1));
        if (this.subBuffer.length < line + 4 + len) return null;
        values.push(this.subBuffer.subarray(line + 2, line + 2 + len).toString('utf8'));
        cursor = line + 2 + len + 2;
      } else {
        values.push(head.slice(1));
        cursor = line + 2;
      }
    }
    return { value: values, end: cursor };
  }

  async close(): Promise<void> {
    this.socket?.end();
    this.subSocket?.end();
    this.connected = false;
  }
}

function resp(args: string[]): string {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const b = Buffer.from(a, 'utf8');
    out += `$${b.length}\r\n${a}\r\n`;
  }
  return out;
}

export const VALKEY = new Valkey();
