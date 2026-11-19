// A small Postgres client over the wire protocol: SCRAM/MD5 auth, extended-protocol queries with text
// parameters, a pool, and notifications for LISTEN.
import net from "node:net";
import crypto from "node:crypto";
import { parse, serialize } from "pg-protocol";
import type { BackendMessage } from "pg-protocol/dist/messages.js";

export type SqlValue = string | number | boolean | null | Date | Buffer | object;
export type Row = Record<string, unknown>;

class PgError extends Error {
  constructor(message: string, readonly code: string | undefined) {
    super(message);
  }
}

interface Pending {
  rows: Row[];
  fields: { name: string; type: number }[];
  count: number;
  error: PgError | null;
  resolve: (value: { rows: Row[]; count: number }) => void;
  reject: (error: Error) => void;
}

interface Message extends BackendMessage {
  mechanisms?: string[];
  data?: string;
  salt?: Buffer;
  fields?: unknown[];
  text?: string;
  message?: string;
  code?: string;
  channel?: string;
  payload?: string;
}

const TIMESTAMP_TYPES = new Set([1114, 1184]);

function decode(type: number, raw: string | null): unknown {
  if (raw === null) return null;
  switch (type) {
    case 16:
      return raw === "t";
    case 20:
    case 21:
    case 23:
    case 26:
    case 700:
    case 701:
      return Number(raw);
    case 114:
    case 3802:
      return JSON.parse(raw);
    case 17:
      return Buffer.from(raw.slice(2), "hex");
    default:
      if (TIMESTAMP_TYPES.has(type)) {
        const match = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)(?:\.(\d+))?(?:([+-]\d\d)(?::?(\d\d))?)?$/.exec(raw);
        if (!match) return new Date(raw);
        const [, day, time, fraction = "", hours = "+00", minutes = "00"] = match;
        return new Date(`${day}T${time}.${fraction.padEnd(3, "0").slice(0, 3)}${hours}:${minutes}`);
      }
      return raw;
  }
}

