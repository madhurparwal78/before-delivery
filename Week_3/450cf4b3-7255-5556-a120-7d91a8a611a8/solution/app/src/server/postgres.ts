// A small Postgres client over the v3 wire protocol: SCRAM-SHA-256 / MD5 / cleartext sign-in,
// parameterised queries through the extended protocol, a bounded pool and transactions.

import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import net from "node:net";

export type SqlParam = string | number | boolean | Date | null;
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type SqlValue = string | number | boolean | Date | null | Json;
export type Row = Record<string, SqlValue>;

export interface Queryable {
  query(text: string, params?: readonly SqlParam[]): Promise<Row[]>;
}

export class PgError extends Error {
  constructor(message: string, readonly code: string, readonly constraint: string | null) {
    super(message);
  }
}

interface Pending {
  fields: { name: string; type: number }[];
  rows: Row[];
  error: PgError | null;
  resolve: (rows: Row[]) => void;
  reject: (error: Error) => void;
}

interface Target {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const PROTOCOL_V3 = 196608;
const OID = { bool: 16, int8: 20, int2: 21, int4: 23, oid: 26, json: 114, float4: 700, float8: 701, timestamp: 1114, timestamptz: 1184, numeric: 1700, jsonb: 3802 } as const;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([+-])(\d{2})(?::?(\d{2}))?)?$/;

function parseTarget(url: string): Target {
  const parsed = new URL(url);
  return {
    host: decodeURIComponent(parsed.hostname),
    port: Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || decodeURIComponent(parsed.username),
  };
}

function cstring(value: string): Buffer {
  return Buffer.concat([Buffer.from(value, "utf8"), Buffer.from([0])]);
}

function int16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16BE(value);
  return buffer;
}

function int32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function frame(type: string, ...body: Buffer[]): Buffer {
  const payload = Buffer.concat(body);
  return Buffer.concat([Buffer.from(type, "ascii"), int32(payload.length + 4), payload]);
}

function encodeParam(value: SqlParam): Buffer | null {
  if (value === null) return null;
  if (value instanceof Date) return Buffer.from(value.toISOString(), "utf8");
  if (typeof value === "boolean") return Buffer.from(value ? "true" : "false", "utf8");
  return Buffer.from(String(value), "utf8");
}

function decodeTimestamp(text: string): Date {
  const m = TIMESTAMP.exec(text);
  if (!m) return new Date(text);
  const fraction = Number(`0.${m[7] ?? "0"}`);
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  const offset = m[8] ? (m[8] === "-" ? -1 : 1) * (Number(m[9]) * 60 + Number(m[10] ?? "0")) : 0;
  return new Date(base + Math.round(fraction * 1000) - offset * 60_000);
}

function decode(type: number, text: string): SqlValue {
  switch (type) {
    case OID.bool:
      return text === "t";
    case OID.int2:
    case OID.int4:
    case OID.int8:
    case OID.oid:
    case OID.float4:
    case OID.float8:
    case OID.numeric:
      return Number(text);
    case OID.json:
    case OID.jsonb:
      return JSON.parse(text) as Json;
    case OID.timestamp:
    case OID.timestamptz:
      return decodeTimestamp(text);
    default:
      return text;
  }
}

