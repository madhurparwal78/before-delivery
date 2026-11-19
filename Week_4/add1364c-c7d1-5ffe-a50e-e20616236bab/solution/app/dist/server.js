// src/server/main.ts
import { createServer } from "node:http";

// src/server/config.ts
import { createHash } from "node:crypto";
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
function whole(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive whole number`);
  return value;
}
var clientSecret = required("AUTH_CLIENT_SECRET");
var keyHex = process.env.LOCKSET_SECRET_KEY;
var officeKey = process.env.OFFICE_KEY || "bl";
if (!/^[a-z]{2,8}$/.test(officeKey)) throw new Error("OFFICE_KEY must be 2 to 8 lowercase letters");
var config = {
  port: whole("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  keycloakUrl: required("KEYCLOAK_URL").replace(/\/+$/, ""),
  keycloakRealm: required("KEYCLOAK_REALM"),
  authIssuerUrl: required("AUTH_ISSUER_URL").replace(/\/+$/, ""),
  authClientId: required("AUTH_CLIENT_ID"),
  authClientSecret: clientSecret,
  killbillUrl: required("KILLBILL_URL").replace(/\/+$/, ""),
  killbillUsername: required("KILLBILL_USERNAME"),
  killbillPassword: required("KILLBILL_PASSWORD"),
  killbillApiKey: required("KILLBILL_API_KEY"),
  killbillApiSecret: required("KILLBILL_API_SECRET"),
  wiremockUrl: required("WIREMOCK_URL").replace(/\/+$/, ""),
  officeKey,
  secretKey: keyHex && /^[0-9a-fA-F]{64}$/.test(keyHex) ? Buffer.from(keyHex, "hex") : createHash("sha256").update(`lockset-secret-key:${clientSecret}`).digest(),
  clockStart: process.env.LOCKSET_CLOCK_START || null,
  revealSessionSeconds: whole("REVEAL_SESSION_SECONDS", 28800),
  breachCheckSeconds: whole("BREACH_CHECK_SECONDS", 60),
  signInLockSeconds: whole("SIGN_IN_LOCK_SECONDS", 900)
};

// src/server/killbill.ts
var BillingUnavailable = class extends Error {
};
var SEAT_PLAN = "lockset-seat-annual";
var SEAT_PRICE_CENTS = 4800;
var base = `${config.killbillUrl}/1.0/kb`;
var auth = `Basic ${Buffer.from(`${config.killbillUsername}:${config.killbillPassword}`).toString("base64")}`;
async function call(method, path, body, timeoutMs = 5e3) {
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: auth,
        "X-Killbill-ApiKey": config.killbillApiKey,
        "X-Killbill-ApiSecret": config.killbillApiSecret,
        "X-Killbill-CreatedBy": "lockset",
        Accept: "application/json",
        ...body === void 0 ? {} : { "Content-Type": "application/json" }
      },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch {
    throw new BillingUnavailable("Kill Bill cannot be reached");
  }
}
function seatOf(json) {
  return {
    subscriptionId: json.subscriptionId,
    state: json.state,
    planName: json.planName,
    chargedThroughDate: json.chargedThroughDate ?? null,
    billingEndDate: json.billingEndDate ?? null
  };
}
var accountId = null;
async function planExists() {
  const answer = await call("GET", "/catalog/availableBasePlans");
  if (answer.status !== 200 || !Array.isArray(answer.json)) return false;
  return answer.json.some((plan) => plan.plan === SEAT_PLAN);
}
async function ensureReady() {
  if (accountId) return accountId;
  if (!await planExists()) {
    await call("POST", "/catalog/simplePlan", {
      planId: SEAT_PLAN,
      productName: "Lockset-Seat",
      productCategory: "BASE",
      currency: "USD",
      amount: SEAT_PRICE_CENTS / 100,
      billingPeriod: "ANNUAL",
      trialLength: 0,
      trialTimeUnit: "DAYS",
      availableBaseProducts: []
    });
    if (!await planExists()) throw new BillingUnavailable("The seat plan is not in the catalog");
  }
  const found = await call("GET", `/accounts?externalKey=${encodeURIComponent(config.officeKey)}`);
  if (found.status === 200) {
    accountId = found.json.accountId;
    return accountId;
  }
  if (found.status !== 404) throw new BillingUnavailable("Kill Bill could not look up the account");
  const created = await call("POST", "/accounts", {
    name: "Brannock & Lyle",
    externalKey: config.officeKey,
    currency: "USD"
  });
  if (created.status !== 201) {
    const again = await call("GET", `/accounts?externalKey=${encodeURIComponent(config.officeKey)}`);
    if (again.status !== 200) throw new BillingUnavailable("Kill Bill could not create the account");
    accountId = again.json.accountId;
    return accountId;
  }
  const lookup = await call("GET", `/accounts?externalKey=${encodeURIComponent(config.officeKey)}`);
  if (lookup.status !== 200) throw new BillingUnavailable("Kill Bill could not read the new account");
  accountId = lookup.json.accountId;
  return accountId;
}
function bundleKey(handle2) {
  return `${config.officeKey}-seat-${handle2}`;
}
async function findSeat(handle2) {
  const account = await ensureReady();
  const answer = await call("GET", `/accounts/${account}/bundles?externalKey=${encodeURIComponent(bundleKey(handle2))}`);
  if (answer.status !== 200 || !Array.isArray(answer.json)) throw new BillingUnavailable("Kill Bill could not look up the bundle");
  const bundles = answer.json;
  const first = bundles.flatMap((bundle) => bundle.subscriptions ?? []).find((subscription) => subscription.planName === SEAT_PLAN);
  return first ? seatOf(first) : null;
}
async function buySeat(handle2) {
  const account = await ensureReady();
  if (await findSeat(handle2)) return;
  const answer = await call("POST", "/subscriptions", {
    accountId: account,
    bundleExternalKey: bundleKey(handle2),
    planName: SEAT_PLAN
  });
  if (answer.status >= 400) throw new BillingUnavailable("Kill Bill refused the subscription");
}
function purchaseConfirmed(seat) {
  return seat !== null && seat.state === "ACTIVE" && seat.chargedThroughDate !== null;
}
function releaseConfirmed(seat) {
  return seat !== null && seat.state === "CANCELLED" && seat.billingEndDate !== null && seat.chargedThroughDate !== null && seat.billingEndDate.slice(0, 10) === seat.chargedThroughDate.slice(0, 10);
}
async function cancelSeat(subscriptionId) {
  const answer = await call(
    "DELETE",
    `/subscriptions/${subscriptionId}?entitlementPolicy=IMMEDIATE&billingPolicy=END_OF_TERM`
  );
  if (answer.status >= 400 && answer.status !== 404) throw new BillingUnavailable("Kill Bill refused the cancellation");
}
async function activeSeats() {
  const account = await ensureReady();
  const answer = await call("GET", `/accounts/${account}/bundles`);
  if (answer.status !== 200 || !Array.isArray(answer.json)) throw new BillingUnavailable("Kill Bill could not list seats");
  const bundles = answer.json;
  return bundles.flatMap((bundle) => bundle.subscriptions ?? []).filter((subscription) => subscription.planName === SEAT_PLAN && subscription.state === "ACTIVE").map(seatOf);
}

// src/server/db.ts
import pg from "pg";
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1082, (value) => value);
var pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 1e4 });
pool.on("error", () => void 0);
async function checkout() {
  const client = await pool.connect();
  let broken;
  const onError = (error) => {
    broken = error;
  };
  client.on("error", onError);
  return {
    client,
    release: () => {
      client.removeListener("error", onError);
      client.release(broken);
    }
  };
}
function wrap(runner) {
  const query = async (sql, params = []) => (await runner.query(sql, params)).rows;
  return {
    query,
    one: async (sql, params = []) => (await query(sql, params))[0] ?? null
  };
}
function oneAtATime(client) {
  let tail = Promise.resolve();
  return {
    query: (sql, params) => {
      const run = tail.then(() => client.query(sql, params));
      tail = run.catch(() => void 0);
      return run;
    }
  };
}
var db = wrap(pool);
var WRITE_LOCK = 7403;
async function afterWrites() {
  await pool.query("SELECT pg_advisory_xact_lock_shared($1)", [WRITE_LOCK]);
}
async function write(work) {
  const { client, release } = await checkout();
  const callbacks = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [WRITE_LOCK]);
    const tx = { ...wrap(oneAtATime(client)), after: (callback) => void callbacks.push(callback) };
    const result = await work(tx);
    await client.query("COMMIT");
    release();
    for (const callback of callbacks) {
      try {
        await callback();
      } catch (error) {
        console.error("after-commit step failed:", error instanceof Error ? error.message : "unknown error");
      }
    }
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    release();
    throw error;
  }
}
var SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, ord serial, full_name text NOT NULL, email text NOT NULL, handle text NOT NULL,
  role text NOT NULL, aliases text[] NOT NULL DEFAULT '{}', first_sign_in_at timestamptz,
  term_starts_on date, term_ends_on date, term_started boolean NOT NULL DEFAULT false, left_at timestamptz,
  seat text NOT NULL, seat_since timestamptz NOT NULL, seat_silent boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS people_handle ON people (handle);
CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people (lower(email));
CREATE TABLE IF NOT EXISTS person_vaults (person_id text NOT NULL, vault_id text NOT NULL, PRIMARY KEY (person_id, vault_id));
CREATE TABLE IF NOT EXISTS travel (
  id text PRIMARY KEY, person_id text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS vaults (
  id text PRIMARY KEY, ord serial, name text NOT NULL, off_when_travelling boolean NOT NULL, formerly text,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS vaults_name ON vaults (lower(name));
CREATE TABLE IF NOT EXISTS vault_renames (
  id text PRIMARY KEY, vault_id text NOT NULL, old_name text NOT NULL, new_name text NOT NULL, by_name text NOT NULL,
  at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS vendors (
  id text PRIMARY KEY, ord serial, name text NOT NULL, domain text NOT NULL UNIQUE, formerly text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS vendor_renames (
  id text PRIMARY KEY, vendor_id text NOT NULL, old_name text NOT NULL, new_name text NOT NULL, by_name text NOT NULL,
  at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id text PRIMARY KEY, ord serial, vault_id text NOT NULL, min_length int NOT NULL, effective_on date NOT NULL,
  state text NOT NULL, version int NOT NULL, drafted_by text NOT NULL, signed_by text, took_force_on date,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rules_vault ON rules (vault_id);
CREATE TABLE IF NOT EXISTS credentials (
  id text PRIMARY KEY, ord serial, vault_id text NOT NULL, vendor_id text NOT NULL, label text NOT NULL,
  username text NOT NULL, secret_sealed text NOT NULL, secret_length int NOT NULL, secret_rev int NOT NULL DEFAULT 1,
  last_turned_on date NOT NULL, imported_on date, created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS credentials_identity ON credentials (vault_id, vendor_id, lower(username));
CREATE TABLE IF NOT EXISTS holders (
  credential_id text NOT NULL, person_id text NOT NULL, ord serial, PRIMARY KEY (credential_id, person_id)
);
CREATE TABLE IF NOT EXISTS rotations (
  id text PRIMARY KEY, credential_id text NOT NULL UNIQUE, interval_days int NOT NULL, at_time text NOT NULL,
  first_run_on date NOT NULL, since timestamptz NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id text PRIMARY KEY, ord serial, credential_id text NOT NULL, kind text NOT NULL, rotation_id text, run_at timestamptz,
  run_date date, shifted boolean NOT NULL DEFAULT false, due_by date NOT NULL, state text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (rotation_id, run_at)
);
CREATE INDEX IF NOT EXISTS turns_credential ON turns (credential_id);
CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY, ord serial, quarter_year int NOT NULL, quarter int NOT NULL, opened_on date NOT NULL,
  overdue_from date NOT NULL, status text NOT NULL, signed_off_by text, opened_at timestamptz NOT NULL,
  UNIQUE (quarter_year, quarter)
);
CREATE TABLE IF NOT EXISTS review_lines (
  id text PRIMARY KEY, review_id text NOT NULL, person_id text NOT NULL, vault_id text NOT NULL,
  decision text NOT NULL, decided_by text, decided_via text
);
CREATE INDEX IF NOT EXISTS review_lines_review ON review_lines (review_id);
CREATE TABLE IF NOT EXISTS audit (
  seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, at timestamptz NOT NULL, office_day date NOT NULL,
  actor_person_id text, actor_name text NOT NULL, action text NOT NULL, subject_kind text NOT NULL,
  subject_id text NOT NULL, subject_name text NOT NULL, details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_day ON audit (office_day, seq);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, person_id text NOT NULL, started_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS sign_in_state (
  handle text PRIMARY KEY, failures int NOT NULL, window_started_at timestamptz NOT NULL, locked_until timestamptz
);
CREATE TABLE IF NOT EXISTS idempotency (
  person_id text NOT NULL, endpoint text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status int NOT NULL,
  body text NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (person_id, endpoint, key)
);
CREATE TABLE IF NOT EXISTS imports (
  id text PRIMARY KEY, filename text NOT NULL, by_person text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS import_rows (
  import_id text NOT NULL, row int NOT NULL, outcome text NOT NULL, reason text, parsed jsonb, names jsonb NOT NULL,
  credential_id text, PRIMARY KEY (import_id, row)
);
CREATE TABLE IF NOT EXISTS breach_checks (
  id text PRIMARY KEY, at timestamptz NOT NULL, ok boolean NOT NULL, office_day date NOT NULL, counts jsonb,
  healths jsonb, exposed jsonb, domains jsonb
);
`;
async function migrate() {
  const { client, release } = await checkout();
  try {
    await client.query("SELECT pg_advisory_lock(7404)");
    await client.query(SCHEMA);
    await client.query("SELECT pg_advisory_unlock(7404)");
  } finally {
    release();
  }
}
async function ping() {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// src/server/crypto.ts
import { createCipheriv, createDecipheriv, createHash as createHash2, randomBytes, randomUUID } from "node:crypto";
function newId() {
  return randomUUID();
}
function newToken() {
  return randomBytes(32).toString("base64url");
}
function hashToken(token) {
  return createHash2("sha256").update(token).digest("hex");
}
function seal(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.secretKey, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
function open(sealed) {
  const raw = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", config.secretKey, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
function secretLength(secret) {
  return Array.from(secret).length;
}
function sha1Upper(secret) {
  return createHash2("sha1").update(secret, "utf8").digest("hex").toUpperCase();
}

// src/server/clock.ts
var processStart = Date.now();
var clockStartMs = config.clockStart ? Date.parse(config.clockStart) : null;
if (config.clockStart && Number.isNaN(clockStartMs)) throw new Error("LOCKSET_CLOCK_START must be an ISO 8601 instant");
function now() {
  if (clockStartMs === null) return /* @__PURE__ */ new Date();
  return new Date(clockStartMs + (Date.now() - processStart));
}

// src/server/http.ts
import { createHash as createHash3 } from "node:crypto";
var ApiError = class extends Error {
  constructor(status, code, message, fields, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }
  status;
  code;
  fields;
  headers;
};
var NO_FIELD = "Lockset does not accept this field.";
var CHECK_FIELDS = "Check the highlighted fields.";
function notFound() {
  return new ApiError(404, "not_found", "That is not in this drawer.");
}
function forbidden() {
  return new ApiError(403, "forbidden", "Your role cannot do this.");
}
function conflict(code, message) {
  return new ApiError(409, code, message);
}
function invalid(fields) {
  return new ApiError(422, "invalid", CHECK_FIELDS, fields);
}
function ok(body, status = 200) {
  return { status, body };
}
var STREAMING = /* @__PURE__ */ Symbol("streaming");
function errorBody(error) {
  const body = { error: { code: error.code, message: error.message } };
  return error.fields ? { ...body, fields: error.fields } : body;
}
function sendJson(res, status, body, headers = {}) {
  const text = body === void 0 ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(text),
    ...headers
  });
  res.end(text);
}
function sendError(res, error) {
  sendJson(res, error.status, errorBody(error), error.headers);
}
var BODY_LIMIT = 16384;
var IMPORT_BODY_LIMIT = 1e6;
async function readBody(req, limit) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > limit) throw new ApiError(413, "too_large", "That request is too large.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk;
    size += piece.length;
    if (size > limit) throw new ApiError(413, "too_large", "That request is too large.");
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}
function parseCookies(header) {
  const found = {};
  for (const piece of (header ?? "").split(";")) {
    const index = piece.indexOf("=");
    if (index > 0) found[piece.slice(0, index).trim()] = piece.slice(index + 1).trim();
  }
  return found;
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
var KIND_WORDS = {
  string: "text",
  boolean: "true or false",
  integer: "a whole number",
  string_array: "a list of text",
  object: "an object",
  string_or_null: "text or null",
  object_or_null: "an object or null",
  any: "a value"
};
function matches(kind, value) {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string_array":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "string_or_null":
      return value === null || typeof value === "string";
    case "object_or_null":
      return value === null || typeof value === "object" && !Array.isArray(value);
    case "any":
      return true;
  }
}
var Fields = class {
  errors = {};
  add(name, message) {
    if (!(name in this.errors)) this.errors[name] = message;
  }
  get any() {
    return Object.keys(this.errors).length > 0;
  }
  throwIfAny() {
    if (this.any) throw invalid(this.errors);
  }
};
function checkBody(body, spec, fields) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    fields.add("body", "Send a JSON object.");
    return {};
  }
  const record2 = body;
  for (const key of Object.keys(record2)) {
    if (!(key in spec)) fields.add(key, NO_FIELD);
  }
  const values = {};
  for (const [key, rule] of Object.entries(spec)) {
    if (!(key in record2) || record2[key] === void 0) {
      if (!rule.optional) fields.add(key, "This is required.");
      continue;
    }
    if (!matches(rule.kind, record2[key])) {
      fields.add(key, `Send ${KIND_WORDS[rule.kind]}.`);
      continue;
    }
    values[key] = record2[key];
  }
  return values;
}
function parseJson(raw) {
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw invalid({ body: "Send valid JSON." });
  }
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record2 = value;
    return `{${Object.keys(record2).sort().map((key) => `${JSON.stringify(key)}:${canonical(record2[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
function fingerprint(method, path, raw) {
  let body;
  try {
    body = canonical(JSON.parse(raw.toString("utf8") || "{}"));
  } catch {
    body = raw.toString("utf8");
  }
  return createHash3("sha256").update(`${method}
${path}
${body}`).digest("hex");
}

// src/server/office-time.ts
var OFFICE_TIME_ZONE = "America/Chicago";
var parts = new Intl.DateTimeFormat("en-US", {
  timeZone: OFFICE_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short"
});
function officeMoment(instant) {
  const found = {};
  for (const part of parts.formatToParts(instant)) found[part.type] = part.value;
  return {
    date: `${found.year}-${found.month}-${found.day}`,
    time: `${found.hour}:${found.minute}`,
    second: Number(found.second),
    offset: found.timeZoneName === "CDT" ? "CDT" : "CST"
  };
}
function officeDate(instant) {
  return officeMoment(instant).date;
}
function offsetAt(instant) {
  return officeMoment(instant).offset;
}
var MINUTE = 6e4;
function localAsUtc(date, time) {
  return Date.parse(`${date}T${time}:00Z`);
}
function officeInstant(date, time) {
  const wanted = localAsUtc(date, time);
  for (const hours of [5, 6]) {
    const candidate = new Date(wanted + hours * 36e5);
    const seen = officeMoment(candidate);
    if (seen.date === date && seen.time === time) return { at: candidate, shifted: false };
  }
  for (let minutes = 1; minutes <= 180; minutes++) {
    const probe = new Date(wanted + 5 * 36e5 + minutes * MINUTE);
    const seen = officeMoment(probe);
    if (localAsUtc(seen.date, seen.time) >= wanted) return { at: probe, shifted: true };
  }
  throw new Error(`office time ${date} ${time} cannot be resolved`);
}
function officeMidnight(date) {
  return officeInstant(date, "00:00").at;
}
function addDays(date, days) {
  const moved = new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5);
  return moved.toISOString().slice(0, 10);
}
function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function isLocalMinute(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  return isRealDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60;
}
function weekday(date) {
  return (/* @__PURE__ */ new Date(`${date}T00:00:00Z`)).getUTCDay();
}
function isBusinessDay(date) {
  const day = weekday(date);
  return day >= 1 && day <= 5;
}
function businessDaysAfter(date, count) {
  let current = date;
  let remaining = count;
  while (remaining > 0) {
    current = addDays(current, 1);
    if (isBusinessDay(current)) remaining--;
  }
  return current;
}
function firstBusinessDayOnOrAfter(date) {
  let current = date;
  while (!isBusinessDay(current)) current = addDays(current, 1);
  return current;
}
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function officeDateText(date) {
  return `${WEEKDAYS[weekday(date)]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}
function officeStamp(instant) {
  const moment = officeMoment(instant);
  return `${officeDateText(moment.date)}, ${moment.time} ${moment.offset}`;
}
function utcIso(instant) {
  return instant.toISOString();
}
function localMinute(instant) {
  const moment = officeMoment(instant);
  return `${moment.date}T${moment.time}`;
}
function quarterOf(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  return { year, quarter, start: `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01` };
}
function nextNineteen(after) {
  const today = officeDate(after);
  const candidate = officeInstant(today, "19:00").at;
  if (candidate.getTime() > after.getTime()) return candidate;
  return officeInstant(addDays(today, 1), "19:00").at;
}

// src/server/audit.ts
async function record(tx, actor, action, subject, details = {}, at = now()) {
  const id = newId();
  await tx.query(
    `INSERT INTO audit (id, at, office_day, actor_person_id, actor_name, action, subject_kind, subject_id, subject_name, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      at,
      officeMoment(at).date,
      actor === "system" ? null : actor.personId,
      actor === "system" ? "Lockset" : actor.name,
      action,
      subject.kind,
      subject.id,
      subject.name,
      JSON.stringify(details)
    ]
  );
  return { id };
}
function view(row) {
  const moment = officeMoment(row.at);
  return {
    id: row.id,
    seq: row.seq,
    at: utcIso(row.at),
    office_day: row.office_day,
    office_time: moment.time,
    offset: moment.offset,
    actor: row.actor_person_id ? { person_id: row.actor_person_id, name: row.actor_name } : { system: "Lockset" },
    action: row.action,
    subject: { kind: row.subject_kind, id: row.subject_id, name: row.subject_name },
    details: row.details
  };
}
function encodeCursor(day, order, seq) {
  return Buffer.from(JSON.stringify({ d: day, o: order, s: seq })).toString("base64url");
}
function decodeCursor(cursor, day, order) {
  const refuse = () => {
    throw invalid({ after: "That cursor cannot be used for this day and order." });
  };
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return refuse();
  }
  if (typeof parsed !== "object" || parsed === null) return refuse();
  const { d, o, s } = parsed;
  if (d !== day || o !== order || typeof s !== "number" || !Number.isInteger(s)) return refuse();
  return s;
}
async function page(db2, day, order, limit, after) {
  const cursorSeq = after === null ? null : decodeCursor(after, day, order);
  const compare = order === "oldest" ? ">" : "<";
  const rows = await db2.query(
    `SELECT * FROM audit WHERE office_day = $1 ${cursorSeq === null ? "" : `AND seq ${compare} $3`}
     ORDER BY seq ${order === "oldest" ? "ASC" : "DESC"} LIMIT $2`,
    cursorSeq === null ? [day, limit + 1] : [day, limit + 1, cursorSeq]
  );
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    office_day: day,
    order,
    entries: shown.map(view),
    next_cursor: rows.length > limit && last ? encodeCursor(day, order, last.seq) : null
  };
}

