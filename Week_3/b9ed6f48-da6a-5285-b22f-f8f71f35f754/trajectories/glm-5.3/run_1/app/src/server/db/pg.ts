import net from 'node:net';
import crypto from 'node:crypto';

/**
 * Minimal PostgreSQL wire-protocol client (protocol 3.0, SCRAM-SHA-256 auth).
 * Supports parameterized queries, transactions and session advisory locks.
 */

export type Value = string | number | boolean | null | Date | Uint8Array | string[];
export type Row = Record<string, unknown>;

export class DatabaseError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function encodeValue(v: Value): Buffer | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Buffer.from(v.toISOString());
  if (typeof v === 'number') return Buffer.from(String(v));
  if (typeof v === 'boolean') return Buffer.from(v ? 't' : 'f');
  if (Buffer.isBuffer(v)) return v;
  if (Array.isArray(v)) {
    // Postgres array literal syntax: {a,b,"c d"}
    const parts = v.map((item) => {
      const encoded = encodeValue(item);
      if (encoded === null) return 'NULL';
      const text = encoded.toString('utf8');
      if (text.includes(',') || text.includes('"') || text.includes('\\') || text.includes('{') || text.includes('}')) {
        return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      }
      return text;
    });
    return Buffer.from(`{${parts.join(',')}}`);
  }
  if (v instanceof Uint8Array) return Buffer.from(v);
  return Buffer.from(String(v));
}

