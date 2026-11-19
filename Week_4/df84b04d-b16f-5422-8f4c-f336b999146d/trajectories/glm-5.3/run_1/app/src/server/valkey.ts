import { connect as netConnect } from 'node:net';

export interface XEntry {
  id: string;
  fields: { seq: string; change: string };
}

export interface RedisClient {
  isOpen: boolean;
  xadd(key: string, id: string, fields: Record<string, string>): Promise<void>;
  xtrim(key: string, count: number): Promise<void>;
  xrange(key: string, from: string, to: string, count: number): Promise<XEntry[]>;
  onClose(handler: () => void): void;
}

class RedisError extends Error {}

function toResp(args: (string | number)[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const value = String(arg);
    out += `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
  }
  return out;
}

export async function connect(url: string): Promise<RedisClient> {
  const parsed = new URL(url);
  const host = parsed.hostname || '127.0.0.1';
  const port = Number(parsed.port || 6379);
  const socket = netConnect({ host, port });
  socket.setNoDelay(true);
  socket.setTimeout(8000, () => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('error', (err) => reject(err));
  });
  socket.setTimeout(0);
  let buffer = Buffer.alloc(0);
  let closed = false;
  const closeHandlers: (() => void)[] = [];
  const pending: { resolve: (value: unknown) => void; reject: (err: Error) => void }[] = [];
  let username: string | null = null;
  let password: string | null = null;
  if (parsed.password) password = decodeURIComponent(parsed.password);
  if (parsed.username && parsed.username !== 'default') username = decodeURIComponent(parsed.username);

  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    tryParse();
  });
  socket.on('error', () => {
    closed = true;
    for (const p of pending.splice(0)) p.reject(new RedisError('connection error'));
    for (const handler of closeHandlers) handler();
  });
  socket.on('close', () => {
    closed = true;
    for (const p of pending.splice(0)) p.reject(new RedisError('connection closed'));
    for (const handler of closeHandlers) handler();
  });

  interface RespValue {
    type: 'simple' | 'error' | 'int' | 'bulk' | 'array' | 'null';
    value: string | number | null | RespValue[];
  }

  let pos = 0;

  function readValue(): RespValue | null {
    if (pos >= buffer.length) return null;
    const byte = buffer[pos];
    if (byte === undefined) return null;
    const type = String.fromCharCode(byte);
    const lineEnd = buffer.indexOf('\r\n', pos);
    if (lineEnd === -1) return null;
    const line = buffer.subarray(pos + 1, lineEnd).toString('utf8');
    if (type === '+' || type === '-' || type === ':') {
      pos = lineEnd + 2;
      return {
        type: type === '+' ? 'simple' : type === '-' ? 'error' : 'int',
        value: type === ':' ? Number(line) : line,
      };
    }
    if (type === '$') {
      const length = Number(line);
      if (length === -1) {
        pos = lineEnd + 2;
        return { type: 'null', value: null };
      }
      const start = lineEnd + 2;
      const end = start + length;
      if (buffer.length < end + 2) return null;
      const value = buffer.subarray(start, end).toString('utf8');
      pos = end + 2;
      return { type: 'bulk', value };
    }
    if (type === '*') {
      const count = Number(line);
      pos = lineEnd + 2;
      const values: RespValue[] = [];
      for (let i = 0; i < count; i += 1) {
        const v = readValue();
        if (v === null) {
          return null;
        }
        values.push(v);
      }
      return { type: 'array', value: values };
    }
    throw new RedisError('unknown resp type ' + type);
  }

  function tryParse(): void {
    for (;;) {
      pos = 0;
      const before = pos;
      let value: RespValue | null = null;
      try {
        value = readValue();
      } catch (err) {
        const pendingHead = pending.shift();
        if (pendingHead) pendingHead.reject(err as Error);
        buffer = Buffer.alloc(0);
        return;
      }
      if (value === null) {
        pos = before;
        return;
      }
      buffer = buffer.subarray(pos);
      pos = 0;
      const waiter = pending.shift();
      if (waiter) waiter.resolve(value);
    }
  }

  function command(args: (string | number)[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(new RedisError('closed'));
        return;
      }
      pending.push({ resolve, reject });
      socket.write(toResp(args));
    });
  }

  if (password && username) {
    await command(['AUTH', username, password]);
  } else if (password) {
    await command(['AUTH', password]);
  }

  return {
    get isOpen() {
      return !closed;
    },
    async xadd(key, id, fields) {
      const args: (string | number)[] = ['XADD', key, id];
      for (const [k, v] of Object.entries(fields)) {
        args.push(k, v);
      }
      await command(args);
    },
    async xtrim(key, count) {
      await command(['XTRIM', key, 'MAXLEN', '~', count]);
    },
    async xrange(key, from, to, count) {
      const result = (await command(['XRANGE', key, from, to, 'COUNT', count])) as {
        type: string;
        value: RespValue[];
      };
      const entries: XEntry[] = [];
      const outer = result.value as unknown as RespValue[];
      for (const entry of outer) {
        const pair = entry.value as unknown as RespValue[];
        const idValue = pair[0] as RespValue;
        const fieldsValue = pair[1] as RespValue;
        const flat = fieldsValue.value as unknown as RespValue[];
        const map: Record<string, string> = {};
        for (let i = 0; i < flat.length; i += 2) {
          const k = flat[i] as RespValue;
          const v = flat[i + 1] as RespValue;
          map[String(k.value)] = String(v.value);
        }
        entries.push({ id: String(idValue.value), fields: { seq: map.seq ?? '', change: map.change ?? '' } });
      }
      return entries;
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
  };
}
