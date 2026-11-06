// src/server/config.ts
function num(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0 || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
function str(name, fallback) {
  const raw = process.env[name];
  return raw === void 0 || raw === "" ? fallback : raw;
}
function readConfig() {
  return {
    databaseUrl: str("DATABASE_URL", "postgresql://localhost:5432/clapstick"),
    s3: {
      endpoint: str("S3_ENDPOINT", "http://localhost:9000"),
      region: str("S3_REGION", "us-east-1"),
      bucket: str("S3_BUCKET", "clapstick"),
      forcePathStyle: str("S3_FORCE_PATH_STYLE", "true") !== "false",
      accessKeyId: str("S3_ACCESS_KEY_ID", ""),
      secretAccessKey: str("S3_SECRET_ACCESS_KEY", "")
    },
    smtp: {
      host: str("SMTP_HOST", "localhost"),
      port: num("SMTP_PORT", 1025),
      from: str("MAIL_FROM", "Noor Bakker Boards <desk@noorbakkerboards.example>")
    },
    wiremockUrl: str("WIREMOCK_URL", "http://localhost:8080"),
    gotenbergUrl: str("GOTENBERG_URL", "http://localhost:3000"),
    appPublicPort: num("APP_PUBLIC_PORT", 4173),
    appPublicUrl: str("APP_PUBLIC_URL", "http://127.0.0.1:4173"),
    timers: {
      sessionSeconds: num("SESSION_SECONDS", 28800),
      undoSeconds: num("UNDO_SECONDS", 10),
      cueCacheSeconds: num("CUE_CACHE_SECONDS", 300),
      reviewPageSeconds: num("REVIEW_PAGE_SECONDS", 1209600),
      signOffPageSeconds: num("SIGN_OFF_PAGE_SECONDS", 1209600),
      feePageSeconds: num("FEE_PAGE_SECONDS", 1209600),
      reminderAfterSeconds: num("REMINDER_AFTER_SECONDS", 604800),
      enquiryRateWindowSeconds: num("ENQUIRY_RATE_WINDOW_SECONDS", 3600),
      reviewLinkRateWindowSeconds: num("REVIEW_LINK_RATE_WINDOW_SECONDS", 3600),
      fileRateWindowSeconds: num("FILE_RATE_WINDOW_SECONDS", 3600),
      closureWaitSeconds: num("CLOSURE_WAIT_SECONDS", 2592e3)
    }
  };
}

// src/server/db.ts
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import net from "node:net";
var Db = class {
  constructor(config) {
    this.config = config;
  }
  conn = null;
  async query(text, params) {
    const conn = await this.connection();
    return conn.query(text, params);
  }
  async one(text, params) {
    const rows = await this.query(text, params);
    return rows.length === 0 ? null : rows[0];
  }
  async many(text, params) {
    return this.query(text, params);
  }
  async connection() {
    if (this.conn === null || this.conn.closed) {
      this.conn = await Connection.open(this.config);
    }
    return this.conn;
  }
};
var Connection = class _Connection {
  constructor(sock) {
    this.sock = sock;
    sock.on("data", (chunk) => {
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
  closed = false;
  buffer = Buffer.alloc(0);
  rows = [];
  names = [];
  pending = null;
  static async open(config) {
    const url = new URL(config.databaseUrl);
    const host = url.hostname;
    const port = Number(url.port || 5432);
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const database = url.pathname.replace(/^\//, "") || "postgres";
    const sock = await netConnect(port, host);
    const conn = new _Connection(sock);
    const body = Buffer.concat([
      int32(196608),
      cstring("user"),
      cstring(user),
      cstring("database"),
      cstring(database),
      int8(0)
    ]);
    await conn.writeRaw(Buffer.concat([int32(body.length + 4), body]));
    const mechanisms = await conn.expectAuthRequest();
    if (!mechanisms.includes("SCRAM-SHA-256")) throw new Error("unsupported auth");
    const clientNonce = randomBytes(18).toString("base64");
    const clientFirstBare = `n=,r=${clientNonce}`;
    const scramMessage = Buffer.from(`n,,${clientFirstBare}`, "utf8");
    const init = typed("p", Buffer.concat([cstring("SCRAM-SHA-256"), int32(scramMessage.length), scramMessage]));
    await conn.writeRaw(init);
    const serverFirst = await conn.expectAuthContinue();
    const attrs = parseScram(serverFirst);
    const serverNonce = attrs.r;
    const salt = Buffer.from(attrs.s, "base64");
    const iterations = Number(attrs.i);
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
  async query(text, params) {
    this.rows = [];
    const parts = [];
    const parseBody = Buffer.concat([int8(0), cstring(text), int16(0)]);
    parts.push(typed("P", parseBody));
    const bindParts = [cstring(""), cstring("")];
    bindParts.push(int16(0));
    bindParts.push(int16(params.length));
    for (const p of params) {
      if (p === null || p === void 0) {
        bindParts.push(int32(-1));
        continue;
      }
      const encoded = encodeParam(p);
      bindParts.push(int32(Buffer.byteLength(encoded)), Buffer.from(encoded, "utf8"));
    }
    bindParts.push(int16(0));
    parts.push(typed("B", Buffer.concat(bindParts)));
    parts.push(typed("D", Buffer.concat([int8(80), cstring("")])));
    parts.push(typed("E", Buffer.concat([cstring(""), int32(0)])));
    parts.push(typed("S", Buffer.alloc(0)));
    const result = new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
    await this.writeRaw(Buffer.concat(parts));
    await this.pumpFlow();
    return result;
  }
  // Reads messages until the pending query is settled: rows accumulate, an
  // error rejects it, and the ready-for-query message resolves it.
  async pumpFlow() {
    for (; ; ) {
      const { type, body } = await this.readRawMessage();
      if (type === "T") {
        this.names = [];
        const count = body.readInt16BE(0);
        let at = 2;
        for (let i = 0; i < count; i++) {
          const zero = body.indexOf(0, at);
          this.names.push(body.subarray(at, zero).toString("utf8"));
          at = zero + 1;
          at += 4;
          at += 2;
          at += 4;
          at += 2;
          at += 4;
          at += 2;
        }
        continue;
      }
      if (type === "D") {
        const count = body.readInt16BE(0);
        let at = 2;
        const row = {};
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
    }
  }
  async writeRaw(buf) {
    return new Promise((resolve, reject) => {
      this.sock.write(buf, (err) => err ? reject(err) : resolve());
    });
  }
  async expectAuthRequest() {
    for (; ; ) {
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
  async expectAuthContinue() {
    for (; ; ) {
      const msg = await this.readRawMessage();
      if (msg.type === "R") {
        const code = msg.body.readInt32BE(0);
        if (code === 11) return msg.body.subarray(4).toString("utf8");
        throw new Error("unexpected auth flow");
      }
      if (msg.type === "E") throw new Error(parseError(msg.body).message);
    }
  }
  async expectAuthOk() {
    for (; ; ) {
      const msg = await this.readRawMessage();
      if (msg.type === "R") {
        const code = msg.body.readInt32BE(0);
        if (code === 0 || code === 12) continue;
        throw new Error("unexpected auth flow");
      }
      if (msg.type === "Z") return;
      if (msg.type === "E") throw new Error(parseError(msg.body).message);
    }
  }
  // Reads one message off the wire, without interpreting it.
  async readRawMessage() {
    for (; ; ) {
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
  wake() {
    this.waiters.forEach((w) => w());
    this.waiters = [];
  }
  waiters = [];
  waitForData() {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
};
async function netConnect(port, host) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ port, host }, () => resolve(sock));
    sock.on("error", reject);
  });
}
function typed(type, body) {
  return Buffer.concat([Buffer.from(type, "latin1"), int32(body.length + 4), body]);
}
function int8(v) {
  const b = Buffer.alloc(1);
  b.writeUInt8(v, 0);
  return b;
}
function int16(v) {
  const b = Buffer.alloc(2);
  b.writeInt16BE(v, 0);
  return b;
}
function int32(v) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v, 0);
  return b;
}
function cstring(s) {
  return Buffer.concat([Buffer.from(s, "utf8"), int8(0)]);
}
function hi(password, salt, iterations) {
  return pbkdf2Sync(password, salt, iterations, 32, "sha256");
}
function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}
function parseScram(text) {
  const out = {};
  for (const part of text.split(",")) {
    const eq = part.indexOf("=");
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}
function encodeParam(p) {
  if (p === null || p === void 0) return "";
  if (typeof p === "boolean") return p ? "t" : "f";
  if (p instanceof Date) return p.toISOString();
  if (p instanceof Uint8Array) return Buffer.from(p).toString("utf8");
  if (typeof p === "number") return String(p);
  return String(p);
}
function parseError(body) {
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

// tools/wipe.ts
var cfg = readConfig();
var db = new Db(cfg);
var tables = [
  "job_history",
  "package_files",
  "packages",
  "letters",
  "notes",
  "attachments",
  "review_sends",
  "review_names",
  "reviews",
  "sign_offs",
  "renders",
  "cues",
  "lines",
  "removals",
  "cut_frames",
  "cuts",
  "frames",
  "board_stamps",
  "jobs",
  "producers",
  "clients",
  "sessions",
  "ended_sessions",
  "enquiries",
  "enquiry_rates",
  "link_rates",
  "file_rates",
  "cue_cache",
  "pending_mail",
  "desks"
];
for (const table of tables) {
  await db.query("delete from " + table, []);
}
console.log("wiped");
process.exit(0);
