// Postgres access over the raw wire protocol: one small client, no driver
// dependency, using SCRAM-SHA-256 authentication (what the platform's Postgres
// asks for) and the v3 query protocol with unnamed prepared statements.

import type { Config } from "./config";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import net from "node:net";

type Row = Record<string, unknown>;
// Query parameters are values straight off a row or a request body, so the
// accepted type is what the encoder can turn into wire text.
export type Value = string | number | boolean | null | unknown;

export class Db {
  private conn: Connection | null = null;

  constructor(private readonly config: Config) {}

  async query(text: string, params: Value[]): Promise<Row[]> {
    const conn = await this.connection();
    return conn.query(text, params);
  }

  async one(text: string, params: Value[]): Promise<Row | null> {
    const rows = await this.query(text, params);
    return rows.length === 0 ? null : rows[0]!;
  }

  async many(text: string, params: Value[]): Promise<Row[]> {
    return this.query(text, params);
  }

  private async connection(): Promise<Connection> {
    if (this.conn === null || this.conn.closed) {
      this.conn = await Connection.open(this.config);
    }
    return this.conn;
  }
}

class Connection {
  closed = false;
  private buffer = Buffer.alloc(0);
  private rows: Row[] = [];
  private names: string[] = [];
  private pending: { resolve: (rows: Row[]) => void; reject: (e: Error) => void } | null = null;

  private constructor(private readonly sock: net.Socket) {
    sock.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wake();
    });
    sock.on("error", () => {
      this.closed = true;
      this.pending?.reject(new Error("connection failed"));
      this.pending = null;
      this.wake();
    });
    sock.on("close", () => {
      this.closed = true;
      this.wake();
    });
  }

  static async open(config: Config): Promise<Connection> {
    const url = new URL(config.databaseUrl);
    const host = url.hostname;
    const port = Number(url.port || 5432);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const database = url.pathname.replace(/^\//, "") || "postgres";
    const sock = await netConnect(port, host);
    const conn = new Connection(sock);
    // The startup message carries no type byte, only the length.
    const body = Buffer.concat([
      int32(196608),
      cstring("user"),
      cstring(user),
      cstring("database"),
      cstring(database),
      int8(0),
    ]);
    await conn.writeRaw(Buffer.concat([int32(body.length + 4), body]));

    // Authentication: SCRAM-SHA-256 per RFC 5802, the flow Postgres asks for.
    const mechanisms = await conn.expectAuthRequest();
    if (!mechanisms.includes("SCRAM-SHA-256")) throw new Error("unsupported auth");
    const clientNonce = randomBytes(18).toString("base64");
    const clientFirstBare = `n=,r=${clientNonce}`;
    const scramMessage = Buffer.from(`n,,${clientFirstBare}`, "utf8");
    const init = typed("p", Buffer.concat([cstring("SCRAM-SHA-256"), int32(scramMessage.length), scramMessage]));
    await conn.writeRaw(init);
    const serverFirst = await conn.expectAuthContinue();
    const attrs = parseScram(serverFirst);
    const serverNonce = attrs.r!;
    const salt = Buffer.from(attrs.s!, "base64");
    const iterations = Number(attrs.i!);
    const saltedPassword = hi(password, salt, iterations);
    const clientFinalNoProof = `c=biws,r=${serverNonce}`;
    const authMessage = `${clientFirstBare},${serverFirst},${clientFinalNoProof}`;
    const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
    const storedKey = createHash("sha256").update(clientKey).digest();
    const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
    const proof = xor(clientKey, clientSignature).toString("base64");
    const clientFinal = `${clientFinalNoProof},p=${proof}`;
    await conn.writeRaw(typed("p", Buffer.from(clientFinal, "utf8")));
    await conn.expectAuthOk();
    return conn;
  }

  async query(text: string, params: Value[]): Promise<Row[]> {
    this.rows = [];
    const parts: Buffer[] = [];
    // Parse with no parameter type oids, so the server infers them.
    const parseBody = Buffer.concat([int8(0), cstring(text), int16(0)]);
    parts.push(typed("P", parseBody));
    // Bind: the unnamed statement, the unnamed portal, the parameters' format
    // count (zero: all text), the parameters with their count first, then the
    // result formats' count (zero: all text), so every value is a string.
    const bindParts: Buffer[] = [cstring(""), cstring("")];
    bindParts.push(int16(0));
    bindParts.push(int16(params.length));
    for (const p of params) {
      if (p === null || p === undefined) {
        // A null parameter is sent as a -1 length, the wire's NULL marker.
        bindParts.push(int32(-1));
        continue;
      }
      const encoded = encodeParam(p);
      bindParts.push(int32(Buffer.byteLength(encoded)), Buffer.from(encoded, "utf8"));
    }
    bindParts.push(int16(0));
    parts.push(typed("B", Buffer.concat(bindParts)));
    // Describe the portal (a 'P' byte then the portal's empty name), execute
    // it (a portal name then the max row count), then sync.
    parts.push(typed("D", Buffer.concat([int8(80), cstring("")])));
    parts.push(typed("E", Buffer.concat([cstring(""), int32(0)])));
    parts.push(typed("S", Buffer.alloc(0)));
    const result = new Promise<Row[]>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
    await this.writeRaw(Buffer.concat(parts));
    await this.pumpFlow();
    return result;
  }

  // Reads messages until the pending query is settled: rows accumulate, an
  // error rejects it, and the ready-for-query message resolves it.
  private async pumpFlow(): Promise<void> {
    for (;;) {
      const { type, body } = await this.readRawMessage();
      if (type === "T") {
        this.names = [];
        const count = body.readInt16BE(0);
        let at = 2;
        for (let i = 0; i < count; i++) {
          const zero = body.indexOf(0, at);
          this.names.push(body.subarray(at, zero).toString("utf8"));
          at = zero + 1;
          at += 4; // table oid
          at += 2; // column number
          at += 4; // type oid
          at += 2; // type length
          at += 4; // type modifier
          at += 2; // format
        }
        continue;
      }
      if (type === "D") {
        const count = body.readInt16BE(0);
        let at = 2;
        const row: Row = {};
        for (let i = 0; i < count; i++) {
          const len = body.readInt32BE(at);
          at += 4;
          const name = this.names[i] ?? `c${i}`;
          row[name] = len === -1 ? null : body.subarray(at, at + len).toString("utf8");
          if (len !== -1) at += len;
        }
        this.rows.push(row);
        continue;
      }
      if (type === "Z" || type === "E") {
        const pending = this.pending;
        if (type === "E") {
          // The ready-for-query that follows the error is drained here, so
          // the next query starts on a clean flow.
          await this.readRawMessage();
          this.pending = null;
          this.rows = [];
          if (pending !== null) {
            pending.reject(new Error(parseError(body).message));
          }
          return;
        }
        this.pending = null;
        const rows = this.rows;
        this.rows = [];
        if (pending === null) continue;
        pending.resolve(rows);
        return;
      }
      // Parse-complete, bind-complete, command completion and notices are
      // consumed silently.
    }
  }

  private async writeRaw(buf: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  }

  private async expectAuthRequest(): Promise<string[]> {
    for (;;) {
      const msg = await this.readRawMessage();
      if (msg.type === "R") {
        const code = msg.body.readInt32BE(0);
        if (code === 10) {
          const list = msg.body.subarray(4, msg.body.length - 1).toString("utf8");
          return list.split("\0");
        }
        throw new Error("unexpected auth flow");
      }
      if (msg.type === "E") throw new Error(parseError(msg.body).message);
    }
  }

  private async expectAuthContinue(): Promise<string> {
    for (;;) {
      const msg = await this.readRawMessage();
      if (msg.type === "R") {
        const code = msg.body.readInt32BE(0);
        if (code === 11) return msg.body.subarray(4).toString("utf8");
        throw new Error("unexpected auth flow");
      }
      if (msg.type === "E") throw new Error(parseError(msg.body).message);
    }
  }

  private async expectAuthOk(): Promise<void> {
    // The SCRAM flow ends with a server signature, an authentication-ok and
    // the session's parameters; the ready-for-query message ends it. Every
    // message until that one is consumed, so a query starts on a clean flow.
    for (;;) {
      const msg = await this.readRawMessage();
      if (msg.type === "R") {
        const code = msg.body.readInt32BE(0);
        if (code === 0 || code === 12) continue;
        throw new Error("unexpected auth flow");
      }
      if (msg.type === "Z") return;
      if (msg.type === "E") throw new Error(parseError(msg.body).message);
      // S and K messages (parameters, backend key data) are consumed silently.
    }
  }

  // Reads one message off the wire, without interpreting it.
  private async readRawMessage(): Promise<{ type: string; body: Buffer }> {
    for (;;) {
      if (this.buffer.length < 5) {
        await this.waitForData();
        continue;
      }
      const type = this.buffer.subarray(0, 1).toString("latin1");
      const len = this.buffer.readInt32BE(1);
      if (this.buffer.length < 1 + len) {
        await this.waitForData();
        continue;
      }
      const body = this.buffer.subarray(5, 1 + len);
      this.buffer = this.buffer.subarray(1 + len);
      return { type, body };
    }
  }

  private wake(): void {
    this.waiters.forEach((w) => w());
    this.waiters = [];
  }

  private waiters: (() => void)[] = [];

  private waitForData(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

async function netConnect(port: number, host: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ port, host }, () => resolve(sock));
    sock.on("error", reject);
  });
}

