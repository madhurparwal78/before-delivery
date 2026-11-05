// src/server/main.ts
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// src/server/auth.ts
import { createHash, randomBytes as randomBytes2, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// src/server/db.ts
import pg from "pg";

// src/server/config.ts
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
function seconds(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
function benchDaysNow() {
  const raw = process.env.BENCH_DAYS_NOW;
  if (!raw) return null;
  const instant = new Date(raw);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(instant.getTime())) {
    throw new Error("BENCH_DAYS_NOW must be an ISO 8601 UTC instant");
  }
  return instant;
}
var config = {
  port: seconds("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET")
  },
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: process.env.S3_REGION || "us-east-1",
    bucket: required("S3_BUCKET"),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY")
  },
  smtp: {
    host: required("SMTP_HOST"),
    port: seconds("SMTP_PORT", 25),
    from: process.env.MAIL_FROM || "Opaline Bench Days <registrar@opaline-institute.test>"
  },
  pocketbase: {
    url: required("POCKETBASE_URL").replace(/\/+$/, ""),
    email: required("POCKETBASE_ADMIN_EMAIL"),
    password: required("POCKETBASE_ADMIN_PASSWORD")
  },
  holdSeconds: seconds("HOLD_SECONDS", 480),
  offerSeconds: seconds("OFFER_SECONDS", 86400),
  benchDaysNow: benchDaysNow()
};

// src/server/db.ts
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));
var pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 1e4 });
pool.on("error", () => {
});
var SCHEMA_LOCK = 7201;
var LEDGER_LOCK = 7202;
var CERTIFICATE_LOCK = 7203;
var AGENDA_LOCK = 7204;
var SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  clinic_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS groups (
  id text PRIMARY KEY,
  buyer_id text NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reservations (
  id text PRIMARY KEY,
  bench text NOT NULL,
  state text NOT NULL,
  group_id text REFERENCES groups(id),
  buyer_id text NOT NULL REFERENCES accounts(id),
  attendee_name text,
  attendee_email text,
  attendee_account_id text REFERENCES accounts(id),
  attendee_accepted boolean NOT NULL DEFAULT false,
  hold_expires_at timestamptz,
  hold_duration integer,
  payment_pending text,
  upgrade_target text,
  refund_due_cents bigint,
  licence_number text,
  licence_state text,
  licence_key text,
  licence_status text NOT NULL DEFAULT 'none',
  passport_full_name text,
  passport_nationality text,
  passport_number text,
  passport_key text,
  checked_in_day1 boolean NOT NULL DEFAULT false,
  checked_in_day2 boolean NOT NULL DEFAULT false,
  certificate_number text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservations_buyer ON reservations (buyer_id);
CREATE INDEX IF NOT EXISTS reservations_state ON reservations (state);
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  external_key text NOT NULL UNIQUE,
  kind text NOT NULL,
  owner_id text NOT NULL,
  amount_cents bigint NOT NULL,
  billing_name text NOT NULL,
  kb_account_id text,
  kb_invoice_id text,
  kb_payment_id text,
  confirmed_at timestamptz,
  finalized_at timestamptz,
  retry_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payment_items (
  payment_id text NOT NULL REFERENCES payments(id),
  reservation_id text NOT NULL REFERENCES reservations(id),
  bench text NOT NULL,
  amount_cents bigint NOT NULL,
  kb_invoice_item_id text,
  PRIMARY KEY (payment_id, reservation_id)
);
CREATE TABLE IF NOT EXISTS refunds (
  reservation_id text NOT NULL REFERENCES reservations(id),
  n integer NOT NULL,
  payment_id text NOT NULL REFERENCES payments(id),
  amount_cents bigint NOT NULL,
  external_key text NOT NULL UNIQUE,
  confirmed_at timestamptz,
  PRIMARY KEY (reservation_id, n)
);
CREATE TABLE IF NOT EXISTS documents (
  owner_id text NOT NULL,
  kind text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, kind)
);
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id text PRIMARY KEY,
  seq bigserial UNIQUE,
  account_id text NOT NULL REFERENCES accounts(id),
  tier text NOT NULL,
  state text NOT NULL,
  bench text,
  offer_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  account_id text NOT NULL REFERENCES accounts(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  retry_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (retry_after) WHERE sent_at IS NULL;
`;
async function applySchema() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    try {
      await client.query(SCHEMA);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
    }
  } finally {
    client.release();
  }
}
async function tx(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
}
async function lockLedger(db) {
  await db.query("SELECT pg_advisory_xact_lock($1)", [LEDGER_LOCK]);
}
async function lockCertificates(db) {
  await db.query("SELECT pg_advisory_xact_lock($1)", [CERTIFICATE_LOCK]);
}
async function oneAgendaWriteAtATime(work) {
  return tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [AGENDA_LOCK]);
    return work();
  });
}
async function oneRow(db, sql, params = []) {
  const result = await db.query(sql, params);
  const row = result.rows[0];
  if (row === void 0) throw new Error("expected a row");
  return row;
}
async function one(db, sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0] ?? null;
}
async function many(db, sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

// src/server/reservations.ts
import { randomBytes } from "node:crypto";

// src/server/http.ts
var JSON_LIMIT = 65536;
var REQUEST_LIMIT = 101e5;
var FILE_LIMIT = 1e7;
var DRAIN_LIMIT = 64e6;
var ApiError = class extends Error {
  constructor(status, code, message2, extra = {}) {
    super(message2);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
};
function validation(errors) {
  return new ApiError(422, "validation", "Some fields need attention.", { errors });
}
function notFound() {
  return new ApiError(404, "not_found", "Nothing was found at this address.");
}
function conflict(code, message2, extra = {}) {
  return new ApiError(409, code, message2, extra);
}
function sendJson(res, status, body, headers = {}) {
  const payload = status === 204 ? "" : JSON.stringify(body);
  res.writeHead(status, {
    ...status === 204 ? {} : { "Content-Type": "application/json; charset=utf-8" },
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(payload);
}
function sendError(res, error) {
  sendJson(res, error.status, { error: error.code, message: error.message, ...error.extra });
}
async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"] ?? "0");
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > DRAIN_LIMIT) {
      req.destroy();
      break;
    }
    if (total <= limit) chunks.push(chunk);
  }
  if (total > limit || declared > limit) throw new ApiError(413, "payload_too_large", "The request body is too large.");
  return Buffer.concat(chunks);
}
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
function parseJson(req, raw) {
  if (raw.length === 0) return {};
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  if (!type.startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send the body as application/json.");
  }
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new ApiError(400, "malformed_json", "The request body is not valid JSON.");
  }
}
function parseMultipart(req, raw) {
  const type = req.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    throw new ApiError(415, "unsupported_media_type", "Send the upload as multipart/form-data.");
  }
  const unreadable = new ApiError(400, "malformed_json", "The upload could not be read.");
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(type);
  if (!boundary) throw unreadable;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const fields2 = {};
  const files = [];
  let at = raw.indexOf(delimiter);
  if (at < 0) throw unreadable;
  for (; ; ) {
    at += delimiter.length;
    if (raw.subarray(at, at + 2).toString("latin1") === "--") break;
    const headerEnd = raw.indexOf("\r\n\r\n", at);
    const next = raw.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), at);
    if (headerEnd < 0 || next < 0 || headerEnd > next) throw unreadable;
    const headers = raw.subarray(at, headerEnd).toString("utf8");
    const body = raw.subarray(headerEnd + 4, next);
    const disposition = /^content-disposition:[^\r\n]*/im.exec(headers)?.[0] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    if (name === void 0) throw unreadable;
    if (/\bfilename\*?=/i.test(disposition)) {
      files.push({ bytes: Buffer.from(body), tooLarge: body.length > FILE_LIMIT });
    } else {
      fields2[name] = body.toString("utf8");
    }
    at = next + 2;
  }
  return { fields: fields2, files };
}
function sniff(bytes) {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { ext: "pdf", contentType: "application/pdf" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { ext: "jpg", contentType: "image/jpeg" };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { ext: "png", contentType: "image/png" };
  }
  return null;
}

// src/shared/courseDays.ts
var COURSE_DAYS = { 1: "2027-04-16", 2: "2027-04-17" };
function openCourseDay(venueDate2) {
  if (venueDate2 === COURSE_DAYS[1]) return 1;
  if (venueDate2 === COURSE_DAYS[2]) return 2;
  return null;
}

// src/shared/prices.ts
var PRICES = {
  bench: { full: 345e3, deposit: 9e4, balance: 255e3 },
  atelier: { full: 59e4, deposit: 15e4, balance: 44e4 }
};
function upgradeCharge(state, depositsOpen2) {
  return state === "deposit_paid" && depositsOpen2 ? PRICES.atelier.deposit - PRICES.bench.deposit : PRICES.atelier.full - PRICES.bench.full;
}

// src/server/rules.ts
var SEATS_TOTAL = 24;
var ROWS = ["A", "B", "C", "D"];
var BENCH_LABELS = ROWS.flatMap((row) => [1, 2, 3, 4, 5, 6].map((n) => `${row}${n}`));
var MAX_GROUP_BENCHES = 6;
function isBenchLabel(value) {
  return typeof value === "string" && BENCH_LABELS.includes(value);
}
function tierOf(bench) {
  return bench.startsWith("A") || bench.startsWith("B") ? "atelier" : "bench";
}
var TIER_NAME = { bench: "Bench", atelier: "Atelier" };
var ACTIVE_STATES = [
  "held",
  "deposit_paid",
  "paid_in_full",
  "checked_in_day1",
  "checked_in_day2",
  "certificate_issued"
];
var SOLD_STATES = ACTIVE_STATES.filter((state) => state !== "held");
var MOVES = {
  held: ["deposit_paid", "paid_in_full", "released"],
  deposit_paid: ["paid_in_full", "cancelled"],
  paid_in_full: ["checked_in_day1", "cancelled"],
  checked_in_day1: ["checked_in_day2"],
  checked_in_day2: ["certificate_issued"],
  certificate_issued: [],
  released: [],
  cancelled: ["refunded"],
  refunded: []
};
function assertMove(from, to) {
  if (!MOVES[from].includes(to)) throw conflict("invalid_transition", `A ${from} reservation cannot become ${to}.`);
}
var ATELIER_CAP = 10;
function atelierRoom(activeAtelier) {
  return Math.max(0, ATELIER_CAP - activeAtelier);
}
var DEPOSIT_DEADLINE = "2027-03-19";
var EARLY_REFUND_END = "2027-01-15";
var REMINDER_21_FROM = "2027-02-26";
var REMINDER_7_FROM = "2027-03-12";
var venueDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });
function venueToday(now) {
  return venueDate.format(config.benchDaysNow ?? now);
}
function depositsOpen(today) {
  return today <= DEPOSIT_DEADLINE;
}
function reminderDue(today) {
  if (today > DEPOSIT_DEADLINE) return null;
  if (today >= REMINDER_7_FROM) return "7";
  if (today >= REMINDER_21_FROM) return "21";
  return null;
}
var REFUND_FEE = 25e3;
function refundDue(paidCents, today) {
  if (today <= EARLY_REFUND_END) return Math.max(0, paidCents - REFUND_FEE);
  if (today <= DEPOSIT_DEADLINE) return Math.floor(paidCents / 2);
  return null;
}
function checkinConflict(seat, day, today) {
  if (openCourseDay(today) !== day) return "checkin_closed";
  if (!seat.attendeeAccepted) return "no_attendee";
  if (day === 1 ? seat.checkedIn.day1 : seat.checkedIn.day2) return "already_checked_in";
  if (seat.state === "deposit_paid") return "balance_due";
  if (day === 2 && seat.state === "paid_in_full") return "not_checked_in_day1";
  return null;
}
function certificateGaps(seat) {
  const gaps = [];
  if (seat.balanceCents > 0) gaps.push("balance_unpaid");
  if (!seat.checkedIn.day1) gaps.push("day1_check_in");
  if (!seat.checkedIn.day2) gaps.push("day2_check_in");
  if (seat.licenceStatus !== "matched") gaps.push("licence_not_matched");
  return gaps;
}

// src/server/reservations.ts
function newId(prefix) {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}
var SELECT = `
SELECT r.*, a.name AS buyer_name, a.email AS buyer_email, a.role AS buyer_role, a.clinic_name AS buyer_clinic_name,
  COALESCE((SELECT sum(pi.amount_cents) FROM payment_items pi JOIN payments p ON p.id = pi.payment_id
            WHERE pi.reservation_id = r.id AND p.confirmed_at IS NOT NULL), 0) AS purchased_cents,
  COALESCE((SELECT sum(f.amount_cents) FROM refunds f WHERE f.reservation_id = r.id AND f.confirmed_at IS NOT NULL), 0) AS refunded_cents,
  ARRAY(SELECT d.kind FROM documents d WHERE d.owner_id = r.id ORDER BY d.created_at) AS documents
FROM reservations r JOIN accounts a ON a.id = r.buyer_id`;
async function findReservation(db, id) {
  return one(db, `${SELECT} WHERE r.id = $1`, [id]);
}
async function reload(db, id) {
  const row = await findReservation(db, id);
  if (!row) throw notFound();
  return row;
}
async function reservationsWhere(db, where, params) {
  return many(db, `${SELECT} WHERE ${where} ORDER BY r.created_at, r.bench`, params);
}
async function lockReservations(db, ids) {
  await db.query("SELECT id FROM reservations WHERE id = ANY($1) ORDER BY id FOR NO KEY UPDATE", [ids]);
}
async function lockedReservation(db, id) {
  await lockReservations(db, [id]);
  return reload(db, id);
}
async function transition(db, rows, to, set = {}) {
  for (const row of rows) assertMove(row.state, to);
  const columns = Object.keys(set).map((column, index) => `${column} = $${index + 3}`);
  await db.query(`UPDATE reservations SET ${["state = $2", ...columns].join(", ")} WHERE id = ANY($1)`, [
    rows.map((row) => row.id),
    to,
    ...Object.values(set)
  ]);
}
function isBuyer(row, account) {
  return row.buyer_id === account.id;
}
function isAttendee(row, account) {
  return row.attendee_accepted && row.attendee_account_id === account.id;
}
function isAssignee(row, account) {
  return account.role === "practitioner" && !row.attendee_accepted && !!row.attendee_email && row.attendee_email.toLowerCase() === account.email_key;
}
function assertVisible(row, account, allowed) {
  const ok = allowed.includes("registrar") && account.role === "registrar" || allowed.includes("buyer") && isBuyer(row, account) || allowed.includes("attendee") && isAttendee(row, account) || allowed.includes("assignee") && isAssignee(row, account);
  if (!ok) throw notFound();
  return row;
}
async function visibleReservation(db, id, account, allowed) {
  return assertVisible(await reload(db, id), account, allowed);
}
async function lockedVisible(db, id, account, allowed) {
  return assertVisible(await lockedReservation(db, id), account, allowed);
}
function buyerName(row) {
  return buyerDisplayName(row.buyer_role, row.buyer_name, row.buyer_clinic_name);
}
function priceCents(row) {
  return PRICES[tierOf(row.bench)].full;
}
function balanceCents(row) {
  return priceCents(row) - row.purchased_cents;
}
function holdView(row, now) {
  if (row.state !== "held" || !row.hold_expires_at || row.hold_duration === null) return null;
  return {
    expires_at: row.hold_expires_at.toISOString(),
    seconds_remaining: Math.max(0, Math.ceil((row.hold_expires_at.getTime() - now.getTime()) / 1e3)),
    duration_seconds: row.hold_duration
  };
}
function reservationView(row, now) {
  return {
    id: row.id,
    bench: row.bench,
    tier: tierOf(row.bench),
    state: row.state,
    group_id: row.group_id,
    buyer: { name: buyerName(row), kind: row.buyer_role },
    attendee: row.attendee_name ? { name: row.attendee_name, email: row.attendee_email ?? "", accepted: row.attendee_accepted } : null,
    price_cents: priceCents(row),
    paid_cents: row.purchased_cents - row.refunded_cents,
    balance_cents: balanceCents(row),
    refund_due_cents: row.refund_due_cents,
    hold: holdView(row, now),
    payment_pending: row.payment_pending,
    licence_status: row.licence_status,
    passport_status: row.passport_key ? "submitted" : "none",
    checked_in: { day1: row.checked_in_day1, day2: row.checked_in_day2 },
    documents: row.documents
  };
}

// src/server/auth.ts
var scrypt = promisify(scryptCallback);
var BUYER_ROLES = ["practitioner", "clinic"];
var SESSION_COOKIE = "ob_session";
function buyerDisplayName(role, name, clinicName) {
  return role === "clinic" ? clinicName ?? name : name;
}
function accountView(account) {
  return { id: account.id, name: account.name, email: account.email, role: account.role };
}
async function hashPassword(password) {
  const salt = randomBytes2(16);
  const hash = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
async function passwordMatches(password, stored2) {
  const [, saltHex, hashHex] = stored2.split("$");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
function tokenHash(token2) {
  return createHash("sha256").update(token2).digest("hex");
}
async function createSession(db, accountId) {
  const token2 = randomBytes2(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)", [tokenHash(token2), accountId]);
  return token2;
}
function sessionCookie(token2) {
  return `${SESSION_COOKIE}=${token2}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}
var CLEARED_COOKIE = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
function sessionToken(req) {
  const header3 = req.headers.cookie ?? "";
  for (const part of header3.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}
async function accountForSession(token2) {
  if (!token2) return null;
  return one(
    pool,
    `SELECT a.id, a.name, a.email, a.email_key, a.role, a.clinic_name FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1`,
    [tokenHash(token2)]
  );
}
async function endSession(token2) {
  if (token2) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token2)]);
}
async function findAccountByEmail(db, email2) {
  return one(db, "SELECT * FROM accounts WHERE email_key = $1", [email2.trim().toLowerCase()]);
}
async function insertAccount(db, fields2) {
  return one(
    db,
    `INSERT INTO accounts (id, name, email, email_key, password_hash, role, clinic_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (email_key) DO NOTHING
     RETURNING id, name, email, email_key, role, clinic_name`,
    [newId("acc"), fields2.name, fields2.email.trim(), fields2.email.trim().toLowerCase(), await hashPassword(fields2.password), fields2.role, fields2.clinicName]
  );
}
var STAFF = [
  { role: "director", name: "Mara Okonkwo-Lindqvist", email: "director@opaline-institute.test", password: "bench-days-director-2027" },
  { role: "registrar", name: "Theo Vasquez-Hale", email: "registrar@opaline-institute.test", password: "bench-days-registrar-2027" },
  { role: "frontdesk", name: "Priya Anand-Sorensen", email: "frontdesk@opaline-institute.test", password: "bench-days-frontdesk-2027" }
];
async function seedStaff(db) {
  for (const member of STAFF) {
    if (!await findAccountByEmail(db, member.email)) {
      await insertAccount(db, { name: member.name, email: member.email, password: member.password, role: member.role, clinicName: null });
    }
  }
}