// src/server/events.ts
var connections = /* @__PURE__ */ new Set();
function attach(connection) {
  connections.add(connection);
  connection.res.on("close", () => connections.delete(connection));
}
function connected() {
  return connections;
}
function send(connection, event, data) {
  connection.res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
}
var DESK_ROLES = ["office_manager", "managing_partner"];
function emitToDesk(event, data) {
  for (const connection of connections) {
    if (DESK_ROLES.includes(connection.role)) send(connection, event, data);
  }
}
function closePerson(personId) {
  for (const connection of [...connections]) {
    if (connection.personId === personId) connection.res.end();
  }
}
function keepAlive() {
  for (const connection of connections) connection.res.write(`: keepalive ${now().getTime()}

`);
}

// src/server/idempotency.ts
var KEPT_MS = 24 * 36e5;
var POLL_MS = 150;
var PENDING_WAIT_MS = 3e4;
function replay(row) {
  return { status: row.status, body: row.body === "" ? void 0 : JSON.parse(row.body) };
}
async function withIdempotency(req, personId, raw, run) {
  const key = req.headers["idempotency-key"];
  if (key === void 0) return run();
  if (typeof key !== "string" || !/^[\x21-\x7e]{1,100}$/.test(key)) {
    throw invalid({ "Idempotency-Key": "Use 1 to 100 visible characters." });
  }
  const endpoint = `${req.method ?? "POST"} ${(req.url ?? "").split("?")[0]}`;
  const print = fingerprint(req.method ?? "POST", endpoint, raw);
  const deadline = Date.now() + PENDING_WAIT_MS;
  for (; ; ) {
    const claimed = await write(async (tx) => {
      await tx.query("DELETE FROM idempotency WHERE created_at < $1", [new Date(now().getTime() - KEPT_MS)]);
      const row = await tx.one("SELECT fingerprint, status, body FROM idempotency WHERE person_id = $1 AND endpoint = $2 AND key = $3", [
        personId,
        endpoint,
        key
      ]);
      if (!row) {
        await tx.query("INSERT INTO idempotency (person_id, endpoint, key, fingerprint, status, body, created_at) VALUES ($1,$2,$3,$4,0,'',$5)", [
          personId,
          endpoint,
          key,
          print,
          now()
        ]);
        return "new";
      }
      if (row.fingerprint !== print) throw new ApiError(409, "idempotency_conflict", "That key was already used for a different request.");
      return row.status === 0 ? "pending" : row;
    });
    if (claimed === "new") break;
    if (claimed !== "pending") return replay(claimed);
    if (Date.now() > deadline) throw new ApiError(409, "idempotency_conflict", "That request is still being processed.");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const forget = () => write((tx) => tx.query("DELETE FROM idempotency WHERE person_id = $1 AND endpoint = $2 AND key = $3", [personId, endpoint, key]));
  let reply;
  try {
    reply = await run();
  } catch (error) {
    await forget();
    throw error;
  }
  if (reply.status >= 300) {
    await forget();
    return reply;
  }
  await db.query("UPDATE idempotency SET status = $4, body = $5 WHERE person_id = $1 AND endpoint = $2 AND key = $3", [
    personId,
    endpoint,
    key,
    reply.status,
    reply.body === void 0 ? "" : JSON.stringify(reply.body)
  ]);
  return reply;
}

// src/server/model.ts
var ROLES = ["office_manager", "managing_partner", "staff_accountant", "outside_bookkeeper"];
var isDesk = (role) => role === "office_manager" || role === "managing_partner";

// src/server/visibility.ts
function termEndInstant(endsOn) {
  return officeInstant(endsOn, "23:59").at;
}
function termRunning(person, at) {
  if (person.role !== "outside_bookkeeper" || !person.term_starts_on || !person.term_ends_on) return false;
  return officeMidnight(person.term_starts_on).getTime() <= at.getTime() && at.getTime() < termEndInstant(person.term_ends_on).getTime();
}
async function visibleVaultIds(db2, person, at) {
  if (person.left_at) return [];
  if (isDesk(person.role)) return (await db2.query("SELECT id FROM vaults ORDER BY ord")).map((row) => row.id);
  if (person.role === "outside_bookkeeper" && !termRunning(person, at)) return [];
  const travelling = await db2.one(
    "SELECT EXISTS (SELECT 1 FROM travel WHERE person_id = $1 AND starts_at <= $2 AND $2 < ends_at) AS open",
    [person.id, at]
  );
  const rows = await db2.query(
    `SELECT v.id FROM vaults v JOIN person_vaults pv ON pv.vault_id = v.id
     WHERE pv.person_id = $1 AND NOT ($2 AND v.off_when_travelling) ORDER BY v.ord`,
    [person.id, travelling?.open ?? false]
  );
  return rows.map((row) => row.id);
}
async function canSeeVault(db2, person, vaultId, at) {
  return (await visibleVaultIds(db2, person, at)).includes(vaultId);
}
async function scopeVaultIds(db2, person) {
  if (isDesk(person.role)) return (await db2.query("SELECT id FROM vaults ORDER BY ord")).map((row) => row.id);
  return (await db2.query(
    "SELECT v.id FROM vaults v JOIN person_vaults pv ON pv.vault_id = v.id WHERE pv.person_id = $1 ORDER BY v.ord",
    [person.id]
  )).map((row) => row.id);
}

// src/server/access-sync.ts
async function syncAccess(personId, cause) {
  const mine = [...connected()].filter((connection) => connection.personId === personId);
  if (mine.length === 0) return;
  const person = await db.one("SELECT * FROM people WHERE id = $1", [personId]);
  if (!person) return;
  const visible = await visibleVaultIds(db, person, now());
  const names = new Map((await db.query("SELECT id, name FROM vaults")).map((vault) => [vault.id, vault.name]));
  for (const connection of mine) {
    const ended = [...connection.known].filter((id) => !visible.includes(id));
    const changed = ended.length > 0 || visible.some((id) => !connection.known.has(id));
    connection.known = new Set(visible);
    if (!changed) continue;
    send(connection, "access-changed", {
      vault_ids: visible,
      ended: ended.map((id) => ({ vault_id: id, name: names.get(id) ?? "" })),
      cause
    });
  }
  if (person.left_at) closePerson(personId);
}
async function sweepBoundaries() {
  const people = new Set([...connected()].map((connection) => connection.personId));
  for (const personId of people) await syncAccess(personId, "boundary");
}

// src/server/keycloak.ts
var KeycloakUnavailable = class extends Error {
};
var TIMEOUT_MS = 5e3;
var ATTEMPTS = 3;
var BACKOFF_MS = [200, 500];
var admin = `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}`;
var tokenUrl = `${config.authIssuerUrl}/protocol/openid-connect/token`;
var cached = null;
async function call2(url, init) {
  let why = "unknown";
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await new Promise((resume) => setTimeout(resume, BACKOFF_MS[attempt - 1] ?? 500));
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status < 502 || response.status > 504) return response;
      why = `HTTP ${response.status}`;
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      why = cause instanceof Error ? `${cause.name} ${cause.code ?? ""} ${cause.message}` : "unknown";
    }
  }
  console.error("keycloak call failed:", why);
  throw new KeycloakUnavailable("Keycloak cannot be reached");
}
async function adminToken() {
  if (cached && cached.expires > Date.now()) return cached.token;
  const response = await call2(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.authClientId,
      client_secret: config.authClientSecret
    })
  });
  if (response.status !== 200) throw new KeycloakUnavailable("Keycloak refused the service account");
  const body = await response.json();
  cached = { token: body.access_token, expires: Date.now() + Math.max(body.expires_in - 15, 5) * 1e3 };
  return body.access_token;
}
async function adminCall(method, path, body) {
  const token = await adminToken();
  const response = await call2(`${admin}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...body === void 0 ? {} : { "Content-Type": "application/json" } },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  if (response.status === 401) cached = null;
  if (response.status >= 500 || response.status === 401) throw new KeycloakUnavailable("Keycloak answered with an error");
  return response;
}
function usernameOf(handle2) {
  return `${config.officeKey}.${handle2}`;
}
async function createUser(user) {
  const words2 = user.fullName.trim().split(/\s+/);
  const first = words2[0] ?? user.fullName;
  const last = words2.length > 1 ? words2.slice(1).join(" ") : first;
  const response = await adminCall("POST", "/users", {
    username: usernameOf(user.handle),
    enabled: user.enabled,
    emailVerified: true,
    firstName: first,
    lastName: last,
    email: `${usernameOf(user.handle)}@people.lockset.example`,
    credentials: [{ type: "password", value: user.password, temporary: false }]
  });
  if (response.status === 201) return "created";
  if (response.status === 409) return "exists";
  throw new KeycloakUnavailable(`Keycloak refused the user (${response.status})`);
}
async function findUserId(handle2) {
  const response = await adminCall("GET", `/users?username=${encodeURIComponent(usernameOf(handle2))}&exact=true`);
  if (response.status !== 200) throw new KeycloakUnavailable("Keycloak could not search users");
  const found = await response.json();
  return found.find((user) => user.username === usernameOf(handle2))?.id ?? null;
}
async function setEnabled(handle2, enabled) {
  const id = await findUserId(handle2);
  if (!id) return;
  const response = await adminCall("PUT", `/users/${id}`, { enabled });
  if (response.status !== 204) throw new KeycloakUnavailable("Keycloak could not update the user");
  if (!enabled) await adminCall("POST", `/users/${id}/logout`);
}
async function passwordGrant(handle2, password) {
  const response = await call2(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: config.authClientId,
      client_secret: config.authClientSecret,
      username: usernameOf(handle2),
      password
    })
  });
  if (response.status === 200) {
    const body2 = await response.json();
    if (body2.refresh_token) {
      await call2(`${config.authIssuerUrl}/protocol/openid-connect/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.authClientId,
          client_secret: config.authClientSecret,
          refresh_token: body2.refresh_token
        })
      }).catch(() => void 0);
    }
    return "ok";
  }
  if (response.status >= 500) throw new KeycloakUnavailable("Keycloak answered with an error");
  const body = await response.json().catch(() => ({}));
  if (/disabled/i.test(body.error_description ?? "")) return "account_disabled";
  return "bad_credentials";
}

// src/server/people-view.ts
function statusOf(person, windows, at) {
  if (person.left_at) return "left";
  if (windows.some((window) => window.starts_at.getTime() <= at.getTime() && at.getTime() < window.ends_at.getTime())) return "travelling";
  if (termRunning(person, at)) return "on_term";
  if (!person.first_sign_in_at) return "invited";
  return "active";
}
function viewOf(person, windows, scopes, allVaults, at) {
  return {
    id: person.id,
    full_name: person.full_name,
    email: person.email,
    handle: person.handle,
    role: person.role,
    aliases: person.aliases,
    status: statusOf(person, windows, at),
    vault_ids: person.left_at ? [] : isDesk(person.role) ? allVaults : scopes,
    term: person.term_starts_on && person.term_ends_on ? { starts_on: person.term_starts_on, ends_on: person.term_ends_on } : null,
    travel: windows.map((window) => ({ id: window.id, starts_at: localMinute(window.starts_at), ends_at: localMinute(window.ends_at) })),
    seat: person.seat,
    left_at: person.left_at ? utcIso(person.left_at) : null
  };
}
async function peopleJson(db2, rows, at) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [travel, scopes, vaults] = await Promise.all([
    db2.query("SELECT id, person_id, starts_at, ends_at FROM travel WHERE person_id = ANY($1) ORDER BY starts_at", [ids]),
    db2.query(
      `SELECT pv.person_id, pv.vault_id FROM person_vaults pv JOIN vaults v ON v.id = pv.vault_id
       WHERE pv.person_id = ANY($1) ORDER BY v.ord`,
      [ids]
    ),
    db2.query("SELECT id FROM vaults ORDER BY ord")
  ]);
  const allVaults = vaults.map((vault) => vault.id);
  return rows.map(
    (row) => viewOf(
      row,
      travel.filter((window) => window.person_id === row.id),
      scopes.filter((scope) => scope.person_id === row.id).map((scope) => scope.vault_id),
      allVaults,
      at
    )
  );
}
async function personJson(db2, row, at) {
  const [view2] = await peopleJson(db2, [row], at);
  if (!view2) throw new Error("person view failed");
  return view2;
}

