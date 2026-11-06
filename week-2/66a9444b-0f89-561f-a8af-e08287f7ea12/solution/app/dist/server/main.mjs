// server/main.ts
import { createServer } from "node:http";

// server/auth.ts
import { createHmac as createHmac2, randomBytes as randomBytes2, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// server/config.ts
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
function seconds(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0 || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`);
  return value;
}
function senderAddress(from) {
  const open3 = from.indexOf("<");
  return open3 >= 0 ? from.slice(open3 + 1, from.indexOf(">", open3)).trim() : from.trim();
}
var mailFrom = required("MAIL_FROM");
var config = {
  port: Number(process.env.APP_PUBLIC_PORT || 4173),
  databaseUrl: required("DATABASE_URL"),
  appSecret: process.env.APP_SECRET || null,
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET")
  },
  mail: {
    smtpHost: required("SMTP_HOST"),
    smtpPort: Number(required("SMTP_PORT")),
    mailpitUrl: required("MAILPIT_URL").replace(/\/+$/, ""),
    from: mailFrom,
    fromAddress: senderAddress(mailFrom)
  },
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY")
  },
  time: {
    holdSeconds: seconds("HOLD_SECONDS", 600),
    waitlistClaimSeconds: seconds("WAITLIST_CLAIM_SECONDS", 7200),
    proofDecisionSeconds: seconds("PROOF_DECISION_SECONDS", 259200),
    billingDaySeconds: seconds("BILLING_DAY_SECONDS", 86400),
    signedReadSeconds: seconds("SIGNED_READ_SECONDS", 60)
  }
};

// server/db/pgwire.ts
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { connect } from "node:net";
var PgError = class extends Error {
  constructor(code2, message) {
    super(message);
    this.code = code2;
  }
  code;
};
var TYPE = { bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, json: 114, float4: 700, float8: 701, textArray: 1009, int4Array: 1007, timestamptz: 1184, timestamp: 1114, numeric: 1700, jsonb: 3802 };
function parseTextArray(raw) {
  const out = [];
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
function parseTimestamp(raw) {
  const iso = raw.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  return new Date(iso);
}
function decodeValue(typeOid, raw) {
  switch (typeOid) {
    case TYPE.bool:
      return raw === "t";
    case TYPE.int2:
    case TYPE.int4:
    case TYPE.int8:
    case TYPE.float4:
    case TYPE.float8:
      return Number(raw);
    case TYPE.json:
    case TYPE.jsonb:
      return JSON.parse(raw);
    case TYPE.timestamptz:
    case TYPE.timestamp:
      return parseTimestamp(raw);
    case TYPE.bytea:
      return Buffer.from(raw.slice(2), "hex");
    case TYPE.textArray:
      return parseTextArray(raw);
    case TYPE.int4Array:
      return parseTextArray(raw).map(Number);
    default:
      return raw;
  }
}
function encodeValue(value) {
  if (value === null) return null;
  if (Buffer.isBuffer(value)) return Buffer.from("\\x" + value.toString("hex"));
  if (value instanceof Date) return Buffer.from(value.toISOString());
  if (typeof value === "boolean") return Buffer.from(value ? "t" : "f");
  if (Array.isArray(value)) {
    const items = value.map((item) => '"' + item.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
    return Buffer.from("{" + items.join(",") + "}");
  }
  return Buffer.from(String(value));
}
var Writer = class {
  parts = [];
  int16(n) {
    const b = Buffer.alloc(2);
    b.writeInt16BE(n);
    this.parts.push(b);
    return this;
  }
  int32(n) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(n);
    this.parts.push(b);
    return this;
  }
  cstr(s) {
    this.parts.push(Buffer.from(s + "\0"));
    return this;
  }
  bytes(b) {
    this.parts.push(b);
    return this;
  }
  message(type) {
    const body = Buffer.concat(this.parts);
    const head = Buffer.alloc(type ? 5 : 4);
    if (type) {
      head.write(type, 0);
      head.writeInt32BE(body.length + 4, 1);
    } else head.writeInt32BE(body.length + 4, 0);
    return Buffer.concat([head, body]);
  }
};
function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}
var Connection = class {
  constructor(options2) {
    this.options = options2;
  }
  options;
  socket;
  buffer = Buffer.alloc(0);
  queue = [];
  chain = Promise.resolve();
  ready;
  failStartup;
  scramNonce = "";
  scramFirstBare = "";
  closed = false;
  open(timeoutMs) {
    return new Promise((resolve2, reject) => {
      this.ready = resolve2;
      this.failStartup = reject;
      const timer = setTimeout(() => {
        reject(new Error("Postgres connect timeout"));
        this.socket.destroy();
      }, timeoutMs);
      this.socket = connect({ host: this.options.host, port: this.options.port });
      this.socket.setNoDelay(true);
      this.socket.on("connect", () => {
        const w = new Writer().int32(196608).cstr("user").cstr(this.options.user).cstr("database").cstr(this.options.database).cstr("TimeZone").cstr("UTC").cstr("DateStyle").cstr("ISO, YMD").cstr("client_encoding").cstr("UTF8").bytes(Buffer.from([0]));
        this.socket.write(w.message(null));
      });
      this.socket.on("data", (chunk) => this.onData(chunk));
      this.socket.on("error", (error) => this.onClose(error));
      this.socket.on("close", () => this.onClose(new Error("Postgres connection closed")));
      const done = this.ready;
      this.ready = () => {
        clearTimeout(timer);
        done();
      };
      const fail = this.failStartup;
      this.failStartup = (error) => {
        clearTimeout(timer);
        fail(error);
      };
    });
  }
  onClose(error) {
    if (this.closed) return;
    this.closed = true;
    this.failStartup(error);
    for (const pending of this.queue.splice(0)) pending.reject(error);
  }
  close() {
    if (this.closed) return;
    this.socket.end(new Writer().message("X"));
    this.closed = true;
  }
  onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) return;
      const type = String.fromCharCode(this.buffer[0]);
      const body = this.buffer.subarray(5, length + 1);
      this.buffer = this.buffer.subarray(length + 1);
      this.handle(type, body);
    }
  }
  send(message) {
    this.socket.write(message);
  }
  handle(type, body) {
    const current = this.queue[0];
    switch (type) {
      case "R":
        return this.authenticate(body);
      case "S":
      case "K":
      case "N":
      case "1":
      case "2":
      case "n":
      case "s":
        return;
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
        const row = {};
        for (let i = 0; i < count; i++) {
          const length = body.readInt32BE(offset);
          offset += 4;
          const field = current.fields[i];
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
      case "I":
        return;
      case "E": {
        const fields = {};
        let offset = 0;
        while (offset < body.length && body[offset] !== 0) {
          const code2 = String.fromCharCode(body[offset]);
          const end = body.indexOf(0, offset + 1);
          fields[code2] = body.toString("utf8", offset + 1, end);
          offset = end + 1;
        }
        const error = new PgError(fields.C ?? "XX000", fields.M ?? "Postgres error");
        if (current) current.error = error;
        else this.failStartup(error);
        return;
      }
      default:
        return;
    }
  }
  authenticate(body) {
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
  enqueue(messages) {
    const run = () => new Promise((resolve2, reject) => {
      if (this.closed) return reject(new Error("Postgres connection closed"));
      this.queue.push({ fields: [], rows: [], rowCount: 0, error: null, resolve: resolve2, reject });
      this.send(messages);
    });
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => void 0);
    return result;
  }
  query(text2, params = []) {
    const bind = new Writer().cstr("").cstr("").int16(0).int16(params.length);
    for (const param of params) {
      const encoded = encodeValue(param);
      if (encoded === null) bind.int32(-1);
      else bind.int32(encoded.length).bytes(encoded);
    }
    bind.int16(0);
    const messages = Buffer.concat([
      new Writer().cstr("").cstr(text2).int16(0).message("P"),
      bind.message("B"),
      new Writer().bytes(Buffer.from("P")).cstr("").message("D"),
      new Writer().cstr("").int32(0).message("E"),
      new Writer().message("S")
    ]);
    return this.enqueue(messages);
  }
  simple(text2) {
    return this.enqueue(new Writer().cstr(text2).message("Q"));
  }
};
function parseDatabaseUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, ""))
  };
}

// server/db/index.ts
var options = parseDatabaseUrl(config.databaseUrl);
var MAX_CONNECTIONS = 24;
var idle = [];
var waiters = [];
var open = 0;
async function acquire() {
  while (idle.length) {
    const connection = idle.pop();
    if (!connection.closed) return connection;
    open--;
  }
  if (open < MAX_CONNECTIONS) {
    open++;
    const connection = new Connection(options);
    try {
      await connection.open(5e3);
      return connection;
    } catch (error) {
      open--;
      throw error;
    }
  }
  return new Promise((resolve2) => waiters.push(resolve2));
}
function release(connection) {
  if (connection.closed) {
    open--;
    const waiter2 = waiters.shift();
    if (waiter2) acquire().then(waiter2, () => waiters.unshift(waiter2));
    return;
  }
  const waiter = waiters.shift();
  if (waiter) waiter(connection);
  else idle.push(connection);
}
function wrap(run) {
  return {
    query: (text2, params = []) => run(text2, params),
    one: async (text2, params = []) => (await run(text2, params)).rows[0] ?? null,
    all: async (text2, params = []) => (await run(text2, params)).rows
  };
}
var db = wrap(async (text2, params) => {
  const connection = await acquire();
  try {
    return await connection.query(text2, params);
  } finally {
    release(connection);
  }
});
async function transaction(work) {
  const connection = await acquire();
  try {
    await connection.query("BEGIN");
    const result = await work(wrap((text2, params) => connection.query(text2, params)));
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    if (!connection.closed) await connection.query("ROLLBACK").catch(() => connection.close());
    throw error;
  } finally {
    release(connection);
  }
}
async function withConnection(work) {
  const connection = await acquire();
  try {
    return await work(wrap((text2, params) => connection.query(text2, params)));
  } finally {
    release(connection);
  }
}
async function runScriptLocked(lockName, sql) {
  const connection = await acquire();
  try {
    await connection.query("SELECT pg_advisory_lock(hashtext($1))", [lockName]);
    try {
      await connection.simple(sql);
    } finally {
      await connection.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
    }
  } finally {
    release(connection);
  }
}
async function databaseUp() {
  try {
    await db.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// server/auth.ts
var ROLES = ["visitor", "group_booker", "artist", "curator", "box_office", "finance", "admin"];
var COOKIE = "kerf_session";
var SESSION_DAYS = 30;
var scryptAsync = promisify(scrypt);
var secret = "";
async function loadAppSecret() {
  if (config.appSecret) {
    secret = config.appSecret;
    return;
  }
  await db.query("INSERT INTO settings (key, value) VALUES ('app_secret', $1) ON CONFLICT (key) DO NOTHING", [randomBytes2(32).toString("hex")]);
  secret = (await db.one("SELECT value FROM settings WHERE key = 'app_secret'")).value;
}
function sign(value) {
  return createHmac2("sha256", secret).update(value).digest("base64url");
}
function signatureMatches(value, signature) {
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
async function hashPassword(password) {
  const salt = randomBytes2(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
async function passwordMatches(password, stored) {
  const [, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash ?? "", "base64");
  const actual = await scryptAsync(password, Buffer.from(salt ?? "", "base64"), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function startLoginSession(userId) {
  const id = randomUUID();
  const now = Date.now();
  await db.query(
    "INSERT INTO login_sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    [id, userId, new Date(now), new Date(now + SESSION_DAYS * 864e5)]
  );
  return `${COOKIE}=${id}.${sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
}
function sessionId(cookieHeader) {
  const raw = cookieHeader?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  const [id, signature] = (raw?.slice(COOKIE.length + 1) ?? "").split(".");
  return id && signature && signatureMatches(id, signature) ? id : null;
}
async function endLoginSession(cookieHeader) {
  const id = sessionId(cookieHeader);
  if (id) await db.query("DELETE FROM login_sessions WHERE id = $1", [id]);
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
async function userFromCookie(cookieHeader) {
  const id = sessionId(cookieHeader);
  if (!id) return null;
  return db.one(
    `SELECT u.id, u.email, u.name, u.role, u.organisation_id FROM login_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND is_live(s.expires_at, $2)`,
    [id, /* @__PURE__ */ new Date()]
  );
}

// server/db/schema.ts
var SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS counters (name text PRIMARY KEY, value integer NOT NULL);

CREATE TABLE IF NOT EXISTS organisations (id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL,
  role text NOT NULL, organisation_id text REFERENCES organisations(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS login_sessions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS edition (id integer PRIMARY KEY CHECK (id = 1), name text NOT NULL, first_day date NOT NULL, last_day date NOT NULL);
CREATE TABLE IF NOT EXISTS venues (id text PRIMARY KEY, name text NOT NULL, position integer NOT NULL);
CREATE TABLE IF NOT EXISTS disciplines (id text PRIMARY KEY, name text NOT NULL, position integer NOT NULL);
CREATE TABLE IF NOT EXISTS price_policy (
  id integer PRIMARY KEY CHECK (id = 1), full_festival_full_cents integer NOT NULL, full_festival_reduced_cents integer NOT NULL,
  day_full_cents integer NOT NULL, day_reduced_cents integer NOT NULL, group_discount_percent integer NOT NULL, version integer NOT NULL);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, title text NOT NULL, description text NOT NULL, discipline text NOT NULL REFERENCES disciplines(id),
  venue_id text NOT NULL REFERENCES venues(id), admission text NOT NULL, capacity integer, price_full_cents integer,
  price_reduced_cents integer, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, status text NOT NULL,
  publish_at timestamptz, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS entries (
  id text PRIMARY KEY, artist_id text NOT NULL REFERENCES users(id), title text NOT NULL, statement text NOT NULL,
  discipline text NOT NULL REFERENCES disciplines(id), medium text NOT NULL, year integer NOT NULL, status text NOT NULL,
  publish_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS state_history (
  seq bigserial PRIMARY KEY, item_kind text NOT NULL, item_id text NOT NULL, from_state text NOT NULL, to_state text NOT NULL,
  at timestamptz NOT NULL, by text NOT NULL, note text);
CREATE INDEX IF NOT EXISTS state_history_item ON state_history (item_kind, item_id, seq);
CREATE TABLE IF NOT EXISTS entry_images (
  id text PRIMARY KEY, entry_id text NOT NULL REFERENCES entries(id), width integer NOT NULL, height integer NOT NULL,
  content_type text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), session_id text NOT NULL REFERENCES sessions(id),
  quantity integer NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS holds_session ON holds (session_id, status);
CREATE INDEX IF NOT EXISTS holds_user ON holds (user_id, status);
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id text PRIMARY KEY, seq bigserial, user_id text NOT NULL REFERENCES users(id), session_id text NOT NULL REFERENCES sessions(id),
  status text NOT NULL, joined_at timestamptz NOT NULL, offer_expires_at timestamptz);
CREATE INDEX IF NOT EXISTS waitlist_session ON waitlist_entries (session_id, status, seq);

CREATE TABLE IF NOT EXISTS vouchers (code text PRIMARY KEY, note text, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS voucher_movements (
  id text PRIMARY KEY, seq bigserial, voucher_code text NOT NULL REFERENCES vouchers(code), kind text NOT NULL,
  amount_cents integer NOT NULL, created_at timestamptz NOT NULL, actor text NOT NULL, order_ref text);
CREATE TABLE IF NOT EXISTS ledger_entries (
  seq bigserial PRIMARY KEY, movement_id text NOT NULL REFERENCES voucher_movements(id), account text NOT NULL,
  side text NOT NULL, amount_cents integer NOT NULL);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_entries (account);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY, ref text NOT NULL UNIQUE, buyer_id text NOT NULL REFERENCES users(id), organisation_id text REFERENCES organisations(id),
  rate text NOT NULL, voucher_code text, proof_deadline timestamptz, kb_payment_id text, confirmation_outbox_id bigint,
  created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS orders_buyer ON orders (buyer_id, created_at);
CREATE INDEX IF NOT EXISTS orders_org ON orders (organisation_id);
CREATE TABLE IF NOT EXISTS lines (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), position integer NOT NULL, kind text NOT NULL,
  session_id text REFERENCES sessions(id), festival_day date, title text NOT NULL, holder_name text NOT NULL, state text NOT NULL,
  list_cents integer NOT NULL, group_discount_cents integer NOT NULL, voucher_cents integer NOT NULL, charged_cents integer NOT NULL);
CREATE INDEX IF NOT EXISTS lines_order ON lines (order_id, position);
CREATE INDEX IF NOT EXISTS lines_session ON lines (session_id, state);
CREATE TABLE IF NOT EXISTS passes (
  code text PRIMARY KEY, line_id text NOT NULL REFERENCES lines(id), status text NOT NULL, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS passes_line ON passes (line_id, created_at);

CREATE TABLE IF NOT EXISTS proofs (
  id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES orders(id), kind text NOT NULL, status text NOT NULL,
  uploaded_at timestamptz NOT NULL, content_type text NOT NULL, size_bytes integer NOT NULL, decided_at timestamptz,
  decided_by text, reason text);

CREATE TABLE IF NOT EXISTS scans (
  seq bigserial PRIMARY KEY, pass_code text NOT NULL, session_id text NOT NULL, festival_day date NOT NULL, venue_id text NOT NULL,
  result text NOT NULL, reason text, scanned_at timestamptz NOT NULL, staff_id text NOT NULL);
CREATE INDEX IF NOT EXISTS scans_pass ON scans (pass_code, result);
CREATE INDEX IF NOT EXISTS scans_day ON scans (festival_day, result);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY, number text NOT NULL UNIQUE, organisation_id text NOT NULL REFERENCES organisations(id),
  order_id text NOT NULL REFERENCES orders(id), booker_id text NOT NULL REFERENCES users(id), status text NOT NULL,
  amount_cents integer NOT NULL, issued_at timestamptz NOT NULL, due_at timestamptz NOT NULL, retries_used integer NOT NULL DEFAULT 0,
  first_return_at timestamptz, next_retry_at timestamptz, retried_at timestamptz, kb_invoice_id text NOT NULL);
CREATE TABLE IF NOT EXISTS invoice_lines (
  invoice_id text NOT NULL REFERENCES invoices(id), line_id text NOT NULL REFERENCES lines(id), description text NOT NULL,
  amount_cents integer NOT NULL, kb_item_id text NOT NULL, PRIMARY KEY (invoice_id, line_id));
CREATE TABLE IF NOT EXISTS collections (
  invoice_id text NOT NULL REFERENCES invoices(id), attempt integer NOT NULL, kb_payment_id text NOT NULL,
  amount_cents integer NOT NULL, collected_at timestamptz NOT NULL, returned_at timestamptz, PRIMARY KEY (invoice_id, attempt));
CREATE TABLE IF NOT EXISTS refunds (
  id text PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), line_ids text[] NOT NULL, card_cents integer NOT NULL,
  voucher_cents integer NOT NULL, credit_note_id text, status text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL,
  completed_at timestamptz);
CREATE TABLE IF NOT EXISTS credit_notes (
  id text PRIMARY KEY, number text NOT NULL UNIQUE, invoice_id text NOT NULL REFERENCES invoices(id),
  amount_cents integer NOT NULL, issued_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS credit_note_lines (
  credit_note_id text NOT NULL REFERENCES credit_notes(id), line_id text NOT NULL REFERENCES lines(id), description text NOT NULL,
  amount_cents integer NOT NULL, adjusted boolean NOT NULL DEFAULT false, PRIMARY KEY (credit_note_id, line_id));

CREATE TABLE IF NOT EXISTS killbill_accounts (external_key text PRIMARY KEY, account_id text NOT NULL);
CREATE TABLE IF NOT EXISTS payment_records (
  kb_transaction_id text PRIMARY KEY, kb_payment_id text NOT NULL, transaction_type text NOT NULL, amount_cents integer NOT NULL,
  status text NOT NULL, order_ref text, invoice_number text, recorded_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS payment_tasks (
  id bigserial PRIMARY KEY, kind text NOT NULL, subject_id text NOT NULL, created_at timestamptz NOT NULL, done_at timestamptz,
  attempts integer NOT NULL DEFAULT 0, UNIQUE (kind, subject_id));

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id text PRIMARY KEY, started_at timestamptz NOT NULL, finished_at timestamptz NOT NULL, checked_transactions integer NOT NULL, actor text NOT NULL);
CREATE TABLE IF NOT EXISTS mismatches (
  id text PRIMARY KEY, run_id text NOT NULL REFERENCES reconciliation_runs(id), type text NOT NULL, identity text NOT NULL UNIQUE,
  order_ref text, killbill_transaction_id text, transaction_type text NOT NULL, app_amount_cents integer, killbill_amount_cents integer,
  status text NOT NULL, note text, resolved_by text, resolved_at timestamptz, found_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS run_mismatches (
  run_id text NOT NULL REFERENCES reconciliation_runs(id), mismatch_id text NOT NULL REFERENCES mismatches(id), PRIMARY KEY (run_id, mismatch_id));

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY, to_address text NOT NULL, subject text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL,
  sent_at timestamptz, attempts integer NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS outbox_attachments (
  outbox_id bigint NOT NULL REFERENCES outbox(id), position integer NOT NULL, filename text NOT NULL, content bytea NOT NULL,
  PRIMARY KEY (outbox_id, position));

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status integer NOT NULL, body jsonb NOT NULL,
  created_at timestamptz NOT NULL, PRIMARY KEY (scope, key));

CREATE TABLE IF NOT EXISTS audit (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL, actor text NOT NULL, actor_role text NOT NULL, action text NOT NULL,
  target_type text NOT NULL, target_id text NOT NULL, detail jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS audit_target ON audit (target_id, at);

-- A time-limited item is live while server time is strictly before its expiry instant.
CREATE OR REPLACE FUNCTION is_live(expires_at timestamptz, at timestamptz) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT at < expires_at $$;

-- A scheduled item counts as published from its publishing instant on.
CREATE OR REPLACE FUNCTION effective_status(status text, publish_at timestamptz, at timestamptz) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN status = 'scheduled' AND publish_at <= at THEN 'published' ELSE status END $$;

-- Capacity minus active holds, open waitlist offers and seats on pending, sold or transferred lines.
CREATE OR REPLACE FUNCTION seats_remaining(sid text, at timestamptz) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN s.capacity IS NULL THEN NULL ELSE GREATEST(0, s.capacity
    - COALESCE((SELECT sum(h.quantity) FROM holds h WHERE h.session_id = sid AND h.status = 'active' AND is_live(h.expires_at, at)), 0)
    - (SELECT count(*) FROM waitlist_entries w WHERE w.session_id = sid AND w.status = 'offered' AND is_live(w.offer_expires_at, at))
    - (SELECT count(*) FROM lines l WHERE l.session_id = sid AND l.state IN ('proof_pending', 'captured', 'transferred')))::integer END
  FROM sessions s WHERE s.id = sid
$$;
`;

// server/http.ts
import { createReadStream, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// server/domain/idempotency.ts
import { createHash as createHash2 } from "node:crypto";
var KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
var KEEP_MS = 24 * 36e5;
function canonicalJson(value) {
  return JSON.stringify(value ?? null, (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v);
}
function fingerprint(ctx, raw) {
  const body = ctx.body === void 0 ? raw : canonicalJson(ctx.body);
  return createHash2("sha256").update(`${ctx.method}
${ctx.path}
${body}`).digest("hex");
}
async function withIdempotency(ctx, raw, run) {
  const key = ctx.headers["idempotency-key"];
  if (typeof key !== "string" || !KEY_RE.test(key)) return errorReply(new FieldErrors({ idempotency_key: "required" }));
  const scope2 = ctx.user.id;
  const print = fingerprint(ctx, raw);
  return withConnection(async (conn) => {
    await conn.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`${scope2}
${key}`]);
    try {
      const stored = await conn.one(
        "SELECT fingerprint, status, body FROM idempotency_keys WHERE scope = $1 AND key = $2 AND created_at > $3",
        [scope2, key, new Date(Date.now() - KEEP_MS)]
      );
      if (stored) {
        if (stored.fingerprint !== print) return errorReply(new ApiError(409, "idempotency_key_reused"));
        return { status: stored.status, body: stored.body, headers: { "Idempotent-Replay": "true" } };
      }
      const reply = await run();
      if (reply.status < 500) {
        await conn.query(
          `INSERT INTO idempotency_keys (scope, key, fingerprint, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (scope, key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, status = EXCLUDED.status,
             body = EXCLUDED.body, created_at = EXCLUDED.created_at`,
          [scope2, key, print, reply.status, JSON.stringify(reply.body ?? null), /* @__PURE__ */ new Date()]
        );
      }
      return reply;
    } finally {
      await conn.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`${scope2}
${key}`]);
    }
  });
}
async function forgetOldKeys() {
  await db.query("DELETE FROM idempotency_keys WHERE created_at <= $1", [new Date(Date.now() - KEEP_MS)]);
}

// server/services/serviceDown.ts
var ServiceDown = class extends Error {
  constructor(service, cause) {
    super(`${service} unavailable${cause instanceof Error ? `: ${cause.message}` : ""}`, { cause });
    this.service = service;
  }
  service;
};

// server/http.ts
var ApiError = class extends Error {
  constructor(status, code2, extra = {}) {
    super(code2);
    this.status = status;
    this.code = code2;
    this.extra = extra;
  }
  status;
  code;
  extra;
};
var FieldErrors = class extends Error {
  constructor(errors) {
    super("validation");
    this.errors = errors;
  }
  errors;
};
var notFound = () => new ApiError(404, "not_found");
var origin = "";
var appOrigin = () => origin;
var JSON_LIMIT = 1e5;
var MULTIPART_ENVELOPE = 64 * 1024;
var routes = [];
function route(method, path, access, handle, options2 = {}) {
  const keys = [];
  const pattern = new RegExp("^" + path.replace(/:([a-zA-Z]+)/g, (_, key) => {
    keys.push(key);
    return "([^/]+)";
  }) + "$");
  routes.push({
    method,
    pattern,
    keys,
    access,
    multipartLimit: options2.multipartLimit ?? null,
    idempotent: options2.idempotent ?? false,
    handle
  });
}
var ok = (body, status = 200) => ({ status, body });
function writeJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": payload.length, ...headers });
  res.end(payload);
}
function errorReply(error) {
  if (error instanceof ApiError) return { status: error.status, body: { error: error.code, ...error.extra } };
  if (error instanceof FieldErrors) return { status: 422, body: { errors: error.errors } };
  if (error instanceof ServiceDown) {
    return { status: 503, body: { error: error.service === "killbill" ? "payment_unavailable" : "storage_unavailable" } };
  }
  console.error(error);
  return { status: 500, body: { error: "internal_error" } };
}
function sendReply(res, reply) {
  if (reply.bytes) {
    res.writeHead(reply.status, { "Content-Type": reply.contentType ?? "application/octet-stream", "Content-Length": reply.bytes.length, ...reply.headers });
    res.end(reply.bytes);
  } else if (reply.body === void 0) {
    res.writeHead(reply.status, reply.headers ?? {});
    res.end();
  } else writeJson(res, reply.status, reply.body, reply.headers);
}
async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) {
    req.resume();
    return null;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function parseMultipart(raw, boundary, fileLimit) {
  const delimiter = Buffer.from(`--${boundary}`);
  const upload = { fields: {}, file: null };
  let start = raw.indexOf(delimiter);
  while (start >= 0) {
    const next = raw.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    const part = raw.subarray(start + delimiter.length + 2, next - 2);
    start = next;
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const head = part.subarray(0, headerEnd).toString("utf8");
    const data = part.subarray(headerEnd + 4);
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    if (filename !== void 0) {
      if (data.length > fileLimit) return "too_large";
      upload.file = { filename, data: Buffer.from(data) };
    } else if (name) upload.fields[name] = data.toString("utf8");
  }
  return upload;
}
var STATE_CHANGING = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
function pathParam(raw) {
  let value;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return raw;
  }
  return value.replaceAll("\0", "\uFFFD");
}
function crossOrigin(req) {
  const origin2 = req.headers.origin;
  if (!origin2 || !STATE_CHANGING.has(req.method ?? "")) return false;
  try {
    return new URL(origin2).host !== req.headers.host;
  } catch {
    return true;
  }
}
async function handleApi(req, res, url) {
  const method = req.method === "HEAD" ? "GET" : req.method ?? "GET";
  let params = {};
  const found = routes.find((candidate) => {
    if (candidate.method !== method) return false;
    const m = candidate.pattern.exec(url.pathname);
    if (!m) return false;
    params = Object.fromEntries(candidate.keys.map((key, i) => [key, pathParam(m[i + 1])]));
    return true;
  });
  if (!found) {
    req.resume();
    return sendReply(res, errorReply(notFound()));
  }
  const limit = found.multipartLimit === null ? JSON_LIMIT : found.multipartLimit + MULTIPART_ENVELOPE;
  const raw = await readBody(req, limit);
  if (raw === null) return sendReply(res, errorReply(new ApiError(413, "payload_too_large")));
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  let body = void 0;
  let upload = { fields: {}, file: null };
  if (found.multipartLimit !== null) {
    const boundary = /^multipart\/form-data;.*boundary="?([^";]+)"?/i.exec(req.headers["content-type"] ?? "")?.[1];
    if (!boundary) return sendReply(res, errorReply(new ApiError(415, "unsupported_media_type")));
    const parsed = parseMultipart(raw, boundary, found.multipartLimit);
    if (parsed === "too_large") return sendReply(res, errorReply(new ApiError(413, "payload_too_large")));
    upload = parsed;
  } else if (raw.length > 0 || contentType && STATE_CHANGING.has(method)) {
    if (!/^application\/json\s*(;|$)/.test(contentType)) return sendReply(res, errorReply(new ApiError(415, "unsupported_media_type")));
  }
  if (crossOrigin(req)) return sendReply(res, errorReply(new ApiError(403, "cross_origin")));
  const user = await userFromCookie(req.headers.cookie);
  if (found.access !== "public") {
    if (!user) return sendReply(res, errorReply(new ApiError(401, "unauthenticated")));
    if (found.access !== "signed-in" && !found.access.includes(user.role)) {
      return sendReply(res, errorReply(new ApiError(403, "forbidden")));
    }
  }
  let invalidJson = false;
  if (raw.length > 0 && found.multipartLimit === null) {
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      invalidJson = true;
    }
  }
  if (!origin && req.headers.host) origin = `http://${req.headers.host}`;
  const ctx = {
    method,
    path: url.pathname,
    params,
    query: url.searchParams,
    headers: req.headers,
    user,
    body,
    upload
  };
  const run = async () => {
    if (invalidJson) return errorReply(new FieldErrors({ body: "invalid_json" }));
    try {
      return await found.handle(ctx);
    } catch (error) {
      return errorReply(error);
    }
  };
  const reply = found.idempotent ? await withIdempotency(ctx, raw.toString("utf8"), run) : await run();
  sendReply(res, reply);
}
var CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../client");
var PAGE_ROUTES = /^\/(signin|register|tickets|orders\/[^/]+|studio|curate|box-office|finance|group|admin)?\/?$/;
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};
var SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY"
};
function serveFile(res, file, cacheForever, head) {
  const size = statSync(file).size;
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": cacheForever ? "public, max-age=31536000, immutable" : "no-cache",
    ...SECURITY_HEADERS
  });
  if (head) res.end();
  else createReadStream(file).pipe(res);
}
function handleStatic(req, res, url) {
  const head = req.method === "HEAD";
  if (req.method !== "GET" && !head) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return void res.end("Not found");
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(CLIENT_DIR, relative);
  const isAsset = file.startsWith(CLIENT_DIR + "/") && !file.endsWith(".map") && !relative.endsWith("index.html");
  if (isAsset) {
    try {
      if (statSync(file).isFile()) return serveFile(res, file, relative.startsWith("/assets/"), head);
    } catch {
    }
  }
  if (PAGE_ROUTES.test(url.pathname)) return serveFile(res, join(CLIENT_DIR, "index.html"), false, head);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
  res.end("Not found");
}
async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else handleStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendReply(res, errorReply(error));
    else res.end();
  }
}

// shared/brussels.ts
var TIME_ZONE = "Europe/Brussels";
var DAY_START_HOUR = 5;
var OFFSETS_SUMMER_FIRST = [120, 60];
var partsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});
function wallParts(instant2) {
  const get = {};
  for (const part of partsFormat.formatToParts(new Date(instant2))) {
    if (part.type !== "literal") get[part.type] = Number(part.value);
  }
  return { year: get.year, month: get.month, day: get.day, hour: get.hour, minute: get.minute, second: get.second };
}
function wallAsUtc(p) {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}
function offsetMinutesAt(instant2) {
  return Math.round((wallAsUtc(wallParts(instant2)) - Math.floor(instant2 / 1e3) * 1e3) / 6e4);
}
function occurrences(p) {
  const base = wallAsUtc(p);
  return OFFSETS_SUMMER_FIRST.map((offset) => ({ instant: base - offset * 6e4, offset })).filter((candidate) => offsetMinutesAt(candidate.instant) === candidate.offset);
}
var WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?([+-]\d{2}:\d{2})?$/;
function parseWall(text2) {
  if (typeof text2 !== "string") return { ok: false, error: "invalid" };
  const m = WALL_RE.exec(text2.trim());
  if (!m) return { ok: false, error: "invalid" };
  const p = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5], second: +(m[6] ?? 0) };
  const check2 = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
  if (check2.getUTCMonth() !== p.month - 1 || check2.getUTCDate() !== p.day || p.hour > 23 || p.minute > 59 || p.second > 59) {
    return { ok: false, error: "invalid" };
  }
  const found = occurrences(p);
  if (!found.length) return { ok: false, error: "nonexistent_local_time" };
  if (m[7]) {
    const sign2 = m[7][0] === "-" ? -1 : 1;
    const offset = sign2 * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(4, 6)));
    const match = found.find((candidate) => candidate.offset === offset);
    return match ? { ok: true, instant: match.instant } : { ok: false, error: "offset_mismatch" };
  }
  return { ok: true, instant: found[0].instant };
}
var pad = (n, width = 2) => String(n).padStart(width, "0");
function offsetText(minutes) {
  const sign2 = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign2}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