// src/server/pocketbase.ts
var COLLECTIONS = {
  sessions: "agenda_sessions",
  hospitality: "hospitality_events",
  hotels: "hotels",
  faq: "faq_entries"
};
var SCHEMAS = {
  sessions: [
    { name: "number", type: "number" },
    { name: "day", type: "number" },
    { name: "title", type: "text" },
    { name: "format", type: "text" },
    { name: "minutes", type: "number" },
    { name: "outcomes", type: "text" }
  ],
  hospitality: [
    { name: "title", type: "text" },
    { name: "day", type: "number" },
    { name: "starts_at", type: "text" },
    { name: "venue", type: "text" },
    { name: "tier", type: "text" },
    { name: "description", type: "text" }
  ],
  hotels: [
    { name: "name", type: "text" },
    { name: "distance", type: "text" },
    { name: "rate", type: "text" },
    { name: "map_url", type: "text" }
  ],
  faq: [
    { name: "question", type: "text" },
    { name: "answer", type: "text" },
    { name: "sort", type: "number" }
  ]
};
var SEED = {
  sessions: [
    { number: 1, day: 1, format: "lecture", minutes: 90, title: "Shade and translucency mapping", outcomes: "Read chroma, value and translucency zones on a natural incisor" },
    { number: 2, day: 1, format: "hands-on", minutes: 150, title: "Palatal shell from a silicone index", outcomes: "Build a thin, even palatal shell from a wax-up index" },
    { number: 3, day: 1, format: "lecture", minutes: 60, title: "Dentin mamelons and internal effects", outcomes: "Plan mamelon shape and halo before layering" },
    { number: 4, day: 1, format: "hands-on", minutes: 180, title: "Class IV layering on the typodont", outcomes: "Layer dentin, effects and enamel to a natural incisal edge" },
    { number: 5, day: 2, format: "lecture", minutes: 60, title: "Posterior anatomy and occlusal stamping", outcomes: "Choose between freehand anatomy and occlusal stamps" },
    { number: 6, day: 2, format: "hands-on", minutes: 180, title: "Class II with sectional matrices", outcomes: "Place tight contacts with sectional rings and wedges" },
    { number: 7, day: 2, format: "lecture", minutes: 60, title: "Finishing and polishing sequence", outcomes: "Order discs, rubbers and pastes for lasting gloss" },
    { number: 8, day: 2, format: "hands-on", minutes: 180, title: "Polish to gloss and photograph", outcomes: "Finish to gloss and record cross-polarised photographs" }
  ],
  hospitality: [
    { title: "Welcome reception", day: 1, starts_at: "18:30", venue: "The Opaline Lab foyer", tier: "all", description: "Drinks and small plates with the instructor" },
    { title: "Atelier dinner with the instructor", day: 1, starts_at: "20:00", venue: "Larkspur Room, West Loop", tier: "atelier", description: "A seated tasting menu for Atelier guests and the course director" },
    { title: "Bench breakfast", day: 2, starts_at: "07:30", venue: "The Opaline Lab foyer", tier: "all", description: "Coffee and pastries before the lab opens" }
  ],
  hotels: [
    { name: "Fulton Rail Hotel", distance: "0.4 miles", rate: "from $289 a night", map_url: "https://maps.example.com/fulton-rail-hotel" },
    { name: "Kinzie Loft Suites", distance: "0.7 miles", rate: "from $245 a night", map_url: "https://maps.example.com/kinzie-loft-suites" }
  ],
  faq: [
    { sort: 1, question: "What should I bring?", answer: "Your own loupes. Typodonts, composites, instruments and curing lights are provided at every bench." },
    { sort: 2, question: "How are CE credits awarded?", answer: "Credits are issued after both days of check-in and a matched licence on file." },
    { sort: 3, question: "Can my clinic buy several seats?", answer: "Yes. A clinic account can hold up to six benches at once and pays one group invoice." },
    { sort: 4, question: "What is the difference between Bench and Atelier?", answer: "Atelier seats sit in rows A and B nearest the demo station and include the Atelier dinner." }
  ]
};
function seedId(kind, index) {
  return `ob${kind.slice(0, 4)}${String(index + 1).padStart(15 - 2 - kind.slice(0, 4).length, "0")}`;
}
function unavailable() {
  return new ApiError(503, "content_unavailable", "The programme is loading slowly. Refresh in a moment.");
}
var token = "";
async function call(method, path, body, retry = true) {
  if (!token) await authenticate();
  let response;
  try {
    response = await fetch(`${config.pocketbase.url}${path}`, {
      method,
      headers: { Authorization: token, ...body === void 0 ? {} : { "Content-Type": "application/json" } },
      body: body === void 0 ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    throw unavailable();
  }
  if ((response.status === 401 || response.status === 403) && retry) {
    token = "";
    return call(method, path, body, false);
  }
  if (response.status >= 500) throw unavailable();
  return response;
}
async function authenticate() {
  try {
    const response = await fetch(`${config.pocketbase.url}/api/admins/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: config.pocketbase.email, password: config.pocketbase.password }),
      signal: AbortSignal.timeout(1e4)
    });
    if (!response.ok) throw unavailable();
    token = (await response.json()).token;
  } catch {
    throw unavailable();
  }
}
var collectionsReady = null;
function ensureCollections() {
  collectionsReady ??= (async () => {
    for (const kind of Object.keys(COLLECTIONS)) {
      const name = COLLECTIONS[kind];
      const existing = await call("GET", `/api/collections/${name}`);
      if (existing.status === 404) {
        await call("POST", "/api/collections", {
          name,
          type: "base",
          schema: SCHEMAS[kind].map((field) => ({ name: field.name, type: field.type, required: false, options: {} }))
        });
        const created = await call("GET", `/api/collections/${name}`);
        if (!created.ok) throw unavailable();
      } else if (!existing.ok) {
        throw unavailable();
      }
      const page = await call("GET", `/api/collections/${name}/records?perPage=1`);
      if (!page.ok) throw unavailable();
      if ((await page.json()).totalItems === 0) {
        for (const [index, record] of SEED[kind].entries()) {
          await call("POST", `/api/collections/${name}/records`, { id: seedId(kind, index), ...record });
        }
      }
    }
  })().catch((error) => {
    collectionsReady = null;
    throw error;
  });
  return collectionsReady;
}
function pick(kind, raw) {
  const record = { id: String(raw.id) };
  for (const field of SCHEMAS[kind]) {
    const value = raw[field.name];
    record[field.name] = field.type === "number" ? Number(value ?? 0) : String(value ?? "");
  }
  return record;
}
async function listRecords(kind) {
  await ensureCollections();
  const response = await call("GET", `/api/collections/${COLLECTIONS[kind]}/records?perPage=500&sort=created`);
  if (!response.ok) throw unavailable();
  const page = await response.json();
  return page.items.map((item) => pick(kind, item));
}
async function createRecord(kind, fields2) {
  const response = await call("POST", `/api/collections/${COLLECTIONS[kind]}/records`, fields2);
  if (!response.ok) throw unavailable();
  return pick(kind, await response.json());
}
async function updateRecord(kind, id, fields2) {
  const response = await call("PATCH", `/api/collections/${COLLECTIONS[kind]}/records/${encodeURIComponent(id)}`, fields2);
  if (!response.ok) throw unavailable();
  return pick(kind, await response.json());
}
async function deleteRecord(kind, id) {
  const response = await call("DELETE", `/api/collections/${COLLECTIONS[kind]}/records/${encodeURIComponent(id)}`);
  if (!response.ok && response.status !== 404) throw unavailable();
}

// src/server/idempotency.ts
import { createHash as createHash2 } from "node:crypto";
var KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
function keyIsValid(key) {
  return key !== null && KEY_PATTERN.test(key);
}
var KEY_ERROR = { idempotency_key: "Send an Idempotency-Key of 8 to 128 letters, digits, - or _." };
function canonicalJson(value) {
  return JSON.stringify(
    value ?? null,
    (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v
  );
}
function fingerprint(method, path, body) {
  return createHash2("sha256").update(`${method.toUpperCase()}
${path}
${canonicalJson(body)}`).digest("hex");
}
async function stored(db, accountId, key) {
  return one(db, "SELECT fingerprint, status, body FROM idempotency_records WHERE account_id = $1 AND key = $2", [accountId, key]);
}
async function replayOf(db, accountId, key, fp) {
  const found = await stored(db, accountId, key);
  return found && found.fingerprint === fp ? found : null;
}
async function refuseReuse(db, accountId, key, fp) {
  if (!keyIsValid(key)) return;
  const found = await stored(db, accountId, key);
  if (found && found.fingerprint !== fp) throw conflict("idempotency_conflict", "This Idempotency-Key was used for a different request.");
}
async function remember(accountId, key, fp, status, body) {
  await pool.query(
    `INSERT INTO idempotency_records (account_id, key, fingerprint, status, body) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account_id, key) DO NOTHING`,
    [accountId, key, fp, status, JSON.stringify(body)]
  );
}

// src/server/router.ts
var routes = [];
function publicRoute(definition) {
  register({ ...definition, access: "public" });
}
function route(definition) {
  register(definition);
}
function register(definition) {
  const keys = [];
  const pattern = new RegExp(
    `^${definition.path.replace(/:([a-z]+)/g, (_m, key) => {
      keys.push(key);
      return "([^/]+)";
    })}$`
  );
  routes.push({ route: definition, pattern, keys });
}
function bodyForPrint(raw) {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return raw.toString("utf8");
  }
}
var STATE_CHANGING = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
function match(method, path) {
  for (const entry of routes) {
    if (entry.route.method !== method) continue;
    const found = entry.pattern.exec(path);
    if (!found) continue;
    const params = {};
    entry.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1] ?? "");
    });
    return { route: entry.route, params };
  }
  return null;
}
async function dispatch(req, res) {
  const url = new URL(req.url ?? "/", "http://app.invalid");
  const method = (req.method ?? "GET").toUpperCase();
  try {
    if (STATE_CHANGING.has(method) && !isSameOrigin(req)) {
      throw new ApiError(403, "cross_origin", "Requests must come from this site.");
    }
    const found = match(method, url.pathname);
    const raw = await readBody(req, found?.route.body === "multipart" ? REQUEST_LIMIT : JSON_LIMIT);
    if (!found) throw notFound();
    const { route: definition, params } = found;
    const account = await accountForSession(sessionToken(req));
    const header3 = req.headers["idempotency-key"];
    const idempotencyKey = typeof header3 === "string" ? header3 : null;
    const print = fingerprint(method, url.pathname, bodyForPrint(raw));
    const parse = async () => {
      const multipart = definition.body === "multipart" ? parseMultipart(req, raw) : null;
      const body = definition.body === "multipart" ? {} : parseJson(req, raw);
      return { req, params, query: url.searchParams, now: /* @__PURE__ */ new Date(), body, multipart, idempotencyKey, fingerprint: print };
    };
    let result;
    if (definition.access === "public") {
      result = await definition.handle({ ...await parse(), account });
    } else {
      if (!account) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
      const replayable = definition.idempotent === true && keyIsValid(idempotencyKey);
      if (replayable) {
        const replay = await replayOf(pool, account.id, idempotencyKey, print);
        if (replay) return sendJson(res, replay.status, replay.body);
      }
      if (Array.isArray(definition.access) && !definition.access.includes(account.role)) {
        throw new ApiError(403, "forbidden", "Your account cannot do this.");
      }
      result = await definition.handle({ ...await parse(), account });
      if (replayable && (result.status === 200 || result.status === 201)) {
        await remember(account.id, idempotencyKey, print, result.status, result.body);
      }
    }
    sendJson(res, result.status, result.body, result.headers);
  } catch (error) {
    if (error instanceof ApiError) return sendError(res, error);
    console.error(`${method} ${url.pathname} failed:`, error instanceof Error ? error.message : "unknown error");
    sendError(res, new ApiError(500, "internal", "Something went wrong on our side."));
  }
}

// src/server/smtp.ts
import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
function address(value) {
  const match2 = /<([^>]+)>/.exec(value);
  return (match2?.[1] ?? value).trim();
}
function header(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}
function message(mail) {
  const domain = address(config.smtp.from).split("@")[1] ?? "localhost";
  const lines = [
    `From: ${config.smtp.from}`,
    `To: ${mail.to}`,
    `Subject: ${header(mail.subject)}`,
    `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    ...mail.body.split(/\r?\n/).map((line) => line.startsWith(".") ? `.${line}` : line)
  ];
  return `${lines.join("\r\n")}\r
.\r
`;
}
function sendMail(mail) {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const steps = [
      `EHLO opaline-bench-days`,
      `MAIL FROM:<${address(config.smtp.from)}>`,
      `RCPT TO:<${address(mail.to)}>`,
      "DATA",
      message(mail),
      "QUIT"
    ];
    let buffer = "";
    let step = -1;
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(1e4, () => fail(new Error("SMTP timeout")));
    socket.on("error", fail);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3}-/.test(line)) continue;
        const code = Number.parseInt(line.slice(0, 3), 10);
        if (code >= 400) return fail(new Error(`SMTP ${code}`));
        step += 1;
        const next = steps[step];
        if (next === void 0) {
          socket.end();
          return resolve();
        }
        socket.write(next.endsWith("\r\n.\r\n") ? next : `${next}\r
`);
      }
    });
    socket.connect(config.smtp.port, config.smtp.host);
  });
}