// src/server/landing.ts
var DESK = ["office_manager", "managing_partner"];
var DESK_ROUTES = {
  "/desk": ["office_manager", "managing_partner", "staff_accountant", "outside_bookkeeper"],
  "/rotations": DESK,
  "/reviews": DESK,
  "/people": DESK,
  "/travel": ["staff_accountant", "outside_bookkeeper"],
  "/billing": DESK,
  "/health": DESK,
  "/import": ["office_manager"],
  "/audit": DESK
};
var PUBLIC_ROUTES = ["/", "/sign-in"];
function isKnownPath(path) {
  return PUBLIC_ROUTES.includes(path) || path in DESK_ROUTES || /^\/desk\/vaults\/[^/]+$/.test(path);
}
function safeNext(next, role, visible) {
  if (typeof next !== "string" || next.length > 300) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000- \u007f]/.test(next)) return null;
  const path = next.split(/[?#]/, 1)[0] ?? "";
  const allowed = DESK_ROUTES[path];
  if (allowed) return allowed.includes(role) ? next : null;
  const vault = /^\/desk\/vaults\/([^/]+)$/.exec(path);
  return vault && visible.includes(decodeURIComponent(vault[1] ?? "")) ? next : null;
}
async function landingFor(db2, person, next) {
  const visible = await visibleVaultIds(db2, person, now());
  const chosen = safeNext(next, person.role, visible);
  if (chosen) return chosen;
  const first = visible[0];
  return first ? `/desk/vaults/${first}` : "/desk";
}

// src/server/sessions.ts
var COOKIE = "lockset_session";
var signedOut = () => new ApiError(401, "signed_out", "Sign in to continue.");
async function authenticate(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) throw signedOut();
  const tokenHash = hashToken(token);
  const row = await db.one("SELECT * FROM sessions WHERE token_hash = $1", [tokenHash]);
  if (!row) throw signedOut();
  const person = await db.one("SELECT * FROM people WHERE id = $1", [row.person_id]);
  if (!person || person.left_at || row.revoked_at) throw signedOut();
  if (now().getTime() >= row.ends_at.getTime()) throw new ApiError(401, "session_ended", "Your reveal session has ended.");
  return { tokenHash, person, startedAt: row.started_at, endsAt: row.ends_at };
}
function sessionEnd(startedAt) {
  const byLimit = new Date(startedAt.getTime() + config.revealSessionSeconds * 1e3);
  const byCutOff = nextNineteen(startedAt);
  return byLimit.getTime() < byCutOff.getTime() ? byLimit : byCutOff;
}
function revokeSessions(tx, personId, at) {
  return tx.query("UPDATE sessions SET revoked_at = $2 WHERE person_id = $1 AND revoked_at IS NULL", [personId, at]);
}
var FAILURES_TO_LOCK = 5;
function lockKey(username) {
  return typeof username === "string" ? username.trim().toLowerCase().slice(0, 64) : "";
}
async function refuseWhileLocked(username) {
  const row = await db.one("SELECT * FROM sign_in_state WHERE handle = $1", [lockKey(username)]);
  if (!row?.locked_until || row.locked_until.getTime() <= now().getTime()) return;
  const seconds = Math.max(1, Math.ceil((row.locked_until.getTime() - now().getTime()) / 1e3));
  throw new ApiError(
    429,
    "sign_in_locked",
    `Too many tries. Sign-in for this username reopens at ${officeStamp(row.locked_until)}.`,
    void 0,
    { "Retry-After": String(seconds) }
  );
}
async function recordFailure(username) {
  const handle2 = lockKey(username);
  await write(async (tx) => {
    const at = now();
    const row = await tx.one("SELECT * FROM sign_in_state WHERE handle = $1", [handle2]);
    const windowMs = config.signInLockSeconds * 1e3;
    const fresh = !row || at.getTime() - row.window_started_at.getTime() >= windowMs;
    const failures = fresh ? 1 : row.failures + 1;
    const started = fresh || !row ? at : row.window_started_at;
    const lockedUntil = failures >= FAILURES_TO_LOCK ? new Date(at.getTime() + windowMs) : null;
    await tx.query(
      `INSERT INTO sign_in_state (handle, failures, window_started_at, locked_until) VALUES ($1,$2,$3,$4)
       ON CONFLICT (handle) DO UPDATE SET failures = $2, window_started_at = $3, locked_until = $4`,
      [handle2, failures, started, lockedUntil]
    );
  });
}
var SIGN_IN = {
  username: { kind: "string" },
  password: { kind: "string" },
  next: { kind: "any", optional: true }
};
async function signIn(body) {
  const fields = new Fields();
  const values = checkBody(body, SIGN_IN, fields);
  fields.throwIfAny();
  const username = String(values.username);
  const handle2 = lockKey(username);
  const person = await db.one("SELECT * FROM people WHERE handle = $1", [handle2]);
  let grant = "bad_credentials";
  if (person) {
    try {
      grant = await passwordGrant(person.handle, String(values.password));
    } catch (error) {
      if (error instanceof KeycloakUnavailable) {
        throw new ApiError(503, "sign_in_unavailable", "Sign-in is unavailable right now. Try again in a minute.");
      }
      throw error;
    }
  }
  if (grant === "account_disabled") {
    throw new ApiError(401, "account_disabled", "This sign-in is switched off. Ask the office manager.");
  }
  if (grant === "bad_credentials" || !person) {
    await recordFailure(username);
    throw new ApiError(401, "bad_credentials", "That username and password don't match.");
  }
  const token = newToken();
  const startedAt = now();
  const endsAt = sessionEnd(startedAt);
  const landing = await write(async (tx) => {
    await tx.query("DELETE FROM sign_in_state WHERE handle = $1", [handle2]);
    await tx.query("INSERT INTO sessions (token_hash, person_id, started_at, ends_at) VALUES ($1,$2,$3,$4)", [
      hashToken(token),
      person.id,
      startedAt,
      endsAt
    ]);
    await tx.query("UPDATE people SET first_sign_in_at = COALESCE(first_sign_in_at, $2) WHERE id = $1", [person.id, startedAt]);
    return landingFor(tx, person, values.next);
  });
  const fresh = await db.one("SELECT * FROM people WHERE id = $1", [person.id]);
  return {
    status: 201,
    body: { person: await personJson(db, fresh ?? person, now()), session_ends_at: endsAt.toISOString(), landing },
    headers: { "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` }
  };
}
async function signOut(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await write((tx) => tx.query("UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1", [hashToken(token), now()]));
  return { status: 204, headers: { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } };
}

// src/server/review-lines.ts
var quarterLabel = (review) => `Q${review.quarter} ${review.quarter_year}`;
function reviewSubject(review) {
  return { kind: "review", id: review.id, name: `${quarterLabel(review)} access review` };
}
async function unsignedReviews(tx) {
  return tx.query("SELECT * FROM reviews WHERE status <> 'signed_off' ORDER BY ord");
}
function announce(tx, reviewIds) {
  const ids = [...new Set(reviewIds)];
  if (ids.length === 0) return;
  tx.after(() => ids.forEach((id) => emitToDesk("review-changed", { review_id: id })));
}
async function closeLines(tx, person, vaultId, vaultName, actor, at) {
  const lines = await tx.query(
    `SELECT l.id, l.review_id FROM review_lines l JOIN reviews r ON r.id = l.review_id
     WHERE l.person_id = $1 AND l.vault_id = $2 AND l.decision = 'undecided' AND r.status <> 'signed_off' ORDER BY r.ord`,
    [person.id, vaultId]
  );
  for (const line of lines) {
    await tx.query("UPDATE review_lines SET decision = 'removed', decided_by = NULL, decided_via = 'scope_change' WHERE id = $1", [line.id]);
    const review = await tx.one("SELECT * FROM reviews WHERE id = $1", [line.review_id]);
    await record(
      tx,
      actor,
      "review_decision",
      { kind: "person", id: person.id, name: person.full_name },
      { decided_via: "scope_change", decision: "removed", vault: vaultName, review: review ? quarterLabel(review) : null },
      at
    );
  }
  announce(tx, lines.map((line) => line.review_id));
}
async function addLines(tx, person, vaults, actor, at) {
  if (isDesk(person.role)) return;
  const touched = [];
  for (const review of await unsignedReviews(tx)) {
    for (const vault of vaults) {
      const existing = await tx.one(
        "SELECT id FROM review_lines WHERE review_id = $1 AND person_id = $2 AND vault_id = $3 AND decision = 'undecided'",
        [review.id, person.id, vault.id]
      );
      if (existing) continue;
      await tx.query(
        "INSERT INTO review_lines (id, review_id, person_id, vault_id, decision) VALUES ($1,$2,$3,$4,'undecided')",
        [newId(), review.id, person.id, vault.id]
      );
      await record(
        tx,
        actor,
        "review_line_added",
        { kind: "person", id: person.id, name: person.full_name },
        { vault: vault.name, review: quarterLabel(review) },
        at
      );
      touched.push(review.id);
    }
  }
  announce(tx, touched);
}

// src/server/rotations.ts
var ROTATION_ROWS_AHEAD = 6;
function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
}
function runAt(schedule, k) {
  const date = addDays(schedule.first_run_on, k * schedule.interval_days);
  const { at, shifted } = officeInstant(date, schedule.at_time);
  const moment = officeMoment(at);
  return { k, office_date: date, office_time: moment.time, offset: moment.offset, at, shifted };
}
function runsAfter(schedule, after, count) {
  const gap = daysBetween(schedule.first_run_on, officeDate(after));
  let k = Math.max(0, Math.floor(gap / schedule.interval_days) - 1);
  const found = [];
  while (found.length < count) {
    const run = runAt(schedule, k++);
    if (run.at.getTime() > after.getTime()) found.push(run);
  }
  return found;
}
function runsBetween(schedule, after, until) {
  const gap = daysBetween(schedule.first_run_on, officeDate(after));
  let k = Math.max(0, Math.floor(gap / schedule.interval_days) - 1);
  const found = [];
  for (; ; ) {
    const run = runAt(schedule, k++);
    if (run.at.getTime() > until.getTime()) return found;
    if (run.at.getTime() > after.getTime()) found.push(run);
  }
}
function runsInDates(schedule, from, to) {
  const gap = daysBetween(schedule.first_run_on, from);
  let k = Math.max(0, Math.floor(gap / schedule.interval_days) - 1);
  const found = [];
  for (; ; ) {
    const run = runAt(schedule, k++);
    if (run.office_date > to) return found;
    if (run.office_date >= from) found.push(run);
  }
}
function runJson(run) {
  return {
    office_date: run.office_date,
    office_time: run.office_time,
    offset: run.offset,
    at: run.at.toISOString(),
    shifted: run.shifted
  };
}
function rotationJson(rotation, at) {
  return {
    id: rotation.id,
    credential_id: rotation.credential_id,
    interval_days: rotation.interval_days,
    at_time: rotation.at_time,
    first_run_on: rotation.first_run_on,
    next_runs: runsAfter(rotation, at, ROTATION_ROWS_AHEAD).map(runJson)
  };
}

// src/server/turns.ts
async function createScopeLossTurns(tx, vault, actor, at) {
  const dueBy = businessDaysAfter(officeDate(at), 2);
  const logins = await tx.query("SELECT * FROM credentials WHERE vault_id = $1 ORDER BY ord", [vault.id]);
  const created = [];
  for (const login of logins) {
    await tx.query(
      "INSERT INTO turns (id, credential_id, kind, due_by, state, created_at) VALUES ($1,$2,'scope_loss',$3,'due',$4)",
      [newId(), login.id, dueBy, at]
    );
    await record(
      tx,
      actor,
      "turn_due",
      { kind: "login", id: login.id, name: login.label },
      actor === "system" ? { due_by: dueBy } : { due_by: dueBy, confirmed_by: actor.name },
      at
    );
    created.push({ credential_id: login.id, label: login.label, due_by: dueBy });
  }
  return created;
}
async function completeTurns(tx, login, actor) {
  const open2 = await tx.query("SELECT * FROM turns WHERE credential_id = $1 AND state <> 'turned' ORDER BY ord", [login.id]);
  for (const turn of open2) {
    await tx.query("UPDATE turns SET state = 'turned' WHERE id = $1", [turn.id]);
    await record(tx, actor, "turn_done", { kind: "login", id: login.id, name: login.label }, { turn_id: turn.id });
  }
}
async function dueRuns(tx, at) {
  const rotations = await tx.query(
    "SELECT r.*, c.label FROM rotations r JOIN credentials c ON c.id = r.credential_id"
  );
  let created = 0;
  for (const rotation of rotations) {
    for (const run of runsBetween(rotation, rotation.since, at)) {
      const turn = await tx.one(
        `INSERT INTO turns (id, credential_id, kind, rotation_id, run_at, run_date, shifted, due_by, state, created_at)
         VALUES ($1,$2,'scheduled',$3,$4,$5,$6,$7,'due',$8) ON CONFLICT (rotation_id, run_at) DO NOTHING RETURNING id`,
        [newId(), rotation.credential_id, rotation.id, run.at, run.office_date, run.shifted, businessDaysAfter(run.office_date, 2), run.at]
      );
      if (!turn) continue;
      created++;
      await record(
        tx,
        "system",
        "rotation_due",
        { kind: "login", id: rotation.credential_id, name: rotation.label },
        { turn_id: turn.id, run_on: run.office_date },
        run.at
      );
    }
  }
  return created;
}
async function overdueTurns(tx, at) {
  const today = officeDate(at);
  const late = await tx.query(
    `SELECT t.*, c.label FROM turns t JOIN credentials c ON c.id = t.credential_id
     WHERE t.state = 'due' AND t.due_by < $1 ORDER BY t.due_by, t.ord`,
    [today]
  );
  for (const turn of late) {
    await tx.query("UPDATE turns SET state = 'overdue' WHERE id = $1", [turn.id]);
    await record(
      tx,
      "system",
      "rotation_overdue",
      { kind: "login", id: turn.credential_id, name: turn.label },
      { turn_id: turn.id, due_by: turn.due_by },
      officeMidnight(addDays(turn.due_by, 1))
    );
  }
  return late.length;
}

// src/server/scopes.ts
async function vaultsInOrder(tx, ids) {
  return tx.query("SELECT * FROM vaults WHERE id = ANY($1) ORDER BY ord", [ids]);
}
async function dropScopes(tx, person, vaultIds, actor, at) {
  const turns = [];
  for (const vault of await vaultsInOrder(tx, vaultIds)) {
    await tx.query("DELETE FROM person_vaults WHERE person_id = $1 AND vault_id = $2", [person.id, vault.id]);
    await record(tx, actor, "scope_removed", { kind: "person", id: person.id, name: person.full_name }, { vault_id: vault.id, vault: vault.name }, at);
    await closeLines(tx, person, vault.id, vault.name, actor, at);
    turns.push(...await createScopeLossTurns(tx, vault, actor, at));
  }
  return turns;
}
async function gainScopes(tx, person, vaultIds, actor, at) {
  const vaults = await vaultsInOrder(tx, vaultIds);
  for (const vault of vaults) {
    await tx.query("INSERT INTO person_vaults (person_id, vault_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [person.id, vault.id]);
  }
  await addLines(tx, person, vaults, actor, at);
}

// src/server/seats.ts
var inFlight = /* @__PURE__ */ new Map();
var POLL_MS2 = 400;
async function settle(until, ready) {
  for (; ; ) {
    if (await ready()) return true;
    if (Date.now() + POLL_MS2 >= until) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS2));
  }
}
async function advance(handle2, change) {
  let seat = await findSeat(handle2);
  if (!seat) {
    await buySeat(handle2);
    seat = await findSeat(handle2);
  }
  if (change === "add") return purchaseConfirmed(seat);
  if (purchaseConfirmed(seat)) {
    await cancelSeat(seat.subscriptionId);
    seat = await findSeat(handle2);
  }
  return releaseConfirmed(seat);
}
async function settleSeat(person, change, actor) {
  const from = change === "add" ? "waiting_on_billing" : "release_waiting";
  const to = change === "add" ? "confirmed" : "released";
  await write(async (tx) => {
    const done = await tx.one("SELECT seat_silent FROM people WHERE id = $1 AND seat = $2", [person.id, from]);
    if (!done) return;
    await tx.query("UPDATE people SET seat = $2, seat_silent = false, seat_since = $3 WHERE id = $1", [person.id, to, now()]);
    if (!done.seat_silent) {
      await record(tx, actor, change === "add" ? "seat_confirmed" : "seat_released", { kind: "person", id: person.id, name: person.full_name });
    }
    tx.after(() => {
      emitToDesk("billing-changed", {});
      emitToDesk("seat-confirmed", { person_id: person.id, name: person.full_name, change });
    });
  });
}
async function driveSeat(personId, until, actor) {
  for (let running2 = inFlight.get(personId); running2; running2 = inFlight.get(personId)) await running2.catch(() => false);
  const run = drive(personId, until, actor).finally(() => inFlight.delete(personId));
  inFlight.set(personId, run);
  return run;
}
async function drive(personId, until, actor) {
  try {
    const person = await db.one("SELECT * FROM people WHERE id = $1", [personId]);
    if (!person) return false;
    if (person.seat === "confirmed" || person.seat === "released") return true;
    const change = person.seat === "waiting_on_billing" ? "add" : "release";
    if (!await settle(until, () => advance(person.handle, change))) return false;
    await settleSeat(person, change, actor);
    return true;
  } catch (error) {
    if (error instanceof BillingUnavailable) return false;
    throw error;
  }
}
async function markWaiting(person, actor) {
  await write(async (tx) => {
    await record(tx, actor, "seat_waiting", { kind: "person", id: person.id, name: person.full_name });
    tx.after(() => emitToDesk("billing-changed", {}));
  });
}
var WAIT_FOR_BILLING_MS = 3500;
async function retryWaiting() {
  const waiting = await db.query("SELECT id FROM people WHERE seat IN ('waiting_on_billing','release_waiting')");
  if (waiting.length === 0) return;
  try {
    await ensureReady();
  } catch {
    return;
  }
  await Promise.all(waiting.filter((row) => !inFlight.has(row.id)).map((row) => driveSeat(row.id, Date.now(), "system")));
}

