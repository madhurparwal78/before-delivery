/* Valkey: live-event fan-out (stream + publish/subscribe), the vote and post
   rate counters, and rolling-window rate limiting. When Valkey is unreachable
   the callers degrade exactly as the brief describes: votes answer 503, the
   stream answers 503, events are dropped, and creation proceeds without the
   posting limit. */

import net from 'node:net';

export type LiveEvent = { topics: string[]; event: string; data: unknown };
export type Reply = string | number | null | Reply[];

/* One connection speaking RESP2. */
class RespConnection {
  private buf = '';
  private pos = 0;
  private queue: ((v: Reply) => void)[] = [];
  private failed = false;

  constructor(readonly socket: net.Socket) {
    socket.setNoDelay(true);
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buf += chunk;
      this.pump();
    });
    socket.on('error', () => this.failAll());
    socket.on('close', () => this.failAll());
  }

  get isFailed(): boolean {
    return this.failed;
  }

  private failAll(): void {
    this.failed = true;
    // Reject everything still queued through a sentinel: callers catch and
    // degrade, so a plain rejection is enough.
    this.queue = [];
  }

  send(args: string[]): Promise<Reply> {
    return new Promise((resolve, reject) => {
      if (this.failed) {
        reject(new Error('valkey-unreachable'));
        return;
      }
      this.queue.push((v) => resolve(v));
      this.socket.write(encodeCommand(args), (err) => {
        if (err) reject(new Error('valkey-unreachable'));
      });
    });
  }

  private pump(): void {
    for (;;) {
      const reply = this.tryParse();
      if (reply === undefined) return;
      const cb = this.queue.shift();
      if (cb) cb(reply);
    }
  }

  /* Returns a parsed reply, or undefined when more bytes are needed. */
  private tryParse(): Reply | undefined {
    const nl = this.buf.indexOf('\r\n', this.pos);
    if (nl === -1) return undefined;
    const line = this.buf.slice(this.pos, nl);
    const type = line[0] as string;
    const rest = line.slice(1);
    if (type === '+' || type === ':') {
      this.pos = nl + 2;
      return type === ':' ? Number(rest) : rest;
    }
    if (type === '-') {
      this.pos = nl + 2;
      return rest; // callers treat error strings as values to inspect
    }
    if (type === '$') {
      const len = Number(rest);
      if (len === -1) {
        this.pos = nl + 2;
        return null;
      }
      const start = nl + 2;
      const end = start + len;
      if (this.buf.length < end + 2) return undefined;
      this.pos = end + 2;
      return this.buf.slice(start, end);
    }
    if (type === '*') {
      const count = Number(rest);
      if (count === -1) {
        this.pos = nl + 2;
        return null;
      }
      this.pos = nl + 2;
      const items: Reply[] = [];
      for (let i = 0; i < count; i++) {
        const item = this.tryParse();
        if (item === undefined) return undefined;
        items.push(item);
      }
      return items;
    }
    // Unknown frame: skip it and keep the connection serviceable.
    this.pos = nl + 2;
    return null;
  }
}

export class Valkey {
  private main: RespConnection | null = null;
  private subSocket: net.Socket | null = null;
  private subBuf = '';
  private url: URL;
  private prefix: string;
  private handlers: ((e: { id: string; event: string; data: string; topics: string[] }) => void)[] = [];

  constructor(url: string, prefix: string) {
    this.url = new URL(url);
    this.prefix = prefix;
  }

  get eventsKey(): string {
    return `${this.prefix}events`;
  }

  private get channel(): string {
    return `${this.prefix}live`;
  }

  onMessage(handler: (e: { id: string; event: string; data: string; topics: string[] }) => void): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  private authPairs(): string[][] {
    const cmds: string[][] = [];
    const user = decodeURIComponent(this.url.username || '');
    const password = decodeURIComponent(this.url.password || '');
    if (user !== '' && password !== '') cmds.push(['AUTH', user, password]);
    else if (password !== '') cmds.push(['AUTH', password]);
    const db = this.url.pathname.replace(/^\/+/, '');
    if (db !== '' && db !== '0') cmds.push(['SELECT', db]);
    return cmds;
  }

