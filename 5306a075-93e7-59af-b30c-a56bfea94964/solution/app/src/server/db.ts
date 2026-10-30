// PostgreSQL access: a small pool of connections speaking the wire protocol through pg-protocol.
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { connect, type Socket } from "node:net";
import { DatabaseError, parse, serialize } from "pg-protocol";
import type { BackendMessage } from "pg-protocol/dist/messages.js";
import { config } from "./config.js";

export type SqlValue = string | number | boolean | null | Date | Buffer | readonly string[] | Record<string, unknown>;
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(text: string, values?: readonly SqlValue[]): Promise<T[]>;
}


interface Target {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function targetFrom(url: string): Target {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port === "" ? 5432 : Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
}

// Text-format values are decoded by type OID; everything else stays a string.
function decodeValue(oid: number, raw: string): unknown {
  switch (oid) {
    case 16: return raw === "t";
    case 20: case 21: case 23: case 26: case 700: case 701: case 1700: return Number(raw);
    case 17: return Buffer.from(raw.slice(2), "hex");
    case 114: case 3802: return JSON.parse(raw);
    case 1114: case 1184: return new Date(raw.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
    default: return raw;
  }
}

function encodeValue(value: SqlValue): string | Buffer | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString("hex")}`;
  if (Array.isArray(value)) return `{${value.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function hasData(message: BackendMessage): message is BackendMessage & { data: string } {
  return "data" in message && typeof (message as { data?: unknown }).data === "string";
}

class Connection implements Queryable {
  private readonly socket: Socket;
  private waiting: ((message: BackendMessage) => void) | null = null;
  private readonly inbox: BackendMessage[] = [];
  private failure: Error | null = null;
  broken = false;

  private constructor(socket: Socket) {
    this.socket = socket;
    void parse(socket, (message) => this.deliver(message));
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("PostgreSQL connection closed")));
  }

  static async open(target: Target): Promise<Connection> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const s = connect({ host: target.host, port: target.port });
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
    socket.setNoDelay(true);
    const connection = new Connection(socket);
    await connection.startup(target);
    return connection;
  }