function localIso(instant2) {
  const p = wallParts(instant2);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offsetText(offsetMinutesAt(instant2))}`;
}
function dateKey(p) {
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return dateKey({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}
function festivalDayOf(instant2) {
  const p = wallParts(instant2);
  const date = dateKey(p);
  return p.hour < DAY_START_HOUR ? addDays(date, -1) : date;
}
function festivalDayBounds(date) {
  const at = (d) => {
    const [year, month, day] = d.split("-").map(Number);
    return occurrences({ year, month, day, hour: DAY_START_HOUR, minute: 0, second: 0 })[0].instant;
  };
  return { startsAt: at(date), endsAt: at(addDays(date, 1)) };
}
function datesBetween(first, last) {
  const out = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(date) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[t.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}
function inRepeatedHour(instant2) {
  return occurrences(wallParts(instant2)).length === 2;
}
function clockTime(instant2) {
  const p = wallParts(instant2);
  const text2 = `${pad(p.hour)}:${pad(p.minute)}`;
  if (!inRepeatedHour(instant2)) return text2;
  return `${text2} ${offsetMinutesAt(instant2) === 120 ? "CEST" : "CET"}`;
}
function deadlineText(instant2) {
  return `${dayLabel(dateKey(wallParts(instant2)))}, ${clockTime(instant2)}`;
}
function dateText(instant2) {
  const p = wallParts(instant2);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}
function sessionTimeText(startsAt, endsAt) {
  return `${dayLabel(dateKey(wallParts(startsAt)))} \xB7 ${clockTime(startsAt)}\u2013${clockTime(endsAt)}`;
}

// server/domain/time.ts
function isoUtc(at) {
  return new Date(at).toISOString().replace(".000Z", "Z");
}
var isoOrNull = (at) => at === null ? null : isoUtc(at);

// server/domain/audit.ts
async function audit(q, actor, action, target2, detail = {}, at = /* @__PURE__ */ new Date()) {
  await q.query(
    "INSERT INTO audit (at, actor, actor_role, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [at, actor === "system" ? "system" : actor.email, actor === "system" ? "system" : actor.role, action, target2.type, target2.id, JSON.stringify(detail)]
  );
}
route("GET", "/api/admin/audit", ["admin", "finance"], async (ctx) => {
  const limit = Math.min(Math.max(Number(ctx.query.get("limit") ?? 100) || 100, 1), 1e3);
  const target2 = ctx.query.get("target_id");
  const rows = await db.all(
    `SELECT id, at, actor, actor_role, action, target_type, target_id, detail FROM audit
     WHERE ($1::text IS NULL OR target_id = $1) ORDER BY at DESC, id DESC LIMIT $2`,
    [target2, limit]
  );
  return ok({ entries: rows.map((r) => ({ ...r, id: String(r.id), at: isoUtc(r.at) })) });
});

// server/domain/ids.ts
import { randomInt, randomUUID as randomUUID2 } from "node:crypto";
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789";
function code(length) {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
var newId = () => randomUUID2();
var newOrderRef = () => `KF-${code(6)}`;
var newPassCode = () => `KFP-${code(10)}`;
var newVoucherCode = () => `KERF-${code(8)}`;

// server/domain/validate.ts
function asObject(body) {
  if (body === void 0 || body === null) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw new FieldErrors({ body: "invalid" });
  return body;
}
function text(value, min, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}
function intOrNull(value) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function email(value) {
  const t = text(value, 3, 254);
  return t && EMAIL_RE.test(t) ? t.toLowerCase() : null;
}
function check(errors) {
  if (Object.keys(errors).length) throw new FieldErrors(errors);
}

// server/domain/vouchers.ts
var voucherAccount = (code2) => `voucher:${code2}`;
var orderAccount = (ref) => `order:${ref}`;
function sides(kind, code2, ref) {
  if (kind === "issue") return { debit: "voucher-sales", credit: voucherAccount(code2) };
  if (kind === "redeem") return { debit: voucherAccount(code2), credit: orderAccount(ref) };
  return { debit: orderAccount(ref), credit: voucherAccount(code2) };
}
async function recordMovement(q, kind, code2, cents, actor, ref) {
  const id = newId();
  const { debit, credit } = sides(kind, code2, ref);
  await q.query(
    "INSERT INTO voucher_movements (id, voucher_code, kind, amount_cents, created_at, actor, order_ref) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, code2, kind, cents, /* @__PURE__ */ new Date(), actor, ref]
  );
  await q.query(
    "INSERT INTO ledger_entries (movement_id, account, side, amount_cents) VALUES ($1, $2, 'debit', $4), ($1, $3, 'credit', $4)",
    [id, debit, credit, cents]
  );
}
async function accountBalance(q, account) {
  return (await q.one(
    "SELECT COALESCE(sum(CASE WHEN side = 'credit' THEN amount_cents ELSE -amount_cents END), 0)::integer AS n FROM ledger_entries WHERE account = $1",
    [account]
  )).n;
}
async function lockVoucher(q, code2) {
  const row = await q.one("SELECT code FROM vouchers WHERE code = $1 FOR UPDATE", [code2]);
  return row ? { code: row.code, balance: await accountBalance(q, voucherAccount(row.code)) } : null;
}
async function issueVoucher(q, code2, cents, note, actor) {
  await q.query("INSERT INTO vouchers (code, note, created_at) VALUES ($1, $2, $3)", [code2, note, /* @__PURE__ */ new Date()]);
  await recordMovement(q, "issue", code2, cents, actor, null);
}
route("GET", "/api/vouchers/:code", "signed-in", async (ctx) => {
  const code2 = ctx.params.code.trim().toUpperCase();
  const row = await db.one("SELECT code FROM vouchers WHERE code = $1", [code2]);
  if (!row) throw notFound();
  return ok({ code: code2, balance_cents: await accountBalance(db, voucherAccount(code2)) });
});
route("POST", "/api/finance/vouchers", ["finance"], async (ctx) => {
  const body = asObject(ctx.body);
  const cents = intOrNull(body.amount_cents);
  if (cents === null || cents < 1 || cents > 1e5) throw new FieldErrors({ amount_cents: "out_of_range" });
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
  const code2 = newVoucherCode();
  await transaction(async (tx) => {
    await issueVoucher(tx, code2, cents, note, ctx.user.email);
    await audit(tx, ctx.user, "voucher.issued", { type: "voucher", id: code2 }, { amount_cents: cents, note });
  });
  return ok({ code: code2, balance_cents: cents }, 201);
});
route("GET", "/api/finance/ledger", ["finance"], async (ctx) => {
  const account = ctx.query.get("account") ?? "";
  const movements = await db.all(
    `SELECT DISTINCT m.id, m.seq, m.kind, m.amount_cents, m.created_at, m.actor, m.order_ref FROM voucher_movements m
     JOIN ledger_entries e ON e.movement_id = m.id WHERE e.account = $1 ORDER BY m.seq`,
    [account]
  );
  if (!movements.length) throw new FieldErrors({ account: "unknown" });
  const entries = await db.all(
    "SELECT movement_id, account, side, amount_cents FROM ledger_entries WHERE movement_id = ANY($1) ORDER BY seq",
    [movements.map((m) => m.id)]
  );
  return ok({
    account,
    balance_cents: await accountBalance(db, account),
    movements: movements.map((m) => ({
      id: m.id,
      kind: m.kind,
      amount_cents: m.amount_cents,
      created_at: isoUtc(m.created_at),
      actor: m.actor,
      order_ref: m.order_ref,
      entries: entries.filter((e) => e.movement_id === m.id).map((e) => ({ account: e.account, side: e.side, amount_cents: e.amount_cents }))
    }))
  });
});

// server/seed.ts
var SEED_PASSWORD = "kerf-festival-2027";
var VENUES = [
  ["remise-noord", "Remise Noord (disused tram depot)"],
  ["planetarium-dome", "Planetarium Dome"],
  ["lab-hoogstraat", "Lab Hoogstraat (university lab)"],
  ["black-box-kanaal", "Black Box Kanaal"],
  ["riverside-pavilion", "Riverside Pavilion"]
];
var DISCIPLINES = [["sound", "Sound"], ["light", "Light"], ["performance", "Performance"], ["moving-image", "Moving image"], ["code", "Code"]];
var ORGANISATIONS = [["vierwinden", "Atheneum Vierwinden", "school"], ["quai-lumiere", "\xC9cole Quai-Lumi\xE8re", "school"]];
var ACCOUNTS = [
  ["admin@kerf.example", "Ines Vandeput", "admin", null],
  ["curator@kerf.example", "Bram Okafor", "curator", null],
  ["curator2@kerf.example", "Lotte Riss", "curator", null],
  ["boxoffice@kerf.example", "Sami Haddad", "box_office", null],
  ["finance@kerf.example", "Elif Marchal", "finance", null],
  ["artist@kerf.example", "Yara Delcour", "artist", null],
  ["artist2@kerf.example", "Tom Achterberg", "artist", null],
  ["mira@visitors.example", "Mira Janssens", "visitor", null],
  ["jonas@visitors.example", "Jonas Peeters", "visitor", null],
  ["bookings@vierwinden.example", "Hanne De Wit", "group_booker", "vierwinden"],
  ["bookings@quai-lumiere.example", "Karim Lambrecht", "group_booker", "quai-lumiere"]
];
var SESSIONS = [
  [
    "feedback-gardens",
    "Feedback Gardens",
    "sound",
    "lab-hoogstraat",
    "seat",
    12,
    1800,
    1e3,
    "2027-10-29T14:00+02:00",
    "2027-10-29T16:30+02:00",
    "published",
    "A twelve-seat workshop growing self-oscillating circuits into a slow garden of tones."
  ],
  [
    "shader-sketching",
    "Shader Sketching",
    "code",
    "lab-hoogstraat",
    "seat",
    12,
    1800,
    1e3,
    "2027-10-30T11:00+02:00",
    "2027-10-30T13:00+02:00",
    "published",
    "Write fragment shaders by hand and project them onto the lab's long wall."
  ],
  [
    "signal-bodies",
    "Signal Bodies",
    "performance",
    "black-box-kanaal",
    "seat",
    60,
    1200,
    700,
    "2027-10-29T20:00+02:00",
    "2027-10-29T21:00+02:00",
    "published",
    "Dancers wired to radio receivers move through a field of shortwave static."
  ],
  [
    "delta-choir",
    "Delta Choir",
    "sound",
    "riverside-pavilion",
    "pass",
    null,
    null,
    null,
    "2027-10-29T20:30+02:00",
    "2027-10-29T21:30+02:00",
    "published",
    "Forty voices tuned to the tide tables of the river, sung on the pavilion steps."
  ],
  [
    "orbit-index",
    "Orbit Index",
    "moving-image",
    "planetarium-dome",
    "pass",
    null,
    null,
    null,
    "2027-10-28T21:00+02:00",
    "2027-10-28T21:45+02:00",
    "published",
    "A dome-filling film catalogue of every satellite launched in a single year."
  ],
  [
    "lumen-drift",
    "Lumen Drift",
    "light",
    "remise-noord",
    "pass",
    null,
    null,
    null,
    "2027-10-28T18:00+02:00",
    "2027-10-28T23:00+02:00",
    "published",
    "Slow beams sweep the old tram depot, tracing the routes that once ran through it."
  ],
  [
    "nachtstroom",
    "Nachtstroom",
    "sound",
    "remise-noord",
    "pass",
    null,
    null,
    null,
    "2027-10-31T01:30+02:00",
    "2027-10-31T02:30+02:00",
    "published",
    "A night current of modular synthesis that plays through the change of the clocks."
  ],
  [
    "second-hour-summer",
    "The Second Hour (first pass)",
    "light",
    "riverside-pavilion",
    "pass",
    null,
    null,
    null,
    "2027-10-31T02:15+02:00",
    "2027-10-31T02:45+02:00",
    "published",
    "A light piece staged inside the hour that happens twice: first, in summer time."
  ],
  [
    "second-hour-winter",
    "The Second Hour (second pass)",
    "light",
    "black-box-kanaal",
    "pass",
    null,
    null,
    null,
    "2027-10-31T02:15+01:00",
    "2027-10-31T02:45+01:00",
    "published",
    "The same wall-clock minutes, an hour later in winter time."
  ],
  [
    "dawn-patch",
    "Dawn Patch",
    "code",
    "riverside-pavilion",
    "pass",
    null,
    null,
    null,
    "2027-10-31T06:00+01:00",
    "2027-10-31T07:00+01:00",
    "published",
    "Live coders patch a morning chorus together as the river light comes up."
  ],
  [
    "residency-showing",
    "Untitled residency showing",
    "performance",
    "black-box-kanaal",
    "pass",
    null,
    null,
    null,
    "2027-10-30T16:00+02:00",
    "2027-10-30T17:00+02:00",
    "draft",
    "Work in progress from this year's residency."
  ]
];
var ENTRIES = [
  ["e-tidal-mesh", "Tidal Mesh", "artist@kerf.example", "light", "published", "A net of fibre-optic threads that brightens with the river's tide.", "Fibre optics, tide data", 2026],
  ["e-quiet-servo", "Quiet Servo", "artist2@kerf.example", "code", "published", "A field of tiny motors that only move when the room falls silent.", "Servos, microcontrollers", 2025],
  ["e-rust-chorus", "Rust Chorus", "artist@kerf.example", "sound", "published", "Contact microphones on weathered steel sing the slow chemistry of rust.", "Steel, contact microphones", 2026],
  ["e-slow-orbit", "Slow Orbit", "artist2@kerf.example", "moving-image", "published", "A single camera orbit of a kitchen table, stretched over one hour.", "Single-channel video", 2024],
  ["e-wet-signal", "Wet Signal", "artist@kerf.example", "performance", "published", "Performers pass a radio signal hand to hand through a shallow pool.", "Performance, water, radio", 2027],
  ["e-salt-print", "Salt Print", "artist@kerf.example", "light", "review", "Sunlight exposures on salted paper, fixed with seawater.", "Salt print", 2026],
  ["e-ghost-loop", "Ghost Loop", "artist2@kerf.example", "code", "draft", "A feedback loop between two old monitors and a webcam.", "CRT monitors, webcam", 2027]
];
var instant = (wall) => {
  const parsed = parseWall(wall);
  if (!parsed.ok) throw new Error(`bad seed time ${wall}`);
  return new Date(parsed.instant);
};
async function seed() {
  const missing = [];
  for (const [email2] of ACCOUNTS) if (!await db.one("SELECT 1 FROM users WHERE email = $1", [email2])) missing.push(email2);
  const hashes = /* @__PURE__ */ new Map();
  for (const email2 of missing) hashes.set(email2, await hashPassword(SEED_PASSWORD));
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('kerf-seed'))");
    await tx.query("INSERT INTO edition (id, name, first_day, last_day) VALUES (1, 'Kerf Frequencies 2027', '2027-10-28', '2027-10-31') ON CONFLICT DO NOTHING");
    for (const [i, [id, name]] of VENUES.entries()) await tx.query("INSERT INTO venues (id, name, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, name, i + 1]);
    for (const [i, [id, name]] of DISCIPLINES.entries()) await tx.query("INSERT INTO disciplines (id, name, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, name, i + 1]);
    await tx.query(`INSERT INTO price_policy (id, full_festival_full_cents, full_festival_reduced_cents, day_full_cents, day_reduced_cents, group_discount_percent, version)
      VALUES (1, 9500, 5500, 3500, 2000, 15, 1) ON CONFLICT DO NOTHING`);
    for (const [id, name, kind] of ORGANISATIONS) await tx.query("INSERT INTO organisations (id, name, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [id, name, kind]);
    for (const [email2, name, role, organisation] of ACCOUNTS) {
      const hash = hashes.get(email2);
      if (hash) {
        await tx.query(
          "INSERT INTO users (id, email, name, password_hash, role, organisation_id) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
          [email2, name, hash, role, organisation]
        );
      }
    }
    for (const [id, title, discipline, venue, admission, capacity, full, reduced, starts, ends, status, description] of SESSIONS) {
      await tx.query(
        `INSERT INTO sessions (id, title, description, discipline, venue_id, admission, capacity, price_full_cents, price_reduced_cents,
        starts_at, ends_at, status, version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1) ON CONFLICT DO NOTHING`,
        [id, title, description, discipline, venue, admission, capacity, full, reduced, instant(starts), instant(ends), status]
      );
    }
    for (const [id, title, artist, discipline, status, statement, medium, year] of ENTRIES) {
      await tx.query(
        `INSERT INTO entries (id, artist_id, title, statement, discipline, medium, year, status)
        SELECT $1, u.id, $2, $3, $4, $5, $6, $7 FROM users u WHERE u.email = $8 ON CONFLICT DO NOTHING`,
        [id, title, statement, discipline, medium, year, status, artist]
      );
    }
    for (const [code2, cents] of [["KERF-GIFT-A1", 4e3], ["KERF-GIFT-B2", 2500]]) {
      if (!await tx.one("SELECT 1 FROM vouchers WHERE code = $1", [code2])) await issueVoucher(tx, code2, cents, "Seeded gift voucher", "finance@kerf.example");
    }
  });
}

// server/services/killbill.ts
var TIMEOUT_MS = 1e4;
var CREATED_BY = "kerf-frequencies";
var EXTERNAL_PLUGIN = "__EXTERNAL_PAYMENT__";
var INVOICE_CONTROL_PLUGIN = "__INVOICE_PAYMENT_CONTROL_PLUGIN__";
var AUTO_PAY_OFF_TAG = "00000000-0000-0000-0000-000000000001";
var WRITTEN_OFF_TAG = "00000000-0000-0000-0000-000000000004";
async function call(method, path, body, accept404 = false) {
  let response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: "Basic " + Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64"),
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": CREATED_BY,
        Accept: "application/json",
        ...body === void 0 ? {} : { "Content-Type": "application/json" }
      },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new ServiceDown("killbill", error);
  }
  const text2 = await response.text();
  if (response.status === 404 && accept404) return { status: 404, location: null, json: null };
  if (response.status >= 300) throw new ServiceDown("killbill", new Error(`${method} ${path}: ${response.status} ${text2.slice(0, 300)}`));
  return { status: response.status, location: response.headers.get("location"), json: text2 ? JSON.parse(text2) : null };
}
var euros = (cents) => Number((cents / 100).toFixed(2));
var kbCents = (amount) => amount === null || amount === void 0 ? 0 : Math.round(Number(amount) * 100);
var idFromLocation = (location) => (location ?? "").replace(/\/+$/, "").split("/").pop() ?? "";
async function accountFor(externalKey, name, email2) {
  const known = await db.one("SELECT account_id FROM killbill_accounts WHERE external_key = $1", [externalKey]);
  if (known) return known.account_id;
  let found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`, void 0, true);
  if (found.status === 404) {
    try {
      await call("POST", "/accounts", { name, email: email2, currency: "EUR", externalKey });
    } catch (error) {
      found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`, void 0, true);
      if (found.status === 404) throw error;
    }
    found = await call("GET", `/accounts?externalKey=${encodeURIComponent(externalKey)}`);
  }
  const account = found.json;
  if (!account.paymentMethodId) {
    await call("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`, { pluginName: EXTERNAL_PLUGIN, pluginInfo: {} });
  }
  if (externalKey.startsWith("kerf-org-")) {
    const tags = (await call("GET", `/accounts/${account.accountId}/tags`)).json;
    if (!tags.some((t) => t.tagDefinitionId === AUTO_PAY_OFF_TAG)) await call("POST", `/accounts/${account.accountId}/tags`, [AUTO_PAY_OFF_TAG]);
  }
  await db.query("INSERT INTO killbill_accounts (external_key, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [externalKey, account.accountId]);
  return account.accountId;
}
async function payment(paymentId) {
  return (await call("GET", `/payments/${paymentId}`)).json;
}
function transactionByKey(found, key) {
  const tx = found.transactions.find((t) => t.transactionExternalKey === key);
  if (!tx || tx.status !== "SUCCESS") throw new ServiceDown("killbill", new Error(`transaction ${key} not successful`));
  return tx;
}
async function authorize(accountId, ref, cents) {
  const created = await call("POST", `/accounts/${accountId}/payments`, {
    transactionType: "AUTHORIZE",
    amount: euros(cents),
    currency: "EUR",
    paymentExternalKey: ref,
    transactionExternalKey: `${ref}-auth`
  });
  const paymentId = idFromLocation(created.location);
  return { paymentId, tx: transactionByKey(await payment(paymentId), `${ref}-auth`) };
}
async function capture(paymentId, ref, cents) {
  await call("POST", `/payments/${paymentId}`, { amount: euros(cents), currency: "EUR", transactionExternalKey: `${ref}-capture` });
  return transactionByKey(await payment(paymentId), `${ref}-capture`);
}
async function voidPayment(paymentId, ref) {
  await call("DELETE", `/payments/${paymentId}`, { transactionExternalKey: `${ref}-void` });
  return transactionByKey(await payment(paymentId), `${ref}-void`);
}
async function refund(paymentId, refundId, cents) {
  await call("POST", `/payments/${paymentId}/refunds`, { amount: euros(cents), currency: "EUR", transactionExternalKey: refundId });
  return transactionByKey(await payment(paymentId), refundId);
}
async function invoiceCharges(accountId, charges) {
  const created = await call(
    "POST",
    `/invoices/charges/${accountId}?autoCommit=true`,
    charges.map((c) => ({ accountId, amount: euros(c.cents), currency: "EUR", description: c.description }))
  );
  const items = created.json;
  return { invoiceId: items[0].invoiceId, itemIds: items.map((i) => i.invoiceItemId) };
}
async function voidInvoice(invoiceId) {
  await call("PUT", `/invoices/${invoiceId}/voidInvoice`);
}
async function adjustItem(accountId, invoiceId, itemId, cents, description) {
  await call("POST", `/invoices/${invoiceId}`, { accountId, invoiceItemId: itemId, amount: euros(cents), currency: "EUR", description });
}
async function collect(accountId, invoiceId, key, cents) {
  const created = await call(
    "POST",
    `/accounts/${accountId}/payments?controlPluginName=${INVOICE_CONTROL_PLUGIN}&pluginProperty=${encodeURIComponent(`IPCD_INVOICE_ID=${invoiceId}`)}`,
    { transactionType: "PURCHASE", amount: euros(cents), currency: "EUR", paymentExternalKey: key, transactionExternalKey: key }
  );
  const paymentId = idFromLocation(created.location);
  return { paymentId, tx: transactionByKey(await payment(paymentId), key) };
}
async function chargeback(paymentId, key, cents) {
  await call("POST", `/invoicePayments/${paymentId}/chargebacks`, { paymentId, amount: euros(cents), currency: "EUR", transactionExternalKey: key });
  return transactionByKey(await payment(paymentId), key);
}
async function writeOff(invoiceId) {
  await call("POST", `/invoices/${invoiceId}/tags`, [WRITTEN_OFF_TAG]);
}
async function kerfPayments() {
  const out = [];
  const pageSize = 200;
  const parallel = 8;
  for (let offset = 0; ; offset += pageSize) {
    const page = (await call("GET", `/accounts/search/kerf-?offset=${offset}&limit=${pageSize}`)).json;
    const accounts = page.filter((a) => a.externalKey.startsWith("kerf-"));
    for (let i = 0; i < accounts.length; i += parallel) {
      const batch = await Promise.all(accounts.slice(i, i + parallel).map(async (account) => (await call("GET", `/accounts/${account.accountId}/payments`)).json));
      out.push(...batch.flat());
    }
    if (page.length < pageSize) return out;
  }
}
async function killbillUp() {
  try {
    const response = await fetch(`${config.killbill.url}/1.0/healthcheck`, { signal: AbortSignal.timeout(1500) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
async function recordTransaction(q, paymentId, tx, link) {
  await q.query(
    `INSERT INTO payment_records (kb_transaction_id, kb_payment_id, transaction_type, amount_cents, status, order_ref, invoice_number, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (kb_transaction_id) DO NOTHING`,
    [tx.transactionId, paymentId, tx.transactionType, kbCents(tx.amount), tx.status, link.orderRef ?? null, link.invoiceNumber ?? null, /* @__PURE__ */ new Date()]
  );
}

// shared/money.ts
function euro(cents) {
  const sign2 = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign2}\u20AC${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
function decimalEuros(cents) {
  return euro(cents).replace("\u20AC", "");
}

// server/domain/mails.ts
var SIGNATURE = "\n\nKerf Frequencies \u2014 Kerf Collective, Brussels";
function lineTable(lines) {
  return lines.map((l) => {
    const parts = [`${l.title} \u2014 ${l.holder_name}`, `  Price ${euro(l.list_cents)}`];
    if (l.group_discount_cents) parts.push(`  Group discount \u2212${euro(l.group_discount_cents)}`);
    if (l.voucher_cents) parts.push(`  Voucher \u2212${euro(l.voucher_cents)}`);
    parts.push(`  To pay ${euro(l.charged_cents)}`);
    return parts.join("\n");
  }).join("\n\n");
}
var total = (lines) => euro(lines.reduce((s, l) => s + l.charged_cents, 0));
var mails = {
  orderConfirmed: (to, ref, lines, passes2) => ({
    to,
    subject: `Your Kerf Frequencies order ${ref}`,
    attachments: passes2,
    body: `Thank you \u2014 order ${ref} is confirmed.

${lineTable(lines)}

Total ${total(lines)}

Your passes are attached, one PDF per ticket. Show the QR code at the venue door.
${appOrigin()}/tickets${SIGNATURE}`
  }),
  orderReceivedReduced: (to, ref, orderId, lines, deadline) => ({
    to,
    subject: `Your Kerf Frequencies order ${ref}`,
    body: `We received order ${ref} at the reduced rate.

${lineTable(lines)}

Total ${total(lines)}

Upload your proof of eligibility by ${deadlineText(deadline.getTime())} (Brussels time):
${appOrigin()}/orders/${orderId}

Your payment is authorised, not taken. We only take it once box office approves your rate, and release it if they don't or if the deadline passes.${SIGNATURE}`
  }),
  proofApproved: (to, ref, passes2) => ({
    to,
    subject: `Reduced rate approved \u2014 order ${ref}`,
    attachments: passes2,
    body: `Your reduced rate is approved and the payment for order ${ref} has been taken.

Your passes are attached, one PDF per ticket.${SIGNATURE}`
  }),
  proofRejected: (to, ref, reason) => ({
    to,
    subject: `Reduced rate not approved \u2014 order ${ref}`,
    body: `Box office could not approve the reduced rate for order ${ref}.

Reason: ${reason}

Your payment authorisation was released; nothing was taken.${SIGNATURE}`
  }),
  proofLapsed: (to, ref) => ({
    to,
    subject: `Reduced-rate hold expired \u2014 order ${ref}`,
    body: `The proof deadline for order ${ref} passed without a decision, so your payment authorisation was released. Nothing was taken.${SIGNATURE}`
  }),
  refundNotice: (to, ref, items, cardCents, voucherCents, released) => ({
    to,
    subject: `Refund for order ${ref}`,
    body: `These items on order ${ref} are refunded:

${items.map((i) => `- ${i.title} \u2014 ${i.holder_name}`).join("\n")}

${released ? "The payment authorisation for these items was released; nothing was taken for them." : `Card refund: ${euro(cardCents)}`}${voucherCents ? `
Returned to your gift voucher: ${euro(voucherCents)}` : ""}

Every other item on the order stays valid.${SIGNATURE}`
  }),
  transferSent: (to, ref, item, recipient) => ({
    to,
    subject: `You transferred a ticket \u2014 order ${ref}`,
    body: `You transferred ${item} to ${recipient}. They get a new pass; your old pass for this ticket no longer scans.${SIGNATURE}`
  }),
  transferReceived: (to, face, pass2) => ({
    to,
    subject: `A ticket for ${face.item} is yours`,
    attachments: [pass2],
    body: `Hello ${face.holder},

A ticket was transferred to you.

${face.item}
${face.when}
${face.venue}

Your pass is attached. Show its QR code at the door.${SIGNATURE}`
  }),
  invoiceIssued: (to, number, lines, amount, due) => ({
    to,
    subject: `Invoice ${number} from Kerf Collective`,
    body: `Invoice ${number}

${lines.map((l) => `- ${l.description}: ${euro(l.amount_cents)}`).join("\n")}

Amount: ${euro(amount)}
Due on ${dateText(due.getTime())}; we collect it on that date.${SIGNATURE}`
  }),
  creditNote: (to, number, invoiceNumber, lines, amount) => ({
    to,
    subject: `Credit note ${number} from Kerf Collective`,
    body: `Credit note ${number} against invoice ${invoiceNumber}

${lines.map((l) => `- ${l.description}: ${euro(l.amount_cents)}`).join("\n")}

Credited: ${euro(amount)}${SIGNATURE}`
  }),
  bankReturn: (to, number, nextRetry) => ({
    to,
    subject: `Payment returned \u2014 invoice ${number}`,
    body: `The bank returned the payment for invoice ${number}.

${nextRetry ? `We will try to collect it again on ${dateText(nextRetry.getTime())}.` : `Invoice ${number} is written off.`}${SIGNATURE}`
  })
};

// server/services/smtp.ts
import { connect as connect2 } from "node:net";
var TIMEOUT_MS2 = 8e3;
function encodedWord(text2) {
  return /^[\x20-\x7e]*$/.test(text2) ? text2 : `=?UTF-8?B?${Buffer.from(text2, "utf8").toString("base64")}?=`;
}
function base64Lines(data) {
  return (data.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}
function mime(message) {
  const headers = [
    `From: ${config.mail.from}`,
    `To: ${message.to}`,
    `Subject: ${encodedWord(message.subject)}`,
    `Message-ID: ${message.messageId}`,
    `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
    "MIME-Version: 1.0"
  ];
  const text2 = ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(Buffer.from(message.body, "utf8"))];
  if (!message.attachments.length) return [...headers, ...text2].join("\r\n");
  const boundary = `kerf-${message.messageId.replace(/[^a-z0-9]/gi, "")}`;
  const parts = [`--${boundary}`, ...text2];
  for (const attachment of message.attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: application/pdf; name="${attachment.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      "",
      base64Lines(attachment.content)
    );
  }
  parts.push(`--${boundary}--`);
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}
var Session = class {
  constructor(socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      this.flush();
    });
  }
  socket;
  buffer = "";
  waiting = null;
  flush() {
    const m = /(^|\r\n)(\d{3}) [^\r\n]*\r\n/.exec(this.buffer);
    if (m && this.waiting) {
      const reply = this.buffer.slice(0, m.index + m[0].length);
      this.buffer = this.buffer.slice(m.index + m[0].length);
      const resolve2 = this.waiting;
      this.waiting = null;
      resolve2(reply);
    }
  }
  reply(expect) {
    return new Promise((resolve2, reject) => {
      this.waiting = (reply) => {
        const code2 = Number(reply.split("\r\n").filter(Boolean).pop().slice(0, 3));
        if (Math.floor(code2 / 100) === Math.floor(expect / 100)) resolve2(reply);
        else reject(new Error(`SMTP ${code2}: ${reply.trim()}`));
      };
      this.flush();
    });
  }
  async command(line, expect) {
    this.socket.write(line + "\r\n");
    return this.reply(expect);
  }
};
function open2() {
  return new Promise((resolve2, reject) => {
    const socket = connect2({ host: config.mail.smtpHost, port: config.mail.smtpPort });
    socket.setTimeout(TIMEOUT_MS2, () => socket.destroy(new Error("SMTP timeout")));
    socket.once("error", reject);
    socket.once("connect", () => resolve2({ socket, session: new Session(socket) }));
  });
}
async function deliver(message) {
  const { socket, session } = await open2();
  const failed = new Promise((_, reject) => socket.once("error", reject));
  const exchange = async () => {
    await session.reply(220);
    await session.command("EHLO kerf.example", 250);
    await session.command(`MAIL FROM:<${config.mail.fromAddress}>`, 250);
    await session.command(`RCPT TO:<${message.to}>`, 250);
    await session.command("DATA", 354);
    const data = mime(message).replace(/\r\n\./g, "\r\n..");
    await session.command(`${data}\r
.`, 250);
    socket.end("QUIT\r\n");
  };
  try {
    await Promise.race([exchange(), failed]);
  } finally {
    socket.destroy();
  }
}
async function mailUp() {
  const smtp = open2().then(async ({ socket, session }) => {
    try {
      await Promise.race([session.reply(220), new Promise((_, reject) => socket.once("error", reject))]);
      return true;
    } finally {
      socket.destroy();
    }
  }).catch(() => false);
  const api = fetch(`${config.mail.mailpitUrl}/readyz`, { signal: AbortSignal.timeout(1500) }).then(async (response) => {
    await response.arrayBuffer();
    return response.ok;
  }).catch(() => false);
  const timeout = new Promise((resolve2) => setTimeout(() => resolve2(false), 1500));
  const [a, b] = await Promise.all([Promise.race([smtp, timeout]), api]);
  return a && b;
}

// server/domain/outbox.ts
var messageId = (outboxId) => `<kerf-${outboxId}@kerf.example>`;
async function queueMail(q, mail) {
  const row = await q.one(
    "INSERT INTO outbox (to_address, subject, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
    [mail.to, mail.subject, mail.body, /* @__PURE__ */ new Date()]
  );
  for (const [position, attachment] of (mail.attachments ?? []).entries()) {
    await q.query(
      "INSERT INTO outbox_attachments (outbox_id, position, filename, content) VALUES ($1, $2, $3, $4)",
      [row.id, position, attachment.filename, attachment.content]
    );
  }
  return row.id;
}
async function deliverOutbox() {
  for (; ; ) {
    const sent = await transaction(async (tx) => {
      const next = await tx.one(
        "SELECT id, to_address, subject, body FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED"
      );
      if (!next) return false;
      const attachments = await tx.all(
        "SELECT filename, content FROM outbox_attachments WHERE outbox_id = $1 ORDER BY position",
        [next.id]
      );
      await deliver({ messageId: messageId(next.id), to: next.to_address, subject: next.subject, body: next.body, attachments });
      await tx.query("UPDATE outbox SET sent_at = $2, attempts = attempts + 1 WHERE id = $1", [next.id, /* @__PURE__ */ new Date()]);
      return true;
    });
    if (!sent) return;
  }
}

// server/domain/programme.ts
var SESSION_SELECT = `SELECT s.id, s.title, s.description, s.discipline, s.venue_id, s.admission, s.capacity,
  seats_remaining(s.id, $1) AS seats_remaining, s.price_full_cents, s.price_reduced_cents, s.starts_at, s.ends_at,
  effective_status(s.status, s.publish_at, $1) AS status, s.publish_at, s.version FROM sessions s`;
async function edition(q = db) {
  const row = await q.one("SELECT name, first_day::text, last_day::text FROM edition WHERE id = 1");
  return row;
}
function festivalDays(e) {
  return datesBetween(e.first_day, e.last_day).map((date) => {
    const bounds = festivalDayBounds(date);
    return { date, label: dayLabel(date), starts_at: isoUtc(bounds.startsAt), ends_at: isoUtc(bounds.endsAt) };
  });
}
function sessionView(row, full) {
  const view = {
    id: row.id,
    title: row.title,
    description: row.description,
    discipline: row.discipline,
    venue_id: row.venue_id,
    admission: row.admission,
    capacity: row.capacity,
    seats_remaining: row.seats_remaining,
    price_full_cents: row.price_full_cents,
    price_reduced_cents: row.price_reduced_cents,
    starts_at: isoUtc(row.starts_at),
    ends_at: isoUtc(row.ends_at),
    starts_local: localIso(row.starts_at.getTime()),
    ends_local: localIso(row.ends_at.getTime()),
    festival_day: festivalDayOf(row.starts_at.getTime()),
    status: row.status
  };
  return full ? { ...view, publish_at: isoOrNull(row.publish_at), version: row.version } : view;
}
var PUBLIC = ["published", "cancelled"];
route("GET", "/api/programme", "public", async (ctx) => {
  const now = /* @__PURE__ */ new Date();
  const e = await edition();
  const days = festivalDays(e);
  const venues = await db.all("SELECT id, name FROM venues ORDER BY position, id");
  const disciplines = await db.all("SELECT id, name FROM disciplines ORDER BY position");
  const filters = { day: ctx.query.get("day"), venue: ctx.query.get("venue"), discipline: ctx.query.get("discipline") };
  const errors = {};
  if (filters.day && !days.some((d) => d.date === filters.day)) errors.day = "unknown";
  if (filters.venue && !venues.some((v) => v.id === filters.venue)) errors.venue = "unknown";
  if (filters.discipline && !disciplines.some((d) => d.id === filters.discipline)) errors.discipline = "unknown";
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  const rows = await db.all(
    `${SESSION_SELECT} WHERE effective_status(s.status, s.publish_at, $1) = ANY($2)
    AND ($3::text IS NULL OR s.venue_id = $3) AND ($4::text IS NULL OR s.discipline = $4) ORDER BY s.starts_at, s.id`,
    [now, PUBLIC, filters.venue, filters.discipline]
  );
  const policy = await db.one(
    "SELECT full_festival_full_cents, full_festival_reduced_cents, day_full_cents, day_reduced_cents, group_discount_percent FROM price_policy WHERE id = 1"
  );
  return ok({
    edition: { ...e, time_zone: TIME_ZONE },
    festival_days: days,
    venues,
    disciplines,
    sessions: rows.map((r) => sessionView(r, false)).filter((s) => !filters.day || s.festival_day === filters.day),
    price_policy: policy
  });
});
var isCurator = (user) => user?.role === "curator";
route("GET", "/api/sessions/:id", "public", async (ctx) => {
  const row = await db.one(`${SESSION_SELECT} WHERE s.id = $2`, [/* @__PURE__ */ new Date(), ctx.params.id]);
  if (!row || !isCurator(ctx.user) && !PUBLIC.includes(row.status)) throw notFound();
  return ok(sessionView(row, isCurator(ctx.user)));
});
route("GET", "/api/curate/sessions", ["curator"], async (ctx) => {
  const status = ctx.query.get("status");
  const rows = await db.all(`${SESSION_SELECT} WHERE ($2::text IS NULL OR effective_status(s.status, s.publish_at, $1) = $2)
    ORDER BY s.starts_at, s.id`, [/* @__PURE__ */ new Date(), status]);
  return ok({ sessions: rows.map((r) => sessionView(r, true)) });
});
async function checkSessionFields(q, input) {
  const errors = {};
  const venue = typeof input.venue_id === "string" ? await q.one("SELECT id FROM venues WHERE id = $1", [input.venue_id]) : null;
  if (!venue) throw notFound();
  const title = text(input.title, 1, 200);
  if (title === null) errors.title = "required";
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 4e3) : "";
  const discipline = typeof input.discipline === "string" ? await q.one("SELECT id FROM disciplines WHERE id = $1", [input.discipline]) : null;
  if (!discipline) errors.discipline = "unknown";
  const admission = input.admission === "seat" || input.admission === "pass" ? input.admission : null;
  if (!admission) errors.admission = "unknown";
  const starts = parseWall(input.starts_local);
  const ends = parseWall(input.ends_local);
  const e = await edition(q);
  if (!starts.ok) errors.starts_local = starts.error;
  else if (!withinEdition(e, new Date(starts.instant))) errors.starts_local = "outside_edition";
  if (starts.ok && !ends.ok) errors.ends_local = ends.error;
  else if (starts.ok && ends.ok && ends.instant <= starts.instant) errors.ends_local = "ends_before_start";
  let capacity = null;
  let full = null;
  let reduced = null;
  if (admission === "seat") {
    capacity = intOrNull(input.capacity);
    if (input.capacity === null || input.capacity === void 0) errors.capacity = "required";
    else if (capacity === null || capacity < 1 || capacity > 500) errors.capacity = "out_of_range";
    full = intOrNull(input.price_full_cents);
    reduced = intOrNull(input.price_reduced_cents);
    if (full === null || full < 0 || full > 1e5) errors.price_full_cents = "required";
    if (reduced === null || reduced < 0 || reduced > 1e5) errors.price_reduced_cents = "required";
  }
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  return {
    title,
    description,
    discipline: input.discipline,
    venue_id: input.venue_id,
    starts_at: new Date(starts.instant),
    ends_at: new Date(ends.instant),
    admission,
    capacity,
    price_full_cents: full,
    price_reduced_cents: reduced
  };
}
route("POST", "/api/sessions", ["curator"], async (ctx) => {
  const input = asObject(ctx.body);
  const id = `s-${newId()}`;
  const session = await transaction(async (tx) => {
    const f = await checkSessionFields(tx, input);
    await tx.query(
      `INSERT INTO sessions (id, title, description, discipline, venue_id, admission, capacity, price_full_cents,
      price_reduced_cents, starts_at, ends_at, status, version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',1)`,
      [id, f.title, f.description, f.discipline, f.venue_id, f.admission, f.capacity, f.price_full_cents, f.price_reduced_cents, f.starts_at, f.ends_at]
    );
    await audit(tx, ctx.user, "session.created", { type: "session", id }, { title: f.title });
    return await tx.one(`${SESSION_SELECT} WHERE s.id = $2`, [/* @__PURE__ */ new Date(), id]);
  });
  return ok(sessionView(session, true), 201);
});
var EDITABLE = ["draft", "review", "scheduled"];
route("PATCH", "/api/sessions/:id", ["curator"], async (ctx) => {
  const updated = await transaction(async (tx) => {
    const now = /* @__PURE__ */ new Date();
    const current = await tx.one(`${SESSION_SELECT} WHERE s.id = $2 FOR UPDATE`, [now, ctx.params.id]);
    if (!current) throw notFound();
    const ifMatch = ctx.headers["if-match"];
    if (typeof ifMatch !== "string" || ifMatch.trim() === "") throw new ApiError(428, "version_required");
    if (Number(ifMatch.replace(/"/g, "")) !== current.version) throw new ApiError(412, "stale_version", { current_version: current.version });
    if (!EDITABLE.includes(current.status)) throw new ApiError(409, "not_editable");
    const input = asObject(ctx.body);
    const merged = {
      title: current.title,
      description: current.description,
      discipline: current.discipline,
      venue_id: current.venue_id,
      starts_local: localIso(current.starts_at.getTime()),
      ends_local: localIso(current.ends_at.getTime()),
      admission: current.admission,
      capacity: current.capacity,
      price_full_cents: current.price_full_cents,
      price_reduced_cents: current.price_reduced_cents,
      ...input
    };
    const f = await checkSessionFields(tx, merged);
    await tx.query(
      `UPDATE sessions SET title=$2, description=$3, discipline=$4, venue_id=$5, admission=$6, capacity=$7,
      price_full_cents=$8, price_reduced_cents=$9, starts_at=$10, ends_at=$11, version = version + 1 WHERE id = $1`,
      [current.id, f.title, f.description, f.discipline, f.venue_id, f.admission, f.capacity, f.price_full_cents, f.price_reduced_cents, f.starts_at, f.ends_at]
    );
    await audit(tx, ctx.user, "session.edited", { type: "session", id: current.id }, { fields: Object.keys(input) });
    return await tx.one(`${SESSION_SELECT} WHERE s.id = $2`, [now, current.id]);
  });
  return ok(sessionView(updated, true));
});
function withinEdition(e, startsAt) {
  const day = festivalDayOf(startsAt.getTime());
  return day >= e.first_day && day <= e.last_day;
}

// server/domain/invoices.ts
var DUE_BILLING_DAYS = 30;
var RETRY_BILLING_DAYS = [1, 3, 7];
var SETTLED_AFTER_RETRY_DAYS = 2;
var billingDays = (n) => n * config.time.billingDaySeconds * 1e3;
async function nextNumber(q, counter, prefix) {
  const year = (await edition(q)).first_day.slice(0, 4);
  const row = await q.one(
    "INSERT INTO counters (name, value) VALUES ($1, 1) ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value",
    [`${counter}-${year}`]
  );
  return `${prefix}-${year}-${String(row.value).padStart(4, "0")}`;
}
async function issueInvoice(tx, input) {
  const org = await tx.one("SELECT id, name FROM organisations WHERE id = $1", [input.booker.organisation_id]);
  const account = await accountFor(`kerf-org-${org.id}`, org.name, null);
  const charges = input.lines.map((l) => ({ description: `${input.ref} \xB7 ${l.title} \xB7 ${l.holder_name}`, cents: l.charged_cents }));
  const kb = await invoiceCharges(account, charges);
  input.undo.push(() => voidInvoice(kb.invoiceId));
  const id = newId();
  const number = await nextNumber(tx, "invoice", "INV");
  const issued = /* @__PURE__ */ new Date();
  const due = new Date(issued.getTime() + billingDays(DUE_BILLING_DAYS));
  await tx.query(
    `INSERT INTO invoices (id, number, organisation_id, order_id, booker_id, status, amount_cents, issued_at, due_at, kb_invoice_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, number, org.id, input.orderId, input.booker.id, input.totalCents <= 0 ? "paid" : "issued", input.totalCents, issued, due, kb.invoiceId]
  );
  for (const [i, line] of input.lines.entries()) {
    await tx.query(
      "INSERT INTO invoice_lines (invoice_id, line_id, description, amount_cents, kb_item_id) VALUES ($1,$2,$3,$4,$5)",
      [id, line.id, charges[i].description, line.charged_cents, kb.itemIds[i]]
    );
  }
  await queueMail(tx, mails.invoiceIssued(input.booker.email, number, charges.map((c) => ({ description: c.description, amount_cents: c.cents })), input.totalCents, due));
}
var INVOICE_SELECT = `SELECT i.*,
  COALESCE((SELECT sum(amount_cents) FROM credit_notes c WHERE c.invoice_id = i.id), 0)::integer AS credited_cents,
  COALESCE((SELECT sum(amount_cents) FROM collections k WHERE k.invoice_id = i.id AND k.returned_at IS NULL), 0)::integer AS paid_cents
  FROM invoices i`;
var balanceOf = (i) => i.amount_cents - i.credited_cents - i.paid_cents;
async function invoiceViews(q, rows) {
  const ids = rows.map((r) => r.id);
  const lines = await q.all(
    "SELECT invoice_id, line_id, description, amount_cents FROM invoice_lines l JOIN lines x ON x.id = l.line_id WHERE invoice_id = ANY($1) ORDER BY x.position",
    [ids]
  );
  const notes = await q.all("SELECT id, invoice_id FROM credit_notes WHERE invoice_id = ANY($1) ORDER BY issued_at", [ids]);
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    organisation_id: r.organisation_id,
    order_id: r.order_id,
    status: r.status,
    amount_cents: r.amount_cents,
    credited_cents: r.credited_cents,
    paid_cents: r.paid_cents,
    balance_cents: balanceOf(r),
    issued_at: isoUtc(r.issued_at),
    due_at: isoUtc(r.due_at),
    retries_used: r.retries_used,
    next_retry_at: isoOrNull(r.next_retry_at),
    credit_note_ids: notes.filter((n) => n.invoice_id === r.id).map((n) => n.id),
    lines: lines.filter((l) => l.invoice_id === r.id).map(({ line_id, description, amount_cents }) => ({ line_id, description, amount_cents }))
  }));
}
function scope(user) {
  return user.role === "finance" ? null : user.organisation_id;
}
async function invoicesFor(q, user) {
  return q.all(`${INVOICE_SELECT} WHERE ($1::text IS NULL OR i.organisation_id = $1) ORDER BY i.issued_at DESC`, [scope(user)]);
}
async function invoicesOfOrganisation(q, organisationId) {
  return invoiceViews(q, await q.all(`${INVOICE_SELECT} WHERE i.organisation_id = $1 ORDER BY i.issued_at DESC`, [organisationId]));
}
var READERS = ["group_booker", "finance"];
route("GET", "/api/invoices", READERS, async (ctx) => ok({ invoices: await invoiceViews(db, await invoicesFor(db, ctx.user)) }));
route("GET", "/api/invoices/:id", READERS, async (ctx) => {
  const row = await db.one(`${INVOICE_SELECT} WHERE i.id = $1 AND ($2::text IS NULL OR i.organisation_id = $2)`, [ctx.params.id, scope(ctx.user)]);
  if (!row) throw notFound();
  return ok((await invoiceViews(db, [row]))[0]);
});
route("GET", "/api/credit-notes/:id", READERS, async (ctx) => {
  const note = await db.one(
    `SELECT c.id, c.number, c.invoice_id, c.amount_cents, c.issued_at FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id
     WHERE c.id = $1 AND ($2::text IS NULL OR i.organisation_id = $2)`,
    [ctx.params.id, scope(ctx.user)]
  );
  if (!note) throw notFound();
  const lines = await db.all(
    "SELECT line_id, description, amount_cents FROM credit_note_lines WHERE credit_note_id = $1 ORDER BY description",
    [note.id]
  );
  return ok({ ...note, issued_at: isoUtc(note.issued_at), lines });
});
async function issueCreditNote(tx, orderId, lines) {
  const invoice = await tx.one(
    "SELECT i.id, i.number, u.email AS booker_email FROM invoices i JOIN users u ON u.id = i.booker_id WHERE i.order_id = $1",
    [orderId]
  );
  const id = newId();
  const number = await nextNumber(tx, "credit_note", "CN");
  const amount = lines.reduce((s, l) => s + l.charged_cents, 0);
  await tx.query("INSERT INTO credit_notes (id, number, invoice_id, amount_cents, issued_at) VALUES ($1,$2,$3,$4,$5)", [id, number, invoice.id, amount, /* @__PURE__ */ new Date()]);
  const described = await tx.all(
    "SELECT line_id, description, amount_cents FROM invoice_lines WHERE invoice_id = $1 AND line_id = ANY($2)",
    [invoice.id, lines.map((l) => l.id)]
  );
  for (const d of described) {
    await tx.query("INSERT INTO credit_note_lines (credit_note_id, line_id, description, amount_cents) VALUES ($1,$2,$3,$4)", [id, d.line_id, d.description, d.amount_cents]);
  }
  await queueMail(tx, mails.creditNote(invoice.booker_email, number, invoice.number, described, amount));
  return id;
}
async function adjustCreditNote(tx, creditNoteId) {
  const pending = await tx.all(
    `SELECT n.line_id, n.amount_cents, il.kb_item_id, i.kb_invoice_id, i.organisation_id, c.number FROM credit_note_lines n
     JOIN credit_notes c ON c.id = n.credit_note_id JOIN invoices i ON i.id = c.invoice_id
     JOIN invoice_lines il ON il.invoice_id = i.id AND il.line_id = n.line_id WHERE n.credit_note_id = $1 AND NOT n.adjusted`,
    [creditNoteId]
  );
  for (const p of pending) {
    const org = await tx.one("SELECT name FROM organisations WHERE id = $1", [p.organisation_id]);
    const account = await accountFor(`kerf-org-${p.organisation_id}`, org.name, null);
    if (p.amount_cents > 0) await adjustItem(account, p.kb_invoice_id, p.kb_item_id, p.amount_cents, `Credit note ${p.number}`);
    await tx.query("UPDATE credit_note_lines SET adjusted = true WHERE credit_note_id = $1 AND line_id = $2", [creditNoteId, p.line_id]);
  }
}
async function collectOnce(tx, invoice, now, action) {
  const balance = balanceOf(invoice);
  const attempt = (await tx.one("SELECT count(*)::integer AS n FROM collections WHERE invoice_id = $1", [invoice.id])).n + 1;
  const org = await tx.one("SELECT name FROM organisations WHERE id = $1", [invoice.organisation_id]);
  const account = await accountFor(`kerf-org-${invoice.organisation_id}`, org.name, null);
  const key = `${invoice.number}-${attempt}`;
  const paid = await collect(account, invoice.kb_invoice_id, key, balance);
  await recordTransaction(tx, paid.paymentId, paid.tx, { invoiceNumber: invoice.number });
  await tx.query(
    "INSERT INTO collections (invoice_id, attempt, kb_payment_id, amount_cents, collected_at) VALUES ($1,$2,$3,$4,$5)",
    [invoice.id, attempt, paid.paymentId, balance, now]
  );
  const status = action === "invoice.collected" ? "paid" : "retried";
  await tx.query(
    `UPDATE invoices SET status = $2${action === "invoice.retried" ? ", retries_used = retries_used + 1, retried_at = $3, next_retry_at = NULL" : ""} WHERE id = $1`,
    action === "invoice.retried" ? [invoice.id, status, now] : [invoice.id, status]
  );
  await audit(tx, "system", action, { type: "invoice", id: invoice.id }, { attempt, amount_cents: balance });
}
async function invoiceSweep() {
  const now = /* @__PURE__ */ new Date();
  const DUE = `((i.status = 'issued' AND i.due_at <= $1) OR (i.status = 'payment_failed' AND i.next_retry_at <= $1)
    OR (i.status = 'retried' AND i.retried_at <= $2))`;
  const params = [now, new Date(now.getTime() - billingDays(SETTLED_AFTER_RETRY_DAYS))];
  const failures = [];
  for (const { id } of await db.all(`SELECT i.id FROM invoices i WHERE ${DUE} ORDER BY i.due_at`, params)) {
    await transaction(async (tx) => {
      const due = await tx.one(`${INVOICE_SELECT} WHERE i.id = $3 AND ${DUE} FOR UPDATE OF i SKIP LOCKED`, [...params, id]);
      if (!due) return;
      if (due.status === "retried") {
        await tx.query("UPDATE invoices SET status = 'paid', retried_at = NULL WHERE id = $1", [due.id]);
        await audit(tx, "system", "invoice.settled", { type: "invoice", id: due.id });
      } else if (due.status === "issued" && balanceOf(due) <= 0) {
        await tx.query("UPDATE invoices SET status = 'paid' WHERE id = $1", [due.id]);
        await audit(tx, "system", "invoice.collected", { type: "invoice", id: due.id }, { amount_cents: 0 });
      } else await collectOnce(tx, due, now, due.status === "issued" ? "invoice.collected" : "invoice.retried");
    }).catch((error) => failures.push(error instanceof Error ? error.message : String(error)));
  }
  if (failures.length) throw new Error(failures.join("; "));
}
route("POST", "/api/finance/invoices/:id/returns", ["finance"], async (ctx) => {
  const view = await transaction(async (tx) => {
    const invoice = await tx.one(`${INVOICE_SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [ctx.params.id]);
    if (!invoice) throw notFound();
    const latest = await tx.one(
      "SELECT attempt, kb_payment_id, amount_cents FROM collections WHERE invoice_id = $1 AND returned_at IS NULL ORDER BY attempt DESC LIMIT 1",
      [invoice.id]
    );
    if (!(invoice.status === "paid" || invoice.status === "retried") || !latest) throw new ApiError(409, "not_collected");
    const note = typeof asObject(ctx.body).note === "string" ? asObject(ctx.body).note.trim() : "";
    if (!note) throw new FieldErrors({ note: "required" });
    const now = /* @__PURE__ */ new Date();
    const returned = await chargeback(latest.kb_payment_id, `${invoice.number}-${latest.attempt}-return`, latest.amount_cents);
    await recordTransaction(tx, latest.kb_payment_id, returned, { invoiceNumber: invoice.number });
    await tx.query("UPDATE collections SET returned_at = $3 WHERE invoice_id = $1 AND attempt = $2", [invoice.id, latest.attempt, now]);
    const writtenOff = invoice.retries_used >= RETRY_BILLING_DAYS.length;
    const firstReturn = invoice.first_return_at ?? now;
    const nextRetry = writtenOff ? null : new Date(firstReturn.getTime() + billingDays(RETRY_BILLING_DAYS[invoice.retries_used]));
    if (writtenOff) await writeOff(invoice.kb_invoice_id);
    await tx.query(
      "UPDATE invoices SET status = $2, first_return_at = $3, next_retry_at = $4, retried_at = NULL WHERE id = $1",
      [invoice.id, writtenOff ? "written_off" : "payment_failed", firstReturn, nextRetry]
    );
    const booker = await tx.one("SELECT email FROM users WHERE id = $1", [invoice.booker_id]);
    await queueMail(tx, mails.bankReturn(booker.email, invoice.number, nextRetry));
    await audit(
      tx,
      ctx.user,
      "invoice.returned",
      { type: "invoice", id: invoice.id },
      { note, attempt: latest.attempt, next_retry_at: isoOrNull(nextRetry) }
    );
    if (writtenOff) await audit(tx, "system", "invoice.written_off", { type: "invoice", id: invoice.id });
    return (await invoiceViews(tx, [await tx.one(`${INVOICE_SELECT} WHERE i.id = $1`, [invoice.id])]))[0];
  });
  return ok(view);
});

// server/services/files.ts
import webp from "@cwasm/webp";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
function sniff(data) {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}
var NAME_LIMIT = 200;
function nameAllowed(name) {
  return name.length <= NAME_LIMIT && !/[/\\]/.test(name) && !name.includes("..") && !/[\u0000-\u001f\u007f]/.test(name);
}
function checkUpload(file, allowed) {
  if (!file) return { error: "required" };
  if (file.data.length === 0) return { error: "empty" };
  if (!nameAllowed(file.filename)) return { error: "invalid_name" };
  const type = sniff(file.data);
  if (!type || !allowed.includes(type)) return { error: "unsupported_type" };
  return { file, type };
}
function decodeImage(data, type) {
  try {
    if (type === "image/png") {
      const png = PNG.sync.read(data);
      return { width: png.width, height: png.height, data: png.data };
    }
    if (type === "image/jpeg") {
      const image2 = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 });
      return { width: image2.width, height: image2.height, data: image2.data };
    }
    const image = webp.decode(data);
    return { width: image.width, height: image.height, data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength) };
  } catch {
    throw new FieldErrors({ file: "unsupported_type" });
  }
}
var DISPLAY_LONGEST = 1200;
function displayJpeg(source) {
  const scale = Math.min(1, DISPLAY_LONGEST / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor(y / scale);
    const sy1 = Math.max(sy0 + 1, Math.min(source.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor(x / scale);
      const sx1 = Math.max(sx0 + 1, Math.min(source.width, Math.floor((x + 1) / scale)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * source.width + sx) * 4;
          const alpha = source.data[i + 3] / 255;
          r += source.data[i] * alpha + 244 * (1 - alpha);
          g += source.data[i + 1] * alpha + 237 * (1 - alpha);
          b += source.data[i + 2] * alpha + 225 * (1 - alpha);
          a += 255;
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return Buffer.from(jpeg.encode({ width, height, data: out }, 86).data);
}

// server/services/storage.ts
import { createHash as createHash3, createHmac as createHmac3 } from "node:crypto";
var TIMEOUT_MS3 = 8e3;
var EMPTY_SHA = createHash3("sha256").update("").digest("hex");
function hmac(key, data) {
  return createHmac3("sha256", key).update(data).digest();
}
function encodePath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("/");
}
function target(key) {
  const base = new URL(config.s3.endpoint);
  const objectPath = key === null ? "" : "/" + encodePath(key);
  if (config.s3.forcePathStyle) return new URL(`${base.origin}/${encodeURIComponent(config.s3.bucket)}${objectPath}`);
  return new URL(`${base.protocol}//${config.s3.bucket}.${base.host}${objectPath || "/"}`);
}
async function s3(method, key, body, contentType) {
  const url = target(key);
  const now = /* @__PURE__ */ new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = body ? createHash3("sha256").update(body).digest("hex") : EMPTY_SHA;
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, "", names.map((n) => `${n}:${headers[n]}
`).join(""), names.join(";"), payloadHash].join("\n");
  const scope2 = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256
${amzDate}
${scope2}
${createHash3("sha256").update(canonical).digest("hex")}`;
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac3("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope2}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete headers.host;
  try {
    return await fetch(url, { method, headers, body: body ? new Uint8Array(body) : void 0, signal: AbortSignal.timeout(TIMEOUT_MS3) });
  } catch (error) {
    throw new ServiceDown("minio", error);
  }
}
async function expectOk(response, what) {
  if (response.ok) return response;
  await response.arrayBuffer();
  throw new ServiceDown("minio", new Error(`${what}: ${response.status}`));
}
async function putObject(key, body, contentType) {
  await (await expectOk(await s3("PUT", key, body, contentType), "PUT")).arrayBuffer();
}
async function getObject(key) {
  return Buffer.from(await (await expectOk(await s3("GET", key), "GET")).arrayBuffer());
}
async function deleteObject(key) {
  const response = await s3("DELETE", key);
  await response.arrayBuffer();
}
async function putAll(objects) {
  const written = [];
  try {
    for (const object of objects) {
      await putObject(object.key, object.body, object.contentType);
      written.push(object.key);
    }
  } catch (error) {
    await removeAll(written);
    throw error;
  }
}
async function removeAll(keys) {
  for (const key of keys) await deleteObject(key).catch(() => void 0);
}
async function storageUp() {
  try {
    const response = await s3("HEAD", null);
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}
var objectKeys = {
  pass: (ref, code2) => `passes/${ref}/${code2}.pdf`,
  proof: (ref, proofId) => `proofs/${ref}/${proofId}`,
  artworkOriginal: (entryId, imageId) => `artworks/originals/${entryId}/${imageId}`,
  artworkDisplay: (entryId, imageId) => `artworks/display/${entryId}/${imageId}.jpg`
};

// shared/admission.ts
var FULL_PASS_ONLY_VENUE = "planetarium-dome";
var dayPassCovers = (venueId) => venueId !== FULL_PASS_ONLY_VENUE;

// server/services/passPdf.ts
import qrcode from "qrcode-generator";
var WIDTH = 420;
var HEIGHT = 640;
var WIN_ANSI = { "\u20AC": 128, "\u2013": 150, "\u2014": 151, "\xB7": 183, "\u2019": 146, "\u2018": 145, "\u201C": 147, "\u201D": 148, "\u2026": 133 };
function pdfText(text2) {
  let out = "";
  for (const ch of text2) {
    const code2 = WIN_ANSI[ch] ?? ch.codePointAt(0);
    const byte = code2 <= 255 ? code2 : 63;
    const c = String.fromCharCode(byte);
    out += c === "(" || c === ")" || c === "\\" ? "\\" + c : c;
  }
  return `(${out})`;
}
function wrap2(text2, max) {
  const lines = [];
  let line = "";
  for (const word2 of text2.split(/\s+/)) {
    if ((line + " " + word2).trim().length > max && line) {
      lines.push(line);
      line = word2;
    } else line = (line + " " + word2).trim();
  }
  if (line) lines.push(line);
  return lines;
}
function passPdf(face) {
  const ops = [];
  ops.push("0.055 0.055 0.063 rg", `0 ${HEIGHT - 120} ${WIDTH} 120 re f`, "0.784 0.941 0.192 rg", `0 ${HEIGHT - 128} ${WIDTH} 8 re f`);
  const label = (y, text2) => ops.push("0.35 0.35 0.38 rg", "BT", "/F1 9 Tf", `32 ${y} Td`, `${pdfText(text2)} Tj`, "ET");
  const value = (y, text2, size2) => {
    let line = y;
    for (const part of wrap2(text2, Math.floor(560 / size2))) {
      ops.push("0.055 0.055 0.063 rg", "BT", `/F2 ${size2} Tf`, `32 ${line} Td`, `${pdfText(part)} Tj`, "ET");
      line -= size2 * 1.2;
    }
  };
  ops.push("0.784 0.941 0.192 rg", "BT", "/F2 26 Tf", `32 ${HEIGHT - 70} Td`, `${pdfText(face.item.length > 26 ? face.item.slice(0, 25) + "\u2026" : face.item)} Tj`, "ET");
  label(HEIGHT - 160, "HOLDER");
  value(HEIGHT - 180, face.holder, 18);
  label(HEIGHT - 222, "ITEM");
  value(HEIGHT - 240, face.item, 14);
  label(HEIGHT - 282, "WHEN");
  value(HEIGHT - 300, face.when, 14);
  label(HEIGHT - 342, "VENUE");
  value(HEIGHT - 360, face.venue, 14);
  const qr = qrcode(0, "M");
  qr.addData(face.code);
  qr.make();
  const modules = qr.getModuleCount();
  const size = 170;
  const cell = size / (modules + 8);
  const x0 = 32;
  const y0 = 60;
  ops.push("1 1 1 rg", `${x0} ${y0} ${size} ${size} re f`, "0.055 0.055 0.063 rg");
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (qr.isDark(r, c)) ops.push(`${(x0 + (c + 4) * cell).toFixed(2)} ${(y0 + size - (r + 5) * cell).toFixed(2)} ${cell.toFixed(2)} ${cell.toFixed(2)} re f`);
    }
  }
  label(250, "PASS");
  ops.push("0.055 0.055 0.063 rg", "BT", "/F3 16 Tf", `${x0 + size + 20} ${y0 + 80} Td`, `${pdfText(face.code)} Tj`, "ET");
  const content = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>
stream
${content}
endstream`
  ];
  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj
${object}
endobj
`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n 
`;
  body += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF
`;
  return Buffer.from(body, "latin1");
}

// server/domain/orders.ts
var LINE_MOVES = {
  authorised: ["captured", "proof_pending"],
  proof_pending: ["captured", "voided", "expired"],
  captured: ["transferred", "refunded"],
  transferred: ["refunded"],
  voided: [],
  expired: [],
  refunded: []
};
function refusedMoves(lines, to) {
  return lines.filter((l) => !LINE_MOVES[l.state].includes(to));
}
async function moveLines(q, lineIds, to) {
  const from = Object.keys(LINE_MOVES).filter((state) => LINE_MOVES[state].includes(to));
  const moved = await q.query("UPDATE lines SET state = $2 WHERE id = ANY($1) AND state = ANY($3)", [lineIds, to, from]);
  if (moved.rowCount !== lineIds.length) throw new ApiError(409, "line_state_conflict");
}
function orderStatus(states) {
  if (states.includes("proof_pending")) return "proof_pending";
  if (states.every((s) => s === "voided" || s === "expired")) return "voided";
  const remaining = states.filter((s) => s !== "voided" && s !== "expired");
  if (remaining.every((s) => s === "refunded")) return "refunded";
  if (states.includes("refunded")) return "refunded_partial";
  return "confirmed";
}
var ORDER_SELECT = `SELECT o.id, o.ref, o.buyer_id, u.name AS buyer_name, u.email AS buyer_email, o.organisation_id, o.rate,
  o.voucher_code, o.proof_deadline, o.kb_payment_id, o.confirmation_outbox_id, o.created_at FROM orders o JOIN users u ON u.id = o.buyer_id`;
async function linesOf(q, orderIds) {
  return q.all(
    `SELECT l.id, l.order_id, l.position, l.kind, l.session_id, l.festival_day::text, l.title, l.holder_name, l.state, l.list_cents,
       l.group_discount_cents, l.voucher_cents, l.charged_cents, p.code AS pass_code, p.status AS pass_status
     FROM lines l LEFT JOIN LATERAL (SELECT code, status FROM passes WHERE line_id = l.id ORDER BY created_at DESC LIMIT 1) p ON true
     WHERE l.order_id = ANY($1) ORDER BY l.position`,
    [orderIds]
  );
}
function lineView(l) {
  return {
    id: l.id,
    position: l.position,
    kind: l.kind,
    session_id: l.session_id,
    festival_day: l.festival_day,
    title: l.title,
    holder_name: l.holder_name,
    state: l.state,
    list_cents: l.list_cents,
    group_discount_cents: l.group_discount_cents,
    voucher_cents: l.voucher_cents,
    charged_cents: l.charged_cents,
    pass: l.pass_code ? { code: l.pass_code, status: l.pass_status } : null
  };
}
function refundView(r) {
  return {
    id: r.id,
    order_id: r.order_id,
    line_ids: r.line_ids,
    card_cents: r.card_cents,
    voucher_cents: r.voucher_cents,
    credit_note_id: r.credit_note_id,
    status: r.status,
    reason: r.reason,
    created_at: isoUtc(r.created_at)
  };
}
var REFUND_SELECT = "SELECT id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason, created_at FROM refunds";
async function orderViews(q, orders) {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const lines = await linesOf(q, ids);
  const refunds = await q.all(`${REFUND_SELECT} WHERE order_id = ANY($1) ORDER BY created_at`, [ids]);
  const mail = await q.all(
    "SELECT id, sent_at IS NOT NULL AS sent FROM outbox WHERE id = ANY($1::bigint[])",
    [orders.map((o) => String(o.confirmation_outbox_id ?? 0))]
  );
  const invoices = await q.all("SELECT id, order_id FROM invoices WHERE order_id = ANY($1)", [ids]);
  return orders.map((o) => {
    const own = lines.filter((l) => l.order_id === o.id);
    const sum = (key) => own.reduce((s, l) => s + l[key], 0);
    return {
      id: o.id,
      ref: o.ref,
      buyer_name: o.buyer_name,
      organisation_id: o.organisation_id,
      rate: o.rate,
      status: orderStatus(own.map((l) => l.state)),
      subtotal_cents: sum("list_cents"),
      group_discount_cents: sum("group_discount_cents"),
      voucher_code: o.voucher_code,
      voucher_cents: sum("voucher_cents"),
      total_cents: sum("charged_cents"),
      proof_deadline: isoOrNull(o.proof_deadline),
      confirmation_mail: mail.find((m) => m.id === o.confirmation_outbox_id)?.sent ? "sent" : "pending",
      invoice_id: invoices.find((i) => i.order_id === o.id)?.id ?? null,
      created_at: isoUtc(o.created_at),
      lines: own.map(lineView),
      refunds: refunds.filter((r) => r.order_id === o.id).map(refundView)
    };
  });
}
async function orderView(q, orderId) {
  const row = await q.one(`${ORDER_SELECT} WHERE o.id = $1`, [orderId]);
  return (await orderViews(q, [row]))[0];
}
async function visibleOrder(q, user, orderId, lock = false) {
  const row = await q.one(`${ORDER_SELECT} WHERE o.id = $1${lock ? " FOR UPDATE OF o" : ""}`, [orderId]);
  if (!row || !canSee(user, row)) throw notFound();
  return row;
}
function canSee(user, order) {
  return user.role === "finance" || order.buyer_id === user.id || user.role === "group_booker" && order.organisation_id !== null && order.organisation_id === user.organisation_id;
}
async function ordersVisibleTo(q, user) {
  if (user.role === "group_booker") {
    return q.all(`${ORDER_SELECT} WHERE o.buyer_id = $1 OR o.organisation_id = $2 ORDER BY o.created_at DESC`, [user.id, user.organisation_id]);
  }
  return q.all(`${ORDER_SELECT} WHERE o.buyer_id = $1 ORDER BY o.created_at DESC`, [user.id]);
}
async function searchOrders(q, term) {
  return q.all(
    `${ORDER_SELECT} WHERE $1 = '' OR o.ref ILIKE $2 OR u.email ILIKE $2 ORDER BY o.created_at DESC LIMIT 200`,
    [term, `%${term.replace(/[%_\\]/g, "\\$&")}%`]
  );
}
var VIEWERS = ["visitor", "group_booker", "finance"];
route("GET", "/api/orders", ["visitor", "group_booker"], async (ctx) => ok({ orders: await orderViews(db, await ordersVisibleTo(db, ctx.user)) }));
route("GET", "/api/orders/:id", VIEWERS, async (ctx) => {
  const order = await visibleOrder(db, ctx.user, ctx.params.id);
  return ok((await orderViews(db, [order]))[0]);
});
route("GET", "/api/orders/:id/passes/:code", VIEWERS, async (ctx) => {
  const order = await visibleOrder(db, ctx.user, ctx.params.id);
  const pass2 = await db.one("SELECT p.code FROM passes p JOIN lines l ON l.id = p.line_id WHERE p.code = $1 AND l.order_id = $2", [ctx.params.code, order.id]);
  if (!pass2) throw notFound();
  const bytes = await getObject(objectKeys.pass(order.ref, ctx.params.code));
  return { status: 200, bytes, contentType: "application/pdf", headers: { "Content-Disposition": `attachment; filename="${ctx.params.code}.pdf"`, "Cache-Control": "no-store" } };
});
async function passFace(q, line, code2) {
  if (line.kind === "seat") {
    const s = await q.one(
      "SELECT s.starts_at, s.ends_at, v.name AS venue FROM sessions s JOIN venues v ON v.id = s.venue_id WHERE s.id = $1",
      [line.session_id]
    );
    return { holder: line.holder_name, item: line.title, when: sessionTimeText(s.starts_at.getTime(), s.ends_at.getTime()), venue: s.venue, code: code2 };
  }
  if (line.kind === "day") {
    const dome = (await q.one("SELECT name FROM venues WHERE id = $1", [FULL_PASS_ONLY_VENUE]))?.name ?? FULL_PASS_ONLY_VENUE;
    return { holder: line.holder_name, item: line.title, when: `${dayLabel(line.festival_day)} \xB7 05:00 to 05:00 next morning`, venue: `Every venue except ${dome}`, code: code2 };
  }
  const e = await q.one("SELECT first_day::timestamptz AS first_day, last_day::timestamptz AS last_day FROM edition WHERE id = 1");
  return { holder: line.holder_name, item: line.title, when: `${dateText(e.first_day.getTime())} to ${dateText(e.last_day.getTime())}`, venue: "Every venue", code: code2 };
}
async function passDocument(q, line, code2) {
  return passPdf(await passFace(q, line, code2));
}

// server/domain/seats.ts
var HOLD_LIMIT = { visitor: 4, group_booker: 30 };
var BUYERS = ["visitor", "group_booker"];
function holdView(h) {
  return { id: h.id, session_id: h.session_id, quantity: h.quantity, expires_at: isoUtc(h.expires_at), status: h.status };
}
async function seatsRemaining(q, sessionId2, now) {
  return (await q.one("SELECT seats_remaining($1, $2) AS n", [sessionId2, now])).n;
}
async function settleSession(q, sessionId2, now) {
  const session = await q.one("SELECT status, title FROM sessions WHERE id = $1 FOR UPDATE", [sessionId2]);
  if (!session) return;
  const expired = await q.all(
    "UPDATE holds SET status = 'expired' WHERE session_id = $1 AND status = 'active' AND NOT is_live(expires_at, $2) RETURNING id",
    [sessionId2, now]
  );
  for (const hold of expired) await audit(q, "system", "hold.expired", { type: "hold", id: hold.id });
  const lapsed = await q.all(
    "UPDATE waitlist_entries SET status = 'lapsed' WHERE session_id = $1 AND status = 'offered' AND NOT is_live(offer_expires_at, $2) RETURNING id",
    [sessionId2, now]
  );
  for (const entry of lapsed) await audit(q, "system", "waitlist.offer_lapsed", { type: "waitlist_entry", id: entry.id });
  if (session.status === "cancelled") return;
  let free = await seatsRemaining(q, sessionId2, now) ?? 0;
  while (free > 0) {
    const next = await q.one(
      `SELECT w.id, u.email FROM waitlist_entries w JOIN users u ON u.id = w.user_id
       WHERE w.session_id = $1 AND w.status = 'waiting' ORDER BY w.seq LIMIT 1`,
      [sessionId2]
    );
    if (!next) return;
    const deadline = new Date(now.getTime() + config.time.waitlistClaimSeconds * 1e3);
    await q.query("UPDATE waitlist_entries SET status = 'offered', offer_expires_at = $2 WHERE id = $1", [next.id, deadline]);
    await queueMail(q, {
      to: next.email,
      subject: `A seat is free: ${session.title}`,
      body: `A seat for ${session.title} is free and held for you.

Claim it by ${deadlineText(deadline.getTime())} (Brussels time) on My tickets:
${appOrigin()}/tickets

If you don't claim it by then, it goes to the next person on the waitlist.

Kerf Frequencies`
    });
    free--;
  }
}
async function settleDueSessions() {
  const now = /* @__PURE__ */ new Date();
  const due = await db.all(
    `SELECT DISTINCT session_id FROM holds WHERE status = 'active' AND NOT is_live(expires_at, $1)
     UNION SELECT DISTINCT session_id FROM waitlist_entries WHERE status = 'offered' AND NOT is_live(offer_expires_at, $1)`,
    [now]
  );
  for (const { session_id } of due) await transaction((tx) => settleSession(tx, session_id, now));
}
async function lockForSale(q, sessionId2, now) {
  if (typeof sessionId2 !== "string") throw notFound();
  const session = await q.one(
    "SELECT id, title, admission, effective_status(status, publish_at, $2) AS status FROM sessions WHERE id = $1",
    [sessionId2, now]
  );
  if (!session) throw notFound();
  await settleSession(q, session.id, now);
  if (session.status === "cancelled") throw new ApiError(409, "session_cancelled");
  if (session.status !== "published") throw new ApiError(409, "not_on_sale");
  return session;
}
async function createHold(q, userId, sessionId2, quantity, now) {
  const id = newId();
  const expires = new Date(now.getTime() + config.time.holdSeconds * 1e3);
  await q.query(
    "INSERT INTO holds (id, user_id, session_id, quantity, status, created_at, expires_at) VALUES ($1,$2,$3,$4,'active',$5,$6)",
    [id, userId, sessionId2, quantity, now, expires]
  );
  return { id, session_id: sessionId2, quantity, expires_at: expires, status: "active" };
}
route("POST", "/api/holds", BUYERS, async (ctx) => {
  const body = asObject(ctx.body);
  const result = await transaction(async (tx) => {
    const now = /* @__PURE__ */ new Date();
    const session = await lockForSale(tx, body.session_id, now);
    const quantity = intOrNull(body.quantity);
    const limit = HOLD_LIMIT[ctx.user.role];
    if (session.admission !== "seat") throw new FieldErrors({ session_id: "no_seats" });
    const remaining = await seatsRemaining(tx, session.id, now);
    const inRange = quantity !== null && quantity >= 1 && quantity <= limit;
    if (remaining === 0 || inRange && remaining < quantity) return { soldOut: remaining };
    if (!inRange) throw new FieldErrors({ quantity: "out_of_range" });
    const hold = await createHold(tx, ctx.user.id, session.id, quantity, now);
    return { hold, remaining: remaining - quantity };
  });
  if ("soldOut" in result) throw new ApiError(409, "sold_out", { seats_remaining: result.soldOut, waitlist: true });
  return ok({ ...holdView(result.hold), seats_remaining: result.remaining }, 201);
});
route("GET", "/api/holds", BUYERS, async (ctx) => {
  const rows = await db.all(
    "SELECT id, session_id, quantity, expires_at, status FROM holds WHERE user_id = $1 AND status = 'active' AND is_live(expires_at, $2) ORDER BY created_at",
    [ctx.user.id, /* @__PURE__ */ new Date()]
  );
  return ok({ holds: rows.map(holdView) });
});
route("DELETE", "/api/holds/:id", BUYERS, async (ctx) => {
  await transaction(async (tx) => {
    const now = /* @__PURE__ */ new Date();
    const hold = await tx.one("SELECT session_id FROM holds WHERE id = $1 AND user_id = $2", [ctx.params.id, ctx.user.id]);
    if (!hold) throw notFound();
    await settleSession(tx, hold.session_id, now);
    const released = await tx.query("UPDATE holds SET status = 'released' WHERE id = $1 AND status = 'active' RETURNING id", [ctx.params.id]);
    if (!released.rowCount) throw new ApiError(409, "hold_not_active");
    await settleSession(tx, hold.session_id, now);
  });
  return { status: 204 };
});
async function waitlistRows(q, userId) {
  return q.all(
    `SELECT w.id, w.session_id, s.title, w.status, w.offer_expires_at,
       (SELECT count(*) FROM waitlist_entries o WHERE o.session_id = w.session_id AND o.status = 'waiting' AND o.seq <= w.seq)::integer AS position
     FROM waitlist_entries w JOIN sessions s ON s.id = w.session_id WHERE w.user_id = $1 ORDER BY w.joined_at DESC`,
    [userId]
  );
}
route("POST", "/api/sessions/:id/waitlist", BUYERS, async (ctx) => {
  const entry = await transaction(async (tx) => {
    const now = /* @__PURE__ */ new Date();
    const session = await lockForSale(tx, ctx.params.id, now);
    if (session.admission !== "seat") throw new ApiError(409, "not_on_sale");
    const waiting = await tx.one("SELECT id FROM waitlist_entries WHERE session_id = $1 AND user_id = $2 AND status = 'waiting'", [session.id, ctx.user.id]);
    if (waiting) throw new ApiError(409, "already_waiting");
    if (await seatsRemaining(tx, session.id, now) > 0) throw new ApiError(409, "seats_available");
    const id = newId();
    await tx.query(
      "INSERT INTO waitlist_entries (id, user_id, session_id, status, joined_at) VALUES ($1, $2, $3, 'waiting', $4)",
      [id, ctx.user.id, session.id, now]
    );
    return (await waitlistRows(tx, ctx.user.id)).find((w) => w.id === id);
  });
  return ok({ id: entry.id, session_id: entry.session_id, position: entry.position, status: entry.status }, 201);
});
route("GET", "/api/waitlist", BUYERS, async (ctx) => {
  const now = /* @__PURE__ */ new Date();
  await transaction(async (tx) => {
    for (const s of await tx.all(
      "SELECT DISTINCT session_id FROM waitlist_entries WHERE user_id = $1 AND status = 'offered'",
      [ctx.user.id]
    )) {
      await settleSession(tx, s.session_id, now);
    }
  });
  const rows = await waitlistRows(db, ctx.user.id);
  return ok({
    entries: rows.map((w) => ({
      id: w.id,
      session_id: w.session_id,
      title: w.title,
      position: w.status === "waiting" ? w.position : null,
      status: w.status,
      offer_expires_at: w.status === "offered" ? isoOrNull(w.offer_expires_at) : null
    }))
  });
});
route("POST", "/api/waitlist/:id/claim", BUYERS, async (ctx) => {
  const hold = await transaction(async (tx) => {
    const now = /* @__PURE__ */ new Date();
    const entry = await tx.one("SELECT session_id FROM waitlist_entries WHERE id = $1 AND user_id = $2", [ctx.params.id, ctx.user.id]);
    if (!entry) throw notFound();
    await settleSession(tx, entry.session_id, now);
    const claimed = await tx.query(
      "UPDATE waitlist_entries SET status = 'claimed' WHERE id = $1 AND status = 'offered' AND is_live(offer_expires_at, $2) RETURNING id",
      [ctx.params.id, now]
    );
    if (claimed.rowCount) return createHold(tx, ctx.user.id, entry.session_id, 1, now);
    const after = await tx.one("SELECT status FROM waitlist_entries WHERE id = $1", [ctx.params.id]);
    if (after.status === "lapsed") return "lapsed";
    throw new ApiError(409, "no_offer");
  });
  if (hold === "lapsed") throw new ApiError(409, "offer_lapsed");
  return ok(holdView(hold), 201);
});
async function closeSessionSeats(q, sessionId2) {
  await q.query("UPDATE holds SET status = 'released' WHERE session_id = $1 AND status = 'active'", [sessionId2]);
  await q.query("UPDATE waitlist_entries SET status = 'closed' WHERE session_id = $1 AND status IN ('waiting', 'offered')", [sessionId2]);
}

// server/domain/refunds.ts
async function queueTask(q, kind, subjectId) {
  await q.query(
    "INSERT INTO payment_tasks (kind, subject_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (kind, subject_id) DO NOTHING",
    [kind, subjectId, /* @__PURE__ */ new Date()]
  );
}
async function runTask(tx, kind, subjectId) {
  if (kind === "credit_note") {
    await adjustCreditNote(tx, subjectId);
    await tx.query("UPDATE refunds SET status = 'completed', completed_at = $2 WHERE credit_note_id = $1", [subjectId, /* @__PURE__ */ new Date()]);
    return;
  }
  if (kind === "void") {
    const order = await tx.one("SELECT ref, kb_payment_id FROM orders WHERE id = $1", [subjectId]);
    const voided = await voidPayment(order.kb_payment_id, order.ref);
    await recordTransaction(tx, order.kb_payment_id, voided, { orderRef: order.ref });
    return;
  }
  const refund2 = await tx.one(
    "SELECT r.id, r.card_cents, o.ref, o.kb_payment_id FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.id = $1",
    [subjectId]
  );
  const tx2 = await refund(refund2.kb_payment_id, refund2.id, refund2.card_cents);
  await recordTransaction(tx, refund2.kb_payment_id, tx2, { orderRef: refund2.ref });
  await tx.query("UPDATE refunds SET status = 'completed', completed_at = $2 WHERE id = $1", [refund2.id, /* @__PURE__ */ new Date()]);
}
async function runOneTask(only) {
  return transaction(async (tx) => {
    const task = await tx.one(
      `SELECT id, kind, subject_id FROM payment_tasks WHERE done_at IS NULL AND ($1::text IS NULL OR (kind = $1 AND subject_id = $2))
       ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [only?.kind ?? null, only?.subjectId ?? null]
    );
    if (!task) return false;
    await tx.query("UPDATE payment_tasks SET attempts = attempts + 1 WHERE id = $1", [task.id]);
    await runTask(tx, task.kind, task.subject_id);
    await tx.query("UPDATE payment_tasks SET done_at = $2 WHERE id = $1", [task.id, /* @__PURE__ */ new Date()]);
    return true;
  });
}
async function paymentTaskSweep() {
  while (await runOneTask()) {
  }
}
async function tryNow(kind, subjectId) {
  await runOneTask({ kind, subjectId }).catch(() => false);
}
async function refundLines(tx, actor, affected, reason) {
  const order = await tx.one(
    "SELECT o.id, o.ref, o.voucher_code, o.organisation_id, o.kb_payment_id, u.email AS buyer_email FROM orders o JOIN users u ON u.id = o.buyer_id WHERE o.id = $1",
    [affected.orderId]
  );
  const tasks = [];
  const sold = affected.lines.filter((l) => !refusedMoves([l], "refunded").length);
  const pending = affected.lines.filter((l) => !sold.includes(l));
  if (sold.length) {
    await moveLines(tx, sold.map((l) => l.id), "refunded");
    await tx.query("UPDATE passes SET status = 'refunded' WHERE line_id = ANY($1) AND status = 'valid'", [sold.map((l) => l.id)]);
  }
  if (pending.length) await moveLines(tx, pending.map((l) => l.id), "voided");
  const card = sold.reduce((s, l) => s + l.charged_cents, 0);
  const voucher = affected.lines.reduce((s, l) => s + l.voucher_cents, 0);
  if (voucher > 0) await recordMovement(tx, "return", order.voucher_code, voucher, actor === "system" ? "system" : actor.email, order.ref);
  const id = newId();
  let creditNoteId = null;
  if (order.organisation_id !== null) {
    creditNoteId = await issueCreditNote(tx, order.id, sold);
    tasks.push(["credit_note", creditNoteId]);
  } else {
    await queueMail(tx, mails.refundNotice(order.buyer_email, order.ref, affected.lines, card, voucher, card === 0 && pending.length > 0));
    if (card > 0) tasks.push(["refund", id]);
  }
  const status = tasks.length ? "pending" : "completed";
  await tx.query(
    `INSERT INTO refunds (id, order_id, line_ids, card_cents, voucher_cents, credit_note_id, status, reason, created_at, completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, order.id, affected.lines.map((l) => l.id), card, voucher, creditNoteId, status, reason, /* @__PURE__ */ new Date(), status === "completed" ? /* @__PURE__ */ new Date() : null]
  );
  const stillPending = await tx.one("SELECT 1 FROM lines WHERE order_id = $1 AND state = 'proof_pending'", [order.id]);
  if (pending.length && !stillPending && order.kb_payment_id) tasks.push(["void", order.id]);
  for (const [kind, subject] of tasks) await queueTask(tx, kind, subject);
  return { refundId: id, tasks };
}
async function refundCancelledSession(tx, actor, sessionId2) {
  const lines = await tx.all(
    "SELECT id, order_id FROM lines WHERE session_id = $1 AND state IN ('captured', 'transferred', 'proof_pending') ORDER BY order_id, position",
    [sessionId2]
  );
  const orderIds = [...new Set(lines.map((l) => l.order_id))];
  const tasks = [];
  for (const orderId of orderIds) {
    await tx.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const own = (await linesOf(tx, [orderId])).filter((l) => lines.some((x) => x.id === l.id));
    tasks.push(...(await refundLines(tx, actor, { orderId, lines: own }, "Session cancelled")).tasks);
  }
  return { count: orderIds.length, tasks };
}
async function startTasks(tasks) {
  for (const [kind, subject] of tasks) await tryNow(kind, subject);
}
route("POST", "/api/finance/orders/:id/refunds", ["finance"], async (ctx) => {
  const body = asObject(ctx.body);
  const result = await transaction(async (tx) => {
    const order = await visibleOrder(tx, ctx.user, ctx.params.id, true);
    const lines = await linesOf(tx, [order.id]);
    const ids = Array.isArray(body.line_ids) ? [...new Set(body.line_ids.filter((x) => typeof x === "string"))] : [];
    const chosen = ids.map((id) => lines.find((l) => l.id === id));
    if (chosen.some((l) => !l)) throw notFound();
    const refusable = refusedMoves(chosen, "refunded");
    if (refusable.length) throw new ApiError(409, "line_not_refundable", { line_ids: refusable.map((l) => l.id) });
    const errors = {};
    if (!ids.length) errors.line_ids = "empty";
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!reason) errors.reason = "required";
    if (Object.keys(errors).length) throw new FieldErrors(errors);
    const done = await refundLines(tx, ctx.user, { orderId: order.id, lines: chosen }, reason);
    for (const sessionId2 of new Set(chosen.map((l) => l.session_id).filter((s) => !!s))) {
      await settleSession(tx, sessionId2, /* @__PURE__ */ new Date());
    }
    await audit(tx, ctx.user, "refund.started", { type: "refund", id: done.refundId }, { order_ref: order.ref, line_ids: ids, reason });
    return done;
  });
  await startTasks(result.tasks);
  const refund2 = await db.one(`${REFUND_SELECT} WHERE id = $1`, [result.refundId]);
  return ok(refundView(refund2), 201);
}, { idempotent: true });
route("GET", "/api/finance/refunds", ["finance"], async (ctx) => {
  const status = ctx.query.get("status");
  const rows = await db.all(`${REFUND_SELECT} WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 500`, [status]);
  return ok({ refunds: rows.map(refundView) });
});
route("GET", "/api/finance/orders", ["finance"], async (ctx) => {
  return ok({ orders: await orderViews(db, await searchOrders(db, (ctx.query.get("q") ?? "").trim())) });
});

// server/domain/stateMachine.ts
var MOVES = [
  { from: "draft", to: "review", by: ["curator", "artist"] },
  { from: "review", to: "draft", by: ["curator"] },
  { from: "review", to: "scheduled", by: ["curator"] },
  { from: "scheduled", to: "review", by: ["curator"] },
  { from: "scheduled", to: "published", by: ["system"] },
  { from: "scheduled", to: "cancelled", by: ["curator"] },
  { from: "published", to: "cancelled", by: ["curator"] }
];
var TABLE = { session: "sessions", entry: "entries" };
function mover(actor) {
  return actor.role === "curator" ? "curator" : "artist";
}
async function history(q, kind, id) {
  const rows = await q.all(
    "SELECT from_state, to_state, at, by FROM state_history WHERE item_kind = $1 AND item_id = $2 ORDER BY seq",
    [kind, id]
  );
  return rows.map((r) => ({ from: r.from_state, to: r.to_state, at: isoUtc(r.at), by: r.by }));
}
async function record(q, kind, id, from, to, at, by, note) {
  await q.query(
    "INSERT INTO state_history (item_kind, item_id, from_state, to_state, at, by, note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [kind, id, from, to, at, by, note]
  );
  const version = kind === "session" ? ", version = version + 1" : "";
  await q.query(`UPDATE ${TABLE[kind]} SET status = $2${version} WHERE id = $1`, [id, to]);
}
async function publishDue(q, now, only) {
  for (const kind of ["session", "entry"]) {
    if (only && only.kind !== kind) continue;
    const due = await q.all(
      `SELECT id, publish_at FROM ${TABLE[kind]} WHERE status = 'scheduled' AND publish_at <= $1 AND ($2::text IS NULL OR id = $2)
       FOR UPDATE SKIP LOCKED`,
      [now, only?.id ?? null]
    );
    for (const item of due) {
      await record(q, kind, item.id, "scheduled", "published", item.publish_at, "system", null);
      await audit(q, "system", `${kind}.published`, { type: kind, id: item.id }, { publish_at: isoUtc(item.publish_at) }, item.publish_at);
    }
  }
}
async function publishSweep() {
  await transaction((tx) => publishDue(tx, /* @__PURE__ */ new Date()));
}
async function move(q, kind, id, actor, request, hooks = {}) {
  const now = /* @__PURE__ */ new Date();
  await publishDue(q, now, { kind, id });
  const current = await q.one(`SELECT status FROM ${TABLE[kind]} WHERE id = $1`, [id]);
  if (!current) throw notFound();
  const to = typeof request.to === "string" ? request.to : "";
  const legal = MOVES.some((m) => m.from === current.status && m.to === to && m.by.includes(mover(actor)));
  if (!legal) throw new ApiError(409, "illegal_transition", { from: current.status, to });
  const errors = { ...await hooks.validate?.(to) };
  let publishAt = null;
  if (to === "scheduled") {
    if (request.publish_at === null || request.publish_at === void 0 || request.publish_at === "") errors.publish_at = "required";
    else {
      const parsed = parseWall(request.publish_at);
      if (!parsed.ok) errors.publish_at = "invalid";
      else if (parsed.instant <= now.getTime()) errors.publish_at = "not_in_future";
      else publishAt = new Date(parsed.instant);
    }
  }
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  const note = typeof request.note === "string" && request.note.trim() ? request.note.trim().slice(0, 1e3) : null;
  if (to !== "cancelled") await q.query(`UPDATE ${TABLE[kind]} SET publish_at = $2 WHERE id = $1`, [id, publishAt]);
  await record(q, kind, id, current.status, to, now, actor.email, note);
  const refunds = await hooks.apply?.(to) ?? 0;
  await audit(q, actor, `${kind}.moved`, { type: kind, id }, { from: current.status, to, note, refunds_started: refunds });
  return { refunds };
}

// server/domain/entries.ts
var IMAGE_LIMIT = 1e7;
var ENTRY_SELECT = `SELECT e.id, e.artist_id, u.name AS artist_name, e.title, e.statement, e.discipline, e.medium, e.year,
  effective_status(e.status, e.publish_at, $1) AS status, e.publish_at FROM entries e JOIN users u ON u.id = e.artist_id`;
async function entryViews(q, rows) {
  const images = await q.all(
    "SELECT id, entry_id, width, height FROM entry_images WHERE entry_id = ANY($1) ORDER BY created_at",
    [rows.map((r) => r.id)]
  );
  return rows.map((r) => ({
    id: r.id,
    artist_id: r.artist_id,
    artist_name: r.artist_name,
    title: r.title,
    statement: r.statement,
    discipline: r.discipline,
    medium: r.medium,
    year: r.year,
    status: r.status,
    publish_at: isoOrNull(r.publish_at),
    images: images.filter((i) => i.entry_id === r.id).map((i) => ({
      id: i.id,
      width: i.width,
      height: i.height,
      display_url: r.status === "published" ? `/api/media/artworks/${i.id}` : null
    }))
  }));
}
async function visibleEntry(q, ctx, lock = false) {
  const row = await q.one(`${ENTRY_SELECT} WHERE e.id = $2${lock ? " FOR UPDATE OF e" : ""}`, [/* @__PURE__ */ new Date(), ctx.params.id]);
  if (!row || ctx.user.role !== "curator" && row.artist_id !== ctx.user.id) throw notFound();
  return row;
}
async function readFields(q, input, base) {
  const merged = { ...base, ...input };
  const errors = {};
  const title = text(merged.title, 1, 200);
  if (!title) errors.title = "required";
  const statement = typeof merged.statement === "string" ? merged.statement.trim().slice(0, 4e3) : null;
  if (statement === null) errors.statement = "required";
  const discipline = typeof merged.discipline === "string" ? await q.one("SELECT id FROM disciplines WHERE id = $1", [merged.discipline]) : null;
  if (!discipline) errors.discipline = "unknown";
  const medium = text(merged.medium, 1, 200);
  if (!medium) errors.medium = "required";
  const year = typeof merged.year === "string" && /^\d{4}$/.test(merged.year) ? Number(merged.year) : intOrNull(merged.year);
  if (year === null || year < 1900 || year > 2100) errors.year = "out_of_range";
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  return { title, statement, discipline: merged.discipline, medium, year };
}
route("GET", "/api/entries", ["artist", "curator"], async (ctx) => {
  const rows = await db.all(
    `${ENTRY_SELECT} WHERE ($2::text IS NULL OR e.artist_id = $2) ORDER BY e.created_at DESC, e.id`,
    [/* @__PURE__ */ new Date(), ctx.user.role === "curator" ? null : ctx.user.id]
  );
  return ok({ entries: await entryViews(db, rows) });
});
route("POST", "/api/entries", ["artist"], async (ctx) => {
  const f = await readFields(db, asObject(ctx.body), {});
  const id = `e-${newId()}`;
  await db.query(
    "INSERT INTO entries (id, artist_id, title, statement, discipline, medium, year, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)",
    [id, ctx.user.id, f.title, f.statement, f.discipline, f.medium, f.year, /* @__PURE__ */ new Date()]
  );
  const row = await db.one(`${ENTRY_SELECT} WHERE e.id = $2`, [/* @__PURE__ */ new Date(), id]);
  return ok((await entryViews(db, [row]))[0], 201);
});
route("GET", "/api/entries/:id", ["artist", "curator"], async (ctx) => ok((await entryViews(db, [await visibleEntry(db, ctx)]))[0]));
function assertEditable(ctx, entry) {
  if (entry.artist_id !== ctx.user.id || entry.status !== "draft") throw new ApiError(409, "not_editable");
}
route("PATCH", "/api/entries/:id", ["artist"], async (ctx) => {
  const view = await transaction(async (tx) => {
    const entry = await visibleEntry(tx, ctx, true);
    assertEditable(ctx, entry);
    const f = await readFields(tx, asObject(ctx.body), entry);
    await tx.query("UPDATE entries SET title=$2, statement=$3, discipline=$4, medium=$5, year=$6 WHERE id = $1", [entry.id, f.title, f.statement, f.discipline, f.medium, f.year]);
    return (await entryViews(tx, [await tx.one(`${ENTRY_SELECT} WHERE e.id = $2`, [/* @__PURE__ */ new Date(), entry.id])]))[0];
  });
  return ok(view);
});
route("POST", "/api/entries/:id/images", ["artist"], async (ctx) => {
  const image = await transaction(async (tx) => {
    const entry = await visibleEntry(tx, ctx, true);
    assertEditable(ctx, entry);
    const checked = checkUpload(ctx.upload.file, ["image/jpeg", "image/png", "image/webp"]);
    if ("error" in checked) throw new FieldErrors({ file: checked.error });
    const pixels = decodeImage(checked.file.data, checked.type);
    const id = newId();
    await putAll([
      { key: objectKeys.artworkOriginal(entry.id, id), body: checked.file.data, contentType: checked.type },
      { key: objectKeys.artworkDisplay(entry.id, id), body: displayJpeg(pixels), contentType: "image/jpeg" }
    ]);
    await tx.query(
      "INSERT INTO entry_images (id, entry_id, width, height, content_type, size_bytes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, entry.id, pixels.width, pixels.height, checked.type, checked.file.data.length, /* @__PURE__ */ new Date()]
    );
    return { id, width: pixels.width, height: pixels.height, display_url: null };
  });
  return ok({ image }, 201);
}, { multipartLimit: IMAGE_LIMIT });
route("POST", "/api/entries/:id/images/:imageId/read", ["artist", "curator"], async (ctx) => {
  const entry = await visibleEntry(db, ctx);
  const image = await db.one("SELECT id FROM entry_images WHERE id = $1 AND entry_id = $2", [ctx.params.imageId, entry.id]);
  if (!image) throw notFound();
  return ok(await signedLink({ kind: "artwork", id: ctx.params.imageId }));
});
route("POST", "/api/entries/:id/transitions", ["artist", "curator"], async (ctx) => {
  const body = asObject(ctx.body);
  const result = await transaction(async (tx) => {
    const entry = await visibleEntry(tx, ctx, true);
    await move(tx, "entry", entry.id, ctx.user, { to: body.to, note: body.note, publish_at: body.publish_at }, {
      validate: async (to) => {
        if (to !== "review" || entry.status !== "draft") return {};
        const images = await tx.one("SELECT 1 FROM entry_images WHERE entry_id = $1", [entry.id]);
        return images ? {} : { images: "required" };
      }
    });
    const row = await tx.one(`${ENTRY_SELECT} WHERE e.id = $2`, [/* @__PURE__ */ new Date(), entry.id]);
    return { entry: (await entryViews(tx, [row]))[0], history: await history(tx, "entry", entry.id) };
  });
  return ok(result);
});
route("GET", "/api/gallery", "public", async () => {
  const rows = await db.all(`${ENTRY_SELECT} WHERE effective_status(e.status, e.publish_at, $1) = 'published' ORDER BY e.created_at, e.id`, [/* @__PURE__ */ new Date()]);
  return ok({ entries: await entryViews(db, rows) });
});
route("GET", "/api/media/artworks/:imageId", "public", async (ctx) => {
  const image = await db.one(
    `SELECT i.id, i.entry_id FROM entry_images i JOIN entries e ON e.id = i.entry_id
     WHERE i.id = $1 AND effective_status(e.status, e.publish_at, $2) = 'published'`,
    [ctx.params.imageId, /* @__PURE__ */ new Date()]
  );
  if (!image) throw notFound();
  const bytes = await getObject(objectKeys.artworkDisplay(image.entry_id, image.id));
  return { status: 200, bytes, contentType: "image/jpeg", headers: { "Cache-Control": "public, max-age=300" } };
});
async function artworkOriginalBytes(imageId) {
  const image = await db.one("SELECT entry_id, content_type FROM entry_images WHERE id = $1", [imageId]);
  return image ? { bytes: await getObject(objectKeys.artworkOriginal(image.entry_id, imageId)), contentType: image.content_type } : null;
}

// server/domain/signedLinks.ts
async function signedLink(target2) {
  if (!await storageUp()) throw new ServiceDown("minio");
  const expires = Date.now() + config.time.signedReadSeconds * 1e3;
  const payload = Buffer.from(JSON.stringify({ k: target2.kind, i: target2.id, e: expires })).toString("base64url");
  return { url: `/api/files/${payload}.${sign(payload)}`, expires_at: isoUtc(expires) };
}
route("GET", "/api/files/:token", "public", async (ctx) => {
  const [payload, signature] = ctx.params.token.split(".");
  if (!payload || !signature || !signatureMatches(payload, signature)) throw notFound();
  const target2 = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (Date.now() >= target2.e) throw new ApiError(410, "link_expired");
  const file = target2.k === "proof" ? await proofBytes(target2.i) : await artworkOriginalBytes(target2.i);
  if (!file) throw notFound();
  return { status: 200, bytes: file.bytes, contentType: file.contentType, headers: { "Cache-Control": "no-store", "Content-Disposition": "inline" } };
});

// server/domain/proofs.ts
var PROOF_LIMIT = 5e6;
var KINDS = ["student", "jobseeker"];
var PROOF_SELECT = `SELECT p.id, p.order_id, o.ref AS order_ref, p.kind, p.status, p.uploaded_at, o.proof_deadline AS deadline, p.content_type,
  p.size_bytes, u.name AS buyer_name FROM proofs p JOIN orders o ON o.id = p.order_id JOIN users u ON u.id = o.buyer_id`;
function proofView(p) {
  return {
    id: p.id,
    order_id: p.order_id,
    order_ref: p.order_ref,
    kind: p.kind,
    status: p.status,
    uploaded_at: isoUtc(p.uploaded_at),
    deadline: isoUtc(p.deadline),
    content_type: p.content_type,
    size_bytes: p.size_bytes
  };
}
route("POST", "/api/orders/:id/proof", ["visitor"], async (ctx) => {
  const order = await visibleOrder(db, ctx.user, ctx.params.id);
  const proof = await transaction(async (tx) => {
    const lines = await linesOf(tx, [order.id]);
    if (!lines.some((l) => l.state === "proof_pending")) throw new ApiError(409, "not_proof_pending");
    if (await tx.one("SELECT 1 FROM proofs WHERE order_id = $1 FOR UPDATE", [order.id])) throw new ApiError(409, "proof_already_uploaded");
    const checked = checkUpload(ctx.upload.file, ["application/pdf", "image/jpeg", "image/png"]);
    const errors = {};
    if ("error" in checked) errors.file = checked.error;
    if (!KINDS.includes(ctx.upload.fields.kind ?? "")) errors.kind = "unknown";
    if (Object.keys(errors).length || "error" in checked) throw new FieldErrors(errors);
    const id = newId();
    await tx.query(
      "INSERT INTO proofs (id, order_id, kind, status, uploaded_at, content_type, size_bytes) VALUES ($1,$2,$3,'pending',$4,$5,$6)",
      [id, order.id, ctx.upload.fields.kind, /* @__PURE__ */ new Date(), checked.type, checked.file.data.length]
    );
    await putObject(objectKeys.proof(order.ref, id), checked.file.data, checked.type);
    return await tx.one(`${PROOF_SELECT} WHERE p.id = $1`, [id]);
  });
  return ok(proofView(proof), 201);
}, { multipartLimit: PROOF_LIMIT });
route("GET", "/api/box-office/proofs", ["box_office"], async (ctx) => {
  const status = ctx.query.get("status");
  const rows = await db.all(`${PROOF_SELECT} WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.uploaded_at`, [status]);
  return ok({ proofs: rows.map((p) => ({ ...proofView(p), buyer_name: p.buyer_name })) });
});
route("POST", "/api/box-office/proofs/:id/read", ["box_office"], async (ctx) => {
  const proof = await db.one(`${PROOF_SELECT} WHERE p.id = $1`, [ctx.params.id]);
  if (!proof) throw notFound();
  return ok(await signedLink({ kind: "proof", id: proof.id }));
});
async function decisionOpen(q, orderId) {
  return (await q.one("SELECT is_live(proof_deadline, $2) AS live FROM orders WHERE id = $1", [orderId, /* @__PURE__ */ new Date()])).live;
}
route("POST", "/api/box-office/proofs/:id/decision", ["box_office"], async (ctx) => {
  const body = asObject(ctx.body);
  const stored = [];
  try {
    const result = await transaction(async (tx) => {
      const proof2 = await tx.one(`${PROOF_SELECT} WHERE p.id = $1 FOR UPDATE OF p, o`, [ctx.params.id]);
      if (!proof2) throw notFound();
      if (proof2.status === "expired" || proof2.status === "pending" && !await decisionOpen(tx, proof2.order_id)) {
        throw new ApiError(409, "proof_hold_expired");
      }
      if (proof2.status !== "pending") throw new ApiError(409, "already_decided");
      const decision = body.decision;
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1e3) : "";
      if (decision !== "approve" && decision !== "reject") throw new FieldErrors({ decision: "unknown" });
      if (decision === "reject" && !reason) throw new FieldErrors({ reason: "required" });
      const order = await tx.one(
        "SELECT o.id, o.ref, o.kb_payment_id, o.voucher_code, u.email AS buyer_email FROM orders o JOIN users u ON u.id = o.buyer_id WHERE o.id = $1",
        [proof2.order_id]
      );
      const pending = (await linesOf(tx, [order.id])).filter((l) => l.state === "proof_pending");
      const now = /* @__PURE__ */ new Date();
      if (decision === "approve") {
        const codes = pending.map(() => newPassCode());
        const documents = await Promise.all(pending.map((l, i) => passDocument(tx, l, codes[i])));
        const objects = pending.map((_, i) => ({ key: objectKeys.pass(order.ref, codes[i]), body: documents[i], contentType: "application/pdf" }));
        await putAll(objects);
        stored.push(...objects.map((o) => o.key));
        const amount = pending.reduce((s, l) => s + l.charged_cents, 0);
        if (amount > 0 && order.kb_payment_id) {
          const captured = await capture(order.kb_payment_id, order.ref, amount);
          await recordTransaction(tx, order.kb_payment_id, captured, { orderRef: order.ref });
        }
        await moveLines(tx, pending.map((l) => l.id), "captured");
        for (const [i, l] of pending.entries()) await tx.query("INSERT INTO passes (code, line_id, status, created_at) VALUES ($1, $2, 'valid', $3)", [codes[i], l.id, now]);
        await queueMail(tx, mails.proofApproved(order.buyer_email, order.ref, documents.map((content, i) => ({ filename: `${codes[i]}.pdf`, content }))));
      } else {
        if (order.kb_payment_id) {
          const voided = await voidPayment(order.kb_payment_id, order.ref);
          await recordTransaction(tx, order.kb_payment_id, voided, { orderRef: order.ref });
        }
        await moveLines(tx, pending.map((l) => l.id), "voided");
        const voucher = pending.reduce((s, l) => s + l.voucher_cents, 0);
        if (voucher > 0) await recordMovement(tx, "return", order.voucher_code, voucher, ctx.user.email, order.ref);
        await queueMail(tx, mails.proofRejected(order.buyer_email, order.ref, reason));
        for (const sessionId2 of new Set(pending.map((l) => l.session_id).filter((s) => !!s))) await settleSession(tx, sessionId2, now);
      }
      await tx.query(
        "UPDATE proofs SET status = $2, decided_at = $3, decided_by = $4, reason = $5 WHERE id = $1",
        [proof2.id, decision === "approve" ? "approved" : "rejected", now, ctx.user.email, reason || null]
      );
      await audit(tx, ctx.user, decision === "approve" ? "proof.approved" : "proof.rejected", { type: "proof", id: proof2.id }, { order_ref: order.ref, reason: reason || null });
      return { proofId: proof2.id, orderId: order.id };
    });
    const proof = await db.one(`${PROOF_SELECT} WHERE p.id = $1`, [result.proofId]);
    return ok({ proof: proofView(proof), order: await orderView(db, result.orderId) });
  } catch (error) {
    await removeAll(stored);
    throw error;
  }
});
async function proofLapseSweep() {
  for (; ; ) {
    const handled = await transaction(async (tx) => {
      const now = /* @__PURE__ */ new Date();
      const order = await tx.one(
        `SELECT o.id, o.ref, o.voucher_code, o.kb_payment_id, u.email AS buyer_email FROM orders o JOIN users u ON u.id = o.buyer_id
         WHERE NOT is_live(o.proof_deadline, $1) AND EXISTS (SELECT 1 FROM lines l WHERE l.order_id = o.id AND l.state = 'proof_pending')
         LIMIT 1 FOR UPDATE OF o SKIP LOCKED`,
        [now]
      );
      if (!order) return false;
      const pending = (await linesOf(tx, [order.id])).filter((l) => l.state === "proof_pending");
      await moveLines(tx, pending.map((l) => l.id), "expired");
      const voucher = pending.reduce((s, l) => s + l.voucher_cents, 0);
      if (voucher > 0) await recordMovement(tx, "return", order.voucher_code, voucher, "system", order.ref);
      await tx.query("UPDATE proofs SET status = 'expired' WHERE order_id = $1 AND status = 'pending'", [order.id]);
      if (order.kb_payment_id) await queueTask(tx, "void", order.id);
      await queueMail(tx, mails.proofLapsed(order.buyer_email, order.ref));
      await audit(tx, "system", "proof.lapsed", { type: "order", id: order.id }, { order_ref: order.ref });
      for (const sessionId2 of new Set(pending.map((l) => l.session_id).filter((s) => !!s))) await settleSession(tx, sessionId2, now);
      return true;
    });
    if (!handled) return;
  }
}
async function proofBytes(id) {
  const proof = await db.one(`${PROOF_SELECT} WHERE p.id = $1`, [id]);
  return proof ? { bytes: await getObject(objectKeys.proof(proof.order_ref, id)), contentType: proof.content_type } : null;
}

// server/worker.ts
var STEPS = [
  ["publish", publishSweep],
  ["seats", settleDueSessions],
  ["proof lapses", proofLapseSweep],
  ["payment tasks", paymentTaskSweep],
  ["invoices", invoiceSweep],
  ["outbox", deliverOutbox]
];
var PERIOD_MS = 1e3;
var KEY_CLEANUP_EVERY = 3600;
var running = false;
var passes = 0;
async function pass() {
  if (running) return;
  running = true;
  try {
    for (const [name, step] of STEPS) {
      await step().catch((error) => console.error(`[worker] ${name}: ${error instanceof Error ? error.message : String(error)}`));
    }
    if (++passes % KEY_CLEANUP_EVERY === 0) await forgetOldKeys().catch(() => void 0);
  } finally {
    running = false;
  }
}
function startWorker() {
  setInterval(() => void pass(), PERIOD_MS).unref();
}
function kick() {
  void pass();
}

// server/domain/accounts.ts
var userView = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, organisation_id: u.organisation_id });
function passwordError(value) {
  return typeof value === "string" && value.length >= 10 && value.length <= 200 ? null : "length";
}
route("POST", "/api/auth/register", "public", async (ctx) => {
  const body = asObject(ctx.body);
  const name = text(body.name, 1, 200);
  const address = email(body.email);
  if (address && await db.one("SELECT 1 FROM users WHERE email = $1", [address])) throw new ApiError(409, "email_taken");
  const errors = {};
  if (!name) errors.name = "required";
  if (!address) errors.email = "invalid";
  const bad = passwordError(body.password);
  if (bad) errors.password = bad;
  if (Object.keys(errors).length) throw new FieldErrors(errors);
  const user = { id: newId(), email: address, name, role: "visitor", organisation_id: null };
  const inserted = await db.query(
    "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,'visitor') ON CONFLICT (email) DO NOTHING",
    [user.id, user.email, user.name, await hashPassword(body.password)]
  );
  if (!inserted.rowCount) throw new ApiError(409, "email_taken");
  return { status: 201, body: { user: userView(user) }, headers: { "Set-Cookie": await startLoginSession(user.id) } };
});
route("POST", "/api/auth/signin", "public", async (ctx) => {
  const body = asObject(ctx.body);
  const address = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const row = await db.one("SELECT id, email, name, role, organisation_id, password_hash FROM users WHERE email = $1", [address]);
  if (!row || typeof body.password !== "string" || !await passwordMatches(body.password, row.password_hash)) throw new ApiError(401, "invalid_credentials");
  return { status: 200, body: { user: userView(row) }, headers: { "Set-Cookie": await startLoginSession(row.id) } };
});
route("POST", "/api/auth/signout", "public", async (ctx) => ({ status: 204, headers: { "Set-Cookie": await endLoginSession(ctx.headers.cookie) } }));
route("GET", "/api/me", "signed-in", async (ctx) => ok({ user: userView(ctx.user) }));

// server/domain/admin.ts
var ADMIN = ["admin"];
route("GET", "/api/admin/staff", ADMIN, async () => {
  const users = await db.all("SELECT id, email, name, role, organisation_id FROM users WHERE role <> 'visitor' ORDER BY role, name");
  return ok({ users: users.map(userView) });
});
async function organisationFor(role, value) {
  if (role !== "group_booker") return null;
  if (typeof value !== "string" || !value) throw new FieldErrors({ organisation_id: "required" });
  if (!await db.one("SELECT id FROM organisations WHERE id = $1", [value])) throw notFound();
  return value;
}
var isRole = (value) => typeof value === "string" && ROLES.includes(value);
route("POST", "/api/admin/staff", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const address = email(body.email);
  if (address && await db.one("SELECT 1 FROM users WHERE email = $1", [address])) throw new ApiError(409, "email_taken");
  const errors = {};
  const name = text(body.name, 1, 200);
  if (!name) errors.name = "required";
  if (!address) errors.email = "invalid";
  const bad = passwordError(body.password);
  if (bad) errors.password = bad;
  if (!isRole(body.role)) errors.role = "unknown";
  check(errors);
  const role = body.role;
  const organisation = await organisationFor(role, body.organisation_id);
  const user = { id: newId(), email: address, name, role, organisation_id: organisation };
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO users (id, email, name, password_hash, role, organisation_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [user.id, user.email, user.name, await hashPassword(body.password), role, organisation]
    );
    await audit(tx, ctx.user, "staff.added", { type: "user", id: user.id }, { email: user.email, role });
  });
  return ok(userView(user), 201);
});
route("PATCH", "/api/admin/staff/:id", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const updated = await transaction(async (tx) => {
    await tx.query("SELECT id FROM users WHERE role = 'admin' FOR UPDATE");
    const user = await tx.one("SELECT id, email, name, role, organisation_id FROM users WHERE id = $1", [ctx.params.id]);
    if (!user) throw notFound();
    const admins = (await tx.one("SELECT count(*)::integer AS n FROM users WHERE role = 'admin'")).n;
    if (user.role === "admin" && body.role !== "admin" && admins <= 1) throw new ApiError(409, "last_admin");
    if (!isRole(body.role)) throw new FieldErrors({ role: "unknown" });
    const organisation = await organisationFor(body.role, body.organisation_id);
    await tx.query("UPDATE users SET role = $2, organisation_id = $3 WHERE id = $1", [user.id, body.role, organisation]);
    await audit(tx, ctx.user, "staff.role_changed", { type: "user", id: user.id }, { from: user.role, to: body.role });
    return { ...user, role: body.role, organisation_id: organisation };
  });
  return ok(userView(updated));
});
var SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
route("GET", "/api/admin/venues", ADMIN, async () => ok({ venues: await db.all("SELECT id, name FROM venues ORDER BY position, id") }));
route("POST", "/api/admin/venues", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (SLUG_RE.test(id) && await db.one("SELECT 1 FROM venues WHERE id = $1", [id])) throw new ApiError(409, "venue_exists");
  const name = text(body.name, 1, 200);
  const errors = {};
  if (!SLUG_RE.test(id) || id.length > 60) errors.id = "invalid";
  if (!name) errors.name = "required";
  check(errors);
  await transaction(async (tx) => {
    await tx.query("INSERT INTO venues (id, name, position) VALUES ($1, $2, (SELECT COALESCE(max(position), 0) + 1 FROM venues))", [id, name]);
    await audit(tx, ctx.user, "venue.added", { type: "venue", id }, { name });
  });
  return ok({ id, name }, 201);
});
route("PATCH", "/api/admin/venues/:id", ADMIN, async (ctx) => {
  const name = text(asObject(ctx.body).name, 1, 200);
  const venue = await transaction(async (tx) => {
    const row = await tx.one("SELECT id FROM venues WHERE id = $1 FOR UPDATE", [ctx.params.id]);
    if (!row) throw notFound();
    if (!name) throw new FieldErrors({ name: "required" });
    await tx.query("UPDATE venues SET name = $2 WHERE id = $1", [row.id, name]);
    await audit(tx, ctx.user, "venue.renamed", { type: "venue", id: row.id }, { name });
    return { id: row.id, name };
  });
  return ok(venue);
});
route("GET", "/api/admin/edition", ADMIN, async () => ok(await edition()));
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
route("PUT", "/api/admin/edition", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const saved = await transaction(async (tx) => {
    const current = await edition(tx);
    const next = {
      name: text(body.name, 1, 200) ?? current.name,
      first_day: typeof body.first_day === "string" && DATE_RE.test(body.first_day) ? body.first_day : null,
      last_day: typeof body.last_day === "string" && DATE_RE.test(body.last_day) ? body.last_day : null
    };
    if (next.first_day && next.last_day) {
      const sessions = await tx.all("SELECT starts_at FROM sessions");
      if (sessions.some((s) => !withinEdition({ ...next, first_day: next.first_day, last_day: next.last_day }, s.starts_at))) {
        throw new ApiError(409, "sessions_outside_edition");
      }
    }
    const errors = {};
    if (!next.first_day) errors.first_day = "invalid";
    if (!next.last_day) errors.last_day = "invalid";
    else if (next.first_day && next.last_day < next.first_day) errors.last_day = "before_first_day";
    check(errors);
    await tx.query("UPDATE edition SET name = $1, first_day = $2, last_day = $3 WHERE id = 1", [next.name, next.first_day, next.last_day]);
    await audit(tx, ctx.user, "edition.saved", { type: "edition", id: "1" }, next);
    return next;
  });
  return ok(saved);
});
var POLICY_FIELDS = ["full_festival_full_cents", "full_festival_reduced_cents", "day_full_cents", "day_reduced_cents", "group_discount_percent"];
route("GET", "/api/admin/price-policy", ADMIN, async () => ok(await db.one(`SELECT ${POLICY_FIELDS.join(", ")}, version FROM price_policy WHERE id = 1`)));
route("PUT", "/api/admin/price-policy", ADMIN, async (ctx) => {
  const body = asObject(ctx.body);
  const saved = await transaction(async (tx) => {
    const current = await tx.one("SELECT version FROM price_policy WHERE id = 1 FOR UPDATE");
    const ifMatch = ctx.headers["if-match"];
    if (typeof ifMatch !== "string" || !ifMatch.trim()) throw new ApiError(428, "version_required");
    if (Number(ifMatch.replace(/"/g, "")) !== current.version) throw new ApiError(412, "stale_version", { current_version: current.version });
    const errors = {};
    const values = POLICY_FIELDS.map((field) => {
      const value = intOrNull(body[field]);
      const max = field === "group_discount_percent" ? 50 : 1e5;
      if (value === null || value < 0 || value > max) errors[field] = "out_of_range";
      return value;
    });
    check(errors);
    const row = await tx.one(
      `UPDATE price_policy SET ${POLICY_FIELDS.map((f, i) => `${f} = $${i + 1}`).join(", ")}, version = version + 1 WHERE id = 1
       RETURNING ${POLICY_FIELDS.join(", ")}, version`,
      values
    );
    await audit(tx, ctx.user, "price_policy.saved", { type: "price_policy", id: "1" }, Object.fromEntries(POLICY_FIELDS.map((f, i) => [f, values[i]])));
    return row;
  });
  return ok(saved);
});

// shared/allocation.ts
function allocate(total2, weights) {
  const whole = weights.reduce((sum, w) => sum + w, 0);
  if (total2 === 0 || whole === 0) return weights.map(() => 0);
  const shares = weights.map((w) => Math.floor(total2 * w / whole));
  const remainders = weights.map((w) => total2 * w % whole);
  let left = total2 - shares.reduce((sum, s) => sum + s, 0);
  const order = weights.map((_, i) => i).sort((a, b) => remainders[b] - remainders[a] || a - b);
  for (const i of order) {
    if (left === 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}
function groupDiscount(subtotal, percent) {
  return Math.floor((subtotal * percent + 50) / 100);
}
function priceOrder(listPrices, groupPercent, voucherBalance) {
  const subtotal = listPrices.reduce((sum, p) => sum + p, 0);
  const discount = groupPercent === null ? 0 : groupDiscount(subtotal, groupPercent);
  const discounts = allocate(discount, listPrices);
  const afterDiscount = listPrices.map((p, i) => p - discounts[i]);
  const voucher = Math.min(Math.max(voucherBalance, 0), subtotal - discount);
  const vouchers = allocate(voucher, afterDiscount);
  const lines = listPrices.map((p, i) => ({
    list_cents: p,
    group_discount_cents: discounts[i],
    voucher_cents: vouchers[i],
    charged_cents: afterDiscount[i] - vouchers[i]
  }));
  return { lines, subtotal_cents: subtotal, group_discount_cents: discount, voucher_cents: voucher, total_cents: subtotal - discount - voucher };
}

// server/domain/checkout.ts
var GROUP_MINIMUM = 5;
var PASS_LIMIT = { visitor: 10, group_booker: 30 };
function readPasses(value) {
  if (value === void 0 || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const item of value) {
    if (item && typeof item === "object" && item.product === "full_festival") out.push({ product: "full_festival" });
    else if (item && typeof item === "object" && item.product === "day") {
      const day = item.festival_day;
      out.push({ product: "day", festival_day: typeof day === "string" ? day : "" });
    } else return null;
  }
  return out;
}
async function voidAuthorisation(auth, ref) {
  const voided = await voidPayment(auth.paymentId, ref);
  await recordTransaction(db, auth.paymentId, auth.tx, { orderRef: ref });
  await recordTransaction(db, auth.paymentId, voided, { orderRef: ref });
}
async function checkout(ctx) {
  const user = ctx.user;
  const group = user.role === "group_booker";
  const body = asObject(ctx.body);
  const holdIds = body.hold_ids === void 0 || body.hold_ids === null ? [] : Array.isArray(body.hold_ids) && body.hold_ids.every((h) => typeof h === "string") ? [...new Set(body.hold_ids)] : null;
  const passes2 = readPasses(body.passes);
  const now = /* @__PURE__ */ new Date();
  const undo = [];
  try {
    const orderId = await transaction(async (tx) => {
      const holds = holdIds?.length ? await tx.all(
        `SELECT h.id, h.session_id, h.quantity, h.status, is_live(h.expires_at, $3) AS live,
           effective_status(s.status, s.publish_at, $3) AS session_status, s.title, s.price_full_cents, s.price_reduced_cents
         FROM holds h JOIN sessions s ON s.id = h.session_id WHERE h.id = ANY($1) AND h.user_id = $2 FOR UPDATE OF h`,
        [holdIds, user.id, now]
      ) : [];
      if (holdIds && holds.length !== holdIds.length) throw notFound();
      const ordered = (holdIds ?? []).map((id2) => holds.find((h) => h.id === id2));
      const lapsed = ordered.filter((h) => h.status !== "active" || !h.live).map((h) => h.id);
      if (lapsed.length) throw new ApiError(409, "hold_expired", { hold_ids: lapsed });
      if (ordered.some((h) => h.session_status === "cancelled")) throw new ApiError(409, "session_cancelled");
      const errors = {};
      const days = festivalDays(await edition(tx)).map((d) => d.date);
      const rate = body.rate === "reduced" ? "reduced" : body.rate === "full" || body.rate === void 0 ? "full" : null;
      if (holdIds === null) errors.hold_ids = "invalid";
      if (passes2 === null) errors.passes = "invalid";
      else if (passes2.some((p) => p.product === "day" && !days.includes(p.festival_day))) errors.passes = "unknown_festival_day";
      else if (passes2.length > PASS_LIMIT[group ? "group_booker" : "visitor"]) errors.passes = "too_many";
      const seatCount = ordered.reduce((n, h) => n + h.quantity, 0);
      const lineCount = seatCount + (passes2?.length ?? 0);
      if (lineCount === 0 && holdIds !== null && passes2 !== null) errors.items = "empty";
      else if (group && lineCount < GROUP_MINIMUM) errors.items = "group_minimum";
      if (rate === null) errors.rate = "invalid";
      else if (group && rate === "reduced") errors.rate = "not_for_groups";
      let names = [];
      if (group) {
        const given = body.attendee_names;
        if (!Array.isArray(given) || given.length !== lineCount) errors.attendee_names = "count_mismatch";
        else if (given.some((n) => typeof n !== "string" || !n.trim())) errors.attendee_names = "blank";
        else names = given.map((n) => n.trim().slice(0, 200));
      }
      const code2 = typeof body.voucher_code === "string" && body.voucher_code.trim() ? body.voucher_code.trim().toUpperCase() : null;
      const voucher = code2 ? await lockVoucher(tx, code2) : null;
      if (code2 && !voucher) errors.voucher_code = "unknown";
      else if (voucher && voucher.balance <= 0) errors.voucher_code = "empty";
      if (Object.keys(errors).length) throw new FieldErrors(errors);
      const policy = await tx.one(
        "SELECT * FROM price_policy WHERE id = 1"
      );
      const reduced = rate === "reduced";
      const draft = [];
      for (const h of ordered) {
        for (let i = 0; i < h.quantity; i++) {
          draft.push({
            id: newId(),
            position: draft.length + 1,
            kind: "seat",
            session_id: h.session_id,
            festival_day: null,
            title: h.title,
            holder_name: "",
            list_cents: reduced ? h.price_reduced_cents : h.price_full_cents
          });
        }
      }
      for (const p of passes2) {
        draft.push(p.product === "full_festival" ? {
          id: newId(),
          position: draft.length + 1,
          kind: "full_festival",
          session_id: null,
          festival_day: null,
          title: "Full-festival pass",
          holder_name: "",
          list_cents: reduced ? policy.full_festival_reduced_cents : policy.full_festival_full_cents
        } : {
          id: newId(),
          position: draft.length + 1,
          kind: "day",
          session_id: null,
          festival_day: p.festival_day,
          title: `Day pass \u2014 ${dayLabel(p.festival_day)}`,
          holder_name: "",
          list_cents: reduced ? policy.day_reduced_cents : policy.day_full_cents
        });
      }
      draft.forEach((l, i) => {
        l.holder_name = group ? names[i] : user.name;
      });
      const priced = priceOrder(draft.map((l) => l.list_cents), group ? policy.group_discount_percent : null, voucher?.balance ?? 0);
      const id = newId();
      const ref = newOrderRef();
      const deadline = reduced ? new Date(now.getTime() + config.time.proofDecisionSeconds * 1e3) : null;
      await tx.query(
        "INSERT INTO orders (id, ref, buyer_id, organisation_id, rate, voucher_code, proof_deadline, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, ref, user.id, group ? user.organisation_id : null, rate, voucher && priced.voucher_cents > 0 ? voucher.code : null, deadline, now]
      );
      for (const [i, l] of draft.entries()) {
        const p = priced.lines[i];
        await tx.query(
          `INSERT INTO lines (id, order_id, position, kind, session_id, festival_day, title, holder_name, state, list_cents,
          group_discount_cents, voucher_cents, charged_cents) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'authorised',$9,$10,$11,$12)`,
          [l.id, id, l.position, l.kind, l.session_id, l.festival_day, l.title, l.holder_name, p.list_cents, p.group_discount_cents, p.voucher_cents, p.charged_cents]
        );
      }
      await tx.query("UPDATE holds SET status = 'converted' WHERE id = ANY($1)", [holdIds ?? []]);
      if (voucher && priced.voucher_cents > 0) await recordMovement(tx, "redeem", voucher.code, priced.voucher_cents, user.email, ref);
      const mailLines = draft.map((l, i) => ({ ...l, ...priced.lines[i] }));
      const lineIds = draft.map((l) => l.id);
      if (reduced) {
        if (priced.total_cents > 0) {
          const account = await accountFor(`kerf-user-${user.id}`, user.name, user.email);
          const auth = await authorize(account, ref, priced.total_cents);
          undo.push(() => voidAuthorisation(auth, ref));
          await tx.query("UPDATE orders SET kb_payment_id = $2 WHERE id = $1", [id, auth.paymentId]);
          await recordTransaction(tx, auth.paymentId, auth.tx, { orderRef: ref });
        }
        await moveLines(tx, lineIds, "proof_pending");
        const mailId2 = await queueMail(tx, mails.orderReceivedReduced(user.email, ref, id, mailLines, deadline));
        await tx.query("UPDATE orders SET confirmation_outbox_id = $2 WHERE id = $1", [id, mailId2]);
        return id;
      }
      const codes = draft.map(() => newPassCode());
      const documents = await Promise.all(draft.map((l, i) => passDocument(tx, l, codes[i])));
      const objects = draft.map((_, i) => ({ key: objectKeys.pass(ref, codes[i]), body: documents[i], contentType: "application/pdf" }));
      await putAll(objects);
      undo.push(() => removeAll(objects.map((o) => o.key)));
      for (const [i, l] of draft.entries()) {
        await tx.query("INSERT INTO passes (code, line_id, status, created_at) VALUES ($1, $2, 'valid', $3)", [codes[i], l.id, now]);
      }
      if (group) {
        await issueInvoice(tx, { orderId: id, ref, booker: user, lines: mailLines, totalCents: priced.total_cents, undo });
      } else if (priced.total_cents > 0) {
        const account = await accountFor(`kerf-user-${user.id}`, user.name, user.email);
        const auth = await authorize(account, ref, priced.total_cents);
        undo.push(() => voidAuthorisation(auth, ref));
        await recordTransaction(tx, auth.paymentId, auth.tx, { orderRef: ref });
        const captured = await capture(auth.paymentId, ref, priced.total_cents);
        await recordTransaction(tx, auth.paymentId, captured, { orderRef: ref });
        await tx.query("UPDATE orders SET kb_payment_id = $2 WHERE id = $1", [id, auth.paymentId]);
      }
      await moveLines(tx, lineIds, "captured");
      const attachments = documents.map((content, i) => ({ filename: `${codes[i]}.pdf`, content }));
      const mailId = await queueMail(tx, mails.orderConfirmed(user.email, ref, mailLines, attachments));
      await tx.query("UPDATE orders SET confirmation_outbox_id = $2 WHERE id = $1", [id, mailId]);
      return id;
    });
    return orderId;
  } catch (error) {
    for (const step of undo.reverse()) await step().catch((e) => console.error("checkout compensation failed", e));
    throw error;
  }
}
route("POST", "/api/checkout", ["visitor", "group_booker"], async (ctx) => {
  const orderId = await checkout(ctx);
  return ok(await orderView(db, orderId), 201);
}, { idempotent: true });

// server/domain/curation.ts
route("POST", "/api/sessions/:id/transitions", ["curator"], async (ctx) => {
  const body = asObject(ctx.body);
  const result = await transaction(async (tx) => {
    const now = /* @__PURE__ */ new Date();
    const session = await tx.one("SELECT id FROM sessions WHERE id = $1 FOR UPDATE", [ctx.params.id]);
    if (!session) throw notFound();
    let tasks = [];
    const moved = await move(tx, "session", session.id, ctx.user, { to: body.to, note: body.note, publish_at: body.publish_at }, {
      apply: async (to) => {
        if (to !== "cancelled") return 0;
        await closeSessionSeats(tx, session.id);
        const refunded = await refundCancelledSession(tx, ctx.user, session.id);
        tasks = refunded.tasks;
        return refunded.count;
      }
    });
    const row = await tx.one(`${SESSION_SELECT} WHERE s.id = $2`, [now, session.id]);
    return { session: sessionView(row, true), history: await history(tx, "session", session.id), refunds_started: moved.refunds, tasks };
  });
  await startTasks(result.tasks);
  return ok({ session: result.session, history: result.history, refunds_started: result.refunds_started });
});
route("GET", "/api/sessions/:id/history", ["curator"], async (ctx) => {
  if (!await db.one("SELECT id FROM sessions WHERE id = $1", [ctx.params.id])) throw notFound();
  return ok({ history: await history(db, "session", ctx.params.id) });
});

// server/domain/door.ts
var STATUS_REFUSAL = { transferred: "pass_transferred", refunded: "pass_refunded", voided: "pass_voided" };
function entitlement(pass2, session, day) {
  if (pass2.kind === "full_festival") return { entitled: session.admission === "pass", usedScope: "session" };
  if (pass2.kind === "day") return { entitled: session.admission === "pass" && pass2.line_day === day && dayPassCovers(session.venue_id), usedScope: "day" };
  return { entitled: pass2.line_session_id === session.id, usedScope: "session" };
}
route("POST", "/api/box-office/scans", ["box_office"], async (ctx) => {
  const body = asObject(ctx.body);
  const outcome = await transaction(async (tx) => {
    const code2 = typeof body.pass_code === "string" ? body.pass_code.trim().toUpperCase() : "";
    const pass2 = await tx.one(
      `SELECT p.code, p.status, l.kind, l.session_id AS line_session_id, l.festival_day::text AS line_day, l.holder_name, l.title
       FROM passes p JOIN lines l ON l.id = p.line_id WHERE p.code = $1 FOR UPDATE OF p`,
      [code2]
    );
    if (!pass2) throw new ApiError(404, "unknown_pass");
    const session = await tx.one(
      "SELECT id, title, admission, venue_id, effective_status(status, publish_at, $2) AS status, starts_at FROM sessions WHERE id = $1",
      [typeof body.session_id === "string" ? body.session_id : "", /* @__PURE__ */ new Date()]
    );
    if (!session) throw notFound();
    const now = /* @__PURE__ */ new Date();
    const day = festivalDayOf(session.starts_at.getTime());
    let refusal = STATUS_REFUSAL[pass2.status] ?? null;
    let firstAdmitted = null;
    if (!refusal && session.status === "cancelled") refusal = "session_cancelled";
    if (!refusal) {
      const rule = entitlement(pass2, session, day);
      if (!rule.entitled || session.status !== "published") refusal = "not_entitled";
      else {
        const used = await tx.one(
          `SELECT scanned_at FROM scans WHERE pass_code = $1 AND result = 'admitted' AND ${rule.usedScope === "day" ? "festival_day = $2" : "session_id = $2"}
           ORDER BY seq LIMIT 1`,
          [pass2.code, rule.usedScope === "day" ? day : session.id]
        );
        if (used) {
          refusal = "already_admitted";
          firstAdmitted = used.scanned_at;
        }
      }
    }
    await tx.query(
      "INSERT INTO scans (pass_code, session_id, festival_day, venue_id, result, reason, scanned_at, staff_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [pass2.code, session.id, day, session.venue_id, refusal ? "refused" : "admitted", refusal, now, ctx.user.id]
    );
    await audit(tx, ctx.user, refusal ? "scan.refused" : "scan.admitted", { type: "pass", id: pass2.code }, { session_id: session.id, reason: refusal });
    return { refusal, firstAdmitted, pass: pass2, session, day, now };
  });
  if (outcome.refusal) {
    throw new ApiError(409, "admission_refused", { reason: outcome.refusal, first_admitted_at: isoOrNull(outcome.firstAdmitted) });
  }
  return ok({
    result: "admitted",
    pass_code: outcome.pass.code,
    holder_name: outcome.pass.holder_name,
    item_title: outcome.pass.title,
    session_id: outcome.session.id,
    festival_day: outcome.day,
    scanned_at: isoUtc(outcome.now)
  });
});
route("GET", "/api/box-office/admissions", ["box_office"], async (ctx) => {
  const day = ctx.query.get("festival_day") ?? "";
  if (!festivalDays(await edition()).some((d) => d.date === day)) throw new FieldErrors({ festival_day: "unknown_festival_day" });
  const bounds = festivalDayBounds(day);
  const venues = await db.all(
    `SELECT v.id AS venue_id, v.name, (SELECT count(*) FROM scans s WHERE s.venue_id = v.id AND s.festival_day = $1 AND s.result = 'admitted')::integer AS admissions
     FROM venues v ORDER BY v.position, v.id`,
    [day]
  );
  return ok({
    festival_day: day,
    starts_at: isoUtc(bounds.startsAt),
    ends_at: isoUtc(bounds.endsAt),
    length_hours: (bounds.endsAt - bounds.startsAt) / 36e5,
    venues,
    total: venues.reduce((s, v) => s + v.admissions, 0)
  });
});

// server/domain/group.ts
var READERS2 = ["group_booker", "finance"];
async function organisationOf(ctx) {
  const id = ctx.user.role === "finance" ? ctx.query.get("organisation_id") : ctx.user.organisation_id;
  if (!id) throw new FieldErrors({ organisation_id: "required" });
  const org = await db.one("SELECT id, name FROM organisations WHERE id = $1", [id]);
  if (!org) throw notFound();
  return org;
}
async function attendees(organisationId, search) {
  return db.all(
    `SELECT l.holder_name AS name, o.ref AS order_ref, l.id AS line_id, l.title AS item_title, l.state, l.kind, l.festival_day::text,
       s.starts_at, l.list_cents, l.group_discount_cents, l.voucher_cents, l.charged_cents
     FROM lines l JOIN orders o ON o.id = l.order_id LEFT JOIN sessions s ON s.id = l.session_id
     WHERE o.organisation_id = $1 AND ($2::text IS NULL OR strpos(lower(l.holder_name), lower($2)) > 0)
     ORDER BY o.created_at DESC, l.position`,
    [organisationId, search]
  );
}
route("GET", "/api/group/dashboard", READERS2, async (ctx) => {
  const org = await organisationOf(ctx);
  const counts = await db.one(
    `SELECT (SELECT count(*) FROM orders WHERE organisation_id = $1)::integer AS orders,
            (SELECT count(*) FROM lines l JOIN orders o ON o.id = l.order_id WHERE o.organisation_id = $1)::integer AS tickets`,
    [org.id]
  );
  const invoices = await invoicesOfOrganisation(db, org.id);
  const sum = (pick) => invoices.reduce((s, i) => s + pick(i), 0);
  return ok({
    organisation: org,
    orders: counts.orders,
    tickets: counts.tickets,
    invoiced_cents: sum((i) => i.amount_cents),
    credited_cents: sum((i) => i.credited_cents),
    paid_cents: sum((i) => i.paid_cents),
    outstanding_cents: sum((i) => balanceOf(i))
  });
});
route("GET", "/api/group/attendees", READERS2, async (ctx) => {
  const org = await organisationOf(ctx);
  const q = (ctx.query.get("q") ?? "").trim();
  if (q.length < 2) throw new FieldErrors({ q: "too_short" });
  const rows = await attendees(org.id, q);
  return ok({ attendees: rows.map(({ name, order_ref, line_id, item_title, state }) => ({ name, order_ref, line_id, item_title, state })) });
});
var FORMULA_START = /^[=+\-@\t\r]/;
function csvCell(value) {
  const s = FORMULA_START.test(value) && !/^-?\d/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
route("GET", "/api/group/export.csv", READERS2, async (ctx) => {
  const org = await organisationOf(ctx);
  const header = "order_ref,attendee_name,item,festival_day,list_eur,group_discount_eur,voucher_eur,invoiced_eur,state";
  const rows = (await attendees(org.id, null)).map((r) => [
    r.order_ref,
    r.name,
    r.item_title,
    r.festival_day ?? (r.starts_at ? festivalDayOf(r.starts_at.getTime()) : ""),
    decimalEuros(r.list_cents),
    decimalEuros(r.group_discount_cents),
    decimalEuros(r.voucher_cents),
    decimalEuros(r.charged_cents),
    r.state
  ].map(csvCell).join(","));
  return {
    status: 200,
    contentType: "text/csv; charset=utf-8",
    bytes: Buffer.from([header, ...rows].join("\r\n") + "\r\n"),
    headers: { "Content-Disposition": `attachment; filename="${org.id}-attendees.csv"`, "Cache-Control": "no-store" }
  };
});

// server/domain/health.ts
var word = (up) => up ? "up" : "down";
route("GET", "/api/health", "public", async () => {
  const [postgres, killbill, mailpit, minio] = await Promise.all([databaseUp(), killbillUp(), mailUp(), storageUp()]);
  return ok({ status: "ok", services: { postgres: word(postgres), killbill: word(killbill), mailpit: word(mailpit), minio: word(minio) } });
});

// server/domain/reconciliation.ts
function mismatchView(m) {
  return {
    id: m.id,
    run_id: m.run_id,
    type: m.type,
    order_ref: m.order_ref,
    killbill_transaction_id: m.killbill_transaction_id,
    transaction_type: m.transaction_type,
    app_amount_cents: m.app_amount_cents,
    killbill_amount_cents: m.killbill_amount_cents,
    status: m.status,
    note: m.note,
    resolved_by: m.resolved_by,
    resolved_at: isoOrNull(m.resolved_at)
  };
}
async function compare() {
  const payments = await kerfPayments();
  const records = await db.all(
    "SELECT kb_transaction_id, transaction_type, amount_cents, status, order_ref FROM payment_records"
  );
  const refs = new Set((await db.all("SELECT ref FROM orders")).map((o) => o.ref));
  const byId = new Map(records.map((r) => [r.kb_transaction_id, r]));
  const seen = /* @__PURE__ */ new Set();
  const found = [];
  let checked = 0;
  for (const payment2 of payments) {
    for (const tx of payment2.transactions) {
      checked++;
      seen.add(tx.transactionId);
      const record2 = byId.get(tx.transactionId);
      const kbCents2 = kbCents(tx.amount);
      const base = {
        killbill_transaction_id: tx.transactionId,
        transaction_type: tx.transactionType,
        killbill_amount_cents: kbCents2,
        order_ref: refs.has(payment2.paymentExternalKey) ? payment2.paymentExternalKey : null
      };
      if (!record2) {
        if (tx.status === "SUCCESS") found.push({ ...base, type: "unknown_in_app", app_amount_cents: null });
      } else if (record2.amount_cents !== kbCents2) found.push({ ...base, type: "amount_mismatch", app_amount_cents: record2.amount_cents });
      else if (record2.status !== tx.status) found.push({ ...base, type: "status_mismatch", app_amount_cents: record2.amount_cents });
    }
  }
  for (const record2 of records) {
    if (!seen.has(record2.kb_transaction_id)) {
      found.push({
        type: "missing_in_killbill",
        killbill_transaction_id: record2.kb_transaction_id,
        transaction_type: record2.transaction_type,
        killbill_amount_cents: null,
        app_amount_cents: record2.amount_cents,
        order_ref: record2.order_ref
      });
    }
  }
  return { checked, found };
}
async function runView(runId) {
  const run = await db.one(
    "SELECT id, started_at, finished_at, checked_transactions FROM reconciliation_runs WHERE id = $1",
    [runId]
  );
  if (!run) throw notFound();
  const mismatches = await db.all(
    "SELECT m.* FROM mismatches m JOIN run_mismatches r ON r.mismatch_id = m.id WHERE r.run_id = $1 ORDER BY m.found_at, m.id",
    [runId]
  );
  return {
    id: run.id,
    started_at: isoUtc(run.started_at),
    finished_at: isoUtc(run.finished_at),
    checked_transactions: run.checked_transactions,
    mismatches: mismatches.map(mismatchView)
  };
}
route("POST", "/api/finance/reconciliation-runs", ["finance"], async (ctx) => {
  const started = /* @__PURE__ */ new Date();
  const { checked, found } = await compare();
  const id = newId();
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO reconciliation_runs (id, started_at, finished_at, checked_transactions, actor) VALUES ($1,$2,$3,$4,$5)",
      [id, started, /* @__PURE__ */ new Date(), checked, ctx.user.email]
    );
    for (const m of found) {
      const identity = `${m.type}:${m.killbill_transaction_id}`;
      const row = await tx.one(
        `INSERT INTO mismatches (id, run_id, type, identity, order_ref, killbill_transaction_id, transaction_type, app_amount_cents, killbill_amount_cents, status, found_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10) ON CONFLICT (identity) DO UPDATE SET identity = EXCLUDED.identity RETURNING id`,
        [newId(), id, m.type, identity, m.order_ref, m.killbill_transaction_id, m.transaction_type, m.app_amount_cents, m.killbill_amount_cents, /* @__PURE__ */ new Date()]
      );
      await tx.query("INSERT INTO run_mismatches (run_id, mismatch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, row.id]);
    }
    await audit(tx, ctx.user, "reconciliation.run", { type: "reconciliation_run", id }, { checked_transactions: checked, mismatches: found.length });
  });
  return ok(await runView(id), 201);
});
route("GET", "/api/finance/reconciliation-runs/:id", ["finance"], async (ctx) => ok(await runView(ctx.params.id)));
route("GET", "/api/finance/mismatches", ["finance"], async (ctx) => {
  const rows = await db.all("SELECT * FROM mismatches WHERE ($1::text IS NULL OR status = $1) ORDER BY found_at DESC, id", [ctx.query.get("status")]);
  return ok({ mismatches: rows.map(mismatchView) });
});
route("POST", "/api/finance/mismatches/:id/resolve", ["finance"], async (ctx) => {
  const note = typeof asObject(ctx.body).note === "string" ? asObject(ctx.body).note.trim().slice(0, 2e3) : "";
  const row = await transaction(async (tx) => {
    const m = await tx.one("SELECT * FROM mismatches WHERE id = $1 FOR UPDATE", [ctx.params.id]);
    if (!m) throw notFound();
    if (m.status === "resolved") throw new ApiError(409, "already_resolved");
    if (!note) throw new FieldErrors({ note: "required" });
    const resolved = await tx.one(
      "UPDATE mismatches SET status = 'resolved', note = $2, resolved_by = $3, resolved_at = $4 WHERE id = $1 RETURNING *",
      [m.id, note, ctx.user.email, /* @__PURE__ */ new Date()]
    );
    await audit(tx, ctx.user, "mismatch.resolved", { type: "mismatch", id: m.id }, { note, type: m.type, killbill_transaction_id: m.killbill_transaction_id });
    return resolved;
  });
  return ok(mismatchView(row));
});

// server/domain/transfers.ts
route("POST", "/api/orders/:id/lines/:lineId/transfer", ["visitor", "group_booker"], async (ctx) => {
  const body = asObject(ctx.body);
  let stored = null;
  try {
    const line = await transaction(async (tx) => {
      const order = await visibleOrder(tx, ctx.user, ctx.params.id, true);
      const current = (await linesOf(tx, [order.id])).find((l) => l.id === ctx.params.lineId);
      if (!current) throw notFound();
      if (refusedMoves([current], "transferred").length) {
        throw new ApiError(409, current.state === "transferred" ? "already_transferred" : "line_not_transferable");
      }
      const errors = {};
      const name = text(body.recipient_name, 1, 200);
      const address = email(body.recipient_email);
      if (!name) errors.recipient_name = "required";
      if (!address) errors.recipient_email = "invalid";
      if (Object.keys(errors).length) throw new FieldErrors(errors);
      const code2 = newPassCode();
      const face = await passFace(tx, { ...current, holder_name: name }, code2);
      const document = passPdf(face);
      stored = objectKeys.pass(order.ref, code2);
      await putObject(stored, document, "application/pdf");
      await moveLines(tx, [current.id], "transferred");
      await tx.query("UPDATE lines SET holder_name = $2 WHERE id = $1", [current.id, name]);
      await tx.query("UPDATE passes SET status = 'transferred' WHERE line_id = $1 AND status = 'valid'", [current.id]);
      await tx.query("INSERT INTO passes (code, line_id, status, created_at) VALUES ($1, $2, 'valid', $3)", [code2, current.id, /* @__PURE__ */ new Date()]);
      await queueMail(tx, mails.transferSent(order.buyer_email, order.ref, current.title, name));
      await queueMail(tx, mails.transferReceived(address, face, { filename: `${code2}.pdf`, content: document }));
      return (await linesOf(tx, [order.id])).find((l) => l.id === current.id);
    });
    return ok({ line: lineView(line), pass: { code: line.pass_code, status: "valid" } });
  } catch (error) {
    if (stored) await removeAll([stored]);
    throw error;
  }
});

// server/main.ts
await runScriptLocked("kerf-schema", SCHEMA);
await loadAppSecret();
await seed();
var server = createServer((req, res) => {
  void handleRequest(req, res).then(() => {
    if (req.method !== "GET" && req.method !== "HEAD") kick();
  });
});
server.keepAliveTimeout = 5e3;
server.listen(config.port, "0.0.0.0", () => console.log(`Kerf Frequencies listening on 0.0.0.0:${config.port}`));
startWorker();
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)).closeAllConnections());