// src/server/mail.ts
var BACKOFF_MS = 6e3;
var backoffUntil = 0;
async function enqueueMail(db, dedupeKey, mail) {
  await db.query(
    `INSERT INTO outbox (dedupe_key, to_address, subject, body) VALUES ($1, $2, $3, $4) ON CONFLICT (dedupe_key) DO NOTHING`,
    [dedupeKey, mail.to, mail.subject, mail.body]
  );
}
async function drainOutbox() {
  if (Date.now() < backoffUntil) return;
  for (; ; ) {
    const sent = await tx(async (db) => {
      const row = (await db.query(
        `SELECT id, to_address, subject, body FROM outbox WHERE sent_at IS NULL AND retry_after <= now()
           ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`
      )).rows[0];
      if (!row) return null;
      try {
        await sendMail({ to: row.to_address, subject: row.subject, body: row.body });
        await db.query("UPDATE outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1", [row.id]);
        return true;
      } catch {
        backoffUntil = Date.now() + BACKOFF_MS;
        await db.query("UPDATE outbox SET attempts = attempts + 1, retry_after = now() + random() * interval '4 seconds' WHERE id = $1", [row.id]);
        return false;
      }
    });
    if (!sent) return;
  }
}

// src/server/ledger.ts
async function occupants(db) {
  return many(
    db,
    `SELECT bench, buyer_id AS account_id, state FROM reservations WHERE state = ANY($1)
     UNION ALL
     SELECT upgrade_target, buyer_id, 'held' FROM reservations WHERE upgrade_target IS NOT NULL AND state = ANY($1)
     UNION ALL
     SELECT bench, account_id, 'offered' FROM waitlist_entries WHERE state = 'offered'`,
    [ACTIVE_STATES]
  );
}
function isSold(occupant) {
  return occupant.state !== "offered" && SOLD_STATES.includes(occupant.state);
}
function inventory(found) {
  const occupied = new Map(found.map((o) => [o.bench, o]));
  const open = BENCH_LABELS.filter((label) => !occupied.has(label));
  const activeAtelier = found.filter((o) => tierOf(o.bench) === "atelier").length;
  const room = atelierRoom(activeAtelier);
  return {
    seatsRemaining: SEATS_TOTAL - occupied.size,
    benchRemaining: open.filter((label) => tierOf(label) === "bench").length,
    atelier: {
      remaining: Math.min(open.filter((label) => tierOf(label) === "atelier").length, room),
      active: activeAtelier,
      cap: ATELIER_CAP,
      soldOut: room === 0
    },
    held: found.filter((o) => !isSold(o)).length,
    sold: found.filter(isSold).length,
    occupied
  };
}
function tierRemaining(stock, tier) {
  return tier === "bench" ? stock.benchRemaining : stock.atelier.remaining;
}
async function currentInventory(db) {
  return inventory(await occupants(db));
}
async function sweep(db, now) {
  const expired = await many(
    db,
    `SELECT id, state, bench FROM reservations WHERE state = 'held' AND hold_expires_at <= $1 AND payment_pending IS NULL
     FOR NO KEY UPDATE SKIP LOCKED`,
    [now]
  );
  if (expired.length) await transition(db, expired, "released", { hold_expires_at: null });
  const lapsed = await many(
    db,
    `UPDATE waitlist_entries SET state = 'offer_lapsed' WHERE state = 'offered' AND offer_expires_at <= $1 RETURNING bench`,
    [now]
  );
  await offerFreedBenches(db, now, [...expired, ...lapsed].map((row) => row.bench));
}
async function offerFreedBenches(db, now, freed) {
  for (const tier of ["bench", "atelier"]) {
    for (; ; ) {
      const entry = await one(
        db,
        `SELECT w.id, a.email FROM waitlist_entries w JOIN accounts a ON a.id = w.account_id
         WHERE w.tier = $1 AND w.state = 'waitlisted' ORDER BY w.seq LIMIT 1`,
        [tier]
      );
      if (!entry) break;
      const stock = await currentInventory(db);
      if (tier === "atelier" && stock.atelier.soldOut) break;
      const candidates = [...freed, ...BENCH_LABELS].filter((label) => tierOf(label) === tier && !stock.occupied.has(label));
      const bench = candidates[0];
      if (!bench) break;
      const expiresAt = new Date(now.getTime() + config.offerSeconds * 1e3);
      await db.query(`UPDATE waitlist_entries SET state = 'offered', bench = $2, offer_expires_at = $3 WHERE id = $1`, [
        entry.id,
        bench,
        expiresAt
      ]);
      await enqueueMail(db, `offer:${entry.id}`, {
        to: entry.email,
        subject: "A bench is open for you: sign in to accept",
        body: `Bench ${bench} at Opaline Bench Days is being held for you until ${expiresAt.toUTCString()}.

Sign in at /account to accept it. If you do not accept in time, it passes to the next person on the waitlist.`
      });
    }
  }
}
function benchState(occupant, viewerId) {
  if (!occupant) return "open";
  const mine2 = viewerId !== null && occupant.account_id === viewerId;
  if (occupant.state === "offered") return mine2 ? "offered_to_you" : "held";
  if (occupant.state === "held") return mine2 ? "held_by_you" : "held";
  return mine2 ? "yours" : "sold";
}
async function waitlistPosition(db, entryId) {
  const row = await oneRow(
    db,
    `SELECT count(*)::int + 1 AS position FROM waitlist_entries o JOIN waitlist_entries me ON me.id = $1
     WHERE o.tier = me.tier AND o.state = 'waitlisted' AND o.seq < me.seq`,
    [entryId]
  );
  return row.position;
}

// src/server/money.ts
function formatDollars(cents) {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return `${whole.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}
function toDecimal(cents) {
  const sign2 = cents < 0 ? "-" : "";
  const value = Math.abs(cents);
  return `${sign2}${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
function fromDecimal(value) {
  const text2 = String(value);
  const match2 = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text2);
  if (!match2) throw new Error(`Unreadable amount ${text2}`);
  const fraction = (match2[3] ?? "").padEnd(2, "0").slice(0, 2);
  const cents = Number.parseInt(match2[2] ?? "0", 10) * 100 + Number.parseInt(fraction, 10);
  return match2[1] === "-" ? -cents : cents;
}

// src/server/pdf.ts
var FONTS = { title: "/F1", body: "/F2", bold: "/F3" };
function escape(text2) {
  return text2.normalize("NFKD").replace(/[^\x20-\x7e]/g, (c) => c === "\u2013" || c === "\u2014" ? "-" : "").replace(/[\\()]/g, (c) => `\\${c}`);
}
function renderPdf(lines) {
  let y = 760;
  const ops = [];
  for (const line of lines) {
    const size = line.size ?? 11;
    y -= line.gap ?? size * 1.5;
    ops.push(`BT ${FONTS[line.font ?? "body"]} ${size} Tf 64 ${Math.round(y)} Td (${escape(line.text)}) Tj ET`);
  }
  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>
stream
${stream}
endstream`
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj
${object}
endobj
`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref
0 ${objects.length + 1}
0000000000 65535 f 
`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n 
`).join("");
  body += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF
`;
  return Buffer.from(body, "latin1");
}

// src/server/documents.ts
var EVENT = {
  title: "Layered Composite Masterclass",
  dates: "Friday 16 and Saturday 17 April 2027",
  venue: "The Opaline Lab, 1460 West Kinzie Street, Chicago, Illinois",
  director: "Dr. Celeste Marrow-Ibarra",
  provider: "Opaline Institute",
  providerId: "OI-PACE-219874",
  format: "Lecture and participation (hands-on)",
  credits: "16 credits",
  subject: "250 Operative (restorative) dentistry"
};
var RECEIPT_TITLE = {
  deposit: "Deposit receipt",
  balance: "Balance receipt",
  full: "Paid-in-full receipt",
  upgrade: "Atelier upgrade receipt",
  group: "Group invoice"
};
var header2 = (title) => [
  { text: "Opaline Bench Days", font: "title", size: 26, gap: 0 },
  { text: `${EVENT.title}  |  ${EVENT.dates}  |  Chicago, Illinois`, size: 10, gap: 22 },
  { text: title, font: "bold", size: 16, gap: 40 }
];
function receiptPdf(kind, billingName, seats, issued) {
  const total = seats.reduce((sum, seat) => sum + seat.amountCents, 0);
  return renderPdf([
    ...header2(RECEIPT_TITLE[kind] ?? "Receipt"),
    { text: `Billed to ${billingName}`, gap: 28 },
    { text: `Issued ${issued.toISOString().slice(0, 10)}` },
    ...seats.flatMap((seat) => [
      { text: `Bench ${seat.bench}  -  ${TIER_NAME[tierOf(seat.bench)]} tier  -  $${formatDollars(seat.amountCents)}`, font: "bold", gap: 28 },
      { text: `Attendee: ${seat.attendee ?? "Unassigned"}` }
    ]),
    { text: `Total paid  $${formatDollars(total)}`, font: "bold", size: 14, gap: 36 },
    { text: "Recorded in Kill Bill against the external payment method. Questions: registrar@opaline-institute.test", size: 9, gap: 40 }
  ]);
}
function visaLetterPdf(passport, bench, issued) {
  return renderPdf([
    ...header2("Visa-support letter"),
    { text: `Date: ${issued.toISOString().slice(0, 10)}`, gap: 28 },
    { text: "To the consular officer concerned,", gap: 28 },
    { text: `This letter confirms that ${passport.fullName}, a national of ${passport.nationality},` },
    { text: `holder of passport number ${passport.number}, holds a confirmed seat (Bench ${bench}) at the` },
    { text: `${EVENT.title}, a live continuing-education course held on ${EVENT.dates}` },
    { text: `at ${EVENT.venue}.` },
    { text: `The course is provided by ${EVENT.provider} (provider ID ${EVENT.providerId}).`, gap: 28 },
    { text: "The attendee is responsible for their own travel, lodging and living costs.", gap: 22 },
    { text: "Sincerely,", gap: 36 },
    { text: EVENT.director, font: "bold" },
    { text: `Course director, ${EVENT.provider}` }
  ]);
}
function certificatePdf(cert) {
  return renderPdf([
    ...header2("Certificate of continuing education"),
    { text: "This certifies that", gap: 30 },
    { text: cert.attendee, font: "title", size: 24, gap: 34 },
    { text: `Licence ${cert.licenceNumber}, issued by ${cert.licenceState}`, gap: 24 },
    { text: `attended ${EVENT.title}`, gap: 26 },
    { text: `Dates: 16 and 17 April 2027` },
    { text: "Location: Chicago, Illinois" },
    { text: `Educational format: ${EVENT.format}` },
    { text: `Credits: ${EVENT.credits}` },
    { text: `Subject code: ${EVENT.subject}` },
    { text: `Provider: ${EVENT.provider}, provider ID ${EVENT.providerId}`, gap: 24 },
    { text: `Certificate number: ${cert.number}`, font: "bold", gap: 26 },
    { text: `Course director: ${EVENT.director}`, gap: 36 }
  ]);
}

// src/server/killbill.ts
var AUTO_PAY_OFF = "00000000-0000-0000-0000-000000000001";
var EXTERNAL_PAYMENT = "__EXTERNAL_PAYMENT__";
var INVOICE_CONTROL = "__INVOICE_PAYMENT_CONTROL_PLUGIN__";
function billingUnavailable() {
  return new ApiError(503, "billing_unavailable", "Billing is offline right now.");
}
async function call2(method, path, body) {
  const auth = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString("base64");
  let response;
  try {
    response = await fetch(`${config.killbill.url}/1.0/kb${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "X-Killbill-ApiKey": config.killbill.apiKey,
        "X-Killbill-ApiSecret": config.killbill.apiSecret,
        "X-Killbill-CreatedBy": "opaline-bench-days",
        Accept: "application/json",
        ...body === void 0 ? {} : { "Content-Type": "application/json" }
      },
      body: body === void 0 ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(2e4)
    });
  } catch {
    throw billingUnavailable();
  }
  if (response.status >= 500) throw billingUnavailable();
  return response;
}
async function json(method, path, body) {
  const response = await call2(method, path, body);
  if (!response.ok) throw billingUnavailable();
  return await response.json();
}
async function maybe(path) {
  const response = await call2("GET", path);
  if (response.status === 404) return null;
  if (!response.ok) throw billingUnavailable();
  return await response.json();
}
async function accountByKey(externalKey2) {
  return maybe(`/accounts?externalKey=${encodeURIComponent(externalKey2)}`);
}
function accountKey(accountId) {
  return `ob-${accountId}`;
}
async function ensureAccount(buyer) {
  const externalKey2 = accountKey(buyer.id);
  let account = await accountByKey(externalKey2);
  if (!account) {
    await call2("POST", "/accounts", { name: buyer.name, email: buyer.email, currency: "USD", externalKey: externalKey2 });
    account = await accountByKey(externalKey2);
    if (!account) throw billingUnavailable();
  }
  if (!account.paymentMethodId) {
    await call2("POST", `/accounts/${account.accountId}/tags`, [AUTO_PAY_OFF]);
    const created = await call2("POST", `/accounts/${account.accountId}/paymentMethods?isDefault=true`, { pluginName: EXTERNAL_PAYMENT });
    if (!created.ok && created.status !== 409) throw billingUnavailable();
  }
  return account.accountId;
}
async function createInvoice(accountId, items) {
  const created = await json(
    "POST",
    `/invoices/charges/${accountId}?autoCommit=true`,
    items.map((item) => ({ accountId, amount: toDecimal(item.amountCents), currency: "USD", description: item.description }))
  );
  const itemIds = items.map((item) => created.find((c) => c.description === item.description)?.invoiceItemId);
  const invoiceId = created[0]?.invoiceId;
  if (!invoiceId || itemIds.some((id) => id === void 0)) throw billingUnavailable();
  return { invoiceId, itemIds: itemIds.filter((id) => id !== void 0) };
}
async function paymentByKey(externalKey2) {
  return maybe(`/payments?externalKey=${encodeURIComponent(externalKey2)}`);
}
function succeeded(payment, type, transactionKey) {
  return payment.transactions.some(
    (t) => t.transactionType === type && t.transactionExternalKey === transactionKey && t.status === "SUCCESS"
  );
}
async function purchase(accountId, invoiceId, amountCents, externalKey2) {
  const query = `controlPluginName=${INVOICE_CONTROL}&pluginProperty=${encodeURIComponent(`IPCD_INVOICE_ID=${invoiceId}`)}`;
  const response = await call2("POST", `/accounts/${accountId}/payments?${query}`, {
    transactionType: "PURCHASE",
    amount: toDecimal(amountCents),
    currency: "USD",
    paymentExternalKey: externalKey2,
    transactionExternalKey: externalKey2
  });
  const payment = await paymentByKey(externalKey2);
  if (!response.ok || !payment || !succeeded(payment, "PURCHASE", externalKey2)) throw billingUnavailable();
  return payment;
}
async function refund(paymentId, amountCents, invoiceItemId, transactionKey) {
  const amount = toDecimal(amountCents);
  const response = await call2("POST", `/invoicePayments/${paymentId}/refunds`, {
    amount,
    currency: "USD",
    isAdjusted: true,
    adjustments: [{ invoiceItemId, amount, currency: "USD" }],
    transactionExternalKey: transactionKey
  });
  if (!response.ok) throw billingUnavailable();
}
async function accountTransactions(appAccountId) {
  const account = await accountByKey(accountKey(appAccountId));
  const found = /* @__PURE__ */ new Map();
  if (!account) return found;
  const payments = await json("GET", `/accounts/${account.accountId}/payments`);
  for (const payment of payments) {
    for (const t of payment.transactions) {
      if (t.status === "SUCCESS") found.set(t.transactionExternalKey, { type: t.transactionType, cents: fromDecimal(t.amount) });
    }
  }
  return found;
}

