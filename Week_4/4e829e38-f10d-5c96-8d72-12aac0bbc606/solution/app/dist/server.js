// src/server/server.ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/server/auth.ts
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

// src/server/clock.ts
async function now(db) {
  const { rows } = await db.query("SELECT now FROM clock WHERE id = 1");
  return rows.length > 0 ? rows[0].now : /* @__PURE__ */ new Date();
}
function realNow() {
  return /* @__PURE__ */ new Date();
}
var plus = (instant, ms) => new Date(instant.getTime() + ms);
var minuteStart = (instant) => new Date(Math.floor(instant.getTime() / 6e4) * 6e4);
var isoInstant = (value) => value.toISOString();
function parseInstant(text) {
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
var dateOf = (instant) => instant.toISOString().slice(0, 10);

// src/server/auth.ts
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
function newVerificationCode() {
  return String(randomInt(0, 1e6)).padStart(6, "0");
}
async function startSession(db, personId) {
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions (token, person_id, created_at) VALUES ($1, $2, $3)", [token, personId, await now(db)]);
  return token;
}
async function personForToken(db, token) {
  if (!token) return null;
  const { rows } = await db.query("SELECT person_id FROM sessions WHERE token = $1", [token]);
  return rows.length ? rows[0].person_id : null;
}
var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// src/server/config.ts
var env = process.env;
function number(name, fallback) {
  const raw = env[name];
  return raw === void 0 || raw.trim() === "" ? fallback : Number(raw);
}
var config = {
  port: number("APP_PUBLIC_PORT", 4173),
  databaseUrl: env.DATABASE_URL ?? "",
  s3: {
    endpoint: (env.S3_ENDPOINT ?? "").replace(/\/+$/, ""),
    region: env.S3_REGION ?? "us-east-1",
    bucket: env.S3_BUCKET ?? "",
    pathStyle: (env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? ""
  },
  smtp: { host: env.SMTP_HOST ?? "localhost", port: number("SMTP_PORT", 1025) },
  mailFrom: env.MAIL_FROM ?? "Everyweek <hello@everyweek.example>",
  grading: env.EVERYWEEK_GRADING === "1",
  limits: {
    ruleMaxDepth: number("EVERYWEEK_RULE_MAX_DEPTH", 3),
    ruleRunsPerMinute: number("EVERYWEEK_RULE_RUNS_PER_MINUTE", 60),
    formulaMaxChars: number("EVERYWEEK_FORMULA_MAX_CHARS", 200),
    formulaMaxSteps: number("EVERYWEEK_FORMULA_MAX_STEPS", 500),
    digestWindowMin: number("EVERYWEEK_DIGEST_WINDOW_MIN", 60),
    holdTimeoutMs: number("EVERYWEEK_HOLD_TIMEOUT_MS", 3e4),
    uploadMaxBytes: number("EVERYWEEK_UPLOAD_MAX_BYTES", 1048576),
    pageSize: number("EVERYWEEK_PAGE_SIZE", 50),
    moveMs: number("EVERYWEEK_MOVE_MS", 320),
    progressMs: number("EVERYWEEK_PROGRESS_MS", 400),
    toastMs: number("EVERYWEEK_TOAST_MS", 4e3)
  },
  jsonBodyBytes: 262144,
  seedBodyBytes: 5e6,
  dueTickMs: 15e3
};

// src/server/db.ts
import pg from "pg";
pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(1700, (value) => Number(value));
pg.types.setTypeParser(20, (value) => Number(value));
var pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", () => void 0);
async function transaction(work) {
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
async function claim(db, key) {
  const { rowCount } = await db.query("INSERT INTO claims (key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
  return rowCount === 1;
}
async function lockProject(tx, projectId) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`project:${projectId}`]);
}
var SCHEMA = `
CREATE TABLE IF NOT EXISTS clock (id int PRIMARY KEY CHECK (id = 1), now timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false, code text, created_at timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY, person_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY, name text NOT NULL, join_code text NOT NULL UNIQUE, request_counter int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS memberships (
  team_id text NOT NULL REFERENCES teams ON DELETE CASCADE, person_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  role text NOT NULL, PRIMARY KEY (team_id, person_id));
CREATE TABLE IF NOT EXISTS capacities (
  team_id text NOT NULL REFERENCES teams ON DELETE CASCADE, person_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  weekday text NOT NULL, hours numeric NOT NULL, PRIMARY KEY (team_id, person_id, weekday));
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams ON DELETE CASCADE, name text NOT NULL,
  trace jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS sections (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, name text NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS fields (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, name text NOT NULL, type text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]', formula text, position int NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  name text NOT NULL, description text NOT NULL DEFAULT '',
  section_id text NOT NULL REFERENCES sections ON DELETE CASCADE, position int NOT NULL,
  parent_id text REFERENCES tasks ON DELETE CASCADE, assignee_id text REFERENCES people ON DELETE SET NULL,
  start_date date, due_date date, effort numeric, completed boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1, recurrence text, values jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL, seq bigserial);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_parent ON tasks (parent_id);
CREATE TABLE IF NOT EXISTS dependencies (
  from_task text NOT NULL REFERENCES tasks ON DELETE CASCADE, to_task text NOT NULL REFERENCES tasks ON DELETE CASCADE,
  PRIMARY KEY (from_task, to_task));
CREATE TABLE IF NOT EXISTS holds (
  task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, field text NOT NULL,
  holder_id text NOT NULL REFERENCES people ON DELETE CASCADE, expires_at timestamptz NOT NULL,
  PRIMARY KEY (task_id, field));
CREATE TABLE IF NOT EXISTS presence (
  connection text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people ON DELETE CASCADE, joined_at timestamptz NOT NULL, left_at timestamptz);
CREATE TABLE IF NOT EXISTS history (
  id bigserial PRIMARY KEY, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, text text NOT NULL,
  created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS rules (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, name text NOT NULL,
  position int NOT NULL, trigger jsonb NOT NULL, condition jsonb, action jsonb NOT NULL,
  created_at timestamptz NOT NULL, seq bigserial);
CREATE TABLE IF NOT EXISTS rule_runs (
  id bigserial PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, depth int NOT NULL, summary text NOT NULL,
  detail text NOT NULL, counted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS rule_runs_project ON rule_runs (project_id, created_at);
CREATE TABLE IF NOT EXISTS claims (key text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS goals (
  id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams ON DELETE CASCADE, name text NOT NULL,
  parent_id text REFERENCES goals ON DELETE CASCADE, weight int NOT NULL DEFAULT 1,
  manual_value numeric NOT NULL DEFAULT 0, owner_id text REFERENCES people ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS goal_projects (
  goal_id text NOT NULL REFERENCES goals ON DELETE CASCADE, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  weight int NOT NULL DEFAULT 1, PRIMARY KEY (goal_id, project_id));
CREATE TABLE IF NOT EXISTS forms (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, slug text NOT NULL UNIQUE,
  section_id text NOT NULL REFERENCES sections ON DELETE CASCADE, title text NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE,
  approver_id text NOT NULL REFERENCES people ON DELETE CASCADE, requester_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  status text NOT NULL, comment text, created_at timestamptz NOT NULL, seq bigserial);
CREATE TABLE IF NOT EXISTS inbox (
  id text PRIMARY KEY, person_id text NOT NULL REFERENCES people ON DELETE CASCADE, text text NOT NULL,
  task_id text REFERENCES tasks ON DELETE CASCADE, kind text NOT NULL DEFAULT 'note', approval_id text,
  read boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL,
  seq bigserial);
CREATE INDEX IF NOT EXISTS inbox_person ON inbox (person_id);
CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, name text NOT NULL,
  size int NOT NULL, content_type text NOT NULL, object_key text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, format text NOT NULL,
  status text NOT NULL, object_key text, error text, requested_by text, created_at timestamptz NOT NULL);
`;
async function applySchema() {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(7001)");
    await tx.query(SCHEMA);
  });
}

// src/server/events.ts
import pg2 from "pg";
var CHANNEL = "everyweek_events";
var subscribers = /* @__PURE__ */ new Set();
async function publish(db, event) {
  await db.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(event)]);
}
function subscribe(res, personId, teams) {
  const subscriber = { res, personId, teams: new Set(teams) };
  subscribers.add(subscriber);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write("retry: 1000\n\n: connected\n\n");
  return () => subscribers.delete(subscriber);
}
function heartbeat() {
  for (const s of subscribers) s.res.write(": keep-alive\n\n");
}
function deliver(event) {
  const frame = `data: ${JSON.stringify(event)}

`;
  for (const s of subscribers) {
    if (event.person ? event.person === s.personId : event.team ? s.teams.has(event.team) : false) s.res.write(frame);
  }
}
async function listen() {
  const client = new pg2.Client({ connectionString: config.databaseUrl });
  const retry = () => setTimeout(() => void listen(), 1e3);
  client.on("error", () => retry());
  client.on("end", () => retry());
  client.on("notification", (message) => {
    if (message.payload) deliver(JSON.parse(message.payload));
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  } catch {
    retry();
  }
}

// src/server/http.ts
var ApiError = class extends Error {
  constructor(status, body, headers = {}) {
    super(JSON.stringify(body));
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
  status;
  body;
  headers;
};
var unauthenticated = () => new ApiError(401, { error: "unauthenticated" });
var notFound = () => new ApiError(404, { error: "not_found" });
var forbidden = () => new ApiError(403, { error: "forbidden" });
var storageUnavailable = () => new ApiError(503, { error: "storage_unavailable" });
var invalid = (errors) => new ApiError(422, { errors });
var TOO_LARGE = /* @__PURE__ */ Symbol("too large");
var BAD_JSON = /* @__PURE__ */ Symbol("bad json");
async function readRaw(req, cap) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size <= cap) chunks.push(chunk);
  }
  return size > cap ? TOO_LARGE : Buffer.concat(chunks);
}
async function readJson(ctx, cap = config.jsonBodyBytes) {
  const raw = await readRaw(ctx.req, cap);
  if (raw === TOO_LARGE) throw new ApiError(413, { error: "body_too_large" });
  if (raw.length === 0) return BAD_JSON;
  try {
    return JSON.parse(raw.toString("utf8"), (key, value) => {
      if (key.includes("\0") || typeof value === "string" && value.includes("\0")) throw BAD_JSON;
      return value;
    });
  } catch {
    return BAD_JSON;
  }
}
function fields(body) {
  if (body === BAD_JSON || typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid({ body: "Send a JSON body" });
  }
  return body;
}
function sendJson(res, status, body, headers = {}) {
  const text = body === void 0 ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    ...headers
  });
  res.end(text);
}
function sendNoContent(res) {
  res.writeHead(204, { "cache-control": "no-store" });
  res.end();
}
var routes = [];
function route(method, path2, handler, options = {}) {
  const names = [];
  const source = path2.replace(/:(\w+)/g, (_, name) => {
    names.push(name);
    return "([^/]+)";
  });
  routes.push({ method, pattern: new RegExp(`^${source}$`), names, handler, open: options.open ?? false, status: options.status ?? 200 });
}
function findRoute(method, pathname) {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const match = candidate.pattern.exec(pathname);
    if (!match) continue;
    try {
      const values = candidate.names.map((_, i) => decodeURIComponent(match[i + 1]));
      if (values.some((v) => v.includes("\0"))) return null;
      return { route: candidate, params: Object.fromEntries(candidate.names.map((n, i) => [n, values[i]])) };
    } catch {
      return null;
    }
  }
  return null;
}
var PARSE_COOKIE = /(?:^|;\s*)everyweek_session=([^;]+)/;
function sessionToken(req) {
  const match = PARSE_COOKIE.exec(req.headers.cookie ?? "");
  return match ? match[1] : null;
}

// src/server/s3.ts
import { createHash, createHmac } from "node:crypto";
var StorageUnavailable = class extends Error {
};
var sha256 = (data) => createHash("sha256").update(data).digest("hex");
var hmac = (key, data) => createHmac("sha256", key).update(data).digest();
var encodeSegment = (segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function target(key) {
  const { endpoint, bucket, pathStyle } = config.s3;
  const base = new URL(endpoint);
  const objectPath = key ? `/${key.split("/").map(encodeSegment).join("/")}` : "";
  if (pathStyle) {
    const path2 = `/${encodeSegment(bucket)}${objectPath}`;
    return { url: `${base.origin}${path2}`, host: base.host, path: path2 };
  }
  const host = `${bucket}.${base.host}`;
  return { url: `${base.protocol}//${host}${objectPath || "/"}`, host, path: objectPath || "/" };
}
async function send(method, key, body, contentType) {
  const { host, url, path: path2 } = target(key);
  const instant = realNow().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = instant.slice(0, 8);
  const payloadHash = sha256(body ?? "");
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": instant };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}
`).join("");
  const canonical = [method, path2, "", canonicalHeaders, names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${config.s3.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", instant, scope, sha256(canonical)].join("\n");
  let signingKey = hmac(`AWS4${config.s3.secretAccessKey}`, day);
  for (const part of [config.s3.region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.s3.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  delete headers.host;
  try {
    return await fetch(url, { method, headers, body, signal: AbortSignal.timeout(2500) });
  } catch {
    throw new StorageUnavailable();
  }
}
async function reachable() {
  try {
    return (await send("HEAD", "")).status === 200;
  } catch {
    return false;
  }
}
async function ensureBucket() {
  try {
    if ((await send("HEAD", "")).status === 404) await send("PUT", "");
  } catch {
  }
}
async function putObject(key, body, contentType) {
  const response = await send("PUT", key, body, contentType);
  if (!response.ok) throw new StorageUnavailable();
  const confirmed = await send("HEAD", key);
  if (!confirmed.ok) throw new StorageUnavailable();
}
async function getObject(key) {
  const response = await send("GET", key);
  if (!response.ok) throw new StorageUnavailable();
  return Buffer.from(await response.arrayBuffer());
}

// src/server/mail.ts
import net from "node:net";
function envelopeAddress(from) {
  const match = /<([^>]+)>/.exec(from);
  return match ? match[1] : from.trim();
}
async function sendMail(to, subject, text) {
  const socket = net.connect(config.smtp.port, config.smtp.host);
  socket.setTimeout(5e3);
  let buffer = "";
  const waiters = [];
  const failure = new Promise((_, reject) => {
    socket.on("error", reject);
    socket.on("timeout", () => reject(new Error("smtp timeout")));
    socket.on("close", () => reject(new Error("smtp closed")));
  });
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (; ; ) {
      const end = buffer.indexOf("\r\n");
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line)) waiters.shift()?.(line);
    }
  });
  const reply = (expect) => Promise.race([
    new Promise((resolve, reject) => {
      waiters.push((line) => line.startsWith(expect) ? resolve() : reject(new Error(line)));
    }),
    failure
  ]);
  const command = async (line, expect) => {
    const pending = reply(expect);
    socket.write(`${line}\r
`);
    await pending;
  };
  try {
    await reply("220");
    await command("EHLO everyweek", "250");
    await command(`MAIL FROM:<${envelopeAddress(config.mailFrom)}>`, "250");
    await command(`RCPT TO:<${to}>`, "250");
    await command("DATA", "354");
    const body = text.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
    const message = [
      `From: ${config.mailFrom}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      "."
    ].join("\r\n");
    await command(message, "250");
    socket.write("QUIT\r\n");
  } finally {
    socket.destroy();
    failure.catch(() => void 0);
  }
}

// src/server/tasks.ts
import { randomUUID } from "node:crypto";

// src/server/dates.ts
var WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}
var pad = (n, width) => String(n).padStart(width, "0");
function dayNumber(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return daysFromCivil(year, month, day);
}
function fromDayNumber(days) {
  const [year, month, day] = civilFromDays(days);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}