function encode(value: SqlValue): string | Buffer | null {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function scramProof(password: string, clientNonce: string, serverFirst: string) {
  const attrs = Object.fromEntries(serverFirst.split(",").map((part) => [part[0], part.slice(2)]));
  const nonce = attrs.r ?? "";
  if (!nonce.startsWith(clientNonce)) throw new Error("SCRAM nonce mismatch");
  const salted = crypto.pbkdf2Sync(password, Buffer.from(attrs.s ?? "", "base64"), Number(attrs.i), 32, "sha256");
  const clientKey = crypto.createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const withoutProof = `c=biws,r=${nonce}`;
  const authMessage = `n=*,r=${clientNonce},${serverFirst},${withoutProof}`;
  const signature = crypto.createHmac("sha256", storedKey).update(authMessage).digest();
  const proof = Buffer.from(clientKey.map((byte, i) => byte ^ (signature[i] ?? 0)));
  return `${withoutProof},p=${proof.toString("base64")}`;
}

export class Connection {
  private socket: net.Socket;
  private queue: Pending[] = [];
  private ready: Promise<void>;
  private closed = false;
  onNotification: ((channel: string, payload: string) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(url: URL) {
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || user;
    this.socket = net.connect({ host: url.hostname, port: Number(url.port || 5432) });
    this.socket.setNoDelay(true);
    const clientNonce = crypto.randomBytes(18).toString("base64");
    this.ready = new Promise((resolve, reject) => {
      let started = false;
      const fail = (error: Error) => {
        if (!started) reject(error);
        this.fail(error);
      };
      this.socket.on("error", fail);
      this.socket.on("close", () => fail(new Error("connection closed")));
      this.socket.once("connect", () => {
        this.socket.write(serialize.startup({ user, database, client_encoding: "UTF8", TimeZone: "UTC" }));
      });
      void parse(this.socket, (raw) => {
        const msg = raw as Message;
        if (!started) {
          switch (msg.name) {
            case "authenticationSASL":
              this.socket.write(serialize.sendSASLInitialResponseMessage("SCRAM-SHA-256", `n,,n=*,r=${clientNonce}`));
              return;
            case "authenticationSASLContinue":
              this.socket.write(serialize.sendSCRAMClientFinalMessage(scramProof(password, clientNonce, msg.data ?? "")));
              return;
            case "authenticationMD5Password": {
              const inner = crypto.createHash("md5").update(password + user).digest("hex");
              const outer = crypto.createHash("md5").update(Buffer.concat([Buffer.from(inner), msg.salt ?? Buffer.alloc(0)])).digest("hex");
              this.socket.write(serialize.password(`md5${outer}`));
              return;
            }
            case "authenticationCleartextPassword":
              this.socket.write(serialize.password(password));
              return;
            case "error":
              fail(new PgError(msg.message ?? "connection refused", msg.code));
              return;
            case "readyForQuery":
              started = true;
              resolve();
              return;
            default:
              return;
          }
        }
        this.handle(msg);
      });
    });
  }

  connected(): Promise<void> {
    return this.ready;
  }

  isClosed(): boolean {
    return this.closed;
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.queue.splice(0)) pending.reject(error);
    this.socket.destroy();
    this.onClose?.();
  }

  private handle(msg: Message) {
    if (msg.name === "notification") {
      this.onNotification?.(msg.channel ?? "", msg.payload ?? "");
      return;
    }
    const current = this.queue[0];
    if (!current) return;
    switch (msg.name) {
      case "rowDescription":
        current.fields = (msg.fields as { name: string; dataTypeID: number }[]).map((f) => ({ name: f.name, type: f.dataTypeID }));
        return;
      case "dataRow": {
        const row: Row = {};
        (msg.fields as (string | null)[]).forEach((value, i) => {
          const field = current.fields[i];
          if (field) row[field.name] = decode(field.type, value);
        });
        current.rows.push(row);
        return;
      }
      case "commandComplete": {
        const match = /(\d+)$/.exec(msg.text ?? "");
        current.count = match ? Number(match[1]) : 0;
        return;
      }
      case "error":
        current.error = new PgError(msg.message ?? "query failed", msg.code);
        return;
      case "readyForQuery":
        this.queue.shift();
        if (current.error) current.reject(current.error);
        else current.resolve({ rows: current.rows, count: current.count });
        return;
      default:
        return;
    }
  }

  query(text: string, values: readonly SqlValue[] = []): Promise<{ rows: Row[]; count: number }> {
    if (this.closed) return Promise.reject(new Error("connection closed"));
    return new Promise((resolve, reject) => {
      this.queue.push({ rows: [], fields: [], count: 0, error: null, resolve, reject });
      this.socket.write(
        Buffer.concat([
          serialize.parse({ text }),
          serialize.bind({ values: values.map(encode) }),
          serialize.describe({ type: "P" }),
          serialize.execute(),
          serialize.sync(),
        ]),
      );
    });
  }

  simple(text: string): Promise<{ rows: Row[]; count: number }> {
    return new Promise((resolve, reject) => {
      this.queue.push({ rows: [], fields: [], count: 0, error: null, resolve, reject });
      this.socket.write(serialize.query(text));
    });
  }

  end() {
    if (this.closed) return;
    this.socket.write(serialize.end());
    this.fail(new Error("connection ended"));
  }
}

export class Pool {
  private idle: Connection[] = [];
  private size = 0;
  private waiting: ((connection: Connection) => void)[] = [];
  private url: URL;

  constructor(url: string, private readonly max: number) {
    this.url = new URL(url);
  }

  async connect(): Promise<Connection> {
    const connection = new Connection(this.url);
    await connection.connected();
    return connection;
  }

  private async acquire(): Promise<Connection> {
    const idle = this.idle.pop();
    if (idle) return idle;
    if (this.size < this.max) {
      this.size += 1;
      try {
        const connection = await this.connect();
        connection.onClose = () => {
          this.size -= 1;
          this.idle = this.idle.filter((c) => c !== connection);
        };
        return connection;
      } catch (error) {
        this.size -= 1;
        throw error;
      }
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(connection: Connection) {
    if (connection.isClosed()) {
      const next = this.waiting.shift();
      if (next) void this.acquire().then(next);
      return;
    }
    const next = this.waiting.shift();
    if (next) next(connection);
    else this.idle.push(connection);
  }

  async with<T>(work: (connection: Connection) => Promise<T>): Promise<T> {
    const connection = await this.acquire();
    try {
      return await work(connection);
    } finally {
      this.release(connection);
    }
  }
}