// src/server/s3.ts
import { createHash as createHash3, createHmac } from "node:crypto";
var LINK_SECONDS = 60;
var EMPTY_SHA = createHash3("sha256").update("").digest("hex");
function unavailable2() {
  return new ApiError(503, "storage_unavailable", "Storage is unavailable right now.");
}
function encodePath(path) {
  return path.split("/").map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}
function target(key) {
  const endpoint = new URL(config.s3.endpoint);
  const objectPath = key ? `/${encodePath(key)}` : "";
  if (config.s3.forcePathStyle) {
    const canonicalPath2 = `/${config.s3.bucket}${objectPath}`;
    return { url: new URL(`${endpoint.origin}${canonicalPath2}`), canonicalPath: canonicalPath2 };
  }
  const canonicalPath = objectPath || "/";
  return { url: new URL(`${endpoint.protocol}//${config.s3.bucket}.${endpoint.host}${canonicalPath}`), canonicalPath };
}
function stamp(now) {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amzDate, day: amzDate.slice(0, 8) };
}
function signingKey(day) {
  let key = createHmac("sha256", `AWS4${config.s3.secretAccessKey}`).update(day).digest();
  for (const part of [config.s3.region, "s3", "aws4_request"]) key = createHmac("sha256", key).update(part).digest();
  return key;
}
function sign(day, amzDate, canonical) {
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256
${amzDate}
${scope}
${createHash3("sha256").update(canonical).digest("hex")}`;
  return createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
}
async function send(method, key, body) {
  const { url, canonicalPath } = target(key);
  const { amzDate, day } = stamp(/* @__PURE__ */ new Date());
  const payloadHash = body ? createHash3("sha256").update(body.bytes).digest("hex") : EMPTY_SHA;
  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  if (body) headers["content-type"] = body.contentType;
  const names = Object.keys(headers).sort();
  const canonical = [method, canonicalPath, "", names.map((n) => `${n}:${headers[n]}
`).join(""), names.join(";"), payloadHash].join("\n");
  const credential = `${config.s3.accessKeyId}/${day}/${config.s3.region}/s3/aws4_request`;
  const authorization = `AWS4-HMAC-SHA256 Credential=${credential}, SignedHeaders=${names.join(";")}, Signature=${sign(day, amzDate, canonical)}`;
  const { host: _host, ...sent } = headers;
  try {
    return await fetch(url, {
      method,
      headers: { ...sent, Authorization: authorization },
      body: body ? new Uint8Array(body.bytes) : null,
      signal: AbortSignal.timeout(2e4)
    });
  } catch {
    throw unavailable2();
  }
}
var bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const head = await send("HEAD", "");
  if (head.status === 404) {
    const created = await send("PUT", "");
    if (!created.ok && created.status !== 409) throw unavailable2();
  } else if (!head.ok) {
    throw unavailable2();
  }
  bucketReady = true;
}
async function putObject(key, bytes, contentType) {
  await ensureBucket();
  const response = await send("PUT", key, { bytes, contentType });
  if (!response.ok) throw unavailable2();
}
async function deleteObject(key) {
  const response = await send("DELETE", key);
  if (!response.ok && response.status !== 404) throw unavailable2();
}
async function objectExists(key) {
  const response = await send("HEAD", key);
  if (response.status === 404) return false;
  if (!response.ok) throw unavailable2();
  return true;
}
function signedLink(key) {
  const { url, canonicalPath } = target(key);
  const { amzDate, day } = stamp(/* @__PURE__ */ new Date());
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.s3.accessKeyId}/${day}/${config.s3.region}/s3/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(LINK_SECONDS),
    "X-Amz-SignedHeaders": "host"
  });
  query.sort();
  const canonicalQuery = query.toString().replace(/\+/g, "%20");
  const canonical = ["GET", canonicalPath, canonicalQuery, `host:${url.host}
`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${sign(day, amzDate, canonical)}`;
}

// src/server/payments.ts
var ITEM_WORD = {
  deposit: "deposit",
  balance: "balance",
  full: "full price",
  upgrade: "upgrade",
  group: "full price"
};
function externalKey(kind, ownerId) {
  return `ob-${kind}-${ownerId}`;
}
function refundKeyPrefix(reservationId) {
  return `ob-refund-${reservationId}-`;
}
function kbBuyer(row) {
  return { id: row.buyer_id, name: buyerName(row), email: row.buyer_email };
}
async function paymentRecord(charge2) {
  const total = charge2.items.reduce((sum, item) => sum + item.amountCents, 0);
  const payment = await oneRow(
    pool,
    `INSERT INTO payments (id, external_key, kind, owner_id, amount_cents, billing_name) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (external_key) DO UPDATE SET billing_name = EXCLUDED.billing_name RETURNING *`,
    [newId("pay"), externalKey(charge2.kind, charge2.ownerId), charge2.kind, charge2.ownerId, total, charge2.billingName]
  );
  for (const item of charge2.items) {
    await pool.query(
      `INSERT INTO payment_items (payment_id, reservation_id, bench, amount_cents) VALUES ($1, $2, $3, $4)
       ON CONFLICT (payment_id, reservation_id) DO NOTHING`,
      [payment.id, item.reservationId, item.bench, item.amountCents]
    );
  }
  return payment;
}
async function charge(db, request) {
  const payment = await paymentRecord(request);
  const accountId = await ensureAccount(request.buyer);
  let confirmed = await paymentByKey(payment.external_key);
  if (!confirmed || !succeeded(confirmed, "PURCHASE", payment.external_key)) {
    let invoiceId = payment.kb_invoice_id;
    if (!invoiceId) {
      const invoice = await createInvoice(
        accountId,
        request.items.map((item) => ({
          amountCents: item.amountCents,
          description: `Bench ${item.bench} ${TIER_NAME[tierOf(item.bench)]} ${ITEM_WORD[request.kind]}`
        }))
      );
      invoiceId = invoice.invoiceId;
      await pool.query("UPDATE payments SET kb_account_id = $2, kb_invoice_id = $3 WHERE id = $1", [payment.id, accountId, invoiceId]);
      for (const [index, item] of request.items.entries()) {
        await pool.query("UPDATE payment_items SET kb_invoice_item_id = $3 WHERE payment_id = $1 AND reservation_id = $2", [
          payment.id,
          item.reservationId,
          invoice.itemIds[index]
        ]);
      }
    }
    confirmed = await purchase(accountId, invoiceId, payment.amount_cents, payment.external_key);
  }
  return oneRow(db, "UPDATE payments SET confirmed_at = COALESCE(confirmed_at, now()), kb_payment_id = $2 WHERE id = $1 RETURNING *", [
    payment.id,
    confirmed.paymentId
  ]);
}
function receiptKey(payment) {
  return payment.kind === "group" ? { kind: "invoice", key: `receipts/groups/${payment.owner_id}/invoice.pdf` } : { kind: `${payment.kind}-receipt`, key: `receipts/${payment.owner_id}/${payment.kind}.pdf` };
}
async function settle(db, payment, now) {
  const items = await many(
    db,
    "SELECT reservation_id, bench, amount_cents FROM payment_items WHERE payment_id = $1 ORDER BY bench",
    [payment.id]
  );
  const seats = await reservationsWhere(db, "r.id = ANY($1)", [items.map((item) => item.reservation_id)]);
  const receipt = receiptKey(payment);
  try {
    const pdf = receiptPdf(
      payment.kind,
      payment.billing_name,
      items.map((item) => ({
        bench: item.bench,
        amountCents: item.amount_cents,
        attendee: seats.find((seat) => seat.id === item.reservation_id)?.attendee_name ?? null
      })),
      now
    );
    await putObject(receipt.key, pdf, "application/pdf");
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "storage_unavailable") throw error;
    await db.query("UPDATE reservations SET payment_pending = $2 WHERE id = ANY($1)", [seats.map((seat) => seat.id), payment.kind]);
    await db.query("UPDATE payments SET retry_after = now() + random() * interval '4 seconds' WHERE id = $1", [payment.id]);
    return false;
  }
  await db.query("INSERT INTO documents (owner_id, kind, object_key) VALUES ($1, $2, $3) ON CONFLICT (owner_id, kind) DO NOTHING", [
    payment.owner_id,
    receipt.kind,
    receipt.key
  ]);
  const buyer = await oneRow(
    db,
    `SELECT a.email FROM payment_items pi JOIN reservations r ON r.id = pi.reservation_id JOIN accounts a ON a.id = r.buyer_id
     WHERE pi.payment_id = $1 LIMIT 1`,
    [payment.id]
  );
  await enqueueMail(db, `receipt:${payment.id}`, receiptMail(payment, buyer.email, seats, items.map((item) => item.bench)));
  await finalize(db, payment, seats, now);
  await db.query("UPDATE payments SET finalized_at = now() WHERE id = $1", [payment.id]);
  return true;
}
function receiptMail(payment, to, seats, benches) {
  const bench = benches.join(", ");
  const footer = "\n\nYour receipt and seat details are in your account: /account\n\nOpaline Bench Days";
  switch (payment.kind) {
    case "deposit":
      return { to, subject: `Deposit received: Bench ${bench} is yours`, body: `We received your deposit of $${formatDollars(payment.amount_cents)} for Bench ${bench}.${footer}` };
    case "balance":
    case "full":
      return { to, subject: `Paid in full: Bench ${bench}`, body: `Bench ${bench} is paid in full. Thank you.${footer}` };
    case "upgrade":
      return { to, subject: `Upgrade confirmed: Bench ${bench} is Atelier`, body: `Your seat is now Bench ${bench}, an Atelier bench. We charged $${formatDollars(payment.amount_cents)}.${footer}` };
    case "group": {
      const lines = seats.map((seat) => `Bench ${seat.bench}: ${seat.attendee_name ?? "Unassigned"}`);
      return {
        to,
        subject: `Group invoice paid: ${seats.length} seats`,
        body: `Your group invoice of $${formatDollars(payment.amount_cents)} is paid.

${lines.join("\n")}${footer}`
      };
    }
  }
}
async function finalize(db, payment, seats, now) {
  const clearHold = { hold_expires_at: null, hold_duration: null, payment_pending: null };
  switch (payment.kind) {
    case "deposit":
      return transition(db, seats, "deposit_paid", clearHold);
    case "full":
    case "balance":
      return transition(db, seats, "paid_in_full", clearHold);
    case "group":
      await transition(db, seats, "paid_in_full", clearHold);
      for (const seat of seats) {
        if (seat.attendee_email) await queueAssignmentMail(db, seat, seat.attendee_email);
      }
      return;
    case "upgrade":
      await db.query("UPDATE reservations SET bench = upgrade_target, upgrade_target = NULL, payment_pending = NULL WHERE id = ANY($1)", [
        seats.map((seat) => seat.id)
      ]);
      await offerFreedBenches(db, now, seats.map((seat) => seat.bench));
  }
}
async function queueAssignmentMail(db, seat, email2) {
  const from = buyerName(seat);
  await enqueueMail(db, `assign:${seat.id}:${newId("mail")}`, {
    to: email2,
    subject: `${from} assigned you Bench ${seat.bench} at Opaline Bench Days`,
    body: `${from} has given you a seat at the Layered Composite Masterclass on 16 and 17 April 2027 in Chicago.

Create an account or sign in with this email address, then accept the seat at /account.

Opaline Bench Days`
  });
}
var receiptBackoffUntil = 0;
async function retryPendingReceipts() {
  if (Date.now() < receiptBackoffUntil) return;
  const due = await many(
    pool,
    "SELECT id, kind FROM payments WHERE confirmed_at IS NOT NULL AND finalized_at IS NULL AND retry_after <= now() ORDER BY created_at LIMIT 20"
  );
  for (const candidate of due) {
    await tx(async (db) => {
      if (candidate.kind === "upgrade") await lockLedger(db);
      const payment = await one(db, "SELECT * FROM payments WHERE id = $1 AND finalized_at IS NULL FOR UPDATE SKIP LOCKED", [candidate.id]);
      if (!payment) return;
      const locked = await many(
        db,
        `SELECT r.id FROM reservations r JOIN payment_items pi ON pi.reservation_id = r.id
         WHERE pi.payment_id = $1 ORDER BY r.id FOR NO KEY UPDATE OF r SKIP LOCKED`,
        [payment.id]
      );
      const items = await oneRow(db, "SELECT count(*)::int AS n FROM payment_items WHERE payment_id = $1", [payment.id]);
      if (locked.length === items.n && !await settle(db, payment, /* @__PURE__ */ new Date())) receiptBackoffUntil = Date.now() + 6e3;
    });
  }
}
async function refundSeat(db, seat) {
  const paid = await many(
    db,
    `SELECT p.id, p.external_key, pi.amount_cents AS seat_cents, pi.kb_invoice_item_id AS item_id
     FROM payment_items pi JOIN payments p ON p.id = pi.payment_id
     WHERE pi.reservation_id = $1 AND p.confirmed_at IS NOT NULL ORDER BY p.confirmed_at DESC, p.created_at DESC`,
    [seat.id]
  );
  const due = seat.refund_due_cents ?? 0;
  let left = due;
  const keys = [];
  for (const payment of paid) {
    const part = Math.min(left, payment.seat_cents);
    if (part <= 0) break;
    const n = keys.length + 1;
    const key = `${refundKeyPrefix(seat.id)}${n}`;
    const recorded = await paymentByKey(payment.external_key);
    if (!recorded) throw billingUnavailable();
    if (!succeeded(recorded, "REFUND", key)) await refund(recorded.paymentId, part, payment.item_id, key);
    await db.query(
      `INSERT INTO refunds (reservation_id, n, payment_id, amount_cents, external_key, confirmed_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (reservation_id, n) DO NOTHING`,
      [seat.id, n, payment.id, part, key]
    );
    keys.push(key);
    left -= part;
  }
  return { amountCents: due, transactionKeys: keys };
}