function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromDayNumber(dayNumber(value)) === value;
}
function addDays(iso, days) {
  return fromDayNumber(dayNumber(iso) + days);
}
function daysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}
function weekdayOf(iso) {
  return WEEKDAYS[((dayNumber(iso) + 4) % 7 + 7) % 7];
}
function isWorkingDay(iso) {
  const day = weekdayOf(iso);
  return day !== "sat" && day !== "sun";
}
function mondayOf(iso) {
  return addDays(iso, -((WEEKDAYS.indexOf(weekdayOf(iso)) + 6) % 7));
}
function daysInMonth(year, month) {
  return daysFromCivil(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - daysFromCivil(year, month, 1);
}

// src/server/formula.ts
var FormulaError = class extends Error {
  constructor(position, reason) {
    super(`Formula error at character ${position}: ${reason}`);
    this.position = position;
  }
  position;
};
var ARITY = {
  ROUND: { min: 2, max: 2 },
  IF: { min: 3, max: 3 },
  ISBLANK: { min: 1, max: 1 },
  DAYS: { min: 2, max: 2 },
  CONCAT: { min: 1, max: Infinity }
};
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    const at = i + 1;
    if (/\s/.test(char)) {
      i += 1;
    } else if (/\d/.test(char) || char === "." && /\d/.test(text[i + 1] ?? "")) {
      const match = /^\d*\.?\d+/.exec(text.slice(i));
      tokens.push({ kind: "number", value: Number(match[0]), at });
      i += match[0].length;
    } else if (char === '"') {
      const close = text.indexOf('"', i + 1);
      if (close < 0) throw new FormulaError(text.length + 1, 'expected "');
      tokens.push({ kind: "string", value: text.slice(i + 1, close), at });
      i = close + 1;
    } else if (char === "{") {
      const close = text.indexOf("}", i + 1);
      if (close < 0) throw new FormulaError(text.length + 1, "expected }");
      tokens.push({ kind: "ref", name: text.slice(i + 1, close), at });
      i = close + 1;
    } else if (/[A-Za-z]/.test(char)) {
      const match = /^[A-Za-z]+/.exec(text.slice(i));
      tokens.push({ kind: "name", name: match[0], at });
      i += match[0].length;
    } else if (["<=", ">=", "!="].includes(text.slice(i, i + 2))) {
      tokens.push({ kind: "op", value: text.slice(i, i + 2), at });
      i += 2;
    } else if ("+-*/()<>=,".includes(char)) {
      tokens.push({ kind: "op", value: char, at });
      i += 1;
    } else {
      throw new FormulaError(at, `unexpected character ${char}`);
    }
  }
  tokens.push({ kind: "end", at: text.length + 1 });
  return tokens;
}
var Parser = class {
  constructor(tokens) {
    this.tokens = tokens;
  }
  tokens;
  index = 0;
  peek() {
    return this.tokens[this.index];
  }
  isOp(value) {
    const token = this.peek();
    return token.kind === "op" && token.value === value;
  }
  parse() {
    const node = this.comparison();
    if (this.peek().kind !== "end") throw new FormulaError(this.peek().at, "expected end of formula");
    return node;
  }
  comparison() {
    let left = this.additive();
    for (; ; ) {
      const token = this.peek();
      if (token.kind === "op" && [">", "<", ">=", "<=", "=", "!="].includes(token.value)) {
        this.index += 1;
        left = { type: "binary", op: token.value, left, right: this.additive() };
      } else return left;
    }
  }
  additive() {
    let left = this.term();
    for (; ; ) {
      const token = this.peek();
      if (token.kind === "op" && (token.value === "+" || token.value === "-")) {
        this.index += 1;
        left = { type: "binary", op: token.value, left, right: this.term() };
      } else return left;
    }
  }
  term() {
    let left = this.unary();
    for (; ; ) {
      const token = this.peek();
      if (token.kind === "op" && (token.value === "*" || token.value === "/")) {
        this.index += 1;
        left = { type: "binary", op: token.value, left, right: this.unary() };
      } else return left;
    }
  }
  unary() {
    if (this.isOp("-")) {
      this.index += 1;
      return { type: "negate", operand: this.unary() };
    }
    return this.primary();
  }
  primary() {
    const token = this.peek();
    if (token.kind === "number") {
      this.index += 1;
      return { type: "number", value: token.value };
    }
    if (token.kind === "string") {
      this.index += 1;
      return { type: "string", value: token.value };
    }
    if (token.kind === "ref") {
      this.index += 1;
      return { type: "ref", name: token.name, at: token.at };
    }
    if (token.kind === "name") {
      this.index += 1;
      if (!this.isOp("(")) throw new FormulaError(token.at, `unexpected character ${token.name[0]}`);
      if (!(token.name in ARITY)) throw new FormulaError(token.at, `unknown function ${token.name}`);
      this.index += 1;
      const args = [];
      if (!this.isOp(")")) {
        for (; ; ) {
          args.push(this.comparison());
          if (this.isOp(",")) this.index += 1;
          else break;
        }
      }
      if (!this.isOp(")")) throw new FormulaError(this.peek().at, "expected )");
      this.index += 1;
      this.checkArity(token.name, args.length, token.at);
      return { type: "call", name: token.name, args, at: token.at };
    }
    if (this.isOp("(")) {
      this.index += 1;
      const inner = this.comparison();
      if (!this.isOp(")")) throw new FormulaError(this.peek().at, "expected )");
      this.index += 1;
      return inner;
    }
    throw new FormulaError(token.at, "expected a value");
  }
  checkArity(name, count, at) {
    const { min, max } = ARITY[name];
    if (count >= min && count <= max) return;
    const noun = (n) => `${n} argument${n === 1 ? "" : "s"}`;
    throw new FormulaError(at, max === Infinity ? `${name} needs at least ${noun(min)}` : `${name} needs ${noun(min)}`);
  }
};
function parseFormula(text, maxChars) {
  if (text.length > maxChars) {
    throw new FormulaError(maxChars + 1, `formula is longer than ${maxChars} characters`);
  }
  return new Parser(tokenize(text)).parse();
}
function references(node) {
  switch (node.type) {
    case "ref":
      return [{ name: node.name, at: node.at }];
    case "negate":
      return references(node.operand);
    case "binary":
      return [...references(node.left), ...references(node.right)];
    case "call":
      return node.args.flatMap(references);
    default:
      return [];
  }
}
var BUILT_IN_FIELDS = ["Start", "Due", "Effort"];
function renameReference(formula, from, to) {
  return formula.split(`{${from}}`).join(`{${to}}`);
}
function validateFormula(text, ownName, fields2, maxChars) {
  const root = parseFormula(text, maxChars);
  const refs = references(root);
  for (const ref of refs) {
    if (!BUILT_IN_FIELDS.includes(ref.name) && !fields2.some((f) => f.name === ref.name)) {
      throw new FormulaError(ref.at, `unknown field ${ref.name}`);
    }
  }
  const leadsBack = (name, seen) => {
    if (name === ownName) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    const field = fields2.find((f) => f.name === name && f.type === "formula" && f.formula);
    if (!field) return false;
    try {
      return references(parseFormula(field.formula, Infinity)).some((r) => leadsBack(r.name, seen));
    } catch {
      return false;
    }
  };
  for (const ref of refs) {
    if (leadsBack(ref.name, /* @__PURE__ */ new Set())) throw new FormulaError(ref.at, `circular reference to ${ref.name}`);
  }
}
var fail = (error) => ({ error });
var isError = (v) => typeof v === "object" && v !== null && "error" in v;
var isDate = (v) => typeof v === "object" && v !== null && "date" in v;
var isBlank = (v) => v === null;
var BudgetExceeded = class extends Error {
};
function inputValue(field, task) {
  const raw = task.values[field.id];
  if (raw === null || raw === void 0 || raw === "") return null;
  if (field.type === "number") return typeof raw === "number" ? raw : fail("#VALUE");
  if (field.type === "date") return typeof raw === "string" && isIsoDate(raw) ? { date: raw } : fail("#VALUE");
  if (field.type === "multi_select") return Array.isArray(raw) ? raw.length ? raw : null : fail("#VALUE");
  return String(raw);
}
function numberText(n) {
  return String(roundTo(n, 10));
}
function roundTo(value, places) {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const shifted = Math.round(Number(`${Math.abs(value)}e${places}`));
  const result = Number(`${shifted}e${-places}`);
  return Number.isNaN(result) ? sign * Math.round(Math.abs(value)) : sign * result;
}
function format(value) {
  if (value === null) return "";
  if (typeof value === "number") return numberText(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (isDate(value)) return value.date;
  if (isError(value)) return value.error;
  return value;
}
var Evaluation = class {
  constructor(task, fields2, maxSteps) {
    this.task = task;
    this.fields = fields2;
    this.maxSteps = maxSteps;
  }
  task;
  fields;
  maxSteps;
  steps = 0;
  cache = /* @__PURE__ */ new Map();
  run(field) {
    try {
      return this.field(field, []);
    } catch (error) {
      if (error instanceof BudgetExceeded) return fail("#BUDGET");
      throw error;
    }
  }
  spend(count = 1) {
    this.steps += count;
    if (this.steps > this.maxSteps) throw new BudgetExceeded();
  }
  field(field, path2) {
    const cached = this.cache.get(field.id);
    if (cached) {
      this.spend(cached.steps);
      return cached.value;
    }
    if (path2.includes(field.id) || !field.formula) return fail("#REF");
    let root;
    try {
      root = parseFormula(field.formula, Infinity);
    } catch {
      return fail("#VALUE");
    }
    const before = this.steps;
    const value = this.node(root, [...path2, field.id]);
    this.cache.set(field.id, { value, steps: this.steps - before });
    return value;
  }
  reference(name, path2) {
    if (name === "Start") return this.task.start ? { date: this.task.start } : null;
    if (name === "Due") return this.task.due ? { date: this.task.due } : null;
    if (name === "Effort") return this.task.effort;
    const field = this.fields.find((f) => f.name === name);
    if (!field) return fail("#REF");
    return field.type === "formula" ? this.field(field, path2) : inputValue(field, this.task);
  }
  node(node, path2) {
    switch (node.type) {
      case "number":
        this.spend();
        return node.value;
      case "string":
        this.spend();
        return node.value;
      case "ref":
        this.spend();
        return this.reference(node.name, path2);
      case "negate": {
        this.spend();
        const operand = this.node(node.operand, path2);
        if (isError(operand)) return operand;
        if (isBlank(operand)) return 0;
        return typeof operand === "number" ? 0 - operand : fail("#VALUE");
      }
      case "binary": {
        this.spend();
        const left = this.node(node.left, path2);
        const right = this.node(node.right, path2);
        return this.binary(node.op, left, right);
      }
      case "call":
        this.spend();
        return this.call(node, path2);
    }
  }
  binary(op, left, right) {
    if (isError(left)) return left;
    if (isError(right)) return right;
    if (["+", "-"].includes(op)) return this.sum(op, left, right);
    if (["*", "/"].includes(op)) {
      if (isBlank(left) || isBlank(right)) return null;
      if (typeof left !== "number" || typeof right !== "number") return fail("#VALUE");
      if (op === "*") return left * right;
      return right === 0 ? fail("#DIV/0") : left / right;
    }
    return this.compare(op, left, right);
  }
  sum(op, left, right) {
    const sign = op === "+" ? 1 : -1;
    const l = isBlank(left) ? 0 : left;
    const r = isBlank(right) ? 0 : right;
    if (typeof l === "number" && typeof r === "number") return l + sign * r;
    if (isDate(l) && typeof r === "number") return { date: addDays(l.date, sign * r) };
    if (op === "+" && typeof l === "number" && isDate(r)) return { date: addDays(r.date, l) };
    return fail("#VALUE");
  }
  compare(op, left, right) {
    if (isBlank(left) || isBlank(right)) return false;
    const a = isDate(left) ? left.date : left;
    const b = isDate(right) ? right.date : right;
    if (typeof a !== typeof b || Array.isArray(a) || Array.isArray(b)) {
      if (op === "=") return false;
      if (op === "!=") return true;
      return fail("#VALUE");
    }
    const x = a;
    const y = b;
    switch (op) {
      case "=":
        return x === y;
      case "!=":
        return x !== y;
      case ">":
        return x > y;
      case "<":
        return x < y;
      case ">=":
        return x >= y;
      default:
        return x <= y;
    }
  }
  call(node, path2) {
    if (node.name === "IF") {
      const test = this.node(node.args[0], path2);
      if (isError(test)) return test;
      if (test !== null && typeof test !== "boolean") return fail("#VALUE");
      return this.node(node.args[test === true ? 1 : 2], path2);
    }
    const args = node.args.map((arg) => this.node(arg, path2));
    const failed = args.find(isError);
    if (failed) return failed;
    switch (node.name) {
      case "ROUND": {
        const [x, places] = args;
        if (isBlank(x)) return null;
        if (typeof x !== "number" || !isBlank(places) && typeof places !== "number") return fail("#VALUE");
        return roundTo(x, Math.trunc(places ?? 0));
      }
      case "ISBLANK":
        return isBlank(args[0]) || args[0] === "";
      case "DAYS": {
        const [from, to] = args;
        if (isBlank(from) || isBlank(to)) return null;
        if (!isDate(from) || !isDate(to)) return fail("#VALUE");
        return daysBetween(from.date, to.date);
      }
      default:
        return args.map(format).join("");
    }
  }
};
function evaluateFormulas(task, fields2, maxSteps) {
  const out = {};
  for (const field of fields2.filter((f) => f.type === "formula")) {
    const value = new Evaluation(task, fields2, maxSteps).run(field);
    out[field.id] = toJson(value);
  }
  return out;
}
function toJson(value) {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? roundTo(value, 10) : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.join(", ");
  if (isDate(value)) return value.date;
  return value.error;
}

// src/server/recurrence.ts
var WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function parseRepeat(text) {
  if (!text) return null;
  const weekly = /^Every week on (\w+)$/.exec(text);
  if (weekly) {
    const weekday = WEEKDAY_NAMES.indexOf(weekly[1]);
    return weekday < 0 ? null : { kind: "weekly", weekday };
  }
  const monthly = /^Every month on day (\d{1,2})$/.exec(text);
  if (monthly && Number(monthly[1]) >= 1 && Number(monthly[1]) <= 31) return { kind: "monthly", day: Number(monthly[1]) };
  const after = /^Every (\d+) days after completion$/.exec(text);
  return after && Number(after[1]) >= 1 ? { kind: "after", days: Number(after[1]) } : null;
}
function nextDue(repeat, previousDue, completedOn) {
  if (repeat.kind === "after") return addDays(completedOn, repeat.days);
  if (repeat.kind === "weekly") {
    const current = WEEKDAYS.indexOf(weekdayOf(previousDue));
    const ahead = (repeat.weekday - current + 6) % 7 + 1;
    return addDays(previousDue, ahead);
  }
  const [year, month] = previousDue.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const day = Math.min(repeat.day, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// src/server/tasks.ts
var BUILT_IN_KEYS = ["assignee", "start", "due", "effort"];
var BUILT_IN_LABELS = { assignee: "Assignee", start: "Start", due: "Due", effort: "Effort" };
var TASK_COLUMNS = `id, project_id, name, description, section_id, position, parent_id, assignee_id, start_date, due_date, effort, completed, version, recurrence, values`;
function toRow(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    sectionId: r.section_id,
    position: r.position,
    parentId: r.parent_id,
    assigneeId: r.assignee_id,
    start: r.start_date,
    due: r.due_date,
    effort: r.effort,
    completed: r.completed,
    version: r.version,
    recurrence: r.recurrence,
    values: r.values
  };
}
async function loadProject(db, projectId) {
  const { rows } = await db.query("SELECT id, team_id, name FROM projects WHERE id = $1", [projectId]);
  if (!rows.length) throw notFound();
  const sections = await db.query("SELECT id, name, position FROM sections WHERE project_id = $1 ORDER BY position", [projectId]);
  const fields2 = await db.query("SELECT id, name, type, options, formula, position FROM fields WHERE project_id = $1 ORDER BY position", [projectId]);
  const members = await db.query("SELECT person_id FROM memberships WHERE team_id = $1", [rows[0].team_id]);
  return {
    id: rows[0].id,
    teamId: rows[0].team_id,
    name: rows[0].name,
    sections: sections.rows,
    fields: fields2.rows.map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options, formula: f.formula, position: f.position })),
    memberIds: members.rows.map((m) => m.person_id)
  };
}
async function getTaskRow(db, taskId, lock = false) {
  const { rows } = await db.query(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [taskId]);
  if (!rows.length) throw notFound();
  return toRow(rows[0]);
}
async function listTasks(db, ctx) {
  const { rows } = await db.query(`SELECT ${TASK_COLUMNS} FROM tasks WHERE project_id = $1`, [ctx.id]);
  const all = rows.map(toRow);
  const sectionOrder = new Map(ctx.sections.map((s) => [s.id, s.position]));
  const children = /* @__PURE__ */ new Map();
  for (const t of all) if (t.parentId) children.set(t.parentId, [...children.get(t.parentId) ?? [], t]);
  const tops = all.filter((t) => !t.parentId).sort((a, b) => (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0) || a.position - b.position);
  return tops.flatMap((t) => [t, ...(children.get(t.id) ?? []).sort((a, b) => a.position - b.position)]);
}
function dueStatus(task, today) {
  if (task.completed || !task.due) return "none";
  return task.due < today ? "overdue" : task.due === today ? "today" : "later";
}
function taskJson(task, ctx, now2) {
  const computed = evaluateFormulas(task, ctx.fields, config.limits.formulaMaxSteps);
  const values = {};
  for (const field of ctx.fields) {
    values[field.name] = field.type === "formula" ? computed[field.id] ?? null : task.values[field.id] ?? null;
  }
  return {
    id: task.id,
    projectId: task.projectId,
    name: task.name,
    description: task.description,
    section: task.sectionId,
    position: task.position,
    parentId: task.parentId,
    assigneeId: task.assigneeId,
    start: task.start,
    due: task.due,
    effort: task.effort,
    completed: task.completed,
    version: task.version,
    recurrence: task.recurrence,
    dueStatus: dueStatus(task, dateOf(now2)),
    values
  };
}
var has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);
function fieldByName(ctx, name) {
  return ctx.fields.find((f) => f.name === name);
}
function checkValue(field, value) {
  if (value === null || value === "") return null;
  const bad = (message) => {
    throw new Error(message);
  };
  try {
    switch (field.type) {
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) bad(`${field.name} must be a number`);
        break;
      case "date":
        if (!isIsoDate(value)) bad(`${field.name} must be a date like 2026-03-02`);
        break;
      case "single_select":
        if (typeof value !== "string" || !field.options.includes(value)) bad(`${field.name} must be one of its options`);
        break;
      case "multi_select":
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !field.options.includes(v))) {
          bad(`${field.name} must be some of its options`);
        }
        break;
      case "text":
        if (typeof value !== "string") bad(`${field.name} must be text`);
        break;
      default:
        bad(`${field.name} is a formula and cannot be set`);
    }
  } catch (error) {
    return error.message;
  }
  return null;
}
function normalizeValue(value) {
  if (value === null || value === "" || Array.isArray(value) && value.length === 0) return null;
  return value;
}
function parsePatch(body, ctx, forCreate) {
  const errors = {};
  const patch = {};
  if (has(body, "name") || forCreate) {
    if (typeof body.name !== "string" || body.name.trim() === "") errors.name = "Enter a task name";
    else patch.name = body.name.trim();
  }
  if (has(body, "description")) {
    if (typeof body.description !== "string") errors.description = "Description must be text";
    else patch.description = body.description;
  }
  const sectionKey = has(body, "section") ? "section" : null;
  if (sectionKey) {
    if (typeof body.section !== "string" || !ctx.sections.some((s) => s.id === body.section)) errors.section = "Choose a section of this project";
    else patch.sectionId = body.section;
  }
  if (has(body, "position")) {
    if (typeof body.position !== "number" || !Number.isInteger(body.position) || body.position < 1) errors.position = "Position must be a whole number from 1";
    else patch.position = body.position;
  }
  if (has(body, "parentId")) {
    if (body.parentId !== null && typeof body.parentId !== "string") errors.parentId = "Tasks nest one level only";
    else patch.parentId = body.parentId;
  }
  if (has(body, "assigneeId")) {
    if (body.assigneeId !== null && (typeof body.assigneeId !== "string" || !ctx.memberIds.includes(body.assigneeId))) {
      errors.assigneeId = "Choose a member of this team";
    } else patch.assigneeId = body.assigneeId;
  }
  for (const key of ["start", "due"]) {
    if (!has(body, key)) continue;
    const value = body[key];
    if (value !== null && !isIsoDate(value)) errors[key] = "Enter a date like 2026-03-02";
    else patch[key] = value;
  }
  if (has(body, "effort")) {
    const value = body.effort;
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) errors.effort = "Effort must be 0 or more hours";
    else patch.effort = value;
  }
  if (has(body, "completed")) {
    if (typeof body.completed !== "boolean") errors.completed = "Completed must be true or false";
    else patch.completed = body.completed;
  }
  if (has(body, "recurrence")) {
    if (body.recurrence !== null && (typeof body.recurrence !== "string" || !parseRepeat(body.recurrence))) {
      errors.recurrence = "Use a repeat rule like Every week on Monday";
    } else patch.recurrence = body.recurrence;
  }
  if (has(body, "values")) {
    const given = body.values;
    if (typeof given !== "object" || given === null || Array.isArray(given)) errors.values = "Values must be an object";
    else {
      patch.values = {};
      for (const [name, value] of Object.entries(given)) {
        const field = fieldByName(ctx, name);
        const problem = field ? checkValue(field, value) : `Unknown field ${name}`;
        if (problem) errors.values = problem;
        else if (field) patch.values[field.id] = normalizeValue(value);
      }
    }
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return patch;
}
var NEST_ERROR = "Tasks nest one level only";
async function siblingIds(tx, task, parentId, sectionId, except) {
  const { rows } = parentId ? await tx.query("SELECT id FROM tasks WHERE parent_id = $1 AND id <> $2 ORDER BY position, seq", [parentId, except]) : await tx.query(
    "SELECT id FROM tasks WHERE project_id = $1 AND parent_id IS NULL AND section_id = $2 AND id <> $3 ORDER BY position, seq",
    [task.projectId, sectionId, except]
  );
  return rows.map((r) => r.id);
}
async function renumber(tx, ids) {
  for (const [index, id] of ids.entries()) await tx.query("UPDATE tasks SET position = $2 WHERE id = $1 AND position <> $2", [id, index + 1]);
}
async function nearestAbove(tx, task) {
  const { rows } = await tx.query(
    "SELECT id FROM tasks WHERE project_id = $1 AND parent_id IS NULL AND section_id = $2 AND position < $3 ORDER BY position DESC LIMIT 1",
    [task.projectId, task.sectionId, task.position]
  );
  return rows.length ? rows[0].id : null;
}
async function hasSubtasks(tx, taskId) {
  const { rows } = await tx.query("SELECT 1 FROM tasks WHERE parent_id = $1 LIMIT 1", [taskId]);
  return rows.length > 0;
}
async function placement(tx, task, patch) {
  const nesting = patch.parentId !== void 0;
  if (nesting && patch.parentId === null) {
    if (!task.parentId) throw invalid({ parentId: NEST_ERROR });
    const { rows } = await tx.query("SELECT section_id, position FROM tasks WHERE id = $1", [task.parentId]);
    return { parentId: null, sectionId: rows[0].section_id, index: rows[0].position };
  }
  if (nesting) {
    if (task.parentId || await hasSubtasks(tx, task.id) || await nearestAbove(tx, task) !== patch.parentId) {
      throw invalid({ parentId: NEST_ERROR });
    }
    return { parentId: patch.parentId, sectionId: task.sectionId, index: null };
  }
  if (patch.sectionId !== void 0 && task.parentId && patch.sectionId !== task.sectionId) {
    throw invalid({ section: "Choose a section of this project" });
  }
  const movesSection = patch.sectionId !== void 0 && patch.sectionId !== task.sectionId;
  if (movesSection || patch.position !== void 0) {
    return { parentId: task.parentId, sectionId: patch.sectionId ?? task.sectionId, index: patch.position === void 0 ? null : patch.position - 1 };
  }
  return null;
}
async function place(tx, task, target2) {
  const oldSiblings = await siblingIds(tx, task, task.parentId, task.sectionId, task.id);
  const newSiblings = target2.parentId === task.parentId && target2.sectionId === task.sectionId ? oldSiblings : await siblingIds(tx, task, target2.parentId, target2.sectionId, task.id);
  const index = Math.min(target2.index ?? newSiblings.length, newSiblings.length);
  const next = [...newSiblings.slice(0, index), task.id, ...newSiblings.slice(index)];
  await tx.query("UPDATE tasks SET parent_id = $2, section_id = $3 WHERE id = $1", [task.id, target2.parentId, target2.sectionId]);
  if (target2.sectionId !== task.sectionId) await tx.query("UPDATE tasks SET section_id = $2 WHERE parent_id = $1", [task.id, target2.sectionId]);
  if (oldSiblings !== newSiblings) await renumber(tx, oldSiblings);
  await renumber(tx, next);
}
async function addHistory(tx, taskId, text, now2) {
  await tx.query("INSERT INTO history (task_id, text, created_at) VALUES ($1, $2, $3)", [taskId, text, now2]);
}
var same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
async function applyUpdate(tx, ctx, current, patch, actor, now2) {
  const changes = [];
  const next = { ...current, values: { ...current.values } };
  const set = (key, value, field, label) => {
    if (!same(current[key], value)) {
      next[key] = value;
      changes.push({ field, label, to: value });
    }
  };
  if (patch.name !== void 0) set("name", patch.name, "name", "Name");
  if (patch.description !== void 0) set("description", patch.description, "description", "Description");
  if (patch.assigneeId !== void 0) set("assigneeId", patch.assigneeId, "assignee", "Assignee");
  if (patch.start !== void 0) set("start", patch.start, "start", "Start");
  if (patch.due !== void 0) set("due", patch.due, "due", "Due");
  if (patch.effort !== void 0) set("effort", patch.effort, "effort", "Effort");
  if (patch.completed !== void 0) set("completed", patch.completed, "completed", "Completed");
  if (patch.recurrence !== void 0) set("recurrence", patch.recurrence, "recurrence", "Repeat");
  for (const [fieldId, value] of Object.entries(patch.values ?? {})) {
    if (!same(current.values[fieldId], value)) {
      if (value === null) delete next.values[fieldId];
      else next.values[fieldId] = value;
      changes.push({ field: fieldId, label: ctx.fields.find((f) => f.id === fieldId).name, to: value });
    }
  }
  if (next.start && next.due && next.due < next.start && (patch.due !== void 0 || patch.start !== void 0)) {
    throw invalid({ due: "Due date can't be before the start date" });
  }
  const target2 = await placement(tx, current, patch);
  let order = null;
  if (target2) {
    const moved = target2.sectionId !== current.sectionId;
    const reparented = target2.parentId !== current.parentId;
    await place(tx, current, target2);
    const { rows } = await tx.query("SELECT section_id, parent_id, position FROM tasks WHERE id = $1", [current.id]);
    next.sectionId = rows[0].section_id;
    next.parentId = rows[0].parent_id;
    next.position = rows[0].position;
    if (moved) changes.push({ field: "section", label: "Section", to: next.sectionId });
    else if (reparented) changes.push({ field: "parent", label: "Parent", to: next.parentId });
    else if (next.position !== current.position) order = { field: "position", label: "Position", to: next.position };
  }
  if (order) changes.push(order);
  if (changes.length) {
    next.version = current.version + 1;
    await tx.query(
      `UPDATE tasks SET name=$2, description=$3, assignee_id=$4, start_date=$5, due_date=$6, effort=$7, completed=$8,
         recurrence=$9, values=$10, version=$11 WHERE id = $1`,
      [
        next.id,
        next.name,
        next.description,
        next.assigneeId,
        next.start,
        next.due,
        next.effort,
        next.completed,
        next.recurrence,
        JSON.stringify(next.values),
        next.version
      ]
    );
    for (const change of changes) await addHistory(tx, next.id, `${actor.name} changed ${change.label}`, now2);
  }
  return { task: next, changes };
}
async function insertTask(tx, ctx, input, actor, now2, id = randomUUID()) {
  let sectionId = input.sectionId;
  let parentId = input.parentId ?? null;
  if (parentId) {
    const { rows: rows2 } = await tx.query("SELECT section_id, parent_id, project_id FROM tasks WHERE id = $1", [parentId]);
    if (!rows2.length || rows2[0].project_id !== ctx.id || rows2[0].parent_id) throw invalid({ parentId: NEST_ERROR });
    sectionId = rows2[0].section_id;
  }
  if (input.start && input.due && input.due < input.start) throw invalid({ due: "Due date can't be before the start date" });
  const row = {
    id,
    projectId: ctx.id,
    name: input.name,
    description: input.description ?? "",
    sectionId,
    position: 1,
    parentId,
    assigneeId: input.assigneeId ?? null,
    start: input.start ?? null,
    due: input.due ?? null,
    effort: input.effort ?? null,
    completed: input.completed ?? false,
    version: 1,
    recurrence: input.recurrence ?? null,
    values: input.values ?? {}
  };
  await tx.query(
    `INSERT INTO tasks (id, project_id, name, description, section_id, position, parent_id, assignee_id, start_date, due_date,
       effort, completed, version, recurrence, values, created_at)
     VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,1,$12,$13,$14)`,
    [
      id,
      ctx.id,
      row.name,
      row.description,
      sectionId,
      parentId,
      row.assigneeId,
      row.start,
      row.due,
      row.effort,
      row.completed,
      row.recurrence,
      JSON.stringify(row.values),
      now2
    ]
  );
  const siblings = await siblingIds(tx, row, parentId, sectionId, id);
  const index = Math.min(input.position === void 0 ? siblings.length : input.position - 1, siblings.length);
  await renumber(tx, [...siblings.slice(0, index), id, ...siblings.slice(index)]);
  const { rows } = await tx.query("SELECT position FROM tasks WHERE id = $1", [id]);
  row.position = rows[0].position;
  await addHistory(tx, id, `${actor.name} created this task`, now2);
  return row;
}
async function removeTask(tx, task) {
  await tx.query("DELETE FROM tasks WHERE id = $1", [task.id]);
  const siblings = await siblingIds(tx, task, task.parentId, task.sectionId, task.id);
  await renumber(tx, siblings);
}

