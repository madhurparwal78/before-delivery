var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/server/main.ts
import http from "http";

// src/server/config.ts
function num(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0 || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
__name(num, "num");
function str(name, fallback) {
  const raw = process.env[name];
  return raw === void 0 || raw === "" ? fallback : raw;
}
__name(str, "str");
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
__name(readConfig, "readConfig");

// src/server/db.ts
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "crypto";
import net from "net";
var Db = class {
  constructor(config2) {
    this.config = config2;
  }
  static {
    __name(this, "Db");
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
  static {
    __name(this, "Connection");
  }
  closed = false;
  buffer = Buffer.alloc(0);
  rows = [];
  names = [];
  pending = null;
  static async open(config2) {
    const url = new URL(config2.databaseUrl);
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
__name(netConnect, "netConnect");
function typed(type, body) {
  return Buffer.concat([Buffer.from(type, "latin1"), int32(body.length + 4), body]);
}
__name(typed, "typed");
function int8(v) {
  const b = Buffer.alloc(1);
  b.writeUInt8(v, 0);
  return b;
}
__name(int8, "int8");
function int16(v) {
  const b = Buffer.alloc(2);
  b.writeInt16BE(v, 0);
  return b;
}
__name(int16, "int16");
function int32(v) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v, 0);
  return b;
}
__name(int32, "int32");
function cstring(s) {
  return Buffer.concat([Buffer.from(s, "utf8"), int8(0)]);
}
__name(cstring, "cstring");
function hi(password, salt, iterations) {
  return pbkdf2Sync(password, salt, iterations, 32, "sha256");
}
__name(hi, "hi");
function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}
__name(xor, "xor");
function parseScram(text) {
  const out = {};
  for (const part of text.split(",")) {
    const eq = part.indexOf("=");
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}
__name(parseScram, "parseScram");
function encodeParam(p) {
  if (p === null || p === void 0) return "";
  if (typeof p === "boolean") return p ? "t" : "f";
  if (p instanceof Date) return p.toISOString();
  if (p instanceof Uint8Array) return Buffer.from(p).toString("utf8");
  if (typeof p === "number") return String(p);
  return String(p);
}
__name(encodeParam, "encodeParam");
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
__name(parseError, "parseError");

// src/server/store.ts
import { createHash as createHash2, createHmac as createHmac2 } from "crypto";
var Store = class {
  constructor(config2) {
    this.config = config2;
  }
  static {
    __name(this, "Store");
  }
  endpoint() {
    return new URL(this.config.s3.endpoint);
  }
  // Signed request to the object store; the credentials come from the
  // environment and never reach the browser.
  async signed(method, key, body, contentType, extraHeaders = {}) {
    const url = this.endpoint();
    const path = `/${this.config.s3.bucket}/${key}`.split("/").map((part, i) => i === 0 ? part : encodeURIComponent(part)).join("/");
    const target = `${url.protocol}//${url.host}${path}`;
    const now2 = /* @__PURE__ */ new Date();
    const amzDate = `${now2.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "")}`;
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash2("sha256").update(body ?? Buffer.alloc(0)).digest("hex");
    const host = url.host;
    const headers = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...extraHeaders
    };
    if (contentType !== null) headers["content-type"] = contentType;
    const signedHeadersList = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}
`).join("");
    const canonicalRequest = [method, new URL(target).pathname, "", canonicalHeaders, signedHeadersList, payloadHash].join("\n");
    const scope = `${dateStamp}/${this.config.s3.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash2("sha256").update(canonicalRequest).digest("hex")].join("\n");
    const kDate = createHmac2("sha256", `AWS4${this.config.s3.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac2("sha256", kDate).update(this.config.s3.region).digest();
    const kService = createHmac2("sha256", kRegion).update("s3").digest();
    const kSigning = createHmac2("sha256", kService).update("aws4_request").digest();
    const signature = createHmac2("sha256", kSigning).update(stringToSign).digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.s3.accessKeyId}/${scope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
    return await fetch(target, {
      method,
      headers: { ...headers, authorization },
      body: body ?? void 0
    });
  }
  // Makes the bucket when it is missing, so several copies can start together.
  async ensureBucket() {
    try {
      const url = this.endpoint();
      const res = await fetch(`${url.protocol}//${url.host}/${this.config.s3.bucket}`, { method: "HEAD" });
      if (res.status === 200 || res.status === 403) return { ok: true };
      if (res.status === 404) {
        const created = await fetch(`${url.protocol}//${url.host}/${this.config.s3.bucket}`, { method: "PUT" });
        return created.status < 300 ? { ok: true } : { ok: false };
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
  async put(key, data, contentType) {
    try {
      const res = await this.signed("PUT", key, data, contentType);
      return res.ok ? { ok: true } : { ok: false };
    } catch {
      return { ok: false };
    }
  }
  async get(key) {
    try {
      const res = await this.signed("GET", key, null, null);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  async remove(key) {
    try {
      const res = await this.signed("DELETE", key, null, null);
      return res.status === 204 || res.ok ? { ok: true } : { ok: false };
    } catch {
      return { ok: false };
    }
  }
  async exists(key) {
    try {
      const res = await this.signed("HEAD", key, null, null);
      return res.status === 200;
    } catch {
      return false;
    }
  }
};

// src/shared/svg.ts
var WIDTH = 1280;
var HEIGHT = 720;
function seedOf(text) {
  let h = 2166136261;
  for (const byte of Buffer.from(text, "utf8")) {
    h ^= byte;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
__name(seedOf, "seedOf");
function rand(seed2) {
  let s = seed2;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
__name(rand, "rand");
function frameDrawingSvg(frameNumber, actionNote) {
  const seed2 = seedOf(`${frameNumber}:${actionNote}`);
  const next = rand(seed2);
  const lines = [];
  lines.push(`<rect x="24" y="24" width="${WIDTH - 48}" height="${HEIGHT - 48}" fill="none" stroke="#1a1a1a" stroke-width="3"/>`);
  const horizon = 300 + Math.floor(next() * 220);
  lines.push(`<line x1="48" y1="${horizon}" x2="${WIDTH - 48}" y2="${horizon - Math.floor(next() * 60)}" stroke="#1a1a1a" stroke-width="2"/>`);
  const shapes = 3 + Math.floor(next() * 3);
  for (let i = 0; i < shapes; i++) {
    const x = 80 + Math.floor(next() * (WIDTH - 200));
    const y = horizon - Math.floor(next() * 180);
    const w = 60 + Math.floor(next() * 260);
    const h = 40 + Math.floor(next() * 200);
    if (next() > 0.5) {
      lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`);
    } else {
      lines.push(`<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 2}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`);
    }
  }
  const ax = 160 + Math.floor(next() * 500);
  const ay = horizon + 60 + Math.floor(next() * 160);
  lines.push(`<path d="M ${ax} ${ay} C ${ax + 140} ${ay - 70}, ${ax + 260} ${ay + 40}, ${ax + 380} ${ay - 30}" fill="none" stroke="#b3261e" stroke-width="6" stroke-linecap="round"/>`);
  lines.push(`<path d="M ${ax + 380} ${ay - 30} l -34 -6 l 14 30 z" fill="#b3261e"/>`);
  lines.push(`<line x1="48" y1="${HEIGHT - 60}" x2="${WIDTH - 200}" y2="${HEIGHT - 60}" stroke="#1a1a1a" stroke-width="2"/>`);
  const body = lines.join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
  ${body}
</svg>
`;
}
__name(frameDrawingSvg, "frameDrawingSvg");
function seededDrawingName(frameNumber) {
  return `frame-${frameNumber}.svg`;
}
__name(seededDrawingName, "seededDrawingName");

// src/shared/tz.ts
function townOffsetMinutes(town, at) {
  switch (town) {
    case "dubai":
      return 240;
    case "amsterdam":
      return inSummer(at, euStart, euEnd) ? 120 : 60;
    case "newYork":
    case "toronto":
      return inSummer(at, naStart, naEnd) ? -240 : -300;
  }
}
__name(townOffsetMinutes, "townOffsetMinutes");
function euStart(year) {
  return lastSundayUtc(year, 2, 1);
}
__name(euStart, "euStart");
function euEnd(year) {
  return lastSundayUtc(year, 9, 1);
}
__name(euEnd, "euEnd");
function naStart(year) {
  return nthSundayUtc(year, 2, 2, 7);
}
__name(naStart, "naStart");
function naEnd(year) {
  return nthSundayUtc(year, 10, 1, 6);
}
__name(naEnd, "naEnd");
function lastSundayUtc(year, monthIndex0, hourUtc) {
  const d = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc) / 1e3);
}
__name(lastSundayUtc, "lastSundayUtc");
function nthSundayUtc(year, monthIndex0, n, hourUtc) {
  const d = new Date(Date.UTC(year, monthIndex0, 1));
  const firstSunday = 1 + (7 - d.getUTCDay()) % 7;
  return Math.floor(Date.UTC(year, monthIndex0, firstSunday + (n - 1) * 7, hourUtc) / 1e3);
}
__name(nthSundayUtc, "nthSundayUtc");
function inSummer(at, startOf, endOf) {
  const year = new Date(at * 1e3).getUTCFullYear();
  for (const y of [year - 1, year, year + 1]) {
    const start = startOf(y);
    const end = endOf(y);
    if (at >= start && at < end) return true;
  }
  return false;
}
__name(inSummer, "inSummer");
function pad(n) {
  return n.toString().padStart(2, "0");
}
__name(pad, "pad");
function sameWall(town, at, date, h, m) {
  const local = at + townOffsetMinutes(town, at) * 60;
  const d = new Date(local * 1e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` === date && d.getUTCHours() === h && d.getUTCMinutes() === m;
}
__name(sameWall, "sameWall");
function instantOfWall(town, date, time) {
  const h = Number(time.slice(0, 2));
  const m = Number(time.slice(3, 5));
  const naive = Math.floor(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      h,
      m
    ) / 1e3
  );
  const matches = [];
  for (const minutes of [240, 180, 120, 60, 0, -60, -120, -180, -240, -300, -360]) {
    const at = naive - minutes * 60;
    if (sameWall(town, at, date, h, m)) matches.push(at);
  }
  if (matches.length === 0) return null;
  return Math.min(...matches);
}
__name(instantOfWall, "instantOfWall");
function wallTime(town, at) {
  const d = new Date((at + townOffsetMinutes(town, at) * 60) * 1e3);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
__name(wallTime, "wallTime");
function wallDate(town, at) {
  const d = new Date((at + townOffsetMinutes(town, at) * 60) * 1e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
__name(wallDate, "wallDate");
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function longDate(town, at) {
  const d = new Date((at + townOffsetMinutes(town, at) * 60) * 1e3);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
__name(longDate, "longDate");
function instantText(at) {
  const d = new Date(at * 1e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}
__name(instantText, "instantText");
function dateOnly(date) {
  return Math.floor(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1e3
  );
}
__name(dateOnly, "dateOnly");
function weekStartOfAmsterdam(at) {
  const d = new Date((at + townOffsetMinutes("amsterdam", at) * 60) * 1e3);
  const back = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}
__name(weekStartOfAmsterdam, "weekStartOfAmsterdam");
function addDays(date, days) {
  const d = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  );
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
__name(addDays, "addDays");

// src/server/http.ts
import { randomUUID, createHash as createHash3, timingSafeEqual } from "crypto";
var HttpError = class extends Error {
  constructor(status, code, message, fields = null, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }
  static {
    __name(this, "HttpError");
  }
};
function errorBody(code, message, fields) {
  const error = { code, message };
  if (fields !== null) error.fields = fields;
  return JSON.stringify({ error });
}
__name(errorBody, "errorBody");
function throwJson(status, code, message, fields = null) {
  throw new HttpError(status, code, message, fields);
}
__name(throwJson, "throwJson");
function jsonResponse(status, value) {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(value)
  };
}
__name(jsonResponse, "jsonResponse");
function emptyResponse(status) {
  return { status, headers: {}, body: null };
}
__name(emptyResponse, "emptyResponse");
function bytesResponse(status, contentType, body, extra = {}) {
  return { status, headers: { "content-type": contentType, ...extra }, body };
}
__name(bytesResponse, "bytesResponse");
function textResponse(status, contentType, text, extra = {}) {
  return { status, headers: { "content-type": contentType, ...extra }, body: text };
}
__name(textResponse, "textResponse");
function now() {
  return Math.floor(Date.now() / 1e3);
}
__name(now, "now");
function hashPassword(password, salt) {
  return createHash3("sha256").update(`${salt}:${password}`).digest("hex");
}
__name(hashPassword, "hashPassword");
function passwordMatches(password, salt, hash) {
  const computed = Buffer.from(hashPassword(password, salt));
  const held = Buffer.from(hash);
  return computed.length === held.length && timingSafeEqual(computed, held);
}
__name(passwordMatches, "passwordMatches");
function newSalt() {
  return randomUUID().replace(/-/g, "");
}
__name(newSalt, "newSalt");
function newId() {
  return randomUUID();
}
__name(newId, "newId");
function newToken() {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
}
__name(newToken, "newToken");
var SESSION_COOKIE = "clapstick_session";
function cookieOf(value) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}
__name(cookieOf, "cookieOf");
function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax`;
}
__name(clearCookie, "clearCookie");
function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!match) return [];
  const boundary = `--${match[1] ?? match[2]}`;
  const parts = [];
  let at = body.indexOf(Buffer.from(boundary, "latin1"));
  while (at !== -1) {
    const start = at + boundary.length;
    if (body.subarray(start, start + 2).toString("latin1") === "--") break;
    const headEnd = body.indexOf(Buffer.from("\r\n\r\n", "latin1"), start);
    if (headEnd === -1) break;
    const head = body.subarray(start + 2, headEnd).toString("latin1");
    const next = body.indexOf(Buffer.from(boundary, "latin1"), headEnd);
    if (next === -1) break;
    const data = body.subarray(headEnd + 4, next - 2);
    const nameMatch = /name="([^"]*)"/.exec(head);
    const fileMatch = /filename="([^"]*)"/.exec(head);
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(head);
    parts.push({
      name: nameMatch ? nameMatch[1] : "",
      filename: fileMatch ? decodeMime(fileMatch[1]) : null,
      contentType: typeMatch ? typeMatch[1].trim() : null,
      data
    });
    at = next;
  }
  return parts;
}
__name(parseMultipart, "parseMultipart");
function decodeMime(text) {
  return text.replace(/\\(.)/g, "$1");
}
__name(decodeMime, "decodeMime");
function findFile(parts, name) {
  return parts.find((p) => p.name === name && p.filename !== null) ?? null;
}
__name(findFile, "findFile");
var JSON_BODY_LIMIT = 1e6;
var UPLOAD_BODY_LIMIT = 9e6;
var FRAME_FILE_LIMIT = 8e6;
var ATTACHMENT_FILE_LIMIT = 5e6;
function sha256Hex(data) {
  return createHash3("sha256").update(data).digest("hex");
}
__name(sha256Hex, "sha256Hex");
function jsonOf(req) {
  if (req.body.length === 0) return {};
  try {
    const parsed = JSON.parse(req.body.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throwJson(400, "malformedJson", "The body should be a JSON object.");
    }
    return parsed;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throwJson(400, "malformedJson", "The body should be a JSON object.");
  }
}
__name(jsonOf, "jsonOf");
function strOf(body, key) {
  const v = body[key];
  return typeof v === "string" ? v : null;
}
__name(strOf, "strOf");
function numOf(body, key) {
  const v = body[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
__name(numOf, "numOf");
function boolOf(body, key) {
  const v = body[key];
  return typeof v === "boolean" ? v : null;
}
__name(boolOf, "boolOf");
function dateOfText(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const d = /* @__PURE__ */ new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return text;
}
__name(dateOfText, "dateOfText");
function timeOfText(text) {
  if (!/^\d{2}:\d{2}$/.test(text)) return null;
  const h = Number(text.slice(0, 2));
  const m = Number(text.slice(3, 5));
  if (h > 23 || m > 59) return null;
  return text;
}
__name(timeOfText, "timeOfText");
function searchOf(q) {
  if (q === null) return null;
  const trimmed = q.trim();
  return trimmed.length === 0 ? null : trimmed;
}
__name(searchOf, "searchOf");
async function loadSession(db2, config2, cookie) {
  if (!cookie) return null;
  const value = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!value) return null;
  const token = value.slice(SESSION_COOKIE.length + 1);
  if (token.length === 0) return null;
  const row = await db2.one(
    "select id, desk_id, expires_at from sessions where token = $1",
    [token]
  );
  if (row === null) return null;
  const session = {
    id: String(row.id),
    deskId: String(row.desk_id),
    expiresAt: Number(row.expires_at)
  };
  if (session.expiresAt <= now()) {
    await db2.query(
      "insert into ended_sessions (token, at) values ($1, $2)",
      [token, String(now())]
    );
    await db2.query("delete from sessions where token = $1", [token]);
    return null;
  }
  return session;
}
__name(loadSession, "loadSession");
async function sessionEnded(db2, token) {
  const row = await db2.one("select token from ended_sessions where token = $1", [token]);
  return row !== null;
}
__name(sessionEnded, "sessionEnded");
async function createSession(db2, config2, deskId) {
  const token = newToken();
  const expiresAt = now() + config2.timers.sessionSeconds;
  await db2.query(
    "insert into sessions (id, desk_id, token, created_at, expires_at) values ($1, $2, $3, $4, $5)",
    [newId(), deskId, token, String(now()), String(expiresAt)]
  );
  return token;
}
__name(createSession, "createSession");
async function endSession(db2, token) {
  await db2.query("delete from sessions where token = $1", [token]);
}
__name(endSession, "endSession");
function tokenOfCookie(cookie) {
  if (!cookie) return null;
  const value = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!value) return null;
  const token = value.slice(SESSION_COOKIE.length + 1);
  return token.length === 0 ? null : token;
}
__name(tokenOfCookie, "tokenOfCookie");

// src/server/schema.ts
var SCHEMA = [
  `create table if not exists desks (
    id text primary key,
    name text not null,
    email text not null,
    password_salt text not null,
    password_hash text not null,
    created_at bigint not null
  )`,
  `create unique index if not exists desks_email on desks (lower(email))`,
  `create table if not exists sessions (
    id text primary key,
    desk_id text not null,
    token text not null,
    created_at bigint not null,
    expires_at bigint not null
  )`,
  `create index if not exists sessions_token on sessions (token)`,
  `create table if not exists ended_sessions (
    token text primary key,
    at bigint not null
  )`,
  `create table if not exists clients (
    id text primary key,
    desk_id text not null,
    name text not null,
    place text not null,
    state text not null,
    closes_at bigint,
    erased_at bigint,
    erasure_tried_at bigint,
    created_at bigint not null
  )`,
  `create index if not exists clients_desk on clients (desk_id)`,
  `create table if not exists producers (
    id text primary key,
    client_id text not null,
    name text not null,
    email text not null,
    town text not null,
    language text not null
  )`,
  `create index if not exists producers_client on producers (client_id)`,
  `create table if not exists jobs (
    id text primary key,
    desk_id text not null,
    client_id text not null,
    title text not null,
    ad_id text not null,
    due_date text not null,
    target_seconds int not null,
    frame_rate text not null,
    aspect text not null,
    state text not null,
    created_at bigint not null
  )`,
  `create index if not exists jobs_desk on jobs (desk_id)`,
  `create table if not exists frames (
    id text primary key,
    job_id text not null,
    number int not null,
    position int not null,
    duration_frames int not null,
    action_note text not null,
    audio_note text not null,
    shot text not null,
    visual text not null,
    file_name text,
    width int,
    height int,
    sha256 text,
    seeded boolean not null default false,
    created_at bigint not null
  )`,
  `create index if not exists frames_job on frames (job_id)`,
  `create unique index if not exists frames_job_number on frames (job_id, number)`,
  `create table if not exists cuts (
    id text primary key,
    job_id text not null,
    number int not null,
    name text not null,
    frame_rate text not null,
    created_at bigint not null,
    signed_off_at bigint,
    signed_off_by text
  )`,
  `create index if not exists cuts_job on cuts (job_id)`,
  `create table if not exists cut_frames (
    cut_id text not null,
    frame_id text not null,
    frame_number int not null,
    position int not null,
    duration_frames int not null,
    action_note text not null,
    audio_note text not null,
    shot text not null,
    visual text not null,
    file_name text,
    width int,
    height int,
    sha256 text,
    seeded boolean not null default false
  )`,
  `create index if not exists cut_frames_cut on cut_frames (cut_id)`,
  `create table if not exists board_stamps (
    job_id text primary key,
    stamp text not null,
    frame_rate text not null
  )`,
  `create table if not exists lines (
    id text primary key,
    job_id text not null,
    frame int not null,
    market text not null,
    text text not null,
    x numeric not null,
    y numeric not null,
    width numeric not null,
    height numeric not null,
    clips int not null
  )`,
  `create index if not exists lines_job on lines (job_id)`,
  `create table if not exists cues (
    id text primary key,
    job_id text not null,
    track_id text not null,
    title text not null,
    composer text not null,
    seconds int not null,
    market text not null,
    from_date text not null,
    until_date text not null,
    fee numeric not null,
    licence_id text not null,
    licence_text text not null
  )`,
  `create index if not exists cues_job on cues (job_id)`,
  `create table if not exists renders (
    id text primary key,
    job_id text not null,
    cut_id text not null,
    cut_number int not null,
    width int not null,
    burn_timecode boolean not null,
    state text not null,
    progress int not null,
    message text,
    size bigint,
    sha256 text,
    provider_id text,
    polled_at bigint,
    created_at bigint not null,
    stored_at bigint
  )`,
  `create index if not exists renders_job on renders (job_id)`,
  `create table if not exists reviews (
    id text primary key,
    job_id text not null,
    producer_id text not null,
    cut int not null,
    token text not null,
    state text not null,
    ends_at bigint not null,
    created_at bigint not null,
    reminder_sent_at bigint,
    reminded boolean not null default false
  )`,
  `create index if not exists reviews_job on reviews (job_id)`,
  `create index if not exists reviews_token on reviews (token)`,
  `create table if not exists review_names (
    review_id text primary key,
    name text not null
  )`,
  `create table if not exists sign_offs (
    id text primary key,
    job_id text not null,
    producer_id text not null,
    cut int not null,
    token text not null,
    state text not null,
    ends_at bigint not null,
    created_at bigint not null,
    signed_off_at bigint,
    signed_off_by text
  )`,
  `create index if not exists sign_offs_job on sign_offs (job_id)`,
  `create index if not exists sign_offs_token on sign_offs (token)`,
  `create table if not exists notes (
    id text primary key,
    job_id text not null,
    review_id text not null,
    producer_id text not null,
    frame int not null,
    x numeric not null,
    y numeric not null,
    text text not null,
    typed_name text not null,
    suggested_seconds numeric,
    suggested_frames int,
    attachment_id text,
    state text not null,
    created_at bigint not null
  )`,
  `create index if not exists notes_job on notes (job_id)`,
  `create table if not exists attachments (
    id text primary key,
    job_id text not null,
    producer_id text not null,
    content_type text not null
  )`,
  `create table if not exists calls (
    id text primary key,
    desk_id text not null,
    producer_id text not null,
    date text not null,
    time text not null,
    minutes int not null,
    note text not null,
    starts_at bigint not null,
    ends_at bigint not null,
    uid text not null,
    sequence int not null,
    state text not null
  )`,
  `create index if not exists calls_desk on calls (desk_id)`,
  `create table if not exists packages (
    id text primary key,
    job_id text not null,
    cut int not null,
    state text not null,
    created_at bigint not null
  )`,
  `create index if not exists packages_job on packages (job_id)`,
  `create table if not exists package_files (
    package_id text not null,
    kind text not null,
    file_name text not null,
    size bigint not null,
    sha256 text not null
  )`,
  `create table if not exists letters (
    id text primary key,
    job_id text not null,
    currency text not null,
    scope text not null,
    fee_minor bigint not null,
    tax_minor bigint not null,
    total_minor bigint not null,
    state text not null,
    stamp text not null,
    producer_id text,
    page_token text,
    page_ends_at bigint,
    pdf_stored_at bigint,
    created_at bigint not null,
    accepted_at bigint,
    accepted_by text
  )`,
  `create index if not exists letters_job on letters (job_id)`,
  `create index if not exists letters_token on letters (page_token)`,
  `create table if not exists job_history (
    id text primary key,
    job_id text not null,
    at bigint not null,
    actor text not null,
    action text not null,
    text text not null
  )`,
  `create index if not exists job_history_job on job_history (job_id, at, id)`,
  `create table if not exists pending_mail (
    id text primary key,
    to_address text not null,
    subject text not null,
    body text not null,
    html text,
    attachment_name text,
    attachment_type text,
    attachment text,
    created_at bigint not null
  )`,
  `create table if not exists enquiries (
    id text primary key,
    name text not null,
    email text not null,
    phone text,
    message text not null,
    created_at bigint not null
  )`,
  `create table if not exists review_sends (
    id text primary key,
    review_id text not null,
    send_key text not null
  )`,
  `create index if not exists review_sends_key on review_sends (send_key)`,
  `create table if not exists enquiry_rates (
    email_key text not null,
    at bigint not null
  )`,
  `create index if not exists enquiry_rates_key on enquiry_rates (email_key, at)`,
  `create table if not exists link_rates (
    email_key text not null,
    at bigint not null
  )`,
  `create index if not exists link_rates_key on link_rates (email_key, at)`,
  `create table if not exists file_rates (
    desk_id text not null,
    at bigint not null
  )`,
  `create index if not exists file_rates_desk on file_rates (desk_id, at)`,
  `create table if not exists removals (
    job_id text not null,
    frame int not null,
    frame_id text not null,
    position int not null,
    duration_frames int not null,
    action_note text not null,
    audio_note text not null,
    shot text not null,
    visual text not null,
    file_name text,
    width int,
    height int,
    sha256 text,
    seeded boolean not null default false,
    ends_at bigint not null
  )`,
  `create index if not exists removals_job on removals (job_id, ends_at)`,
  `create table if not exists cue_cache (
    key text primary key,
    at bigint not null,
    value text not null
  )`
];
var SEED_PASSWORD = "desk-pass-2027";
async function applySchema(db2) {
  for (const statement of SCHEMA) {
    await db2.query(statement, []);
  }
  await db2.query(
    "create or replace function fold_lower(t text) returns text language sql immutable as $$ select lower(t) $$",
    []
  );
}
__name(applySchema, "applySchema");
async function seed(config2, db2, store2) {
  const existing = await db2.one("select id from desks where email = $1", ["noor@noorbakkerboards.example"]);
  if (existing !== null) return;
  const start = Math.floor(Date.now() / 1e3);
  await seedDesk(config2, db2, start, {
    id: newId(),
    name: "Noor Bakker",
    email: "noor@noorbakkerboards.example",
    full: true
  });
  await seedDesk(config2, db2, start, {
    id: newId(),
    name: "Theo Lindqvist",
    email: "theo@noorbakkerboards.example",
    full: false
  });
}
__name(seed, "seed");
async function seedDesk(config2, db2, start, desk) {
  const salt = newSalt();
  await db2.query(
    "insert into desks (id, name, email, password_salt, password_hash, created_at) values ($1, $2, $3, $4, $5, $6)",
    [desk.id, desk.name, desk.email, salt, hashPassword(SEED_PASSWORD, salt), String(start)]
  );
  if (!desk.full) {
    const clientId = newId();
    await db2.query(
      "insert into clients (id, desk_id, name, place, state, closes_at, erased_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [clientId, desk.id, "Fjordlight Studio", "netherlands", "active", null, null, String(start)]
    );
    await seedJob(db2, {
      id: newId(),
      deskId: desk.id,
      clientId,
      title: "Quiet Harbour",
      adId: "FJOR0000401H",
      dueDate: addDays(shortDate(start), 21),
      targetSeconds: 15,
      frameRate: "25",
      state: "draft",
      start,
      frames: []
    });
    return;
  }
  const clients = await seedNoorClients(db2, desk.id, start);
  await seedNoorJobs(db2, desk.id, clients, start);
}
__name(seedDesk, "seedDesk");
async function seedNoorClients(db2, deskId, start) {
  const rows = [
    ["hudson", "Hudson Yard Pictures", "newYork", "Marcus Hale", "marcus.hale@hudsonyard.example", "newYork", "en"],
    ["noordzee", "STICHTINGNOORDZEEPRODUCTIESENPARTNERSHOOFDKANTOORAMSTERDAM", "netherlands", "Zo\xEB \xD8rsted", "zoe.orsted@noordzee.example", "amsterdam", "nl"],
    ["maple", "Maple & Lake Films", "ontario", "\xC9lodie Tremblay", "elodie.tremblay@mapleandlake.example", "toronto", "fr"],
    ["gulf", "Gulf Meridian Airways", "dubai", "\u0644\u064A\u0644\u0649 \u062D\u062F\u0627\u062F", "layla.haddad@gulfmeridian.example", "dubai", "ar"]
  ];
  const out = {};
  for (const [key, name, place, producerName, producerEmail, town, language] of rows) {
    const clientId = newId();
    const producerId = newId();
    await db2.query(
      "insert into clients (id, desk_id, name, place, state, closes_at, erased_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [clientId, deskId, name, place, "active", null, null, String(start)]
    );
    await db2.query(
      "insert into producers (id, client_id, name, email, town, language) values ($1, $2, $3, $4, $5, $6)",
      [producerId, clientId, producerName, producerEmail, town, language]
    );
    out[key] = { id: clientId, producer: producerId };
  }
  return out;
}
__name(seedNoorClients, "seedNoorClients");
async function seedNoorJobs(db2, deskId, clients, start) {
  const due = addDays(shortDate(start), 21);
  const harbourId = newId();
  await seedJob(db2, {
    id: harbourId,
    deskId,
    clientId: clients.hudson.id,
    title: "Harbour Light",
    adId: "HUDS0000301H",
    dueDate: due,
    targetSeconds: 30,
    frameRate: "29.97",
    state: "signedOff",
    start,
    frames: Array.from({ length: 12 }, () => ({ duration: 75 }))
  });
  const polderId = newId();
  await seedJob(db2, {
    id: polderId,
    deskId,
    clientId: clients.noordzee.id,
    title: "Polder Run",
    adId: "NOOR0000302H",
    dueDate: due,
    targetSeconds: 30,
    frameRate: "25",
    state: "draft",
    start,
    frames: [...Array.from({ length: 11 }, () => ({ duration: 62 })), { duration: 68 }]
  });
  const mapleId = newId();
  await seedJob(db2, {
    id: mapleId,
    deskId,
    clientId: clients.maple.id,
    title: "Maple Line",
    adId: "MAPL0000303H",
    dueDate: due,
    targetSeconds: 15,
    frameRate: "23.976",
    state: "inReview",
    start,
    frames: Array.from({ length: 12 }, () => ({ duration: 30 }))
  });
  const gulfId = newId();
  await seedJob(db2, {
    id: gulfId,
    deskId,
    clientId: clients.gulf.id,
    title: "Gulf Morning",
    adId: "GULF0000304D",
    dueDate: due,
    targetSeconds: 6,
    frameRate: "25",
    state: "draft",
    start,
    frames: Array.from({ length: 12 }, () => ({ duration: 12 }))
  });
  await seedExtras(db2, start, {
    harbourId,
    mapleId,
    polderId,
    producerHudson: clients.hudson.producer,
    producerMaple: clients.maple.producer
  });
}
__name(seedNoorJobs, "seedNoorJobs");
async function seedExtras(db2, start, ids) {
  const openNote = newId();
  const doneNote = newId();
  const reviewRow = await db2.one(
    "insert into reviews (id, job_id, producer_id, cut, token, state, ends_at, created_at, reminded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id",
    [openNote, ids.harbourId, ids.producerHudson, 1, newToken(), "ended", String(start - 1e3), String(start - 2e3), true]
  );
  await db2.query(
    "insert into notes (id, job_id, review_id, producer_id, frame, x, y, text, typed_name, suggested_seconds, suggested_frames, attachment_id, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    [newId(), ids.harbourId, openNote, ids.producerHudson, 4, "41.5", "62.0", "Hold the harbour light a beat longer.", "Marcus Hale", null, null, null, "open", String(start - 500)]
  );
  await db2.query(
    "insert into notes (id, job_id, review_id, producer_id, frame, x, y, text, typed_name, suggested_seconds, suggested_frames, attachment_id, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    [doneNote, ids.harbourId, openNote, ids.producerHudson, 4, "51.0", "58.5", "Bring the boat in from the left.", "Marcus Hale", null, null, null, "done", String(start - 600)]
  );
  await db2.query(
    "update cuts set signed_off_at = $1, signed_off_by = $2 where job_id = $3 and number = 1",
    [String(start - 100), "Marcus Hale", ids.harbourId]
  );
  const mapleReview = newId();
  await db2.query(
    "insert into reviews (id, job_id, producer_id, cut, token, state, ends_at, created_at, reminded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [mapleReview, ids.mapleId, ids.producerMaple, 2, newToken(), "ended", String(start - 1e3), String(start - 2e3), true]
  );
  await db2.query(
    "insert into notes (id, job_id, review_id, producer_id, frame, x, y, text, typed_name, suggested_seconds, suggested_frames, attachment_id, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    [newId(), ids.mapleId, mapleReview, ids.producerMaple, 4, "33.0", "71.0", "Le plan est un peu court.", "\xC9lodie Tremblay", null, null, null, "open", String(start - 400)]
  );
  await db2.query(
    "insert into cues (id, job_id, track_id, title, composer, seconds, market, from_date, until_date, fee, licence_id, licence_text) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [newId(), ids.polderId, "hr-1001", "Lantern Street", "Ilse Voss", 30, "NL", addDays(shortDate(start), -30), addDays(shortDate(start), -1), "120.00", "lic-401", "Licence ref lic-401"]
  );
  await db2.query(
    "insert into cues (id, job_id, track_id, title, composer, seconds, market, from_date, until_date, fee, licence_id, licence_text) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [newId(), ids.mapleId, "hr-1002", "Tidal Grid", "Joost Amani", 15, "CA", addDays(shortDate(start), -30), addDays(shortDate(start), 3), "120.00", "lic-402", "Licence ref lic-402"]
  );
  await db2.query(
    "insert into letters (id, job_id, currency, scope, fee_minor, tax_minor, total_minor, state, stamp, producer_id, page_token, page_ends_at, pdf_stored_at, created_at, accepted_at, accepted_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    [newId(), ids.mapleId, "CAD", "Boards and story reel", String(6e5), "78000", String(678e3), "sent", newToken(), ids.producerMaple, newToken(), String(start + 1209600), null, String(start), null, null]
  );
}
__name(seedExtras, "seedExtras");
async function seedJob(db2, spec) {
  await db2.query(
    "insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds, frame_rate, aspect, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [spec.id, spec.deskId, spec.clientId, spec.title, spec.adId, spec.dueDate, spec.targetSeconds, spec.frameRate, "16:9", spec.state, String(spec.start)]
  );
  await db2.query(
    "insert into board_stamps (job_id, stamp, frame_rate) values ($1, $2, $3)",
    [spec.id, newToken(), spec.frameRate]
  );
  let position = 1;
  for (let i = 0; i < spec.frames.length; i++) {
    const number = i + 1;
    const duration = spec.frames[i].duration;
    const note = `Action for frame ${number}.`;
    await db2.query(
      "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [
        newId(),
        spec.id,
        number,
        position,
        duration,
        note,
        "",
        String(number),
        note,
        seededDrawingName(number),
        1280,
        720,
        null,
        true,
        String(spec.start)
      ]
    );
    position++;
  }
  for (const [cutName, cutNumber] of [["First pass", 1], ["Second pass", 2]]) {
    const cutId = newId();
    await db2.query(
      "insert into cuts (id, job_id, number, name, frame_rate, created_at) values ($1, $2, $3, $4, $5, $6)",
      [cutId, spec.id, cutNumber, cutName, spec.frameRate, String(spec.start)]
    );
    const board = await db2.many(
      "select id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded from frames where job_id = $1 order by position",
      [spec.id]
    );
    let cutPosition = 1;
    for (const frame of board) {
      await db2.query(
        "insert into cut_frames (cut_id, frame_id, frame_number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
        [
          cutId,
          String(frame.id),
          Number(frame.number),
          cutPosition,
          Number(frame.duration_frames),
          String(frame.action_note),
          String(frame.audio_note),
          String(frame.shot),
          String(frame.visual),
          frame.file_name === null ? null : String(frame.file_name),
          frame.width === null ? null : Number(frame.width),
          frame.height === null ? null : Number(frame.height),
          frame.sha256 === null ? null : String(frame.sha256),
          Boolean(frame.seeded)
        ]
      );
      cutPosition++;
    }
  }
}
__name(seedJob, "seedJob");
function shortDate(at) {
  const d = new Date(at * 1e3);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}
__name(shortDate, "shortDate");
function seededDrawing(frameNumber, actionNote) {
  return Buffer.from(frameDrawingSvg(frameNumber, actionNote), "utf8");
}
__name(seededDrawing, "seededDrawing");

// src/server/mail.ts
import nodemailer from "nodemailer";
async function queueMail(db2, mail) {
  await db2.query(
    "insert into pending_mail (id, to_address, subject, body, html, attachment_name, attachment_type, attachment, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      newId(),
      mail.to,
      mail.subject,
      mail.body,
      mail.html,
      mail.attachmentName,
      mail.attachmentType,
      mail.attachment,
      String(now())
    ]
  );
}
__name(queueMail, "queueMail");
async function deliverPending(config2, db2) {
  const rows = await db2.many(
    "select id, to_address, subject, body, html, attachment_name, attachment_type, attachment from pending_mail order by created_at, id",
    []
  );
  if (rows.length === 0) return;
  const transport = nodemailer.createTransport({
    host: config2.smtp.host,
    port: config2.smtp.port,
    secure: false,
    ignoreTLS: true
  });
  for (const row of rows) {
    const mail = {
      from: config2.smtp.from,
      to: String(row.to_address),
      subject: String(row.subject),
      text: String(row.body),
      html: row.html === null ? void 0 : String(row.html),
      attachments: row.attachment === null ? void 0 : [
        {
          filename: String(row.attachment_name),
          content: Buffer.from(String(row.attachment), "utf8"),
          contentType: String(row.attachment_type)
        }
      ]
    };
    try {
      await transport.sendMail(mail);
      await db2.query("delete from pending_mail where id = $1", [String(row.id)]);
    } catch {
      return;
    }
  }
}
__name(deliverPending, "deliverPending");