export interface ConnectionParams {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function parseDatabaseUrl(url: string): ConnectionParams {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 5432,
    database: u.pathname.replace(/^\//, ''),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

class ProtocolError extends Error {}

class ScramClient {
  private clientNonce = crypto.randomBytes(18).toString('base64');
  private clientFirstMessageBare = `n=,r=${this.clientNonce}`;

  first(): string {
    return `n,,${this.clientFirstMessageBare}`;
  }

  respond(serverFirst: string, password: string): string {
    const parts = Object.fromEntries(serverFirst.split(',').map((p) => [p[0], p.slice(2)]));
    const serverNonce = parts['r'] ?? '';
    if (!serverNonce.startsWith(this.clientNonce)) throw new ProtocolError('bad server nonce');
    const salt = Buffer.from(parts['s'] ?? '', 'base64');
    const iterations = Number(parts['i'] ?? 4096);
    const salted = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    const clientKey = crypto.createHmac('sha256', salted).update('Client Key').digest();
    const storedKey = crypto.createHash('sha256').update(clientKey).digest();
    const authMessage = `${this.clientFirstMessageBare},${serverFirst},c=biws,r=${serverNonce}`;
    const clientSignature = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
    const proof = Buffer.from(clientKey.map((b, i) => b ^ clientSignature[i]!)).toString('base64');
    const serverKey = crypto.createHmac('sha256', salted).update('Server Key').digest();
    const expectedServerSig = crypto.createHmac('sha256', serverKey).update(authMessage).digest('base64');
    if (parts['v'] !== undefined) {
      // verification happens on the final message instead
    }
    void expectedServerSig;
    return `c=biws,r=${serverNonce},p=${proof}`;
  }

  verifyServer(serverFinal: string, password: string, serverFirstBare: string): void {
    const parts = Object.fromEntries(serverFinal.split(',').map((p) => [p[0], p.slice(2)]));
    const serverNonce = serverFirstBare.split(',').find((p) => p.startsWith('r='))?.slice(2) ?? '';
    const salt = Buffer.from(serverFirstBare.split(',').find((p) => p.startsWith('s='))?.slice(2) ?? '', 'base64');
    const iterations = Number(serverFirstBare.split(',').find((p) => p.startsWith('i='))?.slice(2) ?? 4096);
    const salted = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
    const serverKey = crypto.createHmac('sha256', salted).update('Server Key').digest();
    const authMessage = `${this.clientFirstMessageBare},${serverFirstBare},c=biws,r=${serverNonce}`;
    const expected = crypto.createHmac('sha256', serverKey).update(authMessage).digest('base64');
    if (parts['v'] !== expected) throw new ProtocolError('server signature mismatch');
  }
}

export interface QueryResult {
  rows: Row[];
  rowCount: number;
}

interface Waiter {
  resolve: (r: QueryResult) => void;
  reject: (e: Error) => void;
}

const INT = (v: string) => Number(v);
const BOOL = (v: string) => v === 't';
const JSON_PARSE = (v: string) => JSON.parse(v);
const IDENTITY = (v: string) => v;

const OID_PARSERS = new Map<number, (v: string) => unknown>([
  [16, BOOL],
  [20, INT],
  [21, INT],
  [23, INT],
  [26, INT],
  [700, Number],
  [701, Number],
  [114, JSON_PARSE],
  [3802, JSON_PARSE],
  [1082, IDENTITY],
  [1083, IDENTITY],
  [1114, IDENTITY],
  [1184, IDENTITY],
  [17, (v: string) => Buffer.from(v, 'base64')],
]);

export class PgConnection {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private ready = false;
  private queue: Array<{ sql: string; params: Value[]; waiter: Waiter }> = [];
  private current: { sql: string; params: Value[]; waiter: Waiter } | null = null;
  private rows: Row[] = [];
  private lastRowCount = 0;
  private names: string[] = [];
  private parsers: Array<((v: string) => unknown) | null> = [];
  private closed = false;

  constructor(private params: ConnectionParams) {}

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sock = net.createConnection({ host: this.params.host, port: this.params.port });
      this.socket = sock;
      let scram: ScramClient | null = null;
      let serverFirstBare = '';

      const fail = (err: Error) => {
        sock.destroy();
        reject(err);
      };

      const startup = () => {
        const params: Record<string, string> = {
          user: this.params.user,
          database: this.params.database,
          client_encoding: 'UTF8',
          DateStyle: 'ISO, MDY',
        };
        const body = Buffer.concat([
          Buffer.from([0x00, 0x03, 0x00, 0x00]),
          ...Object.entries(params).flatMap(([k, v]) => [Buffer.from(k), Buffer.from([0]), Buffer.from(v), Buffer.from([0])]),
          Buffer.from([0]),
        ]);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(body.length + 4, 0);
        sock.write(Buffer.concat([len, body]));
      };

      sock.once('error', reject);

      // SSLRequest: we accept the plain-connection answer 'N'.
      const sslReq = Buffer.alloc(8);
      sslReq.writeUInt32BE(8, 0);
      sslReq.writeUInt32BE(80877103, 4);
      sock.write(sslReq);

      // Phase 1: consume until ReadyForQuery after auth
      const onStartupData = (chunk: Buffer | string): void => {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
        for (;;) {
          const msg = this.takeMessage();
          if (!msg) return;
          if (msg.type === 'Z') {
            this.ready = true;
            sock.off('data', onStartupData);
            sock.off('error', reject);
            sock.on('error', () => this.markClosed());
            sock.on('close', () => this.markClosed());
            sock.on('data', (c: Buffer | string) => this.onData(Buffer.from(c)));
            resolve();
            // Parse anything that arrived in the same segment as the startup Z.
            this.onData(Buffer.alloc(0));
            return;
          }
          if (!handleAuthMessage(msg.type, msg.payload)) return;
        }
      };

      sock.once('data', (chunk: Buffer | string) => {
        // The SSL answer is a single byte; drop it and anything else in that segment.
        const rest = Buffer.from(chunk).subarray(1);
        if (chunk[0] === 0x4e) {
          this.buffer = rest;
          startup();
          sock.on('data', onStartupData);
        } else {
          fail(new ProtocolError('server requires TLS, which this client does not support'));
        }
      });

      const handleAuthMessage = (type: string, payload: Buffer): boolean => {
        if (type === 'R') {
          const code = payload.readInt32BE(0);
          if (code === 10) {
            scram = new ScramClient();
            const init = scram.first();
            const body = Buffer.concat([
              Buffer.from('SCRAM-SHA-256'),
              Buffer.from([0]),
              (() => {
                const len = Buffer.alloc(4);
                len.writeInt32BE(init.length, 0);
                return Buffer.concat([len, Buffer.from(init)]);
              })(),
            ]);
            const len = Buffer.alloc(4);
            len.writeInt32BE(body.length + 4, 0);
            sock.write(Buffer.concat([Buffer.from('p'), len, body]));
            return true;
          }
          if (code === 11) {
            serverFirstBare = payload.subarray(4).toString();
            const response = scram!.respond(serverFirstBare, this.params.password);
            const len = Buffer.alloc(4);
            len.writeInt32BE(response.length + 4, 0);
            sock.write(Buffer.concat([Buffer.from('p'), len, Buffer.from(response)]));
            return true;
          }
          if (code === 12) {
            scram!.verifyServer(payload.subarray(4).toString(), this.params.password, serverFirstBare);
            return true;
          }
          if (code === 0) return true;
          fail(new ProtocolError(`unsupported auth code ${code}`));
          return false;
        }
        if (type === 'E') {
          const fields = parseErrorFields(payload);
          fail(new DatabaseError(fields.code ?? 'unknown', fields.message ?? 'error'));
          return false;
        }
        if (type === 'K' || type === 'S' || type === 'N') return true;
        if (type === 'Z') return true;
        fail(new ProtocolError(`unexpected message ${type} during startup`));
        return false;
      };

    });
  }