// src/server/rules.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// src/server/inbox.ts
import { randomUUID as randomUUID2 } from "node:crypto";
async function addInboxItem(tx, input, now2) {
  const id = randomUUID2();
  await tx.query(
    "INSERT INTO inbox (id, person_id, text, task_id, kind, approval_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, input.personId, input.text, input.taskId, input.kind, input.approvalId ?? null, now2]
  );
  await publish(tx, { t: "inbox", person: input.personId, added: id, text: input.text });
}
function inboxJson(row, pending) {
  return {
    id: row.id,
    text: row.text,
    taskId: row.task_id,
    kind: row.kind,
    read: row.read,
    createdAt: isoInstant(row.created_at),
    pending
  };
}

// src/server/rules.ts
var OPS = ["is", "is_not", "is_blank", "is_greater_than"];
function fieldRef(project, value) {
  if (typeof value !== "string") return null;
  return BUILT_IN_KEYS.includes(value) || project.fields.some((f) => f.id === value) ? value : null;
}
function parseTrigger(project, value) {
  const t = value;
  if (!t || typeof t !== "object") return null;
  switch (t.type) {
    case "task_added":
    case "due_date_arrives":
    case "approval_decided":
      return { type: t.type };
    case "field_changed": {
      const field = fieldRef(project, t.field);
      if (!field) return null;
      return named(t.value) ? { type: t.type, field, value: t.value } : { type: t.type, field };
    }
    case "moved_to_section":
      return typeof t.section === "string" && project.sections.some((s) => s.id === t.section) ? { type: t.type, section: t.section } : null;
    default:
      return null;
  }
}
function parseAction(project, value) {
  const a = value;
  if (!a || typeof a !== "object") return null;
  switch (a.type) {
    case "set_field": {
      const target2 = fieldRef(project, a.target);
      return target2 && a.value !== void 0 ? { type: a.type, target: target2, value: a.value } : null;
    }
    case "move_to_section":
      return typeof a.target === "string" && project.sections.some((s) => s.id === a.target) ? { type: a.type, target: a.target } : null;
    case "assign_to":
      return typeof a.target === "string" && project.memberIds.includes(a.target) ? { type: a.type, target: a.target } : null;
    case "add_subtask":
      return typeof a.value === "string" && a.value.trim() ? { type: a.type, value: a.value.trim() } : null;
    case "send_to_inbox":
      return typeof a.value === "string" && a.value.trim() ? { type: a.type, value: a.value.trim() } : { type: a.type };
    default:
      return null;
  }
}
function parseCondition(project, value) {
  if (value === void 0 || value === null) return null;
  const c = value;
  const field = fieldRef(project, c.field);
  if (!field || typeof c.op !== "string" || !OPS.includes(c.op)) return void 0;
  return c.op === "is_blank" ? { field, op: c.op } : { field, op: c.op, value: c.value };
}
function parseRule(body, project) {
  const errors = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.name = "Enter a rule name";
  const trigger = parseTrigger(project, body.trigger);
  if (!trigger) errors.trigger = "Choose when the rule runs";
  const action = parseAction(project, body.action);
  if (!action) errors.action = "Choose what happens";
  const condition = parseCondition(project, body.condition);
  if (condition === void 0) errors.condition = "Choose a condition field and value";
  if (!trigger || !action || condition === void 0 || !name) throw invalid(errors);
  return { name, trigger, condition, action };
}
async function loadRules(tx, projectId) {
  const { rows } = await tx.query("SELECT id, name, position, trigger, condition, action FROM rules WHERE project_id = $1 ORDER BY position, seq", [projectId]);
  return rows;
}
async function newChain(tx, ctx, now2) {
  const people = await tx.query("SELECT p.id, p.name FROM people p JOIN memberships m ON m.person_id = p.id WHERE m.team_id = $1", [ctx.teamId]);
  return {
    ctx,
    now: now2,
    rules: await loadRules(tx, ctx.id),
    people: new Map(people.rows.map((p) => [p.id, p.name])),
    trace: [],
    touched: /* @__PURE__ */ new Set(),
    withRuns: /* @__PURE__ */ new Set()
  };
}
var fieldLabel = (chain, key) => BUILT_IN_LABELS[key] ?? chain.ctx.fields.find((f) => f.id === key)?.name ?? key;
var sectionName = (chain, id) => chain.ctx.sections.find((s) => s.id === id)?.name ?? String(id);
function valueText(chain, key, value) {
  if (key === "assignee") return chain.people.get(String(value)) ?? String(value);
  return Array.isArray(value) ? value.join(", ") : String(value);
}
function triggerText(chain, trigger) {
  switch (trigger.type) {
    case "task_added":
      return "Task added";
    case "field_changed": {
      const base = `Field changed ${fieldLabel(chain, trigger.field ?? "")}`;
      return named(trigger.value) ? `${base} to ${valueText(chain, trigger.field ?? "", trigger.value)}` : base;
    }
    case "moved_to_section":
      return `Moved to section ${sectionName(chain, trigger.section)}`;
    case "due_date_arrives":
      return "Due date arrives";
    default:
      return "Approval decided";
  }
}
function matches(rule, event) {
  const { trigger } = rule;
  if (trigger.type !== event.type) return false;
  if (trigger.type === "field_changed") {
    if (trigger.field !== event.field) return false;
    if (!named(trigger.value)) return true;
    return Array.isArray(event.value) ? event.value.includes(trigger.value) : event.value === trigger.value;
  }
  if (trigger.type === "moved_to_section") return trigger.section === event.sectionId;
  return true;
}
function currentValue(task, key) {
  switch (key) {
    case "assignee":
      return task.assigneeId;
    case "start":
      return task.start;
    case "due":
      return task.due;
    case "effort":
      return task.effort;
    default:
      return task.values[key] ?? null;
  }
}
var named = (v) => v !== void 0 && v !== null && v !== "";
var blank = (v) => v === null || v === void 0 || v === "" || Array.isArray(v) && v.length === 0;
function conditionHolds(condition, task) {
  if (!condition) return true;
  const actual = currentValue(task, condition.field);
  const wanted = condition.value;
  switch (condition.op) {
    case "is":
      return Array.isArray(actual) ? actual.includes(wanted) : String(actual ?? "") === String(wanted ?? "");
    case "is_not":
      return Array.isArray(actual) ? !actual.includes(wanted) : String(actual ?? "") !== String(wanted ?? "");
    case "is_blank":
      return blank(actual);
    case "is_greater_than": {
      if (blank(actual) || blank(wanted)) return false;
      const bothNumbers = !Number.isNaN(Number(actual)) && !Number.isNaN(Number(wanted));
      return bothNumbers ? Number(actual) > Number(wanted) : String(actual) > String(wanted);
    }
    default:
      return false;
  }
}
function summaryOf(chain, rule) {
  const { action } = rule;
  switch (action.type) {
    case "move_to_section":
      return `${rule.name} ran: moved to ${sectionName(chain, action.target)}`;
    case "assign_to":
      return `${rule.name} ran: assigned to ${chain.people.get(String(action.target)) ?? action.target}`;
    case "set_field":
      return `${rule.name} ran: set ${fieldLabel(chain, action.target ?? "")} to ${valueText(chain, action.target ?? "", action.value)}`;
    case "add_subtask":
      return `${rule.name} ran: added subtask ${action.value}`;
    default:
      return `${rule.name} ran: sent to inbox`;
  }
}
async function record(tx, chain, task, depth, summary, detail, counted) {
  await tx.query(
    "INSERT INTO rule_runs (project_id, task_id, depth, summary, detail, counted, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [chain.ctx.id, task.id, depth, summary, detail, counted, chain.now]
  );
  chain.withRuns.add(task.id);
}
async function runsThisMinute(tx, chain) {
  const minute = minuteStart(chain.now);
  const { rows } = await tx.query(
    "SELECT count(*)::int AS n FROM rule_runs WHERE project_id = $1 AND counted AND created_at >= $2 AND created_at < $3",
    [chain.ctx.id, minute, plus(minute, 6e4)]
  );
  return rows[0].n;
}
function fieldPatch(field, key, raw) {
  if (key === "assignee") return { assigneeId: blank(raw) ? null : String(raw) };
  if (key === "start" || key === "due") return blank(raw) ? { [key]: null } : isIsoDate(raw) ? { [key]: raw } : null;
  if (key === "effort") return blank(raw) ? { effort: null } : Number.isFinite(Number(raw)) ? { effort: Number(raw) } : null;
  if (!field || field.type === "formula") return null;
  if (blank(raw)) return { values: { [field.id]: null } };
  if (field.type === "number") return Number.isFinite(Number(raw)) ? { values: { [field.id]: Number(raw) } } : null;
  if (field.type === "multi_select") return { values: { [field.id]: Array.isArray(raw) ? raw : [raw] } };
  return { values: { [field.id]: raw } };
}
async function applyAction(tx, chain, rule, task, depth) {
  const { action } = rule;
  const actor = { name: rule.name };
  const change = async (patch) => {
    const fresh = await getTaskRow(tx, task.id, true);
    try {
      const result = await applyUpdate(tx, chain.ctx, fresh, patch, actor, chain.now);
      chain.touched.add(task.id);
      await fireChanges(tx, chain, result.task, result.changes, depth);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  };
  switch (action.type) {
    case "set_field": {
      const key = action.target ?? "";
      const patch = fieldPatch(chain.ctx.fields.find((f) => f.id === key), key, action.value);
      if (patch) await change(patch);
      break;
    }
    case "move_to_section":
      await change({ sectionId: action.target });
      break;
    case "assign_to":
      await change({ assigneeId: action.target ?? null });
      break;
    case "add_subtask": {
      const fresh = await getTaskRow(tx, task.id);
      const parentId = fresh.parentId ?? fresh.id;
      const parent = fresh.parentId ? await getTaskRow(tx, parentId) : fresh;
      const child = await insertTask(tx, chain.ctx, { name: String(action.value), sectionId: parent.sectionId, parentId }, actor, chain.now);
      chain.touched.add(child.id);
      await fireAdded(tx, chain, child, depth);
      break;
    }
    default: {
      const fresh = await getTaskRow(tx, task.id);
      const recipients = fresh.assigneeId ? [fresh.assigneeId] : (await tx.query("SELECT person_id FROM memberships WHERE team_id = $1 AND role = 'coordinator'", [chain.ctx.teamId])).rows.map((r) => r.person_id);
      const text = blank(action.value) ? `${rule.name}: ${fresh.name}` : String(action.value);
      for (const personId of recipients) await addInboxItem(tx, { personId, text, taskId: fresh.id, kind: "note" }, chain.now);
    }
  }
}
async function runRules(tx, chain, event, depth) {
  const limits = config.limits;
  for (const rule of chain.rules.filter((r) => matches(r, event))) {
    if (!await claim(tx, `rule:${rule.id}:${event.id}`)) continue;
    const task = await getTaskRow(tx, event.taskId);
    const at = depth + 1;
    const trigger = triggerText(chain, rule.trigger);
    if (at > limits.ruleMaxDepth) {
      await record(
        tx,
        chain,
        task,
        at,
        `Stopped: chain depth limit ${limits.ruleMaxDepth} reached at ${rule.name}`,
        `Trigger: ${trigger}. Not run: depth ${at} is deeper than ${limits.ruleMaxDepth}`,
        false
      );
    } else if (!conditionHolds(rule.condition, task)) {
      await record(tx, chain, task, at, `${rule.name} skipped: conditions not met`, `Trigger: ${trigger}. Conditions: not met`, false);
    } else if (await runsThisMinute(tx, chain) >= limits.ruleRunsPerMinute) {
      await record(
        tx,
        chain,
        task,
        at,
        `Skipped: rule run limit ${limits.ruleRunsPerMinute} per minute reached`,
        `Trigger: ${trigger}. Not run: ${limits.ruleRunsPerMinute} runs this minute`,
        false
      );
    } else {
      await record(tx, chain, task, at, summaryOf(chain, rule), `Trigger: ${trigger}. Conditions: ${rule.condition ? "met" : "none"}`, true);
      if (!chain.trace.includes(task.id)) chain.trace.push(task.id);
      await applyAction(tx, chain, rule, task, at);
    }
  }
}
async function fireAdded(tx, chain, task, depth) {
  await runRules(tx, chain, { id: randomUUID3(), type: "task_added", taskId: task.id }, depth);
}
async function fireChanges(tx, chain, task, changes, depth) {
  for (const change of changes) {
    const isSection = change.field === "section";
    const isField = ["assignee", "start", "due", "effort"].includes(change.field) || chain.ctx.fields.some((f) => f.id === change.field);
    if (!isSection && !isField) continue;
    await runRules(tx, chain, {
      id: randomUUID3(),
      type: isSection ? "moved_to_section" : "field_changed",
      taskId: task.id,
      ...isSection ? { sectionId: change.to } : { field: change.field, value: change.to }
    }, depth);
  }
}
async function fireApproval(tx, chain, task) {
  await runRules(tx, chain, { id: randomUUID3(), type: "approval_decided", taskId: task.id }, 0);
}
async function fireDue(tx, chain, task) {
  await runRules(tx, chain, { id: `due:${task.id}:${task.due}`, type: "due_date_arrives", taskId: task.id }, 0);
}

// src/server/workflow.ts
async function finishChain(tx, chain) {
  if (chain.trace.length) {
    await tx.query("UPDATE projects SET trace = $2 WHERE id = $1", [chain.ctx.id, JSON.stringify(chain.trace)]);
  }
  await publish(tx, {
    t: "tasks",
    team: chain.ctx.teamId,
    project: chain.ctx.id,
    ids: [...chain.touched],
    runs: [...chain.withRuns],
    ...chain.trace.length ? { trace: chain.trace } : {}
  });
}
async function spawnSuccessor(tx, chain, task, completedOn, onlyWhenOpen) {
  const repeat = parseRepeat(task.recurrence);
  if (!repeat || onlyWhenOpen && repeat.kind === "after") return null;
  if (!await claim(tx, `successor:${task.id}`)) return null;
  const due = nextDue(repeat, task.due ?? completedOn, completedOn);
  const shift = task.due ? daysBetween(task.due, due) : 0;
  const successor = await insertTask(tx, chain.ctx, {
    name: task.name,
    sectionId: task.sectionId,
    assigneeId: task.assigneeId,
    effort: task.effort,
    recurrence: task.recurrence,
    values: task.values,
    due,
    start: task.start ? addDays(task.start, shift) : null
  }, { name: task.name }, chain.now);
  chain.touched.add(successor.id);
  await fireAdded(tx, chain, successor, 0);
  await publish(tx, { t: "repeat", team: chain.ctx.teamId, project: chain.ctx.id, text: `${task.name} repeats on ${due}` });
  return successor;
}
async function createTask(tx, ctx, input, actor, now2) {
  const chain = await newChain(tx, ctx, now2);
  const task = await insertTask(tx, ctx, input, actor, now2);
  chain.touched.add(task.id);
  await fireAdded(tx, chain, task, 0);
  await finishChain(tx, chain);
  return getTaskRow(tx, task.id);
}
async function saveTask(tx, ctx, current, patch, actor, now2) {
  const chain = await newChain(tx, ctx, now2);
  const { task, changes } = await applyUpdate(tx, ctx, current, patch, actor, now2);
  chain.touched.add(task.id);
  await fireChanges(tx, chain, task, changes, 0);
  if (changes.some((c) => c.field === "completed" && c.to === true)) {
    await spawnSuccessor(tx, chain, await getTaskRow(tx, task.id), dateOf(now2), false);
  }
  await finishChain(tx, chain);
  return getTaskRow(tx, task.id);
}
async function deleteTask(tx, ctx, task) {
  const { rows } = await tx.query("SELECT id FROM tasks WHERE id = $1 OR parent_id = $1", [task.id]);
  await removeTask(tx, task);
  await publish(tx, { t: "tasks", team: ctx.teamId, project: ctx.id, ids: [], deleted: rows.map((r) => r.id) });
}

// src/server/schedule.ts
var DAY_MS = 864e5;
async function lapse(now2) {
  const cutoff = plus(now2, -config.limits.holdTimeoutMs);
  await transaction(async (tx) => {
    const holds = await tx.query(
      `DELETE FROM holds h USING tasks t, projects p WHERE h.task_id = t.id AND p.id = t.project_id AND h.expires_at <= $1
         RETURNING h.task_id, p.team_id`,
      [now2]
    );
    const gone = await tx.query(
      `DELETE FROM presence pr USING tasks t, projects p WHERE pr.task_id = t.id AND p.id = t.project_id
         AND pr.left_at IS NOT NULL AND pr.left_at <= $1 RETURNING pr.task_id, p.team_id`,
      [cutoff]
    );
    for (const row of holds.rows) await publish(tx, { t: "hold", team: row.team_id, task: row.task_id });
    for (const row of gone.rows) await publish(tx, { t: "presence", team: row.team_id, task: row.task_id });
  });
}
async function repeats(now2) {
  const { rows } = await pool.query(
    `SELECT id, project_id FROM tasks t WHERE NOT completed AND recurrence IS NOT NULL AND due_date < $1
       AND NOT EXISTS (SELECT 1 FROM claims WHERE key = 'successor:' || t.id) ORDER BY due_date, seq`,
    [dateOf(now2)]
  );
  for (const row of rows) {
    await transaction(async (tx) => {
      await lockProject(tx, row.project_id);
      const task = await getTaskRow(tx, row.id);
      if (task.completed) return;
      const chain = await newChain(tx, await loadProject(tx, row.project_id), now2);
      await spawnSuccessor(tx, chain, task, dateOf(now2), true);
      await finishChain(tx, chain);
    });
  }
}
async function dueDates(prev, now2) {
  const { rows } = await pool.query(
    `SELECT t.id, t.project_id FROM tasks t WHERE NOT t.completed AND t.due_date IS NOT NULL
       AND (t.due_date::timestamp AT TIME ZONE 'UTC') > $1 AND (t.due_date::timestamp AT TIME ZONE 'UTC') <= $2
       AND EXISTS (SELECT 1 FROM rules r WHERE r.project_id = t.project_id AND r.trigger->>'type' = 'due_date_arrives')
     ORDER BY t.due_date, t.seq`,
    [prev, now2]
  );
  for (const row of rows) {
    await transaction(async (tx) => {
      await lockProject(tx, row.project_id);
      const chain = await newChain(tx, await loadProject(tx, row.project_id), now2);
      await fireDue(tx, chain, await getTaskRow(tx, row.id));
      await finishChain(tx, chain);
    });
  }
}
function windowEnd(created) {
  const windowMs = config.limits.digestWindowMin * 6e4;
  const day = Math.floor(created.getTime() / DAY_MS) * DAY_MS;
  const index = Math.floor((created.getTime() - day) / windowMs);
  return Math.min(day + (index + 1) * windowMs, day + DAY_MS);
}
async function digests(prev, now2) {
  const { rows } = await pool.query(
    `SELECT i.person_id, i.text, i.created_at, p.email FROM inbox i JOIN people p ON p.id = i.person_id
       WHERE NOT i.read AND NOT i.archived AND i.created_at >= $1 AND i.created_at < $2 ORDER BY i.created_at, i.seq`,
    [plus(prev, -DAY_MS), now2]
  );
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const end = windowEnd(row.created_at);
    if (end <= prev.getTime() || end > now2.getTime()) continue;
    const key = `${row.person_id}:${end}`;
    const group = groups.get(key) ?? { personId: row.person_id, email: row.email, end, texts: [] };
    group.texts.push(row.text);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const key = `digest:${group.personId}:${group.end}`;
    if (!await claim(pool, key)) continue;
    try {
      await sendMail(group.email, `Everyweek: ${group.texts.length} unread in your inbox`, `${group.texts.join("\n")}
`);
    } catch {
      await pool.query("DELETE FROM claims WHERE key = $1", [key]);
    }
  }
}
async function runDueWork(prev, now2, firstWindowStart) {
  await lapse(now2);
  await repeats(now2);
  await dueDates(prev ?? firstWindowStart, now2);
  if (prev) await digests(prev, now2);
}