// src/shared/rat.ts
var Rat = class _Rat {
  static {
    __name(this, "Rat");
  }
  n;
  d;
  constructor(n, d = 1n) {
    const nn = typeof n === "bigint" ? n : BigInt(n);
    let dd = typeof d === "bigint" ? d : BigInt(d);
    if (dd === 0n) throw new Error("zero denominator");
    const neg = dd < 0n;
    this.n = neg ? -nn : nn;
    this.d = neg ? -dd : dd;
  }
  static of(n, d = 1n) {
    return new _Rat(n, d);
  }
  add(o) {
    return new _Rat(this.n * o.d + o.n * this.d, this.d * o.d).norm();
  }
  sub(o) {
    return new _Rat(this.n * o.d - o.n * this.d, this.d * o.d).norm();
  }
  mul(o) {
    return new _Rat(this.n * o.n, this.d * o.d).norm();
  }
  div(o) {
    return new _Rat(this.n * o.d, this.d * o.n).norm();
  }
  cmp(o) {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  isZero() {
    return this.n === 0n;
  }
  sign() {
    return this.n < 0n ? -1 : this.n > 0n ? 1 : 0;
  }
  norm() {
    if (this.n === 0n) return new _Rat(0n, 1n);
    let a = this.n < 0n ? -this.n : this.n;
    let b = this.d;
    while (b !== 0n) {
      const t = a % b;
      a = b;
      b = t;
    }
    const g = a;
    return new _Rat(this.n / g, this.d / g);
  }
  // Half-up to a whole number: 37.5 -> 38, ties away from zero.
  roundHalfUp() {
    const neg = this.n < 0n;
    const absN = neg ? -this.n : this.n;
    let q = absN / this.d;
    const r = absN % this.d;
    if (r * 2n >= this.d) q += 1n;
    return neg ? -q : q;
  }
  // Half-up to the given decimal places, returned as an exact scaled integer:
  // 5.005 at 2 places is 501, never 500.
  scaledHalfUp(places) {
    const pow = 10n ** BigInt(places);
    return new _Rat(this.n * pow, this.d).roundHalfUp();
  }
};

// src/shared/framerate.ts
var FRAME_RATES = ["25", "23.976", "29.97"];
function isFrameRate(v) {
  return FRAME_RATES.includes(v);
}
__name(isFrameRate, "isFrameRate");
var RATE_RAT = {
  "25": Rat.of(25n, 1n),
  "23.976": Rat.of(24000n, 1001n),
  "29.97": Rat.of(30000n, 1001n)
};
var NOMINAL_RATE = {
  "25": 25n,
  "23.976": 24n,
  "29.97": 30n
};
function realSeconds(frames, rate2) {
  const f = BigInt(frames);
  switch (rate2) {
    case "25":
      return Rat.of(f, 25n);
    case "23.976":
      return Rat.of(f * 1001n, 24000n).norm();
    case "29.97":
      return Rat.of(f * 1001n, 30000n).norm();
  }
}
__name(realSeconds, "realSeconds");
function realSecondsText(frames, rate2) {
  const centis = realSeconds(frames, rate2).scaledHalfUp(2);
  const negative = centis < 0n;
  const abs = negative ? -centis : centis;
  const units = abs / 100n;
  const cents = abs % 100n;
  return `${negative ? "-" : ""}${units}.${cents.toString().padStart(2, "0")} s`;
}
__name(realSecondsText, "realSecondsText");
function targetFrames(targetSeconds, rate2) {
  return Number(BigInt(targetSeconds) * NOMINAL_RATE[rate2]);
}
__name(targetFrames, "targetFrames");
function secondsToFrames(seconds, rate2) {
  const r = parseDecimalExact(seconds);
  if (r === null) return 0;
  return Number(r.mul(RATE_RAT[rate2]).roundHalfUp());
}
__name(secondsToFrames, "secondsToFrames");
function nominalFrames(rate2) {
  return Number(NOMINAL_RATE[rate2]);
}
__name(nominalFrames, "nominalFrames");
function convertFrames(frames, from, to) {
  if (from === to) return frames;
  const exact = Rat.of(BigInt(frames) * RATE_RAT[from].d, RATE_RAT[from].n).mul(Rat.of(RATE_RAT[to].n, RATE_RAT[to].d));
  const converted = Number(exact.roundHalfUp());
  return converted < 1 ? 1 : converted;
}
__name(convertFrames, "convertFrames");
function parseDecimalExact(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const whole = BigInt(m[1]);
  const fracText = m[2] ?? "";
  const frac = fracText.length === 0 ? 0n : BigInt(fracText);
  const pow = 10n ** BigInt(fracText.length);
  return Rat.of(whole * pow + frac, pow);
}
__name(parseDecimalExact, "parseDecimalExact");
function parsePositiveDecimal(text, maxPlaces) {
  const r = parseDecimalExact(text);
  if (!r) return null;
  if (r.sign() <= 0) return null;
  if (maxPlaces !== null) {
    const pow = 10n ** BigInt(maxPlaces);
    if (r.n * pow % r.d !== 0n) return null;
  }
  return r;
}
__name(parsePositiveDecimal, "parsePositiveDecimal");

// src/shared/timecode.ts
function pad2(n) {
  return n.toString().padStart(2, "0");
}
__name(pad2, "pad2");
function ndf(frames, base) {
  const f = BigInt(frames);
  const frame = f % base;
  const totalSecs = f / base;
  const secs = totalSecs % 60n;
  const totalMins = totalSecs / 60n;
  const mins = totalMins % 60n;
  const hours = totalMins / 60n;
  return `${pad2(Number(hours))}:${pad2(Number(mins))}:${pad2(Number(secs))}:${pad2(Number(frame))}`;
}
__name(ndf, "ndf");
function dropFrameTimecode(frames) {
  const group = Math.floor(frames / 17982);
  const within = frames - group * 17982;
  const extra = within >= 2 ? 2 * Math.floor((within - 2) / 1798) : 0;
  const adjusted = frames + group * 18 + extra;
  const frame = adjusted % 30;
  const totalSecs = Math.floor(adjusted / 30);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)};${pad2(frame)}`;
}
__name(dropFrameTimecode, "dropFrameTimecode");
function timecode(frames, rate2) {
  switch (rate2) {
    case "25":
      return ndf(frames, NOMINAL_RATE["25"]);
    case "23.976":
      return ndf(frames, NOMINAL_RATE["23.976"]);
    case "29.97":
      return dropFrameTimecode(frames);
  }
}
__name(timecode, "timecode");

// src/shared/copy.ts
var MAIL_ADDRESS = "desk@noorbakkerboards.example";
var COPY = {
  sessionEnded: "Your session ended. Sign in again to keep going \u2014 what you typed is still here.",
  refreshFailed: "Couldn't refresh. Trying again.",
  wrongSignIn: "That email and password don't match.",
  typeAName: "Type a name.",
  typeAnEmail: "Type a mail address such as name@example.test.",
  passwordRule: "A password has at least 10 characters.",
  typeADate: "Type a date such as 2027-03-15.",
  typeATime: "Type a time such as 09:00.",
  typeATitle: "Type a title.",
  working: "Working\u2026"
};
var ARTIST_COPY = {
  passwordChanged: "Password changed.",
  currentPasswordWrong: "That current password doesn't match.",
  clientAdded: "Client added.",
  clientSaved: "Client saved.",
  clientDeleted: "Client deleted.",
  clientHasJobs: "A client with jobs has to be closed instead.",
  producerAdded: "Producer added.",
  producerSaved: "Producer saved.",
  closing: /* @__PURE__ */ __name((name, date) => `Closing ${name}. You can bring it back until ${date}.`, "closing"),
  backAgain: /* @__PURE__ */ __name((name) => `${name} is back.`, "backAgain"),
  closingNoChange: "This client is closing and can't change.",
  waitPassed: "The time to bring this client back has passed.",
  notClosing: "This client is not closing.",
  jobAdded: "Job added.",
  jobSaved: "Job saved.",
  jobDuplicated: "Job duplicated.",
  jobArchived: /* @__PURE__ */ __name((title) => `${title} archived.`, "jobArchived"),
  adIdEnd: "That Ad-ID should end in H or D.",
  adIdShape: "An Ad-ID has four letters, then seven letters or digits, then H or D.",
  jobArchivedRefusal: "This job is archived.",
  searchResults: /* @__PURE__ */ __name((count) => count === 1 ? "1 result." : `${count} results.`, "searchResults"),
  searchNone: "No results.",
  scriptHeader: "This file needs the header row shot,visual,audio,seconds.",
  scriptNotUtf8: "This file is not UTF-8 text.",
  scriptRowSeconds: /* @__PURE__ */ __name((row) => `Row ${row}: seconds should be a number such as 1.5.`, "scriptRowSeconds"),
  scriptRowShot: /* @__PURE__ */ __name((row) => `Row ${row}: shot is empty.`, "scriptRowShot"),
  scriptRowDuplicate: /* @__PURE__ */ __name((row, shot, other) => `Row ${row}: shot ${shot} is already in row ${other}.`, "scriptRowDuplicate"),
  scriptSaved: /* @__PURE__ */ __name((created, changed) => `Script saved: ${created} new, ${changed} changed.`, "scriptSaved"),
  scriptPreview: /* @__PURE__ */ __name((newCount, matched, refused) => `Preview ready: ${newCount} new, ${matched} matched, ${refused} refused.`, "scriptPreview"),
  uploadStored: /* @__PURE__ */ __name((name) => `${name}: Stored.`, "uploadStored"),
  uploadNotImage: "This file is not a PNG or JPEG.",
  uploadTooBig: "This file is over 8,000,000 bytes.",
  uploadAspect: /* @__PURE__ */ __name((w, h, aspect) => `This frame is ${w} x ${h}. This job is ${aspect}.`, "uploadAspect"),
  uploadDuplicate: /* @__PURE__ */ __name((number) => `Already on this board as frame ${number}.`, "uploadDuplicate"),
  storeUnavailable: "The file store is unavailable right now. Nothing was saved.",
  frameMoved: /* @__PURE__ */ __name((number, position, count) => `Frame ${number} moved to position ${position} of ${count}.`, "frameMoved"),
  frameDuplicated: /* @__PURE__ */ __name((number, newNumber) => `Frame ${number} duplicated as frame ${newNumber}.`, "frameDuplicated"),
  frameInserted: /* @__PURE__ */ __name((number, afterNumber) => `Frame ${number} inserted after frame ${afterNumber}.`, "frameInserted"),
  frameRemoved: /* @__PURE__ */ __name((number) => `Frame ${number} removed.`, "frameRemoved"),
  frameBack: /* @__PURE__ */ __name((number) => `Frame ${number} is back.`, "frameBack"),
  undoPassed: "The time to undo has passed.",
  frameSaved: /* @__PURE__ */ __name((number) => `Frame ${number} saved.`, "frameSaved"),
  frameNow: /* @__PURE__ */ __name((number, count) => `Frame ${number} is now ${count === 1 ? "1 frame" : `${count} frames`}.`, "frameNow"),
  staleBoard: /* @__PURE__ */ __name((time) => `This board was changed at ${time} Amsterdam time in another window. Your changes are still here.`, "staleBoard"),
  frameRateNow: /* @__PURE__ */ __name((rate2) => `Frame rate is now ${rate2}.`, "frameRateNow"),
  lineSaved: "Line saved.",
  lineRemoved: "Line removed.",
  lineOutside: /* @__PURE__ */ __name((percent) => `This line runs outside the safe area by ${percent}%.`, "lineOutside"),
  lineReading: /* @__PURE__ */ __name((need, has) => `This line needs ${need === 1 ? "1 frame" : `${need} frames`} on screen. It has ${has === 1 ? "1 frame" : `${has} frames`}.`, "lineReading"),
  lineEmpty: "Type the line's text.",
  linePastLast: "This line runs past the last frame.",
  cueAdded: /* @__PURE__ */ __name((title) => `Cue added: ${title}.`, "cueAdded"),
  cueRemoved: /* @__PURE__ */ __name((title) => `Cue removed: ${title}.`, "cueRemoved"),
  libraryUnavailable: "The music library is unavailable right now. Your cue stays.",
  licenceOrder: "The licence ends before it starts.",
  licenceDays: /* @__PURE__ */ __name((count) => count === 1 ? "Licence ends in 1 day" : `Licence ends in ${count} days`, "licenceDays"),
  licenceToday: "Licence ends today",
  licenceEnded: /* @__PURE__ */ __name((date) => `Licence ended on ${date}.`, "licenceEnded"),
  filmAsked: "Film asked for.",
  filmStored: "The stored film is shown.",
  filmReady: /* @__PURE__ */ __name((number) => `The film for Cut ${number} is ready.`, "filmReady"),
  renderBusy: /* @__PURE__ */ __name((time) => `The render service is busy. You can try again at ${time} Amsterdam time.`, "renderBusy"),
  renderIncomplete: "The render came back incomplete. Nothing was saved.",
  renderUnavailable: "The render service is unavailable right now. Nothing changed.",
  renderFailed: "The render service could not finish this film. Nothing was saved.",
  reviewReady: /* @__PURE__ */ __name((name) => `Review page ready. The mail to ${name} is on its way.`, "reviewReady"),
  pageEnded: "Page ended.",
  duePassed: "This job's due date has passed.",
  noteDone: "Note marked done.",
  noteWontDo: "Note marked won't do.",
  noteReopened: "Note reopened.",
  notesDone: /* @__PURE__ */ __name((count) => `${count} note${count === 1 ? "" : "s"} marked done.`, "notesDone"),
  noteArrived: /* @__PURE__ */ __name((name, number, time, town) => `${name} left a note on frame ${number} at ${time} ${town} time.`, "noteArrived"),
  notePosition: /* @__PURE__ */ __name((position) => `Position ${position}`, "notePosition"),
  frameGone: /* @__PURE__ */ __name((number) => `Frame gone in Cut ${number}.`, "frameGone"),
  signOffReady: /* @__PURE__ */ __name((name) => `Sign-off page ready. The mail to ${name} is on its way.`, "signOffReady"),
  signedOffArrived: /* @__PURE__ */ __name((number, name, time, town) => `Cut ${number} signed off by ${name} at ${time} ${town} time.`, "signedOffArrived"),
  callBooked: "Call booked.",
  callMoved: "Call moved.",
  callCancelled: "Call cancelled.",
  callTaken: /* @__PURE__ */ __name((time) => `That time was just taken at ${time} Amsterdam time. Pick another.`, "callTaken"),
  callMissing: /* @__PURE__ */ __name((time, town, date) => `${time} does not exist in ${town} on ${date}.`, "callMissing"),
  callPast: "That time has passed.",
  packageReady: "Package ready.",
  pdfUnavailable: "The PDF service is unavailable right now. Nothing was saved.",
  licenceEndedPackage: /* @__PURE__ */ __name((title, date) => `The licence for ${title} ended on ${date}.`, "licenceEndedPackage"),
  onlySignedOff: "Only a signed-off cut can be delivered.",
  noDrawing: /* @__PURE__ */ __name((number) => `Frame ${number} has no drawing yet.`, "noDrawing"),
  tooManyDownloads: /* @__PURE__ */ __name((time) => `Too many downloads for now. You can download again at ${time} Amsterdam time.`, "tooManyDownloads"),
  letterSaved: "Letter saved.",
  feePageReady: /* @__PURE__ */ __name((name) => `Fee page ready. The mail to ${name} is on its way.`, "feePageReady"),
  letterAcceptedArrived: /* @__PURE__ */ __name((name) => `Letter accepted by ${name}.`, "letterAcceptedArrived"),
  amountShape: "Type an amount such as 1835.50.",
  letterAcceptedLock: "This letter is accepted and can't change.",
  letterStale: /* @__PURE__ */ __name((time, town) => `This letter was changed at ${time} ${town} time. Read it again.`, "letterStale"),
  cutMade: /* @__PURE__ */ __name((number) => `Cut ${number} made.`, "cutMade"),
  cutBroughtBack: /* @__PURE__ */ __name((number) => `Cut ${number} is the board again.`, "cutBroughtBack"),
  cutDeleted: /* @__PURE__ */ __name((number) => `Cut ${number} deleted.`, "cutDeleted"),
  cutSaved: /* @__PURE__ */ __name((number) => `Cut ${number} saved.`, "cutSaved"),
  cutSignedNoChange: "A signed-off cut can't change.",
  differencesNone: "These two cuts are the same."
};
var VISITOR_COPY = {
  addressCopied: "Address copied.",
  copyRefused: "Press Ctrl+C to copy the address.",
  enquiryThanks: "Thanks. I answer within two working days.",
  enquiryLimit: /* @__PURE__ */ __name((time) => `Too many enquiries from this address for now. You can send again at ${time} Amsterdam time.`, "enquiryLimit"),
  enquiryMessage: "Type your message."
};
var PRIVATE_COPY = {
  en: {
    reviewHeading: "Review of <title>",
    stepsGroup: "Steps",
    stepFrames: "Frames",
    stepNotes: "Notes",
    stepSend: "Send",
    next: "Next",
    back: "Back",
    openSheet: "Open notes",
    close: "Close",
    filmStrip: "Film strip",
    clip: "Frame <number>",
    earlier: "Earlier",
    later: "Later",
    play: "Play",
    pause: "Pause",
    placePin: "Place a pin",
    noteField: "Your note",
    lengthField: "Suggested length in seconds",
    lengthInFrames: "<count> frames",
    attachment: "Attach a drawing",
    addNote: "Add note",
    nameField: "Your full name",
    sendNotes: "Send notes",
    notesSent: "Your notes were sent.",
    draftRefused: "This draft is not kept on this device.",
    numberCopy: "Type a length such as 1.5.",
    emptyNote: "Type your note.",
    emptyName: "Type your full name.",
    badAttachment: "This file is not a PNG or JPEG.",
    bigAttachment: "This file is over 5,000,000 bytes.",
    problems: "Problems",
    working: "Working\u2026",
    refreshLine: "Couldn't refresh. Trying again.",
    ended: "This page has ended.",
    askLink: "Ask for a new link",
    mailField: "Mail address",
    linkAnswer: "If that address belongs to this page, a new link is on its way.",
    linkLimit: "Too many requests for now. Try again later.",
    signOffHeading: "Sign-off for <title>",
    signOffButton: "Sign off",
    signed: "Signed off at <when>.",
    alreadySigned: "Already signed off at <when>.",
    newerCut: "A newer cut was made at <when>. Read it first.",
    wrongName: "That name doesn't match. Type your full name as it was given.",
    mailReviewSubject: "Your review page for <title>",
    mailReminderSubject: "Reminder: your review page for <title>",
    mailNewLinkSubject: "Your new link",
    mailDueLine: "Due <date>",
    mailCallSubject: "Call on <date>",
    mailCancelledCallSubject: "Call cancelled: <date>"
  },
  nl: {
    reviewHeading: "Beoordeling van <title>",
    stepsGroup: "Stappen",
    stepFrames: "Beelden",
    stepNotes: "Notities",
    stepSend: "Versturen",
    next: "Volgende",
    back: "Terug",
    openSheet: "Notities openen",
    close: "Sluiten",
    filmStrip: "Filmstrook",
    clip: "Beeld <number>",
    earlier: "Eerder",
    later: "Later",
    play: "Afspelen",
    pause: "Pauzeren",
    placePin: "Speld plaatsen",
    noteField: "Je notitie",
    lengthField: "Voorgestelde lengte in seconden",
    lengthInFrames: "<count> beelden",
    attachment: "Tekening toevoegen",
    addNote: "Notitie toevoegen",
    nameField: "Je volledige naam",
    sendNotes: "Notities versturen",
    notesSent: "Je notities zijn verstuurd.",
    draftRefused: "Dit concept wordt niet op dit apparaat bewaard.",
    numberCopy: "Typ een lengte zoals 1,5.",
    emptyNote: "Typ je notitie.",
    emptyName: "Typ je volledige naam.",
    badAttachment: "Dit bestand is geen PNG of JPEG.",
    bigAttachment: "Dit bestand is groter dan 5.000.000 bytes.",
    problems: "Problemen",
    working: "Bezig\u2026",
    refreshLine: "Vernieuwen is niet gelukt. We proberen het opnieuw.",
    ended: "Deze pagina is verlopen.",
    askLink: "Vraag een nieuwe link aan",
    mailField: "E-mailadres",
    linkAnswer: "Als dit adres bij deze pagina hoort, is er een nieuwe link onderweg.",
    linkLimit: "Te veel verzoeken. Probeer het later opnieuw.",
    signOffHeading: "Akkoord voor <title>",
    signOffButton: "Akkoord geven",
    signed: "Akkoord gegeven om <when>.",
    alreadySigned: "Al akkoord gegeven om <when>.",
    newerCut: "Er is om <when> een nieuwere versie gemaakt. Lees die eerst.",
    wrongName: "Die naam komt niet overeen. Typ je volledige naam zoals die is doorgegeven.",
    mailReviewSubject: "Je beoordelingspagina voor <title>",
    mailReminderSubject: "Herinnering: je beoordelingspagina voor <title>",
    mailNewLinkSubject: "Je nieuwe link",
    mailDueLine: "Uiterlijk <date>",
    mailCallSubject: "Gesprek op <date>",
    mailCancelledCallSubject: "Gesprek geannuleerd: <date>"
  },
  fr: {
    reviewHeading: "Relecture de <title>",
    stepsGroup: "\xC9tapes",
    stepFrames: "Images",
    stepNotes: "Notes",
    stepSend: "Envoyer",
    next: "Volgende",
    back: "Retour",
    openSheet: "Ouvrir les notes",
    close: "Fermer",
    filmStrip: "Bande de film",
    clip: "Image <number>",
    earlier: "Plus t\xF4t",
    later: "Plus tard",
    play: "Lire",
    pause: "Pause",
    placePin: "Placer une \xE9pingle",
    noteField: "Votre note",
    lengthField: "Dur\xE9e sugg\xE9r\xE9e en secondes",
    lengthInFrames: "<count> images",
    attachment: "Joindre un dessin",
    addNote: "Ajouter la note",
    nameField: "Votre nom complet",
    sendNotes: "Envoyer les notes",
    notesSent: "Vos notes ont \xE9t\xE9 envoy\xE9es.",
    draftRefused: "Ce brouillon n'est pas conserv\xE9 sur cet appareil.",
    numberCopy: "Saisissez une dur\xE9e comme 1,5.",
    emptyNote: "Saisissez votre note.",
    emptyName: "Saisissez votre nom complet.",
    badAttachment: "Ce fichier n'est ni un PNG ni un JPEG.",
    bigAttachment: "Ce fichier d\xE9passe 5 000 000 octets.",
    problems: "Probl\xE8mes",
    working: "En cours\u2026",
    refreshLine: "Actualisation impossible. Nouvel essai en cours.",
    ended: "Cette page est termin\xE9e.",
    askLink: "Demander un nouveau lien",
    mailField: "Adresse e-mail",
    linkAnswer: "Si cette adresse correspond \xE0 cette page, un nouveau lien est en route.",
    linkLimit: "Trop de demandes pour le moment. R\xE9essayez plus tard.",
    signOffHeading: "Validation de <title>",
    signOffButton: "Valider",
    signed: "Valid\xE9 \xE0 <when>.",
    alreadySigned: "D\xE9j\xE0 valid\xE9 \xE0 <when>.",
    newerCut: "Une version plus r\xE9cente a \xE9t\xE9 faite \xE0 <when>. Lisez-la d'abord.",
    wrongName: "Ce nom ne correspond pas. Saisissez votre nom complet tel qu'il a \xE9t\xE9 donn\xE9.",
    mailReviewSubject: "Votre page de relecture pour <title>",
    mailReminderSubject: "Rappel : votre page de relecture pour <title>",
    mailNewLinkSubject: "Votre nouveau lien",
    mailDueLine: "\xC0 rendre le <date>",
    mailCallSubject: "Appel le <date>",
    mailCancelledCallSubject: "Appel annul\xE9 : <date>"
  },
  ar: {
    reviewHeading: "\u0645\u0631\u0627\u062C\u0639\u0629 <title>",
    stepsGroup: "\u0627\u0644\u062E\u0637\u0648\u0627\u062A",
    stepFrames: "\u0627\u0644\u0625\u0637\u0627\u0631\u0627\u062A",
    stepNotes: "\u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
    stepSend: "\u0625\u0631\u0633\u0627\u0644",
    next: "\u0627\u0644\u062A\u0627\u0644\u064A",
    back: "\u0627\u0644\u0633\u0627\u0628\u0642",
    openSheet: "\u0641\u062A\u062D \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
    close: "\u0625\u063A\u0644\u0627\u0642",
    filmStrip: "\u0634\u0631\u064A\u0637 \u0627\u0644\u0641\u064A\u0644\u0645",
    clip: "\u0627\u0644\u0625\u0637\u0627\u0631 <number>",
    earlier: "\u0623\u0628\u0643\u0631",
    later: "\u0644\u0627\u062D\u0642\u064B\u0627",
    play: "\u062A\u0634\u063A\u064A\u0644",
    pause: "\u0625\u064A\u0642\u0627\u0641 \u0645\u0624\u0642\u062A",
    placePin: "\u0648\u0636\u0639 \u062F\u0628\u0648\u0633",
    noteField: "\u0645\u0644\u0627\u062D\u0638\u062A\u0643",
    lengthField: "\u0627\u0644\u0645\u062F\u0629 \u0627\u0644\u0645\u0642\u062A\u0631\u062D\u0629 \u0628\u0627\u0644\u062B\u0648\u0627\u0646\u064A",
    lengthInFrames: "<count> \u0625\u0637\u0627\u0631\u064B\u0627",
    attachment: "\u0625\u0631\u0641\u0627\u0642 \u0631\u0633\u0645",
    addNote: "\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0629",
    nameField: "\u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644",
    sendNotes: "\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
    notesSent: "\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0645\u0644\u0627\u062D\u0638\u0627\u062A\u0643.",
    draftRefused: "\u0644\u0627 \u064A\u062A\u0645 \u062D\u0641\u0638 \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0648\u062F\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.",
    numberCopy: "\u0627\u0643\u062A\u0628 \u0645\u062F\u0629 \u0645\u062B\u0644 \u0661\u066B\u0665.",
    emptyNote: "\u0627\u0643\u062A\u0628 \u0645\u0644\u0627\u062D\u0638\u062A\u0643.",
    emptyName: "\u0627\u0643\u062A\u0628 \u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644.",
    badAttachment: "\u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0644\u064A\u0633 PNG \u0623\u0648 JPEG.",
    bigAttachment: "\u062D\u062C\u0645 \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u064A\u062A\u062C\u0627\u0648\u0632 5,000,000 \u0628\u0627\u064A\u062A.",
    problems: "\u0627\u0644\u0645\u0634\u0643\u0644\u0627\u062A",
    working: "\u062C\u0627\u0631\u064D \u0627\u0644\u0639\u0645\u0644\u2026",
    refreshLine: "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u062C\u0627\u0631\u064D \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.",
    ended: "\u0627\u0646\u062A\u0647\u062A \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629.",
    askLink: "\u0637\u0644\u0628 \u0631\u0627\u0628\u0637 \u062C\u062F\u064A\u062F",
    mailField: "\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A",
    linkAnswer: "\u0625\u0630\u0627 \u0643\u0627\u0646 \u0647\u0630\u0627 \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0645\u0631\u062A\u0628\u0637\u064B\u0627 \u0628\u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629\u060C \u0641\u0633\u064A\u0635\u0644\u0643 \u0631\u0627\u0628\u0637 \u062C\u062F\u064A\u062F \u0642\u0631\u064A\u0628\u064B\u0627.",
    linkLimit: "\u0637\u0644\u0628\u0627\u062A \u0643\u062B\u064A\u0631\u0629 \u062C\u062F\u064B\u0627 \u0627\u0644\u0622\u0646. \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0644\u0627\u062D\u0642\u064B\u0627.",
    signOffHeading: "\u0627\u0639\u062A\u0645\u0627\u062F <title>",
    signOffButton: "\u0627\u0639\u062A\u0645\u0627\u062F",
    signed: "\u062A\u0645 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0641\u064A <when>.",
    alreadySigned: "\u062A\u0645 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064A <when>.",
    newerCut: "\u062A\u0645 \u0625\u0639\u062F\u0627\u062F \u0646\u0633\u062E\u0629 \u0623\u062D\u062F\u062B \u0641\u064A <when>. \u0627\u0642\u0631\u0623\u0647\u0627 \u0623\u0648\u0644\u0627\u064B.",
    wrongName: "\u0647\u0630\u0627 \u0627\u0644\u0627\u0633\u0645 \u063A\u064A\u0631 \u0645\u0637\u0627\u0628\u0642. \u0627\u0643\u062A\u0628 \u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644 \u0643\u0645\u0627 \u0647\u0648 \u0645\u0633\u062C\u0644.",
    mailReviewSubject: "\u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u0643 \u0644\u0640 <title>",
    mailReminderSubject: "\u062A\u0630\u0643\u064A\u0631: \u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u0643 \u0644\u0640 <title>",
    mailNewLinkSubject: "\u0631\u0627\u0628\u0637\u0643 \u0627\u0644\u062C\u062F\u064A\u062F",
    mailDueLine: "\u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u0646\u0647\u0627\u0626\u064A <date>",
    mailCallSubject: "\u0645\u0643\u0627\u0644\u0645\u0629 \u0641\u064A <date>",
    mailCancelledCallSubject: "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0645\u0643\u0627\u0644\u0645\u0629: <date>"
  }
};
var FEE_COPY = {
  heading: /* @__PURE__ */ __name((title) => `Fee letter for ${title}`, "heading"),
  acceptLetter: "Accept letter",
  openTheLetter: "Open the letter",
  yourFullName: "Your full name",
  acceptedLine: "Letter accepted.",
  mailSubject: /* @__PURE__ */ __name((title) => `Your fee letter for ${title}`, "mailSubject")
};

// src/server/domain/board.ts
function adIdProblem(adId) {
  if (!/^[A-Z0-9]{11}[A-Z0-9]$/.test(adId)) {
    return ARTIST_COPY.adIdShape;
  }
  if (!/^[A-Z]{4}[A-Z0-9]{7}$/.test(adId.slice(0, 11))) {
    return ARTIST_COPY.adIdShape;
  }
  const last = adId[11];
  if (last !== "H" && last !== "D") {
    return ARTIST_COPY.adIdEnd;
  }
  return null;
}
__name(adIdProblem, "adIdProblem");
function targetTextOf(totalFrames, target) {
  if (totalFrames === target) return "exact";
  const diff = Math.abs(totalFrames - target);
  const unit = diff === 1 ? "1 frame" : `${diff} frames`;
  return totalFrames > target ? `${unit} over` : `${unit} under`;
}
__name(targetTextOf, "targetTextOf");
async function loadBoard(db2, jobId) {
  const job = await db2.one("select id, target_seconds, frame_rate from jobs where id = $1", [jobId]);
  if (job === null) return null;
  const stampRow = await db2.one("select stamp, frame_rate from board_stamps where job_id = $1", [jobId]);
  if (stampRow === null) return null;
  const frameRate = isFrameRate(String(stampRow.frame_rate)) ? String(stampRow.frame_rate) : "25";
  const frames = await db2.many(
    "select number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded from frames where job_id = $1 order by position",
    [jobId]
  );
  const target = targetFrames(Number(job.target_seconds), frameRate);
  const total = frames.reduce((sum, f) => sum + Number(f.duration_frames), 0);
  return {
    jobId,
    stamp: String(stampRow.stamp),
    frameRate,
    targetSeconds: Number(job.target_seconds),
    targetFrames: target,
    totalFrames: total,
    secondsText: realSecondsText(total, frameRate),
    targetText: targetTextOf(total, target),
    frames: frames.map((f) => frameViewOf(jobId, f))
  };
}
__name(loadBoard, "loadBoard");
function frameViewOf(jobId, row) {
  return {
    number: Number(row.number),
    position: Number(row.position),
    durationFrames: Number(row.duration_frames),
    actionNote: String(row.action_note),
    audioNote: String(row.audio_note),
    shot: String(row.shot),
    visual: String(row.visual),
    fileName: row.file_name === null ? null : String(row.file_name),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    sha256: row.sha256 === null ? null : String(row.sha256),
    drawingUrl: `/api/jobs/${jobId}/frames/${Number(row.number)}/drawing`
  };
}
__name(frameViewOf, "frameViewOf");
async function newBoardStamp(db2, jobId) {
  const stamp = newToken();
  await db2.query("update board_stamps set stamp = $1 where job_id = $2", [stamp, jobId]);
  return stamp;
}
__name(newBoardStamp, "newBoardStamp");
async function requireStamp(db2, jobId, given) {
  const row = await db2.one("select stamp from board_stamps where job_id = $1", [jobId]);
  const held = row === null ? "" : String(row.stamp);
  if (given !== held) {
    throw new HttpError(412, "stale", ARTIST_COPY.staleBoard("00:00"), {});
  }
  return held;
}
__name(requireStamp, "requireStamp");
function licenceTextOf(until, market, at) {
  const today = wallDate(market, at);
  if (until > today) {
    const days = dayDiff(today, until);
    return days === 1 ? ARTIST_COPY.licenceDays(1) : ARTIST_COPY.licenceDays(days);
  }
  if (until === today) return ARTIST_COPY.licenceToday;
  return ARTIST_COPY.licenceEnded(until);
}
__name(licenceTextOf, "licenceTextOf");
function dayDiff(from, to) {
  return Math.round((dateOnly(to) - dateOnly(from)) / 86400);
}
__name(dayDiff, "dayDiff");
function licenceEndedBefore(until, market, at) {
  return until < wallDate(market, at);
}
__name(licenceEndedBefore, "licenceEndedBefore");
function pageEndsAt(town, dueDate, sentAt, pageSeconds) {
  const dueEnd = endOfLocalDay(town, dueDate);
  const fromSending = sentAt + pageSeconds;
  return dueEnd < fromSending ? dueEnd : fromSending;
}
__name(pageEndsAt, "pageEndsAt");
function endOfLocalDay(town, date) {
  const base = dateOnly(date);
  const offsets = town === "dubai" ? [240] : town === "amsterdam" ? [60, 120] : [-300, -240];
  const candidates = offsets.map((offset) => base + 86399 - offset * 60).filter((at) => wallDate(town, at) === date);
  if (candidates.length > 0) return Math.max(...candidates);
  return base + 86399;
}
__name(endOfLocalDay, "endOfLocalDay");

// src/server/providers.ts
var CALL_TIMEOUT_MS = 5e3;
var ProviderUnavailable = class extends Error {
  static {
    __name(this, "ProviderUnavailable");
  }
};
async function callJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const seconds = retryAfter === null ? 60 : Number(retryAfter);
      throw new RateLimited(Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 60);
    }
    if (!res.ok) throw new ProviderUnavailable();
    return await res.json();
  } catch (e) {
    if (e instanceof RateLimited || e instanceof ProviderUnavailable) throw e;
    throw new ProviderUnavailable();
  } finally {
    clearTimeout(timer);
  }
}
__name(callJson, "callJson");
var RateLimited = class extends Error {
  constructor(retryAfterSeconds) {
    super("rate limited");
    this.retryAfterSeconds = retryAfterSeconds;
  }
  static {
    __name(this, "RateLimited");
  }
};
var Hollowreed = class {
  constructor(config2) {
    this.config = config2;
  }
  static {
    __name(this, "Hollowreed");
  }
  url(path) {
    return `${this.config.wiremockUrl}${path}`;
  }
  async searchTracks(q, cursor) {
    const params = new URLSearchParams({ q });
    if (cursor !== null) params.set("cursor", cursor);
    const raw = await callJson(this.url(`/v2/tracks?${params.toString()}`), { method: "GET" });
    const page = raw;
    const tracks = Array.isArray(page.tracks) ? page.tracks : [];
    return {
      tracks: tracks.map((t) => {
        const track = t;
        return {
          id: String(track.id ?? ""),
          title: String(track.title ?? ""),
          composer: String(track.composer ?? ""),
          seconds: Number(track.seconds ?? 0)
        };
      }),
      nextCursor: typeof page.nextCursor === "string" && page.nextCursor.length > 0 ? page.nextCursor : null
    };
  }
  async prices() {
    const raw = await callJson(this.url("/v2/prices"), { method: "GET" });
    const body = raw;
    const rows = Array.isArray(body.prices) ? body.prices : [];
    return rows.map((r) => {
      const row = r;
      return { validFrom: String(row.validFrom ?? ""), perMarket: String(row.perMarket ?? "") };
    });
  }
  async buyLicence(input) {
    const raw = await callJson(this.url("/v2/licences"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    const body = raw;
    return { licenceId: String(body.licenceId ?? "") };
  }
};
var Quaymill = class {
  constructor(config2) {
    this.config = config2;
  }
  static {
    __name(this, "Quaymill");
  }
  url(path) {
    return `${this.config.wiremockUrl}${path}`;
  }
  idempotencyKey(ask) {
    return `${ask.cutId}-${ask.width}-${ask.burnTimecode}`;
  }
  async ask(ask) {
    const raw = await callJson(this.url("/v1/renders"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": this.idempotencyKey(ask)
      },
      body: JSON.stringify(ask)
    });
    const body = raw;
    return { id: String(body.id ?? "") };
  }
  async poll(id) {
    const raw = await callJson(this.url(`/v1/renders/${id}`), { method: "GET" });
    const body = raw;
    const state = String(body.state ?? "");
    if (state === "queued") return { state: "queued" };
    if (state === "running") return { state: "running", progress: Number(body.progress ?? 0) };
    if (state === "done") {
      return {
        state: "done",
        url: String(body.url ?? ""),
        size: Number(body.size ?? 0),
        sha256: String(body.sha256 ?? "")
      };
    }
    return { state: "failed", reason: String(body.reason ?? "") };
  }
  // A film is plain bytes fetched from the same service and copied into the
  // file store byte for byte.
  async fetchFilm(url) {
    const target = url.startsWith("http") ? url : `${this.config.wiremockUrl}${url}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      const res = await fetch(target, { signal: controller.signal });
      if (!res.ok) throw new ProviderUnavailable();
      return Buffer.from(await res.arrayBuffer());
    } catch {
      throw new ProviderUnavailable();
    } finally {
      clearTimeout(timer);
    }
  }
};