// src/server/views.ts
async function freshLedger(now) {
  const due = await one(
    pool,
    `SELECT EXISTS (SELECT 1 FROM reservations WHERE state = 'held' AND hold_expires_at <= $1 AND payment_pending IS NULL)
         OR EXISTS (SELECT 1 FROM waitlist_entries WHERE state = 'offered' AND offer_expires_at <= $1) AS due`,
    [now]
  );
  if (!due?.due) return;
  await tx(async (db) => {
    await lockLedger(db);
    await sweep(db, now);
  });
}
async function groupView(db, groupId, now) {
  const rows = await reservationsWhere(db, "r.group_id = $1", [groupId]);
  if (!rows.length) throw notFound();
  const payment = await one(
    db,
    "SELECT id, kb_invoice_id FROM payments WHERE owner_id = $1 AND kind = 'group' AND confirmed_at IS NOT NULL",
    [groupId]
  );
  const items = payment ? await many(
    db,
    `SELECT pi.bench, pi.amount_cents - COALESCE((SELECT sum(f.amount_cents) FROM refunds f
                 WHERE f.payment_id = pi.payment_id AND f.reservation_id = pi.reservation_id AND f.confirmed_at IS NOT NULL), 0)::bigint AS amount_cents
         FROM payment_items pi WHERE pi.payment_id = $1 ORDER BY pi.bench`,
    [payment.id]
  ) : [];
  const state = rows.some((row) => row.state === "held") ? "held" : rows.every((row) => row.state === "released") ? "released" : "paid_in_full";
  return {
    id: groupId,
    state,
    reservations: rows.map((row) => reservationView(row, now)),
    invoice: payment ? { kb_invoice_id: payment.kb_invoice_id, items, total_cents: items.reduce((sum, item) => sum + item.amount_cents, 0) } : null
  };
}

// src/server/workers.ts
async function sendBalanceReminders() {
  const due = reminderDue(venueToday(/* @__PURE__ */ new Date()));
  if (!due) return;
  await tx(async (db) => {
    const seats = await many(
      db,
      `SELECT r.id, r.bench, a.email FROM reservations r JOIN accounts a ON a.id = r.buyer_id
       WHERE r.state = 'deposit_paid' AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.dedupe_key = 'reminder-7:' || r.id)`
    );
    for (const seat of seats) {
      await enqueueMail(db, `reminder-${due}:${seat.id}`, {
        to: seat.email,
        subject: `Balance reminder: ${due} days to pay for Bench ${seat.bench}`,
        body: `The balance for Bench ${seat.bench} is due on 19 March 2027.

Pay it from your account: /account

Opaline Bench Days`
      });
    }
  });
}
function every(milliseconds, job) {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    job().catch((error) => console.error(`background job failed: ${error instanceof Error ? error.message : "unknown error"}`)).finally(() => {
      running = false;
    });
  }, milliseconds).unref();
}
function startWorkers() {
  every(1e3, () => freshLedger(/* @__PURE__ */ new Date()));
  every(2e3, drainOutbox);
  every(2e3, retryPendingReceipts);
  every(2e4, sendBalanceReminders);
}

// src/server/validate.ts
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function fields(body) {
  return body !== null && typeof body === "object" && !Array.isArray(body) ? body : {};
}
function text(value, min, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}
function email(value) {
  const found = text(value, 3, 254);
  return found && EMAIL.test(found) ? found : null;
}
function integer(value, min, max) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

// src/server/routes/accounts.ts
publicRoute({
  method: "POST",
  path: "/api/auth/signup",
  handle: async (ctx) => {
    const body = fields(ctx.body);
    const name = text(body.name, 1, 120);
    const address2 = email(body.email);
    const password = typeof body.password === "string" && body.password.length >= 10 && body.password.length <= 128 ? body.password : null;
    const kind = body.kind === "practitioner" || body.kind === "clinic" ? body.kind : null;
    const clinicName = kind === "clinic" ? text(body.clinic_name, 1, 120) : null;
    return tx(async (db) => {
      if (address2 && await findAccountByEmail(db, address2)) throw conflict("email_taken", "An account with this email already exists.");
      const errors = {};
      if (!name) errors.name = "Enter your name (1 to 120 characters).";
      if (!address2) errors.email = "Enter a valid email address.";
      if (!password) errors.password = "Use 10 to 128 characters.";
      if (!kind) errors.kind = "Choose Practitioner or Clinic.";
      if (kind === "clinic" && !clinicName) errors.clinic_name = "Enter the clinic name (1 to 120 characters).";
      if (!name || !address2 || !password || !kind || Object.keys(errors).length) throw validation(errors);
      const account = await insertAccount(db, { name, email: address2, password, role: kind, clinicName });
      if (!account) throw conflict("email_taken", "An account with this email already exists.");
      const token2 = await createSession(db, account.id);
      return { status: 201, body: { account: accountView(account) }, headers: { "Set-Cookie": sessionCookie(token2) } };
    });
  }
});
publicRoute({
  method: "POST",
  path: "/api/auth/signin",
  handle: async (ctx) => {
    const body = fields(ctx.body);
    const address2 = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    return tx(async (db) => {
      const account = address2 ? await findAccountByEmail(db, address2) : null;
      if (!account || !await passwordMatches(password, account.password_hash)) {
        throw new ApiError(401, "invalid_credentials", "Email or password is incorrect.");
      }
      const token2 = await createSession(db, account.id);
      return { status: 200, body: { account: accountView(account) }, headers: { "Set-Cookie": sessionCookie(token2) } };
    });
  }
});
publicRoute({
  method: "POST",
  path: "/api/auth/signout",
  handle: async (ctx) => {
    await endSession(sessionToken(ctx.req));
    return { status: 204, headers: { "Set-Cookie": CLEARED_COOKIE } };
  }
});
async function mine(account) {
  return reservationsWhere(
    pool,
    `r.buyer_id = $1 OR (r.attendee_accepted AND r.attendee_account_id = $1)
       OR ($2 AND NOT r.attendee_accepted AND lower(r.attendee_email) = $3 AND r.state = ANY($4))`,
    [account.id, account.role === "practitioner", account.email_key, SOLD_STATES]
  );
}
route({
  method: "GET",
  path: "/api/me",
  access: "signed-in",
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const { account, now } = ctx;
    const rows = await mine(account);
    const groupIds = await many(pool, "SELECT id FROM groups WHERE buyer_id = $1 ORDER BY created_at", [account.id]);
    const entries = await many(
      pool,
      "SELECT id, tier, state, bench, offer_expires_at FROM waitlist_entries WHERE account_id = $1 ORDER BY seq",
      [account.id]
    );
    const waiting = entries.find((entry) => entry.state === "waitlisted");
    return {
      status: 200,
      body: {
        account: accountView(account),
        reservations: rows.map((row) => ({
          ...reservationView(row, now),
          relationship: [isBuyer(row, account) && "buyer", isAttendee(row, account) && "attendee", isAssignee(row, account) && "assignee"].filter(Boolean)
        })),
        groups: await Promise.all(groupIds.map((group) => groupView(pool, group.id, now))),
        waitlist: waiting ? { tier: waiting.tier, position: await waitlistPosition(pool, waiting.id) } : null,
        offers: entries.filter((entry) => entry.bench !== null).map((entry) => ({
          id: entry.id,
          bench: entry.bench,
          tier: entry.tier,
          state: entry.state,
          seconds_remaining: entry.state === "offered" && entry.offer_expires_at ? Math.max(0, Math.ceil((entry.offer_expires_at.getTime() - now.getTime()) / 1e3)) : 0
        })),
        venue_date: venueToday(now),
        deposits_open: depositsOpen(venueToday(now)),
        server_time: now.toISOString()
      }
    };
  }
});

// src/server/routes/benches.ts
publicRoute({
  method: "GET",
  path: "/api/benches",
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const stock = await currentInventory(pool);
    const viewer = ctx.account?.id ?? null;
    const today = venueToday(ctx.now);
    return {
      status: 200,
      body: {
        server_time: ctx.now.toISOString(),
        venue_date: today,
        deposits_open: depositsOpen(today),
        seats_total: SEATS_TOTAL,
        seats_remaining: stock.seatsRemaining,
        held: stock.held,
        sold: stock.sold,
        tiers: {
          bench: { remaining: stock.benchRemaining },
          atelier: { remaining: stock.atelier.remaining, cap: stock.atelier.cap, active: stock.atelier.active, sold_out: stock.atelier.soldOut }
        },
        benches: BENCH_LABELS.map((label) => ({
          label,
          row: label.slice(0, 1),
          number: Number.parseInt(label.slice(1), 10),
          tier: tierOf(label),
          state: benchState(stock.occupied.get(label), viewer)
        }))
      }
    };
  }
});