// src/server/seed.ts
import { randomUUID as randomUUID4 } from "node:crypto";
var BUILT_IN = ["assignee", "start", "due", "effort"];
async function seedWorld(tx, body, now2) {
  const ids = { people: {}, teams: {}, projects: {}, fields: {}, tasks: {}, rules: {}, goals: {}, forms: {}, approvals: {}, inbox: {} };
  const sections = {};
  const person = (key) => {
    const id = ids.people[key];
    if (!id) throw invalid({ person: `Unknown person ${key}` });
    return id;
  };
  for (const p of body.people ?? []) {
    ids.people[p.key] = randomUUID4();
    await tx.query(
      "INSERT INTO people (id, name, email, password_hash, verified, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [ids.people[p.key], p.name, p.email, hashPassword(p.password), p.verified === true, now2]
    );
  }
  const teamOfPerson = {};
  for (const t of body.teams ?? []) {
    ids.teams[t.key] = randomUUID4();
    await tx.query("INSERT INTO teams (id, name, join_code) VALUES ($1,$2,$3)", [ids.teams[t.key], t.name, t.joinCode ?? `JOIN-${randomUUID4().slice(0, 8)}`]);
    for (const key of /* @__PURE__ */ new Set([...t.members ?? [], ...t.coordinators ?? []])) {
      const role = (t.coordinators ?? []).includes(key) ? "coordinator" : "member";
      await tx.query("INSERT INTO memberships (team_id, person_id, role) VALUES ($1,$2,$3)", [ids.teams[t.key], person(key), role]);
      teamOfPerson[key] ??= ids.teams[t.key];
    }
  }
  for (const c of body.capacities ?? []) {
    await tx.query("INSERT INTO capacities (team_id, person_id, weekday, hours) VALUES ($1,$2,$3,$4)", [teamOfPerson[c.person], person(c.person), c.weekday, c.hours]);
  }
  const fieldIds = /* @__PURE__ */ new Map();
  for (const p of body.projects ?? []) {
    const projectId = ids.projects[p.key] = randomUUID4();
    await tx.query("INSERT INTO projects (id, team_id, name, created_at) VALUES ($1,$2,$3,$4)", [projectId, ids.teams[p.team], p.name, now2]);
    sections[p.key] = {};
    for (const [index, name] of p.sections.entries()) {
      sections[p.key][name] = randomUUID4();
      await tx.query("INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)", [sections[p.key][name], projectId, name, index + 1]);
    }
    const fieldByName2 = /* @__PURE__ */ new Map();
    const addField = async (key, name, type, options, formula) => {
      const id = randomUUID4();
      if (key) {
        ids.fields[key] = id;
        fieldIds.set(key, id);
      }
      fieldByName2.set(name, id);
      await tx.query(
        "INSERT INTO fields (id, project_id, name, type, options, formula, position) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, projectId, name, type, JSON.stringify(options), formula, fieldByName2.size]
      );
    };
    for (const f of p.fields ?? []) await addField(f.key, f.name, f.type, f.options ?? [], f.formula ?? null);
    const groupCounts = /* @__PURE__ */ new Map();
    for (const t of p.tasks ?? []) {
      const id = ids.tasks[t.key] = randomUUID4();
      const parentId = t.parent ? ids.tasks[t.parent] : null;
      const sectionId = sections[p.key][t.section];
      const group = parentId ?? sectionId;
      const position = t.position ?? (groupCounts.get(group) ?? 0) + 1;
      groupCounts.set(group, Math.max(groupCounts.get(group) ?? 0, position));
      const values = {};
      for (const [name, value] of Object.entries(t.values ?? {})) if (fieldByName2.has(name)) values[fieldByName2.get(name)] = value;
      await tx.query(
        `INSERT INTO tasks (id, project_id, name, description, section_id, position, parent_id, assignee_id, start_date, due_date, effort,
           completed, version, recurrence, values, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14,$15)`,
        [
          id,
          projectId,
          t.name,
          t.description ?? "",
          sectionId,
          position,
          parentId,
          t.assignee ? person(t.assignee) : null,
          t.start ?? null,
          t.due ?? null,
          t.effort ?? null,
          t.completed === true,
          t.recurrence ?? null,
          JSON.stringify(values),
          t.createdAt ?? now2
        ]
      );
    }
    for (const d of p.dependencies ?? []) {
      await tx.query("INSERT INTO dependencies (from_task, to_task) VALUES ($1,$2)", [ids.tasks[d.from], ids.tasks[d.to]]);
    }
    const fieldRef2 = (key) => key && !BUILT_IN.includes(key) ? fieldIds.get(key) ?? key : key;
    const optionValue = (field, value) => field === "assignee" && typeof value === "string" && ids.people[value] ? ids.people[value] : value;
    for (const [index, r] of (p.rules ?? []).entries()) {
      const id = ids.rules[r.key] = randomUUID4();
      const trigger = { ...r.trigger };
      if (trigger.field) trigger.field = fieldRef2(trigger.field);
      if (trigger.value !== void 0) trigger.value = optionValue(r.trigger.field, trigger.value);
      if (trigger.section) trigger.section = sections[p.key][trigger.section];
      const condition = r.condition ? { ...r.condition, field: fieldRef2(r.condition.field), value: optionValue(r.condition.field, r.condition.value) } : null;
      const action = { ...r.action };
      if (action.type === "set_field") {
        action.value = optionValue(action.target, action.value);
        action.target = fieldRef2(action.target);
      }
      if (action.type === "move_to_section") action.target = sections[p.key][action.target];
      if (action.type === "assign_to") action.target = ids.people[action.target] ?? action.target;
      await tx.query(
        "INSERT INTO rules (id, project_id, name, position, trigger, condition, action, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, projectId, r.name, r.position ?? index + 1, JSON.stringify(trigger), condition ? JSON.stringify(condition) : null, JSON.stringify(action), now2]
      );
    }
    for (const f of p.forms ?? []) {
      const id = ids.forms[f.key] = randomUUID4();
      await tx.query("INSERT INTO forms (id, project_id, slug, section_id, title) VALUES ($1,$2,$3,$4,$5)", [id, projectId, f.slug, sections[p.key][f.section], f.title]);
      if (!fieldByName2.has("Requested by")) await addField(null, "Requested by", "text", [], null);
    }
  }
  const goalIds = body.goals ?? [];
  for (const g of goalIds) ids.goals[g.key] = randomUUID4();
  for (const g of goalIds) {
    await tx.query(
      "INSERT INTO goals (id, team_id, name, weight, manual_value, owner_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [ids.goals[g.key], ids.teams[g.team], g.name, g.weight ?? 1, g.manual ?? 0, g.owner ? person(g.owner) : null]
    );
  }
  for (const g of goalIds) {
    if (g.parent) await tx.query("UPDATE goals SET parent_id = $2 WHERE id = $1", [ids.goals[g.key], ids.goals[g.parent]]);
    for (const link of g.projects ?? []) {
      await tx.query("INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,$3)", [ids.goals[g.key], ids.projects[link.project], link.weight ?? 1]);
    }
  }
  for (const a of body.approvals ?? []) {
    const id = ids.approvals[a.key] = randomUUID4();
    await tx.query(
      "INSERT INTO approvals (id, task_id, approver_id, requester_id, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, ids.tasks[a.task], person(a.approver), person(a.requester), a.status ?? "requested", now2]
    );
  }
  for (const i of body.inbox ?? []) {
    const id = ids.inbox[i.key] = randomUUID4();
    await tx.query(
      "INSERT INTO inbox (id, person_id, text, task_id, kind, read, created_at) VALUES ($1,$2,$3,$4,'note',$5,$6)",
      [id, person(i.person), i.text, i.task ? ids.tasks[i.task] : null, i.read === true, i.createdAt ?? now2]
    );
  }
  for (const h of body.history ?? []) {
    await tx.query("INSERT INTO history (task_id, text, created_at) VALUES ($1,$2,$3)", [ids.tasks[h.task], h.text, h.createdAt ?? now2]);
  }
  return { ...ids, sections };
}
async function seedStarter(tx, now2) {
  const password = "weekly-demo-1";
  const task = (key, name, extra = {}) => ({ key, name, section: "To do", assignee: "noor", ...extra });
  await seedWorld(tx, {
    people: [
      { key: "noor", name: "Noor Halvorsen", email: "noor@everyweek.example", password, verified: true },
      { key: "ilse", name: "Ilse Marchetti", email: "ilse@everyweek.example", password, verified: true },
      { key: "tomas", name: "Tomas Okonkwo", email: "tomas@everyweek.example", password, verified: true }
    ],
    teams: [{ key: "team", name: "Larder Street Kitchen", joinCode: "LARDER-2026", members: ["noor", "ilse", "tomas"], coordinators: ["noor"] }],
    capacities: [{ person: "noor", weekday: "fri", hours: 4 }],
    projects: [
      {
        key: "orders",
        team: "team",
        name: "Weekly orders",
        sections: ["To do", "Doing", "Review", "Done"],
        fields: [
          { key: "stage", name: "Stage", type: "single_select", options: ["Draft", "Ready", "Review"] },
          { key: "priority", name: "Priority", type: "single_select", options: ["Low", "Medium", "High"] },
          { key: "tags", name: "Tags", type: "multi_select", options: ["Fresh", "Dry", "Frozen"] },
          { key: "category", name: "Category", type: "single_select", options: ["Dry goods", "Fresh", "Equipment"] },
          { key: "rate", name: "Rate", type: "number" },
          { key: "extra", name: "Extra", type: "number" },
          { key: "cost", name: "Cost", type: "formula", formula: "{Effort} * {Rate}" }
        ],
        tasks: [
          task("a", "Order dry goods", { start: "2026-03-02", due: "2026-03-04", effort: 12 }),
          task("b", "Pack orders", { start: "2026-03-04", due: "2026-03-06", effort: 10 }),
          task("c", "Count freezer", { section: "Doing", start: "2026-03-06", due: "2026-03-09", effort: 5 }),
          task("d", "Weigh stock", { assignee: "ilse", due: "2026-03-02", effort: 2.5, values: { Rate: 40 }, recurrence: "Every week on Monday" })
        ],
        forms: [{ key: "form", slug: "supply-request", section: "To do", title: "Supply request" }]
      },
      {
        key: "upkeep",
        team: "team",
        name: "Machine upkeep",
        sections: ["To do", "Done"],
        tasks: [task("e", "Oil the slicer", { assignee: null }), task("f", "Replace saw blade", { assignee: null }), task("g", "Clean the mixer", { assignee: null })]
      }
    ],
    goals: [
      { key: "root", team: "team", name: "Run a steady year", owner: "noor" },
      { key: "kitchen", team: "team", name: "Kitchen runs on time", parent: "root", weight: 2, owner: "noor", projects: [{ project: "orders", weight: 3 }] },
      { key: "upkeep", team: "team", name: "Upkeep never lapses", parent: "root", weight: 1, owner: "noor", projects: [{ project: "upkeep", weight: 1 }] },
      { key: "suppliers", team: "team", name: "Suppliers confirmed", parent: "kitchen", weight: 1, manual: 40, owner: "noor" },
      { key: "parts", team: "team", name: "Spare parts stocked", parent: "upkeep", weight: 1, manual: 90, owner: "noor" }
    ],
    inbox: [{ key: "welcome", person: "noor", text: "Welcome to Everyweek" }]
  }, now2);
}