// src/server/people.ts
var HANDLE = /^[a-z][a-z0-9-]{1,19}$/;
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var DAY_MS = 864e5;
var actorOf = (person) => ({ personId: person.id, name: person.full_name });
var personSubject = (person) => ({
  kind: "person",
  id: person.id,
  name: person.full_name
});
async function loadPerson(db2, id) {
  return db2.one("SELECT * FROM people WHERE id = $1", [id]);
}
async function listPeople() {
  return peopleJson(db, await db.query("SELECT * FROM people ORDER BY ord"), now());
}
function serviceDown() {
  return new ApiError(503, "sign_in_unavailable", "Sign-in is unavailable right now. Try again in a minute.");
}
function checkAliases(value, fields) {
  const aliases = Array.isArray(value) ? value : [];
  if (aliases.length > 5) fields.add("aliases", "Give at most 5 aliases.");
  else if (aliases.some((alias) => alias.trim().length < 1 || alias.trim().length > 30)) fields.add("aliases", "Each alias is 1 to 30 characters.");
  return aliases.map((alias) => alias.trim());
}
async function checkVaultIds(tx, value, fields) {
  const ids = Array.isArray(value) ? [...new Set(value)] : [];
  if (ids.length > 0) {
    const found = await tx.query("SELECT id FROM vaults WHERE id = ANY($1)", [ids]);
    if (found.length !== ids.length) fields.add("vault_ids", "Pick vaults that exist.");
  }
  return ids;
}
function checkTerm(value, role, fields, today) {
  if (role !== "outside_bookkeeper") {
    if (value !== null && value !== void 0) fields.add("term", "Only an outside bookkeeper has an engagement term.");
    return null;
  }
  const term = value;
  if (!term) {
    fields.add("term", "An outside bookkeeper needs an engagement term.");
    return null;
  }
  const { starts_on: starts, ends_on: ends } = term;
  if (typeof starts !== "string" || typeof ends !== "string" || !isRealDate(starts) || !isRealDate(ends)) {
    fields.add("term", "Give the term as two dates.");
    return null;
  }
  if (ends < starts || ends < today) {
    fields.add("term", "The term must end on or after its start and on or after today.");
    return null;
  }
  return { starts_on: starts, ends_on: ends };
}
var JOINER = {
  full_name: { kind: "string" },
  email: { kind: "string" },
  handle: { kind: "string" },
  role: { kind: "string" },
  aliases: { kind: "string_array" },
  vault_ids: { kind: "string_array" },
  initial_password: { kind: "string" },
  term: { kind: "object_or_null" }
};
async function addJoiner(actor, body) {
  const created = await write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, JOINER, fields);
    const at = now();
    const today = officeDate(at);
    const fullName = typeof v.full_name === "string" ? v.full_name.trim() : "";
    if (v.full_name !== void 0 && (fullName.length < 2 || fullName.length > 80)) fields.add("full_name", "Use 2 to 80 characters.");
    const email = typeof v.email === "string" ? v.email.trim() : "";
    if (v.email !== void 0) {
      if (!EMAIL.test(email)) fields.add("email", "Give a valid email address.");
      else if (await tx.one("SELECT 1 FROM people WHERE lower(email) = lower($1)", [email])) fields.add("email", "That email is already on record.");
    }
    const handle2 = typeof v.handle === "string" ? v.handle : "";
    if (v.handle !== void 0) {
      if (!HANDLE.test(handle2)) fields.add("handle", "Use 2 to 20 characters: a lowercase letter, then letters, digits or hyphens.");
      else if (await tx.one("SELECT 1 FROM people WHERE handle = $1", [handle2])) fields.add("handle", "That handle has been used in this office.");
    }
    const role = ROLES.find((candidate) => candidate === v.role) ?? null;
    if (v.role !== void 0 && !role) fields.add("role", "Pick one of the four roles.");
    const aliases = checkAliases(v.aliases, fields);
    const vaultIds = await checkVaultIds(tx, v.vault_ids, fields);
    const password = typeof v.initial_password === "string" ? v.initial_password : "";
    if (v.initial_password !== void 0 && (password.length < 12 || password.length > 64)) fields.add("initial_password", "Use 12 to 64 characters.");
    const term = v.term !== void 0 ? checkTerm(v.term, role, fields, today) : null;
    if (v.term === void 0 && role === "outside_bookkeeper") fields.add("term", "An outside bookkeeper needs an engagement term.");
    fields.throwIfAny();
    if (!role) throw new Error("role was validated");
    const startsNow = !term || term.starts_on <= today;
    try {
      const made = await createUser({ handle: handle2, fullName, password, enabled: startsNow });
      if (made === "exists") throw invalid({ handle: "That handle has been used in this office." });
    } catch (error) {
      if (error instanceof KeycloakUnavailable) throw serviceDown();
      throw error;
    }
    const id = newId();
    await tx.query(
      `INSERT INTO people (id, full_name, email, handle, role, aliases, term_starts_on, term_ends_on, term_started, seat, seat_since, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'waiting_on_billing',$10,$10)`,
      [id, fullName, email, handle2, role, aliases, term?.starts_on ?? null, term?.ends_on ?? null, term !== null && term.starts_on <= today, at]
    );
    const person = await tx.one("SELECT * FROM people WHERE id = $1", [id]);
    if (!person) throw new Error("joiner was not stored");
    await record(tx, actorOf(actor), "person_join", personSubject(person), { role, vault_ids: isDesk(role) ? [] : vaultIds });
    if (term && term.starts_on <= today) await record(tx, actorOf(actor), "term_start", personSubject(person), term);
    if (!isDesk(role)) await gainScopes(tx, person, vaultIds, actorOf(actor), at);
    return person;
  });
  const confirmed = await driveSeat(created.id, Date.now() + WAIT_FOR_BILLING_MS, actorOf(actor));
  if (!confirmed) await markWaiting(created, actorOf(actor));
  const fresh = await loadPerson(db, created.id);
  return personJson(db, fresh ?? created, now());
}
var MOVER = {
  role: { kind: "string", optional: true },
  vault_ids: { kind: "string_array", optional: true },
  aliases: { kind: "string_array", optional: true },
  term_ends_on: { kind: "string", optional: true }
};
async function changeAccess(actor, personId, body) {
  const changed = await write(async (tx) => {
    const person = await loadPerson(tx, personId);
    if (!person) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    if (person.id === actor.id) throw conflict("own_record", "You cannot change your own record.");
    if (person.left_at) throw conflict("already_left", `${person.full_name} has already left.`);
    const fields = new Fields();
    const v = checkBody(body, MOVER, fields);
    const at = now();
    const today = officeDate(at);
    const role = v.role === void 0 ? person.role : ROLES.find((candidate) => candidate === v.role) ?? null;
    if (!role) fields.add("role", "Pick one of the four roles.");
    const aliases = v.aliases === void 0 ? person.aliases : checkAliases(v.aliases, fields);
    const requested = v.vault_ids === void 0 ? null : await checkVaultIds(tx, v.vault_ids, fields);
    let termEnds = person.term_ends_on;
    let termStarts = person.term_starts_on;
    if (role === "outside_bookkeeper") {
      if (typeof v.term_ends_on === "string") {
        if (!isRealDate(v.term_ends_on) || v.term_ends_on < today || termStarts && person.role === "outside_bookkeeper" && v.term_ends_on < termStarts) {
          fields.add("term_ends_on", "The term must end on or after today.");
        } else termEnds = v.term_ends_on;
        if (person.role !== "outside_bookkeeper") termStarts = today;
      } else if (person.role !== "outside_bookkeeper") fields.add("term", "An outside bookkeeper needs an engagement term.");
    } else {
      if (v.term_ends_on !== void 0) fields.add("term_ends_on", "Only an outside bookkeeper has an engagement term.");
      termEnds = null;
      termStarts = null;
    }
    fields.throwIfAny();
    if (!role) throw new Error("role was validated");
    const before = await scopeVaultIds(tx, person);
    const stored = (await tx.query("SELECT vault_id FROM person_vaults WHERE person_id = $1", [person.id])).map((row) => row.vault_id);
    const allVaults = (await tx.query("SELECT id FROM vaults ORDER BY ord")).map((row) => row.id);
    const after = isDesk(role) ? allVaults : requested ?? (isDesk(person.role) ? [] : stored);
    const dropped = before.filter((id) => !after.includes(id));
    const gained = after.filter((id) => !before.includes(id));
    await tx.query("UPDATE people SET role = $2, aliases = $3, term_starts_on = $4, term_ends_on = $5, term_started = $6 WHERE id = $1", [
      person.id,
      role,
      aliases,
      termStarts,
      termEnds,
      role === "outside_bookkeeper" ? person.term_started || person.role !== "outside_bookkeeper" : false
    ]);
    const updated = await loadPerson(tx, person.id);
    if (!updated) throw new Error("person vanished");
    await record(tx, actorOf(actor), "person_change", personSubject(updated), {
      role,
      vault_ids: after,
      aliases,
      term_ends_on: termEnds
    });
    if (isDesk(role) && !isDesk(person.role)) {
      for (const vaultId of before) {
        const vault = await tx.one("SELECT * FROM vaults WHERE id = $1", [vaultId]);
        if (vault) await closeLines(tx, updated, vault.id, vault.name, actorOf(actor), at);
      }
      await tx.query("DELETE FROM person_vaults WHERE person_id = $1", [person.id]);
    }
    await dropScopes(tx, updated, dropped, actorOf(actor), at);
    if (!isDesk(role)) await gainScopes(tx, updated, gained, actorOf(actor), at);
    tx.after(() => syncAccess(person.id, "change"));
    return updated;
  });
  return personJson(db, changed, now());
}
async function endAccess(tx, person, actor, kind, at) {
  await tx.query("UPDATE people SET left_at = $2, seat = 'release_waiting', seat_since = $2 WHERE id = $1", [person.id, at]);
  await revokeSessions(tx, person.id, at);
  const lost = await scopeVaultIds(tx, person);
  const entry = await record(tx, actor, kind, personSubject(person), {}, at);
  const turnsDue = await dropScopes(tx, person, lost, actor, at);
  const details = actor === "system" ? { turns_due: turnsDue } : { confirmed_by: actor.name, turns_due: turnsDue };
  await tx.query("UPDATE audit SET details = $2 WHERE id = $1", [entry.id, JSON.stringify(details)]);
  const left = await loadPerson(tx, person.id);
  if (!left) throw new Error("person vanished");
  tx.after(() => syncAccess(person.id, kind === "person_leave" ? "change" : "boundary"));
  return { person: left, turnsDue };
}
async function confirmLeave(actor, personId, body) {
  const done = await write(async (tx) => {
    const person = await loadPerson(tx, personId);
    if (!person) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    if (person.id === actor.id) throw conflict("own_record", "You cannot change your own record.");
    if (person.left_at) throw conflict("already_left", `${person.full_name} has already left.`);
    const fields = new Fields();
    const v = checkBody(body, { confirm: { kind: "any" } }, fields);
    if (v.confirm !== true) fields.add("confirm", "Confirm the leave to continue.");
    fields.throwIfAny();
    try {
      await setEnabled(person.handle, false);
    } catch (error) {
      if (error instanceof KeycloakUnavailable) throw serviceDown();
      throw error;
    }
    return endAccess(tx, person, actorOf(actor), "person_leave", now());
  });
  const released = await driveSeat(done.person.id, Date.now() + WAIT_FOR_BILLING_MS, actorOf(actor));
  if (!released) await markWaiting(done.person, actorOf(actor));
  const fresh = await loadPerson(db, done.person.id) ?? done.person;
  return {
    person: await personJson(db, fresh, now()),
    turns_due: done.turnsDue,
    due_by: done.turnsDue[0]?.due_by ?? null,
    seat: fresh.seat
  };
}
var TRAVEL = { starts_at: { kind: "string" }, ends_at: { kind: "string" } };
var MAX_TRAVEL_DAYS = 60;
async function addTravel(actor, personId, body) {
  return write(async (tx) => {
    const person = await loadPerson(tx, personId);
    if (!person) throw notFound();
    if (actor.role !== "office_manager" && actor.id !== person.id) throw forbidden();
    if (person.left_at) throw conflict("already_left", `${person.full_name} has already left.`);
    const fields = new Fields();
    const v = checkBody(body, TRAVEL, fields);
    const starts = typeof v.starts_at === "string" ? v.starts_at : "";
    const ends = typeof v.ends_at === "string" ? v.ends_at : "";
    if (v.starts_at !== void 0 && !isLocalMinute(starts)) fields.add("starts_at", "Use a date and time like 2026-11-05T09:00.");
    if (v.ends_at !== void 0 && !isLocalMinute(ends)) fields.add("ends_at", "Use a date and time like 2026-11-05T09:00.");
    fields.throwIfAny();
    const at = now();
    const from = officeInstant(starts.slice(0, 10), starts.slice(11)).at;
    const to = officeInstant(ends.slice(0, 10), ends.slice(11)).at;
    if (from.getTime() >= to.getTime()) fields.add("ends_at", "The window must end after it starts.");
    else if (to.getTime() <= at.getTime()) fields.add("ends_at", "The window must end in the future.");
    else if (to.getTime() - from.getTime() > MAX_TRAVEL_DAYS * DAY_MS) fields.add("ends_at", "A window lasts at most 60 days.");
    fields.throwIfAny();
    const id = newId();
    await tx.query("INSERT INTO travel (id, person_id, starts_at, ends_at, created_at) VALUES ($1,$2,$3,$4,$5)", [id, person.id, from, to, at]);
    await record(tx, actorOf(actor), "travel_set", personSubject(person), { starts_at: starts, ends_at: ends });
    tx.after(() => syncAccess(person.id, "boundary"));
    return { id, starts_at: starts, ends_at: ends };
  });
}
async function cancelTravel(actor, personId, travelId) {
  await write(async (tx) => {
    const person = await loadPerson(tx, personId);
    if (!person) throw notFound();
    const window = await tx.one("SELECT id, starts_at, ends_at FROM travel WHERE id = $1 AND person_id = $2", [travelId, personId]);
    if (!window) throw notFound();
    if (actor.role !== "office_manager" && actor.id !== person.id) throw forbidden();
    if (window.starts_at.getTime() <= now().getTime()) throw conflict("travel_started", "That travel window has already started.");
    await tx.query("DELETE FROM travel WHERE id = $1", [travelId]);
    await record(tx, actorOf(actor), "travel_cancel", personSubject(person), {});
  });
}
async function startTerms() {
  const due = await db.query(
    "SELECT * FROM people WHERE role = 'outside_bookkeeper' AND left_at IS NULL AND NOT term_started AND term_starts_on IS NOT NULL ORDER BY ord"
  );
  for (const person of due) {
    const startsAt = officeMidnight(person.term_starts_on ?? "");
    if (startsAt.getTime() > now().getTime()) continue;
    try {
      await setEnabled(person.handle, true);
    } catch (error) {
      if (error instanceof KeycloakUnavailable) return;
      throw error;
    }
    await write(async (tx) => {
      const marked = await tx.one("UPDATE people SET term_started = true WHERE id = $1 AND NOT term_started RETURNING id", [person.id]);
      if (!marked) return;
      await record(tx, "system", "term_start", personSubject(person), { starts_on: person.term_starts_on, ends_on: person.term_ends_on }, startsAt);
    });
    await syncAccess(person.id, "boundary");
  }
}

// src/server/rules.ts
var MIN_LENGTH_FLOOR = 8;
var MIN_LENGTH_CEILING = 64;
function stampOf(effectiveOn) {
  return `00:00 ${offsetAt(officeMidnight(effectiveOn))}, ${officeDateText(effectiveOn)}`;
}
var takesForceText = (effectiveOn) => `Takes force ${stampOf(effectiveOn)}`;
var inForceText = (effectiveOn) => `In force from ${stampOf(effectiveOn)}`;
var draftText = (minLength, effectiveOn) => `Draft, waiting for the managing partner's signature: at least ${minLength} characters from ${stampOf(effectiveOn)}`;
function stubText(rule, today) {
  switch (rule.state) {
    case "drafted":
      return draftText(rule.min_length, rule.effective_on);
    case "scheduled":
      return takesForceText(rule.effective_on);
    case "in_force":
      return rule.took_force_on === today ? inForceText(rule.effective_on) : null;
    case "superseded":
      return null;
  }
}
function ruleView(rule, today) {
  return {
    id: rule.id,
    vault_id: rule.vault_id,
    min_length: rule.min_length,
    effective_on: rule.effective_on,
    state: rule.state,
    version: rule.version,
    drafted_by: rule.drafted_by,
    signed_by: rule.signed_by,
    stub_text: stubText(rule, today)
  };
}
var ruleBrief = (rule) => ({
  id: rule.id,
  min_length: rule.min_length,
  effective_on: rule.effective_on
});
function ruleInForce(rules, date) {
  let best = null;
  for (const rule of rules) {
    if (rule.state !== "in_force" && rule.state !== "scheduled") continue;
    if (rule.effective_on > date) continue;
    if (!best || rule.effective_on > best.effective_on) best = rule;
  }
  if (!best) throw new Error("a vault has no rule in force");
  return best;
}
function settleStates(rules, today) {
  const latest = ruleInForce(rules, today);
  return rules.map((rule) => {
    if (rule.state === "scheduled" && rule.effective_on <= today) {
      return { ...rule, state: "in_force", took_force_on: rule.effective_on };
    }
    if (rule.state === "in_force" && rule.id !== latest.id) return { ...rule, state: "superseded" };
    return rule;
  });
}
async function rulesByVault(db2) {
  const rows = await db2.query("SELECT * FROM rules ORDER BY effective_on, ord");
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const list = grouped.get(row.vault_id) ?? [];
    list.push(row);
    grouped.set(row.vault_id, list);
  }
  const today = officeDate(now());
  for (const [vaultId, list] of grouped) grouped.set(vaultId, settleStates(list, today));
  return grouped;
}
var LEEWAY_DAYS = 14;
function outOfPolicyState(secretLength2, importedOn, rule) {
  if (secretLength2 >= rule.min_length) return { outOfPolicy: false, since: null, leewayEndsAt: null };
  const since = importedOn && importedOn > rule.effective_on ? importedOn : rule.effective_on;
  return { outOfPolicy: true, since, leewayEndsAt: officeMidnight(addDays(since, LEEWAY_DAYS)) };
}
async function findRule(db2, id) {
  const row = await db2.one("SELECT vault_id FROM rules WHERE id = $1", [id]);
  return row ? ((await rulesByVault(db2)).get(row.vault_id) ?? []).find((rule) => rule.id === id) ?? null : null;
}

// src/server/credentials.ts
async function healthContext(db2) {
  const row = await db2.one(
    "SELECT exposed, domains FROM breach_checks WHERE ok ORDER BY at DESC LIMIT 1"
  );
  if (!row) return null;
  return { exposed: new Map(row.exposed.map((item) => [item.id, item.rev])), domains: new Set(row.domains) };
}
function healthOf(credential, vendor, outOfPolicy, context) {
  if (!context) return "not_checked";
  if (context.exposed.get(credential.id) === credential.secret_rev) return "exposed";
  if (context.domains.has(vendor.domain)) return "vendor_breached";
  return outOfPolicy ? "out_of_policy" : "sound";
}
function factsOf(credential, rules, at) {
  const rule = ruleInForce(rules, officeDate(at));
  return { rule, ...outOfPolicyState(credential.secret_length, credential.imported_on, rule) };
}
function nextTurnOf(turns, rotation, at) {
  const candidates = [];
  for (const turn of turns) {
    if (turn.kind === "scheduled" && turn.run_at && turn.run_date) {
      const moment = officeMoment(turn.run_at);
      candidates.push({ instant: turn.run_at, office_date: turn.run_date, office_time: moment.time, offset: moment.offset });
    } else {
      const midnight = officeMidnight(turn.due_by);
      candidates.push({ instant: midnight, office_date: turn.due_by, office_time: "23:59", offset: officeMoment(midnight).offset });
    }
  }
  if (rotation) {
    const [run] = runsAfter(rotation, at, 1);
    if (run) candidates.push({ instant: run.at, office_date: run.office_date, office_time: run.office_time, offset: run.offset });
  }
  candidates.sort((a, b) => a.instant.getTime() - b.instant.getTime());
  const first = candidates[0];
  return first ? { office_date: first.office_date, office_time: first.office_time, offset: first.offset } : null;
}
async function credentialViews(db2, rows, at) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [holders, turns, rotations, vendors, rules, context] = await Promise.all([
    db2.query(
      `SELECT h.credential_id, h.person_id, p.full_name, p.left_at FROM holders h JOIN people p ON p.id = h.person_id
       WHERE h.credential_id = ANY($1) ORDER BY h.ord`,
      [ids]
    ),
    db2.query("SELECT * FROM turns WHERE credential_id = ANY($1) AND state <> 'turned'", [ids]),
    db2.query("SELECT * FROM rotations WHERE credential_id = ANY($1)", [ids]),
    db2.query("SELECT * FROM vendors"),
    rulesByVault(db2),
    healthContext(db2)
  ]);
  const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  return rows.map((row) => {
    const vendor = vendorById.get(row.vendor_id);
    if (!vendor) throw new Error("a login has no vendor");
    const facts = factsOf(row, rules.get(row.vault_id) ?? [], at);
    return {
      id: row.id,
      vault_id: row.vault_id,
      vendor: { id: vendor.id, name: vendor.name, domain: vendor.domain, formerly: vendor.formerly },
      label: row.label,
      username: row.username,
      held_by: holders.filter((holder) => holder.credential_id === row.id).map((holder) => ({ person_id: holder.person_id, name: holder.full_name, left: holder.left_at !== null })),
      next_turn: nextTurnOf(
        turns.filter((turn) => turn.credential_id === row.id),
        rotations.find((rotation) => rotation.credential_id === row.id),
        at
      ),
      health: healthOf(row, vendor, facts.outOfPolicy, context),
      out_of_policy: facts.outOfPolicy,
      out_of_policy_since: facts.since,
      leeway_ends_at: facts.leewayEndsAt ? facts.leewayEndsAt.toISOString() : null,
      rule_id: facts.rule.id,
      last_turned_on: row.last_turned_on
    };
  });
}
function mayTurn(person) {
  return isDesk(person.role) ? person.role === "office_manager" : person.role === "staff_accountant";
}