// src/server/routes/reservations.ts
async function attendsASeat(db, accountId, except = null) {
  const found = await one(
    db,
    `SELECT EXISTS (SELECT 1 FROM reservations WHERE state = ANY($2) AND attendee_accepted AND attendee_account_id = $1
                    AND id IS DISTINCT FROM $3) AS yes`,
    [accountId, ACTIVE_STATES, except]
  );
  return found?.yes ?? false;
}
async function alreadyReserved(db, account) {
  const found = await one(
    db,
    `SELECT EXISTS (SELECT 1 FROM reservations WHERE buyer_id = $1 AND state = ANY($2))
         OR EXISTS (SELECT 1 FROM waitlist_entries WHERE account_id = $1 AND state IN ('waitlisted', 'offered')) AS yes`,
    [account.id, ACTIVE_STATES]
  );
  return (found?.yes ?? false) || await attendsASeat(db, account.id);
}
async function insertHolds(db, account, labels, groupId, now) {
  const expires = new Date(now.getTime() + config.holdSeconds * 1e3);
  const practitioner = account.role === "practitioner";
  const ids = [];
  for (const bench of labels) {
    const id = newId("res");
    await db.query(
      `INSERT INTO reservations (id, bench, state, group_id, buyer_id, attendee_name, attendee_email, attendee_account_id,
                                 attendee_accepted, hold_expires_at, hold_duration)
       VALUES ($1, $2, 'held', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        bench,
        groupId,
        account.id,
        practitioner ? account.name : null,
        practitioner ? account.email : null,
        practitioner ? account.id : null,
        practitioner,
        expires,
        config.holdSeconds
      ]
    );
    ids.push(id);
  }
  return ids;
}
route({
  method: "POST",
  path: "/api/holds",
  access: BUYER_ROLES,
  handle: (ctx) => tx(async (db) => {
    const { account, now } = ctx;
    await lockLedger(db);
    await sweep(db, now);
    const raw = fields(ctx.body).benches;
    const requested = Array.isArray(raw) ? raw : null;
    const labels = [...new Set((requested ?? []).filter(isBenchLabel))];
    if (account.role === "practitioner" && await alreadyReserved(db, account)) {
      throw conflict("already_reserved", "You already have a bench, an offer or a waitlist place.");
    }
    if (account.role === "clinic") {
      const live = await one(db, "SELECT 1 FROM reservations WHERE buyer_id = $1 AND state = 'held' AND group_id IS NOT NULL", [account.id]);
      if (live) throw conflict("hold_limit", "Your clinic already has a live group hold.");
    }
    const stock = await currentInventory(db);
    const taken = labels.find((label) => stock.occupied.has(label));
    if (taken) {
      const tier = tierOf(taken);
      throw conflict("bench_taken", `Bench ${taken} was just taken.`, { waitlist: { tier, open: tierRemaining(stock, tier) === 0 } });
    }
    const atelierWanted = labels.filter((label) => tierOf(label) === "atelier").length;
    if (atelierWanted > atelierRoom(stock.atelier.active)) {
      throw conflict("atelier_sold_out", "Atelier is sold out.", { waitlist: { tier: "atelier", open: stock.atelier.remaining === 0 } });
    }
    const most = account.role === "practitioner" ? 1 : MAX_GROUP_BENCHES;
    if (!requested || requested.length === 0 || labels.length !== requested.length || requested.length > most) {
      throw validation({ benches: `Choose 1 to ${most} different benches from A1 to D6.` });
    }
    const groupId = account.role === "clinic" ? newId("grp") : null;
    if (groupId) await db.query("INSERT INTO groups (id, buyer_id) VALUES ($1, $2)", [groupId, account.id]);
    const ids = await insertHolds(db, account, labels, groupId, now);
    const rows = await reservationsWhere(db, "r.id = ANY($1)", [ids]);
    return {
      status: 201,
      body: {
        reservations: rows.map((row) => reservationView(row, now)),
        group_id: groupId,
        seats_remaining: (await currentInventory(db)).seatsRemaining,
        server_time: now.toISOString()
      }
    };
  })
});
async function releaseRows(db, rows, now) {
  if (rows.some((row) => row.payment_pending)) throw conflict("invalid_transition", "This payment is being confirmed.");
  await transition(db, rows, "released", { hold_expires_at: null });
  await offerFreedBenches(db, now, rows.map((row) => row.bench));
}
route({
  method: "POST",
  path: "/api/reservations/:id/release",
  access: BUYER_ROLES,
  handle: (ctx) => tx(async (db) => {
    await lockLedger(db);
    await sweep(db, ctx.now);
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
    if (row.group_id) throw conflict("invalid_transition", "Group benches are released together.");
    await releaseRows(db, [row], ctx.now);
    return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now), seats_remaining: (await currentInventory(db)).seatsRemaining } };
  })
});
async function ownedGroup(db, groupId, account) {
  const group = await one(db, "SELECT buyer_id FROM groups WHERE id = $1", [groupId]);
  if (!group || group.buyer_id !== account.id && account.role !== "registrar") throw notFound();
  return reservationsWhere(db, "r.group_id = $1", [groupId]);
}
route({
  method: "POST",
  path: "/api/groups/:id/release",
  access: BUYER_ROLES,
  handle: (ctx) => tx(async (db) => {
    await lockLedger(db);
    await sweep(db, ctx.now);
    const groupId = ctx.params.id ?? "";
    const seats = await ownedGroup(db, groupId, ctx.account);
    await lockReservations(db, seats.map((seat) => seat.id));
    await releaseRows(db, await reservationsWhere(db, "r.group_id = $1", [groupId]), ctx.now);
    return { status: 200, body: { group: await groupView(db, groupId, ctx.now), seats_remaining: (await currentInventory(db)).seatsRemaining } };
  })
});
route({
  method: "GET",
  path: "/api/reservations/:id",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const row = await visibleReservation(pool, ctx.params.id ?? "", ctx.account, ["buyer", "attendee", "registrar"]);
    return { status: 200, body: { reservation: reservationView(row, ctx.now), server_time: ctx.now.toISOString() } };
  }
});
route({
  method: "GET",
  path: "/api/groups/:id",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    return tx(async (db) => {
      const groupId = ctx.params.id ?? "";
      await ownedGroup(db, groupId, ctx.account);
      return { status: 200, body: { group: await groupView(db, groupId, ctx.now) } };
    });
  }
});
route({
  method: "POST",
  path: "/api/reservations/:id/cancel",
  access: BUYER_ROLES,
  handle: (ctx) => tx(async (db) => {
    await lockLedger(db);
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
    assertMove(row.state, "cancelled");
    const due = refundDue(row.purchased_cents, venueToday(ctx.now));
    if (due === null) throw conflict("no_refund_window", "Refunds closed on 19 March 2027.");
    await transition(db, [row], "cancelled", { refund_due_cents: due });
    await offerFreedBenches(db, ctx.now, [row.bench]);
    return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
  })
});
route({
  method: "POST",
  path: "/api/waitlist",
  access: ["practitioner"],
  handle: (ctx) => tx(async (db) => {
    await lockLedger(db);
    await sweep(db, ctx.now);
    const tier = fields(ctx.body).tier;
    if (await alreadyReserved(db, ctx.account)) throw conflict("already_reserved", "You already have a bench, an offer or a waitlist place.");
    if (tier !== "bench" && tier !== "atelier") throw validation({ tier: "Choose the Bench or Atelier waitlist." });
    if (tierRemaining(await currentInventory(db), tier) > 0) {
      throw conflict("benches_available", `${TIER_NAME[tier]} benches are open; hold one instead.`);
    }
    const id = newId("off");
    await db.query("INSERT INTO waitlist_entries (id, account_id, tier, state) VALUES ($1, $2, $3, 'waitlisted')", [id, ctx.account.id, tier]);
    return { status: 201, body: { tier, position: await waitlistPosition(db, id) } };
  })
});
route({
  method: "DELETE",
  path: "/api/waitlist",
  access: ["practitioner"],
  handle: async (ctx) => {
    await pool.query("DELETE FROM waitlist_entries WHERE account_id = $1 AND state = 'waitlisted'", [ctx.account.id]);
    return { status: 204 };
  }
});
async function offeredTo(db, offerId, account) {
  const offer = await one(db, "SELECT * FROM waitlist_entries WHERE id = $1 AND bench IS NOT NULL FOR UPDATE", [offerId]);
  if (!offer || offer.account_id !== account.id) throw notFound();
  return offer;
}
function offerView(offer, now) {
  return {
    id: offer.id,
    bench: offer.bench,
    tier: offer.tier,
    state: offer.state,
    seconds_remaining: offer.state === "offered" && offer.offer_expires_at ? Math.max(0, Math.ceil((offer.offer_expires_at.getTime() - now.getTime()) / 1e3)) : 0
  };
}
route({
  method: "POST",
  path: "/api/offers/:id/accept",
  access: BUYER_ROLES,
  handle: (ctx) => tx(async (db) => {
    await lockLedger(db);
    await sweep(db, ctx.now);
    const offer = await offeredTo(db, ctx.params.id ?? "", ctx.account);
    if (offer.state !== "offered" || !offer.bench) throw conflict("offer_lapsed", "This offer has passed to the next person on the waitlist.");
    await db.query("UPDATE waitlist_entries SET state = 'held' WHERE id = $1", [offer.id]);
    const ids = await insertHolds(db, ctx.account, [offer.bench], null, ctx.now);
    const rows = await reservationsWhere(db, "r.id = ANY($1)", [ids]);
    return {
      status: 201,
      body: {
        reservations: rows.map((row) => reservationView(row, ctx.now)),
        seats_remaining: (await currentInventory(db)).seatsRemaining,
        server_time: ctx.now.toISOString()
      }
    };
  })
});
route({
  method: "POST",
  path: "/api/offers/:id/decline",
  access: BUYER_ROLES,
  handle: (ctx) => tx(async (db) => {
    await lockLedger(db);
    await sweep(db, ctx.now);
    const offer = await offeredTo(db, ctx.params.id ?? "", ctx.account);
    if (offer.state !== "offered" || !offer.bench) throw conflict("offer_lapsed", "This offer has already passed on.");
    await db.query("UPDATE waitlist_entries SET state = 'offer_lapsed' WHERE id = $1", [offer.id]);
    await offerFreedBenches(db, ctx.now, [offer.bench]);
    return { status: 200, body: { offer: offerView({ ...offer, state: "offer_lapsed" }, ctx.now) } };
  })
});
route({
  method: "PUT",
  path: "/api/reservations/:id/assignee",
  access: BUYER_ROLES,
  handle: (ctx) => tx(async (db) => {
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
    const body = fields(ctx.body);
    const name = text(body.name, 1, 120);
    const address2 = email(body.email);
    if (row.state !== "deposit_paid" && row.state !== "paid_in_full") {
      throw conflict("invalid_transition", "Seats can be assigned once paid and until day 1 check-in.");
    }
    if (address2) {
      const invitee = await one(db, "SELECT id FROM accounts WHERE email_key = $1", [address2.toLowerCase()]);
      if (invitee && await attendsASeat(db, invitee.id, row.id)) throw conflict("already_attending", "That person already attends another seat.");
    }
    if (!name || !address2) {
      throw validation({ ...name ? {} : { name: "Enter the colleague's name." }, ...address2 ? {} : { email: "Enter a valid email address." } });
    }
    if (row.attendee_email?.toLowerCase() === address2.toLowerCase()) {
      await db.query("UPDATE reservations SET attendee_name = $2 WHERE id = $1", [row.id, name]);
      await queueAssignmentMail(db, row, address2);
      return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
    }
    await db.query(
      `UPDATE reservations SET attendee_name = $2, attendee_email = $3, attendee_account_id = NULL, attendee_accepted = false,
           licence_number = NULL, licence_state = NULL, licence_key = NULL, licence_status = 'none',
           passport_full_name = NULL, passport_nationality = NULL, passport_number = NULL, passport_key = NULL
         WHERE id = $1`,
      [row.id, name, address2]
    );
    const visaLetter = await one(db, "DELETE FROM documents WHERE owner_id = $1 AND kind = 'visa-letter' RETURNING object_key", [row.id]);
    await queueAssignmentMail(db, row, address2);
    for (const key of [row.licence_key, row.passport_key, visaLetter?.object_key]) {
      if (key) await deleteObject(key);
    }
    return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
  })
});
route({
  method: "POST",
  path: "/api/reservations/:id/accept",
  access: BUYER_ROLES,
  handle: (ctx) => tx(async (db) => {
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["assignee"]);
    if (!SOLD_STATES.includes(row.state)) throw conflict("invalid_transition", "This seat can no longer be accepted.");
    if (await attendsASeat(db, ctx.account.id, row.id)) throw conflict("already_attending", "You already attend another seat.");
    await db.query("UPDATE reservations SET attendee_account_id = $2, attendee_accepted = true WHERE id = $1", [row.id, ctx.account.id]);
    return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
  })
});

// src/server/routes/checkout.ts
async function replayOrRefuse(db, ctx) {
  if (keyIsValid(ctx.idempotencyKey)) {
    const replay = await replayOf(db, ctx.account.id, ctx.idempotencyKey, ctx.fingerprint);
    if (replay) return { status: replay.status, body: replay.body };
  }
  await refuseReuse(db, ctx.account.id, ctx.idempotencyKey, ctx.fingerprint);
  return null;
}
function paymentErrors(ctx) {
  const billingName = text(fields(ctx.body).billing_name, 1, 120);
  const errors = {};
  if (!keyIsValid(ctx.idempotencyKey)) Object.assign(errors, KEY_ERROR);
  if (!billingName) errors.billing_name = "Enter the name for the receipt (1 to 120 characters).";
  return { billingName, errors };
}
function billingNameOrRefuse(ctx, extra = {}) {
  const { billingName, errors } = paymentErrors(ctx);
  if (!billingName || Object.keys(errors).length || Object.keys(extra).length) throw validation({ ...errors, ...extra });
  return billingName;
}
function holdLapsed(row, now) {
  return row.state === "released" || row.state === "held" && !row.payment_pending && (row.hold_expires_at?.getTime() ?? 0) <= now.getTime();
}
function seatCheck(kind, row, ctx) {
  if (row.payment_pending && row.payment_pending !== kind) throw conflict("invalid_transition", "Another payment for this seat is being confirmed.");
  if (row.group_id) throw conflict("invalid_transition", "Group seats are paid on the group invoice.");
  if (kind === "balance") {
    if (row.state === "deposit_paid") return;
    if (["paid_in_full", "checked_in_day1", "checked_in_day2", "certificate_issued"].includes(row.state)) {
      throw conflict("already_paid", "This seat is already paid in full.");
    }
    throw conflict("not_deposit_paid", "The balance is due once the deposit is paid.");
  }
  if (row.state !== "held") {
    if (holdLapsed(row, ctx.now)) throw conflict("hold_expired", "This hold has ended.");
    if (row.state === "cancelled" || row.state === "refunded") throw conflict("invalid_transition", "This seat was cancelled.");
    throw conflict("already_paid", "This seat is already paid.");
  }
  if (holdLapsed(row, ctx.now)) throw conflict("hold_expired", "This hold has ended.");
  if (kind === "deposit" && !depositsOpen(venueToday(ctx.now))) {
    throw conflict("deposits_closed", "Deposits closed on 19 March 2027. Pay in full to reserve a bench.");
  }
}
function amountFor(kind, row) {
  if (kind === "balance") return balanceCents(row);
  return kind === "deposit" ? PRICES[tierOf(row.bench)].deposit : PRICES[tierOf(row.bench)].full;
}
async function payOne(db, ctx, kind, row, bench, amountCents, billingName) {
  const payment = await charge(db, { kind, ownerId: row.id, buyer: kbBuyer(row), billingName, items: [{ reservationId: row.id, bench, amountCents }] });
  const done = await settle(db, payment, ctx.now);
  return { status: done ? 201 : 202, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
}
function seatPayment(kind) {
  route({
    method: "POST",
    path: `/api/reservations/:id/${kind}`,
    access: BUYER_ROLES,
    idempotent: true,
    handle: (ctx) => tx(async (db) => {
      const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
      const replay = await replayOrRefuse(db, ctx);
      if (replay) return replay;
      seatCheck(kind, row, ctx);
      const billingName = billingNameOrRefuse(ctx);
      return payOne(db, ctx, kind, row, row.bench, amountFor(kind, row), billingName);
    })
  });
}
seatPayment("deposit");
seatPayment("full");
seatPayment("balance");
route({
  method: "POST",
  path: "/api/reservations/:id/upgrade",
  access: BUYER_ROLES,
  idempotent: true,
  handle: (ctx) => tx(async (db) => {
    await lockLedger(db);
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["buyer"]);
    const replay = await replayOrRefuse(db, ctx);
    if (replay) return replay;
    if (row.state !== "deposit_paid" && row.state !== "paid_in_full") throw conflict("not_paid", "Upgrades are for paid seats.");
    if (tierOf(row.bench) === "atelier") throw conflict("already_atelier", "This seat is already an Atelier bench.");
    const target2 = fields(ctx.body).bench;
    const atelierTarget = isBenchLabel(target2) && tierOf(target2) === "atelier" ? target2 : null;
    if (atelierTarget) {
      if (row.upgrade_target && row.upgrade_target !== atelierTarget) throw conflict("invalid_transition", "Another upgrade is being confirmed.");
      if (row.upgrade_target !== atelierTarget) {
        const stock = await currentInventory(db);
        if (stock.occupied.has(atelierTarget)) throw conflict("bench_taken", `Bench ${atelierTarget} was just taken.`);
        if (stock.atelier.soldOut) throw conflict("atelier_sold_out", "Atelier is sold out.");
      }
    }
    if (!atelierTarget) throw validation({ ...paymentErrors(ctx).errors, bench: "Choose an open Atelier bench in row A or B." });
    const billingName = billingNameOrRefuse(ctx);
    await db.query("UPDATE reservations SET upgrade_target = $2 WHERE id = $1", [row.id, atelierTarget]);
    return payOne(db, ctx, "upgrade", row, atelierTarget, upgradeCharge(row.state, depositsOpen(venueToday(ctx.now))), billingName);
  })
});
async function groupSeats(db, groupId, account) {
  const group = await one(db, "SELECT buyer_id FROM groups WHERE id = $1", [groupId]);
  if (!group || group.buyer_id !== account.id) throw notFound();
  const ids = (await reservationsWhere(db, "r.group_id = $1", [groupId])).map((row) => row.id);
  await lockReservations(db, ids);
  return reservationsWhere(db, "r.group_id = $1", [groupId]);
}
route({
  method: "POST",
  path: "/api/groups/:id/checkout",
  access: BUYER_ROLES,
  idempotent: true,
  handle: (ctx) => tx(async (db) => {
    const groupId = ctx.params.id ?? "";
    const seats = await groupSeats(db, groupId, ctx.account);
    const replay = await replayOrRefuse(db, ctx);
    if (replay) return replay;
    if (seats.some((seat) => seat.payment_pending && seat.payment_pending !== "group")) {
      throw conflict("invalid_transition", "Another payment for these seats is being confirmed.");
    }
    if (seats.some((seat) => seat.state !== "held" && seat.state !== "released")) throw conflict("already_paid", "This group invoice is already paid.");
    if (seats.some((seat) => holdLapsed(seat, ctx.now))) throw conflict("hold_expired", "This group hold has ended.");
    const raw = fields(ctx.body).assignments;
    const listed = raw === void 0 ? [] : Array.isArray(raw) ? raw.map(fields) : null;
    const assignments = [];
    let assignmentsValid = listed !== null;
    for (const entry of listed ?? []) {
      const bench = typeof entry.bench === "string" ? entry.bench : "";
      const name = text(entry.name, 1, 120);
      const address2 = email(entry.email);
      if (!seats.some((seat) => seat.bench === bench) || !name || !address2 || assignments.some((a) => a.bench === bench)) {
        assignmentsValid = false;
        continue;
      }
      const invitee = await one(db, "SELECT id FROM accounts WHERE email_key = $1", [address2.toLowerCase()]);
      if (invitee && await attendsASeat(db, invitee.id)) throw conflict("already_attending", `${address2} already attends another seat.`);
      assignments.push({ bench, name, email: address2 });
    }
    const billingName = billingNameOrRefuse(ctx, assignmentsValid ? {} : { assignments: "Each colleague needs a bench from this group, a name and a valid email." });
    const payment = await charge(db, {
      kind: "group",
      ownerId: groupId,
      buyer: { id: ctx.account.id, name: buyerDisplayName(ctx.account.role, ctx.account.name, ctx.account.clinic_name), email: ctx.account.email },
      billingName,
      items: seats.map((seat) => ({ reservationId: seat.id, bench: seat.bench, amountCents: PRICES[tierOf(seat.bench)].full }))
    });
    for (const assignment of assignments) {
      await db.query(
        "UPDATE reservations SET attendee_name = $3, attendee_email = $4, attendee_accepted = false, attendee_account_id = NULL WHERE group_id = $1 AND bench = $2",
        [groupId, assignment.bench, assignment.name, assignment.email]
      );
    }
    const done = await settle(db, payment, ctx.now);
    return { status: done ? 201 : 202, body: { group: await groupView(db, groupId, ctx.now) } };
  })
});

// src/server/routes/documents.ts
import { randomBytes as randomBytes3 } from "node:crypto";
var SCAN_FIELDS = {
  licence: [
    { name: "licence_number", max: 40 },
    { name: "licence_state", max: 60 }
  ],
  passport: [
    { name: "full_name", max: 120 },
    { name: "nationality", max: 120 },
    { name: "passport_number", max: 120 }
  ]
};
async function upload(ctx, kind) {
  return tx(async (db) => {
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["attendee"]);
    if (!ACTIVE_STATES.includes(row.state)) throw conflict("invalid_transition", "This seat is no longer active.");
    if (kind === "licence" && row.licence_status === "matched") throw conflict("licence_locked", "This licence is matched and locked.");
    const form = ctx.multipart ?? { fields: {}, files: [] };
    const values = {};
    const errors = {};
    for (const field of SCAN_FIELDS[kind]) {
      const value = text(form.fields[field.name], 1, field.max);
      if (value) values[field.name] = value;
      else errors[field.name] = `Enter 1 to ${field.max} characters.`;
    }
    if (form.files.length !== 1) errors.file = form.files.length ? "Attach one file only." : "Attach a PDF, JPEG or PNG file.";
    const file = form.files[0];
    if (Object.keys(errors).length || !file) throw validation(errors);
    if (file.tooLarge) throw new ApiError(413, "file_too_large", "Files must be 10,000,000 bytes or smaller.");
    const type = sniff(file.bytes);
    if (!type) throw new ApiError(415, "unsupported_file_type", "Upload a PDF, JPEG or PNG file.");
    const key = `${kind}s/${row.id}/${randomBytes3(16).toString("hex")}.${type.ext}`;
    await putObject(key, file.bytes, type.contentType);
    if (kind === "licence") {
      await db.query(
        "UPDATE reservations SET licence_number = $2, licence_state = $3, licence_key = $4, licence_status = 'submitted' WHERE id = $1",
        [row.id, values.licence_number, values.licence_state, key]
      );
    } else {
      await db.query(
        "UPDATE reservations SET passport_full_name = $2, passport_nationality = $3, passport_number = $4, passport_key = $5 WHERE id = $1",
        [row.id, values.full_name, values.nationality, values.passport_number, key]
      );
    }
    const replaced = kind === "licence" ? row.licence_key : row.passport_key;
    if (replaced) await deleteObject(replaced);
    return { status: 201, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
  });
}
for (const kind of ["licence", "passport"]) {
  route({ method: "POST", path: `/api/reservations/:id/${kind}`, access: BUYER_ROLES, body: "multipart", handle: (ctx) => upload(ctx, kind) });
}
route({
  method: "GET",
  path: "/api/reservations/:id/licence",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    const row = await visibleReservation(pool, ctx.params.id ?? "", ctx.account, ["attendee", "registrar"]);
    if (!row.licence_key) throw notFound();
    await linkable(row.licence_key);
    return {
      status: 200,
      body: {
        licence_number: row.licence_number,
        licence_state: row.licence_state,
        status: row.licence_status,
        url: signedLink(row.licence_key),
        expires_in: LINK_SECONDS
      }
    };
  }
});
route({
  method: "GET",
  path: "/api/reservations/:id/passport",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    const row = await visibleReservation(pool, ctx.params.id ?? "", ctx.account, ["attendee", "registrar"]);
    if (!row.passport_key) throw notFound();
    await linkable(row.passport_key);
    return {
      status: 200,
      body: {
        full_name: row.passport_full_name,
        nationality: row.passport_nationality,
        passport_number: row.passport_number,
        url: signedLink(row.passport_key),
        expires_in: LINK_SECONDS
      }
    };
  }
});
async function linkable(key) {
  if (!await objectExists(key)) throw notFound();
}
var RECEIPTS = ["deposit-receipt", "balance-receipt", "full-receipt", "upgrade-receipt"];
var PERSONAL = ["visa-letter", "certificate"];
route({
  method: "GET",
  path: "/api/reservations/:id/documents/:kind",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    const kind = ctx.params.kind ?? "";
    const allowed = RECEIPTS.includes(kind) ? ["buyer", "registrar"] : PERSONAL.includes(kind) ? ["attendee", "registrar"] : null;
    if (!allowed) throw notFound();
    const row = await visibleReservation(pool, ctx.params.id ?? "", ctx.account, allowed);
    const doc = await one(pool, "SELECT object_key FROM documents WHERE owner_id = $1 AND kind = $2", [row.id, kind]);
    if (!doc) throw notFound();
    await linkable(doc.object_key);
    return { status: 200, body: { url: signedLink(doc.object_key), expires_in: LINK_SECONDS } };
  }
});
route({
  method: "GET",
  path: "/api/groups/:id/documents/invoice",
  access: ["practitioner", "clinic", "registrar"],
  handle: async (ctx) => {
    const groupId = ctx.params.id ?? "";
    const group = await one(pool, "SELECT buyer_id FROM groups WHERE id = $1", [groupId]);
    if (!group || group.buyer_id !== ctx.account.id && ctx.account.role !== "registrar") throw notFound();
    const doc = await one(pool, "SELECT object_key FROM documents WHERE owner_id = $1 AND kind = 'invoice'", [groupId]);
    if (!doc) throw notFound();
    await linkable(doc.object_key);
    return { status: 200, body: { url: signedLink(doc.object_key), expires_in: LINK_SECONDS } };
  }
});

// src/server/routes/desk.ts
var FOOTER = "\n\nSee the details in your account: /account\n\nOpaline Bench Days";
async function kbAmounts(rows) {
  const buyers = [...new Set(rows.map((row) => row.buyer_id))];
  const groupShares = await many(
    pool,
    `SELECT pi.reservation_id, pi.amount_cents, p.external_key FROM payment_items pi JOIN payments p ON p.id = pi.payment_id
     WHERE p.kind = 'group' AND pi.reservation_id = ANY($1)`,
    [rows.map((row) => row.id)]
  );
  try {
    const recorded = /* @__PURE__ */ new Map();
    for (let start = 0; start < buyers.length; start += 12) {
      const batch = await Promise.all(buyers.slice(start, start + 12).map((id) => accountTransactions(id)));
      for (const found of batch) for (const [key, value] of found) recorded.set(key, value);
    }
    const amounts = /* @__PURE__ */ new Map();
    for (const row of rows) {
      let paid = 0;
      let refunded = 0;
      for (const kind of ["deposit", "balance", "full", "upgrade"]) {
        const found = recorded.get(externalKey(kind, row.id));
        if (found?.type === "PURCHASE") paid += found.cents;
      }
      for (const share of groupShares.filter((s) => s.reservation_id === row.id)) {
        if (recorded.get(share.external_key)?.type === "PURCHASE") paid += share.amount_cents;
      }
      for (const [key, value] of recorded) {
        if (key.startsWith(refundKeyPrefix(row.id)) && value.type === "REFUND") refunded += value.cents;
      }
      amounts.set(row.id, { paid_cents: paid, refunded_cents: refunded });
    }
    return amounts;
  } catch (error) {
    if (error instanceof ApiError && error.code === "billing_unavailable") return null;
    throw error;
  }
}
route({
  method: "GET",
  path: "/api/desk/reservations",
  access: ["registrar"],
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const q = (ctx.query.get("q") ?? "").trim();
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await reservationsWhere(
      pool,
      `r.state <> 'released' AND ($1 = '' OR r.attendee_name ILIKE $2 OR a.name ILIKE $2 OR a.clinic_name ILIKE $2 OR r.bench ILIKE $2)`,
      [q, pattern]
    );
    const amounts = await kbAmounts(rows);
    return {
      status: 200,
      body: {
        billing: amounts ? "ok" : "unavailable",
        deposits_open: depositsOpen(venueToday(ctx.now)),
        reservations: rows.map((row) => ({ ...reservationView(row, ctx.now), buyer_email: row.buyer_email, kb: amounts?.get(row.id) ?? null }))
      }
    };
  }
});
route({
  method: "POST",
  path: "/api/desk/reservations/:id/refund",
  access: ["registrar"],
  idempotent: true,
  handle: (ctx) => tx(async (db) => {
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["registrar"]);
    if (keyIsValid(ctx.idempotencyKey)) {
      const replay = await replayOf(db, ctx.account.id, ctx.idempotencyKey, ctx.fingerprint);
      if (replay) return { status: replay.status, body: replay.body };
    }
    await refuseReuse(db, ctx.account.id, ctx.idempotencyKey, ctx.fingerprint);
    if (row.state === "refunded") throw conflict("already_refunded", "This seat is already refunded.");
    if (row.state !== "cancelled") throw conflict("not_cancelled", "Only cancelled seats are refunded.");
    if (!keyIsValid(ctx.idempotencyKey)) throw validation(KEY_ERROR);
    const outcome = await refundSeat(db, row);
    await transition(db, [row], "refunded");
    const remaining = row.group_id ? (await reservationsWhere(db, "r.group_id = $1 AND r.id <> $2 AND r.state = ANY($3)", [row.group_id, row.id, SOLD_STATES])).map(
      (seat) => `Bench ${seat.bench}: ${seat.attendee_name ?? "Unassigned"}`
    ) : [];
    await enqueueMail(db, `refund:${row.id}`, {
      to: row.buyer_email,
      subject: `Refund confirmed: Bench ${row.bench}`,
      body: `We refunded $${formatDollars(outcome.amountCents)} for Bench ${row.bench}.` + (remaining.length ? `

Your remaining seats:
${remaining.join("\n")}` : "") + FOOTER
    });
    return {
      status: 200,
      body: {
        reservation: reservationView(await reload(db, row.id), ctx.now),
        refund: { amount_cents: outcome.amountCents, transaction_external_keys: outcome.transactionKeys }
      }
    };
  })
});
route({
  method: "POST",
  path: "/api/desk/reservations/:id/licence-review",
  access: ["registrar"],
  handle: (ctx) => tx(async (db) => {
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["registrar"]);
    if (row.licence_status === "none") throw conflict("no_licence", "No licence has been uploaded for this seat.");
    if (row.licence_status === "matched") throw conflict("invalid_transition", "A matched licence is locked.");
    const decision = fields(ctx.body).decision;
    if (decision !== "matched" && decision !== "rejected") throw validation({ decision: "Choose matched or rejected." });
    await db.query("UPDATE reservations SET licence_status = $2 WHERE id = $1", [row.id, decision]);
    return { status: 200, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
  })
});
route({
  method: "POST",
  path: "/api/desk/reservations/:id/visa-letter",
  access: ["registrar"],
  handle: (ctx) => tx(async (db) => {
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["registrar"]);
    if (row.documents.includes("visa-letter")) return { status: 200, body: { reservation: reservationView(row, ctx.now) } };
    if (!row.passport_key || !row.passport_full_name || !row.passport_nationality || !row.passport_number) {
      throw conflict("passport_missing", "No passport scan is on file for this seat.");
    }
    if (!SOLD_STATES.includes(row.state)) throw conflict("not_paid", "Visa letters are for paid seats.");
    const key = `visa-letters/${row.id}.pdf`;
    const pdf = visaLetterPdf({ fullName: row.passport_full_name, nationality: row.passport_nationality, number: row.passport_number }, row.bench, ctx.now);
    await putObject(key, pdf, "application/pdf");
    await db.query("INSERT INTO documents (owner_id, kind, object_key) VALUES ($1, 'visa-letter', $2)", [row.id, key]);
    await enqueueMail(db, `visa:${row.id}`, {
      to: row.attendee_email ?? row.buyer_email,
      subject: "Your visa-support letter for Opaline Bench Days",
      body: `Your visa-support letter for Bench ${row.bench} is ready to download.${FOOTER}`
    });
    return { status: 201, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
  })
});
route({
  method: "POST",
  path: "/api/desk/reservations/:id/certificate",
  access: ["registrar"],
  handle: (ctx) => tx(async (db) => {
    const row = await lockedVisible(db, ctx.params.id ?? "", ctx.account, ["registrar"]);
    if (row.certificate_number) {
      return { status: 200, body: { reservation: reservationView(row, ctx.now), certificate_number: row.certificate_number } };
    }
    const missing = certificateGaps({
      balanceCents: balanceCents(row),
      checkedIn: { day1: row.checked_in_day1, day2: row.checked_in_day2 },
      licenceStatus: row.licence_status
    });
    if (missing.length) throw conflict("certificate_not_eligible", "This attendee is not eligible yet.", { missing });
    await lockCertificates(db);
    const issued = await oneRow(db, "SELECT count(*)::int AS n FROM reservations WHERE certificate_number IS NOT NULL");
    const number = `OB-2027-${String(issued.n + 1).padStart(4, "0")}`;
    const key = `certificates/${row.id}.pdf`;
    const pdf = certificatePdf({
      attendee: row.attendee_name ?? "",
      licenceNumber: row.licence_number ?? "",
      licenceState: row.licence_state ?? "",
      number
    });
    await putObject(key, pdf, "application/pdf");
    await transition(db, [row], "certificate_issued", { certificate_number: number });
    await db.query("INSERT INTO documents (owner_id, kind, object_key) VALUES ($1, 'certificate', $2)", [row.id, key]);
    await enqueueMail(db, `certificate:${row.id}`, {
      to: row.attendee_email ?? row.buyer_email,
      subject: "Your CE certificate for Opaline Bench Days",
      body: `Your CE certificate (${number}) for the Layered Composite Masterclass is ready to download.${FOOTER}`
    });
    return { status: 201, body: { reservation: reservationView(await reload(db, row.id), ctx.now), certificate_number: number } };
  })
});
route({
  method: "GET",
  path: "/api/desk/inventory",
  access: ["registrar", "director"],
  handle: async (ctx) => {
    await freshLedger(ctx.now);
    const stock = await currentInventory(pool);
    const waiting = await many(
      pool,
      "SELECT tier, count(*)::int AS n FROM waitlist_entries WHERE state = 'waitlisted' GROUP BY tier"
    );
    const count = (tier) => waiting.find((row) => row.tier === tier)?.n ?? 0;
    return {
      status: 200,
      body: {
        seats_total: SEATS_TOTAL,
        seats_remaining: stock.seatsRemaining,
        held: stock.held,
        sold: stock.sold,
        waitlisted: { bench: count("bench"), atelier: count("atelier") },
        atelier: { active: stock.atelier.active, cap: stock.atelier.cap, remaining: stock.atelier.remaining, sold_out: stock.atelier.soldOut }
      }
    };
  }
});

// src/shared/handsOn.ts
var HANDS_ON_ERROR = "Hands-on time must stay at least 30% of the agenda.";
function handsOnTotals(sessions) {
  return {
    h: sessions.filter((session) => session.format === "hands-on").reduce((sum, session) => sum + session.minutes, 0),
    t: sessions.reduce((sum, session) => sum + session.minutes, 0)
  };
}
function handsOnShareHolds(sessions) {
  const { h, t } = handsOnTotals(sessions);
  return h * 10 >= t * 3;
}

// src/server/routes/content.ts
var KINDS = ["sessions", "hospitality", "hotels", "faq"];
function kindOf(value) {
  const kind = KINDS.find((k) => k === value);
  if (!kind) throw notFound();
  return kind;
}
function clean(kind, body) {
  const values = {};
  const errors = {};
  const want = (name, value, message2) => {
    if (value === null) errors[name] = message2;
    else values[name] = value;
  };
  const day = integer(body.day, 1, 2);
  switch (kind) {
    case "sessions": {
      want("number", integer(body.number, 1, 1e5), "Use a positive whole number.");
      want("day", day, "Day is 1 or 2.");
      want("title", text(body.title, 1, 120), "Enter a title of 1 to 120 characters.");
      want("format", body.format === "lecture" || body.format === "hands-on" ? body.format : null, "Format is lecture or hands-on.");
      want("minutes", integer(body.minutes, 15, 480), "Minutes are a whole number from 15 to 480.");
      want("outcomes", typeof body.outcomes === "string" && body.outcomes.length <= 600 ? body.outcomes.trim() : null, "Outcomes are up to 600 characters.");
      break;
    }
    case "hospitality": {
      want("title", text(body.title, 1, 120), "Enter a title of 1 to 120 characters.");
      want("day", day, "Day is 1 or 2.");
      const startsAt = typeof body.starts_at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.starts_at) ? body.starts_at : null;
      want("starts_at", startsAt, "Use a 24-hour time such as 18:30.");
      want("venue", text(body.venue, 1, 120), "Enter a venue of 1 to 120 characters.");
      want("tier", body.tier === "all" || body.tier === "atelier" ? body.tier : null, "Tier is all or atelier.");
      want("description", text(body.description, 1, 600), "Enter a description of 1 to 600 characters.");
      break;
    }
    case "hotels": {
      want("name", text(body.name, 1, 120), "Enter a name of 1 to 120 characters.");
      want("distance", text(body.distance, 1, 60), "Enter a distance such as 0.4 miles.");
      want("rate", text(body.rate, 1, 60), "Enter a rate such as from $289 a night.");
      want("map_url", httpsUrl(body.map_url), "Use an https:// map link.");
      break;
    }
    case "faq": {
      want("question", text(body.question, 1, 200), "Enter a question of 1 to 200 characters.");
      want("answer", text(body.answer, 1, 2e3), "Enter an answer of 1 to 2,000 characters.");
      want("sort", integer(body.sort, -1e5, 1e5), "Sort is a whole number.");
      break;
    }
  }
  return { values, errors };
}
function httpsUrl(value) {
  const found = text(value, 1, 500);
  if (!found) return null;
  try {
    return new URL(found).protocol === "https:" ? found : null;
  } catch {
    return null;
  }
}
function checkSessions(after, changed, errors) {
  if (changed && after.some((s) => s.id !== changed.id && s.number === changed.number)) {
    errors.number = "Another session already has this number.";
  }
  const agenda = after.map((s) => ({ format: String(s.format), minutes: Number(s.minutes) }));
  if (!errors.minutes && !handsOnShareHolds(agenda)) errors.minutes = HANDS_ON_ERROR;
}
function serialised(kind, work) {
  return kind === "sessions" ? oneAgendaWriteAtATime(work) : work();
}
async function save(kind, id, body) {
  const existing = await listRecords(kind);
  const current = id ? existing.find((record) => record.id === id) : null;
  if (id && !current) throw notFound();
  const merged = { ...current ?? {}, ...fields(body) };
  const { values, errors } = clean(kind, merged);
  if (kind === "sessions") {
    const changed = { ...values, id: id ?? "" };
    checkSessions([...existing.filter((record) => record.id !== id), changed], changed, errors);
  }
  if (Object.keys(errors).length) throw validation(errors);
  return id ? updateRecord(kind, id, values) : createRecord(kind, values);
}
route({
  method: "GET",
  path: "/api/desk/content/:kind",
  access: ["director"],
  handle: async (ctx) => ({ status: 200, body: { items: await listRecords(kindOf(ctx.params.kind)) } })
});
route({
  method: "POST",
  path: "/api/desk/content/:kind",
  access: ["director"],
  handle: async (ctx) => {
    const kind = kindOf(ctx.params.kind);
    return { status: 201, body: { item: await serialised(kind, () => save(kind, null, ctx.body)) } };
  }
});
route({
  method: "PATCH",
  path: "/api/desk/content/:kind/:id",
  access: ["director"],
  handle: async (ctx) => {
    const kind = kindOf(ctx.params.kind);
    return { status: 200, body: { item: await serialised(kind, () => save(kind, ctx.params.id ?? "", ctx.body)) } };
  }
});
route({
  method: "DELETE",
  path: "/api/desk/content/:kind/:id",
  access: ["director"],
  handle: async (ctx) => {
    const kind = kindOf(ctx.params.kind);
    await serialised(kind, async () => {
      const existing = await listRecords(kind);
      if (!existing.some((record) => record.id === ctx.params.id)) throw notFound();
      if (kind === "sessions") {
        const errors = {};
        checkSessions(existing.filter((record) => record.id !== ctx.params.id), null, errors);
        if (Object.keys(errors).length) throw validation(errors);
      }
      await deleteRecord(kind, ctx.params.id ?? "");
    });
    return { status: 204 };
  }
});
async function revealsAtelierEvenings(account) {
  if (!account) return false;
  if (account.role === "director") return true;
  const seats = await reservationsWhere(pool, "r.state = ANY($2) AND (r.buyer_id = $1 OR (r.attendee_accepted AND r.attendee_account_id = $1))", [
    account.id,
    SOLD_STATES
  ]);
  return seats.some((seat) => tierOf(seat.bench) === "atelier");
}
publicRoute({
  method: "GET",
  path: "/api/content",
  handle: async (ctx) => {
    const [sessions, hospitality, hotels, faq] = await Promise.all([
      listRecords("sessions"),
      listRecords("hospitality"),
      listRecords("hotels"),
      listRecords("faq")
    ]);
    const reveal = await revealsAtelierEvenings(ctx.account);
    return {
      status: 200,
      body: {
        sessions: sessions.sort((a, b) => Number(a.day) - Number(b.day) || Number(a.number) - Number(b.number)),
        hospitality: hospitality.sort((a, b) => Number(a.day) - Number(b.day) || String(a.starts_at).localeCompare(String(b.starts_at))).map((item) => item.tier === "atelier" && !reveal ? { id: item.id, title: item.title, day: item.day, tier: "atelier", gated: true } : item),
        hotels,
        faq: faq.sort((a, b) => Number(a.sort) - Number(b.sort))
      }
    };
  }
});

// src/server/routes/checkin.ts
var MAX_RESULTS = 10;
var CONFLICT_MESSAGE = {
  checkin_closed: "Check-in is closed today.",
  no_attendee: "This seat has no attendee yet. Send them to the registrar.",
  already_checked_in: "This attendee is already checked in for that day.",
  balance_due: "This attendee has a balance due. Send them to the registrar.",
  not_checked_in_day1: "This attendee has no day 1 check-in. Send them to the registrar."
};
route({
  method: "GET",
  path: "/api/checkin",
  access: ["frontdesk"],
  handle: async (ctx) => {
    const q = (ctx.query.get("q") ?? "").trim();
    if (q.length < 2) throw validation({ q: "Type at least two characters of the name." });
    const today = venueToday(ctx.now);
    const results = await many(
      pool,
      `SELECT id AS reservation_id, attendee_name, bench, checked_in_day1 AS day1, checked_in_day2 AS day2 FROM reservations
       WHERE attendee_name IS NOT NULL AND state = ANY($2) AND attendee_name ILIKE $1
       ORDER BY attendee_name, bench LIMIT ${MAX_RESULTS}`,
      [`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, SOLD_STATES]
    );
    return { status: 200, body: { q, venue_date: today, open_day: openCourseDay(today), results } };
  }
});
route({
  method: "POST",
  path: "/api/checkin",
  access: ["frontdesk"],
  handle: (ctx) => tx(async (db) => {
    const body = fields(ctx.body);
    if (typeof body.reservation_id !== "string") throw validation({ reservation_id: "Choose a reservation." });
    const row = await lockedReservation(db, body.reservation_id);
    const day = body.day === 1 || body.day === 2 ? body.day : null;
    if (!day) throw validation({ day: "Day is 1 or 2." });
    const refused = checkinConflict(
      { state: row.state, attendeeAccepted: row.attendee_accepted, checkedIn: { day1: row.checked_in_day1, day2: row.checked_in_day2 } },
      day,
      venueToday(ctx.now)
    );
    if (refused) throw conflict(refused, CONFLICT_MESSAGE[refused]);
    await transition(db, [row], day === 1 ? "checked_in_day1" : "checked_in_day2", day === 1 ? { checked_in_day1: true } : { checked_in_day2: true });
    return { status: 201, body: { reservation: reservationView(await reload(db, row.id), ctx.now) } };
  })
});