// src/server/state.ts
var state = { ready: false };
var RAW = /* @__PURE__ */ Symbol("raw response");
var NO_CONTENT = /* @__PURE__ */ Symbol("no content");

// src/server/access.ts
async function teamsOf(db, personId) {
  const { rows } = await db.query(
    "SELECT team_id, role FROM memberships WHERE person_id = $1",
    [personId]
  );
  return rows.map((r) => ({ teamId: r.team_id, role: r.role }));
}
async function roleIn(db, personId, teamId) {
  const { rows } = await db.query(
    "SELECT role FROM memberships WHERE person_id = $1 AND team_id = $2",
    [personId, teamId]
  );
  if (!rows.length) throw notFound();
  return rows[0].role;
}
async function projectTeam(db, personId, projectId) {
  const { rows } = await db.query(
    `SELECT p.team_id, m.role FROM projects p JOIN memberships m ON m.team_id = p.team_id AND m.person_id = $2 WHERE p.id = $1`,
    [projectId, personId]
  );
  if (!rows.length) throw notFound();
  return { teamId: rows[0].team_id, role: rows[0].role };
}
async function taskAccess(db, personId, taskId) {
  const { rows } = await db.query(
    `SELECT t.project_id, p.team_id, m.role FROM tasks t JOIN projects p ON p.id = t.project_id
       JOIN memberships m ON m.team_id = p.team_id AND m.person_id = $2 WHERE t.id = $1`,
    [taskId, personId]
  );
  if (!rows.length) throw notFound();
  return { projectId: rows[0].project_id, teamId: rows[0].team_id, role: rows[0].role };
}
function requireCoordinator(role) {
  if (role !== "coordinator") throw forbidden();
}
async function personName(db, personId) {
  const { rows } = await db.query("SELECT name FROM people WHERE id = $1", [personId]);
  return rows[0].name;
}

