// A small Postgres client speaking protocol 3.0 over node:net: SCRAM-SHA-256 / md5 / cleartext auth,
// the extended query protocol with text-format parameters, and the simple protocol for schema scripts.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { connect, type Socket } from "node:net";

export type SqlValue = string | number | boolean | null | Date | Buffer | readonly string[];
export type Row = Record<string, unknown>;
export type QueryResult<T extends Row = Row> = { rows: T[]; rowCount: number };

class PgError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

type Field = { name: string; typeOid: number };
type Pending = {
  fields: Field[];
  rows: Row[];
  rowCount: number;
  error: PgError | null;
  resolve: (result: QueryResult) => void;
  reject: (error: Error) => void;
};

const TYPE = { bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, json: 114, float4: 700, float8: 701, textArray: 1009, int4Array: 1007, timestamptz: 1184, timestamp: 1114, numeric: 1700, jsonb: 3802 };

function parseTextArray(raw: string): string[] {
  const out: string[] = [];
  const body = raw.slice(1, -1);
  let i = 0;
  while (i < body.length) {
    if (body[i] === '"') {
      let value = "";
      i++;
      while (body[i] !== '"') {
        if (body[i] === "\\") i++;
        value += body[i];
        i++;
      }
      out.push(value);
      i += 2;
    } else {
      const end = body.indexOf(",", i);
      const value = body.slice(i, end < 0 ? body.length : end);
      out.push(value);
      i = end < 0 ? body.length : end + 1;
    }
  }
  return out;
}

function parseTimestamp(raw: string): Date {
  const iso = raw.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  return new Date(iso);
}

function decodeValue(typeOid: number, raw: string): unknown {
  switch (typeOid) {
    case TYPE.bool: return raw === "t";
    case TYPE.int2: case TYPE.int4: case TYPE.int8: case TYPE.float4: case TYPE.float8: return Number(raw);
    case TYPE.json: case TYPE.jsonb: return JSON.parse(raw);
    case TYPE.timestamptz: case TYPE.timestamp: return parseTimestamp(raw);
    case TYPE.bytea: return Buffer.from(raw.slice(2), "hex");
    case TYPE.textArray: return parseTextArray(raw);
    case TYPE.int4Array: return parseTextArray(raw).map(Number);
    default: return raw;
  }
}