// src/server/drawer.ts
var DOMAIN = /^(?=.{3,120}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
var DEFAULT_MIN_LENGTH = 12;
var vaultSubject = (vault) => ({ kind: "vault", id: vault.id, name: vault.name });
var vendorSubject = (vendor) => ({ kind: "vendor", id: vendor.id, name: vendor.name });
var loginSubject = (login) => ({ kind: "login", id: login.id, name: login.label });
async function vaultsJson(reader, vaultIds, viewer, at) {
  if (vaultIds.length === 0) return [];
  const [rows, rules, counts] = await Promise.all([
    reader.query("SELECT * FROM vaults WHERE id = ANY($1) ORDER BY ord", [vaultIds]),
    rulesByVault(reader),
    reader.query("SELECT vault_id, count(*)::int AS count FROM credentials GROUP BY vault_id")
  ]);
  const today = officeDate(at);
  return rows.map((vault) => {
    const vaultRules = rules.get(vault.id) ?? [];
    return {
      id: vault.id,
      name: vault.name,
      formerly: vault.formerly,
      off_when_travelling: vault.off_when_travelling,
      rule_in_force: ruleBrief(ruleInForce(vaultRules, today)),
      pending_rules: isDesk(viewer.role) ? vaultRules.filter((rule) => rule.state === "drafted" || rule.state === "scheduled").map((rule) => ruleView(rule, today)) : [],
      credential_count: counts.find((count) => count.vault_id === vault.id)?.count ?? 0
    };
  });
}
async function listVaults(viewer) {
  const at = now();
  return vaultsJson(db, await visibleVaultIds(db, viewer, at), viewer, at);
}
async function showVault(viewer, id) {
  const at = now();
  if (!await canSeeVault(db, viewer, id, at)) throw notFound();
  const [vault] = await vaultsJson(db, [id], viewer, at);
  const rows = await db.query("SELECT * FROM credentials WHERE vault_id = $1 ORDER BY ord", [id]);
  return { vault, credentials: await credentialViews(db, rows, at) };
}
var NEW_VAULT = { name: { kind: "string" }, off_when_travelling: { kind: "boolean" } };
var PATCH_VAULT = { name: { kind: "string", optional: true }, off_when_travelling: { kind: "boolean", optional: true } };
async function checkVaultName(tx, name, own, fields) {
  if (name.length < 2 || name.length > 40) fields.add("name", "Use 2 to 40 characters.");
  else if (await tx.one("SELECT 1 FROM vaults WHERE lower(name) = lower($1) AND id <> $2", [name, own ?? ""])) {
    fields.add("name", "A vault with that name is already filed.");
  }
}
async function createVault(actor, body) {
  return write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, NEW_VAULT, fields);
    const name = typeof v.name === "string" ? v.name.trim() : "";
    if (v.name !== void 0) await checkVaultName(tx, name, null, fields);
    fields.throwIfAny();
    const at = now();
    const id = newId();
    await tx.query("INSERT INTO vaults (id, name, off_when_travelling, created_at) VALUES ($1,$2,$3,$4)", [id, name, v.off_when_travelling, at]);
    await tx.query(
      `INSERT INTO rules (id, vault_id, min_length, effective_on, state, version, drafted_by, signed_by, created_at)
       VALUES ($1,$2,$3,$4,'in_force',1,'Lockset','Lockset',$5)`,
      [newId(), id, DEFAULT_MIN_LENGTH, officeDate(at), at]
    );
    const vault = await tx.one("SELECT * FROM vaults WHERE id = $1", [id]);
    if (!vault) throw new Error("vault was not stored");
    await record(tx, actorOf(actor), "vault_create", vaultSubject(vault), { off_when_travelling: vault.off_when_travelling });
    const [view2] = await vaultsJson(tx, [id], actor, at);
    return view2 ?? {};
  });
}
async function changeVault(actor, id, body) {
  return write(async (tx) => {
    const at = now();
    if (!await canSeeVault(tx, actor, id, at)) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    const vault = await tx.one("SELECT * FROM vaults WHERE id = $1", [id]);
    if (!vault) throw notFound();
    const fields = new Fields();
    const v = checkBody(body, PATCH_VAULT, fields);
    const name = typeof v.name === "string" ? v.name.trim() : null;
    if (name !== null) await checkVaultName(tx, name, vault.id, fields);
    fields.throwIfAny();
    if (name !== null && name !== vault.name) {
      await tx.query("UPDATE vaults SET name = $2, formerly = $3 WHERE id = $1", [vault.id, name, vault.name]);
      await tx.query("INSERT INTO vault_renames (id, vault_id, old_name, new_name, by_name, at) VALUES ($1,$2,$3,$4,$5,$6)", [
        newId(),
        vault.id,
        vault.name,
        name,
        actor.full_name,
        at
      ]);
      await record(tx, actorOf(actor), "vault_rename", vaultSubject(vault), { old: vault.name, new: name });
    }
    if (typeof v.off_when_travelling === "boolean" && v.off_when_travelling !== vault.off_when_travelling) {
      await tx.query("UPDATE vaults SET off_when_travelling = $2 WHERE id = $1", [vault.id, v.off_when_travelling]);
      const renamed = await tx.one("SELECT * FROM vaults WHERE id = $1", [vault.id]);
      await record(tx, actorOf(actor), "vault_change", renamed ? vaultSubject(renamed) : vaultSubject(vault), { off_when_travelling: v.off_when_travelling });
    }
    const [view2] = await vaultsJson(tx, [id], actor, at);
    return view2 ?? {};
  });
}
async function vendorJson(reader, rows) {
  const renames = await reader.query(
    "SELECT * FROM vendor_renames ORDER BY at"
  );
  return rows.map((vendor) => ({
    id: vendor.id,
    name: vendor.name,
    domain: vendor.domain,
    formerly: vendor.formerly,
    renames: renames.filter((rename) => rename.vendor_id === vendor.id).map((rename) => ({ old: rename.old_name, new: rename.new_name, by: rename.by_name, at: rename.at.toISOString() }))
  }));
}
async function listVendors() {
  return vendorJson(db, await db.query("SELECT * FROM vendors ORDER BY ord"));
}
var NEW_VENDOR = { name: { kind: "string" }, domain: { kind: "string" } };
var PATCH_VENDOR = { name: { kind: "string", optional: true }, domain: { kind: "string", optional: true } };
async function checkVendor(tx, v, own, fields) {
  if (typeof v.name === "string" && (v.name.trim().length < 2 || v.name.trim().length > 60)) fields.add("name", "Use 2 to 60 characters.");
  if (typeof v.domain === "string") {
    const domain = v.domain.trim().toLowerCase();
    if (!DOMAIN.test(domain)) fields.add("domain", "Give a host name like bank.example.");
    else if (await tx.one("SELECT 1 FROM vendors WHERE domain = $1 AND id <> $2", [domain, own ?? ""])) fields.add("domain", "That domain is already filed.");
  }
}
async function createVendor(actor, body) {
  return write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, NEW_VENDOR, fields);
    await checkVendor(tx, v, null, fields);
    fields.throwIfAny();
    const id = newId();
    const name = String(v.name).trim();
    await tx.query("INSERT INTO vendors (id, name, domain, created_at) VALUES ($1,$2,$3,$4)", [id, name, String(v.domain).trim().toLowerCase(), now()]);
    const vendor = await tx.one("SELECT * FROM vendors WHERE id = $1", [id]);
    if (!vendor) throw new Error("vendor was not stored");
    await record(tx, actorOf(actor), "vendor_create", vendorSubject(vendor), { domain: vendor.domain });
    return (await vendorJson(tx, [vendor]))[0] ?? {};
  });
}
async function changeVendor(actor, id, body) {
  return write(async (tx) => {
    const vendor = await tx.one("SELECT * FROM vendors WHERE id = $1", [id]);
    if (!vendor) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, PATCH_VENDOR, fields);
    await checkVendor(tx, v, vendor.id, fields);
    fields.throwIfAny();
    const name = typeof v.name === "string" ? v.name.trim() : null;
    if (name !== null && name !== vendor.name) {
      await tx.query("UPDATE vendors SET name = $2, formerly = $3 WHERE id = $1", [vendor.id, name, vendor.name]);
      await tx.query("INSERT INTO vendor_renames (id, vendor_id, old_name, new_name, by_name, at) VALUES ($1,$2,$3,$4,$5,$6)", [
        newId(),
        vendor.id,
        vendor.name,
        name,
        actor.full_name,
        now()
      ]);
      await record(tx, actorOf(actor), "vendor_rename", vendorSubject(vendor), { old: vendor.name, new: name });
    }
    const domain = typeof v.domain === "string" ? v.domain.trim().toLowerCase() : null;
    if (domain !== null && domain !== vendor.domain) {
      await tx.query("UPDATE vendors SET domain = $2 WHERE id = $1", [vendor.id, domain]);
      const renamed = await tx.one("SELECT * FROM vendors WHERE id = $1", [vendor.id]);
      await record(tx, actorOf(actor), "vendor_change", renamed ? vendorSubject(renamed) : vendorSubject(vendor), { domain });
    }
    const fresh = await tx.one("SELECT * FROM vendors WHERE id = $1", [vendor.id]);
    return (await vendorJson(tx, fresh ? [fresh] : [vendor]))[0] ?? {};
  });
}
function turnMessage(vault, rule) {
  return `${vault.name} needs at least ${rule.min_length} characters.`;
}
async function loginIfVisible(reader, viewer, id) {
  const login = await reader.one("SELECT * FROM credentials WHERE id = $1", [id]);
  if (!login || !await canSeeVault(reader, viewer, login.vault_id, now())) throw notFound();
  const vault = await reader.one("SELECT * FROM vaults WHERE id = $1", [login.vault_id]);
  if (!vault) throw notFound();
  return { login, vault };
}
async function showLogin(viewer, id) {
  const { login } = await loginIfVisible(db, viewer, id);
  return (await credentialViews(db, [login], now()))[0] ?? {};
}
var NEW_LOGIN = {
  vault_id: { kind: "string" },
  vendor_id: { kind: "string" },
  label: { kind: "string" },
  username: { kind: "string" },
  secret: { kind: "string" }
};
async function checkSecret(tx, vault, secret, fields, at) {
  if (secret.length < 1 || secretLength(secret) > 128) {
    fields.add("secret", "Use 1 to 128 characters.");
    return;
  }
  const rules = (await rulesByVault(tx)).get(vault.id) ?? [];
  const rule = ruleInForce(rules, officeDate(at));
  if (secretLength(secret) < rule.min_length) fields.add("secret", turnMessage(vault, rule));
}
async function createLogin(actor, body) {
  return write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, NEW_LOGIN, fields);
    const at = now();
    const vault = typeof v.vault_id === "string" ? await tx.one("SELECT * FROM vaults WHERE id = $1", [v.vault_id]) : null;
    if (v.vault_id !== void 0 && !vault) fields.add("vault_id", "Pick a vault that exists.");
    const vendor = typeof v.vendor_id === "string" ? await tx.one("SELECT * FROM vendors WHERE id = $1", [v.vendor_id]) : null;
    if (v.vendor_id !== void 0 && !vendor) fields.add("vendor_id", "Pick a vendor that exists.");
    const label = typeof v.label === "string" ? v.label.trim() : "";
    if (v.label !== void 0 && (label.length < 1 || label.length > 60)) fields.add("label", "Use 1 to 60 characters.");
    const username = typeof v.username === "string" ? v.username : "";
    if (v.username !== void 0 && (username.length < 1 || username.length > 120)) fields.add("username", "Use 1 to 120 characters.");
    const secret = typeof v.secret === "string" ? v.secret : "";
    if (vault && v.secret !== void 0) await checkSecret(tx, vault, secret, fields, at);
    if (vault && vendor && username.length > 0 && !fields.errors.username) {
      if (await tx.one("SELECT 1 FROM credentials WHERE vault_id = $1 AND vendor_id = $2 AND lower(username) = lower($3)", [vault.id, vendor.id, username])) {
        fields.add("username", "That login is already filed in this vault.");
      }
    }
    fields.throwIfAny();
    if (!vault || !vendor) throw new Error("login references were validated");
    const id = newId();
    await tx.query(
      `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_sealed, secret_length, last_turned_on, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, vault.id, vendor.id, label, username, seal(secret), secretLength(secret), officeDate(at), at]
    );
    await tx.query("INSERT INTO holders (credential_id, person_id) VALUES ($1,$2)", [id, actor.id]);
    const login = await tx.one("SELECT * FROM credentials WHERE id = $1", [id]);
    if (!login) throw new Error("login was not stored");
    await record(tx, actorOf(actor), "credential_create", loginSubject(login), { vault_id: vault.id });
    return (await credentialViews(tx, [login], at))[0] ?? {};
  });
}
async function saveSecret(tx, login, secret, actor, at) {
  await tx.query(
    "UPDATE credentials SET secret_sealed = $2, secret_length = $3, secret_rev = secret_rev + 1, last_turned_on = $4, imported_on = NULL WHERE id = $1",
    [login.id, seal(secret), secretLength(secret), officeDate(at)]
  );
  await record(tx, actor, "secret_edit", loginSubject(login), { vault_id: login.vault_id });
  await completeTurns(tx, login, actor);
  await tx.query("DELETE FROM holders WHERE credential_id = $1", [login.id]);
  await tx.query("INSERT INTO holders (credential_id, person_id) VALUES ($1,$2)", [login.id, actor.personId]);
}
async function turnLogin(actor, id, body) {
  return write(async (tx) => {
    const { login, vault } = await loginIfVisible(tx, actor, id);
    if (!mayTurn(actor)) throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, { secret: { kind: "string" } }, fields);
    const at = now();
    if (typeof v.secret === "string") await checkSecret(tx, vault, v.secret, fields, at);
    fields.throwIfAny();
    await saveSecret(tx, login, String(v.secret), { personId: actor.id, name: actor.full_name }, at);
    const fresh = await tx.one("SELECT * FROM credentials WHERE id = $1", [id]);
    return (await credentialViews(tx, fresh ? [fresh] : [login], at))[0] ?? {};
  });
}
async function revealLogin(actor, id, body, action) {
  return write(async (tx) => {
    const { login } = await loginIfVisible(tx, actor, id);
    const fields = new Fields();
    checkBody(body, {}, fields);
    fields.throwIfAny();
    const at = now();
    const facts = factsOf(login, (await rulesByVault(tx)).get(login.vault_id) ?? [], at);
    if (facts.outOfPolicy && facts.leewayEndsAt && at.getTime() >= facts.leewayEndsAt.getTime()) {
      throw new ApiError(423, "turn_required", "This login is past its 14-day leeway. Turn it before revealing.");
    }
    const entry = await record(tx, actorOf(actor), action, loginSubject(login), { rule_id: facts.rule.id }, at);
    return { credential_id: login.id, secret: open(login.secret_sealed), rule_id: facts.rule.id, audit_id: entry.id };
  });
}

// src/server/rules-api.ts
var RULE_CHANGED = "This rule changed since you opened it. Reload it and try again.";
var CANNOT_SIGN = "This rule can't be signed now.";
var RULER_NIGHTS = 60;
function requireDesk(viewer) {
  if (!isDesk(viewer.role)) throw forbidden();
}
var vaultSubject2 = (vault) => ({ kind: "vault", id: vault.id, name: vault.name });
async function ruleOr404(reader, id) {
  const rule = await findRule(reader, id);
  if (!rule) throw notFound();
  return rule;
}
async function listRules(viewer, vaultId) {
  requireDesk(viewer);
  if (vaultId !== null && !await db.one("SELECT 1 FROM vaults WHERE id = $1", [vaultId])) throw notFound();
  const grouped = await rulesByVault(db);
  const order = (await db.query("SELECT id FROM vaults ORDER BY ord")).map((vault) => vault.id);
  const rows = order.filter((id) => vaultId === null || id === vaultId).flatMap((id) => grouped.get(id) ?? []);
  const today = officeDate(now());
  return rows.map((rule) => ruleView(rule, today));
}
async function showRule(viewer, id) {
  const rule = await ruleOr404(db, id);
  requireDesk(viewer);
  return ruleView(rule, officeDate(now()));
}
function checkMinLength(value, fields) {
  if (typeof value === "number" && Number.isInteger(value) && (value < MIN_LENGTH_FLOOR || value > MIN_LENGTH_CEILING)) {
    fields.add("min_length", `Use a whole number from ${MIN_LENGTH_FLOOR} to ${MIN_LENGTH_CEILING}.`);
  }
}
function checkEffectiveOn(value, today, fields) {
  if (typeof value !== "string") return;
  if (!isRealDate(value)) fields.add("effective_on", "Use a date like 2027-01-01.");
  else if (value <= today) fields.add("effective_on", "Pick a date after today.");
}
var NEW_RULE = { vault_id: { kind: "string" }, min_length: { kind: "integer" }, effective_on: { kind: "string" } };
var EDIT_RULE = {
  version: { kind: "any", optional: true },
  min_length: { kind: "integer", optional: true },
  effective_on: { kind: "string", optional: true }
};
async function draftRule(actor, body) {
  return write(async (tx) => {
    requireDesk(actor);
    const fields = new Fields();
    const v = checkBody(body, NEW_RULE, fields);
    const at = now();
    const today = officeDate(at);
    const vault = typeof v.vault_id === "string" ? await tx.one("SELECT * FROM vaults WHERE id = $1", [v.vault_id]) : null;
    if (v.vault_id !== void 0 && !vault) fields.add("vault_id", "Pick a vault that exists.");
    checkMinLength(v.min_length, fields);
    checkEffectiveOn(v.effective_on, today, fields);
    fields.throwIfAny();
    if (!vault) throw new Error("vault was validated");
    const id = newId();
    await tx.query(
      `INSERT INTO rules (id, vault_id, min_length, effective_on, state, version, drafted_by, created_at)
       VALUES ($1,$2,$3,$4,'drafted',1,$5,$6)`,
      [id, vault.id, v.min_length, v.effective_on, actor.full_name, at]
    );
    await record(tx, actorOf(actor), "rule_draft", vaultSubject2(vault), { rule_id: id, min_length: v.min_length, effective_on: v.effective_on });
    return ruleView(await ruleOr404(tx, id), today);
  });
}
async function editRule(actor, id, body) {
  return write(async (tx) => {
    const rule = await ruleOr404(tx, id);
    requireDesk(actor);
    const raw = typeof body === "object" && body !== null ? body : {};
    if (rule.state === "in_force") throw conflict("rule_in_force", "An in-force rule cannot be edited. Draft a new rule instead.");
    if (rule.state === "superseded") throw conflict("rule_superseded", "A superseded rule cannot be edited.");
    const sent = raw.version;
    if (typeof sent === "number" && Number.isInteger(sent) && sent !== rule.version) throw conflict("rule_changed", RULE_CHANGED);
    const fields = new Fields();
    const v = checkBody(body, EDIT_RULE, fields);
    const at = now();
    const today = officeDate(at);
    if (typeof sent !== "number" || !Number.isInteger(sent)) fields.add("version", "Send the whole-number version you opened.");
    checkMinLength(v.min_length, fields);
    checkEffectiveOn(v.effective_on, today, fields);
    fields.throwIfAny();
    const vault = await tx.one("SELECT * FROM vaults WHERE id = $1", [rule.vault_id]);
    if (!vault) throw notFound();
    await tx.query(
      "UPDATE rules SET min_length = $2, effective_on = $3, state = 'drafted', signed_by = NULL, version = version + 1 WHERE id = $1",
      [rule.id, v.min_length ?? rule.min_length, v.effective_on ?? rule.effective_on]
    );
    await record(tx, actorOf(actor), "rule_edit", vaultSubject2(vault), { rule_id: rule.id, min_length: v.min_length ?? rule.min_length, effective_on: v.effective_on ?? rule.effective_on });
    return ruleView(await ruleOr404(tx, id), today);
  });
}
async function signRule(actor, id, body) {
  return write(async (tx) => {
    const rule = await ruleOr404(tx, id);
    if (actor.role !== "managing_partner") throw forbidden();
    const raw = typeof body === "object" && body !== null ? body : {};
    const at = now();
    const today = officeDate(at);
    if (rule.state === "in_force") throw conflict("rule_in_force", CANNOT_SIGN);
    if (rule.state === "superseded") throw conflict("rule_superseded", CANNOT_SIGN);
    if (rule.state === "scheduled") throw conflict("not_a_draft", CANNOT_SIGN);
    const sent = raw.version;
    if (typeof sent === "number" && Number.isInteger(sent) && sent !== rule.version) throw conflict("rule_changed", RULE_CHANGED);
    if (rule.effective_on <= today) throw conflict("effective_date_passed", CANNOT_SIGN);
    if (await tx.one("SELECT 1 FROM rules WHERE vault_id = $1 AND state = 'scheduled' AND effective_on = $2 AND id <> $3", [rule.vault_id, rule.effective_on, rule.id])) {
      throw conflict("rule_date_taken", CANNOT_SIGN);
    }
    const fields = new Fields();
    checkBody(body, { version: { kind: "any" } }, fields);
    if (typeof sent !== "number" || !Number.isInteger(sent)) fields.add("version", "Send the whole-number version you opened.");
    fields.throwIfAny();
    const vault = await tx.one("SELECT * FROM vaults WHERE id = $1", [rule.vault_id]);
    if (!vault) throw notFound();
    await tx.query("UPDATE rules SET state = 'scheduled', version = version + 1, signed_by = $2 WHERE id = $1", [rule.id, actor.full_name]);
    await record(tx, actorOf(actor), "rule_sign", vaultSubject2(vault), { rule_id: rule.id, min_length: rule.min_length, effective_on: rule.effective_on });
    return ruleView(await ruleOr404(tx, id), today);
  });
}
async function asOf(viewer, night) {
  requireDesk(viewer);
  const at = now();
  const today = officeDate(at);
  if (night === null || !isRealDate(night) || night <= today || night > addDays(today, RULER_NIGHTS)) {
    throw invalid({ night: "Pick one of the next 60 office midnights." });
  }
  const [vaults, rules, logins] = await Promise.all([
    db.query("SELECT * FROM vaults ORDER BY ord"),
    rulesByVault(db),
    db.query("SELECT vault_id, secret_length FROM credentials")
  ]);
  const perVault = vaults.map((vault) => {
    const vaultRules = rules.get(vault.id) ?? [];
    const inForce = ruleInForce(vaultRules, night);
    const stubs = vaultRules.filter((rule) => rule.state === "scheduled" || rule.state === "in_force" && rule.took_force_on === today).sort((a, b) => a.effective_on.localeCompare(b.effective_on)).map((rule) => ({
      rule_id: rule.id,
      version: rule.version,
      min_length: rule.min_length,
      text: night < rule.effective_on ? takesForceText(rule.effective_on) : inForceText(rule.effective_on),
      in_force: night >= rule.effective_on
    }));
    return {
      vault_id: vault.id,
      name: vault.name,
      rule_in_force: { id: inForce.id, min_length: inForce.min_length, effective_on: inForce.effective_on },
      cylinder: vaultRules.some((rule) => rule.state === "scheduled" && rule.effective_on > night) ? "pending" : "in_force",
      stubs,
      out_of_policy_count: logins.filter((login) => login.vault_id === vault.id && login.secret_length < inForce.min_length).length
    };
  });
  const start = officeMidnight(night);
  return {
    night,
    offset: offsetAt(start),
    starts_at: start.toISOString(),
    out_of_policy_count: perVault.reduce((sum, vault) => sum + vault.out_of_policy_count, 0),
    vaults: perVault
  };
}

// src/server/rotation-api.ts
var TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
var ROTATION = {
  credential_id: { kind: "string" },
  interval_days: { kind: "integer" },
  at_time: { kind: "string" },
  first_run_on: { kind: "string" }
};
var ROTATION_CHANGE = {
  credential_id: { kind: "string" },
  interval_days: { kind: "integer" },
  at_time: { kind: "string" },
  first_run_on: { kind: "string" }
};
function checkSchedule(v, fields, at) {
  if (typeof v.interval_days === "number" && (v.interval_days < 1 || v.interval_days > 365)) fields.add("interval_days", "Use a whole number from 1 to 365.");
  if (typeof v.at_time === "string" && !TIME.test(v.at_time)) fields.add("at_time", "Use a time like 09:00.");
  if (typeof v.first_run_on === "string") {
    if (!isRealDate(v.first_run_on) || v.first_run_on < officeDate(at)) fields.add("first_run_on", "Pick today or a later date.");
    else if (typeof v.at_time === "string" && TIME.test(v.at_time) && officeInstant(v.first_run_on, v.at_time).at.getTime() <= at.getTime()) {
      fields.add("first_run_on", "The first run must be in the future.");
    }
  }
}
function requireOffice(actor) {
  if (actor.role !== "office_manager") throw forbidden();
}
async function scheduleRotation(actor, body) {
  return write(async (tx) => {
    requireOffice(actor);
    const fields = new Fields();
    const v = checkBody(body, ROTATION, fields);
    const at = now();
    const login = typeof v.credential_id === "string" ? await tx.one("SELECT * FROM credentials WHERE id = $1", [v.credential_id]) : null;
    if (v.credential_id !== void 0 && !login) fields.add("credential_id", "Pick a login that exists.");
    if (login && await tx.one("SELECT 1 FROM rotations WHERE credential_id = $1", [login.id])) {
      throw conflict("rotation_exists", "This login already has a rotation.");
    }
    checkSchedule(v, fields, at);
    fields.throwIfAny();
    if (!login) throw new Error("login was validated");
    const id = newId();
    await tx.query(
      "INSERT INTO rotations (id, credential_id, interval_days, at_time, first_run_on, since, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6)",
      [id, login.id, v.interval_days, v.at_time, v.first_run_on, at]
    );
    await record(tx, actorOf(actor), "rotation_schedule", loginSubject(login), { rotation_id: id, interval_days: v.interval_days, at_time: v.at_time, first_run_on: v.first_run_on });
    const row = await tx.one("SELECT * FROM rotations WHERE id = $1", [id]);
    return row ? rotationJson(row, at) : {};
  });
}
async function changeRotation(actor, id, body) {
  return write(async (tx) => {
    const rotation = await tx.one("SELECT * FROM rotations WHERE id = $1", [id]);
    if (!rotation) throw notFound();
    requireOffice(actor);
    const login = await tx.one("SELECT * FROM credentials WHERE id = $1", [rotation.credential_id]);
    if (!login) throw notFound();
    const fields = new Fields();
    const v = checkBody(body, ROTATION_CHANGE, fields);
    const at = now();
    if (typeof v.credential_id === "string" && v.credential_id !== rotation.credential_id) fields.add("credential_id", "A rotation stays with its login.");
    checkSchedule(v, fields, at);
    fields.throwIfAny();
    await tx.query("UPDATE rotations SET interval_days = $2, at_time = $3, first_run_on = $4, since = $5 WHERE id = $1", [
      id,
      v.interval_days,
      v.at_time,
      v.first_run_on,
      at
    ]);
    await record(tx, actorOf(actor), "rotation_change", loginSubject(login), { rotation_id: id, interval_days: v.interval_days, at_time: v.at_time, first_run_on: v.first_run_on });
    const row = await tx.one("SELECT * FROM rotations WHERE id = $1", [id]);
    return row ? rotationJson(row, at) : {};
  });
}
async function showRotation(viewer, id) {
  const rotation = await db.one("SELECT * FROM rotations WHERE id = $1", [id]);
  if (!rotation) throw notFound();
  if (!isDesk(viewer.role)) throw forbidden();
  return rotationJson(rotation, now());
}
async function calendarTurns(reader, from, to) {
  return reader.query(
    `SELECT t.*, c.label, v.name AS vendor_name, v.formerly AS vendor_formerly
     FROM turns t JOIN credentials c ON c.id = t.credential_id JOIN vendors v ON v.id = c.vendor_id
     WHERE (t.kind = 'scheduled' AND t.run_date BETWEEN $1 AND $2) OR (t.kind = 'scope_loss' AND t.due_by BETWEEN $1 AND $2)
     ORDER BY t.ord`,
    [from, to]
  );
}
function monthBounds(month) {
  const from = `${month}-01`;
  const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10);
  return { from, to: addDays(next, -1) };
}
async function calendar(viewer, month) {
  if (!isDesk(viewer.role)) throw forbidden();
  const chosen = month ?? officeDate(now()).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(chosen)) throw invalid({ month: "Use a month like 2027-03." });
  const { from, to } = monthBounds(chosen);
  const [turns, rotations, logins] = await Promise.all([
    calendarTurns(db, from, to),
    db.query("SELECT * FROM rotations"),
    db.query(
      "SELECT c.*, v.name AS vendor_name, v.formerly AS vendor_formerly FROM credentials c JOIN vendors v ON v.id = c.vendor_id"
    )
  ]);
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({ office_date: date, offset: officeMoment(officeMidnight(date)).offset, entries: [] });
  }
  const dayOf = (date) => days.find((day) => day.office_date === date);
  for (const turn of turns) {
    const scheduled = turn.kind === "scheduled" && turn.run_at && turn.run_date;
    const moment = turn.run_at ? officeMoment(turn.run_at) : null;
    dayOf(scheduled ? turn.run_date ?? from : turn.due_by)?.entries.push({
      turn_id: turn.id,
      rotation_id: turn.rotation_id,
      credential_id: turn.credential_id,
      label: turn.label,
      vendor: { name: turn.vendor_name, formerly: turn.vendor_formerly },
      kind: turn.kind,
      office_time: scheduled && moment ? moment.time : null,
      offset: scheduled && moment ? moment.offset : officeMoment(officeMidnight(turn.due_by)).offset,
      at: scheduled && turn.run_at ? turn.run_at.toISOString() : null,
      shifted: scheduled ? turn.shifted : false,
      due_by: turn.due_by,
      state: turn.state
    });
  }
  for (const rotation of rotations) {
    const login = logins.find((candidate) => candidate.id === rotation.credential_id);
    if (!login) continue;
    for (const run of runsInDates(rotation, from, to)) {
      if (run.at.getTime() <= rotation.since.getTime()) continue;
      if (turns.some((turn) => turn.rotation_id === rotation.id && turn.run_at?.getTime() === run.at.getTime())) continue;
      dayOf(run.office_date)?.entries.push({
        turn_id: null,
        rotation_id: rotation.id,
        credential_id: rotation.credential_id,
        label: login.label,
        vendor: { name: login.vendor_name, formerly: login.vendor_formerly },
        kind: "scheduled",
        office_time: run.office_time,
        offset: run.offset,
        at: runJson(run).at,
        shifted: run.shifted,
        due_by: businessDaysAfter(run.office_date, 2),
        state: "scheduled"
      });
    }
  }
  for (const day of days) {
    day.entries.sort((a, b) => String(a.office_time ?? "99:99").localeCompare(String(b.office_time ?? "99:99")) || String(a.label).localeCompare(String(b.label)));
  }
  return { month: chosen, days };
}

// src/server/reviews.ts
var OVERDUE_BUSINESS_DAY = 11;
function requireDesk2(viewer) {
  if (!isDesk(viewer.role)) throw forbidden();
}
function summary(review, names) {
  return {
    id: review.id,
    quarter: quarterLabel(review),
    opened_on: review.opened_on,
    overdue_from: review.overdue_from,
    status: review.status,
    signed_off_by: review.signed_off_by ? names.get(review.signed_off_by) ?? null : null
  };
}
async function personNames(reader) {
  return new Map((await reader.query("SELECT id, full_name FROM people")).map((row) => [row.id, row.full_name]));
}
async function listReviews(viewer) {
  requireDesk2(viewer);
  const names = await personNames(db);
  return (await db.query("SELECT * FROM reviews ORDER BY ord DESC")).map((review) => summary(review, names));
}
async function lineViews(reader, lines, names) {
  const [vaults, vendors] = await Promise.all([
    reader.query("SELECT * FROM vaults"),
    reader.query(
      `SELECT c.vault_id, v.name, v.formerly FROM credentials c JOIN vendors v ON v.id = c.vendor_id ORDER BY c.ord`
    )
  ]);
  return lines.map((line) => {
    const vault = vaults.find((candidate) => candidate.id === line.vault_id);
    const seen = /* @__PURE__ */ new Set();
    const vendorList = [];
    for (const vendor of vendors.filter((candidate) => candidate.vault_id === line.vault_id)) {
      if (!seen.has(vendor.name)) {
        seen.add(vendor.name);
        vendorList.push({ name: vendor.name, formerly: vendor.formerly });
      }
    }
    return {
      id: line.id,
      person_id: line.person_id,
      person_name: names.get(line.person_id) ?? "",
      vault_id: line.vault_id,
      vault_name: vault?.name ?? "",
      vault_formerly: vault?.formerly ?? null,
      vendors: vendorList,
      decision: line.decision,
      decided_by: line.decided_by ? names.get(line.decided_by) ?? null : null,
      decided_via: line.decided_via
    };
  });
}
async function orderedLines(reader, reviewId) {
  return reader.query(
    `SELECT l.* FROM review_lines l JOIN people p ON p.id = l.person_id JOIN vaults v ON v.id = l.vault_id
     WHERE l.review_id = $1 ORDER BY p.ord, v.ord, l.id`,
    [reviewId]
  );
}
async function detail(reader, review) {
  const names = await personNames(reader);
  const lines = await orderedLines(reader, review.id);
  return {
    ...summary(review, names),
    decided: lines.filter((line) => line.decision !== "undecided").length,
    total: lines.length,
    lines: await lineViews(reader, lines, names)
  };
}
async function showReview(viewer, id) {
  requireDesk2(viewer);
  const review = await db.one("SELECT * FROM reviews WHERE id = $1", [id]);
  if (!review) throw notFound();
  return detail(db, review);
}
async function decideLine(actor, reviewId, lineId, body) {
  const decided = await write(async (tx) => {
    const review = await tx.one("SELECT * FROM reviews WHERE id = $1", [reviewId]);
    const line = review ? await tx.one("SELECT * FROM review_lines WHERE id = $1 AND review_id = $2", [lineId, reviewId]) : null;
    if (!review || !line) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    if (review.status === "signed_off") throw conflict("review_signed_off", "That review is signed off.");
    if (line.decision !== "undecided") throw conflict("line_decided", "This line is already decided.");
    const fields = new Fields();
    const v = checkBody(body, { decision: { kind: "string" } }, fields);
    if (v.decision !== "keep" && v.decision !== "remove") fields.add("decision", "Choose keep or remove.");
    fields.throwIfAny();
    const at = now();
    const person = await loadPerson(tx, line.person_id);
    const vault = await tx.one("SELECT * FROM vaults WHERE id = $1", [line.vault_id]);
    if (!person || !vault) throw notFound();
    const decision = v.decision === "keep" ? "kept" : "removed";
    await tx.query("UPDATE review_lines SET decision = $2, decided_by = $3, decided_via = 'review' WHERE id = $1", [line.id, decision, actor.id]);
    await record(
      tx,
      actorOf(actor),
      "review_decision",
      { kind: "person", id: person.id, name: person.full_name },
      { decided_via: "review", decision, vault: vault.name, review: quarterLabel(review) },
      at
    );
    if (decision === "removed") {
      await dropScopes(tx, person, [vault.id], actorOf(actor), at);
      tx.after(() => syncAccess(person.id, "change"));
    }
    announce(tx, [review.id]);
    return { ...line, decision, decided_by: actor.id, decided_via: "review" };
  });
  const [view2] = await lineViews(db, [decided], await personNames(db));
  return view2 ?? {};
}
async function signOff(actor, reviewId) {
  return write(async (tx) => {
    const review = await tx.one("SELECT * FROM reviews WHERE id = $1", [reviewId]);
    if (!review) throw notFound();
    if (actor.role !== "managing_partner") throw forbidden();
    if (review.status === "signed_off") throw conflict("review_signed_off", "That review is signed off.");
    const open2 = await tx.one("SELECT count(*)::int AS count FROM review_lines WHERE review_id = $1 AND decision = 'undecided'", [reviewId]);
    if ((open2?.count ?? 0) > 0) throw conflict("lines_undecided", "Decide every line before signing off.");
    await tx.query("UPDATE reviews SET status = 'signed_off', signed_off_by = $2 WHERE id = $1", [reviewId, actor.id]);
    await record(tx, actorOf(actor), "review_sign_off", reviewSubject(review), { review_id: review.id });
    announce(tx, [review.id]);
    const fresh = await tx.one("SELECT * FROM reviews WHERE id = $1", [reviewId]);
    return detail(tx, fresh ?? review);
  });
}
function openingDay(date) {
  const { year, quarter, start } = quarterOf(date);
  const opened = firstBusinessDayOnOrAfter(start);
  return { year, quarter, opened_on: opened, overdue_from: businessDaysAfter(opened, OVERDUE_BUSINESS_DAY - 1) };
}
async function openReviewFor(tx, date, audited) {
  const day = openingDay(date);
  if (date < day.opened_on) return null;
  if (await tx.one("SELECT 1 FROM reviews WHERE quarter_year = $1 AND quarter = $2", [day.year, day.quarter])) return null;
  const id = newId();
  const openedAt = officeMidnight(day.opened_on);
  await tx.query(
    "INSERT INTO reviews (id, quarter_year, quarter, opened_on, overdue_from, status, opened_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, day.year, day.quarter, day.opened_on, day.overdue_from, date >= day.overdue_from ? "overdue" : "open", openedAt]
  );
  const pairs = await tx.query(
    `SELECT pv.person_id, pv.vault_id FROM person_vaults pv JOIN people p ON p.id = pv.person_id JOIN vaults v ON v.id = pv.vault_id
     WHERE p.left_at IS NULL AND p.role IN ('staff_accountant','outside_bookkeeper') ORDER BY p.ord, v.ord`
  );
  for (const pair of pairs) {
    await tx.query("INSERT INTO review_lines (id, review_id, person_id, vault_id, decision) VALUES ($1,$2,$3,$4,'undecided')", [
      newId(),
      id,
      pair.person_id,
      pair.vault_id
    ]);
  }
  const review = await tx.one("SELECT * FROM reviews WHERE id = $1", [id]);
  if (!review) throw new Error("review was not stored");
  if (audited) {
    await record(tx, "system", "review_open", reviewSubject(review), { review_id: id }, openedAt);
    tx.after(() => emitToDesk("review-opened", { review_id: id }));
  }
  return review;
}
async function markOverdue(tx, at) {
  const today = officeDate(at);
  const late = await tx.query("SELECT * FROM reviews WHERE status = 'open' AND overdue_from <= $1 ORDER BY ord", [today]);
  for (const review of late) {
    await tx.query("UPDATE reviews SET status = 'overdue' WHERE id = $1", [review.id]);
    await record(tx, "system", "review_overdue", reviewSubject(review), { review_id: review.id }, officeMidnight(review.overdue_from));
    announce(tx, [review.id]);
  }
}

// src/server/imports.ts
var IMPORT_HEADER = ["Vault", "Login for", "Website", "Username", "Password", "Who knows it", "Last changed"];
var MAX_ROWS = 2e3;
var MESSAGES = {
  unreadable: "The file could not be read.",
  notUtf8: "Save the spreadsheet as UTF-8 CSV and try again.",
  header: "The first row must be the Lockset column headings.",
  tooMany: "Import at most 2,000 rows at a time.",
  filename: "Give the file a name of 1 to 120 characters."
};
function decodeBase64(text) {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  return Buffer.from(text, "base64");
}
function decodeUtf8(bytes) {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}
function parseRecords(text) {
  const records = [];
  let record2 = [];
  let field = "";
  let quoted = false;
  let atFieldStart = true;
  let index = 0;
  const endRecord = () => {
    record2.push(field);
    records.push(record2);
    record2 = [];
    field = "";
    atFieldStart = true;
  };
  while (index < text.length) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = false;
      } else field += char;
    } else if (char === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (char === ",") {
      record2.push(field);
      field = "";
      atFieldStart = true;
    } else if (char === "\n" || char === "\r" && text[index + 1] === "\n") {
      if (char === "\r") index++;
      endRecord();
    } else {
      field += char;
      atFieldStart = false;
    }
    index++;
  }
  if (record2.length > 0 || field.length > 0 || !atFieldStart) endRecord();
  return records;
}
function cutFilename(name) {
  const last = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return name.slice(last + 1).replace(/[\u0000-\u001f\u007f]/g, "");
}
function readFile(base64, fields) {
  const bytes = decodeBase64(base64);
  if (!bytes) {
    fields.add("file_base64", MESSAGES.unreadable);
    return null;
  }
  const text = decodeUtf8(bytes);
  if (text === null) {
    fields.add("file_base64", MESSAGES.notUtf8);
    return null;
  }
  const records = parseRecords(text.startsWith("\uFEFF") ? text.slice(1) : text);
  const header = records[0];
  if (!header || header.length !== IMPORT_HEADER.length || header.some((cell, i) => cell !== IMPORT_HEADER[i])) {
    fields.add("file_base64", MESSAGES.header);
    return null;
  }
  const rows = records.slice(1).filter((fieldsOfRow) => !fieldsOfRow.every((cell) => cell === "")).map((fieldsOfRow, i) => ({ row: i + 1, fields: fieldsOfRow }));
  if (rows.length > MAX_ROWS) {
    fields.add("file_base64", MESSAGES.tooMany);
    return null;
  }
  return { rows };
}
var HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
function hostOf(website) {
  const authority = website.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
  const host = authority.replace(/^.*@/, "").replace(/:\d+$/, "").toLowerCase().replace(/^www\./, "");
  return HOST.test(host) ? host : null;
}
function lastChanged(text) {
  if (text === "") return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) return "bad";
  const iso = `${match[3]}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
  return isRealDate(iso) ? iso : "bad";
}
function checkRow(fieldsOfRow, vaults) {
  const vault = vaults.find((candidate) => candidate.name.toLowerCase() === (fieldsOfRow[0] ?? "").toLowerCase());
  if (!vault) return { reason: "Unknown vault" };
  if (fieldsOfRow.length !== IMPORT_HEADER.length) return { reason: "Wrong number of columns" };
  const [, label = "", website = "", username = "", password = "", who = "", changed = ""] = fieldsOfRow;
  if (secretLength(password) < 1 || secretLength(password) > 128) return { reason: "Password must be 1 to 128 characters" };
  if (label.trim().length < 1 || label.trim().length > 60) return { reason: "Login for must be 1 to 60 characters" };
  const host = hostOf(website);
  if (!host) return { reason: "Website must be a domain or URL" };
  if (username.length < 1 || username.length > 120) return { reason: "Username must be 1 to 120 characters" };
  const date = lastChanged(changed.trim());
  if (date === "bad") return { reason: "Last changed must be M/D/YYYY" };
  return { reason: null, vault, label: label.trim(), host, username, password, changed: date, who };
}
var squash = (text) => text.trim().replace(/\s+/g, " ").toLowerCase();
var words = (text) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
var candidateOf = (person) => ({ person_id: person.id, full_name: person.full_name });
function matchName(text, people) {
  const key = squash(text);
  const byEmail = people.find((person) => squash(person.email) === key);
  if (byEmail) return { text, match: "email", person_id: byEmail.id, held: null, candidates: [] };
  const byName = people.find((person) => squash(person.full_name) === key);
  if (byName) return { text, match: "full_name", person_id: byName.id, held: null, candidates: [] };
  const byAlias = people.filter((person) => person.aliases.some((alias) => squash(alias) === key));
  const [only] = byAlias;
  if (byAlias.length === 1 && only) return { text, match: "alias", person_id: only.id, held: null, candidates: [] };
  if (byAlias.length > 1) return { text, match: null, person_id: null, held: "ambiguous", candidates: byAlias.map(candidateOf) };
  const shared = new Set(words(text));
  return {
    text,
    match: null,
    person_id: null,
    held: "no_match",
    candidates: people.filter((person) => words(person.full_name).some((word) => shared.has(word))).map(candidateOf)
  };
}
var namesIn = (who) => who.split(/[;/]/).map((name) => name.trim()).filter((name) => name.length > 0);
async function existingLogin(tx, vaultId, host, username) {
  return tx.one(
    `SELECT c.* FROM credentials c JOIN vendors v ON v.id = c.vendor_id
     WHERE c.vault_id = $1 AND v.domain = $2 AND lower(c.username) = lower($3)`,
    [vaultId, host, username]
  );
}
async function fileLogin(tx, parsed, holders, actor, at) {
  let vendor = await tx.one("SELECT * FROM vendors WHERE domain = $1", [parsed.host]);
  if (!vendor) {
    const vendorId = newId();
    await tx.query("INSERT INTO vendors (id, name, domain, created_at) VALUES ($1,$2,$2,$3)", [vendorId, parsed.host, at]);
    vendor = await tx.one("SELECT * FROM vendors WHERE domain = $1", [parsed.host]);
    if (!vendor) throw new Error("vendor was not stored");
    await record(tx, actor, "vendor_create", { kind: "vendor", id: vendor.id, name: vendor.name }, { domain: vendor.domain });
  }
  const id = newId();
  await tx.query(
    `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_sealed, secret_length, last_turned_on, imported_on, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      parsed.vault_id,
      vendor.id,
      parsed.label,
      parsed.username,
      parsed.sealed_password,
      secretLength(open(parsed.sealed_password)),
      parsed.changed ?? officeDate(at),
      officeDate(at),
      at
    ]
  );
  for (const personId of holders) {
    await tx.query("INSERT INTO holders (credential_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, personId]);
  }
  await record(tx, actor, "credential_create", { kind: "login", id, name: parsed.label }, { vault_id: parsed.vault_id });
  return id;
}
var rowJson = (row) => ({
  row: row.row,
  outcome: row.outcome,
  credential_id: row.credential_id,
  reason: row.reason,
  names: row.names
});
var SPEC = { filename: { kind: "string" }, file_base64: { kind: "string" } };
async function importFile(actor, body) {
  return write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, SPEC, fields);
    const filename = typeof v.filename === "string" ? cutFilename(v.filename) : "";
    if (v.filename !== void 0 && (filename.length < 1 || filename.length > 120)) fields.add("filename", MESSAGES.filename);
    const file = typeof v.file_base64 === "string" ? readFile(v.file_base64, fields) : null;
    fields.throwIfAny();
    if (!file) throw invalid({ file_base64: MESSAGES.unreadable });
    const at = now();
    const importId = newId();
    await tx.query("INSERT INTO imports (id, filename, by_person, created_at) VALUES ($1,$2,$3,$4)", [importId, filename, actor.id, at]);
    const [vaults, people] = await Promise.all([
      tx.query("SELECT * FROM vaults"),
      tx.query("SELECT * FROM people ORDER BY ord")
    ]);
    const subject = { kind: "import", id: importId, name: filename };
    const stored = [];
    for (const item of file.rows) {
      const checked = checkRow(item.fields, vaults);
      let row = { import_id: importId, row: item.row, outcome: "rejected", reason: checked.reason, parsed: null, names: [], credential_id: null };
      if (!checked.reason && checked.vault && checked.host && checked.username !== void 0 && checked.label && checked.password !== void 0) {
        const parsed = {
          vault_id: checked.vault.id,
          label: checked.label,
          host: checked.host,
          username: checked.username,
          sealed_password: seal(checked.password),
          changed: checked.changed ?? null
        };
        const found = await existingLogin(tx, parsed.vault_id, parsed.host, parsed.username);
        if (found) row = { ...row, outcome: "matched", reason: null, credential_id: found.id };
        else {
          const names = namesIn(checked.who ?? "").map((name) => matchName(name, people));
          if (names.some((name) => name.held)) row = { ...row, outcome: "held", reason: null, parsed, names };
          else {
            const holders = [...new Set(names.flatMap((name) => name.person_id ? [name.person_id] : []))];
            const credentialId = await fileLogin(tx, parsed, holders, actorOf(actor), at);
            row = { ...row, outcome: "created", reason: null, names, credential_id: credentialId };
          }
        }
      }
      await tx.query(
        "INSERT INTO import_rows (import_id, row, outcome, reason, parsed, names, credential_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [importId, row.row, row.outcome, row.reason, JSON.stringify(row.parsed), JSON.stringify(row.names), row.credential_id]
      );
      await record(tx, actorOf(actor), "import_row", subject, { row: row.row, outcome: row.outcome, reason: row.reason }, at);
      stored.push(row);
    }
    return importJson(importId, filename, stored);
  });
}
function importJson(id, filename, rows) {
  const count = (outcome) => rows.filter((row) => row.outcome === outcome).length;
  return {
    id,
    filename,
    counts: { created: count("created"), matched: count("matched"), held: count("held"), rejected: count("rejected") },
    rows: rows.map(rowJson)
  };
}
async function storedRows(reader, importId) {
  return reader.query("SELECT * FROM import_rows WHERE import_id = $1 ORDER BY row", [importId]);
}
async function showImport(viewer, id) {
  const found = await db.one("SELECT id, filename FROM imports WHERE id = $1", [id]);
  if (!found) throw notFound();
  if (viewer.role !== "office_manager") throw forbidden();
  return importJson(found.id, found.filename, await storedRows(db, id));
}
async function chooseHeld(actor, id, rowNumber, body) {
  return write(async (tx) => {
    const found = await tx.one("SELECT id, filename FROM imports WHERE id = $1", [id]);
    const number = /^\d+$/.test(rowNumber) ? Number(rowNumber) : -1;
    const row = found ? await tx.one("SELECT * FROM import_rows WHERE import_id = $1 AND row = $2", [id, number]) : null;
    if (!found || !row) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    if (row.outcome !== "held" || !row.parsed) throw conflict("row_not_held", "That row is not waiting for a choice.");
    const fields = new Fields();
    const v = checkBody(body, { text: { kind: "string" }, person_id: { kind: "string_or_null" } }, fields);
    const target = row.names.find((name) => name.held && name.text === v.text);
    if (v.text !== void 0 && !target) fields.add("text", "That name is not waiting for a choice in this row.");
    if (target && typeof v.person_id === "string" && !target.candidates.some((candidate) => candidate.person_id === v.person_id)) {
      fields.add("person_id", "Pick one of the candidates.");
    }
    fields.throwIfAny();
    if (!target) throw new Error("name was validated");
    const at = now();
    const chosen = typeof v.person_id === "string" ? v.person_id : null;
    const names = row.names.map(
      (name) => name === target || name.held && name.text === target.text ? { ...name, match: chosen ? "chosen" : "not_on_record", person_id: chosen, held: null } : name
    );
    await record(tx, actorOf(actor), "import_choice", { kind: "import", id, name: found.filename }, { row: row.row, outcome: "held" }, at);
    let next = { ...row, names };
    if (!names.some((name) => name.held)) {
      const parsed = row.parsed;
      const already = await existingLogin(tx, parsed.vault_id, parsed.host, parsed.username);
      if (already) next = { ...next, outcome: "matched", credential_id: already.id };
      else {
        const holders = [...new Set(names.flatMap((name) => name.person_id ? [name.person_id] : []))];
        next = { ...next, outcome: "created", credential_id: await fileLogin(tx, parsed, holders, actorOf(actor), at) };
      }
    }
    await tx.query("UPDATE import_rows SET outcome = $3, names = $4, credential_id = $5 WHERE import_id = $1 AND row = $2", [
      id,
      row.row,
      next.outcome,
      JSON.stringify(next.names),
      next.credential_id
    ]);
    return rowJson(next);
  });
}

// src/server/breach.ts
var FeedUnreachable = class extends Error {
};
var TIMEOUT_MS2 = 5e3;
async function get(path, headers = {}) {
  try {
    const response = await fetch(`${config.wiremockUrl}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS2) });
    if (response.status !== 200) throw new FeedUnreachable("The feed answered with an error");
    return await response.json();
  } catch (error) {
    throw error instanceof FeedUnreachable ? error : new FeedUnreachable("The feed cannot be reached");
  }
}
async function rangeSuffixes(prefix) {
  const body = await get(`/v1/range/${prefix}`, { "Add-Padding": "true" });
  const found = /* @__PURE__ */ new Set();
  for (const row of body.results ?? []) {
    if (typeof row.suffix === "string" && typeof row.count === "number" && row.count > 0) found.add(row.suffix.toUpperCase());
  }
  return found;
}
async function breachedDomains() {
  const body = await get("/v1/breached-domains");
  return (body.domains ?? []).flatMap((row) => typeof row.domain === "string" ? [row.domain.toLowerCase()] : []);
}