// src/server/routes/accounts.ts
import { randomUUID as randomUUID5 } from "node:crypto";
var COOKIE_AGE = 60 * 60 * 24 * 30;
function sessionCookie(token, maxAge = COOKIE_AGE) {
  return `everyweek_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
route("GET", "/api/health", async (ctx) => {
  if (!state.ready) return sendHealth(ctx, 503, "starting");
  return sendHealth(ctx, 200, await reachable() ? "ok" : "unavailable");
}, { open: true });
function sendHealth(ctx, status, value) {
  sendJson(ctx.res, status, { status: value });
  return RAW;
}
route("GET", "/api/config", async () => ({
  moveMs: config.limits.moveMs,
  progressMs: config.limits.progressMs,
  toastMs: config.limits.toastMs,
  holdTimeoutMs: config.limits.holdTimeoutMs
}), { open: true });
route("POST", "/api/signup", async (ctx) => {
  const body = fields(await readJson(ctx));
  const errors = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!name) errors.name = "Enter your name";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter an email address like name@example.com";
  if (password.length < 8) errors.password = "Use at least 8 characters";
  if (!errors.email) {
    const taken = await pool.query("SELECT 1 FROM people WHERE lower(email) = lower($1)", [email]);
    if (taken.rowCount) errors.email = "That email already has an account";
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID5();
  const code = newVerificationCode();
  const created = await pool.query(
    "INSERT INTO people (id, name, email, password_hash, verified, code, created_at) VALUES ($1,$2,$3,$4,false,$5,$6) ON CONFLICT DO NOTHING",
    [id, name, email, hashPassword(password), code, await now(pool)]
  );
  if (!created.rowCount) throw invalid({ email: "That email already has an account" });
  await sendMail(email, "Your Everyweek verification code", `Your Everyweek verification code is ${code}.
`).catch(() => void 0);
  return { id, email, verified: false };
}, { open: true, status: 201 });
route("POST", "/api/verify", async (ctx) => {
  const body = fields(await readJson(ctx));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const { rows } = await pool.query("SELECT id, code, verified FROM people WHERE lower(email) = lower($1)", [email]);
  if (!rows.length) throw notFound();
  if (!rows[0].verified && rows[0].code !== String(body.code ?? "").trim()) throw invalid({ code: "That code is not right" });
  await pool.query("UPDATE people SET verified = true, code = NULL WHERE id = $1", [rows[0].id]);
  return { verified: true };
}, { open: true });
route("POST", "/api/signin", async (ctx) => {
  const body = fields(await readJson(ctx));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const { rows } = await pool.query("SELECT id, name, email, password_hash FROM people WHERE lower(email) = lower($1)", [email]);
  if (!rows.length || !passwordMatches(password, rows[0].password_hash)) throw new ApiError(401, { error: "invalid_credentials" });
  const token = await startSession(pool, rows[0].id);
  ctx.res.setHeader("set-cookie", sessionCookie(token));
  return { id: rows[0].id, name: rows[0].name, email: rows[0].email };
}, { open: true });
route("POST", "/api/signout", async (ctx) => {
  await pool.query("DELETE FROM sessions WHERE token = $1", [sessionToken(ctx.req)]);
  ctx.res.setHeader("set-cookie", sessionCookie("", 0));
  return NO_CONTENT;
}, { open: true });
route("GET", "/api/me", async (ctx) => {
  const { rows } = await pool.query("SELECT id, name, email, verified FROM people WHERE id = $1", [ctx.personId]);
  const memberships = await teamsOf(pool, ctx.personId);
  const names = await pool.query("SELECT id, name FROM teams WHERE id = ANY($1)", [memberships.map((m) => m.teamId)]);
  return {
    ...rows[0],
    teams: memberships.map((m) => ({ id: m.teamId, name: names.rows.find((n) => n.id === m.teamId)?.name, role: m.role }))
  };
});
route("POST", "/api/teams/join", async (ctx) => {
  const body = fields(await readJson(ctx));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const team = await pool.query("SELECT id, name FROM teams WHERE join_code = $1", [code]);
  if (!team.rows.length) throw notFound();
  const person = await pool.query("SELECT verified FROM people WHERE id = $1", [ctx.personId]);
  if (!person.rows[0].verified) throw new ApiError(403, { error: "not_verified" });
  await pool.query("INSERT INTO memberships (team_id, person_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [team.rows[0].id, ctx.personId]);
  return { teamId: team.rows[0].id, name: team.rows[0].name };
});

// src/server/routes/projects.ts
import { randomUUID as randomUUID6 } from "node:crypto";
async function projectProgress(db, projectId) {
  const { rows } = await db.query(
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE completed)::int AS done FROM tasks WHERE project_id = $1 AND parent_id IS NULL",
    [projectId]
  );
  return rows[0].total ? rows[0].done * 100 / rows[0].total : 0;
}
async function projectJson(projectId) {
  const ctx = await loadProject(pool, projectId);
  const [members, project] = await Promise.all([
    pool.query("SELECT p.id, p.name, p.email FROM people p JOIN memberships m ON m.person_id = p.id WHERE m.team_id = $1 ORDER BY p.name", [ctx.teamId]),
    pool.query("SELECT trace FROM projects WHERE id = $1", [projectId])
  ]);
  return {
    id: ctx.id,
    name: ctx.name,
    teamId: ctx.teamId,
    progress: await projectProgress(pool, projectId),
    members: members.rows,
    sections: ctx.sections,
    fields: ctx.fields.map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options, formula: f.formula })),
    trace: project.rows[0].trace
  };
}
route("GET", "/api/teams/:teamId/projects", async (ctx) => {
  await roleIn(pool, ctx.personId, ctx.params.teamId);
  const { rows } = await pool.query("SELECT id, name FROM projects WHERE team_id = $1 ORDER BY created_at, name", [ctx.params.teamId]);
  const projects = await Promise.all(rows.map(async (p) => ({ id: p.id, name: p.name, progress: await projectProgress(pool, p.id) })));
  return { projects };
});
route("POST", "/api/teams/:teamId/projects", async (ctx) => {
  const role = await roleIn(pool, ctx.personId, ctx.params.teamId);
  const raw = await readJson(ctx);
  requireCoordinator(role);
  const body = fields(raw);
  const errors = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sections = Array.isArray(body.sections) ? [...new Set(body.sections.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean))] : [];
  if (!name) errors.name = "Enter a project name";
  if (!sections.length) errors.sections = "Add at least one section";
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID6();
  await transaction(async (tx) => {
    await tx.query("INSERT INTO projects (id, team_id, name, created_at) VALUES ($1,$2,$3,$4)", [id, ctx.params.teamId, name, await now(tx)]);
    for (const [index, section] of sections.entries()) {
      await tx.query("INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)", [randomUUID6(), id, section, index + 1]);
    }
    await publish(tx, { t: "structure", team: ctx.params.teamId, project: id });
  });
  return projectJson(id);
}, { status: 201 });
route("GET", "/api/projects/:id", async (ctx) => {
  await projectTeam(pool, ctx.personId, ctx.params.id);
  return projectJson(ctx.params.id);
});
route("POST", "/api/projects/:id/sections", async (ctx) => {
  const { teamId } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sections = (await loadProject(pool, ctx.params.id)).sections;
  if (!name) throw invalid({ name: "Enter a section name" });
  if (sections.some((s) => s.name === name)) throw invalid({ name: "A section with that name already exists" });
  const section = { id: randomUUID6(), name, position: sections.length + 1 };
  await transaction(async (tx) => {
    await lockProject(tx, ctx.params.id);
    const current = (await loadProject(tx, ctx.params.id)).sections;
    if (current.some((s) => s.name === name)) throw invalid({ name: "A section with that name already exists" });
    section.position = current.length + 1;
    await tx.query("INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)", [section.id, ctx.params.id, name, section.position]);
    await publish(tx, { t: "structure", team: teamId, project: ctx.params.id });
  });
  return section;
}, { status: 201 });
route("DELETE", "/api/sections/:id", async (ctx) => {
  const found = await pool.query("SELECT project_id FROM sections WHERE id = $1", [ctx.params.id]);
  if (!found.rows.length) throw notFound();
  const projectId = found.rows[0].project_id;
  const { teamId } = await projectTeam(pool, ctx.personId, projectId);
  await readJson(ctx);
  await transaction(async (tx) => {
    await lockProject(tx, projectId);
    const sections = (await loadProject(tx, projectId)).sections;
    if (sections.length <= 1) throw invalid({ section: "A project needs at least one section" });
    await tx.query("DELETE FROM sections WHERE id = $1", [ctx.params.id]);
    const left = sections.filter((s) => s.id !== ctx.params.id);
    for (const [index, section] of left.entries()) await tx.query("UPDATE sections SET position = $2 WHERE id = $1", [section.id, index + 1]);
    await publish(tx, { t: "structure", team: teamId, project: projectId });
  });
  return NO_CONTENT;
});
var FIELD_TYPES = ["text", "number", "date", "single_select", "multi_select", "formula"];
function formulaProblem(formula, name, existing) {
  try {
    validateFormula(formula, name, existing, config.limits.formulaMaxChars);
    return null;
  } catch (error) {
    if (error instanceof FormulaError) return error.message;
    throw error;
  }
}
var takenName = (existing, name, exceptId) => BUILT_IN_FIELDS.includes(name) || existing.some((f) => f.name === name && f.id !== exceptId);
route("POST", "/api/projects/:id/fields", async (ctx) => {
  const { teamId } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const project = await loadProject(pool, ctx.params.id);
  const errors = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.name = "Enter a field name";
  else if (takenName(project.fields, name)) errors.name = "A field with that name already exists";
  const type = typeof body.type === "string" && FIELD_TYPES.includes(body.type) ? body.type : null;
  if (!type) errors.type = "Choose a field type";
  const options = Array.isArray(body.options) ? body.options.filter((o) => typeof o === "string" && o.trim() !== "").map((o) => o.trim()) : [];
  let formula = null;
  if (type === "formula") {
    formula = typeof body.formula === "string" ? body.formula : "";
    const problem = formulaProblem(formula, name, project.fields);
    if (problem) errors.formula = problem;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID6();
  await transaction(async (tx) => {
    await lockProject(tx, ctx.params.id);
    const existing = (await loadProject(tx, ctx.params.id)).fields;
    if (takenName(existing, name)) throw invalid({ name: "A field with that name already exists" });
    await tx.query(
      "INSERT INTO fields (id, project_id, name, type, options, formula, position) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, ctx.params.id, name, type, JSON.stringify(options), formula, existing.length + 1]
    );
    await publish(tx, { t: "structure", team: teamId, project: ctx.params.id });
  });
  return { id, name, type, options, formula };
}, { status: 201 });
async function fieldProject(personId, fieldId) {
  const found = await pool.query("SELECT project_id FROM fields WHERE id = $1", [fieldId]);
  if (!found.rows.length) throw notFound();
  const projectId = found.rows[0].project_id;
  const { teamId } = await projectTeam(pool, personId, projectId);
  return { projectId, teamId };
}
route("PATCH", "/api/fields/:id", async (ctx) => {
  const { projectId, teamId } = await fieldProject(ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const project = await loadProject(pool, projectId);
  const current = project.fields.find((f) => f.id === ctx.params.id);
  const errors = {};
  let name = current.name;
  if ("name" in body) {
    name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) errors.name = "Enter a field name";
    else if (takenName(project.fields, name, current.id)) errors.name = "A field with that name already exists";
  }
  let formula = current.formula;
  if ("formula" in body) {
    formula = typeof body.formula === "string" ? body.formula : "";
    const problem = formulaProblem(formula, name, project.fields);
    if (problem) errors.formula = problem;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  await transaction(async (tx) => {
    await lockProject(tx, projectId);
    if (name !== current.name && takenName((await loadProject(tx, projectId)).fields, name, current.id)) {
      throw invalid({ name: "A field with that name already exists" });
    }
    await tx.query("UPDATE fields SET name = $2, formula = $3 WHERE id = $1", [current.id, name, current.type === "formula" ? formula : null]);
    if (name !== current.name) {
      for (const other of project.fields.filter((f) => f.type === "formula" && f.formula?.includes(`{${current.name}}`))) {
        await tx.query("UPDATE fields SET formula = $2 WHERE id = $1", [other.id, renameReference(other.formula, current.name, name)]);
      }
    }
    await publish(tx, { t: "structure", team: teamId, project: projectId });
  });
  return { id: current.id, name, type: current.type, options: current.options, formula: current.type === "formula" ? formula : null };
});
route("DELETE", "/api/fields/:id", async (ctx) => {
  const { projectId, teamId } = await fieldProject(ctx.personId, ctx.params.id);
  await readJson(ctx);
  await transaction(async (tx) => {
    await lockProject(tx, projectId);
    await tx.query("DELETE FROM fields WHERE id = $1", [ctx.params.id]);
    await tx.query("UPDATE tasks SET values = values - $2 WHERE project_id = $1", [projectId, ctx.params.id]);
    const left = await tx.query("SELECT id FROM fields WHERE project_id = $1 ORDER BY position", [projectId]);
    for (const [index, row] of left.rows.entries()) await tx.query("UPDATE fields SET position = $2 WHERE id = $1", [row.id, index + 1]);
    await publish(tx, { t: "structure", team: teamId, project: projectId });
  });
  return NO_CONTENT;
});

// src/server/routes/tasks.ts
import { randomUUID as randomUUID7 } from "node:crypto";
async function blocksOf(db, projectId) {
  const { rows } = await db.query(
    "SELECT d.from_task, d.to_task FROM dependencies d JOIN tasks t ON t.id = d.from_task WHERE t.project_id = $1",
    [projectId]
  );
  const map = /* @__PURE__ */ new Map();
  for (const r of rows) map.set(r.from_task, [...map.get(r.from_task) ?? [], r.to_task]);
  return map;
}
route("GET", "/api/projects/:id/tasks", async (ctx) => {
  await projectTeam(pool, ctx.personId, ctx.params.id);
  const project = await loadProject(pool, ctx.params.id);
  const all = await listTasks(pool, project);
  const size = config.limits.pageSize;
  const page = Math.max(1, Math.floor(Number(ctx.url.searchParams.get("page"))) || 1);
  const [instant, blocks] = await Promise.all([now(pool), blocksOf(pool, project.id)]);
  return {
    tasks: all.slice((page - 1) * size, page * size).map((t) => ({ ...taskJson(t, project, instant), blocks: blocks.get(t.id) ?? [] })),
    page,
    pageSize: size,
    total: all.length
  };
});
route("POST", "/api/projects/:id/tasks", async (ctx) => {
  await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const project = await loadProject(pool, ctx.params.id);
  const patch = parsePatch(body, project, true);
  const row = await transaction(async (tx) => {
    await lockProject(tx, project.id);
    const instant = await now(tx);
    const actor = { name: await personName(tx, ctx.personId) };
    return createTask(tx, project, {
      name: patch.name,
      description: patch.description,
      sectionId: patch.sectionId ?? project.sections[0].id,
      parentId: patch.parentId,
      position: patch.position,
      assigneeId: patch.assigneeId,
      start: patch.start,
      due: patch.due,
      effort: patch.effort,
      recurrence: patch.recurrence,
      values: patch.values
    }, actor, instant);
  });
  return { ...taskJson(row, project, await now(pool)), blocks: [] };
}, { status: 201 });
async function holdsOf(db, taskId, instant) {
  const { rows } = await db.query(
    "SELECT h.field, p.id, p.name, h.expires_at FROM holds h JOIN people p ON p.id = h.holder_id WHERE h.task_id = $1 AND h.expires_at > $2",
    [taskId, instant]
  );
  return rows.map((r) => ({ field: r.field, holder: { id: r.id, name: r.name }, expiresAt: isoInstant(r.expires_at) }));
}
async function viewersOf(db, taskId, instant) {
  const cutoff = plus(instant, -config.limits.holdTimeoutMs);
  const { rows } = await db.query(
    `SELECT p.id, p.name, min(pr.joined_at) AS joined FROM presence pr JOIN people p ON p.id = pr.person_id
       WHERE pr.task_id = $1 AND (pr.left_at IS NULL OR pr.left_at > $2) GROUP BY p.id, p.name ORDER BY joined, p.name`,
    [taskId, cutoff]
  );
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
async function latestApproval(db, taskId) {
  const { rows } = await db.query("SELECT id, status, approver_id, requester_id FROM approvals WHERE task_id = $1 ORDER BY seq DESC LIMIT 1", [taskId]);
  return rows.length ? { id: rows[0].id, status: rows[0].status, approverId: rows[0].approver_id, requesterId: rows[0].requester_id } : { id: null, status: null, approverId: null, requesterId: null };
}
route("GET", "/api/tasks/:id", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const project = await loadProject(pool, access.projectId);
  const task = await getTaskRow(pool, ctx.params.id);
  const instant = await now(pool);
  const [attachments, blocks, blockedBy, history, viewing, holds, approval] = await Promise.all([
    pool.query("SELECT id, name, size FROM attachments WHERE task_id = $1 ORDER BY created_at", [task.id]),
    pool.query("SELECT to_task FROM dependencies WHERE from_task = $1", [task.id]),
    pool.query("SELECT from_task FROM dependencies WHERE to_task = $1", [task.id]),
    pool.query("SELECT text, created_at FROM history WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100", [task.id]),
    viewersOf(pool, task.id, instant),
    holdsOf(pool, task.id, instant),
    latestApproval(pool, task.id)
  ]);
  return {
    ...taskJson(task, project, instant),
    attachments: attachments.rows,
    approval,
    blocks: blocks.rows.map((r) => r.to_task),
    blockedBy: blockedBy.rows.map((r) => r.from_task),
    history: history.rows.map((r) => ({ text: r.text, createdAt: isoInstant(r.created_at) })),
    viewing,
    holds
  };
});
route("PATCH", "/api/tasks/:id", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const project = await loadProject(pool, access.projectId);
  const result = await transaction(async (tx) => {
    await lockProject(tx, project.id);
    const current = await getTaskRow(tx, ctx.params.id, true);
    const instant = await now(tx);
    const body = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : null;
    if (body) {
      const touched = ["name", "description"].filter((k) => k in body);
      if (touched.length) {
        const other = (await holdsOf(tx, current.id, instant)).find((h) => touched.includes(h.field) && h.holder.id !== ctx.personId);
        if (other) throw new ApiError(409, { error: "held_by_other", holder: other.holder.name });
      }
      if (typeof body.version === "number" && body.version !== current.version) {
        throw new ApiError(409, { error: "stale_task", latest: current.version });
      }
    }
    const given = fields(raw);
    if (typeof given.version !== "number") throw invalid({ version: "Send the version you are editing" });
    const { version: _version, ...rest } = given;
    const patch = parsePatch(rest, project, false);
    const saved = await saveTask(tx, project, current, patch, { name: await personName(tx, ctx.personId) }, instant);
    const released = ["name", "description"].filter((k) => k in rest);
    if (released.length) {
      await tx.query("DELETE FROM holds WHERE task_id = $1 AND holder_id = $2 AND field = ANY($3)", [saved.id, ctx.personId, released]);
      await publish(tx, { t: "hold", team: project.teamId, task: saved.id });
    }
    return { saved, instant };
  });
  const blocks = await blocksOf(pool, project.id);
  return { ...taskJson(result.saved, project, result.instant), blocks: blocks.get(result.saved.id) ?? [] };
});
route("DELETE", "/api/tasks/:id", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  await readJson(ctx);
  const project = await loadProject(pool, access.projectId);
  await transaction(async (tx) => {
    await lockProject(tx, project.id);
    await deleteTask(tx, project, await getTaskRow(tx, ctx.params.id, true));
  });
  return NO_CONTENT;
});
route("POST", "/api/tasks/:id/dependencies", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const target2 = typeof body.blocks === "string" ? await pool.query("SELECT id FROM tasks WHERE id = $1 AND project_id = $2", [body.blocks, access.projectId]) : null;
  if (!target2?.rows.length) throw invalid({ blocks: "Choose a task of this project" });
  await transaction(async (tx) => {
    await lockProject(tx, access.projectId);
    const loop = await tx.query(
      `WITH RECURSIVE reach(id) AS (SELECT $2::text UNION SELECT d.to_task FROM dependencies d JOIN reach r ON d.from_task = r.id)
       SELECT 1 FROM reach WHERE id = $1`,
      [ctx.params.id, body.blocks]
    );
    if (loop.rowCount) throw invalid({ blocks: "A task can't block itself or create a loop" });
    await tx.query("INSERT INTO dependencies (from_task, to_task) VALUES ($1,$2) ON CONFLICT DO NOTHING", [ctx.params.id, body.blocks]);
    await publish(tx, { t: "structure", team: access.teamId, project: access.projectId });
  });
  return { from: ctx.params.id, to: body.blocks };
}, { status: 201 });
var HOLD_FIELDS = ["name", "description"];
route("POST", "/api/tasks/:id/hold", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const body = fields(await readJson(ctx));
  return transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hold:${ctx.params.id}`]);
    const instant = await now(tx);
    const held = (await holdsOf(tx, ctx.params.id, instant)).find((h) => h.field === body.field && h.holder.id !== ctx.personId);
    if (held) throw new ApiError(409, { error: "held_by_other", holder: held.holder.name });
    if (typeof body.field !== "string" || !HOLD_FIELDS.includes(body.field)) throw invalid({ field: "Choose name or description" });
    const expires = plus(instant, config.limits.holdTimeoutMs);
    await tx.query(
      `INSERT INTO holds (task_id, field, holder_id, expires_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (task_id, field) DO UPDATE SET holder_id = $3, expires_at = $4`,
      [ctx.params.id, body.field, ctx.personId, expires]
    );
    await publish(tx, { t: "hold", team: access.teamId, task: ctx.params.id });
    return { field: body.field, holder: { id: ctx.personId, name: await personName(tx, ctx.personId) }, expiresAt: expires.toISOString() };
  });
});
route("DELETE", "/api/tasks/:id/hold", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const body = fields(await readJson(ctx));
  await transaction(async (tx) => {
    await tx.query("DELETE FROM holds WHERE task_id = $1 AND holder_id = $2 AND field = $3", [ctx.params.id, ctx.personId, body.field]);
    await publish(tx, { t: "hold", team: access.teamId, task: ctx.params.id });
  });
  return NO_CONTENT;
});
route("GET", "/api/tasks/:id/rule-runs", async (ctx) => {
  await taskAccess(pool, ctx.personId, ctx.params.id);
  const { rows } = await pool.query("SELECT id, depth, summary, detail, created_at FROM rule_runs WHERE task_id = $1 ORDER BY id", [ctx.params.id]);
  return { runs: rows.map((r) => ({ id: String(r.id), depth: r.depth, summary: r.summary, detail: r.detail, createdAt: isoInstant(r.created_at) })) };
});
route("GET", "/api/projects/:id/rules", async (ctx) => {
  await projectTeam(pool, ctx.personId, ctx.params.id);
  const { rows } = await pool.query("SELECT id, name, position, trigger, condition, action FROM rules WHERE project_id = $1 ORDER BY position, seq", [ctx.params.id]);
  return { rules: rows };
});
route("POST", "/api/projects/:id/rules", async (ctx) => {
  const { teamId, role } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  requireCoordinator(role);
  const body = fields(raw);
  const project = await loadProject(pool, ctx.params.id);
  const { name, trigger, condition, action } = parseRule(body, project);
  const id = randomUUID7();
  const position = (await pool.query("SELECT coalesce(max(position), 0)::int + 1 AS next FROM rules WHERE project_id = $1", [project.id])).rows[0].next;
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO rules (id, project_id, name, position, trigger, condition, action, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id, project.id, name, position, JSON.stringify(trigger), condition ? JSON.stringify(condition) : null, JSON.stringify(action), await now(tx)]
    );
    await publish(tx, { t: "rules", team: teamId, project: project.id });
  });
  return { id, name, position, trigger, condition, action };
}, { status: 201 });