// src/server/main.ts
var PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
var PAGES = /* @__PURE__ */ new Set(["/", "/account", "/desk", "/desk/content", "/checkin"]);
var SERVED_DIRS = ["/assets/", "/fonts/"];
var TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2"
};
var BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };
var shell = null;
async function serveStatic(req, res, path) {
  const asset = SERVED_DIRS.some((dir) => path.startsWith(dir)) ? normalize(path) : null;
  const type = asset ? TYPES[extname(asset)] : void 0;
  if (asset && type && !asset.includes("..")) {
    try {
      const body = await readFile(join(PUBLIC_DIR, asset));
      res.writeHead(200, { ...BASE_HEADERS, "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" });
      res.end(req.method === "HEAD" ? void 0 : body);
      return;
    } catch {
    }
  }
  shell ??= await readFile(join(PUBLIC_DIR, "index.html"));
  const status = PAGES.has(path) ? 200 : 404;
  res.writeHead(status, { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(req.method === "HEAD" ? void 0 : shell);
}
var ready = Promise.resolve();
async function boot() {
  for (; ; ) {
    try {
      await applySchema();
      await tx(seedStaff);
      return;
    } catch (error) {
      console.error(`database not ready: ${error instanceof Error ? error.message : "unknown error"}; retrying`);
      await new Promise((resolve) => setTimeout(resolve, 2e3));
    }
  }
}
async function prepareContent() {
  for (; ; ) {
    try {
      await ensureCollections();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5e3));
    }
  }
}
var server = createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://app.invalid").pathname;
  if (path === "/api/health") return sendJson(res, 200, { status: "ok" });
  if (path.startsWith("/api/")) {
    void ready.then(() => dispatch(req, res));
    return;
  }
  void serveStatic(req, res, path).catch(() => {
    if (!res.headersSent) sendError(res, new ApiError(500, "internal", "The page could not be served."));
  });
});
server.listen(config.port, "0.0.0.0", () => {
  ready = boot().then(startWorkers);
  void prepareContent();
});
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}