// src/server/health.ts
var PARALLEL = 8;
var running = null;
async function rangeFor(prefixes) {
  const found = /* @__PURE__ */ new Map();
  const queue = [...prefixes];
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      for (let prefix = queue.shift(); prefix !== void 0; prefix = queue.shift()) {
        found.set(prefix, await rangeSuffixes(prefix));
      }
    })
  );
  return found;
}
async function performCheck() {
  const at = now();
  try {
    const logins = await db.query(
      "SELECT c.*, v.domain FROM credentials c JOIN vendors v ON v.id = c.vendor_id ORDER BY c.ord"
    );
    const hashes = new Map(logins.map((login) => [login.id, sha1Upper(open(login.secret_sealed))]));
    const ranges = await rangeFor([...new Set([...hashes.values()].map((hash) => hash.slice(0, 5)))]);
    const domains = await breachedDomains();
    const exposed = logins.filter((login) => {
      const hash = hashes.get(login.id) ?? "";
      return ranges.get(hash.slice(0, 5))?.has(hash.slice(5)) ?? false;
    });
    const rules = await rulesByVault(db);
    const context = { exposed: new Map(exposed.map((login) => [login.id, login.secret_rev])), domains: new Set(domains) };
    const healths = {};
    let outOfPolicy = 0;
    let exposedCount = 0;
    let breachedCount = 0;
    for (const login of logins) {
      const facts = factsOf(login, rules.get(login.vault_id) ?? [], at);
      if (facts.outOfPolicy) outOfPolicy++;
      const health = healthOf(login, { domain: login.domain }, facts.outOfPolicy, context);
      if (health === "exposed") exposedCount++;
      if (health === "vendor_breached") breachedCount++;
      if (health !== "sound") healths[login.id] = health;
    }
    const turns = await db.query("SELECT state FROM turns WHERE state <> 'turned'");
    const counts = {
      exposed: exposedCount,
      vendor_breached: breachedCount,
      out_of_policy: outOfPolicy,
      turns_due: turns.filter((turn) => turn.state === "due").length,
      turns_overdue: turns.filter((turn) => turn.state === "overdue").length
    };
    await store(at, true, counts, healths, exposed.map((login) => ({ id: login.id, rev: login.secret_rev })), domains);
    return true;
  } catch (error) {
    if (!(error instanceof FeedUnreachable)) throw error;
    await store(at, false, null, null, null, null);
    return false;
  }
}
async function store(at, ok2, counts, healths, exposed, domains) {
  await write(async (tx) => {
    const day = officeDate(at);
    await tx.query(
      "INSERT INTO breach_checks (id, at, ok, office_day, counts, healths, exposed, domains) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [newId(), at, ok2, day, JSON.stringify(counts), JSON.stringify(healths), JSON.stringify(exposed), JSON.stringify(domains)]
    );
    if (ok2) await tx.query("DELETE FROM breach_checks WHERE ok AND office_day = $1 AND at < $2", [day, at]);
    else await tx.query("DELETE FROM breach_checks WHERE NOT ok AND at < $1", [at]);
    tx.after(() => emitToDesk("check-finished", { feed: ok2 ? "ok" : "unreachable" }));
  });
}
function runCheck() {
  if (!running) {
    running = performCheck().finally(() => {
      running = null;
    });
  }
  return running;
}
async function report(day) {
  const at = now();
  const today = officeDate(at);
  const chosen = day ?? today;
  if (!isRealDate(chosen) || chosen > today) throw invalid({ day: "Pick today or an earlier office day." });
  const snapshot = await db.one(
    chosen === today ? "SELECT * FROM breach_checks WHERE ok ORDER BY at DESC LIMIT 1" : "SELECT * FROM breach_checks WHERE ok AND office_day = $1 ORDER BY at DESC LIMIT 1",
    chosen === today ? [] : [chosen]
  );
  const latest = await db.one("SELECT * FROM breach_checks ORDER BY at DESC LIMIT 1");
  const healths = snapshot?.healths ?? {};
  const ids = Object.keys(healths);
  const rows = ids.length > 0 ? await db.query("SELECT c.* FROM credentials c JOIN vaults v ON v.id = c.vault_id WHERE c.id = ANY($1) ORDER BY v.ord, c.ord", [ids]) : [];
  const views = await credentialViews(db, rows, at);
  return {
    office_date: chosen,
    feed: latest && !latest.ok ? "unreachable" : "ok",
    last_good_check_at: snapshot ? snapshot.at.toISOString() : null,
    counts: snapshot?.counts ?? { exposed: 0, vendor_breached: 0, out_of_policy: 0, turns_due: 0, turns_overdue: 0 },
    credentials: views.map((view2) => ({ ...view2, health: healths[String(view2.id)] ?? view2.health }))
  };
}
async function manualCheck() {
  if (await runCheck()) return report(null);
  const good = await db.one("SELECT * FROM breach_checks WHERE ok ORDER BY at DESC LIMIT 1");
  throw new ApiError(
    503,
    "breach_feed_unreachable",
    good ? `The breach feed can't be reached. Showing the last good check from ${officeStamp(good.at)}.` : "The breach feed can't be reached. No check has succeeded yet."
  );
}