  private markClosed() {
            this.closed = true;
    this.ready = false;
    const err = new DatabaseError('connection_lost', 'connection lost');
    for (const q of [...this.queue, ...(this.current ? [this.current] : [])]) q.waiter.reject(err);
    this.queue = [];
    this.current = null;
  }

  private takeMessage(): { type: string; payload: Buffer } | null {
    if (this.buffer.length < 5) return null;
    const type = String.fromCharCode(this.buffer[0]!);
    const len = this.buffer.readUInt32BE(1);
    if (this.buffer.length < 1 + len) return null;
    const payload = this.buffer.subarray(5, 1 + len);
    this.buffer = this.buffer.subarray(1 + len);
    return { type, payload };
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const msg = this.takeMessage();
      if (!msg) return;
      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: { type: string; payload: Buffer }) {
        const { type, payload } = msg;
    switch (type) {
      case '1':
      case '2':
      case '3':
      case 'n':
      case 't':
      case 's':
        return;
      case 'T': {
        const nfields = payload.readInt16BE(0);
        this.names = [];
        this.parsers = [];
        let off = 2;
        for (let i = 0; i < nfields; i++) {
          const end = payload.indexOf(0, off);
          this.names.push(payload.subarray(off, end).toString());
          // name(0) tableOID(4) attr(2) typeOID(4): the type OID sits at end + 1 + 4 + 2.
          const oid = payload.readInt32BE(end + 1 + 6);
          this.parsers.push(oid === 0 ? null : (OID_PARSERS.get(oid) ?? IDENTITY));
          off = end + 1 + 18;
        }
        return;
      }
      case 'D': {
        const ncols = payload.readInt16BE(0);
        const row: Row = {};
        let off = 2;
        for (let i = 0; i < ncols; i++) {
          const name = this.names[i]!;
          const len = payload.readInt32BE(off);
          off += 4;
          if (len === -1) {
            row[name] = null;
          } else {
            const raw = payload.subarray(off, off + len).toString();
            const parser = this.parsers[i];
            row[name] = parser ? parser(raw) : raw;
            off += len;
          }
        }
        this.rows.push(row);
        return;
      }
      case 'C': {
        // CommandComplete carries the tag, e.g. "INSERT 0 1" or "UPDATE 2".
        const tag = payload.subarray(0, payload.indexOf(0)).toString();
        const parts = tag.split(' ');
        const n = parts[parts.length - 1] ?? '0';
        this.lastRowCount = /^\d+$/.test(n) ? Number(n) : this.rows.length;
        return;
      }
      case 'Z': {
        const current = this.current;
        this.current = null;
        const rows = this.rows;
        const rowCount = this.lastRowCount;
        this.rows = [];
        this.lastRowCount = 0;
        if (current) {
          queueMicrotask(() => current.waiter.resolve({ rows, rowCount }));
        }
        this.drain();
        return;
      }
      case 'E': {
        const fields = parseErrorFields(payload);
        const current = this.current;
        this.current = null;
        this.rows = [];
        const err = new DatabaseError(fields.code ?? 'unknown', fields.message ?? 'query error');
        if (current) current.waiter.reject(err);
        this.drain();
        return;
      }
      default:
        return;
    }
  }

  private drain() {
        if (this.current || this.queue.length === 0 || !this.ready || this.closed) return;
    this.sendQuery(this.queue.shift()!);
  }