  private deliver(message: BackendMessage): void {
    if (message.name === "notice" || message.name === "parameterStatus" || message.name === "backendKeyData") return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(message);
    } else {
      this.inbox.push(message);
    }
  }

  private fail(error: Error): void {
    this.broken = true;
    this.failure ??= error;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ name: "error", length: 0 });
    }
  }

  private next(): Promise<BackendMessage> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    if (this.broken) return Promise.reject(this.failure ?? new Error("PostgreSQL connection lost"));
    return new Promise((resolve) => { this.waiting = resolve; });
  }

  private async expect(): Promise<BackendMessage> {
    const message = await this.next();
    if (this.broken && message.length === 0 && message.name === "error") throw this.failure ?? new Error("PostgreSQL connection lost");
    return message;
  }

  private async startup(target: Target): Promise<void> {
    this.socket.write(serialize.startup({ user: target.user, database: target.database, client_encoding: "UTF8", TimeZone: "UTC" }));
    let clientNonce = "";
    let serverSignature = "";
    for (;;) {
      const message = await this.expect();
      if (message instanceof DatabaseError) throw message;
      if (message.name === "authenticationCleartextPassword") {
        this.socket.write(serialize.password(target.password));
      } else if (message.name === "authenticationMD5Password" && "salt" in message && Buffer.isBuffer(message.salt)) {
        const inner = createHash("md5").update(target.password + target.user).digest("hex");
        const outer = createHash("md5").update(Buffer.concat([Buffer.from(inner), message.salt])).digest("hex");
        this.socket.write(serialize.password(`md5${outer}`));
      } else if (message.name === "authenticationSASL") {
        clientNonce = randomBytes(18).toString("base64");
        this.socket.write(serialize.sendSASLInitialResponseMessage("SCRAM-SHA-256", `n,,n=*,r=${clientNonce}`));
      } else if (message.name === "authenticationSASLContinue" && hasData(message)) {
        const fields = Object.fromEntries(message.data.split(",").map((part) => [part[0], part.slice(2)]));
        const nonce = fields.r ?? "";
        if (!nonce.startsWith(clientNonce)) throw new Error("PostgreSQL SCRAM nonce mismatch");
        const salted = pbkdf2Sync(target.password, Buffer.from(fields.s ?? "", "base64"), Number(fields.i), 32, "sha256");
        const clientKey = createHmac("sha256", salted).update("Client Key").digest();
        const storedKey = createHash("sha256").update(clientKey).digest();
        const withoutProof = `c=biws,r=${nonce}`;
        const authMessage = `n=*,r=${clientNonce},${message.data},${withoutProof}`;
        const signature = createHmac("sha256", storedKey).update(authMessage).digest();
        const proof = Buffer.from(clientKey.map((byte, i) => byte ^ (signature[i] ?? 0))).toString("base64");
        const serverKey = createHmac("sha256", salted).update("Server Key").digest();
        serverSignature = createHmac("sha256", serverKey).update(authMessage).digest("base64");
        this.socket.write(serialize.sendSCRAMClientFinalMessage(`${withoutProof},p=${proof}`));
      } else if (message.name === "authenticationSASLFinal" && hasData(message)) {
        const verifier = Buffer.from(message.data.replace(/^v=/, ""));
        const expected = Buffer.from(serverSignature);
        if (verifier.length !== expected.length || !timingSafeEqual(verifier, expected)) {
          throw new Error("PostgreSQL server signature mismatch");
        }
      } else if (message.name === "readyForQuery") {
        return;
      }
    }
  }

  private turn: Promise<unknown> = Promise.resolve();

  /** One statement at a time per connection: later calls wait for earlier ones. */
  query<T = Row>(text: string, values: readonly SqlValue[] = []): Promise<T[]> {
    const result = this.turn.then(() => this.run<T>(text, values));
    this.turn = result.catch(() => undefined);
    return result;
  }

  private async run<T>(text: string, values: readonly SqlValue[]): Promise<T[]> {
    this.socket.write(Buffer.concat([
      serialize.parse({ text }),
      serialize.bind({ values: values.map(encodeValue) }),
      serialize.describe({ type: "P" }),
      serialize.execute(),
      serialize.sync(),
    ]));
    let fields: { name: string; dataTypeID: number }[] = [];
    const rows: T[] = [];
    let error: DatabaseError | null = null;
    for (;;) {
      const message = await this.expect();
      if (message instanceof DatabaseError) {
        error = message;
      } else if (message.name === "rowDescription" && "fields" in message && Array.isArray(message.fields)) {
        fields = message.fields as { name: string; dataTypeID: number }[];
      } else if (message.name === "dataRow" && "fields" in message && Array.isArray(message.fields)) {
        const raw = message.fields as (string | null)[];
        const row: Row = {};
        fields.forEach((field, i) => {
          const value = raw[i];
          row[field.name] = value === null || value === undefined ? null : decodeValue(field.dataTypeID, value);
        });
        rows.push(row as T & Row);
      } else if (message.name === "readyForQuery") {
        if (error) throw error;
        return rows;
      }
    }
  }

  close(): void {
    this.socket.end(serialize.end());
  }
}

class Pool implements Queryable {
  private readonly idle: Connection[] = [];
  private readonly queue: ((connection: Connection) => void)[] = [];
  private open = 0;

  constructor(private readonly target: Target, private readonly size: number) {}

  private async acquire(): Promise<Connection> {
    let connection: Connection | undefined;
    while ((connection = this.idle.pop())) {
      if (!connection.broken) return connection;
      this.open -= 1;
    }
    if (this.open < this.size) {
      this.open += 1;
      try {
        return await Connection.open(this.target);
      } catch (error) {
        this.open -= 1;
        throw error;
      }
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(connection: Connection): void {
    if (connection.broken) {
      this.open -= 1;
      connection.close();
      const waiter = this.queue.shift();
      if (waiter) void this.acquire().then(waiter);
      return;
    }
    const waiter = this.queue.shift();
    if (waiter) waiter(connection);
    else this.idle.push(connection);
  }

  async query<T = Row>(text: string, values: readonly SqlValue[] = []): Promise<T[]> {
    const connection = await this.acquire();
    try {
      return await connection.query<T>(text, values);
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
        if (!connection.broken) await connection.query("ROLLBACK");
        throw error;
      }
    } finally {
      this.release(connection);
    }
  }
}

export const db = new Pool(targetFrom(config.databaseUrl), 16);

/** True when PostgreSQL rejected a row because a unique index already holds its key. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof DatabaseError && error.code === "23505";
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await db.query("SELECT 1");
      return;
    } catch (error) {
      console.log(`waiting for PostgreSQL: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
