// Postgres wire-protocol client (v3): startup, cleartext and MD5 authentication,
// extended query protocol with typed parameters, and simple query for DDL.
// Implemented in this repository so the app ships without a driver dependency.
import net from 'node:net';
import { createHash, createHmac } from 'node:crypto';

export interface QueryResult<R extends Record<string, unknown> = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
}

interface ParsedUrl {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parseUrl(url: string): ParsedUrl {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database: (parsed.pathname || '/').replace(/^\//, ''),
  };
}

const TYPE_TEXT = 25;

interface Message {
  kind: string;
  body: Buffer;
}

export class Client {
  private socket: net.Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private pending: Message[] = [];
  private waiters: Array<{ resolve: (m: Message) => void; reject: (e: Error) => void }> = [];
  private nextBindId = 0;
  private params: ParsedUrl;
  private ended = false;

  constructor(databaseUrl: string) {
    this.params = parseUrl(databaseUrl);
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(this.params.port, this.params.host);
      socket.setNoDelay(true);
      socket.once('connect', () => resolve());
      socket.once('error', reject);
      socket.on('data', (chunk: Buffer) => this.onData(chunk));
      socket.on('close', () => this.failAll(new Error('connection closed')));
      socket.on('error', () => this.failAll(new Error('connection error')));
      this.socket = socket;
    });
    await this.startup();
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    for (;;) {
      if (this.buffer.length < 5) return;
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < 1 + length) return;
      const kind = String.fromCharCode(this.buffer[0]);
      const body = this.buffer.subarray(5, 1 + length);
      this.buffer = this.buffer.subarray(1 + length);
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve({ kind, body });
      else this.pending.push({ kind, body });
    }
  }

  private read(): Promise<Message> {
    const buffered = this.pending.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise<Message>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private async startup(): Promise<void> {
    const parts: Buffer[] = [int32(196608)];
    for (const [key, value] of Object.entries({ user: this.params.user, database: this.params.database })) {
      parts.push(cstr(key), cstr(value));
    }
    parts.push(cstr(''));
    const body = Buffer.concat(parts);
    this.socket!.write(Buffer.concat([int32(body.length + 4), body]));

    const auth = await this.read();
    if (auth.kind === 'E') throw new Error(parseError(auth.body));
    if (auth.kind !== 'R') throw new Error('unexpected startup response');
    const authType = auth.body.readInt32BE(0);
    if (authType === 0) {
      await this.finishStartup();
      return;
    }
    if (authType === 3) {
      this.writeMessage('p', cstr(this.params.password));
    } else if (authType === 5) {
      const salt = auth.body.subarray(4, 8);
      const inner = md5Hex(`${this.params.user}:${this.params.password}`);
      const outer = md5Hex(Buffer.concat([Buffer.from(inner), salt]));
      this.writeMessage('p', cstr(`md5${outer}`));
    } else if (authType === 10) {
      const mechanisms: string[] = [];
      let pos = 4;
      while (pos < auth.body.length && auth.body[pos] !== 0) {
        const end = auth.body.indexOf(0, pos);
        mechanisms.push(auth.body.toString('utf8', pos, end));
        pos = end + 1;
      }
      const chosen = mechanisms.find((m) => m === 'SCRAM-SHA-256' || m.startsWith('SCRAM-SHA-256'));
      if (!chosen) throw new Error('no supported SASL mechanism');
      await this.scramHandshake(chosen);
      const verify = await this.read();
      if (verify.kind === 'E') throw new Error(parseError(verify.body));
      if (verify.kind !== 'R' || verify.body.readInt32BE(0) !== 12) {
        throw new Error('unexpected SCRAM verification');
      }
      const done = await this.read();
      if (done.kind === 'E') throw new Error(parseError(done.body));
      if (done.kind !== 'R' || done.body.readInt32BE(0) !== 0) {
        throw new Error('authentication failed');
      }
    } else {
      throw new Error(`unsupported auth type ${authType}`);
    }
    if (authType !== 10) {
      const reply = await this.read();
      if (reply.kind === 'E') throw new Error(parseError(reply.body));
      if (reply.kind !== 'R' || reply.body.readInt32BE(0) !== 0) {
        throw new Error('authentication failed');
      }
    }
    await this.finishStartup();
  }

  private async scramHandshake(mechanism: string): Promise<void> {
    const nonce = createHash('sha256').update('').digest('hex').slice(0, 0) + randomTokenBase64(24);
    const clientFirstBare = `n=,r=${nonce}`;
    const clientFirstMessage = `n,,${clientFirstBare}`;
    this.writeMessage('p', Buffer.concat([cstr(mechanism), int32(clientFirstMessage.length), Buffer.from(clientFirstMessage, 'utf8')]));
    const cont = await this.read();
    if (cont.kind !== 'R' || cont.body.readInt32BE(0) !== 11) {
      throw new Error('unexpected SASL continuation');
    }
    const bodyText = cont.body.subarray(4).toString('utf8');
    const fields = new Map<string, string>();
    for (const part of bodyText.split(',')) {
      const eq = part.indexOf('=');
      if (eq > 0) fields.set(part.slice(0, eq), part.slice(eq + 1));
    }
    const serverNonce = fields.get('r') ?? '';
    const salt = Buffer.from(fields.get('s') ?? '', 'base64');
    const iterations = Number(fields.get('i') ?? '4096');
    if (!serverNonce.startsWith(nonce)) throw new Error('SCRAM nonce mismatch');

    const saltedPassword = hi(this.params.password, salt, iterations);
    const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
    const storedKey = createHash('sha256').update(clientKey).digest();
    const clientFinalBare = `c=biws,r=${serverNonce}`;
    const authMessage = `${clientFirstBare},${bodyText},${clientFinalBare}`;
    const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
    const clientProof = Buffer.alloc(clientKey.length);
    for (let i = 0; i < clientKey.length; i++) clientProof[i] = clientKey[i] ^ clientSignature[i];
    const clientFinal = `${clientFinalBare},p=${clientProof.toString('base64')}`;
    this.writeMessage('p', Buffer.from(clientFinal, 'utf8'));
  }

  private async finishStartup(): Promise<void> {
    for (;;) {
      const msg = await this.read();
      if (msg.kind === 'Z') return;
      if (msg.kind === 'E') throw new Error(parseError(msg.body));
    }
  }

  private writeMessage(kind: string, body: Buffer): void {
    const message = Buffer.concat([Buffer.from(kind, 'ascii'), int32(body.length + 4), body]);
    this.socket!.write(message);
    if (process.env.HW_TRACE === '1') console.error('>>', kind, body.length, JSON.stringify(body.toString('latin1')));
  }

  private async simpleQuery(text: string): Promise<QueryResult> {
    this.writeMessage('Q', cstr(text));
    return this.collect();
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
    if (this.ended) throw new Error('client has ended');
    if (values === undefined || values.length === 0) return this.simpleQuery(text) as Promise<QueryResult<R>>;
    const name = `s${this.nextBindId++}`;
    const parse = Buffer.concat([cstr(name), cstr(text), int16(0)]);
    const bindHead: Buffer[] = [cstr(name), cstr(name), int16(0), int16(values.length)];
    const bindValues: Buffer[] = [];
    for (const value of values) {
      if (value === null || value === undefined) {
        bindValues.push(int32(-1));
      } else {
        const encoded = Buffer.from(String(value), 'utf8');
        bindValues.push(int32(encoded.length), encoded);
      }
    }
    const bind = Buffer.concat([...bindHead, ...bindValues, int16(0)]);
    this.writeMessage('P', parse);
    this.writeMessage('B', bind);
    this.writeMessage('D', Buffer.concat([Buffer.from('P'), cstr(name)]));
    this.writeMessage('E', Buffer.concat([cstr(name), int32(0)]));
    this.writeMessage('S', Buffer.alloc(0));
    const collected = await this.collect();
    return collected as QueryResult<R>;
  }

  private async collect(): Promise<QueryResult> {
    const rows: Record<string, unknown>[] = [];
    let rowCount: number | null = null;
    let columns: string[] = [];
    for (;;) {
      const msg = await this.read();
      if (msg.kind === 'T') {
        columns = parseRowDescription(msg.body);
      } else if (msg.kind === 'D') {
        rows.push(parseDataRow(msg.body, columns));
      } else if (msg.kind === 'E') {
        throw new PgError(parseError(msg.body));
      } else if (msg.kind === 'C') {
        const text = msg.body.subarray(0, msg.body.length - 1).toString('utf8');
        rowCount = Number(/(\d+)/.exec(text)?.[1] ?? 0);
      } else if (msg.kind === 'Z') {
        return { rows: rows as never, rowCount };
      }
    }
  }

  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.socket?.end();
    this.socket = null;
    this.failAll(new Error('client ended'));
  }

  release(): void {
    // Managed by the pool.
  }

  private failAll(error: Error): void {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
    this.pending.length = 0;
  }
}