function encodeValue(value: SqlValue): Buffer | null {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return Buffer.from("\\x" + value.toString("hex"));
  if (value instanceof Date) return Buffer.from(value.toISOString());
  if (typeof value === "boolean") return Buffer.from(value ? "t" : "f");
  if (Array.isArray(value)) {
    const items = (value as readonly string[]).map((item) => '"' + item.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
    return Buffer.from("{" + items.join(",") + "}");
  }
  return Buffer.from(String(value));
}

class Writer {
  private parts: Buffer[] = [];
  int16(n: number): this { const b = Buffer.alloc(2); b.writeInt16BE(n); this.parts.push(b); return this; }
  int32(n: number): this { const b = Buffer.alloc(4); b.writeInt32BE(n); this.parts.push(b); return this; }
  cstr(s: string): this { this.parts.push(Buffer.from(s + "\0")); return this; }
  bytes(b: Buffer): this { this.parts.push(b); return this; }
  message(type: string | null): Buffer {
    const body = Buffer.concat(this.parts);
    const head = Buffer.alloc(type ? 5 : 4);
    if (type) { head.write(type, 0); head.writeInt32BE(body.length + 4, 1); } else head.writeInt32BE(body.length + 4, 0);
    return Buffer.concat([head, body]);
  }
}

function xor(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

type ConnectionOptions = { host: string; port: number; user: string; password: string; database: string };

export class Connection {
  private socket!: Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private queue: Pending[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private ready!: () => void;
  private failStartup!: (error: Error) => void;
  private scramNonce = "";
  private scramFirstBare = "";
  closed = false;

  constructor(private readonly options: ConnectionOptions) {}

  open(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.ready = resolve;
      this.failStartup = reject;
      const timer = setTimeout(() => { reject(new Error("Postgres connect timeout")); this.socket.destroy(); }, timeoutMs);
      this.socket = connect({ host: this.options.host, port: this.options.port });
      this.socket.setNoDelay(true);
      this.socket.on("connect", () => {
        const w = new Writer().int32(196608)
          .cstr("user").cstr(this.options.user).cstr("database").cstr(this.options.database)
          .cstr("TimeZone").cstr("UTC").cstr("DateStyle").cstr("ISO, YMD").cstr("client_encoding").cstr("UTF8")
          .bytes(Buffer.from([0]));
        this.socket.write(w.message(null));
      });
      this.socket.on("data", (chunk) => this.onData(chunk));
      this.socket.on("error", (error) => this.onClose(error));
      this.socket.on("close", () => this.onClose(new Error("Postgres connection closed")));
      const done = this.ready;
      this.ready = () => { clearTimeout(timer); done(); };
      const fail = this.failStartup;
      this.failStartup = (error) => { clearTimeout(timer); fail(error); };
    });
  }

  private onClose(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.failStartup(error);
    for (const pending of this.queue.splice(0)) pending.reject(error);
  }

  close(): void {
    if (this.closed) return;
    this.socket.end(new Writer().message("X"));
    this.closed = true;
  }

  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) return;
      const type = String.fromCharCode(this.buffer[0]!);
      const body = this.buffer.subarray(5, length + 1);
      this.buffer = this.buffer.subarray(length + 1);
      this.handle(type, body);
    }
  }

  private send(message: Buffer): void {
    this.socket.write(message);
  }

  private handle(type: string, body: Buffer): void {
    const current = this.queue[0];
    switch (type) {
      case "R": return this.authenticate(body);
      case "S": case "K": case "N": case "1": case "2": case "n": case "s": return;
      case "Z": {
        if (!current) return this.ready();
        this.queue.shift();
        if (current.error) current.reject(current.error);
        else current.resolve({ rows: current.rows, rowCount: current.rowCount });
        return;
      }
      case "T": {
        if (!current) return;
        const count = body.readInt16BE(0);
        let offset = 2;
        current.fields = [];
        for (let i = 0; i < count; i++) {
          const end = body.indexOf(0, offset);
          const name = body.toString("utf8", offset, end);
          offset = end + 1;
          const typeOid = body.readInt32BE(offset + 6);
          offset += 18;
          current.fields.push({ name, typeOid });
        }
        return;
      }
      case "D": {
        if (!current) return;
        const count = body.readInt16BE(0);
        let offset = 2;
        const row: Row = {};
        for (let i = 0; i < count; i++) {
          const length = body.readInt32BE(offset);
          offset += 4;
          const field = current.fields[i]!;
          if (length < 0) row[field.name] = null;
          else {
            row[field.name] = decodeValue(field.typeOid, body.toString("utf8", offset, offset + length));
            offset += length;
          }
        }
        current.rows.push(row);
        return;
      }
      case "C": {
        if (!current) return;
        const tag = body.toString("utf8", 0, body.length - 1);
        const last = Number(tag.split(" ").pop());
        current.rowCount = Number.isFinite(last) ? last : current.rows.length;
        return;
      }
      case "I": return;
      case "E": {
        const fields: Record<string, string> = {};
        let offset = 0;
        while (offset < body.length && body[offset] !== 0) {
          const code = String.fromCharCode(body[offset]!);
          const end = body.indexOf(0, offset + 1);
          fields[code] = body.toString("utf8", offset + 1, end);
          offset = end + 1;
        }
        const error = new PgError(fields.C ?? "XX000", fields.M ?? "Postgres error");
        if (current) current.error = error;
        else this.failStartup(error);
        return;
      }
      default: return;
    }
  }

  private authenticate(body: Buffer): void {
    const kind = body.readInt32BE(0);
    const { user, password } = this.options;
    if (kind === 0) return;
    if (kind === 3) return this.send(new Writer().cstr(password).message("p"));
    if (kind === 5) {
      const salt = body.subarray(4, 8);
      const inner = createHash("md5").update(password + user).digest("hex");
      const outer = createHash("md5").update(Buffer.concat([Buffer.from(inner), salt])).digest("hex");
      return this.send(new Writer().cstr("md5" + outer).message("p"));
    }
    if (kind === 10) {
      this.scramNonce = randomBytes(18).toString("base64");
      this.scramFirstBare = `n=*,r=${this.scramNonce}`;
      const first = Buffer.from(`n,,${this.scramFirstBare}`);
      return this.send(new Writer().cstr("SCRAM-SHA-256").int32(first.length).bytes(first).message("p"));
    }
    if (kind === 11) {
      const serverFirst = body.toString("utf8", 4);
      const attrs = Object.fromEntries(serverFirst.split(",").map((part) => [part[0], part.slice(2)]));
      const nonce = attrs.r ?? "";
      if (!nonce.startsWith(this.scramNonce)) return this.failStartup(new Error("SCRAM nonce mismatch"));
      const salted = pbkdf2Sync(password, Buffer.from(attrs.s ?? "", "base64"), Number(attrs.i), 32, "sha256");
      const clientKey = createHmac("sha256", salted).update("Client Key").digest();
      const storedKey = createHash("sha256").update(clientKey).digest();
      const withoutProof = `c=biws,r=${nonce}`;
      const authMessage = `${this.scramFirstBare},${serverFirst},${withoutProof}`;
      const signature = createHmac("sha256", storedKey).update(authMessage).digest();
      const final = `${withoutProof},p=${xor(clientKey, signature).toString("base64")}`;
      return this.send(new Writer().bytes(Buffer.from(final)).message("p"));
    }
    if (kind === 12) return;
    this.failStartup(new Error(`Unsupported Postgres auth method ${kind}`));
  }

  private enqueue(messages: Buffer): Promise<QueryResult> {
    const run = () => new Promise<QueryResult>((resolve, reject) => {
      if (this.closed) return reject(new Error("Postgres connection closed"));
      this.queue.push({ fields: [], rows: [], rowCount: 0, error: null, resolve, reject });
      this.send(messages);
    });
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  query<T extends Row = Row>(text: string, params: readonly SqlValue[] = []): Promise<QueryResult<T>> {
    const bind = new Writer().cstr("").cstr("").int16(0).int16(params.length);
    for (const param of params) {
      const encoded = encodeValue(param);
      if (encoded === null) bind.int32(-1);
      else bind.int32(encoded.length).bytes(encoded);
    }
    bind.int16(0);
    const messages = Buffer.concat([
      new Writer().cstr("").cstr(text).int16(0).message("P"),
      bind.message("B"),
      new Writer().bytes(Buffer.from("P")).cstr("").message("D"),
      new Writer().cstr("").int32(0).message("E"),
      new Writer().message("S"),
    ]);
    return this.enqueue(messages) as Promise<QueryResult<T>>;
  }

  simple(text: string): Promise<QueryResult> {
    return this.enqueue(new Writer().cstr(text).message("Q"));
  }
}

export function parseDatabaseUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
}