// src/server/routes/team.ts
import { randomUUID as randomUUID9 } from "node:crypto";

// src/server/goals.ts
function rollup(goals) {
  const progress = /* @__PURE__ */ new Map();
  const compute = (goal) => {
    const known = progress.get(goal.id);
    if (known !== void 0) return known;
    const children = goals.filter((g) => g.parentId === goal.id);
    const parts = [
      ...children.map((child) => ({ weight: child.weight, value: compute(child) })),
      ...goal.projects.map((link) => ({ weight: link.weight, value: link.progress }))
    ];
    const weights = parts.reduce((sum, part) => sum + part.weight, 0);
    const value = parts.length ? parts.reduce((sum, part) => sum + part.weight * part.value, 0) / weights : goal.manualValue;
    progress.set(goal.id, value);
    return value;
  };
  goals.forEach(compute);
  return progress;
}
function displayPercent(progress) {
  return Math.floor(progress + 0.5);
}

// src/server/approvals.ts
import { randomUUID as randomUUID8 } from "node:crypto";
var DECISIONS = /* @__PURE__ */ new Map([
  ["approve", { status: "approved", verb: "approved" }],
  ["request_changes", { status: "changes_requested", verb: "requested changes on" }],
  ["reject", { status: "rejected", verb: "rejected" }]
]);
async function requestApproval(tx, where, taskId, requesterId, body) {
  await lockProject(tx, where.projectId);
  const latest = await tx.query("SELECT status FROM approvals WHERE task_id = $1 ORDER BY seq DESC LIMIT 1", [taskId]);
  if (latest.rows[0]?.status === "requested") throw new ApiError(409, { error: "already_requested" });
  const member = typeof body.approverId === "string" ? await tx.query("SELECT 1 FROM memberships WHERE team_id = $1 AND person_id = $2", [where.teamId, body.approverId]) : null;
  if (!member?.rowCount || typeof body.approverId !== "string") throw invalid({ approverId: "Choose a member of this team" });
  const id = randomUUID8();
  const instant = await now(tx);
  const task = await getTaskRow(tx, taskId);
  await tx.query(
    "INSERT INTO approvals (id, task_id, approver_id, requester_id, status, created_at) VALUES ($1,$2,$3,$4,'requested',$5)",
    [id, taskId, body.approverId, requesterId, instant]
  );
  await addInboxItem(tx, { personId: body.approverId, text: `Approval requested: ${task.name}`, taskId, kind: "approval_request", approvalId: id }, instant);
  await addHistory(tx, taskId, `${await personName(tx, requesterId)} requested approval`, instant);
  await publish(tx, { t: "approval", team: where.teamId, project: where.projectId, task: taskId });
  return { status: "requested", approverId: body.approverId };
}
async function decide(tx, where, taskId, approverId, raw, readBody) {
  await lockProject(tx, where.projectId);
  const latest = await tx.query(
    "SELECT id, status, approver_id, requester_id FROM approvals WHERE task_id = $1 ORDER BY seq DESC LIMIT 1 FOR UPDATE",
    [taskId]
  );
  const approval = latest.rows[0];
  if (!approval) throw notFound();
  if (approval.approver_id !== approverId) throw forbidden();
  if (approval.status !== "requested") throw new ApiError(409, { error: "already_decided" });
  const body = readBody(raw);
  const errors = {};
  const decision = typeof body.decision === "string" ? DECISIONS.get(body.decision) : void 0;
  if (!decision) errors.decision = "Choose a decision";
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (comment.length > 500) errors.comment = "Comment must be 500 characters or fewer";
  else if (decision && decision.status !== "approved" && !comment) errors.comment = "Add a comment for this decision";
  if (!decision || Object.keys(errors).length) throw invalid(errors);
  const instant = await now(tx);
  await tx.query("UPDATE approvals SET status = $2, comment = $3 WHERE id = $1", [approval.id, decision.status, comment || null]);
  const task = await getTaskRow(tx, taskId);
  const approver = await personName(tx, approverId);
  await addInboxItem(tx, { personId: approval.requester_id, text: `${approver} ${decision.verb} ${task.name}`, taskId, kind: "decision" }, instant);
  await addHistory(tx, taskId, `${approver} ${decision.verb} this task`, instant);
  const chain = await newChain(tx, await loadProject(tx, where.projectId), instant);
  chain.touched.add(taskId);
  await fireApproval(tx, chain, task);
  await finishChain(tx, chain);
  await publish(tx, { t: "approval", team: where.teamId, project: where.projectId, task: taskId });
  return { status: decision.status };
}

// src/server/workload.ts
var DEFAULT_CAPACITY = 8;
function workingDays(task) {
  if (task.completed || !task.assigneeId || task.effort === null || !task.due) return [];
  const first = task.start ?? task.due;
  if (first > task.due) return [];
  const span = daysBetween(first, task.due);
  return Array.from({ length: span + 1 }, (_, i) => addDays(first, i)).filter(isWorkingDay);
}
function gridDays(from) {
  const monday = mondayOf(from);
  return Array.from({ length: 14 }, (_, i) => addDays(monday, i)).filter(isWorkingDay);
}
function shownHours(value) {
  return String(Math.floor(value * 10 + 0.5 + 1e-9) / 10);
}
function buildCells(days, personId, tasks, capacityOf) {
  const mine = tasks.filter((t) => t.assigneeId === personId).map((task) => ({ task, spread: workingDays(task) }));
  return days.map((date) => {
    const here = mine.filter((entry) => entry.spread.includes(date));
    const total = here.reduce((sum, { task, spread }) => sum + task.effort / spread.length, 0);
    const capacity = capacityOf(personId, weekdayOf(date));
    const over = total > capacity;
    return {
      date,
      total,
      capacity,
      over,
      text: `${shownHours(total)} of ${shownHours(capacity)} h${over ? ", over capacity" : ""}`,
      tasks: here.map(({ task }) => ({ id: task.id, name: task.name }))
    };
  });
}