  private message(type: string, body: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length + 4, 0);
    return Buffer.concat([Buffer.from(type), len, body]);
  }

  private sendQuery(item: { sql: string; params: Value[]; waiter: Waiter }) {
        this.current = item;
    this.rows = [];
    this.names = [];
    this.parsers = [];
    const { sql, params } = item;
    const buffers: Buffer[] = [];
    // The unnamed statement and portal are replaced by each Parse/Bind, so they can be reused for every query.
    const name = '';

    const parseBody = Buffer.concat([Buffer.from(name), Buffer.from([0]), Buffer.from(sql), Buffer.from([0]), (() => { const b = Buffer.alloc(2); b.writeInt16BE(0, 0); return b; })()]);
    buffers.push(this.message('P', parseBody));

    const paramBuffers: Buffer[] = [];
    for (const p of params) {
      const enc = encodeValue(p);
      if (enc === null) {
        const l = Buffer.alloc(4);
        l.writeInt32BE(-1, 0);
        paramBuffers.push(l);
      } else {
        const l = Buffer.alloc(4);
        l.writeInt32BE(enc.length, 0);
        paramBuffers.push(l, enc);
      }
    }
    const bindBody = Buffer.concat([
      Buffer.from(''),
      Buffer.from([0]),
      Buffer.from(name),
      Buffer.from([0]),
      (() => { const b = Buffer.alloc(2); b.writeInt16BE(0, 0); return b; })(),
      (() => { const b = Buffer.alloc(2); b.writeInt16BE(params.length, 0); return b; })(),
      ...paramBuffers,
      (() => { const b = Buffer.alloc(2); b.writeInt16BE(0, 0); return b; })(),
    ]);
    buffers.push(this.message('B', bindBody));
    buffers.push(this.message('D', Buffer.concat([Buffer.from('P'), Buffer.from([0])])));
    buffers.push(this.message('E', Buffer.concat([Buffer.from(name), Buffer.from([0]), (() => { const b = Buffer.alloc(4); b.writeInt32BE(0, 0); return b; })()])));
    buffers.push(this.message('S', Buffer.alloc(0)));
    const wire = Buffer.concat(buffers);
    this.socket!.write(wire);
  }

  query(sql: string, params: Value[] = []): Promise<QueryResult> {
        if (this.closed || !this.socket) return Promise.reject(new DatabaseError('connection_lost', 'connection lost'));
    return new Promise<QueryResult>((resolve, reject) => {
      this.queue.push({ sql, params, waiter: { resolve, reject } });
      this.drain();
    });
  }

  isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (!this.closed && this.socket) {
      try {
        this.socket.write(this.message('X', Buffer.alloc(0)));
      } catch {
        /* ignore */
      }
      this.socket.destroy();
      this.closed = true;
    }
  }
}

function parseErrorFields(payload: Buffer): { code?: string | undefined; message?: string | undefined } {
  const out: Record<string, string> = {};
  let off = 0;
  while (off < payload.length && payload[off] !== 0) {
    const t = String.fromCharCode(payload[off]!);
    const end = payload.indexOf(0, off + 1);
    if (end === -1) break;
    out[t] = payload.subarray(off + 1, end).toString();
    off = end + 1;
  }
  return { code: out['C'], message: out['M'] };
}

export class PgPool {
  private connections: PgConnection[] = [];
  private idle: PgConnection[] = [];
  private waiting: Array<(c: PgConnection) => void> = [];

  constructor(
    private url: string,
    private size = 8,
  ) {}

  async acquire(): Promise<PgConnection> {
    const idle = this.idle.pop();
    if (idle && !idle.isClosed()) return idle;
    if (this.connections.length < this.size) {
      const conn = new PgConnection(parseDatabaseUrl(this.url));
      await conn.connect();
      this.connections.push(conn);
      return conn;
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release(conn: PgConnection): void {
    if (conn.isClosed()) {
      this.connections = this.connections.filter((c) => c !== conn);
      return;
    }
    const waiter = this.waiting.shift();
    if (waiter) waiter(conn);
    else this.idle.push(conn);
  }

  async withConnection<T>(fn: (c: PgConnection) => Promise<T>): Promise<T> {
    const conn = await this.acquire();
    try {
      return await fn(conn);
    } finally {
      this.release(conn);
    }
  }

  async query(sql: string, params: Value[] = []): Promise<QueryResult> {
    return this.withConnection((c) => c.query(sql, params));
  }

  close(): void {
    for (const c of this.connections) c.close();
  }
}

export class Tx {
  private conn: PgConnection | null = null;

  constructor(private pool: PgPool) {}

  async begin(): Promise<void> {
    this.conn = await this.pool.acquire();
    await this.conn.query('BEGIN');
  }

  async query(sql: string, params: Value[] = []): Promise<QueryResult> {
    if (!this.conn) throw new DatabaseError('no_transaction', 'transaction not begun');
    return this.conn.query(sql, params);
  }

  async commit(): Promise<void> {
    if (!this.conn) return;
    await this.conn.query('COMMIT');
    this.pool.release(this.conn);
    this.conn = null;
  }

  async rollback(): Promise<void> {
    if (!this.conn) return;
    try {
      await this.conn.query('ROLLBACK');
    } finally {
      this.pool.release(this.conn);
      this.conn = null;
    }
  }
}