function xor(a: Buffer, b: Buffer): Buffer {
  return Buffer.from(a.map((byte, i) => byte ^ (b[i] ?? 0)));
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

class Connection implements Queryable {
  private readonly socket: net.Socket;
  private inbox: Buffer = Buffer.alloc(0);
  private queue: Promise<unknown> = Promise.resolve();
  private pending: Pending | null = null;
  private startup: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private scram: { nonce: string; firstBare: string; signature: Buffer | null } | null = null;
  dead = false;

  private constructor(private readonly target: Target) {
    this.socket = net.connect({ host: target.host, port: target.port });
    this.socket.setNoDelay(true);
    this.socket.on("data", (chunk: Buffer) => this.receive(chunk));
    this.socket.on("error", (error) => this.fail(error));
    this.socket.on("close", () => this.fail(new Error("Postgres connection closed")));
  }

  static open(target: Target): Promise<Connection> {
    const connection = new Connection(target);
    return new Promise((resolve, reject) => {
      connection.startup = { resolve: () => resolve(connection), reject };
      connection.socket.once("connect", () => {
        const options = ["user", target.user, "database", target.database, "client_encoding", "UTF8", "TimeZone", "UTC", "DateStyle", "ISO, YMD"];
        const body = Buffer.concat([int32(PROTOCOL_V3), ...options.map(cstring), Buffer.from([0])]);
        connection.socket.write(Buffer.concat([int32(body.length + 4), body]));
      });
    });
  }

  close(): void {
    this.dead = true;
    if (!this.socket.destroyed) this.socket.end(frame("X"));
  }

  query(text: string, params: readonly SqlParam[] = []): Promise<Row[]> {
    const run = this.queue.then(() => this.send(text, params));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private send(text: string, params: readonly SqlParam[]): Promise<Row[]> {
    if (this.dead) return Promise.reject(new Error("Postgres connection is closed"));
    return new Promise<Row[]>((resolve, reject) => {
      this.pending = { fields: [], rows: [], error: null, resolve, reject };
      const values = params.map(encodeParam);
      const bind = [cstring(""), cstring(""), int16(0), int16(values.length),
        ...values.flatMap((value) => (value === null ? [int32(-1)] : [int32(value.length), value])), int16(0)];
      this.socket.write(Buffer.concat([
        frame("P", cstring(""), cstring(text), int16(0)),
        frame("B", ...bind),
        frame("D", Buffer.from("P", "ascii"), cstring("")),
        frame("E", cstring(""), int32(0)),
        frame("S"),
      ]));
    });
  }

  private fail(error: Error): void {
    if (this.dead && !this.pending && !this.startup) return;
    this.dead = true;
    this.startup?.reject(error);
    this.startup = null;
    this.pending?.reject(error);
    this.pending = null;
  }

  private receive(chunk: Buffer): void {
    this.inbox = this.inbox.length ? Buffer.concat([this.inbox, chunk]) : chunk;
    while (this.inbox.length >= 5) {
      const length = this.inbox.readInt32BE(1);
      if (this.inbox.length < length + 1) return;
      const type = String.fromCharCode(this.inbox[0] ?? 0);
      const body = this.inbox.subarray(5, length + 1);
      this.inbox = this.inbox.subarray(length + 1);
      this.handle(type, body);
    }
  }

  private handle(type: string, body: Buffer): void {
    switch (type) {
      case "R":
        this.authenticate(body);
        return;
      case "E": {
        const error = this.error(body);
        if (this.pending) this.pending.error = error;
        else this.fail(error);
        return;
      }
      case "T":
        this.describe(body);
        return;
      case "D":
        this.row(body);
        return;
      case "Z":
        this.ready();
        return;
      default:
        return;
    }
  }

  private authenticate(body: Buffer): void {
    const code = body.readInt32BE(0);
    const { user, password } = this.target;
    if (code === 0) return;
    if (code === 3) {
      this.socket.write(frame("p", cstring(password)));
    } else if (code === 5) {
      const inner = createHash("md5").update(password + user).digest("hex");
      const outer = createHash("md5").update(Buffer.concat([Buffer.from(inner), body.subarray(4, 8)])).digest("hex");
      this.socket.write(frame("p", cstring(`md5${outer}`)));
    } else if (code === 10) {
      const nonce = randomBytes(18).toString("base64");
      const firstBare = `n=*,r=${nonce}`;
      this.scram = { nonce, firstBare, signature: null };
      const first = Buffer.from(`n,,${firstBare}`, "utf8");
      this.socket.write(frame("p", cstring("SCRAM-SHA-256"), int32(first.length), first));
    } else if (code === 11 && this.scram) {
      const serverFirst = body.subarray(4).toString("utf8");
      const attributes = new Map(serverFirst.split(",").map((part) => [part.slice(0, 1), part.slice(2)] as const));
      const serverNonce = attributes.get("r") ?? "";
      if (!serverNonce.startsWith(this.scram.nonce)) {
        this.fail(new Error("Postgres SCRAM nonce mismatch"));
        return;
      }
      const salted = pbkdf2Sync(password, Buffer.from(attributes.get("s") ?? "", "base64"), Number(attributes.get("i")), 32, "sha256");
      const clientKey = hmac(salted, "Client Key");
      const withoutProof = `c=biws,r=${serverNonce}`;
      const message = `${this.scram.firstBare},${serverFirst},${withoutProof}`;
      const proof = xor(clientKey, hmac(createHash("sha256").update(clientKey).digest(), message));
      this.scram.signature = hmac(hmac(salted, "Server Key"), message);
      this.socket.write(frame("p", Buffer.from(`${withoutProof},p=${proof.toString("base64")}`, "utf8")));
    } else if (code === 12 && this.scram?.signature) {
      const verifier = Buffer.from(body.subarray(4).toString("utf8").replace(/^v=/, ""), "base64");
      if (verifier.length !== this.scram.signature.length || !timingSafeEqual(verifier, this.scram.signature)) {
        this.fail(new Error("Postgres SCRAM server signature mismatch"));
      }
    } else {
      this.fail(new Error(`Postgres authentication method ${code} is not supported`));
    }
  }

  private error(body: Buffer): PgError {
    const fields = new Map<string, string>();
    let offset = 0;
    while (offset < body.length && body[offset] !== 0) {
      const key = String.fromCharCode(body[offset] ?? 0);
      const end = body.indexOf(0, offset + 1);
      fields.set(key, body.subarray(offset + 1, end).toString("utf8"));
      offset = end + 1;
    }
    return new PgError(fields.get("M") ?? "Postgres error", fields.get("C") ?? "XX000", fields.get("n") ?? null);
  }

  private describe(body: Buffer): void {
    if (!this.pending) return;
    const count = body.readInt16BE(0);
    let offset = 2;
    const fields: { name: string; type: number }[] = [];
    for (let i = 0; i < count; i++) {
      const end = body.indexOf(0, offset);
      const name = body.subarray(offset, end).toString("utf8");
      const type = body.readInt32BE(end + 7);
      fields.push({ name, type });
      offset = end + 19;
    }
    this.pending.fields = fields;
  }

  private row(body: Buffer): void {
    if (!this.pending) return;
    const count = body.readInt16BE(0);
    let offset = 2;
    const row: Row = {};
    for (let i = 0; i < count; i++) {
      const length = body.readInt32BE(offset);
      offset += 4;
      const field = this.pending.fields[i];
      if (!field) continue;
      if (length < 0) {
        row[field.name] = null;
      } else {
        row[field.name] = decode(field.type, body.subarray(offset, offset + length).toString("utf8"));
        offset += length;
      }
    }
    this.pending.rows.push(row);
  }

  private ready(): void {
    if (this.startup) {
      this.startup.resolve();
      this.startup = null;
      return;
    }
    const done = this.pending;
    this.pending = null;
    if (!done) return;
    if (done.error) done.reject(done.error);
    else done.resolve(done.rows);
  }
}

/** A bounded pool. `query` borrows a connection per statement; `transaction` holds one throughout. */
export class Database implements Queryable {
  private readonly target: Target;
  private readonly idle: Connection[] = [];
  private readonly waiting: { resolve: (connection: Connection) => void; reject: (error: unknown) => void }[] = [];
  private open = 0;

  constructor(url: string, private readonly size: number) {
    this.target = parseTarget(url);
  }

  async query(text: string, params: readonly SqlParam[] = []): Promise<Row[]> {
    const connection = await this.acquire();
    try {
      return await connection.query(text, params);
    } finally {
      this.release(connection);
    }
  }

  async transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    const connection = await this.acquire();
    try {
      await connection.query("BEGIN");
      try {
        const result = await work(connection);
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        if (!connection.dead) await connection.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    } finally {
      this.release(connection);
    }
  }

  private async acquire(): Promise<Connection> {
    let ready = this.idle.pop();
    while (ready?.dead) {
      this.open--;
      ready = this.idle.pop();
    }
    if (ready) return ready;
    if (this.open < this.size) {
      this.open++;
      try {
        return await Connection.open(this.target);
      } catch (error) {
        this.open--;
        throw error;
      }
    }
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  private release(connection: Connection): void {
    if (connection.dead) {
      this.open--;
      const next = this.waiting.shift();
      if (next) {
        this.open++;
        Connection.open(this.target).then(next.resolve, (error: unknown) => {
          this.open--;
          next.reject(error);
        });
      }
      return;
    }
    const next = this.waiting.shift();
    if (next) next.resolve(connection);
    else this.idle.push(connection);
  }
}

/** The single row an INSERT … RETURNING or a keyed lookup must produce. */
export function only(rows: Row[]): Row {
  const [row] = rows;
  if (!row || rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
  return row;
}

/** Typed reads of one column; a wrong type is a schema bug and fails loudly. */
export const col = {
  text(row: Row, key: string): string {
    const value = row[key];
    if (typeof value !== "string") throw new TypeError(`${key} is not text`);
    return value;
  },
  textOrNull(row: Row, key: string): string | null {
    return row[key] === null ? null : col.text(row, key);
  },
  int(row: Row, key: string): number {
    const value = row[key];
    if (typeof value !== "number") throw new TypeError(`${key} is not a number`);
    return value;
  },
  intOrNull(row: Row, key: string): number | null {
    return row[key] === null ? null : col.int(row, key);
  },
  bool(row: Row, key: string): boolean {
    const value = row[key];
    if (typeof value !== "boolean") throw new TypeError(`${key} is not a boolean`);
    return value;
  },
  boolOrNull(row: Row, key: string): boolean | null {
    return row[key] === null ? null : col.bool(row, key);
  },
  time(row: Row, key: string): Date {
    const value = row[key];
    if (!(value instanceof Date)) throw new TypeError(`${key} is not a timestamp`);
    return value;
  },
};