// src/server/billing.ts
function dollars(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
async function billingJson() {
  const waiting = (await db.query(
    "SELECT id, full_name, seat, seat_since FROM people WHERE seat IN ('waiting_on_billing','release_waiting') ORDER BY seat_since"
  )).map((person) => ({
    person_id: person.id,
    name: person.full_name,
    change: person.seat === "waiting_on_billing" ? "add" : "release",
    since: person.seat_since.toISOString()
  }));
  try {
    const seats = await activeSeats();
    const dates = seats.flatMap((seat) => seat.chargedThroughDate ? [seat.chargedThroughDate.slice(0, 10)] : []);
    const earliest = dates.length > 0 ? [...dates].sort()[0] : void 0;
    const due = earliest ? dates.filter((date) => date === earliest).length : 0;
    return {
      reachable: true,
      seats: seats.length,
      seat_price: dollars(SEAT_PRICE_CENTS),
      currency: "USD",
      next_invoice: earliest ? { date: earliest, amount: dollars(due * SEAT_PRICE_CENTS) } : null,
      licence_term_ends_on: earliest ?? null,
      waiting
    };
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    return {
      reachable: false,
      seats: null,
      seat_price: dollars(SEAT_PRICE_CENTS),
      currency: "USD",
      next_invoice: null,
      licence_term_ends_on: null,
      waiting
    };
  }
}

// src/server/static.ts
import { readFile as readFile2 } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
var root = join(dirname(fileURLToPath(import.meta.url)), "public");
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};
var SECURITY = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin"
};
async function send2(res, status, file, cache) {
  const body = await readFile2(file);
  res.writeHead(status, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": cache,
    ...SECURITY
  });
  res.end(body);
}
async function serveClient(pathname, res) {
  const extension = extname(pathname);
  if (extension) {
    const file = normalize(join(root, pathname));
    if (!file.startsWith(root + sep)) return missing(res);
    try {
      await send2(res, 200, file, extension === ".woff2" ? "public, max-age=86400" : "no-cache");
    } catch {
      missing(res);
    }
    return;
  }
  try {
    await send2(res, isKnownPath(pathname.replace(/\/+$/, "") || "/") ? 200 : 404, join(root, "index.html"), "no-cache");
  } catch {
    missing(res);
  }
}
function missing(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

// src/server/routes.ts
var routes = [];
function define(method, path, handler, idempotent = false) {
  const keys = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, key) => (keys.push(key), "([^/]+)"))}$`);
  routes.push({ method, pattern, keys, handler, idempotent });
}
var deskOnly = (ctx) => {
  if (!isDesk(ctx.person.role)) throw forbidden();
};
define(
  "GET",
  "/api/me",
  async (ctx) => ok({ person: await personJson(db, ctx.person, now()), session_ends_at: utcIso(ctx.session.endsAt) })
);
define("GET", "/api/people", async (ctx) => (deskOnly(ctx), ok({ people: await listPeople() })));
define("POST", "/api/people", async (ctx) => ok(await addJoiner(ctx.person, ctx.json()), 201), true);
define("PATCH", "/api/people/:id", async (ctx) => ok(await changeAccess(ctx.person, ctx.params.id ?? "", ctx.json())));
define("POST", "/api/people/:id/leave", async (ctx) => ok(await confirmLeave(ctx.person, ctx.params.id ?? "", ctx.json())), true);
define("POST", "/api/people/:id/travel", async (ctx) => ok(await addTravel(ctx.person, ctx.params.id ?? "", ctx.json()), 201));
define("DELETE", "/api/people/:id/travel/:travel", async (ctx) => {
  await cancelTravel(ctx.person, ctx.params.id ?? "", ctx.params.travel ?? "");
  return { status: 204 };
});
define("GET", "/api/vaults", async (ctx) => ok({ vaults: await listVaults(ctx.person) }));
define("GET", "/api/vaults/:id", async (ctx) => ok(await showVault(ctx.person, ctx.params.id ?? "")));
define("POST", "/api/vaults", async (ctx) => ok(await createVault(ctx.person, ctx.json()), 201));
define("PATCH", "/api/vaults/:id", async (ctx) => ok(await changeVault(ctx.person, ctx.params.id ?? "", ctx.json())));
define("GET", "/api/vendors", async () => ok({ vendors: await listVendors() }));
define("POST", "/api/vendors", async (ctx) => ok(await createVendor(ctx.person, ctx.json()), 201));
define("PATCH", "/api/vendors/:id", async (ctx) => ok(await changeVendor(ctx.person, ctx.params.id ?? "", ctx.json())));
define("POST", "/api/credentials", async (ctx) => ok(await createLogin(ctx.person, ctx.json()), 201));
define("GET", "/api/credentials/:id", async (ctx) => ok(await showLogin(ctx.person, ctx.params.id ?? "")));
define("PUT", "/api/credentials/:id/secret", async (ctx) => ok(await turnLogin(ctx.person, ctx.params.id ?? "", ctx.json())));
define("POST", "/api/credentials/:id/reveal", async (ctx) => ok(await revealLogin(ctx.person, ctx.params.id ?? "", ctx.json(), "reveal")));
define("POST", "/api/credentials/:id/copy", async (ctx) => ok(await revealLogin(ctx.person, ctx.params.id ?? "", ctx.json(), "copy")));
define("GET", "/api/rules", async (ctx) => ok({ rules: await listRules(ctx.person, ctx.query.get("vault_id")) }));
define("GET", "/api/rules/:id", async (ctx) => ok(await showRule(ctx.person, ctx.params.id ?? "")));
define("POST", "/api/rules", async (ctx) => ok(await draftRule(ctx.person, ctx.json()), 201));
define("PATCH", "/api/rules/:id", async (ctx) => ok(await editRule(ctx.person, ctx.params.id ?? "", ctx.json())));
define("POST", "/api/rules/:id/sign", async (ctx) => ok(await signRule(ctx.person, ctx.params.id ?? "", ctx.json())));
define("GET", "/api/as-of", async (ctx) => ok(await asOf(ctx.person, ctx.query.get("night"))));
define("GET", "/api/rotations/calendar", async (ctx) => ok(await calendar(ctx.person, ctx.query.get("month"))));
define("POST", "/api/rotations", async (ctx) => ok(await scheduleRotation(ctx.person, ctx.json()), 201));
define("PATCH", "/api/rotations/:id", async (ctx) => ok(await changeRotation(ctx.person, ctx.params.id ?? "", ctx.json())));
define("GET", "/api/rotations/:id", async (ctx) => ok(await showRotation(ctx.person, ctx.params.id ?? "")));
define("GET", "/api/reviews", async (ctx) => ok({ reviews: await listReviews(ctx.person) }));
define("GET", "/api/reviews/:id", async (ctx) => ok(await showReview(ctx.person, ctx.params.id ?? "")));
define(
  "POST",
  "/api/reviews/:id/lines/:line",
  async (ctx) => ok(await decideLine(ctx.person, ctx.params.id ?? "", ctx.params.line ?? "", ctx.json()))
);
define("POST", "/api/reviews/:id/sign-off", async (ctx) => ok(await signOff(ctx.person, ctx.params.id ?? "")));
define("GET", "/api/billing", async (ctx) => (deskOnly(ctx), ok(await billingJson())));
define("GET", "/api/health-report", async (ctx) => (deskOnly(ctx), ok(await report(ctx.query.get("day")))));
define("POST", "/api/health-report/checks", async (ctx) => {
  if (ctx.person.role !== "office_manager") throw forbidden();
  return ok(await manualCheck());
});
define("POST", "/api/imports", async (ctx) => ok(await importFile(ctx.person, ctx.json()), 201), true);
define("GET", "/api/imports/:id", async (ctx) => ok(await showImport(ctx.person, ctx.params.id ?? "")));
define(
  "POST",
  "/api/imports/:id/rows/:row/choice",
  async (ctx) => ok(await chooseHeld(ctx.person, ctx.params.id ?? "", ctx.params.row ?? "", ctx.json()))
);
var AUDIT_LIMIT = { default: 50, max: 100 };
define("GET", "/api/audit", async (ctx) => {
  deskOnly(ctx);
  const fields = new Fields();
  const day = ctx.query.get("day") ?? officeDate(now());
  if (!isRealDate(day)) fields.add("day", "Use a date like 2026-11-05.");
  const order = ctx.query.get("order") ?? "oldest";
  if (order !== "oldest" && order !== "newest") fields.add("order", "Use oldest or newest.");
  const rawLimit = ctx.query.get("limit");
  const limit = rawLimit === null ? AUDIT_LIMIT.default : /^\d+$/.test(rawLimit) ? Number(rawLimit) : 0;
  if (limit < 1 || limit > AUDIT_LIMIT.max) fields.add("limit", "Use a whole number from 1 to 100.");
  fields.throwIfAny();
  return ok(await page(db, day, order, limit, ctx.query.get("after")));
});
define("GET", "/api/events", async (ctx) => {
  ctx.res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  ctx.res.write("retry: 3000\n\n");
  const seen = (ctx.query.get("seen") ?? "").split(",").filter((id) => id.length > 0);
  attach({
    res: ctx.res,
    personId: ctx.person.id,
    role: ctx.person.role,
    tokenHash: ctx.session.tokenHash,
    endsAt: ctx.session.endsAt,
    known: new Set(seen.length > 0 ? seen : await visibleVaultIds(db, ctx.person, now()))
  });
  if (seen.length > 0) await syncAccess(ctx.person.id, "change");
  return STREAMING;
});
var WRITES = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
function methodNotAllowed() {
  return new ApiError(405, "method_not_allowed", "The audit trail cannot be changed.");
}
async function dispatchApi(req, res, target) {
  const method = req.method ?? "GET";
  const path = target.pathname.replace(/\/+$/, "");
  const write2 = WRITES.has(method);
  if (write2 && !sameOrigin(req)) throw new ApiError(403, "cross_origin", "That request came from another origin.");
  const raw = write2 ? await readBody(req, path === "/api/imports" ? IMPORT_BODY_LIMIT : BODY_LIMIT) : Buffer.alloc(0);
  if (write2 && raw.length > 0 && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
    throw new ApiError(415, "unsupported_media_type", "Send application/json.");
  }
  if (method === "GET" && path === "/api/health") {
    if (!await ping()) throw new ApiError(503, "unavailable", "The database is not ready.");
    return sendJson(res, 200, { status: "ok" });
  }
  if (method === "GET" && path === "/api/clock") {
    const at = now();
    const moment = officeMoment(at);
    return sendJson(res, 200, { now: utcIso(at), office_date: moment.date, office_time: moment.time, offset: moment.offset, time_zone: OFFICE_TIME_ZONE });
  }
  if (path === "/api/audit" || path.startsWith("/api/audit/")) {
    if (write2) throw methodNotAllowed();
  }
  if (method === "POST" && path === "/api/sessions") {
    let body = {};
    try {
      body = parseJson(raw);
    } catch {
      body = {};
    }
    await refuseWhileLocked(typeof body === "object" && body !== null ? body.username : void 0);
    const reply2 = await signIn(parseJson(raw));
    return sendJson(res, reply2.status, reply2.body, reply2.headers);
  }
  if (method === "DELETE" && path === "/api/sessions") {
    const reply2 = await signOut(req);
    res.writeHead(reply2.status, reply2.headers ?? {});
    return void res.end();
  }
  const found = routes.find((candidate) => candidate.method === method && candidate.pattern.test(path));
  if (!found) {
    if (routes.some((candidate) => candidate.pattern.test(path))) throw new ApiError(405, "method_not_allowed", "That method is not allowed here.");
    throw notFound();
  }
  if (!write2) await afterWrites();
  const session = await authenticate(req);
  const match = found.pattern.exec(path) ?? [];
  const params = {};
  found.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match[index + 1] ?? "");
  });
  const ctx = { req, res, params, query: target.query, raw, person: session.person, session, json: () => parseJson(raw) };
  const run = () => found.handler(ctx);
  const reply = found.idempotent ? await withIdempotency(req, session.person.id, raw, run) : await run();
  if (reply === STREAMING) return;
  if (reply.status === 204) {
    res.writeHead(204, reply.headers ?? {});
    return void res.end();
  }
  sendJson(res, reply.status, reply.body, reply.headers);
}
function targetOf(raw) {
  const mark = raw.indexOf("?");
  return { pathname: mark < 0 ? raw : raw.slice(0, mark), query: new URLSearchParams(mark < 0 ? "" : raw.slice(mark + 1)) };
}
async function handle(req, res) {
  const target = targetOf(req.url ?? "/");
  try {
    if (target.pathname === "/api" || target.pathname.startsWith("/api/")) return await dispatchApi(req, res, target);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      return void res.end("Method not allowed");
    }
    return await serveClient(decodeURIComponent(target.pathname), res);
  } catch (error) {
    if (res.headersSent) return void res.end();
    if (error instanceof ApiError) return sendError(res, error);
    console.error("request failed:", error instanceof Error ? error.message : "unknown error");
    sendError(res, new ApiError(500, "internal", "Something went wrong on the server."));
  }
}

// src/server/seed.ts
var SEED_PASSWORD = "KeysKept-2026";
var EMAIL_DOMAIN = "brannocklyle.example";
var SEED_PEOPLE = [
  { name: "Marta Lindqvist", handle: "marta", email: "marta.lindqvist", role: "office_manager", aliases: ["Marta"], vaults: "all" },
  { name: "Graham Brannock", handle: "graham", email: "graham.brannock", role: "managing_partner", aliases: ["Graham"], vaults: "all" },
  { name: "Deandra Okafor", handle: "deandra", email: "deandra.okafor", role: "staff_accountant", aliases: ["Dee", "Deandra"], vaults: ["Payroll", "Banking", "Vendor portals"] },
  { name: "Desmond Okafor", handle: "desmond", email: "desmond.okafor", role: "staff_accountant", aliases: ["Des", "Desmond"], vaults: ["Vendor portals", "Office"] },
  { name: "Theo Vasquez", handle: "theo", email: "theo.vasquez", role: "staff_accountant", aliases: ["Theo"], vaults: ["Banking", "Hosting", "Office"] },
  { name: "Sam Whitfield", handle: "sam", email: "sam.whitfield", role: "staff_accountant", aliases: ["Sam"], vaults: ["Hosting", "Vendor portals"] },
  { name: "Samantha Lyle", handle: "samantha", email: "samantha.lyle", role: "staff_accountant", aliases: ["Sam", "Samantha"], vaults: ["Payroll", "Vendor portals"] },
  { name: "Priya Raman", handle: "priya", email: "priya.raman", role: "outside_bookkeeper", aliases: ["Priya"], vaults: ["Payroll", "Banking"] }
];
var VAULTS = [
  { name: "Payroll", off: true, min: 14 },
  { name: "Banking", off: true, min: 12 },
  { name: "Hosting", off: false, min: 12 },
  { name: "Vendor portals", off: false, min: 12 },
  { name: "Office", off: false, min: 10 }
];
var VENDORS = [
  ["Paystride Payroll", "paystride.example"],
  ["First Prairie Bank", "firstprairie.example"],
  ["Missouri Valley Credit Union", "mvcu.example"],
  ["E-File Gateway", "efilegateway.example"],
  ["Gridhaven Hosting", "gridhaven.example"],
  ["Tallyroom Practice Suite", "tallyroom.example"],
  ["Inkwell Printers", "inkwell.example"]
];
var LOGINS = [
  { vault: "Payroll", vendor: "Paystride Payroll", label: "Payroll admin", username: "payroll@brannocklyle.example", secret: "Tw9-harbor-quill-58", holders: ["deandra", "priya"] },
  { vault: "Banking", vendor: "First Prairie Bank", label: "Business portal", username: "bl-treasury", secret: "Prairie-wind-7731", holders: ["deandra", "theo"] },
  { vault: "Banking", vendor: "Missouri Valley Credit Union", label: "Operating account", username: "brannocklyle", secret: "Ledger-oak-221", holders: ["theo"] },
  { vault: "Banking", vendor: "First Prairie Bank", label: "Payroll funding", username: "bl-payroll-fund", secret: "Cornfield-tax-90", holders: ["deandra", "priya"] },
  { vault: "Banking", vendor: "Missouri Valley Credit Union", label: "Card admin", username: "bl-cards", secret: "Silo-river-3344", holders: ["theo"] },
  { vault: "Hosting", vendor: "Gridhaven Hosting", label: "Website host", username: "webmaster@brannocklyle.example", secret: "Gh-stack-plum-8812", holders: ["sam"] },
  { vault: "Vendor portals", vendor: "E-File Gateway", label: "EFIN account", username: "bl-efile", secret: "Efile-maple-2020!", holders: ["deandra", "samantha"] },
  { vault: "Vendor portals", vendor: "Tallyroom Practice Suite", label: "Practice admin", username: "marta.lindqvist", secret: "Tally-room-door-41", holders: ["marta"] },
  { vault: "Office", vendor: "Inkwell Printers", label: "Front desk printer admin", username: "admin", secret: "password", holders: ["desmond", "theo"] }
];
function nthSunday(year, month, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + (7 - first) % 7 + (nth - 1) * 7;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function firstSundayAfter(today, month, nth) {
  const year = Number(today.slice(0, 4));
  for (const candidate of [nthSunday(year, month, nth), nthSunday(year + 1, month, nth)]) {
    if (candidate > today) return candidate;
  }
  throw new Error("no Sunday found");
}
async function seedRecords(tx) {
  const at = now();
  const today = officeDate(at);
  const ids = /* @__PURE__ */ new Map();
  const idOf = (key) => {
    const found = ids.get(key);
    if (!found) throw new Error(`unknown seed key ${key}`);
    return found;
  };
  for (const vault of VAULTS) {
    const id = newId();
    ids.set(`vault:${vault.name}`, id);
    await tx.query("INSERT INTO vaults (id, name, off_when_travelling, created_at) VALUES ($1,$2,$3,$4)", [id, vault.name, vault.off, at]);
  }
  const rule = async (vault, min, effective, state) => {
    await tx.query(
      `INSERT INTO rules (id, vault_id, min_length, effective_on, state, version, drafted_by, signed_by, created_at)
       VALUES ($1,$2,$3,$4,$5,2,'Marta Lindqvist','Graham Brannock',$6)`,
      [newId(), idOf(`vault:${vault}`), min, effective, state, at]
    );
  };
  for (const vault of VAULTS) {
    if (vault.name === "Office") {
      await rule("Office", 8, "2025-01-01", "superseded");
      await rule("Office", 10, addDays(today, -20), "in_force");
    } else await rule(vault.name, vault.min, "2025-01-01", "in_force");
  }
  await rule("Banking", 16, `${Number(today.slice(0, 4)) + 1}-01-01`, "scheduled");
  for (const [name, domain] of VENDORS) {
    const id = newId();
    ids.set(`vendor:${name}`, id);
    await tx.query("INSERT INTO vendors (id, name, domain, created_at) VALUES ($1,$2,$3,$4)", [id, name, domain, at]);
  }
  for (const person of SEED_PEOPLE) {
    const id = newId();
    ids.set(`person:${person.handle}`, id);
    const bookkeeper = person.role === "outside_bookkeeper";
    await tx.query(
      `INSERT INTO people (id, full_name, email, handle, role, aliases, first_sign_in_at, term_starts_on, term_ends_on, term_started,
         seat, seat_since, seat_silent, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'waiting_on_billing',$7,true,$7)`,
      [
        id,
        person.name,
        `${person.email}@${EMAIL_DOMAIN}`,
        person.handle,
        person.role,
        person.aliases,
        at,
        bookkeeper ? addDays(today, -30) : null,
        bookkeeper ? addDays(today, 60) : null,
        bookkeeper
      ]
    );
    if (person.vaults !== "all") {
      for (const vault of person.vaults) {
        await tx.query("INSERT INTO person_vaults (person_id, vault_id) VALUES ($1,$2)", [id, idOf(`vault:${vault}`)]);
      }
    }
  }
  for (const login of LOGINS) {
    const id = newId();
    ids.set(`login:${login.label}`, id);
    await tx.query(
      `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_sealed, secret_length, last_turned_on, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, idOf(`vault:${login.vault}`), idOf(`vendor:${login.vendor}`), login.label, login.username, seal(login.secret), secretLength(login.secret), addDays(today, -40), at]
    );
    for (const holder of login.holders) {
      await tx.query("INSERT INTO holders (credential_id, person_id) VALUES ($1,$2)", [id, idOf(`person:${holder}`)]);
    }
  }
  const turn = async (label, dueBy, state) => {
    await tx.query("INSERT INTO turns (id, credential_id, kind, due_by, state, created_at) VALUES ($1,$2,'scope_loss',$3,$4,$5)", [
      newId(),
      idOf(`login:${label}`),
      dueBy,
      state,
      at
    ]);
  };
  await turn("Operating account", addDays(today, -7), "overdue");
  await turn("Card admin", today, "due");
  const rotation = async (label, days, time, first) => {
    await tx.query(
      "INSERT INTO rotations (id, credential_id, interval_days, at_time, first_run_on, since, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6)",
      [newId(), idOf(`login:${label}`), days, time, first, at]
    );
  };
  await rotation("Business portal", 90, "02:30", firstSundayAfter(today, 3, 2));
  await rotation("Website host", 28, "01:30", firstSundayAfter(today, 11, 1));
  await rotation("Payroll admin", 30, "09:00", addDays(today, 3));
  await openReviewFor(tx, today, false);
  await tx.query("INSERT INTO meta (key, value) VALUES ('seeded', 'yes')");
}
async function seedIfEmpty() {
  await write(async (tx) => {
    if (await tx.one("SELECT 1 FROM meta WHERE key = 'seeded'")) return;
    await seedRecords(tx);
  });
}
var usersDone = false;
async function ensureSeedUsers() {
  if (usersDone) return;
  try {
    for (const person of SEED_PEOPLE) {
      if (await findUserId(person.handle)) continue;
      const row = await db.one("SELECT term_starts_on FROM people WHERE handle = $1", [person.handle]);
      if (!row) continue;
      const startsLater = row.term_starts_on !== null && row.term_starts_on > officeDate(now());
      await createUser({ handle: person.handle, fullName: person.name, password: SEED_PASSWORD, enabled: !startsLater });
    }
    usersDone = true;
  } catch (error) {
    if (!(error instanceof KeycloakUnavailable)) throw error;
  }
}