// src/server/pdf.ts
var PdfUnavailable = class extends Error {
  static {
    __name(this, "PdfUnavailable");
  }
};
async function renderPdf(config2, html) {
  const form = new FormData();
  form.append("index.html", new Blob([html], { type: "text/html" }), "index.html");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3e4);
  try {
    const res = await fetch(`${config2.gotenbergUrl}/forms/chromium/convert/html`, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
    if (!res.ok) throw new PdfUnavailable();
    return Buffer.from(await res.arrayBuffer());
  } catch {
    throw new PdfUnavailable();
  } finally {
    clearTimeout(timer);
  }
}
__name(renderPdf, "renderPdf");

// src/shared/folding.ts
var SMALL_FOLDS = {
  "\xE0": "a",
  "\xE1": "a",
  "\xE2": "a",
  "\xE3": "a",
  "\xE4": "a",
  "\xE5": "a",
  "\xE6": "ae",
  "\xE7": "c",
  "\xE8": "e",
  "\xE9": "e",
  "\xEA": "e",
  "\xEB": "e",
  "\xEC": "i",
  "\xED": "i",
  "\xEE": "i",
  "\xEF": "i",
  "\u0131": "i",
  "\xF1": "n",
  "\xF2": "o",
  "\xF3": "o",
  "\xF4": "o",
  "\xF5": "o",
  "\xF6": "o",
  "\xF8": "o",
  "\u0153": "oe",
  "\xF9": "u",
  "\xFA": "u",
  "\xFB": "u",
  "\xFC": "u",
  "\xFD": "y",
  "\xFF": "y",
  "\xDF": "ss",
  "\u1E9E": "ss"
};
var CAPITAL_FOLDS = {
  "\xC0": "A",
  "\xC1": "A",
  "\xC2": "A",
  "\xC3": "A",
  "\xC4": "A",
  "\xC5": "A",
  "\xC6": "AE",
  "\xC7": "C",
  "\xC8": "E",
  "\xC9": "E",
  "\xCA": "E",
  "\xCB": "E",
  "\xCC": "I",
  "\xCD": "I",
  "\xCE": "I",
  "\xCF": "I",
  "\u0130": "I",
  "\xD1": "N",
  "\xD2": "O",
  "\xD3": "O",
  "\xD4": "O",
  "\xD5": "O",
  "\xD6": "O",
  "\xD8": "O",
  "\u0152": "OE",
  "\xD9": "U",
  "\xDA": "U",
  "\xDB": "U",
  "\xDC": "U",
  "\xDD": "Y"
};
function foldForCompare(text) {
  return Array.from(text).map((ch) => {
    const small = SMALL_FOLDS[ch];
    if (small !== void 0) return small;
    const capital = CAPITAL_FOLDS[ch];
    if (capital !== void 0) return capital.toLowerCase();
    return ch.toLowerCase();
  }).join("");
}
__name(foldForCompare, "foldForCompare");
function foldAscii(text) {
  return Array.from(text).map((ch) => {
    const capital = CAPITAL_FOLDS[ch];
    if (capital !== void 0) return asciiOrUnderscore(capital);
    const small = SMALL_FOLDS[ch];
    if (small !== void 0) return asciiOrUnderscore(small);
    return asciiOrUnderscore(ch);
  }).join("");
}
__name(foldAscii, "foldAscii");
function asciiOrUnderscore(text) {
  const printable = Array.from(text).every((c) => {
    const code = c.codePointAt(0);
    return code >= 32 && code <= 126;
  });
  return printable ? text : "_";
}
__name(asciiOrUnderscore, "asciiOrUnderscore");

// src/shared/money.ts
var CURRENCIES = ["EUR", "CAD", "USD"];
function isCurrency(v) {
  return CURRENCIES.includes(v);
}
__name(isCurrency, "isCurrency");
function taxPercentOfPlace(place) {
  switch (place) {
    case "netherlands":
      return 21n;
    case "ontario":
      return 13n;
    case "newYork":
    case "dubai":
      return null;
    default:
      return null;
  }
}
__name(taxPercentOfPlace, "taxPercentOfPlace");
function taxOfMilestone(amountMinor, percent) {
  if (percent === null) return 0n;
  const scaled = amountMinor * percent * 2n;
  const q = scaled / 200n;
  const r = scaled % 200n;
  if (r >= 100n) {
    return q + 1n;
  }
  return q;
}
__name(taxOfMilestone, "taxOfMilestone");
function splitMilestones(feeMinor) {
  const third = feeMinor / 3n;
  const rem = feeMinor - third * 3n;
  if (rem === 0n) return [third, third, third];
  if (rem === 1n) return [third + 1n, third, third];
  return [third + 1n, third + 1n, third];
}
__name(splitMilestones, "splitMilestones");
function grouped(amountMinor, decimal, mark) {
  const neg = amountMinor < 0n;
  const abs = neg ? -amountMinor : amountMinor;
  const units = abs / decimal;
  const cents = abs % decimal;
  const digits = decimal === 100n ? 2 : 0;
  const unitText = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centsText = cents.toString().padStart(digits, "0");
  const body = digits > 0 ? `${unitText}.${centsText}` : unitText;
  return `${neg ? "-" : ""}${mark}${body}`;
}
__name(grouped, "grouped");
function amountText(currency, amountMinor) {
  switch (currency) {
    case "EUR":
      return grouped(amountMinor, 100n, "\u20AC");
    case "CAD":
      return grouped(amountMinor, 100n, "CA$");
    case "USD":
      return grouped(amountMinor, 100n, "US$");
  }
}
__name(amountText, "amountText");