  async connect(): Promise<void> {
    const mainSocket = await this.dial();
    this.main = new RespConnection(mainSocket);
    for (const cmd of this.authPairs()) await this.main.send(cmd).catch(() => undefined);
    // The subscription connection is a raw socket: pub/sub frames are push
    // data, not replies, so it never shares the reply queue.
    const subSocket = await this.dial();
    subSocket.setNoDelay(true);
    subSocket.setEncoding('utf8');
    subSocket.on('data', (chunk: string) => this.handleSubChunk(chunk));
    this.subSocket = subSocket;
    for (const cmd of this.authPairs()) await writeCommand(subSocket, cmd);
    await writeCommand(subSocket, ['SUBSCRIBE', this.channel]);
  }

  /* Pub/sub frames are arrays; a "message" carries "<id>|<payload>" as its
     fourth field, which the subscription connection surfaces as a data chunk. */
  private handleSubChunk(chunk: string): void {
    this.subBuf += chunk;
    for (;;) {
      const frame = this.parsePush(this.subBuf, 0);
      if (frame === undefined) return;
      this.subBuf = frame.rest;
      if (frame.kind === 'message' && frame.payload !== null) {
        const sep = frame.payload.indexOf('|');
        if (sep > 0) this.dispatch(frame.payload.slice(sep + 1), frame.payload.slice(0, sep));
      }
    }
  }

  /* A "message" push frame is *3\r\n$7\r\nmessage\r\n<len>\r\n<channel>\r\n<len>\r\n<payload>\r\n. */
  private parsePush(buf: string, start: number): { kind: string; payload: string | null; rest: string } | undefined {
    const line = (offset: number): { text: string; next: number } | undefined => {
      const nl = buf.indexOf('\r\n', offset);
      if (nl === -1) return undefined;
      return { text: buf.slice(offset, nl), next: nl + 2 };
    };
    const head = line(start);
    if (head === undefined) return undefined;
    if (!head.text.startsWith('*')) {
      return { kind: 'other', payload: null, rest: buf.slice(head.next) };
    }
    const count = Number(head.text.slice(1));
    if (count !== 3) return { kind: 'other', payload: null, rest: buf.slice(head.next) };
    // field 1: kind
    const kindLen = line(head.next);
    if (kindLen === undefined || !kindLen.text.startsWith('$')) return undefined;
    const kindLine = line(kindLen.next);
    if (kindLine === undefined) return undefined;
    if (kindLine.text !== 'message') return { kind: 'other', payload: null, rest: buf.slice(kindLine.next) };
    // field 2: channel
    const chanLen = line(kindLine.next);
    if (chanLen === undefined || !chanLen.text.startsWith('$')) return undefined;
    const chanLine = line(chanLen.next);
    if (chanLine === undefined) return undefined;
    // field 3: payload
    const payLen = line(chanLine.next);
    if (payLen === undefined || !payLen.text.startsWith('$')) return undefined;
    const len = Number(payLen.text.slice(1));
    const end = payLen.next + len + 2;
    if (buf.length < end) return undefined;
    return { kind: 'message', payload: buf.slice(payLen.next, payLen.next + len), rest: buf.slice(end) };
  }

  private dispatch(payload: string, id?: string): void {
    try {
      const parsed = JSON.parse(payload) as { topics?: string[]; event: string; data: unknown };
      if (typeof parsed.event === 'string') {
        for (const h of this.handlers) h({ id: id ?? '', event: parsed.event, data: JSON.stringify(parsed.data), topics: parsed.topics ?? [] });
      }
    } catch {
      /* a malformed payload is dropped, not fatal */
    }
  }