// src/server/scheduler.ts
async function takeForce(tx, at) {
  const today = officeDate(at);
  const due = await tx.query(
    `SELECT r.* FROM rules r JOIN vaults v ON v.id = r.vault_id WHERE r.state = 'scheduled' AND r.effective_on <= $1
     ORDER BY v.ord, r.effective_on, r.ord`,
    [today]
  );
  const announced = /* @__PURE__ */ new Map();
  for (const rule of due) {
    const vault = await tx.one("SELECT * FROM vaults WHERE id = $1", [rule.vault_id]);
    if (!vault) continue;
    const previous = await tx.one("SELECT * FROM rules WHERE vault_id = $1 AND state = 'in_force'", [vault.id]);
    const when = officeMidnight(rule.effective_on);
    await tx.query("UPDATE rules SET state = 'in_force', took_force_on = effective_on WHERE id = $1", [rule.id]);
    await record(tx, "system", "rule_in_force", { kind: "vault", id: vault.id, name: vault.name }, { rule_id: rule.id, min_length: rule.min_length }, when);
    if (previous) {
      await tx.query("UPDATE rules SET state = 'superseded' WHERE id = $1", [previous.id]);
      await record(tx, "system", "rule_superseded", { kind: "vault", id: vault.id, name: vault.name }, { rule_id: previous.id }, when);
    }
    announced.set(vault.id, { vault, rule });
  }
  const ordered = [...announced.values()];
  if (ordered.length > 0) {
    tx.after(() => ordered.forEach(({ vault, rule }) => emitToDesk("rule-in-force", { vault_id: vault.id, rule_id: rule.id, name: vault.name })));
  }
}
async function endTerms(at) {
  const people = await db.query(
    "SELECT * FROM people WHERE role = 'outside_bookkeeper' AND left_at IS NULL AND term_ends_on IS NOT NULL ORDER BY ord"
  );
  for (const person of people) {
    const endsAt = termEndInstant(person.term_ends_on ?? "");
    if (endsAt.getTime() > at.getTime()) continue;
    try {
      await setEnabled(person.handle, false);
    } catch (error) {
      if (error instanceof KeycloakUnavailable) return;
      throw error;
    }
    const finished = await write(async (tx) => {
      const fresh = await tx.one("SELECT * FROM people WHERE id = $1", [person.id]);
      if (!fresh || fresh.left_at) return null;
      return endAccess(tx, fresh, "system", "term_end", endsAt);
    });
    if (finished && !await driveSeat(person.id, Date.now() + 3e3, "system")) await markWaiting(finished.person, "system");
  }
}
async function endSessions(at) {
  for (const connection of [...connected()]) {
    if (connection.endsAt.getTime() <= at.getTime()) {
      send(connection, "session-ended", {});
      connection.res.end();
    }
  }
}
async function timedWorkPending(at) {
  const today = officeDate(at);
  const counts = await db.one(
    `SELECT (SELECT count(*) FROM rules WHERE state = 'scheduled' AND effective_on <= $1)::int AS rules,
            (SELECT count(*) FROM turns WHERE state = 'due' AND due_by < $1)::int AS late,
            (SELECT count(*) FROM reviews WHERE status = 'open' AND overdue_from <= $1)::int AS overdue_reviews`,
    [today]
  );
  if (!counts || counts.rules > 0 || counts.late > 0 || counts.overdue_reviews > 0) return true;
  const opening = openingDay(today);
  if (today >= opening.opened_on && !await db.one("SELECT 1 FROM reviews WHERE quarter_year = $1 AND quarter = $2", [opening.year, opening.quarter])) return true;
  const rotations = await db.query(
    "SELECT r.*, (SELECT count(*) FROM turns t WHERE t.rotation_id = r.id AND t.run_at > r.since)::int AS filed FROM rotations r"
  );
  return rotations.some((rotation) => runsBetween(rotation, rotation.since, at).length > rotation.filed);
}
var busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const at = now();
    if (await timedWorkPending(at)) {
      await write(async (tx) => {
        await takeForce(tx, at);
        await dueRuns(tx, at);
        await overdueTurns(tx, at);
        await openReviewFor(tx, officeDate(at), true);
        await markOverdue(tx, at);
      });
    }
    await startTerms();
    await endTerms(at);
    await sweepBoundaries();
    await endSessions(at);
  } catch (error) {
    console.error("scheduler tick failed:", error instanceof Error ? error.message : "unknown error");
  } finally {
    busy = false;
  }
}
function startScheduler() {
  setInterval(() => void tick(), 1e3);
  setInterval(() => keepAlive(), 15e3);
  let retrying = false;
  setInterval(() => {
    if (retrying) return;
    retrying = true;
    retryWaiting().catch(() => void 0).finally(() => {
      retrying = false;
    });
  }, 2e3);
  const check = () => void runCheck().catch(() => void 0);
  check();
  setInterval(check, config.breachCheckSeconds * 1e3);
}

// src/server/main.ts
process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason instanceof Error ? reason.message : "unknown");
});
await migrate();
await seedIfEmpty();
var server = createServer((req, res) => void handle(req, res));
server.keepAliveTimeout = 65e3;
server.listen(config.port, "0.0.0.0", () => {
  console.log(`lockset listening on ${config.port}`);
});
var SEED_RETRY_MS = 3e4;
var wake = () => {
  void ensureSeedUsers();
  void ensureReady().catch(() => void 0);
};
wake();
setInterval(wake, SEED_RETRY_MS);
startScheduler();