function typed(type: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(type, "latin1"), int32(body.length + 4), body]);
}

function int8(v: number): Buffer {
  const b = Buffer.alloc(1);
  b.writeUInt8(v, 0);
  return b;
}

function int16(v: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(v, 0);
  return b;
}

function int32(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v, 0);
  return b;
}

function cstring(s: string): Buffer {
  return Buffer.concat([Buffer.from(s, "utf8"), int8(0)]);
}

function hi(password: string, salt: Buffer, iterations: number): Buffer {
  // PBKDF2 with HMAC-SHA-256 and a 32-byte output, the SCRAM requirement.
  return pbkdf2Sync(password, salt, iterations, 32, "sha256");
}

function xor(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

function parseScram(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(",")) {
    const eq = part.indexOf("=");
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

function encodeParam(p: Value): string {
  if (p === null || p === undefined) return "";
  if (typeof p === "boolean") return p ? "t" : "f";
  if (p instanceof Date) return p.toISOString();
  if (p instanceof Uint8Array) return Buffer.from(p).toString("utf8");
  if (typeof p === "number") return String(p);
  return String(p);
}

function parseError(body: Buffer): { message: string } {
  let at = 0;
  let message = "";
  while (at + 1 < body.length) {
    const code = body.subarray(at, at + 1).toString("latin1");
    at += 1;
    const zero = body.indexOf(0, at);
    if (zero === -1) break;
    const text = body.subarray(at, zero).toString("utf8");
    at = zero + 1;
    if (code === "M") message = text;
  }
  return { message };
}