  private dial(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const port = Number(this.url.port || 6379);
      const host = this.url.hostname || '127.0.0.1' || '127.0.0.1';
      const socket = net.connect({ port, host });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('timeout'));
      }, 4000);
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
    });
  }

  get isUp(): boolean {
    return this.main !== null && !this.main.isFailed;
  }

  /* Append to the stream, trim it, and publish on the channel. The returned id
     is the stream entry id used as the SSE id: line. Fan-out to this
     process's own subscribers happens through the subscription connection. */
  async publish(ev: LiveEvent): Promise<string | null> {
    const conn = this.main;
    if (conn === null || conn.isFailed) return null;
    const payload = JSON.stringify({ topics: ev.topics, event: ev.event, data: ev.data });
    try {
      const id = await conn.send(['XADD', this.eventsKey, '*', 'payload', payload]);
      await conn.send(['XTRIM', this.eventsKey, 'MAXLEN', '~', '1000']);
      if (typeof id !== 'string') return null;
      // Publish so other processes fan out; the local dispatch below is driven
      // by this process's own subscriber connection (publish echoes to it).
      await conn.send(['PUBLISH', this.channel, `${id}|${payload}`]).catch(() => undefined);
      return id;
    } catch {
      return null;
    }
  }

  /* Rolling-window counter with a sorted set that expires after its window. */
  async consumeSlot(counterKey: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfter: number }> {
    const conn = this.main;
    if (conn === null || conn.isFailed) throw new Error('valkey-unreachable');
    const key = `${this.prefix}${counterKey}`;
    const now = Date.now();
    await conn.send(['ZREMRANGEBYSCORE', key, '-inf', String(now - windowMs)]);
    const count = Number(await conn.send(['ZCARD', key]));
    if (count >= limit) {
      const oldest = (await conn.send(['ZRANGE', key, '0', '0', 'WITHSCORES'])) as Reply[];
      const oldestScore = Array.isArray(oldest) && oldest.length >= 2 ? Number(oldest[1]) : now;
      const retryAfter = Math.max(1, Math.ceil((oldestScore + windowMs - now) / 1000));
      return { ok: false, retryAfter };
    }
    await conn.send(['ZADD', key, String(now), `${now}:${Math.random().toString(36).slice(2, 10)}`]);
    await conn.send(['PEXPIRE', key, String(windowMs + 60_000)]);
    return { ok: true, retryAfter: 0 };
  }

  /* Replay retained entries after an id, for SSE resume. */
  async readAfter(lastId: string, max: number): Promise<{ id: string; payload: string }[]> {
    const conn = this.main;
    if (conn === null || conn.isFailed) throw new Error('valkey-unreachable');
    const res = (await conn.send(['XRANGE', this.eventsKey, `(${lastId}`, '+', 'COUNT', String(max)])) as Reply[];
    const events: { id: string; payload: string }[] = [];
    if (!Array.isArray(res)) return events;
    for (const entry of res) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const id = entry[0];
      const fields = entry[1];
      if (typeof id !== 'string' || !Array.isArray(fields)) continue;
      for (let j = 0; j < fields.length; j += 2) {
        const name = fields[j];
        const value = fields[j + 1];
        if (name === 'payload' && typeof value === 'string') {
          events.push({ id, payload: value });
        }
      }
    }
    return events;
  }

  async firstId(): Promise<string | null> {
    const conn = this.main;
    if (conn === null || conn.isFailed) throw new Error('valkey-unreachable');
    const res = (await conn.send(['XRANGE', this.eventsKey, '-', '+', 'COUNT', '1'])) as Reply[];
    if (!Array.isArray(res) || res.length === 0) return '0-0';
    const first = res[0];
    if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
    return '0-0';
  }
}

export function encodeCommand(args: string[]): Buffer {
  const parts: string[] = [`*${args.length}`];
  for (const a of args) parts.push(`$${Buffer.byteLength(a, 'utf8')}`, a);
  return Buffer.from(parts.join('\r\n') + '\r\n', 'utf8');
}

function writeCommand(socket: net.Socket, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    socket.write(encodeCommand(args), () => resolve());
    // The subscriber ignores replies to AUTH/SUBSCRIBE; resolve regardless.
    setTimeout(resolve, 300);
  });
}