// src/shared/ics.ts
function escapeText(text) {
  return text.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
}
__name(escapeText, "escapeText");
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    let limit = start + (first ? 75 : 74);
    if (limit >= bytes.length) {
      parts.push(bytes.subarray(start).toString("utf8"));
      break;
    }
    while (limit > start && (bytes[limit] & 192) === 128) limit--;
    parts.push(bytes.subarray(start, limit).toString("utf8"));
    start = limit;
    first = false;
  }
  return parts.join("\r\n ");
}
__name(fold, "fold");
function utcStamp(at) {
  const t = instantText(at);
  return `${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}T${t.slice(11, 13)}${t.slice(14, 16)}${t.slice(17, 19)}Z`;
}
__name(utcStamp, "utcStamp");
function calendarFile(call, method) {
  const start = instantOfWall(call.town, call.date, call.time);
  if (start === null) throw new Error("wall time does not exist");
  const end = start + call.minutes * 60;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Noor Bakker Boards//Clapstick//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${call.uid}`,
    `SEQUENCE:${call.sequence}`,
    `DTSTAMP:${utcStamp(start)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    fold(`SUMMARY:${escapeText(`Call with ${call.producerName}`)}`),
    fold(`DESCRIPTION:${escapeText(call.note)}`),
    `ORGANIZER:mailto:${call.artistEmail}`,
    fold(`ATTENDEE:mailto:${call.producerEmail}`),
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
__name(calendarFile, "calendarFile");
var CALENDAR_FILE_NAME = "call.ics";
var CALENDAR_MIME = "text/calendar";

// src/shared/edl.ts
function pad3(n, width) {
  return n.toString().padStart(width, "0");
}
__name(pad3, "pad");
function recordStart(rate2) {
  switch (rate2) {
    case "29.97":
      return 107892;
    case "25":
      return 25 * 3600;
    case "23.976":
      return 24 * 3600;
  }
}
__name(recordStart, "recordStart");
function clipName(clip) {
  return clip.fileName ?? `frame-${clip.frame}.svg`;
}
__name(clipName, "clipName");
function editDecisionList(title, rate2, clips) {
  const lines = [];
  const foldedTitle = foldAscii(title).slice(0, 70);
  lines.push(`TITLE: ${foldedTitle}`);
  lines.push(rate2 === "29.97" ? "FCM: DROP FRAME" : "FCM: NON-DROP FRAME");
  lines.push("");
  let record = recordStart(rate2);
  let event = 1;
  for (const clip of clips) {
    const sourceIn = timecode(0, rate2);
    const sourceOut = timecode(clip.durationFrames, rate2);
    const recordIn = timecode(record, rate2);
    const recordOut = timecode(record + clip.durationFrames, rate2);
    lines.push(
      `${pad3(event, 3)}  AX       V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`
    );
    lines.push(`* FROM CLIP NAME: ${foldAscii(clipName(clip))}`);
    record += clip.durationFrames;
    event++;
  }
  return lines.join("\r\n") + "\r\n";
}
__name(editDecisionList, "editDecisionList");

// src/shared/shotlist.ts
function cell(text) {
  let value = text ?? "";
  if (/^[=+\-@\t\r]/.test(value)) {
    value = `'${value}`;
  }
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
__name(cell, "cell");
function shotList(rows) {
  const header = ["position", "frame", "timecodeIn", "seconds", "shot", "visual", "audio", "actionNote"];
  const lines = [header.map(cell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.position.toString(),
        row.frame.toString(),
        row.timecodeIn,
        row.seconds,
        row.shot,
        row.visual,
        row.audio,
        row.actionNote
      ].map(cell).join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
__name(shotList, "shotList");

// src/server/routes.ts
var routes = [];
var PUBLIC_PATHS = /* @__PURE__ */ new Set([
  "/api/health",
  "/api/sign-up",
  "/api/sign-in",
  "/api/sign-out",
  "/api/enquiries",
  "/api/today"
]);
function route(method, path, handler, opts = {}) {
  const keys = [];
  const pattern = new RegExp(
    "^" + path.replace(/:(\w+)/g, (_m, key) => {
      keys.push(key);
      return "([^/]+)";
    }) + "$"
  );
  const needsSession = opts.session ?? !(PUBLIC_PATHS.has(path) || path.startsWith("/api/r/") || path.startsWith("/api/s/") || path.startsWith("/api/f/"));
  routes.push({
    method,
    pattern,
    keys,
    handler,
    needsSession,
    stateChanging: method !== "GET" && method !== "HEAD"
  });
}
__name(route, "route");
async function dispatch(req, store2, db2) {
  const method = req.method === "HEAD" ? "GET" : req.method;
  let matched = null;
  for (const r of routes) {
    const m = r.pattern.exec(req.path);
    if (m === null) continue;
    if (r.method !== method) {
      matched = matched ?? r;
      continue;
    }
    matched = r;
    req.params = {};
    r.keys.forEach((key, i) => {
      req.params[key] = decodeURIComponent(m[i + 1]);
    });
    break;
  }
  if (matched === null) {
    throw new HttpError(404, "unknownRoute", "There is nothing at this address.");
  }
  if (matched.method !== method) {
    throw new HttpError(405, "methodNotAllowed", "That method is not allowed here.", null, {
      Allow: matched.method
    });
  }
  const declared = Number(req.headers["content-length"] ?? "0");
  const contentType = req.headers["content-type"] ?? "";
  const isUpload = contentType.startsWith("multipart/form-data");
  if (isUpload) {
    if (declared > UPLOAD_BODY_LIMIT) {
      throw new HttpError(413, "tooLarge", "This upload is over its size limit.");
    }
  } else if (method !== "GET" && declared > JSON_BODY_LIMIT) {
    throw new HttpError(413, "tooLarge", "This request is over its size limit.");
  }
  if (matched.stateChanging) {
    const origin = req.headers["origin"];
    if (origin !== void 0 && origin.length > 0 && !isOwnOrigin(req, origin)) {
      throw new HttpError(403, "foreignOrigin", "This address is not for that origin.");
    }
  }
  if (matched.needsSession) {
    const token = tokenOfCookie(req.headers.cookie);
    const session = await loadSession(db2, req.config, req.headers.cookie);
    if (session === null) {
      const ended = token !== null && await sessionEnded(db2, token);
      throw new HttpError(
        401,
        ended ? "session_ended" : "notSignedIn",
        ended ? COPY.sessionEnded : "Sign in to keep going."
      );
    }
    req.session = session;
  }
  return await matched.handler(req, store2, db2);
}
__name(dispatch, "dispatch");
function isOwnOrigin(req, origin) {
  const own = new URL(req.config.appPublicUrl);
  const ownPort = own.port === "" ? "" : `:${own.port}`;
  return origin === `${own.protocol}//${own.hostname}${ownPort}`;
}
__name(isOwnOrigin, "isOwnOrigin");
async function deliverMail(config2, db2) {
  await deliverPending(config2, db2);
}
__name(deliverMail, "deliverMail");
async function tick(config2, db2, store2) {
  const at = now();
  await tickRenders(config2, db2, store2, at);
  await tickReminders(config2, db2, at);
  await tickErasure(db2, store2, at);
  await tickClientWaits(db2, at);
}
__name(tick, "tick");
route("GET", "/api/health", async () => jsonResponse(200, { status: "ok" }));
route("POST", "/api/sign-up", async (req, _store, db2) => {
  const body = jsonOf(req);
  const name = requireName(body);
  const email = requireEmail(body);
  const password = requireNewPassword(body);
  const held = await db2.one("select id from desks where lower(email) = lower($1)", [email]);
  if (held !== null) {
    throw new HttpError(409, "emailHeld", "That mail address is already on another desk.");
  }
  const salt = newSalt();
  const id = newId();
  await db2.query(
    "insert into desks (id, name, email, password_salt, password_hash, created_at) values ($1, $2, $3, $4, $5, $6)",
    [id, name, email, salt, hashPassword(password, salt), String(now())]
  );
  const token = await createSession(db2, req.config, id);
  return withCookie(jsonResponse(201, { id, name, email }), token);
});
route("POST", "/api/sign-in", async (req, _store, db2) => {
  const body = jsonOf(req);
  const email = requireEmail(body);
  const password = strOf(body, "password");
  if (password === null) {
    throw new HttpError(422, "password", "A password has at least 10 characters.", { password: COPY.passwordRule });
  }
  const row = await db2.one("select id, name, email, password_salt, password_hash from desks where lower(email) = lower($1)", [email]);
  if (row === null || !passwordMatches(password, String(row.password_salt), String(row.password_hash))) {
    throw new HttpError(401, "wrongSignIn", COPY.wrongSignIn);
  }
  const token = await createSession(db2, req.config, String(row.id));
  return withCookie(
    jsonResponse(200, { id: String(row.id), name: String(row.name), email: String(row.email) }),
    token
  );
});
route("POST", "/api/sign-out", async (req, _store, db2) => {
  const token = tokenOfCookie(req.headers.cookie);
  if (token !== null) {
    await endSession(db2, token);
  }
  return {
    status: 204,
    headers: { "set-cookie": clearCookie() },
    body: null
  };
});
route("GET", "/api/session", async (req, _store, db2) => {
  const row = await deskOf(db2, req);
  return jsonResponse(200, { id: row.id, name: row.name, email: row.email });
});
route("POST", "/api/password", async (req, _store, db2) => {
  const body = jsonOf(req);
  const current = strOf(body, "currentPassword");
  const next = strOf(body, "newPassword");
  if (current === null || next === null) {
    throw new HttpError(422, "password", "A password has at least 10 characters.", {
      newPassword: COPY.passwordRule
    });
  }
  if (next.length < 10) {
    throw new HttpError(422, "newPassword", "A password has at least 10 characters.", {
      newPassword: COPY.passwordRule
    });
  }
  const desk = await deskRow(db2, req);
  if (!passwordMatches(current, String(desk.password_salt), String(desk.password_hash))) {
    throw new HttpError(422, "currentPassword", ARTIST_COPY.currentPasswordWrong, {
      currentPassword: ARTIST_COPY.currentPasswordWrong
    });
  }
  const salt = newSalt();
  await db2.query("update desks set password_salt = $1, password_hash = $2 where id = $3", [
    salt,
    hashPassword(next, salt),
    desk.id
  ]);
  const token = tokenOfCookie(req.headers.cookie);
  if (token !== null) {
    const others = await db2.many("select token from sessions where token <> $1 and desk_id = $2", [
      token,
      desk.id
    ]);
    for (const other of others) {
      await db2.query("insert into ended_sessions (token, at) values ($1, $2)", [
        String(other.token),
        String(now())
      ]);
    }
    await db2.query("delete from sessions where token <> $1 and desk_id = $2", [token, desk.id]);
  }
  return emptyResponse(204);
});
async function deskOf(db2, req) {
  if (req.session === null) throw new HttpError(401, "notSignedIn", "Sign in to keep going.");
  const row = await deskRow(db2, req);
  return { id: row.id, name: row.name, email: row.email };
}
__name(deskOf, "deskOf");
async function deskRow(db2, req) {
  const row = await db2.one("select id, name, email, password_salt, password_hash from desks where id = $1", [
    req.session.deskId
  ]);
  if (row === null) throw new HttpError(401, "notSignedIn", "Sign in to keep going.");
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    password_salt: String(row.password_salt),
    password_hash: String(row.password_hash)
  };
}
__name(deskRow, "deskRow");
function withCookie(response, token) {
  return { ...response, headers: { ...response.headers, "set-cookie": cookieOf(token) } };
}
__name(withCookie, "withCookie");
function requireName(body) {
  const name = strOf(body, "name");
  if (name === null || name.trim().length === 0) {
    throw new HttpError(422, "name", COPY.typeAName, { name: COPY.typeAName });
  }
  return name.trim();
}
__name(requireName, "requireName");
function requireEmail(body) {
  const email = strOf(body, "email");
  if (email === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new HttpError(422, "email", COPY.typeAnEmail, { email: COPY.typeAnEmail });
  }
  return email.trim();
}
__name(requireEmail, "requireEmail");
function requireNewPassword(body) {
  const password = strOf(body, "password");
  if (password === null || password.length < 10) {
    throw new HttpError(422, "password", COPY.passwordRule, { password: COPY.passwordRule });
  }
  return password;
}
__name(requireNewPassword, "requireNewPassword");
route("GET", "/api/clients", async (req, _store, db2) => {
  const clients = await db2.many(
    "select c.id, c.name, c.place, c.state, c.closes_at, c.created_at, count(j.id) as jobs from clients c left join jobs j on j.client_id = c.id and j.state <> 'archived' where c.desk_id = $1 and c.state <> 'erased' group by c.id, c.name, c.place, c.state, c.closes_at, c.created_at order by c.created_at, c.id",
    [req.session.deskId]
  );
  const total = clients.length;
  const erased = await db2.many(
    "select id, name, erased_at from clients where desk_id = $1 and state = 'erased' order by erased_at, id",
    [req.session.deskId]
  );
  return jsonResponse(200, {
    clients: clients.map(clientView),
    total,
    erasedClients: erased.map((e) => ({
      id: String(e.id),
      name: String(e.name),
      erasedAt: instantText(Number(e.erased_at))
    }))
  });
});
function clientView(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    place: String(row.place),
    state: String(row.state),
    closesAt: row.closes_at === null ? null : instantText(Number(row.closes_at)),
    createdAt: instantText(Number(row.created_at))
  };
}
__name(clientView, "clientView");
route("POST", "/api/clients", async (req, _store, db2) => {
  const body = jsonOf(req);
  const name = requireName(body);
  const place = strOf(body, "place");
  if (place === null || !PLACES.includes(place)) {
    throw new HttpError(422, "place", "Pick a place from the list.", { place: "Pick a place from the list." });
  }
  const id = newId();
  await db2.query(
    "insert into clients (id, desk_id, name, place, state, closes_at, erased_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, req.session.deskId, name, place, "active", null, null, String(now())]
  );
  const row = await db2.one("select id, name, place, state, closes_at, created_at from clients where id = $1", [id]);
  return jsonResponse(201, clientView(row));
});
route("GET", "/api/clients/:id", async (req, _store, db2) => {
  const row = await clientOfDesk(db2, req.session.deskId, req.params.id);
  const producers = await db2.many("select * from producers where client_id = $1 order by name", [row.id]);
  const jobs = await db2.many(
    "select * from jobs where client_id = $1 and state <> 'archived' order by created_at, id",
    [row.id]
  );
  return jsonResponse(200, {
    ...clientView(row),
    producers: producers.map(producerView),
    jobs: jobs.map(jobView)
  });
});
route("PATCH", "/api/clients/:id", async (req, _store, db2) => {
  const row = await clientOfDesk(db2, req.session.deskId, req.params.id);
  const body = jsonOf(req);
  const name = strOf(body, "name") ?? String(row.name);
  const place = strOf(body, "place") ?? String(row.place);
  if (String(row.state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  await db2.query("update clients set name = $1, place = $2 where id = $3", [name, place, row.id]);
  const after = await db2.one("select * from clients where id = $1", [row.id]);
  return jsonResponse(200, clientView(after));
});
route("DELETE", "/api/clients/:id", async (req, _store, db2) => {
  const row = await clientOfDesk(db2, req.session.deskId, req.params.id);
  const jobs = await db2.one("select count(*) as n from jobs where client_id = $1", [row.id]);
  if (Number(jobs.n) > 0) {
    throw new HttpError(409, "hasJobs", ARTIST_COPY.clientHasJobs);
  }
  await db2.query("delete from producers where client_id = $1", [row.id]);
  await db2.query("delete from clients where id = $1", [row.id]);
  return emptyResponse(204);
});
route("POST", "/api/clients/:id/close", async (req, _store, db2) => {
  const row = await clientOfDesk(db2, req.session.deskId, req.params.id);
  if (String(row.state) !== "active") {
    throw new HttpError(409, "notActive", ARTIST_COPY.closingNoChange);
  }
  const closesAt = now() + req.config.timers.closureWaitSeconds;
  await db2.query("update clients set state = 'closing', closes_at = $1 where id = $2", [
    String(closesAt),
    row.id
  ]);
  const after = await db2.one("select * from clients where id = $1", [row.id]);
  return jsonResponse(200, clientView(after));
});
route("POST", "/api/clients/:id/bring-back", async (req, _store, db2) => {
  const row = await clientOfDesk(db2, req.session.deskId, req.params.id);
  const state = String(row.state);
  if (state === "active") {
    throw new HttpError(409, "notClosing", ARTIST_COPY.notClosing);
  }
  if (state === "erased" || state === "erasing") {
    throw new HttpError(404, "unknownClient", "There is nothing at this address.");
  }
  if (Number(row.closes_at) <= now()) {
    throw new HttpError(409, "waitPassed", ARTIST_COPY.waitPassed);
  }
  await db2.query("update clients set state = 'active', closes_at = null where id = $1", [row.id]);
  const after = await db2.one("select * from clients where id = $1", [row.id]);
  return jsonResponse(200, clientView(after));
});
route("GET", "/api/clients/:id/producers", async (req, _store, db2) => {
  const row = await clientOfDesk(db2, req.session.deskId, req.params.id);
  const producers = await db2.many("select * from producers where client_id = $1 order by name", [row.id]);
  return jsonResponse(200, { producers: producers.map(producerView) });
});
route("POST", "/api/clients/:id/producers", async (req, _store, db2) => {
  const row = await clientOfDesk(db2, req.session.deskId, req.params.id);
  const body = jsonOf(req);
  const name = requireName(body);
  const email = requireEmail(body);
  const town = strOf(body, "town");
  const language = strOf(body, "language");
  if (town === null || !TOWNS.includes(town)) {
    throw new HttpError(422, "town", "Pick a town from the list.", { town: "Pick a town from the list." });
  }
  if (language === null || !LANGUAGES.includes(language)) {
    throw new HttpError(422, "language", "Pick a language from the list.", { language: "Pick a language from the list." });
  }
  const id = newId();
  await db2.query(
    "insert into producers (id, client_id, name, email, town, language) values ($1, $2, $3, $4, $5, $6)",
    [id, row.id, name, email, town, language]
  );
  const after = await db2.one("select * from producers where id = $1", [id]);
  return jsonResponse(201, producerView(after));
});
route("PATCH", "/api/producers/:id", async (req, _store, db2) => {
  const row = await producerOfDesk(db2, req.session.deskId, req.params.id);
  const body = jsonOf(req);
  const name = strOf(body, "name") ?? String(row.name);
  const email = strOf(body, "email") ?? String(row.email);
  const town = strOf(body, "town") ?? String(row.town);
  const language = strOf(body, "language") ?? String(row.language);
  if (!TOWNS.includes(town) || !LANGUAGES.includes(language)) {
    throw new HttpError(422, "shape", "Pick a town and a language from the lists.", {
      town: "Pick a town from the list."
    });
  }
  await db2.query("update producers set name = $1, email = $2, town = $3, language = $4 where id = $5", [
    name,
    email,
    town,
    language,
    row.id
  ]);
  const after = await db2.one("select * from producers where id = $1", [row.id]);
  return jsonResponse(200, producerView(after));
});
function producerView(row) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: String(row.name),
    email: String(row.email),
    town: String(row.town),
    language: String(row.language)
  };
}
__name(producerView, "producerView");
async function clientOfDesk(db2, deskId, clientId) {
  const row = await db2.one("select * from clients where id = $1 and desk_id = $2", [clientId, deskId]);
  if (row === null || String(row.state) === "erased") {
    throw new HttpError(404, "unknownClient", "There is nothing at this address.");
  }
  return row;
}
__name(clientOfDesk, "clientOfDesk");
async function producerOfDesk(db2, deskId, producerId) {
  const row = await db2.one(
    "select p.* from producers p join clients c on c.id = p.client_id where p.id = $1 and c.desk_id = $2 and c.state <> 'erased'",
    [producerId, deskId]
  );
  if (row === null) {
    throw new HttpError(404, "unknownProducer", "There is nothing at this address.");
  }
  return row;
}
__name(producerOfDesk, "producerOfDesk");
var PLACES = ["netherlands", "ontario", "newYork", "dubai"];
var TOWNS = ["amsterdam", "newYork", "toronto", "dubai"];
var LANGUAGES = ["en", "nl", "fr", "ar"];
function jobView(row) {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    clientName: String(row.client_name ?? ""),
    title: String(row.title),
    adId: String(row.ad_id),
    dueDate: String(row.due_date),
    targetSeconds: Number(row.target_seconds),
    frameRate: String(row.frame_rate),
    aspect: String(row.aspect),
    state: String(row.state),
    createdAt: instantText(Number(row.created_at))
  };
}
__name(jobView, "jobView");
route("GET", "/api/jobs", async (req, _store, db2) => {
  const deskId = req.session.deskId;
  const clientFilter = req.query.get("clientId");
  const stateFilter = req.query.get("state");
  const rateFilter = req.query.get("frameRate");
  const sort = req.query.get("sort") ?? "dueDate";
  const cursor = req.query.get("cursor");
  const limit = Math.min(25, Number(req.query.get("limit") ?? "25") || 25);
  const conditions = ["j.desk_id = $1", "j.state <> 'archived'"];
  const params = [deskId];
  if (clientFilter !== null && clientFilter !== "") {
    params.push(clientFilter);
    conditions.push(`j.client_id = $${params.length}`);
  }
  if (stateFilter === "archived") {
    conditions[1] = "j.state = 'archived'";
  } else if (stateFilter !== null && stateFilter !== "") {
    params.push(stateFilter);
    conditions.push(`j.state = $${params.length}`);
  }
  if (rateFilter !== null && rateFilter !== "") {
    params.push(rateFilter);
    conditions.push(`j.frame_rate = $${params.length}`);
  }
  const sortKey = sort === "title" ? "fold_lower(j.title), j.id" : "j.due_date, fold_lower(j.title), j.id";
  const where = conditions.join(" and ");
  const totalRow = await db2.one(`select count(*) as n from jobs j where ${where}`, params);
  let query = `select j.id, j.client_id, c.name as client_name, j.title, j.ad_id, j.due_date, j.target_seconds, j.frame_rate, j.aspect, j.state, j.created_at from jobs j join clients c on c.id = j.client_id where ${where}`;
  const cursorRow = cursor === null ? null : await db2.one("select id from jobs where id = $1 and desk_id = $2", [cursor, deskId]);
  if (cursorRow !== null) {
    query += ` and (${sortKey}) > (select ${sortKey === "fold_lower(j.title), j.id" ? "fold_lower(title), id" : "due_date, fold_lower(title), id"} from jobs where id = '${cursor}')`;
  }
  query += ` order by ${sortKey} limit ${limit + 1}`;
  const rows = await db2.many(query, params);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return jsonResponse(200, {
    jobs: page.map(jobView),
    total: Number(totalRow.n),
    nextCursor: hasMore && page.length > 0 ? String(page[page.length - 1].id) : null
  });
});
route("POST", "/api/jobs", async (req, _store, db2) => {
  const body = jsonOf(req);
  const clientId = strOf(body, "clientId");
  const title = strOf(body, "title");
  const adId = strOf(body, "adId");
  const dueDate = strOf(body, "dueDate");
  const targetSeconds = numOf(body, "targetSeconds");
  const frameRate = strOf(body, "frameRate");
  const aspect = strOf(body, "aspect");
  if (title === null || title.trim().length === 0) {
    throw new HttpError(422, "title", COPY.typeATitle, { title: COPY.typeATitle });
  }
  if (adId === null || adIdProblem(adId) !== null) {
    const message = adIdProblem(adId ?? "") ?? ARTIST_COPY.adIdShape;
    throw new HttpError(422, "adId", message, { adId: message });
  }
  if (dueDate === null || dateOfText(dueDate) === null) {
    throw new HttpError(422, "dueDate", COPY.typeADate, { dueDate: COPY.typeADate });
  }
  if (targetSeconds === null || !TARGET_SECONDS.includes(targetSeconds)) {
    throw new HttpError(422, "targetSeconds", "Pick a target length from the list.", {
      targetSeconds: "Pick a target length from the list."
    });
  }
  if (frameRate === null || !isFrameRate(frameRate)) {
    throw new HttpError(422, "frameRate", "Pick a frame rate from the list.", {
      frameRate: "Pick a frame rate from the list."
    });
  }
  if (aspect === null || !ASPECTS.includes(aspect)) {
    throw new HttpError(422, "aspect", "Pick an aspect from the list.", { aspect: "Pick an aspect from the list." });
  }
  const client = await clientOfDesk(db2, req.session.deskId, clientId ?? "");
  if (String(client.state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const id = newId();
  await db2.query(
    "insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds, frame_rate, aspect, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [id, req.session.deskId, client.id, title.trim(), adId, dueDate, targetSeconds, frameRate, aspect, "draft", String(now())]
  );
  await db2.query("insert into board_stamps (job_id, stamp, frame_rate) values ($1, $2, $3)", [
    id,
    newToken(),
    frameRate
  ]);
  const row = await jobRow(db2, id);
  await addHistory(db2, id, "jobCreated", String((await deskRow(db2, req)).name), `Job created.`);
  return jsonResponse(201, jobView(row));
});
var TARGET_SECONDS = [6, 15, 30, 60];
var ASPECTS = ["16:9", "1:1", "9:16"];
async function jobRow(db2, jobId) {
  const row = await db2.one(
    "select j.id, j.client_id, c.name as client_name, j.title, j.ad_id, j.due_date, j.target_seconds, j.frame_rate, j.aspect, j.state, j.created_at from jobs j join clients c on c.id = j.client_id where j.id = $1",
    [jobId]
  );
  if (row === null) throw new HttpError(404, "unknownJob", "There is nothing at this address.");
  return row;
}
__name(jobRow, "jobRow");
async function jobOfDesk(db2, deskId, jobId) {
  const row = await db2.one(
    "select j.*, c.state as client_state from jobs j join clients c on c.id = j.client_id where j.id = $1 and j.desk_id = $2",
    [jobId, deskId]
  );
  if (row === null || String(row.client_state) === "erased") {
    throw new HttpError(404, "unknownJob", "There is nothing at this address.");
  }
  return row;
}
__name(jobOfDesk, "jobOfDesk");
route("GET", "/api/jobs/:id", async (req, _store, db2) => {
  const row = await jobOfDesk(db2, req.session.deskId, req.params.id);
  return jsonResponse(200, jobView(row));
});
route("PATCH", "/api/jobs/:id", async (req, _store, db2) => {
  const row = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(row.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const body = jsonOf(req);
  const title = strOf(body, "title") ?? String(row.title);
  const adId = strOf(body, "adId") ?? String(row.ad_id);
  const dueDate = strOf(body, "dueDate") ?? String(row.due_date);
  const targetSeconds = numOf(body, "targetSeconds") ?? Number(row.target_seconds);
  if (adIdProblem(adId) !== null) {
    const message = adIdProblem(adId) ?? ARTIST_COPY.adIdShape;
    throw new HttpError(422, "adId", message, { adId: message });
  }
  if (dateOfText(dueDate) === null) {
    throw new HttpError(422, "dueDate", COPY.typeADate, { dueDate: COPY.typeADate });
  }
  if (!TARGET_SECONDS.includes(targetSeconds)) {
    throw new HttpError(422, "targetSeconds", "Pick a target length from the list.", {
      targetSeconds: "Pick a target length from the list."
    });
  }
  await db2.query("update jobs set title = $1, ad_id = $2, due_date = $3, target_seconds = $4 where id = $5", [
    title,
    adId,
    dueDate,
    targetSeconds,
    row.id
  ]);
  const after = await jobRow(db2, String(row.id));
  await addHistory(db2, String(row.id), "jobSaved", String((await deskRow(db2, req)).name), "Job saved.");
  return jsonResponse(200, jobView(after));
});
route("POST", "/api/jobs/:id/duplicate", async (req, _store, db2) => {
  const row = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const id = newId();
  await db2.query(
    "insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds, frame_rate, aspect, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [
      id,
      req.session.deskId,
      String(row.client_id),
      `${String(row.title)} copy`,
      String(row.ad_id),
      String(row.due_date),
      Number(row.target_seconds),
      String(row.frame_rate),
      String(row.aspect),
      "draft",
      String(now())
    ]
  );
  await db2.query("insert into board_stamps (job_id, stamp, frame_rate) values ($1, $2, $3)", [
    id,
    newToken(),
    String(row.frame_rate)
  ]);
  const frames = await db2.many("select * from frames where job_id = $1 order by position", [String(row.id)]);
  let position = 1;
  for (const frame of frames) {
    await db2.query(
      "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [
        newId(),
        id,
        Number(frame.number),
        position,
        Number(frame.duration_frames),
        String(frame.action_note),
        String(frame.audio_note),
        String(frame.shot),
        String(frame.visual),
        frame.file_name === null ? null : String(frame.file_name),
        frame.width === null ? null : Number(frame.width),
        frame.height === null ? null : Number(frame.height),
        frame.sha256 === null ? null : String(frame.sha256),
        Boolean(frame.seeded),
        String(now())
      ]
    );
    position++;
  }
  const after = await jobRow(db2, id);
  await addHistory(db2, id, "jobDuplicated", String((await deskRow(db2, req)).name), "Job duplicated.");
  return jsonResponse(201, jobView(after));
});
route("POST", "/api/jobs/:id/archive", async (req, _store, db2) => {
  const row = await jobOfDesk(db2, req.session.deskId, req.params.id);
  await db2.query("update jobs set state = 'archived' where id = $1", [row.id]);
  const after = await jobRow(db2, String(row.id));
  await addHistory(db2, String(row.id), "jobArchived", String((await deskRow(db2, req)).name), "Job archived.");
  return jsonResponse(200, jobView(after));
});
route("GET", "/api/search", async (req, _store, db2) => {
  const q = searchOf(req.query.get("q"));
  if (q === null) {
    return jsonResponse(200, { jobs: [], clients: [], producers: [], total: 0 });
  }
  const needle = foldForCompare(q);
  const deskId = req.session.deskId;
  const jobs = await db2.many(
    "select j.id, j.title from jobs j join clients c on c.id = j.client_id where j.desk_id = $1 and j.state <> 'archived' and c.state in ('active','closing','erasing')",
    [deskId]
  );
  const clients = await db2.many(
    "select id, name from clients where desk_id = $1 and state in ('active','closing','erasing')",
    [deskId]
  );
  const producers = await db2.many(
    "select p.id, p.name, p.client_id from producers p join clients c on c.id = p.client_id where c.desk_id = $1 and c.state in ('active','closing','erasing')",
    [deskId]
  );
  const matchedJobs = jobs.filter((j) => foldForCompare(String(j.title)).includes(needle));
  const matchedClients = clients.filter((c) => foldForCompare(String(c.name)).includes(needle));
  const matchedProducers = producers.filter((p) => foldForCompare(String(p.name)).includes(needle));
  return jsonResponse(200, {
    jobs: matchedJobs.map((j) => ({ id: String(j.id), title: String(j.title) })),
    clients: matchedClients.map((c) => ({ id: String(c.id), name: String(c.name) })),
    producers: matchedProducers.map((p) => ({
      id: String(p.id),
      name: String(p.name),
      clientId: String(p.client_id)
    })),
    total: matchedJobs.length + matchedClients.length + matchedProducers.length
  });
});
route("GET", "/api/jobs/:id/history", async (req, _store, db2) => {
  await jobOfDesk(db2, req.session.deskId, req.params.id);
  const events = await db2.many(
    "select at, actor, action, text from job_history where job_id = $1 order by at, id",
    [req.params.id]
  );
  return jsonResponse(200, {
    events: events.map((e) => ({
      at: instantText(Number(e.at)),
      actor: String(e.actor),
      action: String(e.action),
      text: String(e.text)
    }))
  });
});
async function addHistory(db2, jobId, action, actor, text) {
  await db2.query(
    "insert into job_history (id, job_id, at, actor, action, text) values ($1, $2, $3, $4, $5, $6)",
    [newId(), jobId, String(now()), actor, action, text]
  );
}
__name(addHistory, "addHistory");
route("GET", "/api/jobs/:id/board", async (req, _store, db2) => {
  await jobOfDesk(db2, req.session.deskId, req.params.id);
  const view = await loadBoard(db2, req.params.id);
  if (view === null) throw new HttpError(404, "unknownJob", "There is nothing at this address.");
  return jsonResponse(200, view);
});
route("POST", "/api/jobs/:id/frames", async (req, store2, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupportedType", "Send the file as multipart form data.");
  }
  const parts = parseMultipart(req.body, contentType);
  const file = findFile(parts, "file");
  if (file === null) {
    throw new HttpError(422, "file", "Choose a file to upload.", { file: "Choose a file to upload." });
  }
  if (file.data.length > FRAME_FILE_LIMIT) {
    throw new HttpError(413, "tooLarge", ARTIST_COPY.uploadTooBig);
  }
  const image = readImage(file.data);
  if (image === null) {
    throw new HttpError(422, "file", ARTIST_COPY.uploadNotImage, { file: ARTIST_COPY.uploadNotImage });
  }
  const [w, h] = image;
  const aspect = String(job.aspect);
  if (!aspectMatches(w, h, aspect)) {
    const message = ARTIST_COPY.uploadAspect(w, h, aspect);
    throw new HttpError(422, "file", message, { file: message });
  }
  const sha = sha256Hex(file.data);
  const repeat = await db2.one(
    "select number from frames where job_id = $1 and sha256 = $2",
    [String(job.id), sha]
  );
  if (repeat !== null) {
    const message = ARTIST_COPY.uploadDuplicate(Number(repeat.number));
    throw new HttpError(422, "file", message, { file: message });
  }
  const stored = await store2.put(objectKey(String(job.client_id), String(job.id), `frames/${sha}`), file.data, imageMimeOf(file.data));
  if (!stored.ok) {
    throw new HttpError(503, "storeUnavailable", ARTIST_COPY.storeUnavailable);
  }
  const empty = await db2.one(
    "select id, number from frames where job_id = $1 and sha256 is null order by number limit 1",
    [String(job.id)]
  );
  let frameNumber;
  if (empty !== null) {
    frameNumber = Number(empty.number);
    await db2.query(
      "update frames set duration_frames = $1, file_name = $2, width = $3, height = $4, sha256 = $5, seeded = false where id = $6",
      [nominalFrames(rate(job)), file.filename, w, h, sha, String(empty.id)]
    );
  } else {
    const next = await nextFrameNumber(db2, String(job.id));
    frameNumber = next;
    await db2.query(
      "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [newId(), String(job.id), next, await nextPosition(db2, String(job.id)), nominalFrames(rate(job)), "", "", "", "", file.filename, w, h, sha, false, String(now())]
    );
  }
  await newBoardStamp(db2, String(job.id));
  const view = await loadBoard(db2, String(job.id));
  return jsonResponse(201, { frame: view.frames.find((f) => f.number === frameNumber), stamp: view.stamp });
});
function rate(job) {
  const r = String(job.frame_rate);
  return isFrameRate(r) ? r : "25";
}
__name(rate, "rate");
function objectKey(clientId, jobId, rest) {
  return `clients/${clientId}/jobs/${jobId}/${rest}`;
}
__name(objectKey, "objectKey");
async function nextFrameNumber(db2, jobId) {
  const row = await db2.one("select max(number) as n from frames where job_id = $1", [jobId]);
  return row === null || row.n === null ? 1 : Number(row.n) + 1;
}
__name(nextFrameNumber, "nextFrameNumber");
async function nextPosition(db2, jobId) {
  const row = await db2.one("select max(position) as n from frames where job_id = $1", [jobId]);
  return row === null || row.n === null ? 1 : Number(row.n) + 1;
}
__name(nextPosition, "nextPosition");
function readImage(data) {
  if (data.length >= 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) {
    const w = data.readUInt32BE(16);
    const h = data.readUInt32BE(20);
    return [w, h];
  }
  if (data.length >= 2 && data[0] === 255 && data[1] === 216) {
    let at = 2;
    while (at + 9 < data.length) {
      if (data[at] !== 255) {
        at++;
        continue;
      }
      const marker = data[at + 1];
      if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) {
        const h = data.readUInt16BE(at + 5);
        const w = data.readUInt16BE(at + 7);
        return [w, h];
      }
      const len = data.readUInt16BE(at + 2);
      at += 2 + len;
    }
  }
  return null;
}
__name(readImage, "readImage");
function imageMimeOf(data) {
  if (data.length >= 4 && data[0] === 137 && data[1] === 80) return "image/png";
  return "image/jpeg";
}
__name(imageMimeOf, "imageMimeOf");
function aspectMatches(w, h, aspect) {
  switch (aspect) {
    case "16:9":
      return w * 9 === h * 16;
    case "1:1":
      return w === h;
    case "9:16":
      return w * 16 === h * 9;
    default:
      return false;
  }
}
__name(aspectMatches, "aspectMatches");
route("PATCH", "/api/jobs/:id/frames/:number", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp === null) {
    throw new HttpError(422, "stamp", "This board changed in another window. Reload it.", { stamp: "Reload the board." });
  }
  const row = await db2.one("select * from frames where job_id = $1 and number = $2", [
    String(job.id),
    Number(req.params.number)
  ]);
  if (row === null) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  await requireStamp(db2, String(job.id), stamp);
  const duration = numOf(body, "durationFrames");
  if (duration !== void 0 && duration !== null) {
    if (!Number.isInteger(duration) || duration < 1) {
      throw new HttpError(422, "durationFrames", "A clip is at least 1 frame.", {
        durationFrames: "A clip is at least 1 frame."
      });
    }
  }
  const actionNote = strOf(body, "actionNote") ?? String(row.action_note);
  await db2.query(
    "update frames set duration_frames = $1, action_note = $2 where id = $3",
    [duration ?? Number(row.duration_frames), actionNote, String(row.id)]
  );
  await newBoardStamp(db2, String(job.id));
  const view = await loadBoard(db2, String(job.id));
  return jsonResponse(200, view);
});
route("GET", "/api/jobs/:id/frames/:number/drawing", async (req, store2, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const row = await db2.one("select * from frames where job_id = $1 and number = $2", [
    String(job.id),
    Number(req.params.number)
  ]);
  if (row === null || row.sha256 === null) {
    if (row !== null && Boolean(row.seeded)) {
      return textResponse(200, "image/svg+xml", seededDrawing(Number(row.number), String(row.action_note)).toString("utf8"));
    }
    throw new HttpError(404, "noDrawing", "There is nothing at this address.");
  }
  const data = await store2.get(objectKey(String(job.client_id), String(job.id), `frames/${String(row.sha256)}`));
  if (data === null) throw new HttpError(404, "noDrawing", "There is nothing at this address.");
  return bytesResponse(200, imageMimeOf(data), data);
});
route("POST", "/api/jobs/:id/frames/:number/move", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  const position = numOf(body, "position");
  if (stamp === null || position === null || !Number.isInteger(position) || position < 1) {
    throw new HttpError(422, "position", "Pick a position on the board.", { position: "Pick a position on the board." });
  }
  await requireStamp(db2, String(job.id), stamp);
  const frames = await db2.many("select id, number, position from frames where job_id = $1 order by position", [String(job.id)]);
  if (position > frames.length) {
    throw new HttpError(422, "position", "Pick a position on the board.", { position: "Pick a position on the board." });
  }
  const moving = frames.find((f) => Number(f.number) === Number(req.params.number));
  if (moving === void 0) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  const order = frames.filter((f) => String(f.id) !== String(moving.id));
  order.splice(position - 1, 0, moving);
  let at = 1;
  for (const frame of order) {
    await db2.query("update frames set position = $1 where id = $2", [at, String(frame.id)]);
    at++;
  }
  await newBoardStamp(db2, String(job.id));
  const view = await loadBoard(db2, String(job.id));
  return jsonResponse(200, view);
});
route("POST", "/api/jobs/:id/frames/:number/duplicate", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp === null) {
    throw new HttpError(422, "stamp", "Reload the board.", { stamp: "Reload the board." });
  }
  await requireStamp(db2, String(job.id), stamp);
  const row = await db2.one("select * from frames where job_id = $1 and number = $2", [
    String(job.id),
    Number(req.params.number)
  ]);
  if (row === null) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  const number = await nextFrameNumber(db2, String(job.id));
  const position = await nextPosition(db2, String(job.id));
  await db2.query(
    "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    [
      newId(),
      String(job.id),
      number,
      position,
      Number(row.duration_frames),
      String(row.action_note),
      String(row.audio_note),
      String(row.shot),
      String(row.visual),
      row.file_name === null ? null : String(row.file_name),
      row.width === null ? null : Number(row.width),
      row.height === null ? null : Number(row.height),
      row.sha256 === null ? null : String(row.sha256),
      Boolean(row.seeded),
      String(now())
    ]
  );
  await newBoardStamp(db2, String(job.id));
  const view = await loadBoard(db2, String(job.id));
  return jsonResponse(201, view);
});
route("POST", "/api/jobs/:id/frames/:number/insert-after", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp === null) {
    throw new HttpError(422, "stamp", "Reload the board.", { stamp: "Reload the board." });
  }
  await requireStamp(db2, String(job.id), stamp);
  const row = await db2.one("select * from frames where job_id = $1 and number = $2", [
    String(job.id),
    Number(req.params.number)
  ]);
  if (row === null) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  const after = Number(row.position);
  const frames = await db2.many("select id from frames where job_id = $1 order by position", [String(job.id)]);
  let at = 1;
  for (const frame of frames) {
    if (at === after + 1) {
      const number = await nextFrameNumber(db2, String(job.id));
      await db2.query(
        "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        [newId(), String(job.id), number, at, nominalFrames(rate(job)), "", "", "", "", null, null, null, null, false, String(now())]
      );
    }
    await db2.query("update frames set position = $1 where id = $2", [at, String(frame.id)]);
    at++;
  }
  await newBoardStamp(db2, String(job.id));
  const view = await loadBoard(db2, String(job.id));
  return jsonResponse(201, view);
});
route("POST", "/api/jobs/:id/removals", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  const frameNumber = numOf(body, "frame");
  if (stamp === null || frameNumber === null) {
    throw new HttpError(422, "frame", "Pick a frame on the board.", { frame: "Pick a frame on the board." });
  }
  await requireStamp(db2, String(job.id), stamp);
  const row = await db2.one("select * from frames where job_id = $1 and number = $2", [String(job.id), frameNumber]);
  if (row === null) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  const endsAt = now() + req.config.timers.undoSeconds;
  await db2.query(
    "insert into removals (job_id, frame, frame_id, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, ends_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    [
      String(job.id),
      frameNumber,
      String(row.id),
      Number(row.position),
      Number(row.duration_frames),
      String(row.action_note),
      String(row.audio_note),
      String(row.shot),
      String(row.visual),
      row.file_name === null ? null : String(row.file_name),
      row.width === null ? null : Number(row.width),
      row.height === null ? null : Number(row.height),
      row.sha256 === null ? null : String(row.sha256),
      Boolean(row.seeded),
      String(endsAt)
    ]
  );
  await db2.query("delete from frames where id = $1", [String(row.id)]);
  const rest = await db2.many("select id from frames where job_id = $1 order by position", [String(job.id)]);
  let at = 1;
  for (const frame of rest) {
    await db2.query("update frames set position = $1 where id = $2", [at, String(frame.id)]);
    at++;
  }
  await newBoardStamp(db2, String(job.id));
  return jsonResponse(201, {
    frame: frameNumber,
    position: Number(row.position),
    endsAt: instantText(endsAt),
    stamp: (await loadBoard(db2, String(job.id))).stamp
  });
});
route("GET", "/api/jobs/:id/removals", async (req, _store, db2) => {
  await jobOfDesk(db2, req.session.deskId, req.params.id);
  await reapRemovals(db2, req.params.id);
  const rows = await db2.many(
    "select frame, position, ends_at from removals where job_id = $1 and ends_at > $2",
    [req.params.id, String(now())]
  );
  return jsonResponse(200, {
    removals: rows.map((r) => ({
      frame: Number(r.frame),
      position: Number(r.position),
      endsAt: instantText(Number(r.ends_at))
    }))
  });
});
route("POST", "/api/jobs/:id/removals/:number/hold", async (req, _store, db2) => {
  await jobOfDesk(db2, req.session.deskId, req.params.id);
  await reapRemovals(db2, req.params.id);
  const row = await db2.one("select * from removals where job_id = $1 and frame = $2", [
    req.params.id,
    Number(req.params.number)
  ]);
  if (row === null) {
    throw new HttpError(409, "undoPassed", ARTIST_COPY.undoPassed);
  }
  const endsAt = now() + req.config.timers.undoSeconds;
  await db2.query("update removals set ends_at = $1 where job_id = $2 and frame = $3", [
    String(endsAt),
    req.params.id,
    Number(req.params.number)
  ]);
  return jsonResponse(200, { frame: Number(row.frame), position: Number(row.position), endsAt: instantText(endsAt) });
});
route("POST", "/api/jobs/:id/removals/:number/undo", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  await reapRemovals(db2, req.params.id);
  const row = await db2.one("select * from removals where job_id = $1 and frame = $2", [
    req.params.id,
    Number(req.params.number)
  ]);
  if (row === null) {
    throw new HttpError(409, "undoPassed", ARTIST_COPY.undoPassed);
  }
  const frames = await db2.many("select id, position from frames where job_id = $1 order by position", [String(job.id)]);
  const target = Number(row.position);
  const order = [];
  let placed = false;
  for (const frame of frames) {
    if (!placed && Number(frame.position) >= target) {
      order.push(row);
      placed = true;
    }
    order.push(frame);
  }
  if (!placed) order.push(row);
  let at = 1;
  for (const frame of order) {
    if (frame === row) {
      await db2.query(
        "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        [
          String(row.frame_id),
          String(job.id),
          Number(row.frame),
          at,
          Number(row.duration_frames),
          String(row.action_note),
          String(row.audio_note),
          String(row.shot),
          String(row.visual),
          row.file_name === null ? null : String(row.file_name),
          row.width === null ? null : Number(row.width),
          row.height === null ? null : Number(row.height),
          row.sha256 === null ? null : String(row.sha256),
          Boolean(row.seeded),
          String(now())
        ]
      );
    } else {
      await db2.query("update frames set position = $1 where id = $2", [at, String(frame.id)]);
    }
    at++;
  }
  await db2.query("delete from removals where job_id = $1 and frame = $2", [String(job.id), Number(row.frame)]);
  await newBoardStamp(db2, String(job.id));
  const view = await loadBoard(db2, String(job.id));
  return jsonResponse(200, view);
});
async function reapRemovals(db2, jobId) {
  await db2.query("delete from removals where job_id = $1 and ends_at <= $2", [jobId, String(now())]);
}
__name(reapRemovals, "reapRemovals");
route("POST", "/api/jobs/:id/frame-rate", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  const next = strOf(body, "frameRate");
  const playhead = numOf(body, "playhead");
  if (stamp === null || next === null || !isFrameRate(next) || playhead === null) {
    throw new HttpError(422, "frameRate", "Pick a frame rate from the list.", {
      frameRate: "Pick a frame rate from the list."
    });
  }
  await requireStamp(db2, String(job.id), stamp);
  const from = rate(job);
  const frames = await db2.many("select id, duration_frames from frames where job_id = $1 order by position", [String(job.id)]);
  for (const frame of frames) {
    const converted = convertFrames(Number(frame.duration_frames), from, next);
    await db2.query("update frames set duration_frames = $1 where id = $2", [converted, String(frame.id)]);
  }
  await db2.query("update board_stamps set frame_rate = $1 where job_id = $2", [next, String(job.id)]);
  await db2.query("update jobs set frame_rate = $1 where id = $2", [next, String(job.id)]);
  await newBoardStamp(db2, String(job.id));
  const view = await loadBoard(db2, String(job.id));
  const total = view.totalFrames;
  const newPlayhead = Math.min(playhead, Math.max(0, total - 1));
  return jsonResponse(200, { ...view, playhead: newPlayhead });
});
route("POST", "/api/jobs/:id/script/preview", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupportedType", "Send the file as multipart form data.");
  }
  const parts = parseMultipart(req.body, contentType);
  const file = findFile(parts, "file");
  if (file === null) {
    throw new HttpError(422, "file", "Choose a file to read.", { file: "Choose a file to read." });
  }
  if (file.data.length > FRAME_FILE_LIMIT) {
    throw new HttpError(413, "tooLarge", "This file is over 8,000,000 bytes.");
  }
  const parsed = parseScriptFile(file.data);
  if (parsed === null) {
    throw new HttpError(422, "file", ARTIST_COPY.scriptNotUtf8, { file: ARTIST_COPY.scriptNotUtf8 });
  }
  if (!parsed.headerOk) {
    throw new HttpError(422, "file", ARTIST_COPY.scriptHeader, { file: ARTIST_COPY.scriptHeader });
  }
  const rows = await scriptRows(db2, String(job.id), parsed.rows);
  return jsonResponse(200, { rows });
});
route("POST", "/api/jobs/:id/script", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupportedType", "Send the file as multipart form data.");
  }
  const parts = parseMultipart(req.body, contentType);
  const file = findFile(parts, "file");
  if (file === null) {
    throw new HttpError(422, "file", "Choose a file to read.", { file: "Choose a file to read." });
  }
  if (file.data.length > FRAME_FILE_LIMIT) {
    throw new HttpError(413, "tooLarge", "This file is over 8,000,000 bytes.");
  }
  const parsed = parseScriptFile(file.data);
  if (parsed === null) {
    throw new HttpError(422, "file", ARTIST_COPY.scriptNotUtf8, { file: ARTIST_COPY.scriptNotUtf8 });
  }
  if (!parsed.headerOk) {
    throw new HttpError(422, "file", ARTIST_COPY.scriptHeader, { file: ARTIST_COPY.scriptHeader });
  }
  const rows = await scriptRows(db2, String(job.id), parsed.rows);
  const frameRate = rate(job);
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const refused = rows.filter((r) => r.result === "refused").length;
  for (const row of rows) {
    if (row.result === "new") {
      const number = await nextFrameNumber(db2, String(job.id));
      const duration = secondsToFrames(parsed.rows[row.row - 2].seconds, frameRate);
      await db2.query(
        "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        [
          newId(),
          String(job.id),
          number,
          await nextPosition(db2, String(job.id)),
          duration,
          parsed.rows[row.row - 2].visual,
          parsed.rows[row.row - 2].audio,
          parsed.rows[row.row - 2].shot,
          parsed.rows[row.row - 2].visual,
          null,
          null,
          null,
          null,
          false,
          String(now())
        ]
      );
      created++;
    } else if (row.result === "matched") {
      const existing = await db2.one("select * from frames where job_id = $1 and shot = $2", [
        String(job.id),
        parsed.rows[row.row - 2].shot
      ]);
      if (existing !== null) {
        const duration = secondsToFrames(parsed.rows[row.row - 2].seconds, frameRate);
        if (Number(existing.duration_frames) !== duration || String(existing.action_note) !== parsed.rows[row.row - 2].visual || String(existing.audio_note) !== parsed.rows[row.row - 2].audio) {
          await db2.query("update frames set duration_frames = $1, action_note = $2, audio_note = $3, visual = $4 where id = $5", [
            duration,
            parsed.rows[row.row - 2].visual,
            parsed.rows[row.row - 2].audio,
            parsed.rows[row.row - 2].visual,
            String(existing.id)
          ]);
          updated++;
        } else {
          unchanged++;
        }
      }
    }
  }
  if (created + updated > 0) {
    await newBoardStamp(db2, String(job.id));
  }
  return jsonResponse(200, { created, updated, unchanged, refused, rows });
});
function parseScriptFile(data) {
  let text;
  try {
    if (data[0] === 239 && data[1] === 187 && data[2] === 191) {
      text = data.subarray(3).toString("utf8");
    } else {
      text = data.toString("utf8");
    }
  } catch {
    return null;
  }
  if (text.includes("\0")) return null;
  const rows = parseCsv(text);
  if (rows.length === 0) return { headerOk: false, rows: [] };
  const header = rows[0];
  const headerOk = header.length === 4 && header[0] === "shot" && header[1] === "visual" && header[2] === "audio" && header[3] === "seconds";
  return {
    headerOk,
    rows: rows.slice(1).map((r) => ({ shot: r[0] ?? "", visual: r[1] ?? "", audio: r[2] ?? "", seconds: r[3] ?? "" }))
  };
}
__name(parseScriptFile, "parseScriptFile");
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""));
}
__name(parseCsv, "parseCsv");
async function scriptRows(db2, jobId, rows) {
  const existing = await db2.many("select shot, number from frames where job_id = $1", [jobId]);
  const byShot = new Map(existing.map((e) => [String(e.shot), Number(e.number)]));
  const seen = /* @__PURE__ */ new Map();
  const out = [];
  let rowNumber = 2;
  for (const row of rows) {
    if (row.shot.trim().length === 0) {
      out.push({ row: rowNumber, shot: row.shot, result: "refused", reason: ARTIST_COPY.scriptRowShot(rowNumber) });
    } else if (seen.has(row.shot)) {
      out.push({
        row: rowNumber,
        shot: row.shot,
        result: "refused",
        reason: ARTIST_COPY.scriptRowDuplicate(rowNumber, row.shot, seen.get(row.shot))
      });
    } else if (parsePositiveDecimal(row.seconds, null) === null) {
      out.push({
        row: rowNumber,
        shot: row.shot,
        result: "refused",
        reason: ARTIST_COPY.scriptRowSeconds(rowNumber)
      });
    } else if (byShot.has(row.shot)) {
      seen.set(row.shot, rowNumber);
      out.push({ row: rowNumber, shot: row.shot, result: "matched", reason: null });
    } else {
      seen.set(row.shot, rowNumber);
      out.push({ row: rowNumber, shot: row.shot, result: "new", reason: null });
    }
    rowNumber++;
  }
  return out;
}
__name(scriptRows, "scriptRows");
function lineProblems(x, y, width, height, clips, text, frameRate, framePosition, totalFrames) {
  if (text.trim().length === 0) {
    return ARTIST_COPY.lineEmpty;
  }
  const left = 5 - x;
  const top = 5 - y;
  const right = x + width - 95;
  const bottom = y + height - 95;
  const worst = Math.max(left, top, right, bottom);
  if (worst > 0) {
    const scaled = BigInt(Math.round(worst * 10)) * 10n;
    return ARTIST_COPY.lineOutside(`${scaled / 100n}.${(scaled % 100n / 10n).toString()}`);
  }
  const words = text.trim().split(/\s+/).length;
  const needRat = Rat.of(BigInt(words), 3n).mul(RATE_RAT[frameRate]);
  const need = Number(needRat.roundHalfUp());
  const startFrame = framePosition - 1;
  const framesAvailable = Math.max(0, totalFrames - startFrame);
  if (need > framesAvailable) {
    return ARTIST_COPY.lineReading(need, framesAvailable);
  }
  return null;
}
__name(lineProblems, "lineProblems");
route("GET", "/api/jobs/:id/lines", async (req, _store, db2) => {
  await jobOfDesk(db2, req.session.deskId, req.params.id);
  const market = req.query.get("market");
  const rows = await db2.many("select * from lines where job_id = $1", [req.params.id]);
  const filtered = market === null ? rows : rows.filter((r) => String(r.market) === market);
  return jsonResponse(200, { lines: filtered.map(lineView) });
});
function lineView(row) {
  return {
    id: String(row.id),
    frame: Number(row.frame),
    market: String(row.market),
    text: String(row.text),
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    clips: Number(row.clips)
  };
}
__name(lineView, "lineView");
route("POST", "/api/jobs/:id/lines", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const body = jsonOf(req);
  const frame = numOf(body, "frame");
  const market = strOf(body, "market");
  const text = strOf(body, "text");
  const x = numOf(body, "x");
  const y = numOf(body, "y");
  const width = numOf(body, "width");
  const height = numOf(body, "height");
  const clips = numOf(body, "clips") ?? 1;
  if (frame === null || market === null || text === null || x === null || y === null || width === null || height === null) {
    throw new HttpError(422, "shape", "Type the line's text.", { text: ARTIST_COPY.lineEmpty });
  }
  if (!MARKETS.includes(market)) {
    throw new HttpError(422, "market", "Pick a market from the list.", { market: "Pick a market from the list." });
  }
  const frameRow = await db2.one("select position from frames where job_id = $1 and number = $2", [String(job.id), frame]);
  if (frameRow === null) {
    throw new HttpError(422, "frame", "Pick a frame from the board.", { frame: "Pick a frame from the board." });
  }
  const view = await loadBoard(db2, String(job.id));
  const problem = lineProblems(x, y, width, height, clips, text, rate(job), Number(frameRow.position), view.totalFrames);
  if (problem !== null) {
    throw new HttpError(422, "line", problem, { line: problem });
  }
  const id = newId();
  await db2.query(
    "insert into lines (id, job_id, frame, market, text, x, y, width, height, clips) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [id, String(job.id), frame, market, text, String(x), String(y), String(width), String(height), clips]
  );
  const after = await db2.one("select * from lines where id = $1", [id]);
  return jsonResponse(201, lineView(after));
});
route("PATCH", "/api/lines/:id", async (req, _store, db2) => {
  const row = await lineOfDesk(db2, req.session.deskId, req.params.id);
  const job = await jobRow(db2, String(row.job_id));
  const body = jsonOf(req);
  const frame = numOf(body, "frame") ?? Number(row.frame);
  const market = strOf(body, "market") ?? String(row.market);
  const text = strOf(body, "text") ?? String(row.text);
  const x = numOf(body, "x") ?? Number(row.x);
  const y = numOf(body, "y") ?? Number(row.y);
  const width = numOf(body, "width") ?? Number(row.width);
  const height = numOf(body, "height") ?? Number(row.height);
  const clips = numOf(body, "clips") ?? Number(row.clips);
  const frameRow = await db2.one("select position from frames where job_id = $1 and number = $2", [String(row.job_id), frame]);
  if (frameRow === null) {
    throw new HttpError(422, "frame", "Pick a frame from the board.", { frame: "Pick a frame from the board." });
  }
  const view = await loadBoard(db2, String(row.job_id));
  const problem = lineProblems(x, y, width, height, clips, text, rate(job), Number(frameRow.position), view.totalFrames);
  if (problem !== null) {
    throw new HttpError(422, "line", problem, { line: problem });
  }
  await db2.query(
    "update lines set frame = $1, market = $2, text = $3, x = $4, y = $5, width = $6, height = $7, clips = $8 where id = $9",
    [frame, market, text, String(x), String(y), String(width), String(height), clips, String(row.id)]
  );
  const after = await db2.one("select * from lines where id = $1", [String(row.id)]);
  return jsonResponse(200, lineView(after));
});
route("DELETE", "/api/lines/:id", async (req, _store, db2) => {
  const row = await lineOfDesk(db2, req.session.deskId, req.params.id);
  await db2.query("delete from lines where id = $1", [String(row.id)]);
  return emptyResponse(204);
});
async function lineOfDesk(db2, deskId, lineId) {
  const row = await db2.one(
    "select l.* from lines l join jobs j on j.id = l.job_id where l.id = $1 and j.desk_id = $2",
    [lineId, deskId]
  );
  if (row === null) throw new HttpError(404, "unknownLine", "There is nothing at this address.");
  return row;
}
__name(lineOfDesk, "lineOfDesk");
var MARKETS = ["en", "nl", "fr", "ar"];
route("GET", "/api/cues/search", async (req, _store, db2) => {
  const q = req.query.get("q");
  const cursor = req.query.get("cursor");
  if (q === null || q.trim().length === 0) {
    return jsonResponse(200, { tracks: [], nextCursor: null });
  }
  const cacheKey = `search:${q.trim()}:${cursor ?? ""}`;
  const cached = await cueCacheGet(db2, cacheKey);
  if (cached !== null) {
    return jsonResponse(200, cached);
  }
  const hollowreed = new Hollowreed(req.config);
  try {
    const page = await hollowreed.searchTracks(q.trim(), cursor);
    const body = {
      tracks: page.tracks.map((t) => ({
        id: t.id,
        title: t.title,
        composer: t.composer,
        seconds: t.seconds
      })),
      nextCursor: page.nextCursor
    };
    await cueCacheSet(db2, cacheKey, body);
    return jsonResponse(200, body);
  } catch (e) {
    if (e instanceof RateLimited) {
      throw new HttpError(429, "rateLimited", "The music library is busy right now.", null, {
        "Retry-After": String(e.retryAfterSeconds)
      });
    }
    throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
  }
});
async function cueCacheGet(db2, key) {
  const row = await db2.one("select at, value from cue_cache where key = $1", [key]);
  if (row === null) return null;
  if (Number(row.at) + 0 <= now()) return null;
  return JSON.parse(String(row.value));
}
__name(cueCacheGet, "cueCacheGet");
async function cueCacheSet(db2, key, value) {
}
__name(cueCacheSet, "cueCacheSet");
route("GET", "/api/jobs/:id/cues", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const rows = await db2.many("select * from cues where job_id = $1 order by from_date, id", [String(job.id)]);
  const at = now();
  return jsonResponse(200, {
    cues: rows.map((row) => ({
      id: String(row.id),
      trackId: String(row.track_id),
      title: String(row.title),
      composer: String(row.composer),
      seconds: Number(row.seconds),
      market: String(row.market),
      from: String(row.from_date),
      until: String(row.until_date),
      fee: Number(row.fee),
      licenceId: String(row.licence_id),
      licenceText: licenceTextOf(String(row.until_date), MARKET_TOWN[String(row.market)], at)
    }))
  });
});
var MARKET_TOWN = { NL: "amsterdam", US: "newYork", CA: "toronto", AE: "dubai" };
route("POST", "/api/jobs/:id/cues", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const body = jsonOf(req);
  const trackId = strOf(body, "trackId");
  const market = strOf(body, "market");
  const from = strOf(body, "from");
  const until = strOf(body, "until");
  if (trackId === null || market === null || from === null || until === null) {
    throw new HttpError(422, "shape", "Pick a track, a market and the licence window.", {
      market: "Pick a market from the list."
    });
  }
  if (!LICENCE_MARKETS.includes(market)) {
    throw new HttpError(422, "market", "Pick a market from the list.", { market: "Pick a market from the list." });
  }
  if (dateOfText(from) === null || dateOfText(until) === null) {
    throw new HttpError(422, "window", COPY.typeADate, { from: COPY.typeADate, until: COPY.typeADate });
  }
  if (until < from) {
    throw new HttpError(422, "window", ARTIST_COPY.licenceOrder, { until: ARTIST_COPY.licenceOrder });
  }
  const hollowreed = new Hollowreed(req.config);
  let fee = "0.00";
  try {
    const prices = await hollowreed.prices();
    const today = wallDate("amsterdam", now());
    const inEffect = prices.filter((p) => p.validFrom <= today).sort((a, b) => a.validFrom < b.validFrom ? 1 : -1);
    if (inEffect.length === 0) {
      throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
    }
    fee = inEffect[0].perMarket;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
  }
  let licenceId;
  try {
    const licence = await hollowreed.buyLicence({ trackId, market, from, until, fee });
    licenceId = licence.licenceId;
  } catch (e) {
    if (e instanceof RateLimited) {
      throw new HttpError(429, "rateLimited", "The music library is busy right now.", null, {
        "Retry-After": String(e.retryAfterSeconds)
      });
    }
    throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
  }
  const track = await trackById(hollowreed, trackId);
  const id = newId();
  await db2.query(
    "insert into cues (id, job_id, track_id, title, composer, seconds, market, from_date, until_date, fee, licence_id, licence_text) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [id, String(job.id), trackId, track.title, track.composer, track.seconds, market, from, until, fee, licenceId, `Licence ref ${licenceId}`]
  );
  const after = await db2.one("select * from cues where id = $1", [id]);
  return jsonResponse(201, {
    id: String(after.id),
    trackId: String(after.track_id),
    title: String(after.title),
    composer: String(after.composer),
    seconds: Number(after.seconds),
    market: String(after.market),
    from: String(after.from_date),
    until: String(after.until_date),
    fee: Number(after.fee),
    licenceId: String(after.licence_id),
    licenceText: licenceTextOf(String(after.until_date), MARKET_TOWN[String(after.market)], now())
  });
});
async function trackById(hollowreed, trackId) {
  try {
    const page = await hollowreed.searchTracks("", null);
    const found = page.tracks.find((t) => t.id === trackId);
    if (found !== void 0) return found;
  } catch {
    throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
  }
  throw new HttpError(422, "trackId", "Pick a track from the list.", { trackId: "Pick a track from the list." });
}
__name(trackById, "trackById");
route("DELETE", "/api/jobs/:id/cues/:cueId", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const row = await db2.one("select * from cues where id = $1 and job_id = $2", [req.params.cueId, String(job.id)]);
  if (row === null) throw new HttpError(404, "unknownCue", "There is nothing at this address.");
  await db2.query("delete from cues where id = $1", [String(row.id)]);
  return emptyResponse(204);
});
var LICENCE_MARKETS = ["NL", "US", "CA", "AE"];
route("GET", "/api/jobs/:id/cuts", async (req, _store, db2) => {
  await jobOfDesk(db2, req.session.deskId, req.params.id);
  const rows = await db2.many("select * from cuts where job_id = $1 order by number", [req.params.id]);
  return jsonResponse(200, { cuts: rows.map(cutView) });
});
function cutView(row) {
  return {
    id: String(row.id),
    number: Number(row.number),
    name: String(row.name),
    frameRate: String(row.frame_rate),
    createdAt: instantText(Number(row.created_at)),
    signedOffAt: row.signed_off_at === null ? null : instantText(Number(row.signed_off_at)),
    signedOffBy: row.signed_off_by === null ? null : String(row.signed_off_by)
  };
}
__name(cutView, "cutView");
route("POST", "/api/jobs/:id/cuts", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const name = strOf(body, "name") ?? "";
  if (name.trim().length === 0) {
    throw new HttpError(422, "name", COPY.typeAName, { name: COPY.typeAName });
  }
  const used = await db2.many("select number from cuts where job_id = $1", [String(job.id)]);
  const usedNumbers = new Set(used.map((u) => Number(u.number)));
  let number = 1;
  while (usedNumbers.has(number)) number++;
  const id = newId();
  await db2.query(
    "insert into cuts (id, job_id, number, name, frame_rate, created_at) values ($1, $2, $3, $4, $5, $6)",
    [id, String(job.id), number, name.trim(), rate(job), String(now())]
  );
  const frames = await db2.many("select * from frames where job_id = $1 order by position", [String(job.id)]);
  let position = 1;
  for (const frame of frames) {
    await db2.query(
      "insert into cut_frames (cut_id, frame_id, frame_number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
      [
        id,
        String(frame.id),
        Number(frame.number),
        position,
        Number(frame.duration_frames),
        String(frame.action_note),
        String(frame.audio_note),
        String(frame.shot),
        String(frame.visual),
        frame.file_name === null ? null : String(frame.file_name),
        frame.width === null ? null : Number(frame.width),
        frame.height === null ? null : Number(frame.height),
        frame.sha256 === null ? null : String(frame.sha256),
        Boolean(frame.seeded)
      ]
    );
    position++;
  }
  const row = await db2.one("select * from cuts where id = $1", [id]);
  await addHistory(db2, String(job.id), "cutMade", String((await deskRow(db2, req)).name), `Cut ${number} made.`);
  return jsonResponse(201, cutView(row));
});
route("GET", "/api/jobs/:id/cuts/:number", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const cut = await cutOfJob(db2, String(job.id), Number(req.params.number));
  const frames = await db2.many(
    "select * from cut_frames where cut_id = $1 order by position",
    [String(cut.id)]
  );
  return jsonResponse(200, {
    ...cutView(cut),
    frames: frames.map((f) => ({
      number: 0,
      position: Number(f.position),
      durationFrames: Number(f.duration_frames),
      actionNote: String(f.action_note),
      audioNote: String(f.audio_note),
      shot: String(f.shot),
      visual: String(f.visual),
      fileName: f.file_name === null ? null : String(f.file_name),
      width: f.width === null ? null : Number(f.width),
      height: f.height === null ? null : Number(f.height),
      sha256: f.sha256 === null ? null : String(f.sha256),
      drawingUrl: null
    }))
  });
});
async function cutOfJob(db2, jobId, number) {
  const row = await db2.one("select * from cuts where job_id = $1 and number = $2", [jobId, number]);
  if (row === null) throw new HttpError(404, "unknownCut", "There is nothing at this address.");
  return row;
}
__name(cutOfJob, "cutOfJob");
route("PATCH", "/api/jobs/:id/cuts/:number", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const cut = await cutOfJob(db2, String(job.id), Number(req.params.number));
  if (cut.signed_off_at !== null) {
    throw new HttpError(409, "signedOff", ARTIST_COPY.cutSignedNoChange);
  }
  const body = jsonOf(req);
  const name = strOf(body, "name") ?? String(cut.name);
  await db2.query("update cuts set name = $1 where id = $2", [name, String(cut.id)]);
  const after = await db2.one("select * from cuts where id = $1", [String(cut.id)]);
  await addHistory(db2, String(job.id), "cutSaved", String((await deskRow(db2, req)).name), `Cut ${Number(cut.number)} saved.`);
  return jsonResponse(200, cutView(after));
});
route("DELETE", "/api/jobs/:id/cuts/:number", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const cut = await cutOfJob(db2, String(job.id), Number(req.params.number));
  if (cut.signed_off_at !== null) {
    throw new HttpError(409, "signedOff", ARTIST_COPY.cutSignedNoChange);
  }
  await db2.query("delete from cut_frames where cut_id = $1", [String(cut.id)]);
  await db2.query("delete from cuts where id = $1", [String(cut.id)]);
  await addHistory(db2, String(job.id), "cutDeleted", String((await deskRow(db2, req)).name), `Cut ${Number(cut.number)} deleted.`);
  return emptyResponse(204);
});
route("POST", "/api/jobs/:id/cuts/:number/bring-back", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp === null) {
    throw new HttpError(422, "stamp", "Reload the board.", { stamp: "Reload the board." });
  }
  await requireStamp(db2, String(job.id), stamp);
  const cut = await cutOfJob(db2, String(job.id), Number(req.params.number));
  const frames = await db2.many("select * from cut_frames where cut_id = $1 order by position", [String(cut.id)]);
  const frameIds = new Set(frames.map((f) => String(f.frame_id)));
  const existing = await db2.many("select * from frames where job_id = $1", [String(job.id)]);
  for (const frame of existing) {
    if (!frameIds.has(String(frame.id))) {
      await db2.query("delete from frames where id = $1", [String(frame.id)]);
    }
  }
  let position = 1;
  for (const frame of frames) {
    const held = await db2.one("select id from frames where id = $1", [String(frame.frame_id)]);
    if (held === null) {
      await db2.query(
        "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        [
          String(frame.frame_id),
          String(job.id),
          await nextFrameNumber(db2, String(job.id)),
          position,
          Number(frame.duration_frames),
          String(frame.action_note),
          String(frame.audio_note),
          String(frame.shot),
          String(frame.visual),
          frame.file_name === null ? null : String(frame.file_name),
          frame.width === null ? null : Number(frame.width),
          frame.height === null ? null : Number(frame.height),
          frame.sha256 === null ? null : String(frame.sha256),
          Boolean(frame.seeded),
          String(now())
        ]
      );
    } else {
      await db2.query(
        "update frames set position = $1, duration_frames = $2, action_note = $3, audio_note = $4, shot = $5, visual = $6, file_name = $7, width = $8, height = $9, sha256 = $10, seeded = $11 where id = $12",
        [
          position,
          Number(frame.duration_frames),
          String(frame.action_note),
          String(frame.audio_note),
          String(frame.shot),
          String(frame.visual),
          frame.file_name === null ? null : String(frame.file_name),
          frame.width === null ? null : Number(frame.width),
          frame.height === null ? null : Number(frame.height),
          frame.sha256 === null ? null : String(frame.sha256),
          Boolean(frame.seeded),
          String(frame.frame_id)
        ]
      );
    }
    position++;
  }
  await db2.query("update board_stamps set frame_rate = $1 where job_id = $2", [String(cut.frame_rate), String(job.id)]);
  await db2.query("update jobs set frame_rate = $1 where id = $2", [String(cut.frame_rate), String(job.id)]);
  await newBoardStamp(db2, String(job.id));
  await addHistory(db2, String(job.id), "cutBroughtBack", String((await deskRow(db2, req)).name), `Cut ${Number(cut.number)} is the board again.`);
  const view = await loadBoard(db2, String(job.id));
  return jsonResponse(200, view);
});
route("GET", "/api/jobs/:id/compare", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const a = Number(req.query.get("a") ?? "0");
  const b = Number(req.query.get("b") ?? "0");
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    throw new HttpError(422, "cuts", "Pick two cuts to compare.", { cuts: "Pick two cuts to compare." });
  }
  const older = await cutOfJob(db2, String(job.id), Math.min(a, b));
  const newer = await cutOfJob(db2, String(job.id), Math.max(a, b));
  const olderFrames = await db2.many("select * from cut_frames where cut_id = $1 order by position", [String(older.id)]);
  const newerFrames = await db2.many("select * from cut_frames where cut_id = $1 order by position", [String(newer.id)]);
  const olderByFrameId = new Map(olderFrames.map((f) => [String(f.frame_id), f]));
  const differences = [];
  for (const frame of newerFrames) {
    const before = olderByFrameId.get(String(frame.frame_id));
    if (before === void 0) {
      differences.push(`Frame ${numberOf(db2, frame)} is new.`);
      continue;
    }
    const beforePosition = Number(before.position);
    const afterPosition = Number(frame.position);
    if (beforePosition !== afterPosition) {
      differences.push(`Frame ${numberOf(db2, frame)} moved from position ${beforePosition} to position ${afterPosition}.`);
    }
    const beforeDuration = Number(before.duration_frames);
    const afterDuration = Number(frame.duration_frames);
    if (beforeDuration !== afterDuration) {
      const unit = /* @__PURE__ */ __name((n) => n === 1 ? "1 frame" : `${n} frames`, "unit");
      differences.push(
        afterDuration < beforeDuration ? `Frame ${numberOf(db2, frame)} is ${unit(beforeDuration - afterDuration)} shorter.` : `Frame ${numberOf(db2, frame)} is ${unit(afterDuration - beforeDuration)} longer.`
      );
    }
    if (String(before.sha256 ?? "") !== String(frame.sha256 ?? "") || Boolean(before.seeded) !== Boolean(frame.seeded)) {
      differences.push(`Frame ${numberOf(db2, frame)} has a new drawing.`);
    }
  }
  const newerIds = new Set(newerFrames.map((f) => String(f.frame_id)));
  for (const frame of olderFrames) {
    if (!newerIds.has(String(frame.frame_id))) {
      differences.push(`Frame ${numberOf(db2, frame)} is gone.`);
    }
  }
  return jsonResponse(200, {
    differences,
    a: cutView(older),
    b: cutView(newer)
  });
});
function numberOf(db2, frame) {
  return Number(frame.frame_number ?? 0);
}
__name(numberOf, "numberOf");
route("GET", "/api/jobs/:id/renders", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  await tickRenders(req.config, db2, {
    put: /* @__PURE__ */ __name(async () => ({ ok: false }), "put"),
    get: /* @__PURE__ */ __name(async () => null, "get"),
    remove: /* @__PURE__ */ __name(async () => ({ ok: false }), "remove"),
    exists: /* @__PURE__ */ __name(async () => false, "exists")
  }, now());
  const rows = await db2.many("select * from renders where job_id = $1 order by created_at, id", [String(job.id)]);
  const busyRow = await db2.one("select at from file_rates where desk_id = $1 and at > $2 order by at limit 1", [
    `render:${req.session.deskId}`,
    String(now())
  ]);
  const view = await loadBoard(db2, String(job.id));
  const renders = rows.map((row) => renderView(db2, row, view));
  return jsonResponse(200, {
    renders,
    busy: busyRow === null ? null : { until: instantText(Number(busyRow.at)), message: "The render service is busy right now." }
  });
});
function renderView(db2, row, boardView) {
  return {
    id: String(row.id),
    cut: Number(row.cut_number),
    width: Number(row.width),
    burnTimecode: Boolean(row.burn_timecode),
    state: String(row.state),
    progress: Number(row.progress),
    message: row.message === null ? null : String(row.message),
    size: row.size === null ? null : Number(row.size),
    sha256: row.sha256 === null ? null : String(row.sha256),
    filmUrl: String(row.state) === "ready" ? `/api/jobs/${String(row.job_id)}/renders/${String(row.id)}/film` : null,
    createdAt: instantText(Number(row.created_at))
  };
}
__name(renderView, "renderView");
route("POST", "/api/jobs/:id/renders", async (req, store2, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const body = jsonOf(req);
  const cutNumber = numOf(body, "cut");
  const width = numOf(body, "width");
  const burnTimecode = boolOf(body, "burnTimecode");
  if (cutNumber === null || width === null || width !== 640 && width !== 1280 || burnTimecode === null) {
    throw new HttpError(422, "shape", "Pick a width and whether to burn in the timecode.", {
      width: "Pick a width from the list."
    });
  }
  const cut = await cutOfJob(db2, String(job.id), cutNumber);
  const busyRow = await db2.one("select at from file_rates where desk_id = $1 and at > $2 order by at limit 1", [
    `render:${req.session.deskId}`,
    String(now())
  ]);
  if (busyRow !== null) {
    throw new HttpError(503, "busy", ARTIST_COPY.renderBusy(wallTime("amsterdam", Number(busyRow.at))), null, {
      "Retry-After": String(Math.max(1, Number(busyRow.at) - now()))
    });
  }
  const held = await db2.one(
    "select * from renders where job_id = $1 and cut_id = $2 and width = $3 and burn_timecode = $4 and state in ('queued','running','done','ready') order by created_at desc limit 1",
    [String(job.id), String(cut.id), width, burnTimecode ? "t" : "f"]
  );
  if (held !== null && (String(held.state) === "ready" || String(held.state) === "done")) {
    return jsonResponse(200, renderView(db2, held, null));
  }
  const clips = await db2.many("select * from cut_frames where cut_id = $1 order by position", [String(cut.id)]);
  const quaymill = new Quaymill(req.config);
  let providerId;
  try {
    const asked = await quaymill.ask({
      cutId: String(cut.id),
      frameRate: String(cut.frame_rate),
      width,
      burnTimecode,
      clips: clips.map((c) => ({
        frame: numberOf(db2, c),
        durationFrames: Number(c.duration_frames),
        sha256: c.sha256 === null ? null : String(c.sha256)
      }))
    });
    providerId = asked.id;
  } catch (e) {
    if (e instanceof RateLimited) {
      await db2.query("insert into file_rates (desk_id, at) values ($1, $2)", [
        `render:${req.session.deskId}`,
        String(now() + e.retryAfterSeconds)
      ]);
      throw new HttpError(503, "busy", ARTIST_COPY.renderBusy(wallTime("amsterdam", now() + e.retryAfterSeconds)), null, {
        "Retry-After": String(e.retryAfterSeconds)
      });
    }
    throw new HttpError(503, "renderUnavailable", ARTIST_COPY.renderUnavailable);
  }
  const id = newId();
  await db2.query(
    "insert into renders (id, job_id, cut_id, cut_number, width, burn_timecode, state, progress, message, size, sha256, provider_id, created_at, stored_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    [
      id,
      String(job.id),
      String(cut.id),
      Number(cut.number),
      width,
      burnTimecode ? "t" : "f",
      "queued",
      0,
      null,
      null,
      null,
      providerId,
      String(now()),
      null
    ]
  );
  return jsonResponse(202, renderView(db2, await db2.one("select * from renders where id = $1", [id]), null));
});
route("GET", "/api/jobs/:id/renders/:renderId/film", async (req, store2, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const row = await db2.one("select * from renders where id = $1 and job_id = $2", [
    req.params.renderId,
    String(job.id)
  ]);
  if (row === null || String(row.state) !== "ready") {
    throw new HttpError(404, "noFilm", "There is nothing at this address.");
  }
  const data = await store2.get(objectKey(String(job.client_id), String(job.id), `films/${String(row.id)}`));
  if (data === null) throw new HttpError(404, "noFilm", "There is nothing at this address.");
  return bytesResponse(200, "application/octet-stream", data);
});
async function tickRenders(config2, db2, store2, at) {
  const rows = await db2.many("select * from renders where state in ('queued','running') order by created_at, id", []);
  for (const row of rows) {
    const last = Number(row.polled_at ?? 0);
    if (at - last < 5) continue;
    await db2.query("update renders set polled_at = $1 where id = $2", [String(at), String(row.id)]);
    const quaymill = new Quaymill(config2);
    let state;
    try {
      state = await quaymill.poll(String(row.provider_id));
    } catch (e) {
      if (e instanceof RateLimited) {
        await db2.query("insert into file_rates (desk_id, at) values ($1, $2)", [
          `render:global`,
          String(at + e.retryAfterSeconds)
        ]);
      }
      continue;
    }
    if (state.state === "queued") continue;
    if (state.state === "running") {
      await db2.query("update renders set state = 'running', progress = $1 where id = $2", [
        String(state.progress),
        String(row.id)
      ]);
      continue;
    }
    if (state.state === "failed") {
      await db2.query("update renders set state = 'failed', message = $1 where id = $2", [
        state.reason,
        String(row.id)
      ]);
      continue;
    }
    const job = await db2.one("select * from jobs where id = $1", [String(row.job_id)]);
    if (job === null) continue;
    let film;
    try {
      film = await quaymill.fetchFilm(state.url);
    } catch {
      continue;
    }
    const size = film.length;
    const sha = sha256Hex(film);
    if (size !== state.size || sha !== state.sha256) {
      await db2.query("update renders set state = 'failed', message = $1 where id = $2", [
        "The render came back incomplete.",
        String(row.id)
      ]);
      continue;
    }
    const put = await store2.put(objectKey(String(job.client_id), String(job.id), `films/${String(row.id)}`), film, "application/octet-stream");
    if (!put.ok) continue;
    await db2.query("update renders set state = 'ready', size = $1, sha256 = $2, stored_at = $3 where id = $4", [
      String(size),
      sha,
      String(at),
      String(row.id)
    ]);
  }
}
__name(tickRenders, "tickRenders");
route("GET", "/api/jobs/:id/reviews", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const rows = await db2.many("select * from reviews where job_id = $1 order by created_at, id", [String(job.id)]);
  return jsonResponse(200, { reviews: rows.map(pageView) });
});
function pageView(row) {
  return {
    id: String(row.id),
    producerId: String(row.producer_id),
    cut: Number(row.cut),
    url: `/r/${String(row.token)}`,
    state: Number(row.ends_at) <= now() ? "ended" : String(row.state),
    endsAt: instantText(Number(row.ends_at))
  };
}
__name(pageView, "pageView");
route("POST", "/api/jobs/:id/reviews", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const producerId = strOf(body, "producerId");
  const cut = numOf(body, "cut");
  if (producerId === null || cut === null) {
    throw new HttpError(422, "shape", "Pick a producer and a cut.", { producerId: "Pick a producer from the list." });
  }
  const producer = await producerOfJob(db2, String(job.id), producerId);
  if (dateOnly(String(job.due_date)) + 86400 <= now()) {
    throw new HttpError(409, "duePassed", ARTIST_COPY.duePassed);
  }
  const existing = await db2.one("select id from reviews where job_id = $1 and producer_id = $2 and state = 'open'", [
    String(job.id),
    producerId
  ]);
  if (existing !== null) {
    await db2.query("update reviews set state = 'ended' where id = $1", [String(existing.id)]);
  }
  const town = String(producer.town);
  const endsAt = pageEndsAt(town, String(job.due_date), now(), req.config.timers.reviewPageSeconds);
  const id = newId();
  const token = newToken();
  await db2.query(
    "insert into reviews (id, job_id, producer_id, cut, token, state, ends_at, created_at, reminded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [id, String(job.id), producerId, cut, token, "open", String(endsAt), String(now()), "f"]
  );
  const row = await db2.one("select * from reviews where id = $1", [id]);
  const producerName = String(producer.name);
  await queueReviewMail(configOf(req), db2, {
    to: String(producer.email),
    language: String(producer.language),
    jobTitle: String(job.title),
    url: `${req.config.appPublicUrl}/r/${token}`,
    dueDate: String(job.due_date),
    reminder: false
  });
  await addHistory(db2, String(job.id), "reviewSent", producerName, `Review page sent to ${producerName}.`);
  await db2.query("update jobs set state = 'inReview' where id = $1 and state = 'draft'", [String(job.id)]);
  return jsonResponse(201, pageView(row));
});
function configOf(req) {
  return req.config;
}
__name(configOf, "configOf");
async function producerOfJob(db2, jobId, producerId) {
  const job = await db2.one("select client_id from jobs where id = $1", [jobId]);
  if (job === null) throw new HttpError(404, "unknownJob", "There is nothing at this address.");
  const row = await db2.one("select * from producers where id = $1 and client_id = $2", [producerId, String(job.client_id)]);
  if (row === null) throw new HttpError(404, "unknownProducer", "There is nothing at this address.");
  return row;
}
__name(producerOfJob, "producerOfJob");
async function queueReviewMail(config2, db2, input) {
  const copy = PRIVATE_COPY[input.language];
  const subject = (input.reminder ? copy.mailReminderSubject : copy.mailReviewSubject).replace("<title>", input.jobTitle);
  const body = [
    input.reminder ? `Reminder: your review page for ${input.jobTitle}` : `Your review page for ${input.jobTitle}`,
    "",
    copy.mailDueLine.replace("<date>", input.dueDate),
    "",
    input.url
  ].join("\n");
  await queueMail(db2, {
    to: input.to,
    subject,
    body,
    html: null,
    attachmentName: null,
    attachmentType: null,
    attachment: null
  });
}
__name(queueReviewMail, "queueReviewMail");
route("POST", "/api/reviews/:id/end", async (req, _store, db2) => {
  const row = await reviewOfDesk(db2, req.session.deskId, req.params.id);
  await db2.query("update reviews set state = 'ended' where id = $1", [String(row.id)]);
  const after = await db2.one("select * from reviews where id = $1", [String(row.id)]);
  return jsonResponse(200, pageView(after));
});
async function reviewOfDesk(db2, deskId, reviewId) {
  const row = await db2.one(
    "select r.* from reviews r join jobs j on j.id = r.job_id where r.id = $1 and j.desk_id = $2",
    [reviewId, deskId]
  );
  if (row === null) throw new HttpError(404, "unknownReview", "There is nothing at this address.");
  return row;
}
__name(reviewOfDesk, "reviewOfDesk");
route("GET", "/api/jobs/:id/sign-offs", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const rows = await db2.many("select * from sign_offs where job_id = $1 order by created_at, id", [String(job.id)]);
  return jsonResponse(200, { signOffs: rows.map(pageView) });
});
route("POST", "/api/jobs/:id/sign-offs", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const producerId = strOf(body, "producerId");
  const cut = numOf(body, "cut");
  if (producerId === null || cut === null) {
    throw new HttpError(422, "shape", "Pick a producer and a cut.", { producerId: "Pick a producer from the list." });
  }
  const producer = await producerOfJob(db2, String(job.id), producerId);
  const existing = await db2.one("select id from sign_offs where job_id = $1 and producer_id = $2 and state = 'open'", [
    String(job.id),
    producerId
  ]);
  if (existing !== null) {
    await db2.query("update sign_offs set state = 'ended' where id = $1", [String(existing.id)]);
  }
  const town = String(producer.town);
  const endsAt = pageEndsAt(town, String(job.due_date), now(), req.config.timers.signOffPageSeconds);
  const id = newId();
  const token = newToken();
  await db2.query(
    "insert into sign_offs (id, job_id, producer_id, cut, token, state, ends_at, created_at, signed_off_at, signed_off_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [id, String(job.id), producerId, cut, token, "open", String(endsAt), String(now()), null, null]
  );
  const row = await db2.one("select * from sign_offs where id = $1", [id]);
  const copy = PRIVATE_COPY[String(producer.language)];
  const subject = copy.signOffHeading.replace("<title>", String(job.title));
  await queueMail(db2, {
    to: String(producer.email),
    subject,
    body: [
      copy.signOffHeading.replace("<title>", String(job.title)),
      "",
      `${req.config.appPublicUrl}/s/${token}`
    ].join("\n"),
    html: null,
    attachmentName: null,
    attachmentType: null,
    attachment: null
  });
  await addHistory(db2, String(job.id), "signOffSent", String(producer.name), `Sign-off page sent to ${String(producer.name)}.`);
  return jsonResponse(201, pageView(row));
});
route("POST", "/api/sign-offs/:id/end", async (req, _store, db2) => {
  const row = await signOffOfDesk(db2, req.session.deskId, req.params.id);
  await db2.query("update sign_offs set state = 'ended' where id = $1", [String(row.id)]);
  const after = await db2.one("select * from sign_offs where id = $1", [String(row.id)]);
  return jsonResponse(200, pageView(after));
});
async function signOffOfDesk(db2, deskId, signOffId) {
  const row = await db2.one(
    "select s.* from sign_offs s join jobs j on j.id = s.job_id where s.id = $1 and j.desk_id = $2",
    [signOffId, deskId]
  );
  if (row === null) throw new HttpError(404, "unknownSignOff", "There is nothing at this address.");
  return row;
}
__name(signOffOfDesk, "signOffOfDesk");
route("GET", "/api/jobs/:id/notes", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const stateFilter = req.query.get("state");
  const producerFilter = req.query.get("producer");
  const rows = await db2.many(
    "select n.*, p.name as producer_name, p.town as town from notes n join producers p on p.id = n.producer_id where n.job_id = $1 order by n.created_at, n.id",
    [String(job.id)]
  );
  const filtered = rows.filter((r) => {
    if (stateFilter !== null && stateFilter !== "" && String(r.state) !== stateFilter) return false;
    if (producerFilter !== null && producerFilter !== "" && String(r.producer_id) !== producerFilter) return false;
    return true;
  });
  return jsonResponse(200, { notes: filtered.map((r) => noteView(db2, r)), total: filtered.length });
});
function noteView(db2, row) {
  return {
    id: String(row.id),
    frame: Number(row.frame),
    position: row.position === void 0 ? null : Number(row.position),
    goneText: row.gone_text === void 0 ? null : String(row.gone_text),
    timecode: row.timecode === void 0 ? null : String(row.timecode),
    x: Number(row.x),
    y: Number(row.y),
    producerId: String(row.producer_id),
    producerName: String(row.producer_name),
    typedName: String(row.typed_name),
    state: String(row.state),
    text: String(row.text),
    suggestedSeconds: row.suggested_seconds === null ? null : Number(row.suggested_seconds),
    suggestedFrames: row.suggested_frames === null ? null : Number(row.suggested_frames),
    attachmentUrl: row.attachment_id === null ? null : `/api/notes/${String(row.id)}/attachment`,
    createdAt: instantText(Number(row.created_at))
  };
}
__name(noteView, "noteView");
route("PATCH", "/api/notes/:id", async (req, _store, db2) => {
  const row = await noteOfDesk(db2, req.session.deskId, req.params.id);
  const body = jsonOf(req);
  const state = strOf(body, "state");
  if (state === null || !NOTE_STATES.includes(state)) {
    throw new HttpError(422, "state", "Pick a note state from the list.", { state: "Pick a note state from the list." });
  }
  await db2.query("update notes set state = $1 where id = $2", [state, String(row.id)]);
  const after = await db2.one(
    "select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id where n.id = $1",
    [String(row.id)]
  );
  return jsonResponse(200, noteView(db2, after));
});
var NOTE_STATES = ["open", "done", "wontDo"];
route("POST", "/api/jobs/:id/notes/mark", async (req, _store, db2) => {
  await jobOfDesk(db2, req.session.deskId, req.params.id);
  const body = jsonOf(req);
  const noteIds = body.noteIds;
  const state = strOf(body, "state");
  if (!Array.isArray(noteIds) || state === null || !NOTE_STATES.includes(state)) {
    throw new HttpError(422, "shape", "Pick the notes and their new state.", { state: "Pick a note state from the list." });
  }
  const ids = noteIds.map((v) => String(v));
  const held = [];
  for (const id of ids) {
    const row = await db2.one(
      "select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id where n.id = $1 and n.job_id = $2",
      [id, req.params.id]
    );
    if (row === null) {
      throw new HttpError(404, "unknownNote", "There is nothing at this address.");
    }
    held.push(row);
  }
  for (const row of held) {
    await db2.query("update notes set state = $1 where id = $2", [state, String(row.id)]);
  }
  return jsonResponse(200, { notes: held.map((r) => noteView(db2, { ...r, state })) });
});
route("GET", "/api/notes/:id/attachment", async (req, store2, db2) => {
  const row = await noteOfDesk(db2, req.session.deskId, req.params.id);
  if (row.attachment_id === null) {
    throw new HttpError(404, "noAttachment", "There is nothing at this address.");
  }
  const job = await db2.one("select * from jobs where id = $1", [String(row.job_id)]);
  const data = await store2.get(objectKey(String(job.client_id), String(job.id), `attachments/${String(row.attachment_id)}`));
  if (data === null) throw new HttpError(404, "noAttachment", "There is nothing at this address.");
  return bytesResponse(200, imageMimeOf(data), data);
});
async function noteOfDesk(db2, deskId, noteId) {
  const row = await db2.one(
    "select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id join jobs j on j.id = n.job_id where n.id = $1 and j.desk_id = $2",
    [noteId, deskId]
  );
  if (row === null) throw new HttpError(404, "unknownNote", "There is nothing at this address.");
  return row;
}
__name(noteOfDesk, "noteOfDesk");
route("GET", "/api/today", async () => {
  const at = now();
  return jsonResponse(200, {
    date: wallDate("amsterdam", at),
    weekStart: weekStartOfAmsterdam(at)
  });
});
route("GET", "/api/calls", async (req, _store, db2) => {
  const from = req.query.get("from");
  const to = req.query.get("to");
  for (const value of [from, to]) {
    if (value !== null && dateOfText(value) === null) {
      throw new HttpError(422, "date", COPY.typeADate, { date: COPY.typeADate });
    }
  }
  const rows = await db2.many("select c.*, p.name as producer_name, p.town as town from calls c join producers p on p.id = c.producer_id where c.desk_id = $1 order by c.starts_at, c.id", [
    req.session.deskId
  ]);
  const filtered = rows.filter((r) => {
    const amsterdamDate = wallDate("amsterdam", Number(r.starts_at));
    if (from !== null && amsterdamDate < from) return false;
    if (to !== null && amsterdamDate > to) return false;
    return true;
  });
  return jsonResponse(200, { calls: filtered.map((r) => callView(db2, r)) });
});
function callView(db2, row) {
  const town = String(row.town);
  const at = Number(row.starts_at);
  return {
    id: String(row.id),
    producerId: String(row.producer_id),
    producerName: String(row.producer_name),
    town,
    date: String(row.date),
    time: String(row.time),
    minutes: Number(row.minutes),
    note: String(row.note),
    startsAt: instantText(at),
    endsAt: instantText(Number(row.ends_at)),
    text: `${longDate(town, at)}, ${wallTime(town, at)} ${TOWN_LABEL_TEXT[town]} time \xB7 ${wallTime("amsterdam", at)} Amsterdam time`,
    uid: String(row.uid),
    sequence: Number(row.sequence),
    state: String(row.state)
  };
}
__name(callView, "callView");
var TOWN_LABEL_TEXT = {
  amsterdam: "Amsterdam",
  newYork: "New York",
  toronto: "Toronto",
  dubai: "Dubai"
};
route("POST", "/api/calls", async (req, _store, db2) => {
  const deskId = req.session.deskId;
  const body = jsonOf(req);
  const producerId = strOf(body, "producerId");
  const date = strOf(body, "date");
  const time = strOf(body, "time");
  const minutes = numOf(body, "minutes");
  const note = strOf(body, "note") ?? "";
  if (producerId === null || date === null || time === null || minutes === null) {
    throw new HttpError(422, "shape", "Pick a producer, a date, a time and the minutes.", {
      date: COPY.typeADate,
      time: COPY.typeATime
    });
  }
  if (dateOfText(date) === null) {
    throw new HttpError(422, "date", COPY.typeADate, { date: COPY.typeADate });
  }
  if (timeOfText(time) === null) {
    throw new HttpError(422, "time", COPY.typeATime, { time: COPY.typeATime });
  }
  if (minutes !== 30 && minutes !== 60) {
    throw new HttpError(422, "minutes", "Pick 30 or 60 minutes.", { minutes: "Pick 30 or 60 minutes." });
  }
  const producer = await producerOfDesk(db2, deskId, producerId);
  const town = String(producer.town);
  const startsAt = instantOfWall(town, date, time);
  if (startsAt === null) {
    throw new HttpError(422, "time", ARTIST_COPY.callMissing(time, TOWN_LABEL_TEXT[town], longDate(town, dateOnly(date))), {
      time: ARTIST_COPY.callMissing(time, TOWN_LABEL_TEXT[town], longDate(town, dateOnly(date)))
    });
  }
  if (startsAt <= now()) {
    throw new HttpError(422, "time", ARTIST_COPY.callPast, { time: ARTIST_COPY.callPast });
  }
  const overlap = await db2.one(
    "select * from calls where desk_id = $1 and state = 'booked' and starts_at < $2 and ends_at > $3 order by starts_at limit 1",
    [deskId, String(startsAt + minutes * 60), String(startsAt)]
  );
  if (overlap !== null) {
    const at = Number(overlap.starts_at);
    throw new HttpError(409, "taken", ARTIST_COPY.callTaken(`${wallTime("amsterdam", at)}`), {
      time: ARTIST_COPY.callTaken(`${wallTime("amsterdam", at)}`)
    });
  }
  const id = newId();
  await db2.query(
    "insert into calls (id, desk_id, producer_id, date, time, minutes, note, starts_at, ends_at, uid, sequence, state) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [id, deskId, producerId, date, time, minutes, note, String(startsAt), String(startsAt + minutes * 60), `${id}@clapstick`, 0, "booked"]
  );
  const row = await db2.one(
    "select c.*, p.name as producer_name, p.town as town from calls c join producers p on p.id = c.producer_id where c.id = $1",
    [id]
  );
  await queueCallMail(req.config, db2, row, "REQUEST");
  return jsonResponse(201, callView(db2, row));
});
route("PATCH", "/api/calls/:id", async (req, _store, db2) => {
  const row = await callOfDesk(db2, req.session.deskId, req.params.id);
  if (String(row.state) !== "booked") {
    throw new HttpError(409, "notBooked", "This call is already cancelled.");
  }
  const body = jsonOf(req);
  const date = strOf(body, "date") ?? String(row.date);
  const time = strOf(body, "time") ?? String(row.time);
  const minutes = numOf(body, "minutes") ?? Number(row.minutes);
  if (dateOfText(date) === null) {
    throw new HttpError(422, "date", COPY.typeADate, { date: COPY.typeADate });
  }
  if (timeOfText(time) === null) {
    throw new HttpError(422, "time", COPY.typeATime, { time: COPY.typeATime });
  }
  const producer = await db2.one("select * from producers where id = $1", [String(row.producer_id)]);
  const town = String(producer.town);
  const startsAt = instantOfWall(town, date, time);
  if (startsAt === null) {
    throw new HttpError(422, "time", ARTIST_COPY.callMissing(time, TOWN_LABEL_TEXT[town], longDate(town, dateOnly(date))), {
      time: ARTIST_COPY.callMissing(time, TOWN_LABEL_TEXT[town], longDate(town, dateOnly(date)))
    });
  }
  if (startsAt <= now()) {
    throw new HttpError(422, "time", ARTIST_COPY.callPast, { time: ARTIST_COPY.callPast });
  }
  const overlap = await db2.one(
    "select * from calls where desk_id = $1 and state = 'booked' and id <> $2 and starts_at < $3 and ends_at > $4 order by starts_at limit 1",
    [req.session.deskId, String(row.id), String(startsAt + minutes * 60), String(startsAt)]
  );
  if (overlap !== null) {
    const at = Number(overlap.starts_at);
    throw new HttpError(409, "taken", ARTIST_COPY.callTaken(`${wallTime("amsterdam", at)}`), {
      time: ARTIST_COPY.callTaken(`${wallTime("amsterdam", at)}`)
    });
  }
  const sequence = Number(row.sequence) + 1;
  await db2.query(
    "update calls set date = $1, time = $2, minutes = $3, starts_at = $4, ends_at = $5, sequence = $6 where id = $7",
    [date, time, minutes, String(startsAt), String(startsAt + minutes * 60), sequence, String(row.id)]
  );
  const after = await db2.one(
    "select c.*, p.name as producer_name, p.town as town from calls c join producers p on p.id = c.producer_id where c.id = $1",
    [String(row.id)]
  );
  await queueCallMail(req.config, db2, after, "REQUEST");
  return jsonResponse(200, callView(db2, after));
});
route("POST", "/api/calls/:id/cancel", async (req, _store, db2) => {
  const row = await callOfDesk(db2, req.session.deskId, req.params.id);
  if (String(row.state) !== "booked") {
    throw new HttpError(409, "notBooked", "This call is already cancelled.");
  }
  await db2.query("update calls set state = 'cancelled' where id = $1", [String(row.id)]);
  const after = await db2.one(
    "select c.*, p.name as producer_name, p.town as town from calls c join producers p on p.id = c.producer_id where c.id = $1",
    [String(row.id)]
  );
  await queueCallMail(req.config, db2, after, "CANCEL");
  return jsonResponse(200, callView(db2, after));
});
async function callOfDesk(db2, deskId, callId) {
  const row = await db2.one("select * from calls where id = $1 and desk_id = $2", [callId, deskId]);
  if (row === null) throw new HttpError(404, "unknownCall", "There is nothing at this address.");
  return row;
}
__name(callOfDesk, "callOfDesk");
async function queueCallMail(config2, db2, row, method) {
  const producer = await db2.one("select * from producers where id = $1", [String(row.producer_id)]);
  const language = String(producer.language);
  const copy = PRIVATE_COPY[language];
  const subject = (method === "CANCEL" ? copy.mailCancelledCallSubject : copy.mailCallSubject).replace(
    "<date>",
    String(row.date)
  );
  const ics = calendarFile(
    {
      uid: String(row.uid),
      sequence: Number(row.sequence),
      town: String(row.town),
      date: String(row.date),
      time: String(row.time),
      minutes: Number(row.minutes),
      note: String(row.note),
      producerName: String(producer.name),
      producerEmail: String(producer.email),
      artistEmail: "desk@noorbakkerboards.example"
    },
    method
  );
  await queueMail(db2, {
    to: String(producer.email),
    subject,
    body: `${subject}

${longDate(String(row.town), Number(row.starts_at))}, ${wallTime(String(row.town), Number(row.starts_at))} ${TOWN_LABEL_TEXT[String(row.town)]} time`,
    html: null,
    attachmentName: CALENDAR_FILE_NAME,
    attachmentType: `${CALENDAR_MIME}; method=${method}`,
    attachment: ics
  });
}
__name(queueCallMail, "queueCallMail");
route("GET", "/api/jobs/:id/packages", async (req, _store, db2) => {
  await jobOfDesk(db2, req.session.deskId, req.params.id);
  const rows = await db2.many("select * from packages where job_id = $1 order by created_at, id", [req.params.id]);
  const out = [];
  for (const row of rows) {
    const files = await db2.many("select * from package_files where package_id = $1", [String(row.id)]);
    out.push({
      id: String(row.id),
      cut: Number(row.cut),
      state: String(row.state),
      files: files.map((f) => ({
        kind: String(f.kind),
        fileName: String(f.file_name),
        size: Number(f.size),
        sha256: String(f.sha256),
        url: `/api/packages/${String(row.id)}/files/${String(f.kind)}`
      })),
      createdAt: instantText(Number(row.created_at))
    });
  }
  return jsonResponse(200, { packages: out });
});
route("POST", "/api/jobs/:id/packages", async (req, store2, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const body = jsonOf(req);
  const cut = numOf(body, "cut");
  if (cut === null) {
    throw new HttpError(422, "cut", "Pick a cut to deliver.", { cut: "Pick a cut from the list." });
  }
  const cutRow = await cutOfJob(db2, String(job.id), cut);
  if (cutRow.signed_off_at === null) {
    throw new HttpError(409, "notSignedOff", ARTIST_COPY.onlySignedOff);
  }
  const at = now();
  const cues = await db2.many("select * from cues where job_id = $1", [String(job.id)]);
  for (const cue of cues) {
    if (licenceEndedBefore(String(cue.until_date), MARKET_TOWN[String(cue.market)], at)) {
      throw new HttpError(409, "licenceEnded", ARTIST_COPY.licenceEndedPackage(String(cue.title), String(cue.until_date)));
    }
  }
  const clips = await db2.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow.id)]);
  for (const clip of clips) {
    if (clip.sha256 === null && !Boolean(clip.seeded)) {
      throw new HttpError(409, "noDrawing", ARTIST_COPY.noDrawing(numberOf(db2, clip)));
    }
  }
  const held = await db2.one("select * from packages where job_id = $1 and cut = $2", [String(job.id), cut]);
  if (held !== null && String(held.state) === "ready") {
    const files2 = await db2.many("select * from package_files where package_id = $1", [String(held.id)]);
    return jsonResponse(200, {
      id: String(held.id),
      cut,
      state: "ready",
      files: files2.map((f) => ({
        kind: String(f.kind),
        fileName: String(f.file_name),
        size: Number(f.size),
        sha256: String(f.sha256),
        url: `/api/packages/${String(held.id)}/files/${String(f.kind)}`
      })),
      createdAt: instantText(Number(held.created_at))
    });
  }
  const frameRate = String(cutRow.frame_rate);
  const boardsHtml = boardsPdfHtml(String(job.title), clips.map((c) => ({
    number: numberOf(db2, c),
    timecodeIn: timecode(0, frameRate),
    actionNote: String(c.action_note),
    seeded: Boolean(c.seeded),
    sha256: c.sha256 === null ? null : String(c.sha256)
  })));
  let boardsPdf;
  try {
    boardsPdf = await renderPdf(req.config, boardsHtml);
  } catch {
    throw new HttpError(503, "pdfUnavailable", ARTIST_COPY.pdfUnavailable);
  }
  let startFrame = 0;
  const edlClips = [];
  const shotRows = [];
  for (const clip of clips) {
    const duration = Number(clip.duration_frames);
    shotRows.push({
      position: Number(clip.position),
      frame: numberOf(db2, clip),
      timecodeIn: timecode(startFrame, frameRate),
      seconds: realSecondsText(duration, frameRate).replace(" s", ""),
      shot: String(clip.shot),
      visual: String(clip.visual),
      audio: String(clip.audio_note),
      actionNote: String(clip.action_note)
    });
    edlClips.push({
      frame: numberOf(db2, clip),
      durationFrames: duration,
      fileName: clip.file_name === null ? null : String(clip.file_name)
    });
    startFrame += duration;
  }
  const edl = editDecisionList(String(job.title), frameRate, edlClips);
  const list = shotList(shotRows);
  const packageId = newId();
  const written = [
    { key: objectKey(String(job.client_id), String(job.id), `packages/${packageId}/boards.pdf`), data: boardsPdf, kind: "boards", fileName: "boards.pdf" },
    { key: objectKey(String(job.client_id), String(job.id), `packages/${packageId}/edit-decision-list.edl`), data: Buffer.from(edl, "utf8"), kind: "editDecisionList", fileName: "edit-decision-list.edl" },
    { key: objectKey(String(job.client_id), String(job.id), `packages/${packageId}/shot-list.csv`), data: Buffer.from(list, "utf8"), kind: "shotList", fileName: "shot-list.csv" }
  ];
  for (const file of written) {
    const put = await store2.put(file.key, file.data, file.kind === "boards" ? "application/pdf" : file.kind === "editDecisionList" ? "text/plain" : "text/csv");
    if (!put.ok) {
      for (const undo of written) {
        await store2.remove(undo.key);
      }
      throw new HttpError(503, "storeUnavailable", ARTIST_COPY.storeUnavailable);
    }
  }
  await db2.query("insert into packages (id, job_id, cut, state, created_at) values ($1, $2, $3, $4, $5)", [
    packageId,
    String(job.id),
    cut,
    "ready",
    String(now())
  ]);
  for (const file of written) {
    await db2.query(
      "insert into package_files (package_id, kind, file_name, size, sha256) values ($1, $2, $3, $4, $5)",
      [packageId, file.kind, file.fileName, String(file.data.length), sha256Hex(file.data)]
    );
  }
  await db2.query("update jobs set state = 'delivered' where id = $1 and state = 'signedOff'", [String(job.id)]);
  await addHistory(db2, String(job.id), "packageMade", String((await deskRow(db2, req)).name), "Package made.");
  const files = await db2.many("select * from package_files where package_id = $1", [packageId]);
  return jsonResponse(201, {
    id: packageId,
    cut,
    state: "ready",
    files: files.map((f) => ({
      kind: String(f.kind),
      fileName: String(f.file_name),
      size: Number(f.size),
      sha256: String(f.sha256),
      url: `/api/packages/${packageId}/files/${String(f.kind)}`
    })),
    createdAt: instantText(now())
  });
});
function boardsPdfHtml(title, frames) {
  const pages = [];
  for (let i = 0; i < frames.length; i += 6) {
    const page = frames.slice(i, i + 6);
    pages.push(
      `<div class="page"><h1>${escapeHtml(title)}</h1><div class="frames">${page.map(
        (f) => `<figure><figcaption>Frame ${f.number} \xB7 ${f.timecodeIn} \xB7 ${escapeHtml(f.actionNote)}</figcaption></figure>`
      ).join("")}</div></div>`
    );
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 12mm; }
  body { font-family: serif; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 8mm; }
  .frames { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  figure { margin: 0; border: 0.4mm solid #000; height: 55mm; }
  figcaption { padding: 2mm; font-size: 8pt; }
  </style></head><body>${pages.join("")}</body></html>`;
}
__name(boardsPdfHtml, "boardsPdfHtml");
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
__name(escapeHtml, "escapeHtml");
route("GET", "/api/packages/:id/files/:kind", async (req, store2, db2) => {
  const row = await db2.one("select * from packages where id = $1", [req.params.id]);
  if (row === null) throw new HttpError(404, "unknownPackage", "There is nothing at this address.");
  const job = await jobOfDesk(db2, req.session.deskId, String(row.job_id));
  const file = await db2.one("select * from package_files where package_id = $1 and kind = $2", [
    req.params.id,
    req.params.kind
  ]);
  if (file === null) throw new HttpError(404, "unknownFile", "There is nothing at this address.");
  const deskId = req.session.deskId;
  const windowStart = now() - req.config.timers.fileRateWindowSeconds;
  await db2.query("delete from file_rates where desk_id = $1 and at <= $2", [`downloads:${deskId}`, String(windowStart)]);
  const counts = await db2.many("select at from file_rates where desk_id = $1", [`downloads:${deskId}`]);
  if (counts.length >= 5) {
    const sorted = counts.map((c) => Number(c.at)).sort((a, b) => a - b);
    const nextWindow = sorted[0] + req.config.timers.fileRateWindowSeconds;
    throw new HttpError(429, "tooManyDownloads", ARTIST_COPY.tooManyDownloads(wallTime("amsterdam", nextWindow)), null, {
      "Retry-After": String(Math.max(1, nextWindow - now()))
    });
  }
  await db2.query("insert into file_rates (desk_id, at) values ($1, $2)", [`downloads:${deskId}`, String(now())]);
  const key = objectKey(String(job.client_id), String(job.id), `packages/${String(row.id)}/${req.params.kind === "boards" ? "boards.pdf" : req.params.kind === "editDecisionList" ? "edit-decision-list.edl" : "shot-list.csv"}`);
  const data = await store2.get(key);
  if (data === null) throw new HttpError(404, "unknownFile", "There is nothing at this address.");
  return bytesResponse(200, req.params.kind === "boards" ? "application/pdf" : req.params.kind === "editDecisionList" ? "text/plain" : "text/csv", data, {
    "content-disposition": `attachment; filename="${String(file.file_name)}"`
  });
});
route("GET", "/api/jobs/:id/letter", async (req, _store, db2) => {
  await jobOfDesk(db2, req.session.deskId, req.params.id);
  const row = await db2.one("select * from letters where job_id = $1", [req.params.id]);
  if (row === null) throw new HttpError(404, "noLetter", "There is nothing at this address.");
  return jsonResponse(200, letterView(row));
});
function letterView(row) {
  const currency = String(row.currency);
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    currency,
    scope: String(row.scope),
    feeMinor: Number(row.fee_minor),
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    feeText: amountText(currency, BigInt(Number(row.fee_minor))),
    taxText: amountText(currency, BigInt(Number(row.tax_minor))),
    totalText: amountText(currency, BigInt(Number(row.total_minor))),
    milestones: milestonesOf(currency, BigInt(Number(row.fee_minor)), BigInt(Number(row.tax_minor))),
    state: String(row.state),
    stamp: String(row.stamp),
    producerId: row.producer_id === null ? null : String(row.producer_id),
    pageUrl: row.page_token === null ? null : `/f/${String(row.page_token)}`,
    endsAt: row.page_ends_at === null ? null : instantText(Number(row.page_ends_at)),
    pdfUrl: row.pdf_stored_at === null ? null : `/api/letters/${String(row.id)}/pdf`
  };
}
__name(letterView, "letterView");
function milestonesOf(currency, feeMinor, taxMinor) {
  const thirds = splitThree(feeMinor);
  const perMilestone = taxMinor / 3n;
  const firstExtra = taxMinor - perMilestone * 3n;
  const taxes = [perMilestone + firstExtra, perMilestone, perMilestone];
  return thirds.map((amount, i) => ({
    number: i + 1,
    amountMinor: Number(amount),
    taxMinor: Number(taxes[i]),
    amountText: amountText(currency, amount),
    taxText: amountText(currency, taxes[i])
  }));
}
__name(milestonesOf, "milestonesOf");
function splitThree(feeMinor) {
  return splitMilestones(feeMinor);
}
__name(splitThree, "splitThree");
route("POST", "/api/jobs/:id/letter", async (req, _store, db2) => {
  const job = await jobOfDesk(db2, req.session.deskId, req.params.id);
  const held = await db2.one("select id from letters where job_id = $1", [String(job.id)]);
  if (held !== null) {
    throw new HttpError(409, "held", "This job already has a fee letter.");
  }
  const letter = await letterFromBody(db2, req, job, null);
  const id = newId();
  await db2.query(
    "insert into letters (id, job_id, currency, scope, fee_minor, tax_minor, total_minor, state, stamp, producer_id, page_token, page_ends_at, pdf_stored_at, created_at, accepted_at, accepted_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    [
      id,
      String(job.id),
      letter.currency,
      letter.scope,
      String(letter.feeMinor),
      String(letter.taxMinor),
      String(letter.totalMinor),
      "draft",
      newToken(),
      null,
      null,
      null,
      null,
      String(now()),
      null,
      null
    ]
  );
  const row = await db2.one("select * from letters where id = $1", [id]);
  return jsonResponse(201, letterView(row));
});
async function letterFromBody(db2, req, job, existing) {
  const body = jsonOf(req);
  const fee = strOf(body, "fee");
  if (fee === null) {
    throw new HttpError(422, "fee", ARTIST_COPY.amountShape, { fee: ARTIST_COPY.amountShape });
  }
  const parsed = parsePositiveDecimal(fee, 2);
  if (parsed === null) {
    throw new HttpError(422, "fee", ARTIST_COPY.amountShape, { fee: ARTIST_COPY.amountShape });
  }
  const feeCents = feeMinorOf(parsed);
  const currency = strOf(body, "currency") ?? (existing === null ? "EUR" : String(existing.currency));
  if (!isCurrency(currency)) {
    throw new HttpError(422, "currency", "Pick a currency from the list.", { currency: "Pick a currency from the list." });
  }
  const scope = strOf(body, "scope") ?? (existing === null ? "" : String(existing.scope));
  if (scope.trim().length === 0) {
    throw new HttpError(422, "scope", "Type the letter's scope.", { scope: "Type the letter's scope." });
  }
  const client = await db2.one("select place from clients where id = $1", [String(job.client_id)]);
  const percent = taxPercentOfPlace(String(client.place));
  const thirds = splitThree(feeCents);
  const taxMinor = thirds.reduce((sum, m) => sum + taxOfMilestone(m, percent), 0n);
  return { currency, scope, feeMinor: feeCents, taxMinor, totalMinor: feeCents + taxMinor };
}
__name(letterFromBody, "letterFromBody");
function feeMinorOf(parsed) {
  if (parsed === null) return 0n;
  return parsed.n * 100n / 10n ** BigInt(String(parsed.d).length - 1 || 1);
}
__name(feeMinorOf, "feeMinorOf");
route("PATCH", "/api/letters/:id", async (req, store2, db2) => {
  const row = await letterOfDesk(db2, req.session.deskId, req.params.id);
  if (String(row.state) === "accepted") {
    throw new HttpError(409, "accepted", ARTIST_COPY.letterAcceptedLock);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp !== null && stamp !== String(row.stamp)) {
    const town = "amsterdam";
    throw new HttpError(412, "stale", ARTIST_COPY.letterStale(wallTime(town, now()), "Amsterdam"), { stamp: "Read the letter again." });
  }
  const job = await jobRow(db2, String(row.job_id));
  const letter = await letterFromBody(db2, req, job, row);
  await db2.query(
    "update letters set currency = $1, scope = $2, fee_minor = $3, tax_minor = $4, total_minor = $5, stamp = $6 where id = $7",
    [
      letter.currency,
      letter.scope,
      String(letter.feeMinor),
      String(letter.taxMinor),
      String(letter.totalMinor),
      newToken(),
      String(row.id)
    ]
  );
  if (String(row.state) === "sent" && row.pdf_stored_at !== null) {
    await renderLetterPdf(req, store2, db2, row);
  }
  const after = await db2.one("select * from letters where id = $1", [String(row.id)]);
  return jsonResponse(200, letterView(after));
});
route("POST", "/api/letters/:id/send", async (req, store2, db2) => {
  const row = await letterOfDesk(db2, req.session.deskId, req.params.id);
  if (String(row.state) === "accepted") {
    throw new HttpError(409, "accepted", ARTIST_COPY.letterAcceptedLock);
  }
  const body = jsonOf(req);
  const producerId = strOf(body, "producerId");
  if (producerId === null) {
    throw new HttpError(422, "producerId", "Pick a producer from the list.", { producerId: "Pick a producer from the list." });
  }
  const producer = await producerOfJob(db2, String(row.job_id), producerId);
  const job = await jobRow(db2, String(row.job_id));
  await renderLetterPdf(req, store2, db2, row);
  const token = newToken();
  const endsAt = now() + req.config.timers.feePageSeconds;
  await db2.query(
    "update letters set state = 'sent', producer_id = $1, page_token = $2, page_ends_at = $3 where id = $4",
    [producerId, token, String(endsAt), String(row.id)]
  );
  await queueMail(db2, {
    to: String(producer.email),
    subject: FEE_COPY.mailSubject(String(job.title)),
    body: [FEE_COPY.heading(String(job.title)), "", `${req.config.appPublicUrl}/f/${token}`].join("\n"),
    html: null,
    attachmentName: null,
    attachmentType: null,
    attachment: null
  });
  const after = await db2.one("select * from letters where id = $1", [String(row.id)]);
  await addHistory(db2, String(row.job_id), "letterSent", String(producer.name), `Fee letter sent to ${String(producer.name)}.`);
  return jsonResponse(200, letterView(after));
});
route("POST", "/api/letters/:id/end-page", async (req, _store, db2) => {
  const row = await letterOfDesk(db2, req.session.deskId, req.params.id);
  await db2.query("update letters set page_token = null, page_ends_at = null where id = $1", [String(row.id)]);
  const after = await db2.one("select * from letters where id = $1", [String(row.id)]);
  return jsonResponse(200, letterView(after));
});
route("GET", "/api/letters/:id/pdf", async (req, store2, db2) => {
  const row = await letterOfDesk(db2, req.session.deskId, req.params.id);
  if (row.pdf_stored_at === null) {
    throw new HttpError(404, "noPdf", "There is nothing at this address.");
  }
  const job = await jobRow(db2, String(row.job_id));
  const data = await store2.get(objectKey(String(job.client_id), String(job.id), `letters/${String(row.id)}/fee-letter.pdf`));
  if (data === null) throw new HttpError(404, "noPdf", "There is nothing at this address.");
  return bytesResponse(200, "application/pdf", data);
});
async function letterOfDesk(db2, deskId, letterId) {
  const row = await db2.one(
    "select l.* from letters l join jobs j on j.id = l.job_id where l.id = $1 and j.desk_id = $2",
    [letterId, deskId]
  );
  if (row === null) throw new HttpError(404, "unknownLetter", "There is nothing at this address.");
  return row;
}
__name(letterOfDesk, "letterOfDesk");
async function renderLetterPdf(req, store2, db2, row) {
  const job = await jobRow(db2, String(row.job_id));
  const currency = String(row.currency);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm; }
  body { font-family: serif; }
  h1 { font-size: 16pt; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border-bottom: 0.3mm solid #000; padding: 3mm; text-align: left; font-size: 11pt; }
  </style></head><body>
  <h1>Fee letter for ${escapeHtml(String(job.title))}</h1>
  <p>${escapeHtml(String(row.scope))}</p>
  <table>
  <tr><th>Fee</th><td>${amountText(currency, BigInt(Number(row.fee_minor)))}</td></tr>
  <tr><th>Tax</th><td>${amountText(currency, BigInt(Number(row.tax_minor)))}</td></tr>
  <tr><th>Total</th><td>${amountText(currency, BigInt(Number(row.total_minor)))}</td></tr>
  </table>
  </body></html>`;
  let pdf;
  try {
    pdf = await renderPdf(req.config, html);
  } catch {
    throw new HttpError(503, "pdfUnavailable", ARTIST_COPY.pdfUnavailable);
  }
  const put = await store2.put(objectKey(String(job.client_id), String(job.id), `letters/${String(row.id)}/fee-letter.pdf`), pdf, "application/pdf");
  if (!put.ok) {
    throw new HttpError(503, "storeUnavailable", ARTIST_COPY.storeUnavailable);
  }
  await db2.query("update letters set pdf_stored_at = $1 where id = $2", [String(now()), String(row.id)]);
}
__name(renderLetterPdf, "renderLetterPdf");
route("POST", "/api/enquiries", async (req, _store, db2) => {
  const body = jsonOf(req);
  const name = strOf(body, "name");
  const email = strOf(body, "email");
  const phone = strOf(body, "phone");
  const message = strOf(body, "message");
  if (name === null || name.trim().length === 0) {
    throw new HttpError(422, "name", COPY.typeAName, { name: COPY.typeAName });
  }
  if (email === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new HttpError(422, "email", COPY.typeAnEmail, { email: COPY.typeAnEmail });
  }
  if (message === null || message.trim().length === 0) {
    throw new HttpError(422, "message", VISITOR_COPY.enquiryMessage, { message: VISITOR_COPY.enquiryMessage });
  }
  const key = `enquiry:${email.trim().toLowerCase()}`;
  const windowStart = now() - req.config.timers.enquiryRateWindowSeconds;
  await db2.query("delete from enquiry_rates where email_key = $1 and at <= $2", [key, String(windowStart)]);
  const held = await db2.many("select at from enquiry_rates where email_key = $1", [key]);
  if (held.length >= 5) {
    const sorted = held.map((h) => Number(h.at)).sort((a, b) => a - b);
    const retryAt = sorted[0] + req.config.timers.enquiryRateWindowSeconds;
    const retry = Math.ceil((retryAt - now()) / 60);
    throw new HttpError(
      429,
      "tooManyEnquiries",
      VISITOR_COPY.enquiryLimit(wallTime("amsterdam", retryAt)),
      null,
      { "Retry-After": String(Math.max(1, retry)) }
    );
  }
  await db2.query("insert into enquiry_rates (email_key, at) values ($1, $2)", [key, String(now())]);
  await db2.query("insert into enquiries (id, name, email, phone, message, created_at) values ($1, $2, $3, $4, $5, $6)", [
    newId(),
    name.trim(),
    email.trim(),
    phone === null ? null : phone,
    message,
    String(now())
  ]);
  await queueMail(db2, {
    to: MAIL_ADDRESS,
    subject: `Enquiry from ${name.trim()}`,
    body: [name.trim(), email.trim(), phone ?? "", "", message].join("\n"),
    html: null,
    attachmentName: null,
    attachmentType: null,
    attachment: null
  });
  return jsonResponse(202, { message: VISITOR_COPY.enquiryThanks });
});
route("GET", "/api/r/:token", async (req, _store, db2) => {
  const page = await reviewByToken(db2, req.params.token);
  const producer = await db2.one("select * from producers where id = $1", [String(page.producer_id)]);
  const job = await db2.one("select * from jobs where id = $1", [String(page.job_id)]);
  const cutRow = await db2.one("select * from cuts where job_id = $1 and number = $2", [String(page.job_id), Number(page.cut)]);
  const clips = await db2.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow.id)]);
  const frameRate = String(cutRow.frame_rate);
  let startFrame = 0;
  const frames = [];
  for (const clip of clips) {
    frames.push({
      number: numberOf(db2, clip),
      position: Number(clip.position),
      durationFrames: Number(clip.duration_frames),
      timecodeIn: timecode(startFrame, frameRate),
      actionNote: String(clip.action_note),
      drawingUrl: `/api/r/${req.params.token}/frames/${numberOf(db2, clip)}/drawing`
    });
    startFrame += Number(clip.duration_frames);
  }
  const nameRow = await db2.one("select name from review_names where review_id = $1", [String(page.id)]);
  const notes = await db2.many("select * from notes where review_id = $1 order by created_at, id", [String(page.id)]);
  return jsonResponse(200, {
    language: String(producer.language),
    jobTitle: String(job.title),
    cut: Number(page.cut),
    frameRate,
    aspect: String(job.aspect),
    dueDate: String(job.due_date),
    endsAt: instantText(Number(page.ends_at)),
    name: nameRow === null ? null : String(nameRow.name),
    frames,
    notes: notes.map((n) => ({
      id: String(n.id),
      frame: Number(n.frame),
      x: Number(n.x),
      y: Number(n.y),
      text: String(n.text),
      suggestedSeconds: n.suggested_seconds === null ? null : Number(n.suggested_seconds),
      suggestedFrames: n.suggested_frames === null ? null : Number(n.suggested_frames),
      attachmentUrl: n.attachment_id === null ? null : `/api/r/${req.params.token}/attachments/${String(n.attachment_id)}`,
      createdAt: instantText(Number(n.created_at))
    }))
  });
});
async function reviewByToken(db2, token) {
  const row = await db2.one("select * from reviews where token = $1", [token]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const client = await db2.one(
    "select c.state from clients c join jobs j on j.id = $1 join clients c2 on c2.id = j.client_id where c.id = c2.id",
    [String(row.job_id)]
  );
  const job = await db2.one("select client_id from jobs where id = $1", [String(row.job_id)]);
  const clientRow = await db2.one("select state from clients where id = $1", [String(job.client_id)]);
  const ended = String(row.state) !== "open" || Number(row.ends_at) <= now() || String(clientRow.state) !== "active";
  if (ended) {
    const producer = await db2.one("select language from producers where id = $1", [String(row.producer_id)]);
    throw new HttpError(410, "pageEnded", PRIVATE_COPY[String(producer.language)].ended);
  }
  return row;
}
__name(reviewByToken, "reviewByToken");
route("GET", "/api/r/:token/frames/:number/drawing", async (req, store2, db2) => {
  const page = await db2.one("select * from reviews where token = $1", [req.params.token]);
  if (page === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const cutRow = await db2.one("select * from cuts where job_id = $1 and number = $2", [
    String(page.job_id),
    Number(page.cut)
  ]);
  const clip = await db2.one("select * from cut_frames where cut_id = $1 order by position", [String(cutRow.id)]);
  const clips = await db2.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow.id)]);
  const found = clips.find((c) => numberOf(db2, c) === Number(req.params.number));
  if (found === void 0) throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  const job = await db2.one("select * from jobs where id = $1", [String(page.job_id)]);
  if (found.sha256 !== null) {
    const data = await store2.get(objectKey(String(job.client_id), String(job.id), `frames/${String(found.sha256)}`));
    if (data !== null) return bytesResponse(200, imageMimeOf(data), data);
  }
  if (Boolean(found.seeded)) {
    return textResponse(200, "image/svg+xml", seededDrawing(numberOf(db2, found), String(found.action_note)).toString("utf8"));
  }
  throw new HttpError(404, "noDrawing", "There is nothing at this address.");
});
route("POST", "/api/r/:token/length", async (req, _store, db2) => {
  const page = await reviewByToken(db2, req.params.token);
  const body = jsonOf(req);
  const length = strOf(body, "length");
  if (length === null) {
    throw new HttpError(422, "length", "Type a length.", { length: "Type a length." });
  }
  const producer = await db2.one("select * from producers where id = $1", [String(page.producer_id)]);
  const language = String(producer.language);
  const job = await db2.one("select * from jobs where id = $1", [String(page.job_id)]);
  const parsed = parseLocalNumber(length, language);
  if (parsed === null) {
    throw new HttpError(422, "length", PRIVATE_COPY[language].numberCopy, {
      length: PRIVATE_COPY[language].numberCopy
    });
  }
  if (parsed.cents > 6000n || parsed.cents === 0n) {
    throw new HttpError(422, "length", PRIVATE_COPY[language].numberCopy, {
      length: PRIVATE_COPY[language].numberCopy
    });
  }
  const value = new Rat(parsed.cents, 100n);
  const seconds = `${value.n / value.d}${value.n % value.d === 0n ? "" : "." + trailing(value)}`;
  const frameRate = String(job.frame_rate);
  const frames = Number(value.mul(RATE_RAT[frameRate]).roundHalfUp());
  return jsonResponse(200, { seconds, frames });
});
function trailing(value) {
  const scaled = value.n * 1000n / value.d;
  return (scaled % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
}
__name(trailing, "trailing");
function parseLocalNumber(text, language) {
  const arabicDigits = text.replace(/[٠-٩]/g, (d) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(d)));
  const decimalPoint = language === "nl" || language === "fr" ? "," : ".";
  const otherPoint = decimalPoint === "," ? "." : ",";
  if (arabicDigits.includes(otherPoint)) return null;
  const m = new RegExp(`^(\\d+)(?:${decimalPoint === "," ? "," : "\\."}(\\d{1,3}))?$`).exec(arabicDigits.trim());
  if (m === null) return null;
  const whole = BigInt(m[1]);
  const fracText = m[2] ?? "";
  const frac = fracText.length === 0 ? 0n : BigInt(fracText);
  const cents = whole * 100n + frac * 100n / 10n ** BigInt(fracText.length);
  if (whole > 60n) return null;
  return { cents };
}
__name(parseLocalNumber, "parseLocalNumber");
route("POST", "/api/r/:token/attachments", async (req, store2, db2) => {
  const page = await reviewByToken(db2, req.params.token);
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupportedType", "Send the file as multipart form data.");
  }
  const parts = parseMultipart(req.body, contentType);
  const file = findFile(parts, "file");
  if (file === null) {
    throw new HttpError(422, "file", PRIVATE_COPY.en.badAttachment, { file: PRIVATE_COPY.en.badAttachment });
  }
  if (file.data.length > ATTACHMENT_FILE_LIMIT) {
    const producer = await db2.one("select language from producers where id = $1", [String(page.producer_id)]);
    const copy = PRIVATE_COPY[String(producer.language)];
    throw new HttpError(413, "tooLarge", copy.bigAttachment);
  }
  const image = readImage(file.data);
  if (image === null) {
    const producer = await db2.one("select language from producers where id = $1", [String(page.producer_id)]);
    const copy = PRIVATE_COPY[String(producer.language)];
    throw new HttpError(422, "file", copy.badAttachment, { file: copy.badAttachment });
  }
  const job = await db2.one("select * from jobs where id = $1", [String(page.job_id)]);
  const id = newId();
  const put = await store2.put(objectKey(String(job.client_id), String(job.id), `attachments/${id}`), file.data, imageMimeOf(file.data));
  if (!put.ok) {
    throw new HttpError(503, "storeUnavailable", "The file store is unavailable right now.");
  }
  await db2.query("insert into attachments (id, job_id, producer_id, content_type) values ($1, $2, $3, $4)", [
    id,
    String(page.job_id),
    String(page.producer_id),
    imageMimeOf(file.data)
  ]);
  return jsonResponse(201, { attachmentId: id });
});
route("GET", "/api/r/:token/attachments/:id", async (req, store2, db2) => {
  const page = await db2.one("select * from reviews where token = $1", [req.params.token]);
  if (page === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const row = await db2.one("select * from attachments where id = $1", [req.params.id]);
  if (row === null || String(row.producer_id) !== String(page.producer_id)) {
    throw new HttpError(404, "noAttachment", "There is nothing at this address.");
  }
  const job = await db2.one("select * from jobs where id = $1", [String(page.job_id)]);
  const data = await store2.get(objectKey(String(job.client_id), String(job.id), `attachments/${req.params.id}`));
  if (data === null) throw new HttpError(404, "noAttachment", "There is nothing at this address.");
  return bytesResponse(200, String(row.content_type), data);
});
route("POST", "/api/r/:token/notes", async (req, store2, db2) => {
  const page = await reviewByToken(db2, req.params.token);
  const body = jsonOf(req);
  const sendKey = strOf(body, "sendKey");
  const name = strOf(body, "name");
  const notes = body.notes;
  if (sendKey === null || name === null || !Array.isArray(notes)) {
    throw new HttpError(422, "shape", "Type your name and your notes.", { name: PRIVATE_COPY.en.emptyName });
  }
  const producer = await db2.one("select * from producers where id = $1", [String(page.producer_id)]);
  const language = String(producer.language);
  if (name.trim().length === 0) {
    throw new HttpError(422, "name", PRIVATE_COPY[language].emptyName, { name: PRIVATE_COPY[language].emptyName });
  }
  for (const raw of notes) {
    const note = raw;
    const text = typeof note.text === "string" ? note.text : "";
    if (text.trim().length === 0) {
      throw new HttpError(422, "text", PRIVATE_COPY[language].emptyNote, { text: PRIVATE_COPY[language].emptyNote });
    }
  }
  const sent = await db2.one("select id from review_sends where send_key = $1", [sendKey]);
  if (sent !== null) {
    const held = await db2.many("select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id where n.review_id = $1", [String(sent.review_id)]);
    return jsonResponse(200, { notes: held.map((r) => noteView(db2, r)) });
  }
  const job = await db2.one("select * from jobs where id = $1", [String(page.job_id)]);
  const frameRate = String(job.frame_rate);
  const created = [];
  for (const raw of notes) {
    const note = raw;
    const frame = Number(note.frame);
    const x = Number(note.x);
    const y = Number(note.y);
    const text = String(note.text);
    const suggested = typeof note.suggestedLength === "string" ? note.suggestedLength : null;
    const attachmentId = typeof note.attachmentId === "string" ? note.attachmentId : null;
    let suggestedSeconds = null;
    let suggestedFrames = null;
    if (suggested !== null) {
      const parsed = parseLocalNumber(suggested, language);
      if (parsed !== null) {
        const value = new Rat(parsed.cents, 100n);
        suggestedSeconds = `${value.n / value.d}${value.n % value.d === 0n ? "" : "." + trailing(value)}`;
        suggestedFrames = Number(value.mul(RATE_RAT[frameRate]).roundHalfUp());
      }
    }
    const id = newId();
    await db2.query(
      "insert into notes (id, job_id, review_id, producer_id, frame, x, y, text, typed_name, suggested_seconds, suggested_frames, attachment_id, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
      [
        id,
        String(page.job_id),
        String(page.id),
        String(page.producer_id),
        frame,
        String(x),
        String(y),
        text,
        name.trim(),
        suggestedSeconds,
        suggestedFrames === null ? null : String(suggestedFrames),
        attachmentId,
        "open",
        String(now())
      ]
    );
    const row = await db2.one(
      "select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id where n.id = $1",
      [id]
    );
    created.push(row);
  }
  await db2.query("insert into review_sends (id, review_id, send_key) values ($1, $2, $3)", [
    newId(),
    String(page.id),
    sendKey
  ]);
  await db2.query("insert into review_names (review_id, name) values ($1, $2)", [String(page.id), name.trim()]);
  await addHistory(db2, String(page.job_id), "noteSent", String(producer.name), `${String(producer.name)} left ${created.length} note${created.length === 1 ? "" : "s"}.`);
  return jsonResponse(201, { notes: created.map((r) => noteView(db2, r)) });
});
route("POST", "/api/r/:token/new-link", async (req, _store, db2) => {
  const body = jsonOf(req);
  const email = strOf(body, "email");
  if (email === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new HttpError(422, "email", COPY.typeAnEmail, { email: COPY.typeAnEmail });
  }
  const key = `link:${email.trim().toLowerCase()}`;
  const windowStart = now() - req.config.timers.reviewLinkRateWindowSeconds;
  await db2.query("delete from link_rates where email_key = $1 and at <= $2", [key, String(windowStart)]);
  const held = await db2.many("select at from link_rates where email_key = $1", [key]);
  if (held.length >= 3) {
    const sorted = held.map((h) => Number(h.at)).sort((a, b) => a - b);
    const retryAt = sorted[0] + req.config.timers.reviewLinkRateWindowSeconds;
    throw new HttpError(429, "tooManyRequests", PRIVATE_COPY.en.linkLimit, null, {
      "Retry-After": String(Math.max(1, retryAt - now()))
    });
  }
  await db2.query("insert into link_rates (email_key, at) values ($1, $2)", [key, String(now())]);
  const page = await db2.one("select * from reviews where token = $1", [req.params.token]);
  if (page !== null) {
    const producer = await db2.one("select * from producers where id = $1", [String(page.producer_id)]);
    if (producer !== null && String(producer.email).toLowerCase() === email.trim().toLowerCase()) {
      const language = String(producer.language);
      const copy = PRIVATE_COPY[language];
      const job = await db2.one("select * from jobs where id = $1", [String(page.job_id)]);
      const token = newToken();
      const town = String(producer.town);
      const endsAt = pageEndsAt(town, String(job.due_date), now(), req.config.timers.reviewPageSeconds);
      await db2.query("update reviews set token = $1, ends_at = $2, created_at = $3, reminded = 't' where id = $4", [
        token,
        String(endsAt),
        String(now()),
        String(page.id)
      ]);
      await queueMail(db2, {
        to: String(producer.email),
        subject: copy.mailNewLinkSubject,
        body: [copy.mailNewLinkSubject, "", `${req.config.appPublicUrl}/r/${token}`].join("\n"),
        html: null,
        attachmentName: null,
        attachmentType: null,
        attachment: null
      });
    }
  }
  return jsonResponse(202, { message: PRIVATE_COPY.en.linkAnswer });
});
route("GET", "/api/s/:token", async (req, _store, db2) => {
  const page = await signOffByToken(db2, req.params.token);
  const producer = await db2.one("select * from producers where id = $1", [String(page.producer_id)]);
  const job = await db2.one("select * from jobs where id = $1", [String(page.job_id)]);
  const cutRow = await db2.one("select * from cuts where job_id = $1 and number = $2", [String(page.job_id), Number(page.cut)]);
  const clips = await db2.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow.id)]);
  const frameRate = String(cutRow.frame_rate);
  let startFrame = 0;
  const frames = clips.map((clip) => {
    const view = {
      number: numberOf(db2, clip),
      position: Number(clip.position),
      durationFrames: Number(clip.duration_frames),
      timecodeIn: timecode(startFrame, frameRate),
      actionNote: String(clip.action_note),
      drawingUrl: `/api/s/${req.params.token}/frames/${numberOf(db2, clip)}/drawing`
    };
    startFrame += Number(clip.duration_frames);
    return view;
  });
  const language = String(producer.language);
  const copy = PRIVATE_COPY[language];
  const when = page.signed_off_at === null ? null : `${wallTime(String(producer.town), Number(page.signed_off_at))} ${TOWN_TIME_PHRASE_TEXT[String(producer.town)][language]}`;
  return jsonResponse(200, {
    language,
    jobTitle: String(job.title),
    cut: Number(page.cut),
    frameRate,
    endsAt: instantText(Number(page.ends_at)),
    signedOffAt: page.signed_off_at === null ? null : instantText(Number(page.signed_off_at)),
    signedOffText: page.signed_off_at === null ? null : copy.signed.replace("<when>", when ?? ""),
    frames
  });
});
var TOWN_TIME_PHRASE_TEXT = {
  amsterdam: { en: "Amsterdam time", nl: "tijd in Amsterdam", fr: "heure d'Amsterdam", ar: "\u0628\u062A\u0648\u0642\u064A\u062A \u0623\u0645\u0633\u062A\u0631\u062F\u0627\u0645" },
  newYork: { en: "New York time", nl: "tijd in New York", fr: "heure de New York", ar: "\u0628\u062A\u0648\u0642\u064A\u062A \u0646\u064A\u0648\u064A\u0648\u0631\u0643" },
  toronto: { en: "Toronto time", nl: "tijd in Toronto", fr: "heure de Toronto", ar: "\u0628\u062A\u0648\u0642\u064A\u062A \u062A\u0648\u0631\u0646\u062A\u0648" },
  dubai: { en: "Dubai time", nl: "tijd in Dubai", fr: "heure de Duba\xEF", ar: "\u0628\u062A\u0648\u0642\u064A\u062A \u062F\u0628\u064A" }
};
async function signOffByToken(db2, token) {
  const row = await db2.one("select * from sign_offs where token = $1", [token]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const job = await db2.one("select client_id from jobs where id = $1", [String(row.job_id)]);
  const clientRow = await db2.one("select state from clients where id = $1", [String(job.client_id)]);
  const ended = String(row.state) !== "open" || Number(row.ends_at) <= now() || String(clientRow.state) !== "active";
  if (ended) {
    const producer = await db2.one("select language from producers where id = $1", [String(row.producer_id)]);
    throw new HttpError(410, "pageEnded", PRIVATE_COPY[String(producer.language)].ended);
  }
  return row;
}
__name(signOffByToken, "signOffByToken");
route("POST", "/api/s/:token/sign", async (req, _store, db2) => {
  const page = await db2.one("select * from sign_offs where token = $1", [req.params.token]);
  if (page === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const producer = await db2.one("select * from producers where id = $1", [String(page.producer_id)]);
  const language = String(producer.language);
  const copy = PRIVATE_COPY[language];
  const body = jsonOf(req);
  const name = strOf(body, "name");
  if (name === null || foldForCompare(name.trim()) !== foldForCompare(String(producer.name))) {
    throw new HttpError(422, "name", copy.wrongName, { name: copy.wrongName });
  }
  if (page.signed_off_at !== null) {
    const when2 = `${wallTime(String(producer.town), Number(page.signed_off_at))} ${TOWN_TIME_PHRASE_TEXT[String(producer.town)][language]}`;
    throw new HttpError(409, "alreadySigned", copy.alreadySigned.replace("<when>", when2));
  }
  const newer = await db2.one(
    "select * from cuts where job_id = $1 and number > $2 order by number desc limit 1",
    [String(page.job_id), Number(page.cut)]
  );
  if (newer !== null) {
    const when2 = `${wallTime(String(producer.town), Number(newer.created_at))} ${TOWN_TIME_PHRASE_TEXT[String(producer.town)][language]}`;
    throw new HttpError(409, "newerCut", copy.newerCut.replace("<when>", when2));
  }
  const at = now();
  await db2.query("update sign_offs set signed_off_at = $1, signed_off_by = $2 where id = $3", [
    String(at),
    String(producer.name),
    String(page.id)
  ]);
  await db2.query("update cuts set signed_off_at = $1, signed_off_by = $2 where job_id = $3 and number = $4", [
    String(at),
    String(producer.name),
    String(page.job_id),
    Number(page.cut)
  ]);
  await db2.query("update jobs set state = 'signedOff' where id = $1", [String(page.job_id)]);
  await addHistory(db2, String(page.job_id), "signedOff", String(producer.name), `Cut ${Number(page.cut)} signed off by ${String(producer.name)}.`);
  const when = `${wallTime(String(producer.town), at)} ${TOWN_TIME_PHRASE_TEXT[String(producer.town)][language]}`;
  return jsonResponse(200, { signedOffAt: instantText(at), signedOffText: copy.signed.replace("<when>", when) });
});
route("GET", "/api/s/:token/frames/:number/drawing", async (req, store2, db2) => {
  const page = await db2.one("select * from sign_offs where token = $1", [req.params.token]);
  if (page === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const cutRow = await db2.one("select * from cuts where job_id = $1 and number = $2", [
    String(page.job_id),
    Number(page.cut)
  ]);
  const clips = await db2.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow.id)]);
  const found = clips.find((c) => numberOf(db2, c) === Number(req.params.number));
  if (found === void 0) throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  const job = await db2.one("select * from jobs where id = $1", [String(page.job_id)]);
  if (found.sha256 !== null) {
    const data = await store2.get(objectKey(String(job.client_id), String(job.id), `frames/${String(found.sha256)}`));
    if (data !== null) return bytesResponse(200, imageMimeOf(data), data);
  }
  if (Boolean(found.seeded)) {
    return textResponse(200, "image/svg+xml", seededDrawing(numberOf(db2, found), String(found.action_note)).toString("utf8"));
  }
  throw new HttpError(404, "noDrawing", "There is nothing at this address.");
});
route("GET", "/api/f/:token", async (req, _store, db2) => {
  const row = await db2.one("select * from letters where page_token = $1", [req.params.token]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const job = await jobRow(db2, String(row.job_id));
  const ended = String(row.state) !== "sent" || row.page_ends_at === null || Number(row.page_ends_at) <= now();
  if (ended) {
    throw new HttpError(410, "pageEnded", PRIVATE_COPY.en.ended);
  }
  const currency = String(row.currency);
  return jsonResponse(200, {
    jobTitle: String(job.title),
    currency,
    feeText: amountText(currency, BigInt(Number(row.fee_minor))),
    taxText: amountText(currency, BigInt(Number(row.tax_minor))),
    totalText: amountText(currency, BigInt(Number(row.total_minor))),
    milestones: milestonesOf(currency, BigInt(Number(row.fee_minor)), BigInt(Number(row.tax_minor))),
    state: String(row.state),
    stamp: String(row.stamp),
    endsAt: instantText(Number(row.page_ends_at)),
    pdfUrl: `/api/f/${req.params.token}/pdf`
  });
});
route("GET", "/api/f/:token/pdf", async (req, store2, db2) => {
  const row = await db2.one("select * from letters where page_token = $1", [req.params.token]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const job = await jobRow(db2, String(row.job_id));
  const data = await store2.get(objectKey(String(job.client_id), String(job.id), `letters/${String(row.id)}/fee-letter.pdf`));
  if (data === null) throw new HttpError(404, "noPdf", "There is nothing at this address.");
  return bytesResponse(200, "application/pdf", data);
});
route("POST", "/api/f/:token/accept", async (req, _store, db2) => {
  const row = await db2.one("select * from letters where page_token = $1", [req.params.token]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const ended = String(row.state) !== "sent" || row.page_ends_at === null || Number(row.page_ends_at) <= now();
  if (ended) throw new HttpError(410, "pageEnded", PRIVATE_COPY.en.ended);
  const body = jsonOf(req);
  const name = strOf(body, "name");
  const stamp = strOf(body, "stamp");
  const producer = await db2.one("select * from producers where id = $1", [String(row.producer_id)]);
  if (name === null || producer === null || foldForCompare(name.trim()) !== foldForCompare(String(producer.name))) {
    throw new HttpError(422, "name", "That name doesn't match. Type your full name as it was given.", { name: "That name doesn't match. Type your full name as it was given." });
  }
  if (stamp !== String(row.stamp)) {
    throw new HttpError(412, "stale", ARTIST_COPY.letterStale(wallTime("amsterdam", now()), "Amsterdam"), {
      stamp: "Read the letter again."
    });
  }
  await db2.query("update letters set state = 'accepted', accepted_at = $1, accepted_by = $2 where id = $3", [
    String(now()),
    producer === null ? "" : String(producer.name),
    String(row.id)
  ]);
  await addHistory(db2, String(row.job_id), "letterAccepted", producer === null ? "" : String(producer.name), `Letter accepted by ${producer === null ? "" : String(producer.name)}.`);
  return jsonResponse(200, { state: "accepted" });
});
async function tickReminders(config2, db2, at) {
  const due = await db2.many(
    "select r.*, p.email as email, p.language as language, j.title as title, j.due_date as due_date, c.state as client_state from reviews r join producers p on p.id = r.producer_id join jobs j on j.id = r.job_id join clients c on c.id = j.client_id where r.state = 'open' and r.reminded = 'f'",
    []
  );
  for (const row of due) {
    if (String(row.client_state) !== "active") continue;
    if (Number(row.ends_at) <= at) continue;
    const sentAt = Number(row.created_at);
    if (at < sentAt + config2.timers.reminderAfterSeconds) continue;
    const notes = await db2.one("select count(*) as n from notes where review_id = $1", [String(row.id)]);
    if (Number(notes.n) > 0) continue;
    await db2.query("update reviews set reminded = 't' where id = $1", [String(row.id)]);
    await queueReviewMail(config2, db2, {
      to: String(row.email),
      language: String(row.language),
      jobTitle: String(row.title),
      url: `${config2.appPublicUrl}/r/${String(row.token)}`,
      dueDate: String(row.due_date),
      reminder: true
    });
  }
}
__name(tickReminders, "tickReminders");
async function tickErasure(db2, store2, at) {
  const rows = await db2.many("select * from clients where state = 'erasing'", []);
  for (const client of rows) {
    const last = Number(client.erasure_tried_at ?? 0);
    if (at - last < 10) continue;
    await db2.query("update clients set erasure_tried_at = $1 where id = $2", [String(at), String(client.id)]);
    const jobs = await db2.many("select * from jobs where client_id = $1", [String(client.id)]);
    let allOk = true;
    for (const job of jobs) {
      const frames = await db2.many("select * from frames where job_id = $1", [String(job.id)]);
      for (const frame of frames) {
        if (frame.sha256 !== null) {
          const removed = await store2.remove(objectKey(String(client.id), String(job.id), `frames/${String(frame.sha256)}`));
          if (!removed.ok) allOk = false;
        }
      }
      const attachments = await db2.many("select * from attachments where job_id = $1", [String(job.id)]);
      for (const a of attachments) {
        const removed = await store2.remove(objectKey(String(client.id), String(job.id), `attachments/${String(a.id)}`));
        if (!removed.ok) allOk = false;
      }
      const renders = await db2.many("select * from renders where job_id = $1", [String(job.id)]);
      for (const r of renders) {
        const removed = await store2.remove(objectKey(String(client.id), String(job.id), `films/${String(r.id)}`));
        if (!removed.ok) allOk = false;
      }
      const packages = await db2.many("select * from packages where job_id = $1", [String(job.id)]);
      for (const p of packages) {
        for (const name of ["boards.pdf", "edit-decision-list.edl", "shot-list.csv"]) {
          const removed = await store2.remove(objectKey(String(client.id), String(job.id), `packages/${String(p.id)}/${name}`));
          if (!removed.ok) allOk = false;
        }
      }
      const letters = await db2.many("select * from letters where job_id = $1", [String(job.id)]);
      for (const l of letters) {
        const removed = await store2.remove(objectKey(String(client.id), String(job.id), `letters/${String(l.id)}/fee-letter.pdf`));
        if (!removed.ok) allOk = false;
      }
    }
    if (!allOk) continue;
    await db2.query("delete from notes where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from attachments where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from review_sends where review_id in (select id from reviews where job_id in (select id from jobs where client_id = $1))", [String(client.id)]);
    await db2.query("delete from review_names where review_id in (select id from reviews where job_id in (select id from jobs where client_id = $1))", [String(client.id)]);
    await db2.query("delete from reviews where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from sign_offs where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from package_files where package_id in (select id from packages where job_id in (select id from jobs where client_id = $1))", [String(client.id)]);
    await db2.query("delete from packages where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from letters where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from renders where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from cues where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from lines where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from job_history where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from board_stamps where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from cut_frames where cut_id in (select id from cuts where job_id in (select id from jobs where client_id = $1))", [String(client.id)]);
    await db2.query("delete from cuts where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from removals where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from frames where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db2.query("delete from jobs where client_id = $1", [String(client.id)]);
    await db2.query("delete from pending_mail where to_address in (select email from producers where client_id = $1)", [String(client.id)]);
    await db2.query("delete from producers where client_id = $1", [String(client.id)]);
    await db2.query("update clients set state = 'erased', erased_at = $1 where id = $2", [String(at), String(client.id)]);
  }
}
__name(tickErasure, "tickErasure");
async function tickClientWaits(db2, at) {
  await db2.query("update clients set state = 'erasing' where state = 'closing' and closes_at is not null and closes_at <= $1", [
    String(at)
  ]);
}
__name(tickClientWaits, "tickClientWaits");

// src/server/pages.ts
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
var root = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
function readClient(name) {
  try {
    return readFileSync(join(root, name));
  } catch {
    return null;
  }
}
__name(readClient, "readClient");
var HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clapstick</title>
<link rel="stylesheet" href="/clapstick.css">
<link rel="icon" href="data:,">
</head>
<body>
<div id="root"></div>
<script type="module" src="/clapstick.js"></script>
</body>
</html>`;
function CLIENT_INDEX(path) {
  if (path === "/clapstick.css") {
    const css = readClient("clapstick.css");
    if (css !== null) {
      return { status: 200, headers: { "content-type": "text/css; charset=utf-8" }, body: css };
    }
  }
  if (path === "/clapstick.js") {
    const js = readClient("index.js");
    if (js !== null) {
      return { status: 200, headers: { "content-type": "text/javascript; charset=utf-8" }, body: js };
    }
  }
  if (path.startsWith("/fonts/")) {
    const font = readClient(path.slice(1));
    if (font !== null) {
      return { status: 200, headers: { "content-type": "font/woff2" }, body: font };
    }
  }
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: HTML };
}
__name(CLIENT_INDEX, "CLIENT_INDEX");

// src/server/main.ts
var config = readConfig();
var db = new Db(config);
var store = new Store(config);
var PORT = config.appPublicPort;
var HOST = "0.0.0.0";
async function main() {
  try {
    await applySchema(db);
    await seed(config, db, store);
  } catch (e) {
    console.error("schema or seed failed", e);
  }
  const bucket = await store.ensureBucket();
  if (!bucket.ok) {
    console.error("file store not reachable at start; the app still starts");
  }
  const server = http.createServer(async (req, res) => {
    try {
      const response = await handle(req);
      respond(res, response);
    } catch (e) {
      if (e instanceof HttpError) {
        respond(res, {
          status: e.status,
          headers: { "content-type": "application/json; charset=utf-8", ...e.headers },
          body: errorBody(e.code, e.message, e.fields)
        });
        return;
      }
      console.error("internal error", e);
      respond(res, {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: errorBody("internalError", "Something went wrong on this desk.", null)
      });
    }
  });
  server.listen(PORT, HOST, () => {
    console.log(`clapstick serving on ${HOST}:${PORT}`);
  });
  setInterval(() => {
    void deliverMail(config, db).catch(() => void 0);
  }, 5e3);
  setInterval(() => {
    void tick(config, db, store).catch(() => void 0);
  }, 2e3);
}
__name(main, "main");
function respond(res, response) {
  const headers = { ...response.headers };
  const body = response.body;
  const length = body === null ? 0 : typeof body === "string" ? Buffer.byteLength(body) : body.length;
  headers["content-length"] = String(length);
  res.writeHead(response.status, headers);
  if (body === null || typeof body === "string") {
    res.end(body ?? void 0);
  } else {
    res.end(body);
  }
}
__name(respond, "respond");
async function handle(req) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";
  const path = url.pathname;
  const query = url.searchParams;
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k] = Array.isArray(v) ? v.join(",") : String(v);
  }
  if (!path.startsWith("/api/")) {
    if (method !== "GET" && method !== "HEAD") {
      return CLIENT_INDEX(path);
    }
    return CLIENT_INDEX(path);
  }
  const body = await readBody(req);
  const request = {
    method,
    path,
    query,
    headers,
    body,
    params: {},
    session: null,
    config
  };
  return await dispatch(request, store, db);
}
__name(handle, "handle");
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
__name(readBody, "readBody");
main().catch((e) => {
  console.error("failed to start", e);
  process.exit(1);
});