export class PgError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function int16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n, 0);
  return b;
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function cstr(text: string): Buffer {
  return Buffer.concat([Buffer.from(text, 'utf8'), Buffer.alloc(1)]);
}

function parseRowDescription(body: Buffer): string[] {
  const count = body.readInt16BE(0);
  const names: string[] = [];
  let pos = 2;
  for (let i = 0; i < count; i++) {
    const end = body.indexOf(0, pos);
    names.push(body.toString('utf8', pos, end));
    pos = end + 1 + 18;
  }
  return names;
}

function parseDataRow(body: Buffer, columns: string[]): Record<string, unknown> {
  const count = body.readInt16BE(0);
  const row: Record<string, unknown> = {};
  let pos = 2;
  for (let i = 0; i < count; i++) {
    const len = body.readInt32BE(pos);
    pos += 4;
    const name = columns[i] ?? `col${i}`;
    if (len < 0) row[name] = null;
    else {
      row[name] = body.toString('utf8', pos, pos + len);
      pos += len;
    }
  }
  return row;
}

function parseError(body: Buffer): string {
  let pos = 1;
  const fields: Record<string, string> = {};
  while (pos < body.length && body[pos] !== 0) {
    const code = String.fromCharCode(body[pos]);
    const end = body.indexOf(0, pos + 1);
    fields[code] = body.toString('utf8', pos + 1, end);
    pos = end + 1;
  }
  return fields.M ?? 'database error';
}

const md5Hex = (input: string | Buffer): string => createHash('md5').update(input).digest('hex');

function randomTokenBase64(bytes: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const raw = createHash('sha256').update(String(Date.now() + Math.random())).digest();
  let out = '';
  for (let i = 0; i < bytes; i++) out += chars[raw[i] % chars.length];
  return out;
}

// SCRAM-SHA-256 Hi function (RFC 5802): pbkdf2 with HMAC-SHA-256.
function hi(password: string, salt: Buffer, iterations: number): Buffer {
  const passwordBytes = Buffer.from(password, 'utf8');
  let ui = createHmac('sha256', passwordBytes).update(Buffer.concat([salt, int32(1)])).digest();
  let result = Buffer.from(ui);
  for (let i = 1; i < iterations; i++) {
    ui = createHmac('sha256', passwordBytes).update(ui).digest();
    for (let j = 0; j < result.length; j++) result[j] = result[j] ^ ui[j];
  }
  return result;
}