// src/server/routes/team.ts
async function goalsOf(teamId) {
  const [goals, links] = await Promise.all([
    pool.query("SELECT id, name, parent_id, weight, manual_value, owner_id FROM goals WHERE team_id = $1 ORDER BY name", [teamId]),
    pool.query(
      `SELECT gp.goal_id, gp.project_id, gp.weight, p.name FROM goal_projects gp JOIN projects p ON p.id = gp.project_id
         JOIN goals g ON g.id = gp.goal_id WHERE g.team_id = $1`,
      [teamId]
    )
  ]);
  const progressOf = /* @__PURE__ */ new Map();
  for (const link of links.rows) if (!progressOf.has(link.project_id)) progressOf.set(link.project_id, await projectProgress(pool, link.project_id));
  const nodes = goals.rows.map((g) => ({
    id: g.id,
    parentId: g.parent_id,
    weight: g.weight,
    manualValue: g.manual_value,
    projects: links.rows.filter((l) => l.goal_id === g.id).map((l) => ({ projectId: l.project_id, weight: l.weight, progress: progressOf.get(l.project_id) }))
  }));
  const totals = rollup(nodes);
  return goals.rows.map((g) => ({
    id: g.id,
    name: g.name,
    parentId: g.parent_id,
    weight: g.weight,
    manualValue: g.manual_value,
    ownerId: g.owner_id,
    progress: totals.get(g.id),
    percent: displayPercent(totals.get(g.id)),
    projects: links.rows.filter((l) => l.goal_id === g.id).map((l) => ({ projectId: l.project_id, name: l.name, weight: l.weight, progress: progressOf.get(l.project_id) }))
  }));
}
function goalErrors(body, create) {
  const errors = {};
  if (("name" in body || create) && (typeof body.name !== "string" || !body.name.trim())) errors.name = "Enter a goal name";
  if ("weight" in body && (typeof body.weight !== "number" || !Number.isInteger(body.weight) || body.weight < 1 || body.weight > 10)) {
    errors.weight = "Weight must be a whole number from 1 to 10";
  }
  if ("manualValue" in body && (typeof body.manualValue !== "number" || body.manualValue < 0 || body.manualValue > 100)) {
    errors.manualValue = "Manual value must be from 0 to 100";
  }
  return errors;
}
route("GET", "/api/teams/:teamId/goals", async (ctx) => {
  await roleIn(pool, ctx.personId, ctx.params.teamId);
  return { goals: await goalsOf(ctx.params.teamId) };
});
route("POST", "/api/teams/:teamId/goals", async (ctx) => {
  await roleIn(pool, ctx.personId, ctx.params.teamId);
  const body = fields(await readJson(ctx));
  const errors = goalErrors(body, true);
  let parentId = null;
  if (body.parentId !== void 0 && body.parentId !== null) {
    const parent = typeof body.parentId === "string" ? await pool.query("SELECT 1 FROM goals WHERE id = $1 AND team_id = $2", [body.parentId, ctx.params.teamId]) : null;
    if (!parent?.rowCount) errors.parentId = "Choose a goal of this team";
    else parentId = body.parentId;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID9();
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO goals (id, team_id, name, parent_id, weight, manual_value, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, ctx.params.teamId, body.name.trim(), parentId, body.weight ?? 1, body.manualValue ?? 0, ctx.personId]
    );
    await publish(tx, { t: "goals", team: ctx.params.teamId });
  });
  return (await goalsOf(ctx.params.teamId)).find((g) => g.id === id);
}, { status: 201 });
async function goalAccess(personId, goalId) {
  const { rows } = await pool.query("SELECT team_id, owner_id FROM goals WHERE id = $1", [goalId]);
  if (!rows.length) throw notFound();
  const role = await roleIn(pool, personId, rows[0].team_id);
  return { teamId: rows[0].team_id, mayEdit: role === "coordinator" || rows[0].owner_id === personId };
}
route("PATCH", "/api/goals/:id", async (ctx) => {
  const { teamId, mayEdit } = await goalAccess(ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  if (!mayEdit) throw forbidden();
  const body = fields(raw);
  const errors = goalErrors(body, false);
  if (Object.keys(errors).length) throw invalid(errors);
  await transaction(async (tx) => {
    if ("name" in body) await tx.query("UPDATE goals SET name = $2 WHERE id = $1", [ctx.params.id, body.name.trim()]);
    if ("weight" in body) await tx.query("UPDATE goals SET weight = $2 WHERE id = $1", [ctx.params.id, body.weight]);
    if ("manualValue" in body) await tx.query("UPDATE goals SET manual_value = $2 WHERE id = $1", [ctx.params.id, body.manualValue]);
    await publish(tx, { t: "goals", team: teamId });
  });
  return (await goalsOf(teamId)).find((g) => g.id === ctx.params.id);
});
route("POST", "/api/goals/:id/projects", async (ctx) => {
  const { teamId, mayEdit } = await goalAccess(ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  if (!mayEdit) throw forbidden();
  const body = fields(raw);
  const project = typeof body.projectId === "string" ? await pool.query("SELECT 1 FROM projects WHERE id = $1 AND team_id = $2", [body.projectId, teamId]) : null;
  const errors = {};
  if (!project?.rowCount) errors.projectId = "Choose a project of this team";
  if (body.weight !== void 0) Object.assign(errors, goalErrors({ weight: body.weight }, false));
  if (Object.keys(errors).length) throw invalid(errors);
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,$3) ON CONFLICT (goal_id, project_id) DO UPDATE SET weight = $3",
      [ctx.params.id, body.projectId, body.weight ?? 1]
    );
    await publish(tx, { t: "goals", team: teamId });
  });
  return { goalId: ctx.params.id, projectId: body.projectId, weight: body.weight ?? 1 };
}, { status: 201 });
route("GET", "/api/teams/:teamId/workload", async (ctx) => {
  await roleIn(pool, ctx.personId, ctx.params.teamId);
  const asked = ctx.url.searchParams.get("from");
  const from = asked && isIsoDate(asked) ? asked : dateOf(await now(pool));
  const days = gridDays(from);
  const [people, capacities, tasks] = await Promise.all([
    pool.query("SELECT p.id, p.name FROM people p JOIN memberships m ON m.person_id = p.id WHERE m.team_id = $1 ORDER BY p.name", [ctx.params.teamId]),
    pool.query("SELECT person_id, weekday, hours FROM capacities WHERE team_id = $1", [ctx.params.teamId]),
    pool.query(
      `SELECT t.id, t.name, t.assignee_id, t.start_date, t.due_date, t.effort, t.completed FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE p.team_id = $1`,
      [ctx.params.teamId]
    )
  ]);
  const work = tasks.rows.map((t) => ({
    id: t.id,
    name: t.name,
    assigneeId: t.assignee_id,
    start: t.start_date,
    due: t.due_date,
    effort: t.effort,
    completed: t.completed
  }));
  const capacityOf = (personId, weekday) => capacities.rows.find((c) => c.person_id === personId && c.weekday === weekday)?.hours ?? DEFAULT_CAPACITY;
  const team = await pool.query("SELECT name FROM teams WHERE id = $1", [ctx.params.teamId]);
  return {
    from,
    days,
    teamName: team.rows[0].name,
    people: people.rows.map((p) => ({ id: p.id, name: p.name, cells: buildCells(days, p.id, work, capacityOf) }))
  };
});
var WEEKDAYS2 = ["mon", "tue", "wed", "thu", "fri"];
route("PUT", "/api/teams/:teamId/capacities", async (ctx) => {
  const role = await roleIn(pool, ctx.personId, ctx.params.teamId);
  const raw = await readJson(ctx);
  requireCoordinator(role);
  const body = fields(raw);
  const errors = {};
  const member = typeof body.personId === "string" ? await pool.query("SELECT 1 FROM memberships WHERE team_id = $1 AND person_id = $2", [ctx.params.teamId, body.personId]) : null;
  if (!member?.rowCount) errors.personId = "Choose a member of this team";
  if (typeof body.weekday !== "string" || !WEEKDAYS2.includes(body.weekday)) errors.weekday = "Choose a weekday from mon to fri";
  if (typeof body.hours !== "number" || body.hours < 0 || body.hours > 24) errors.hours = "Hours must be from 0 to 24";
  if (Object.keys(errors).length) throw invalid(errors);
  await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO capacities (team_id, person_id, weekday, hours) VALUES ($1,$2,$3,$4)
       ON CONFLICT (team_id, person_id, weekday) DO UPDATE SET hours = $4`,
      [ctx.params.teamId, body.personId, body.weekday, body.hours]
    );
    await publish(tx, { t: "workload", team: ctx.params.teamId });
  });
  return { personId: body.personId, weekday: body.weekday, hours: body.hours };
});
route("POST", "/api/projects/:id/forms", async (ctx) => {
  const { teamId, role } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  requireCoordinator(role);
  const body = fields(raw);
  const project = await loadProject(pool, ctx.params.id);
  const errors = {};
  if (typeof body.slug !== "string" || !/^[a-z0-9-]+$/.test(body.slug)) errors.slug = "Use lowercase letters, digits and hyphens";
  else if ((await pool.query("SELECT 1 FROM forms WHERE slug = $1", [body.slug])).rowCount) errors.slug = "That form address is taken";
  if (typeof body.section !== "string" || !project.sections.some((s) => s.id === body.section)) errors.section = "Choose a section of this project";
  if (typeof body.title !== "string" || !body.title.trim()) errors.title = "Enter a form title";
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID9();
  await transaction(async (tx) => {
    await lockProject(tx, project.id);
    const taken = await tx.query(
      "INSERT INTO forms (id, project_id, slug, section_id, title) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slug) DO NOTHING",
      [id, project.id, body.slug, body.section, body.title.trim()]
    );
    if (!taken.rowCount) throw invalid({ slug: "That form address is taken" });
    const current = await loadProject(tx, project.id);
    if (!fieldByName(current, "Requested by")) {
      await tx.query("INSERT INTO fields (id, project_id, name, type, options, position) VALUES ($1,$2,'Requested by','text','[]',$3)", [randomUUID9(), project.id, current.fields.length + 1]);
    }
    await publish(tx, { t: "structure", team: teamId, project: project.id });
  });
  return { id, slug: body.slug, section: body.section, title: body.title.trim() };
}, { status: 201 });
async function formBySlug(slug) {
  const { rows } = await pool.query("SELECT id, project_id, section_id, title FROM forms WHERE slug = $1", [slug]);
  if (!rows.length) throw notFound();
  return rows[0];
}
route("GET", "/api/forms/:slug", async (ctx) => {
  const form = await formBySlug(ctx.params.slug);
  const category = fieldByName(await loadProject(pool, form.project_id), "Category");
  return { title: form.title, categories: category?.options ?? [] };
}, { open: true });
route("POST", "/api/forms/:slug/submissions", async (ctx) => {
  const form = await formBySlug(ctx.params.slug);
  const body = fields(await readJson(ctx));
  const project = await loadProject(pool, form.project_id);
  const errors = {};
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) errors.title = "Enter a request title";
  else if (title.length > 120) errors.title = "Request title must be 120 characters or fewer";
  const instant = await now(pool);
  if (typeof body.neededBy !== "string" || !isIsoDate(body.neededBy) || body.neededBy < dateOf(instant)) errors.neededBy = "Enter a date today or later";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter an email address like name@example.com";
  const category = fieldByName(project, "Category");
  const chosen = typeof body.category === "string" && body.category !== "" ? body.category : null;
  if (chosen !== null && !category?.options.includes(chosen)) errors.category = "Choose a category from the list";
  if (Object.keys(errors).length) throw invalid(errors);
  return transaction(async (tx) => {
    await lockProject(tx, project.id);
    const counter = await tx.query("UPDATE teams SET request_counter = request_counter + 1 WHERE id = $1 RETURNING request_counter", [project.teamId]);
    const values = {};
    const requestedBy = fieldByName(project, "Requested by");
    if (requestedBy) values[requestedBy.id] = email;
    if (category && chosen) values[category.id] = chosen;
    const task = await createTask(tx, project, {
      name: title,
      description: typeof body.details === "string" ? body.details : "",
      sectionId: form.section_id,
      due: body.neededBy,
      values
    }, { name: `Request form (${email})` }, await now(tx));
    return { reference: `REQ-${String(counter.rows[0].request_counter).padStart(4, "0")}`, taskId: task.id };
  });
}, { open: true, status: 201 });
route("POST", "/api/tasks/:id/approval", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  return transaction((tx) => requestApproval(tx, access, ctx.params.id, ctx.personId, fields(raw)));
}, { status: 201 });
route("POST", "/api/tasks/:id/decision", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  return transaction((tx) => decide(tx, access, ctx.params.id, ctx.personId, raw, fields));
});
route("GET", "/api/inbox", async (ctx) => {
  const { rows } = await pool.query(
    `SELECT i.*, (i.kind = 'approval_request' AND a.status = 'requested' AND a.approver_id = i.person_id) AS pending
       FROM inbox i LEFT JOIN approvals a ON a.id = i.approval_id
       WHERE i.person_id = $1 AND NOT i.archived ORDER BY i.created_at DESC, i.seq DESC LIMIT 300`,
    [ctx.personId]
  );
  return { unread: rows.filter((r) => !r.read).length, items: rows.map((r) => inboxJson(r, r.pending === true)) };
});
route("PATCH", "/api/inbox/:id", async (ctx) => {
  const found = await pool.query("SELECT id FROM inbox WHERE id = $1 AND person_id = $2", [ctx.params.id, ctx.personId]);
  if (!found.rows.length) throw notFound();
  const body = fields(await readJson(ctx));
  if (typeof body.read !== "boolean" && body.archived !== true) throw invalid({ read: "Send read true or false, or archived true" });
  await transaction(async (tx) => {
    if (typeof body.read === "boolean") await tx.query("UPDATE inbox SET read = $2 WHERE id = $1", [ctx.params.id, body.read]);
    if (body.archived === true) await tx.query("UPDATE inbox SET archived = true WHERE id = $1", [ctx.params.id]);
    await publish(tx, { t: "inbox", person: ctx.personId });
  });
  const { rows } = await pool.query("SELECT * FROM inbox WHERE id = $1", [ctx.params.id]);
  return inboxJson(rows[0], false);
});

// src/server/routes/storage.ts
import { randomUUID as randomUUID10 } from "node:crypto";

// src/server/csv.ts
var FORMULA_START = /^[=+\-@\t\r]/;
function csvCell(value) {
  if (value === null || value === void 0) return "";
  let text = String(value);
  if (typeof value !== "number" && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csvText(rows) {
  return rows.map((row) => `${row.map(csvCell).join(",")}\r
`).join("");
}

// src/server/multipart.ts
function parseMultipart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) return [];
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts = [];
  let cursor = body.indexOf(delimiter);
  while (cursor >= 0) {
    const start = cursor + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next < 0) break;
    const chunk = body.subarray(start + 2, next - 2);
    const split = chunk.indexOf("\r\n\r\n");
    if (split >= 0) {
      const headers = chunk.subarray(0, split).toString("utf8");
      const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
      const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
      const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "application/octet-stream";
      if (name !== void 0) parts.push({ name, filename, contentType: type, data: chunk.subarray(split + 4) });
    }
    cursor = next;
  }
  return parts;
}

// src/server/routes/storage.ts
var TOO_LARGE2 = () => new ApiError(413, { error: "file_too_large" }, { "x-upload-limit-bytes": String(config.limits.uploadMaxBytes) });
function safeName(name) {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f]/g, "_").trim() || "file";
}
route("POST", "/api/tasks/:id/attachments", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const cap = config.limits.uploadMaxBytes;
  const raw = await readRaw(ctx.req, cap + 65536);
  if (!Buffer.isBuffer(raw)) throw TOO_LARGE2();
  const parts = parseMultipart(raw, String(ctx.req.headers["content-type"] ?? ""));
  if (parts.some((p) => p.data.length > cap)) throw TOO_LARGE2();
  if (!await reachable()) throw storageUnavailable();
  const file = parts.find((p) => p.name === "file" && p.filename);
  if (!file) throw invalid({ file: "Choose a file to attach" });
  const id = randomUUID10();
  const name = safeName(file.filename);
  const key = `attachments/${ctx.params.id}/${id}/${name}`;
  await putObject(key, file.data, file.contentType);
  await transaction(async (tx) => {
    const instant = await now(tx);
    await tx.query(
      "INSERT INTO attachments (id, task_id, name, size, content_type, object_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, ctx.params.id, name, file.data.length, file.contentType, key, instant]
    );
    const who = (await tx.query("SELECT name FROM people WHERE id = $1", [ctx.personId])).rows[0].name;
    await addHistory(tx, ctx.params.id, `${who} changed Attachments`, instant);
    await publish(tx, { t: "tasks", team: access.teamId, project: access.projectId, ids: [ctx.params.id], runs: [] });
  });
  return { id, name, size: file.data.length, contentType: file.contentType };
}, { status: 201 });
route("GET", "/api/attachments/:id", async (ctx) => {
  const { rows } = await pool.query("SELECT task_id, name, content_type, object_key FROM attachments WHERE id = $1", [ctx.params.id]);
  if (!rows.length) throw notFound();
  await taskAccess(pool, ctx.personId, rows[0].task_id);
  const bytes = await getObject(rows[0].object_key);
  ctx.res.writeHead(200, {
    "content-type": rows[0].content_type,
    "content-length": bytes.length,
    "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].name)}`
  });
  ctx.res.end(bytes);
  return RAW;
});
async function buildFile(projectId, format2) {
  const project = await loadProject(pool, projectId);
  const tasks = await listTasks(pool, project);
  const people = await pool.query("SELECT id, email FROM people");
  const emails = new Map(people.rows.map((p) => [p.id, p.email]));
  const sectionName2 = new Map(project.sections.map((s) => [s.id, s.name]));
  if (format2 === "csv") {
    return csvText([
      ["id", "name", "section", "assignee_email", "start", "due", "effort_hours", "completed", "parent_id"],
      ...tasks.map((t) => [t.id, t.name, sectionName2.get(t.sectionId), t.assigneeId ? emails.get(t.assigneeId) : "", t.start, t.due, t.effort, String(t.completed), t.parentId])
    ]);
  }
  return JSON.stringify({
    schema: "everyweek.project/1",
    project: { id: project.id, name: project.name },
    sections: project.sections.map((s) => ({ id: s.id, name: s.name, position: s.position })),
    tasks: tasks.map((t) => ({
      id: t.id,
      name: t.name,
      section: t.sectionId,
      assignee_email: t.assigneeId ? emails.get(t.assigneeId) ?? null : null,
      start: t.start,
      due: t.due,
      effort_hours: t.effort,
      completed: t.completed,
      parent_id: t.parentId
    }))
  });
}
async function runFileJob(id, projectId, format2, teamId, personId) {
  const key = `exports/${projectId}/${id}.${format2}`;
  let status = "ready";
  try {
    await putObject(key, Buffer.from(await buildFile(projectId, format2), "utf8"), format2 === "csv" ? "text/csv" : "application/json");
  } catch {
    status = "failed";
  }
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE files SET status = $2, object_key = $3, error = $4 WHERE id = $1",
      [id, status, status === "ready" ? key : null, status === "failed" ? "storage_unavailable" : null]
    );
    await publish(tx, { t: "file", person: personId, team: teamId, file: id, status });
  });
}
route("POST", "/api/projects/:id/files", async (ctx) => {
  const { teamId } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const body = fields(await readJson(ctx));
  if (body.format !== "csv" && body.format !== "json") throw invalid({ format: "Choose csv or json" });
  const id = randomUUID10();
  await pool.query(
    "INSERT INTO files (id, project_id, format, status, requested_by, created_at) VALUES ($1,$2,$3,'preparing',$4,$5)",
    [id, ctx.params.id, body.format, ctx.personId, await now(pool)]
  );
  void runFileJob(id, ctx.params.id, body.format, teamId, ctx.personId);
  return { id, status: "preparing" };
}, { status: 202 });
async function fileAccess(personId, fileId) {
  const { rows } = await pool.query("SELECT id, project_id, format, status, object_key, error FROM files WHERE id = $1", [fileId]);
  if (!rows.length) throw notFound();
  await projectTeam(pool, personId, rows[0].project_id);
  return rows[0];
}
route("GET", "/api/files/:id", async (ctx) => {
  const file = await fileAccess(ctx.personId, ctx.params.id);
  return {
    id: file.id,
    status: file.status,
    format: file.format,
    ...file.status === "ready" ? { url: `/api/files/${file.id}/download` } : {},
    ...file.error ? { error: file.error } : {}
  };
});
route("GET", "/api/files/:id/download", async (ctx) => {
  const file = await fileAccess(ctx.personId, ctx.params.id);
  if (file.status !== "ready") throw notFound();
  const bytes = await getObject(file.object_key);
  ctx.res.writeHead(200, {
    "content-type": file.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
    "content-length": bytes.length,
    "x-content-type-options": "nosniff",
    "content-disposition": `attachment; filename="project.${file.format}"`
  });
  ctx.res.end(bytes);
  return RAW;
});

// src/server/routes/live.ts
import { randomUUID as randomUUID11 } from "node:crypto";
route("GET", "/api/events", async (ctx) => {
  const teams = (await teamsOf(pool, ctx.personId)).map((m) => m.teamId);
  const taskId = ctx.url.searchParams.get("task");
  const access = taskId ? await taskAccess(pool, ctx.personId, taskId) : null;
  const unsubscribe = subscribe(ctx.res, ctx.personId, teams);
  const connection = randomUUID11();
  if (taskId && access) {
    await transaction(async (tx) => {
      await tx.query("INSERT INTO presence (connection, task_id, person_id, joined_at) VALUES ($1,$2,$3,$4)", [connection, taskId, ctx.personId, await now(tx)]);
      await publish(tx, { t: "presence", team: access.teamId, task: taskId });
    });
  }
  ctx.req.on("close", () => {
    unsubscribe();
    if (taskId && access) {
      void transaction(async (tx) => {
        await tx.query("UPDATE presence SET left_at = $2 WHERE connection = $1", [connection, await now(tx)]);
        await publish(tx, { t: "presence", team: access.teamId, task: taskId });
      });
    }
  });
  return RAW;
});

// src/server/routes/grading.ts
function gradingOnly(ctx) {
  if (!config.grading || ctx.req.headers["x-everyweek-grading"] !== "1") throw notFound();
}
route("POST", "/grading/seed", async (ctx) => {
  gradingOnly(ctx);
  const body = fields(await readJson(ctx, config.seedBodyBytes));
  return transaction(async (tx) => seedWorld(tx, body, await now(tx)));
}, { open: true, status: 201 });
route("POST", "/grading/clock", async (ctx) => {
  gradingOnly(ctx);
  const body = fields(await readJson(ctx));
  const next = typeof body.now === "string" ? parseInstant(body.now) : null;
  if (!next) throw invalid({ now: "Send an ISO time like 2026-03-02T09:00:00Z" });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7002)");
    const stored = await client.query("SELECT now FROM clock WHERE id = 1");
    const previous = stored.rows.length ? stored.rows[0].now : null;
    await client.query("INSERT INTO clock (id, now) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET now = $1", [next]);
    await runDueWork(previous, next, previous ?? realNow());
  } finally {
    await client.query("SELECT pg_advisory_unlock(7002)");
    client.release();
  }
  return { now: isoInstant(next) };
}, { open: true });

// src/server/server.ts
var publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};
async function serveStatic(pathname, res) {
  const extension = path.extname(pathname);
  const relative = extension ? pathname : "/index.html";
  const file = path.normalize(path.join(publicDir, relative));
  if (!file.startsWith(publicDir) || extension && !CONTENT_TYPES[extension]) return void sendJson(res, 404, { error: "not_found" });
  try {
    const bytes = await readFile(file);
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      "content-length": bytes.length,
      "cache-control": extension === ".woff2" ? "public, max-age=86400" : "no-cache",
      "x-content-type-options": "nosniff"
    });
    res.end(bytes);
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}
async function handle(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const isApi = url.pathname.startsWith("/api/") || url.pathname.startsWith("/grading/");
  if (!isApi) {
    if (req.method !== "GET" && req.method !== "HEAD") return void sendJson(res, 404, { error: "not_found" });
    return serveStatic(url.pathname, res);
  }
  try {
    const found = findRoute(req.method ?? "GET", url.pathname);
    if (!found) throw notFound();
    const personId = await personForToken(pool, sessionToken(req));
    if (!personId && !found.route.open) throw unauthenticated();
    const ctx = { req, res, url, params: found.params, personId: personId ?? "" };
    const result = await found.route.handler(ctx);
    if (result === RAW) return;
    if (result === NO_CONTENT) return sendNoContent(res);
    sendJson(res, found.route.status, result);
  } catch (error) {
    if (res.headersSent) return void res.end();
    if (error instanceof ApiError) return sendJson(res, error.status, error.body, error.headers);
    if (error instanceof StorageUnavailable) return sendJson(res, 503, { error: "storage_unavailable" });
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}
`);
    sendJson(res, 500, { error: "server_error" });
  }
}
async function boot() {
  for (; ; ) {
    try {
      await applySchema();
      await transaction(async (tx) => {
        await tx.query("SELECT pg_advisory_xact_lock(7003)");
        const people = await tx.query("SELECT 1 FROM people LIMIT 1");
        if (!people.rowCount) await seedStarter(tx, await now(tx));
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
  }
  await ensureBucket();
  await listen();
  state.ready = true;
}
var server = createServer((req, res) => void handle(req, res));
server.keepAliveTimeout = 65e3;
server.listen(config.port, "0.0.0.0");
setInterval(heartbeat, 15e3).unref();
process.on("unhandledRejection", (reason) => process.stderr.write(`${String(reason)}
`));
if (!config.grading) {
  let lastTick = realNow();
  setInterval(() => {
    if (!state.ready) return;
    const current = realNow();
    const previous = lastTick;
    lastTick = current;
    void runDueWork(previous, current, previous).catch(() => void 0);
  }, config.dueTickMs).unref();
}
var stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
void boot();
