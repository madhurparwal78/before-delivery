import net from 'node:net';
import { config } from './config.js';

export type Reply = string | number | null | Reply[];

export class LockStoreDown extends Error {}

interface Pending {
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
}

/** A small RESP client: one connection, pipelined commands, self-reconnecting. */
class ValkeyClient {
  private socket: net.Socket | null = null;

  private connecting: Promise<void> | null = null;

  private buffer = Buffer.alloc(0);

  private readonly pending: Pending[] = [];

  private healthy = false;

  get up(): boolean {
    return this.healthy;
  }

  private target(): { host: string; port: number; username: string; password: string; db: string } {
    const url = new URL(config.valkeyUrl || 'redis://127.0.0.1:6379/0');
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      db: url.pathname.replace('/', '') || '0',
    };
  }

  private async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    const target = this.target();
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: target.host, port: target.port });
      socket.setNoDelay(true);
      const fail = (error: Error): void => {
        this.teardown(error);
        reject(new LockStoreDown(error.message));
      };
      socket.once('error', fail);
      socket.once('connect', () => {
        socket.removeListener('error', fail);
        socket.on('error', (error) => this.teardown(error));
        socket.on('close', () => this.teardown(new LockStoreDown('connection closed')));
        socket.on('data', (chunk) => this.onData(chunk));
        this.socket = socket;
        void (async () => {
          try {
            if (target.password !== '') {
              await this.send(
                target.username === ''
                  ? ['AUTH', target.password]
                  : ['AUTH', target.username, target.password],
              );
            }
            if (target.db !== '0') await this.send(['SELECT', target.db]);
            this.healthy = true;
            resolve();
          } catch (error) {
            fail(error as Error);
          }
        })();
      });
    }).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private teardown(error: Error): void {
    this.healthy = false;
    const socket = this.socket;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    if (socket) socket.destroy();
    while (this.pending.length > 0) {
      const waiting = this.pending.shift();
      waiting?.reject(new LockStoreDown(error.message));
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const parsed = parseReply(this.buffer, 0);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.offset);
      const waiting = this.pending.shift();
      if (!waiting) continue;
      if (parsed.error) waiting.reject(new Error(parsed.error));
      else waiting.resolve(parsed.value);
    }
  }

  private send(parts: readonly string[]): Promise<Reply> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new LockStoreDown('not connected'));
    const payload = [`*${parts.length}\r\n`];
    for (const part of parts) payload.push(`$${Buffer.byteLength(part)}\r\n${part}\r\n`);
    return new Promise<Reply>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      socket.write(payload.join(''), (error) => {
        if (error) this.teardown(error);
      });
    });
  }

  async command(...parts: (string | number)[]): Promise<Reply> {
    try {
      await this.connect();
      return await this.send(parts.map(String));
    } catch (error) {
      if (error instanceof LockStoreDown) throw error;
      throw new LockStoreDown((error as Error).message);
    }
  }

  async ping(): Promise<boolean> {
    try {
      const reply = await this.command('PING');
      return reply === 'PONG';
    } catch {
      return false;
    }
  }
}

interface ParsedReply {
  value: Reply;
  offset: number;
  error?: string;
}

function parseReply(buffer: Buffer, start: number): ParsedReply | null {
  if (start >= buffer.length) return null;
  const type = buffer[start];
  const lineEnd = buffer.indexOf('\r\n', start);
  if (lineEnd < 0) return null;
  const line = buffer.toString('utf8', start + 1, lineEnd);
  const after = lineEnd + 2;
  if (type === 0x2b) return { value: line, offset: after };
  if (type === 0x2d) return { value: null, offset: after, error: line };
  if (type === 0x3a) return { value: Number(line), offset: after };
  if (type === 0x24) {
    const length = Number(line);
    if (length === -1) return { value: null, offset: after };
    if (buffer.length < after + length + 2) return null;
    return { value: buffer.toString('utf8', after, after + length), offset: after + length + 2 };
  }
  if (type === 0x2a) {
    const count = Number(line);
    if (count === -1) return { value: null, offset: after };
    const items: Reply[] = [];
    let offset = after;
    for (let index = 0; index < count; index += 1) {
      const item = parseReply(buffer, offset);
      if (!item) return null;
      items.push(item.error ? null : item.value);
      offset = item.offset;
    }
    return { value: items, offset };
  }
  return { value: null, offset: after, error: `unsupported reply ${String(type)}` };
}

export const valkey = new ValkeyClient();
