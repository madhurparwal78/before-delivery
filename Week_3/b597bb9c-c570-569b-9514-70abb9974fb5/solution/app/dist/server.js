// server/index.ts
import http from "node:http";

// shared/timecode.ts
var two = (n) => String(n).padStart(2, "0");
function timecode(rate, frame2) {
  const seconds = Math.floor(frame2 / rate.nominal);
  return `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}:${two(frame2 % rate.nominal)}`;
}
function srtTime(ms) {
  const hours = Math.floor(ms / 36e5);
  const rest = ms % 36e5;
  return `${two(hours)}:${two(Math.floor(rest / 6e4))}:${two(Math.floor(rest / 1e3) % 60)},${String(rest % 1e3).padStart(3, "0")}`;
}

// shared/copy.ts
var ERRORS = {
  unauthenticated: { status: 401, copy: () => "Sign in to continue." },
  bad_credentials: { status: 401, copy: () => "That email and password do not match." },
  not_found: { status: 404, copy: () => "Nothing here. It may have been removed or you may not have access." },
  method_not_allowed: { status: 405, copy: () => "This address does not accept that request." },
  unsupported_media_type: { status: 415, copy: (p) => `Send this request as ${p.expected}.` },
  too_large: { status: 413, copy: (p) => `This request is over ${p.limit} bytes.` },
  forbidden: { status: 403, copy: () => "Your role on this project cannot do that." },
  validation: { status: 422, copy: () => "Check the highlighted fields." },
  conflict: { status: 412, copy: (p) => `${p.winner} changed ${p.clip} first. Your change to it was not saved.` },
  blocked: { status: 409, copy: (p) => `${p.clip} cannot move: ${p.reason}.` },
  row_locked: { status: 409, copy: (p) => `${p.row} is locked.` },
  group_blocked: { status: 409, copy: (p) => `The group cannot move: ${p.member} ${p.reason}.` },
  undo_blocked: { status: 409, copy: (p) => `Undo would overlap ${p.clip} on ${p.row}.` },
  undo_missing: { status: 409, copy: (p) => `Undo needs ${p.clip}, which was removed.` },
  nothing_to_undo: { status: 409, copy: () => "Nothing to undo." },
  nothing_to_redo: { status: 409, copy: () => "Nothing to redo." },
  cut_name_taken: { status: 409, copy: (p) => `A cut called ${p.cut} already exists.` },
  media_in_use: { status: 409, copy: (p) => `${p.file} is used in ${p.projects}.` },
  upload_incomplete: { status: 409, copy: (p) => `Chunks still missing: ${p.missing}.` },
  upload_refused: { status: 422, copy: (p) => `Gatecut could not use ${p.file}: ${p.reason}.` },
  allowance_exceeded: {
    status: 409,
    copy: (p) => `Allowance reached: export minutes ${p.minutes} of ${p.minutes_allowance} \xB7 storage ${p.gb} of ${p.gb_allowance} GB.`
  },
  export_finished: { status: 409, copy: (p) => `This export already ended as ${p.state}.` },
  export_not_ready: { status: 409, copy: () => "The manifest is ready once the export is done." },
  link_expired: { status: 410, copy: (p) => `This review link has expired. Ask ${p.owner} for a new one.` },
  link_revoked: { status: 410, copy: (p) => `This review link was turned off. Ask ${p.owner} for a new one.` },
  rate_limited: {
    status: 429,
    copy: (p) => `This read token is over 30 requests in 10 seconds. Try again in ${p.seconds} seconds.`
  },
  storage_unavailable: {
    status: 503,
    copy: () => "Media storage is unreachable. Uploads and exports are paused; nothing was saved."
  },
  internal: { status: 500, copy: () => "Something went wrong on our side." },
  queue_unavailable: {
    status: 503,
    copy: () => "The export queue is unreachable. No export was started and no minutes were used."
  }
};
function errorCopy(code, params = {}) {
  return ERRORS[code].copy(params);
}
var FIELD_ERRORS = {
  title: "Give the project a title of 1 to 80 characters.",
  frame_rate: "Choose a frame rate from the list.",
  aspect_ratio: "Choose an aspect ratio from the list.",
  cutName: "Name the cut in 1 to 60 characters.",
  reviewerName: "Add your name in 1 to 60 characters.",
  body: "Notes are 1 to 2,000 characters.",
  mentions: "A note can mention at most 5 people.",
  text: "Captions are 1 or 2 lines of at most 42 characters each.",
  q: "Search is limited to 8 words and 200 characters.",
  limit: "Page size must be 1 to 100.",
  cursor: "This cursor is not valid.",
  file_name: "File names are 1 to 120 characters with no slashes, control characters or leading dot.",
  email: "No Gatecut account uses that email.",
  expires_in_seconds: "Links last 10 to 2,592,000 seconds.",
  other: "That value is not allowed here."
};
var mentionCopy = (handle) => `No one on this project is called @${handle}.`;
var SRT_COPY = {
  cues: "This SRT file has more than 5,000 cues.",
  line: (n) => `Line ${n} is longer than 42 characters.`,
  lines: (n) => `Cue ${n} has more than 2 text lines.`,
  time: (n) => `Cue ${n} has a malformed time line.`,
  order: (n) => `Cue ${n} ends before it starts.`,
  short: (n) => `Cue ${n} is shorter than one frame.`,
  overlap: (n) => `Cue ${n} overlaps the cue before it.`,
  utf8: "This file is not UTF-8 text."
};
var UPLOAD_REASONS = {
  type: "unknown file type",
  mp4: "MP4 header is damaged",
  wav: "WAV header is damaged",
  png: "PNG header is damaged",
  checksum: "checksum does not match",
  replaceType: "replacement must be the same type",
  replaceShort: (project) => `replacement is shorter than its use in ${project}`
};
var BLOCKER = {
  inTheWay: (clip) => `${clip} is in the way`,
  sourceStart: "the source starts there",
  sourceEnd: "the source ends there",
  targetRow: "the target row is not free",
  newLength: "the new length does not fit",
  locked: (row) => `${row} is locked`,
  timelineStart: "the timeline starts there"
};
function gigabytes(bytes) {
  const tenths = Math.floor((bytes * 10 + 5e8) / 1e9);
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
}
function allowanceText(a) {
  return `Export minutes ${a.export_minutes_used} of ${a.export_minutes_allowance} \xB7 storage ${gigabytes(a.storage_bytes_used)} of ${gigabytes(a.storage_bytes_allowance)} GB`;
}

// server/config.ts
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
function integer(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0 || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
}
function loadConfig() {
  const port = integer("APP_PUBLIC_PORT", 4173);
  return {
    port,
    publicUrl: required("APP_PUBLIC_URL").replace(/\/$/, ""),
    mailFrom: required("MAIL_FROM"),
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      pathStyle: process.env["S3_FORCE_PATH_STYLE"] !== "false",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY")
    },
    valkeyUrl: required("VALKEY_URL"),
    amqpUrl: required("AMQP_URL"),
    smtp: { host: required("SMTP_HOST"), port: integer("SMTP_PORT", 25) },
    mailGroupSeconds: integer("MAIL_GROUP_SECONDS", 60),
    outboxRetrySeconds: integer("OUTBOX_RETRY_SECONDS", 10),
    manifestLinkSeconds: integer("MANIFEST_LINK_SECONDS", 900),
    exportQueue: process.env["EXPORT_QUEUE"] || "gatecut.exports",
    exportStepMs: integer("EXPORT_STEP_MS", 400),
    exportMinuteAllowance: integer("EXPORT_MINUTE_ALLOWANCE", 600),
    storageAllowanceBytes: integer("STORAGE_ALLOWANCE_BYTES", 1e11)
  };
}
var config = loadConfig();

// server/db.ts
import pg from "pg";

// server/schema.ts
var SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, handle text NOT NULL UNIQUE,
  password_hash text NOT NULL, is_owner boolean NOT NULL DEFAULT false, seq bigserial
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES people(id), availability text NOT NULL,
  carried_storage_bytes bigint NOT NULL, opening_minutes int NOT NULL, opening_month text NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY, title text NOT NULL, agency text NOT NULL, description text NOT NULL,
  frame_rate text NOT NULL, aspect_ratio text NOT NULL, time_unit text NOT NULL DEFAULT 'frames',
  version int NOT NULL DEFAULT 1, position bigserial, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role text NOT NULL, seq bigserial, PRIMARY KEY (project_id, person_id)
);
CREATE TABLE IF NOT EXISTS rows (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL, kind text NOT NULL, position int NOT NULL, locked boolean NOT NULL DEFAULT false,
  srt_eol text NOT NULL DEFAULT E'\\n', srt_bom boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS media (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL, folder text NOT NULL, bytes bigint NOT NULL,
  sha256 text NOT NULL UNIQUE, width int, height int, duration_seconds numeric, sample_rate int,
  src_num bigint NOT NULL, src_den bigint NOT NULL, words text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), seq bigserial
);
CREATE TABLE IF NOT EXISTS clips (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_id text NOT NULL, name text NOT NULL, kind text NOT NULL, media_id text REFERENCES media(id),
  start_frame int NOT NULL DEFAULT 0, end_frame int NOT NULL DEFAULT 0,
  source_in int NOT NULL DEFAULT 0, source_out int NOT NULL DEFAULT 0, speed_percent int NOT NULL DEFAULT 100,
  hidden boolean NOT NULL DEFAULT false, group_id text, text text, text_colour text, box_colour text,
  font_weight int, keyframes jsonb NOT NULL DEFAULT '{}', base jsonb NOT NULL DEFAULT '{}',
  legacy jsonb, seq bigserial
);
CREATE INDEX IF NOT EXISTS clips_project ON clips (project_id, seq);
CREATE TABLE IF NOT EXISTS captions (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_id text NOT NULL, start_frame int NOT NULL DEFAULT 0, end_frame int NOT NULL DEFAULT 0, text text NOT NULL,
  orig_start_ms int, orig_end_ms int, legacy jsonb, seq bigserial
);
CREATE INDEX IF NOT EXISTS captions_row ON captions (project_id, row_id, start_frame);
CREATE TABLE IF NOT EXISTS markers (
  id bigserial PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  frame int NOT NULL DEFAULT 0, label text NOT NULL DEFAULT '', legacy numeric
);
CREATE TABLE IF NOT EXISTS ops (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version int NOT NULL,
  op_id text NOT NULL, person_id text NOT NULL, type text NOT NULL, summary jsonb NOT NULL,
  changes jsonb NOT NULL, removed jsonb NOT NULL, stopped jsonb, touched text[] NOT NULL,
  forward jsonb, inverse jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, version), UNIQUE (project_id, person_id, op_id)
);
CREATE TABLE IF NOT EXISTS undo_entries (
  id bigserial PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id text NOT NULL, op_version int NOT NULL, stack text NOT NULL
);
CREATE INDEX IF NOT EXISTS undo_person ON undo_entries (project_id, person_id, stack, id);
CREATE TABLE IF NOT EXISTS cuts (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL, version int NOT NULL, total_frames int NOT NULL, shared boolean NOT NULL DEFAULT false,
  snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), seq bigserial,
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS approvals (
  id bigserial PRIMARY KEY, cut_id text NOT NULL REFERENCES cuts(id) ON DELETE CASCADE,
  name text NOT NULL, at timestamptz NOT NULL DEFAULT now(), UNIQUE (cut_id, name)
);
CREATE TABLE IF NOT EXISTS review_links (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cut_id text NOT NULL REFERENCES cuts(id), token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), seq bigserial
);
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id text, author_name text NOT NULL, body text NOT NULL, visibility text NOT NULL,
  parent_id text, cut_id text, pin_frame int NOT NULL DEFAULT 0, pin_row_id text, pin_clip_id text,
  pin_offset int, mentions jsonb NOT NULL DEFAULT '[]', legacy numeric,
  created_at timestamptz NOT NULL DEFAULT now(), seq bigserial
);
CREATE INDEX IF NOT EXISTS comments_project ON comments (project_id, seq);
CREATE TABLE IF NOT EXISTS comment_drafts (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, person_id text NOT NULL,
  body text NOT NULL, frame int NOT NULL DEFAULT 0, row_id text, clip_id text, cut_id text,
  visibility text NOT NULL DEFAULT 'team', parent_id text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, person_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY, person_id text NOT NULL, project_id text NOT NULL,
  author_name text NOT NULL, frame int NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), outbox_id text
);
CREATE TABLE IF NOT EXISTS kits (
  id text PRIMARY KEY, name text NOT NULL, text_colour text NOT NULL, box_colour text NOT NULL,
  font_weight int NOT NULL, seq bigserial
);
CREATE TABLE IF NOT EXISTS tokens (
  id text PRIMARY KEY, name text NOT NULL, token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
CREATE TABLE IF NOT EXISTS uploads (
  id text PRIMARY KEY, person_id text NOT NULL, file_name text NOT NULL, folder text NOT NULL,
  bytes bigint NOT NULL, sha256 text NOT NULL, replaces text, chunks int NOT NULL,
  received int[] NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(), seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS uploads_open ON uploads (person_id, sha256) WHERE state IN ('open','receiving');
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cut_id text NOT NULL REFERENCES cuts(id), size int NOT NULL, state text NOT NULL DEFAULT 'queued',
  progress int NOT NULL DEFAULT 0, minutes int NOT NULL, requested_by text NOT NULL,
  manifest_checksum text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  finished_version int, seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS exports_live ON exports (cut_id, size) WHERE state IN ('queued','running','done');
CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY, to_email text NOT NULL, subject text NOT NULL, body text NOT NULL,
  state text NOT NULL DEFAULT 'waiting', attempts int NOT NULL DEFAULT 0, claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, seq bigserial
);
`;

// server/db.ts
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));
var pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", () => void 0);
async function query(sql, params = [], db = pool) {
  const result = await db.query(sql, params);
  return result.rows;
}
async function one(sql, params = [], db = pool) {
  return (await query(sql, params, db))[0];
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
var MIGRATION_LOCK = 727274;
async function migrate(seed2) {
  const deadline = Date.now() + 6e4;
  for (; ; ) {
    try {
      await tx(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK]);
        await client.query(SCHEMA);
        await seed2(client);
      });
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
  }
}

// server/errors.ts
var AppError = class extends Error {
  constructor(code, params = {}, extra = {}, headers = {}) {
    super(errorCopy(code, params));
    this.code = code;
    this.params = params;
    this.extra = extra;
    this.headers = headers;
  }
  code;
  params;
  extra;
  headers;
  get status() {
    return ERRORS[this.code].status;
  }
  body() {
    return { error: this.code, message: this.message, ...this.extra };
  }
};
function invalid(errors) {
  return new AppError("validation", {}, { errors });
}
function notFound() {
  return new AppError("not_found");
}
function forbidden() {
  return new AppError("forbidden");
}

// server/live.ts
import { WebSocketServer } from "ws";

// server/access.ts
async function roleOf(projectId, actor) {
  const project = await one("SELECT 1 FROM projects WHERE id = $1", [projectId]);
  if (!project) return null;
  if (actor.is_owner) return "owner";
  const member = await one("SELECT role FROM members WHERE project_id = $1 AND person_id = $2", [projectId, actor.id]);
  return member?.role ?? null;
}
async function requireRole(projectId, actor, allowed) {
  const role = await roleOf(projectId, actor);
  if (!role) throw notFound();
  if (!allowed.includes(role)) throw forbidden();
  return role;
}

// server/auth.ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
var SESSION_COOKIE = "gatecut_session";
function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`;
}
function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
function readCookie(header) {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}
async function sessionFromCookie(header) {
  const sessionId = readCookie(header);
  if (!sessionId) return null;
  const person = await one(
    "SELECT p.id, p.name, p.email, p.handle, p.is_owner FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.id = $1",
    [sessionId]
  );
  return person ? { sessionId, actor: person } : null;
}
async function signIn(email, password) {
  const row = typeof email === "string" && typeof password === "string" ? await one(
    "SELECT id, name, email, handle, is_owner, password_hash FROM people WHERE lower(email) = lower($1)",
    [email.trim()]
  ) : void 0;
  if (!row || typeof password !== "string" || !passwordMatches(password, row.password_hash)) throw new AppError("bad_credentials");
  const sessionId = randomBytes(32).toString("hex");
  await query("INSERT INTO sessions (id, person_id) VALUES ($1, $2)", [sessionId, row.id]);
  const { password_hash: _hash, ...person } = row;
  return { sessionId, actor: person };
}
async function signOut(sessionId) {
  await query("DELETE FROM sessions WHERE id = $1", [sessionId]);
  hub.closeSession(sessionId);
}
function sessionCookie(sessionId) {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`;
}
var clearedCookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

// server/links.ts
function linkState(link) {
  if (link.revoked) return "revoked";
  return Date.now() >= link.expires_at.getTime() ? "expired" : "active";
}
function linkByToken(token) {
  return one("SELECT * FROM review_links WHERE token = $1", [token]);
}

// server/oplog.ts
var resultOf = (row) => ({ version: row.version, changes: row.changes, removed: row.removed, stopped: row.stopped });
async function replayOf(projectId, personId, opId) {
  const row = await one("SELECT * FROM ops WHERE project_id = $1 AND person_id = $2 AND op_id = $3", [projectId, personId, opId]);
  return row ? resultOf(row) : null;
}
async function listOps(projectId, after) {
  const rows = await query(
    `SELECT o.*, p.name AS author_name FROM ops o JOIN people p ON p.id = o.person_id
      WHERE o.project_id = $1 AND o.version > $2 ORDER BY o.version`,
    [projectId, after]
  );
  return rows.map((row) => ({ ...resultOf(row), author: { id: row.person_id, name: row.author_name }, op: row.summary }));
}

// server/origin.ts
var publicHost = new URL(config.publicUrl).host;
function isOwnOrigin(origin, host2) {
  if (!origin) return true;
  try {
    const found = new URL(origin).host;
    return found === host2 || found === publicHost;
  } catch {
    return false;
  }
}

// server/live.ts
var CLOSE_SESSION_ENDED = 4401;
var CLOSE_ROLE_CHANGED = 4403;
var CLOSE_LINK_ENDED = 4410;
var Hub = class {
  conns = /* @__PURE__ */ new Set();
  server = new WebSocketServer({ noServer: true });
  upgrade(request, socket, head) {
    void this.admit(request, socket, head);
  }
  async admit(request, socket, head) {
    const url = new URL(request.url ?? "/", "http://local");
    if (url.pathname !== "/api/live" || !isOwnOrigin(request.headers.origin, request.headers.host)) {
      socket.write(`HTTP/1.1 ${url.pathname === "/api/live" ? "403 Forbidden" : "404 Not Found"}\r
Connection: close\r
\r
`);
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("review");
    const session = token ? null : await sessionFromCookie(request.headers.cookie);
    const link = token ? await linkByToken(token) : null;
    if (!token && !session || token && (!link || linkState(link) !== "active")) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.server.handleUpgrade(request, socket, head, (ws) => {
      const conn = {
        ws,
        actor: session?.actor ?? null,
        sessionId: session?.sessionId ?? null,
        projectId: null,
        playhead: null,
        review: link ? { linkId: link.id, expiresAt: link.expires_at.getTime() } : null
      };
      this.conns.add(conn);
      ws.on("message", (data) => void this.receive(conn, data.toString()));
      ws.on("close", () => {
        this.conns.delete(conn);
        if (conn.projectId && conn.actor && conn.playhead !== null) this.broadcastPlayhead(conn, null);
      });
      ws.on("error", () => ws.terminate());
    });
  }
  async receive(conn, text2) {
    let message;
    try {
      message = JSON.parse(text2);
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    const body = message;
    if (body["type"] === "subscribe" && conn.actor && typeof body["project_id"] === "string") {
      const projectId = body["project_id"];
      if (!await roleOf(projectId, conn.actor)) {
        conn.ws.close(CLOSE_ROLE_CHANGED);
        return;
      }
      conn.projectId = projectId;
      const after = typeof body["after_version"] === "number" ? body["after_version"] : 0;
      for (const op of await listOps(projectId, after)) this.send(conn, { type: "op", ...op });
      for (const other of this.conns) {
        if (other !== conn && other.projectId === projectId && other.playhead !== null && other.actor) {
          this.send(conn, { type: "playhead", person: other.actor.name, frame: other.playhead });
        }
      }
    } else if (body["type"] === "playhead" && conn.projectId && conn.actor && typeof body["frame"] === "number") {
      conn.playhead = body["frame"];
      this.broadcastPlayhead(conn, body["frame"]);
    }
  }
  broadcastPlayhead(from, frame2) {
    if (!from.actor || !from.projectId) return;
    for (const conn of this.conns) {
      if (conn !== from && conn.projectId === from.projectId && conn.actor?.id !== from.actor.id) {
        this.send(conn, { type: "playhead", person: from.actor.name, frame: frame2 });
      }
    }
  }
  send(conn, message) {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(message));
  }
  toProject(projectId, message) {
    for (const conn of this.conns) if (conn.projectId === projectId) this.send(conn, message);
  }
  toWorkspace(message) {
    for (const conn of this.conns) if (conn.actor) this.send(conn, message);
  }
  toOwners(message) {
    for (const conn of this.conns) if (conn.actor?.is_owner) this.send(conn, message);
  }
  toReview(linkId, message) {
    for (const conn of this.conns) if (conn.review?.linkId === linkId) this.send(conn, message);
  }
  /** The person's open sockets for the project hear the new role, are closed with 4403 and get nothing more. */
  roleChanged(projectId, personId, role) {
    for (const conn of [...this.conns]) {
      if (conn.projectId === projectId && conn.actor?.id === personId) {
        this.send(conn, { type: "role_changed", role });
        this.conns.delete(conn);
        conn.ws.close(CLOSE_ROLE_CHANGED);
      }
    }
  }
  closeSession(sessionId) {
    for (const conn of [...this.conns]) {
      if (conn.sessionId === sessionId) {
        this.conns.delete(conn);
        conn.ws.close(CLOSE_SESSION_ENDED);
      }
    }
  }
  closeLink(linkId) {
    for (const conn of [...this.conns]) {
      if (conn.review?.linkId === linkId) {
        this.conns.delete(conn);
        conn.ws.close(CLOSE_LINK_ENDED);
      }
    }
  }
  /** Closes review sockets whose link has run out on the server clock. */
  sweepExpired() {
    const now = Date.now();
    for (const conn of [...this.conns]) {
      if (conn.review && now >= conn.review.expiresAt) {
        this.conns.delete(conn);
        conn.ws.close(CLOSE_LINK_ENDED);
      }
    }
  }
  closeAll() {
    for (const conn of this.conns) conn.ws.terminate();
  }
};
var hub = new Hub();

// server/kv.ts
import { Redis } from "ioredis";
var kv = new Redis(config.valkeyUrl, { maxRetriesPerRequest: 2, enableOfflineQueue: true, lazyConnect: false });
kv.on("error", () => void 0);
kv.defineCommand("takeCounter", {
  numberOfKeys: 1,
  lua: `
    local current = redis.call('GET', KEYS[1])
    if not current then return {0, -1} end
    local used = tonumber(current)
    local amount = tonumber(ARGV[1])
    if used + amount > tonumber(ARGV[2]) then return {0, used} end
    redis.call('INCRBY', KEYS[1], amount)
    return {1, used + amount}
  `
});

// server/allowance.ts
var MINUTES_KEY_TTL_SECONDS = 40 * 24 * 3600;
var workspaceCache = null;
async function workspace() {
  if (workspaceCache) return workspaceCache;
  const row = await one("SELECT id, carried_storage_bytes, opening_minutes, opening_month FROM workspace LIMIT 1");
  if (!row) throw new Error("workspace is not seeded");
  workspaceCache = row;
  return row;
}
var currentMonth = (now = /* @__PURE__ */ new Date()) => now.toISOString().slice(0, 7);
var minutesKey = (ws, month) => `gatecut:${ws}:export-minutes:${month}`;
var storageKey = (ws) => `gatecut:${ws}:storage-bytes`;
async function ensureMinutes(month) {
  const ws = await workspace();
  const key = minutesKey(ws.id, month);
  if (await kv.exists(key)) return;
  const spent = await one(
    `SELECT COALESCE(SUM(minutes), 0)::int AS minutes FROM exports
      WHERE to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') = $1 AND state NOT IN ('cancelled', 'failed')`,
    [month]
  );
  await kv.set(key, (ws.opening_month === month ? ws.opening_minutes : 0) + (spent?.minutes ?? 0), "EX", MINUTES_KEY_TTL_SECONDS, "NX");
}
async function ensureStorage() {
  const ws = await workspace();
  const key = storageKey(ws.id);
  if (await kv.exists(key)) return;
  const stored = await one("SELECT COALESCE(SUM(bytes), 0)::bigint AS bytes FROM media");
  await kv.set(key, ws.carried_storage_bytes + (stored?.bytes ?? 0), "NX");
}
async function ensureCounters() {
  await ensureMinutes(currentMonth());
  await ensureStorage();
}
async function allowance() {
  await ensureCounters();
  const ws = await workspace();
  const month = currentMonth();
  const [minutes, storage] = await Promise.all([kv.get(minutesKey(ws.id, month)), kv.get(storageKey(ws.id))]);
  const now = /* @__PURE__ */ new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const base = {
    workspace_id: ws.id,
    month,
    export_minutes_used: Number(minutes ?? 0),
    export_minutes_allowance: config.exportMinuteAllowance,
    storage_bytes_used: Number(storage ?? 0),
    storage_bytes_allowance: config.storageAllowanceBytes,
    resets_at: reset.toISOString()
  };
  return { ...base, text: allowanceText(base) };
}
function allowanceExceeded(current) {
  return new AppError(
    "allowance_exceeded",
    {
      minutes: current.export_minutes_used,
      minutes_allowance: current.export_minutes_allowance,
      gb: gigabytes(current.storage_bytes_used),
      gb_allowance: gigabytes(current.storage_bytes_allowance)
    },
    { allowance: current }
  );
}
async function publishAllowance() {
  hub.toWorkspace({ type: "allowance", allowance: await allowance() });
}
async function takeMinutes(amount) {
  await ensureMinutes(currentMonth());
  const ws = await workspace();
  const [taken] = await kv.takeCounter(minutesKey(ws.id, currentMonth()), amount, config.exportMinuteAllowance);
  if (taken) void publishAllowance();
  return taken === 1;
}
async function giveBackMinutes(amount, month) {
  const ws = await workspace();
  const key = minutesKey(ws.id, month);
  if (await kv.exists(key)) await kv.eval("local v=tonumber(redis.call('GET',KEYS[1])); redis.call('SET',KEYS[1],math.max(0,v-tonumber(ARGV[1])),'KEEPTTL')", 1, key, amount);
  void publishAllowance();
}
async function takeStorage(bytes) {
  await ensureStorage();
  const ws = await workspace();
  const [taken] = await kv.takeCounter(storageKey(ws.id), bytes, config.storageAllowanceBytes);
  if (taken) void publishAllowance();
  return taken === 1;
}
async function giveBackStorage(bytes) {
  const ws = await workspace();
  await kv.decrby(storageKey(ws.id), bytes);
  void publishAllowance();
}

// server/exports.ts
import { createHash as createHash2 } from "node:crypto";

// shared/limits.ts
var NOTE_MAX = 2e3;
var MENTIONS_MAX = 5;
var CUE_LINE_MAX = 42;
var CUE_LINES_MAX = 2;
var SRT_CUES_MAX = 5e3;
var SRT_BYTES_MAX = 1e6;
var JSON_BYTES_MAX = 1e6;
var CHUNK_BYTES = 5242880;
var UPLOAD_BYTES_MAX = 8e9;
var SEARCH_TERMS_MAX = 8;
var SEARCH_CODEPOINTS_MAX = 200;
var TITLE_MAX = 80;
var NAME_MAX = 60;
var AVAILABILITY_MAX = 140;
var SPEED_MIN = 25;
var SPEED_MAX = 400;
var PAGE_MAX = 100;
var PAGE_DEFAULT = 25;
var LINK_MIN_SECONDS = 10;
var LINK_MAX_SECONDS = 2592e3;
var RATE_LIMIT = 30;
var RATE_WINDOW_SECONDS = 10;
var PNG_SOURCE_SECONDS = 3600;
var PNG_CLIP_SECONDS = 5;
var EXPORT_SIZES = [2160, 1080, 720];

// shared/types.ts
var ASPECTS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 }
};
var ASPECT_LABELS = Object.keys(ASPECTS);

// shared/rational.ts
var FRAME_RATES = [
  { label: "23.976", num: 24000n, den: 1001n, nominal: 24 },
  { label: "24", num: 24n, den: 1n, nominal: 24 },
  { label: "25", num: 25n, den: 1n, nominal: 25 },
  { label: "29.97", num: 30000n, den: 1001n, nominal: 30 },
  { label: "30", num: 30n, den: 1n, nominal: 30 },
  { label: "50", num: 50n, den: 1n, nominal: 50 },
  { label: "59.94", num: 60000n, den: 1001n, nominal: 60 },
  { label: "60", num: 60n, den: 1n, nominal: 60 }
];
var RATE_LABELS = FRAME_RATES.map((rate) => rate.label);
function rateOf(label) {
  const rate = FRAME_RATES.find((candidate) => candidate.label === label);
  if (!rate) throw new Error(`unknown frame rate ${label}`);
  return rate;
}
function isRateLabel(value) {
  return typeof value === "string" && FRAME_RATES.some((rate) => rate.label === value);
}
function floorDiv(a, b) {
  const quotient = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? quotient - 1n : quotient;
}
function roundExact(num, den) {
  if (den < 0n) return roundExact(-num, -den);
  return Number(floorDiv(2n * num + den, 2n * den));
}
function secondsToFrames(rate, secondsNum, secondsDen) {
  return roundExact(secondsNum * rate.num, secondsDen * rate.den);
}
function msToFrames(rate, ms) {
  return roundExact(BigInt(ms) * rate.num, 1000n * rate.den);
}
function framesToMs(rate, frame2) {
  return roundExact(BigInt(frame2) * 1000n * rate.den, rate.num);
}
function lengthAtSpeed(sourceFrames, speedPercent) {
  return roundExact(BigInt(sourceFrames) * 100n, BigInt(speedPercent));
}
function sourceAtSpeed(timelineFrames, speedPercent) {
  return roundExact(BigInt(timelineFrames) * BigInt(speedPercent), 100n);
}
function decimalToFraction(text2) {
  const [whole = "0", fraction = ""] = text2.split(".");
  return { num: BigInt(whole + fraction), den: 10n ** BigInt(fraction.length) };
}
function formatRational(rate) {
  return `${rate.num}/${rate.den}`;
}

// server/ids.ts
import { randomBytes as randomBytes2 } from "node:crypto";
function newId(prefix) {
  return `${prefix}-${randomBytes2(6).toString("hex")}`;
}

// server/smtp.ts
import net from "node:net";
var TIMEOUT_MS = 5e3;
var SmtpSession = class {
  constructor(socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => this.feed(chunk));
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("smtp connection closed")));
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("smtp timeout")));
  }
  socket;
  buffer = "";
  replies = [];
  waiting = null;
  failed = null;
  fail(error) {
    this.failed ??= error;
    this.waiting?.reject(error);
    this.waiting = null;
  }
  /** A reply ends at the first line whose code is followed by a space. */
  feed(chunk) {
    this.buffer += chunk;
    for (; ; ) {
      const lines = this.buffer.split("\r\n");
      const end = lines.findIndex((line, index) => index < lines.length - 1 && /^\d{3} /.test(line));
      if (end < 0) return;
      const reply = { code: Number((lines[end] ?? "").slice(0, 3)), text: lines.slice(0, end + 1).join("\n") };
      this.buffer = lines.slice(end + 1).join("\r\n");
      const waiter = this.waiting;
      if (waiter) {
        this.waiting = null;
        waiter.resolve(reply);
      } else {
        this.replies.push(reply);
      }
    }
  }
  reply() {
    const ready = this.replies.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }
  async command(line, expected) {
    const pending = this.reply();
    this.socket.write(`${line}\r
`);
    const { code, text: text2 } = await pending;
    if (code !== expected) throw new Error(`smtp ${line.split(" ")[0]} answered ${text2}`);
  }
  async greeting() {
    const { code } = await this.reply();
    if (code !== 220) throw new Error("smtp greeting refused");
  }
  end() {
    this.socket.destroy();
  }
};
function connect() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: config.smtp.host, port: config.smtp.port });
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("smtp connect timeout")));
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      const session = new SmtpSession(socket);
      resolve(session);
    });
  });
}
async function smtpReachable() {
  try {
    const session = await Promise.race([
      connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("smtp connect timeout")), 1500))
    ]);
    try {
      await Promise.race([session.greeting(), new Promise((_, reject) => setTimeout(() => reject(new Error("greeting timeout")), 1500))]);
      return true;
    } finally {
      session.end();
    }
  } catch {
    return false;
  }
}
var encodeHeader = (text2) => /^[\x20-\x7e]*$/.test(text2) ? text2 : `=?UTF-8?B?${Buffer.from(text2, "utf8").toString("base64")}?=`;
var addressOf = (from) => from.includes("<") ? from.slice(from.indexOf("<") + 1, from.indexOf(">")) : from.trim();
async function sendMail(mail) {
  const session = await connect();
  try {
    await session.greeting();
    await session.command("EHLO gatecut", 250);
    await session.command(`MAIL FROM:<${addressOf(config.mailFrom)}>`, 250);
    await session.command(`RCPT TO:<${mail.to}>`, 250);
    await session.command("DATA", 354);
    const body = Buffer.from(mail.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
    const message = [
      `From: ${config.mailFrom}`,
      `To: ${mail.to}`,
      `Subject: ${encodeHeader(mail.subject)}`,
      `Date: ${(/* @__PURE__ */ new Date()).toUTCString()}`,
      `Message-ID: <${mail.messageId}@gatecut>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
      "."
    ].join("\r\n");
    await session.command(message, 250);
    await session.command("QUIT", 221).catch(() => void 0);
  } finally {
    session.end();
  }
}

// server/mail.ts
async function queueMail(db, to, subject, body) {
  await query("INSERT INTO outbox (id, to_email, subject, body) VALUES ($1,$2,$3,$4)", [newId("mail"), to, subject, body], db);
}
async function enqueueNotifications(db, personIds, projectId, author, frame2, body) {
  for (const personId of personIds) {
    await query("INSERT INTO notifications (person_id, project_id, author_name, frame, body) VALUES ($1,$2,$3,$4,$5)", [personId, projectId, author, frame2, body], db);
  }
}
async function closeWindows() {
  const due = await query(
    `SELECT person_id, project_id FROM notifications WHERE outbox_id IS NULL
      GROUP BY person_id, project_id HAVING min(created_at) <= now() - make_interval(secs => $1)`,
    [config.mailGroupSeconds]
  );
  for (const { person_id, project_id } of due) {
    await tx(async (db) => {
      const notes = await query(
        `SELECT * FROM notifications WHERE person_id = $1 AND project_id = $2 AND outbox_id IS NULL ORDER BY created_at, id FOR UPDATE SKIP LOCKED`,
        [person_id, project_id],
        db
      );
      const first = notes[0];
      if (!first) return;
      const window = notes.filter((note) => note.created_at.getTime() <= first.created_at.getTime() + config.mailGroupSeconds * 1e3);
      const project = await one("SELECT title, frame_rate FROM projects WHERE id = $1", [project_id], db);
      const person = await one("SELECT email FROM people WHERE id = $1", [person_id], db);
      if (!project || !person) return;
      const rate = rateOf(project.frame_rate);
      const lines = window.map((note) => `${note.author_name} at ${timecode(rate, note.frame)}: ${note.body}`);
      const text2 = `${lines.join("\n")}

Open the project: ${config.publicUrl}/projects/${project_id}
`;
      const mailId = newId("mail");
      await db.query("INSERT INTO outbox (id, to_email, subject, body) VALUES ($1,$2,$3,$4)", [mailId, person.email, `Gatecut \xB7 ${project.title} \xB7 notes for you (${window.length})`, text2]);
      await db.query("UPDATE notifications SET outbox_id = $1 WHERE id = ANY($2)", [mailId, window.map((note) => note.id)]);
    });
  }
}
async function claimNext() {
  return one(
    `UPDATE outbox SET attempts = attempts + 1, claimed_until = now() + interval '30 seconds'
      WHERE id = (SELECT id FROM outbox WHERE state = 'waiting' AND (claimed_until IS NULL OR claimed_until < now())
                  ORDER BY seq LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`
  );
}
async function deliverOutbox() {
  for (let mail = await claimNext(); mail; mail = await claimNext()) {
    try {
      await sendMail({ to: mail.to_email, subject: mail.subject, text: mail.body, messageId: mail.id });
    } catch {
      await query("UPDATE outbox SET claimed_until = NULL WHERE id = $1", [mail.id]);
      return;
    }
    await query("UPDATE outbox SET state = 'sent', sent_at = now() WHERE id = $1", [mail.id]);
  }
}
function startMail() {
  setInterval(() => void closeWindows().catch(() => void 0), 1e3).unref();
  setInterval(() => void deliverOutbox().catch(() => void 0), config.outboxRetrySeconds * 1e3).unref();
}
function kickOutbox() {
  void deliverOutbox().catch(() => void 0);
}
async function outboxItems() {
  const rows = await query("SELECT * FROM outbox ORDER BY seq DESC LIMIT 200", [], pool);
  return rows.map((row) => ({
    id: row.id,
    to: row.to_email,
    subject: row.subject,
    state: row.state,
    attempts: row.attempts,
    created_at: row.created_at.toISOString(),
    sent_at: row.sent_at ? row.sent_at.toISOString() : null
  }));
}

// server/queue.ts
import amqp from "amqplib";
var CONNECT_TIMEOUT_MS = 1500;
var RETRY_MS = 2e3;
var ExportQueue = class {
  connection = null;
  channel = null;
  connecting = null;
  handler = null;
  start(handler) {
    this.handler = handler;
    void this.ensure();
    setInterval(() => void this.ensure(), RETRY_MS).unref();
  }
  /** Connects when down; true when a channel is open afterwards. */
  ensure() {
    if (this.channel) return Promise.resolve(true);
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }
  async connect() {
    try {
      const connection = await Promise.race([
        amqp.connect(config.amqpUrl),
        new Promise((_, reject) => setTimeout(() => reject(new Error("amqp connect timeout")), CONNECT_TIMEOUT_MS))
      ]);
      const channel = await connection.createConfirmChannel();
      await channel.assertQueue(config.exportQueue, { durable: true });
      await channel.prefetch(4);
      const lost = () => {
        if (this.connection === connection) {
          this.connection = null;
          this.channel = null;
        }
      };
      connection.on("close", lost);
      connection.on("error", lost);
      channel.on("close", lost);
      channel.on("error", lost);
      this.connection = connection;
      this.channel = channel;
      await channel.consume(config.exportQueue, (message) => void this.deliver(channel, message), { noAck: false });
      return true;
    } catch {
      this.channel = null;
      this.connection = null;
      return false;
    }
  }
  async deliver(channel, message) {
    if (!message || !this.handler) return;
    try {
      await this.handler(JSON.parse(message.content.toString("utf8")));
      channel.ack(message);
    } catch {
      try {
        channel.nack(message, false, true);
      } catch {
      }
    }
  }
  /** Publishes one persistent message and waits for the broker's confirm; false when the queue is unreachable. */
  async publish(message) {
    if (!await this.ensure() || !this.channel) return false;
    try {
      this.channel.sendToQueue(config.exportQueue, Buffer.from(JSON.stringify(message)), { persistent: true, contentType: "application/json" });
      await this.channel.waitForConfirms();
      return true;
    } catch {
      this.channel = null;
      return false;
    }
  }
  async close() {
    await this.connection?.close().catch(() => void 0);
  }
};
var exportQueue = new ExportQueue();

// server/s3.ts
import { createHash, createHmac } from "node:crypto";
var StorageDown = class extends Error {
  constructor(cause) {
    super("storage unreachable", { cause });
  }
};
var { endpoint, region, bucket, accessKeyId, secretAccessKey } = config.s3;
var host = new URL(endpoint).host;
var REQUEST_TIMEOUT_MS = 2e4;
var sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
var hmac = (key, data) => createHmac("sha256", key).update(data).digest();
function encode(text2) {
  return encodeURIComponent(text2).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
var encodePath = (key) => key.split("/").map(encode).join("/");
function canonicalQuery(query2) {
  return Object.keys(query2).sort().map((name) => `${encode(name)}=${encode(query2[name] ?? "")}`).join("&");
}
function signingKey(day) {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
}
function stamp() {
  const amz = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]|\.\d{3}/g, "");
  return { amz, day: amz.slice(0, 8) };
}
function objectPath(key) {
  return key ? `/${bucket}/${encodePath(key)}` : `/${bucket}`;
}
async function send(method, key, options = {}) {
  const query2 = options.query ?? {};
  const body = options.body ?? Buffer.alloc(0);
  const { amz, day } = stamp();
  const payload = sha256Hex(body);
  const headers = { host, "x-amz-content-sha256": payload, "x-amz-date": amz };
  const signedNames = Object.keys(headers).sort();
  const canonical2 = [
    method,
    objectPath(key),
    canonicalQuery(query2),
    signedNames.map((name) => `${name}:${headers[name]}
`).join(""),
    signedNames.join(";"),
    payload
  ].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = `AWS4-HMAC-SHA256
${amz}
${scope}
${sha256Hex(canonical2)}`;
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedNames.join(";")}, Signature=${signature}`;
  const queryString = canonicalQuery(query2);
  const url = `${endpoint}${objectPath(key)}${queryString ? `?${queryString}` : ""}`;
  try {
    const response = await fetch(url, {
      method,
      headers: { ...headers, ...options.headers, authorization },
      body: method === "PUT" || method === "POST" ? new Uint8Array(body) : void 0,
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers };
  } catch (error) {
    throw new StorageDown(error);
  }
}
function expectOk(response, what) {
  if (response.status >= 500) throw new StorageDown(`${what}: ${response.status}`);
  if (response.status >= 300) throw new Error(`${what} failed with ${response.status}: ${response.body.toString().slice(0, 200)}`);
  return response;
}
async function putObject(key, body) {
  expectOk(await send("PUT", key, { body }), `put ${key}`);
}
async function getObject(key, range) {
  const response = await send("GET", key, range ? { headers: { range: `bytes=${range.start}-${range.end}` } } : {});
  if (response.status === 404) return null;
  return expectOk(response, `get ${key}`).body;
}
async function headObject(key) {
  const response = await send("HEAD", key);
  if (response.status === 404) return null;
  expectOk(response, `head ${key}`);
  return { size: Number(response.headers.get("content-length") ?? 0) };
}
async function deleteObject(key) {
  expectOk(await send("DELETE", key), `delete ${key}`);
}
async function reachable() {
  try {
    const response = await send("HEAD", "", { timeoutMs: 1500 });
    return response.status < 500;
  } catch {
    return false;
  }
}
async function ensureBucket() {
  const head = await send("HEAD", "");
  if (head.status === 404) expectOk(await send("PUT", ""), "create bucket");
}
async function createMultipart(key) {
  const response = expectOk(await send("POST", key, { query: { uploads: "" } }), "create multipart");
  const id = /<UploadId>(.*?)<\/UploadId>/.exec(response.body.toString("utf8"))?.[1];
  if (!id) throw new Error("multipart upload id missing");
  return id;
}
async function uploadPart(key, uploadId, part, body) {
  const response = expectOk(
    await send("PUT", key, { query: { partNumber: String(part), uploadId }, body }),
    `upload part ${part}`
  );
  return response.headers.get("etag") ?? "";
}
async function completeMultipart(key, uploadId, etags) {
  const parts = etags.map((etag, index) => `<Part><PartNumber>${index + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join("");
  const body = Buffer.from(`<CompleteMultipartUpload>${parts}</CompleteMultipartUpload>`);
  expectOk(await send("POST", key, { query: { uploadId }, body }), "complete multipart");
}
async function abortMultipart(key, uploadId) {
  await send("DELETE", key, { query: { uploadId } }).catch(() => void 0);
}
function presignGet(key, seconds) {
  const { amz, day } = stamp();
  const scope = `${day}/${region}/s3/aws4_request`;
  const query2 = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(seconds),
    "X-Amz-SignedHeaders": "host"
  };
  const canonical2 = ["GET", objectPath(key), canonicalQuery(query2), `host:${host}
`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = `AWS4-HMAC-SHA256
${amz}
${scope}
${sha256Hex(canonical2)}`;
  const signature = createHmac("sha256", signingKey(day)).update(toSign).digest("hex");
  return `${endpoint}${objectPath(key)}?${canonicalQuery(query2)}&X-Amz-Signature=${signature}`;
}

// server/timeline/store.ts
var framesOfSeconds = (rate, seconds) => {
  const { num, den } = decimalToFraction(String(seconds));
  return secondsToFrames(rate, num, den);
};
function clipFromRow(row, rate) {
  const { legacy, ...clip } = row;
  if (!legacy) return clip;
  const start = framesOfSeconds(rate, legacy.start);
  const sourceIn = framesOfSeconds(rate, legacy.source_in);
  const sourceOut = framesOfSeconds(rate, legacy.source_out);
  return {
    ...clip,
    start_frame: start,
    source_in: sourceIn,
    source_out: sourceOut,
    end_frame: start + lengthAtSpeed(sourceOut - sourceIn, clip.speed_percent)
  };
}
function captionFromRow(row, rate) {
  const { legacy, ...caption } = row;
  if (!legacy) return caption;
  return { ...caption, start_frame: framesOfSeconds(rate, legacy.start), end_frame: framesOfSeconds(rate, legacy.end) };
}
function markerFromRow(row, rate) {
  return { frame: row.legacy === null ? row.frame : framesOfSeconds(rate, row.legacy), label: row.label };
}
async function loadProjectRow(db, id, lock = false) {
  return one(`SELECT * FROM projects WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], db);
}
async function loadTimeline(db, project) {
  const rate = rateOf(project.frame_rate);
  const rows = await query("SELECT id, name, kind, position, locked, srt_eol, srt_bom FROM rows WHERE project_id = $1 ORDER BY position", [project.id], db);
  const clips = await query("SELECT * FROM clips WHERE project_id = $1 ORDER BY seq", [project.id], db);
  const captions = await query("SELECT * FROM captions WHERE project_id = $1 ORDER BY start_frame, seq", [project.id], db);
  const markers2 = await query("SELECT frame, label, legacy FROM markers WHERE project_id = $1 ORDER BY id", [project.id], db);
  return {
    projectId: project.id,
    rate,
    aspect: project.aspect_ratio,
    rows,
    clips: clips.map((row) => clipFromRow(row, rate)),
    captions: captions.map((row) => captionFromRow(row, rate)),
    markers: markers2.map((row) => markerFromRow(row, rate)).sort((a, b) => a.frame - b.frame)
  };
}
async function loadMedia(db, ids) {
  if (!ids.length) return /* @__PURE__ */ new Map();
  const rows = await query("SELECT id, name, kind, width, height, src_num, src_den FROM media WHERE id = ANY($1)", [ids], db);
  return new Map(rows.map((row) => [row.id, { ...row, src_num: BigInt(row.src_num), src_den: BigInt(row.src_den) }]));
}
async function persist(db, projectId, draft, diff) {
  for (const clip of diff.clips) {
    await db.query(
      `INSERT INTO clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out,
         speed_percent, hidden, group_id, text, text_colour, box_colour, font_weight, keyframes, base)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET row_id=$3, name=$4, kind=$5, media_id=$6, start_frame=$7, end_frame=$8, source_in=$9,
         source_out=$10, speed_percent=$11, hidden=$12, group_id=$13, text=$14, text_colour=$15, box_colour=$16,
         font_weight=$17, keyframes=$18, base=$19, legacy=NULL`,
      [
        clip.id,
        projectId,
        clip.row_id,
        clip.name,
        clip.kind,
        clip.media_id,
        clip.start_frame,
        clip.end_frame,
        clip.source_in,
        clip.source_out,
        clip.speed_percent,
        clip.hidden,
        clip.group_id,
        clip.text,
        clip.text_colour,
        clip.box_colour,
        clip.font_weight,
        JSON.stringify(clip.keyframes),
        JSON.stringify(clip.base)
      ]
    );
  }
  for (const [id, before] of diff.clipBefore) {
    if (before && !draft.clips.has(id)) await db.query("DELETE FROM clips WHERE id = $1 AND project_id = $2", [id, projectId]);
  }
  if (diff.captions.length) {
    const column = (pick) => diff.captions.map(pick);
    await db.query(
      `INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text, orig_start_ms, orig_end_ms)
       SELECT id, $1, row_id, start_frame, end_frame, text, orig_start_ms, orig_end_ms
         FROM unnest($2::text[], $3::text[], $4::int[], $5::int[], $6::text[], $7::int[], $8::int[])
              AS cue(id, row_id, start_frame, end_frame, text, orig_start_ms, orig_end_ms)
       ON CONFLICT (id) DO UPDATE SET row_id = EXCLUDED.row_id, start_frame = EXCLUDED.start_frame, end_frame = EXCLUDED.end_frame,
         text = EXCLUDED.text, orig_start_ms = EXCLUDED.orig_start_ms, orig_end_ms = EXCLUDED.orig_end_ms, legacy = NULL`,
      [
        projectId,
        column((c) => c.id),
        column((c) => c.row_id),
        column((c) => c.start_frame),
        column((c) => c.end_frame),
        column((c) => c.text),
        column((c) => c.orig_start_ms),
        column((c) => c.orig_end_ms)
      ]
    );
  }
  const goneCaptions = [...diff.captionBefore].filter(([id, before]) => before && !draft.captions.has(id)).map(([id]) => id);
  if (goneCaptions.length) await db.query("DELETE FROM captions WHERE project_id = $1 AND id = ANY($2)", [projectId, goneCaptions]);
  for (const row of diff.rows) {
    await db.query(
      `INSERT INTO rows (id, project_id, name, kind, position, locked, srt_eol, srt_bom) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name=$3, kind=$4, position=$5, locked=$6, srt_eol=$7, srt_bom=$8`,
      [row.id, projectId, row.name, row.kind, row.position, row.locked, row.srt_eol, row.srt_bom]
    );
  }
  for (const [id, before] of diff.rowBefore) {
    if (before && !draft.rows.has(id)) await db.query("DELETE FROM rows WHERE id = $1 AND project_id = $2", [id, projectId]);
  }
  if (diff.markersBefore) {
    await db.query("DELETE FROM markers WHERE project_id = $1", [projectId]);
    for (const marker of draft.markers) {
      await db.query("INSERT INTO markers (project_id, frame, label) VALUES ($1,$2,$3)", [projectId, marker.frame, marker.label]);
    }
  }
  if (diff.aspectBefore) await db.query("UPDATE projects SET aspect_ratio = $2 WHERE id = $1", [projectId, draft.aspect]);
}

// server/exports.ts
var SELECT = `SELECT e.*, c.name AS cut_name, c.total_frames, p.name AS requester, pr.version AS project_version
  FROM exports e JOIN cuts c ON c.id = e.cut_id JOIN people p ON p.id = e.requested_by JOIN projects pr ON pr.id = e.project_id`;
function record(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    cut_id: row.cut_id,
    cut_name: row.cut_name,
    size: row.size,
    state: row.state,
    progress: row.progress,
    minutes: row.minutes,
    stale: row.state === "done" && row.finished_version !== null && row.project_version > row.finished_version,
    requested_by: row.requester,
    manifest_checksum: row.manifest_checksum,
    created_at: row.created_at.toISOString(),
    finished_at: row.finished_at ? row.finished_at.toISOString() : null
  };
}
async function exportById(id) {
  const row = await one(`${SELECT} WHERE e.id = $1`, [id]);
  if (!row) throw notFound();
  return record(row);
}
async function projectOfExport(id) {
  const row = await one("SELECT project_id FROM exports WHERE id = $1", [id]);
  if (!row) throw notFound();
  return row.project_id;
}
async function listExports(projectId) {
  return (await query(`${SELECT} WHERE e.project_id = $1 ORDER BY e.seq DESC`, [projectId])).map(record);
}
function publish(exported) {
  hub.toProject(exported.project_id, { type: "export", export: exported });
}
function minutesOf(rateLabel, totalFrames) {
  const rate = rateOf(rateLabel);
  const numerator = BigInt(totalFrames) * rate.den;
  const denominator = rate.num * 60n;
  return Number((numerator + denominator - 1n) / denominator);
}
function fail(code) {
  throw new AppError(code);
}
async function startExport(projectId, actor, raw) {
  const input = typeof raw === "object" && raw !== null ? raw : {};
  const size = input["size"];
  if (typeof input["cut_id"] !== "string") throw invalid({ cut_id: FIELD_ERRORS.other });
  const cut = await one("SELECT id, total_frames FROM cuts WHERE id = $1 AND project_id = $2", [input["cut_id"], projectId]);
  if (!cut) throw notFound();
  const project = await loadProjectRow(pool, projectId);
  if (!project) throw notFound();
  const existing = size === 2160 || size === 1080 || size === 720 ? await one(`${SELECT} WHERE e.cut_id = $1 AND e.size = $2 AND e.state IN ('queued','running','done')`, [cut.id, size]) : void 0;
  if (existing) return { status: 200, body: record(existing) };
  if (!EXPORT_SIZES.some((candidate) => candidate === size)) throw invalid({ size: FIELD_ERRORS.other });
  const minutes = minutesOf(project.frame_rate, cut.total_frames);
  const current = await allowance();
  if (current.export_minutes_used + minutes > current.export_minutes_allowance) throw allowanceExceeded(current);
  if (!await reachable()) fail("storage_unavailable");
  if (!await exportQueue.ensure()) fail("queue_unavailable");
  const id = newId("x");
  const message = { export_id: id, project_id: projectId, cut_id: cut.id, size, requested_by: actor.id };
  const outcome = await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`export:${cut.id}:${size}`]);
    const again = await one(`${SELECT} WHERE e.cut_id = $1 AND e.size = $2 AND e.state IN ('queued','running','done')`, [cut.id, size], db);
    if (again) return { status: 200, row: again };
    if (!await takeMinutes(minutes)) throw allowanceExceeded(await allowance());
    try {
      await db.query("INSERT INTO exports (id, project_id, cut_id, size, minutes, requested_by) VALUES ($1,$2,$3,$4,$5,$6)", [id, projectId, cut.id, size, minutes, actor.id]);
    } catch (error) {
      await giveBackMinutes(minutes, currentMonth());
      throw error;
    }
    return { status: 202, row: void 0 };
  });
  const row = await one(`${SELECT} WHERE e.id = $1`, [outcome.row?.id ?? id]);
  if (!row) throw notFound();
  if (outcome.status === 202) {
    if (!await exportQueue.publish(message)) {
      await query("DELETE FROM exports WHERE id = $1", [id]);
      await giveBackMinutes(minutes, currentMonth());
      fail("queue_unavailable");
    }
    publish(record(row));
  }
  return { status: outcome.status, body: record(row) };
}
async function cancelExport(id) {
  const row = await one(`${SELECT} WHERE e.id = $1`, [id]);
  if (!row) throw notFound();
  const stopped = await one(
    "UPDATE exports SET state = 'cancelled' WHERE id = $1 AND state IN ('queued','running') RETURNING created_at, minutes",
    [id]
  );
  if (!stopped) throw new AppError("export_finished", { state: row.state });
  await giveBackMinutes(stopped.minutes, stopped.created_at.toISOString().slice(0, 7));
  const after = await exportById(id);
  publish(after);
  return after;
}
async function manifestLink(id) {
  const exported = await exportById(id);
  if (exported.state !== "done") throw new AppError("export_not_ready");
  return presignGet(`manifests/${id}.json`, config.manifestLinkSeconds);
}
async function exportsAfterOp(projectId, version) {
  const rows = await query(`${SELECT} WHERE e.project_id = $1 AND e.state = 'done' AND e.finished_version = $2`, [projectId, version - 1]);
  for (const row of rows) publish(record(row));
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
async function buildManifest(row) {
  const project = await loadProjectRow(pool, row.project_id);
  const cut = await one("SELECT snapshot, total_frames FROM cuts WHERE id = $1", [row.cut_id]);
  if (!project || !cut) throw notFound();
  const media = await query("SELECT id, sha256 FROM media WHERE id = ANY($1)", [cut.snapshot.clips.flatMap((clip) => clip.media_id ? [clip.media_id] : [])]);
  const sha = new Map(media.map((item) => [item.id, item.sha256]));
  const aspect = ASPECTS[project.aspect_ratio];
  const landscape = aspect.width >= aspect.height;
  const long = (shortSide, longPart, shortPart) => roundExact(BigInt(shortSide) * BigInt(longPart), BigInt(shortPart));
  const body = {
    project: { id: project.id, title: project.title },
    cut: { id: row.cut_id, name: row.cut_name },
    frame_rate: formatRational(rateOf(project.frame_rate)),
    size: row.size,
    width: landscape ? long(row.size, aspect.width, aspect.height) : row.size,
    height: landscape ? row.size : long(row.size, aspect.height, aspect.width),
    total_frames: cut.total_frames,
    rows: [...cut.snapshot.rows].sort((a, b) => a.position - b.position).map((snapshotRow) => ({
      row_id: snapshotRow.id,
      name: snapshotRow.name,
      kind: snapshotRow.kind,
      items: cut.snapshot.clips.filter((clip) => clip.row_id === snapshotRow.id).sort((a, b) => a.start_frame - b.start_frame).map((clip) => ({
        clip_id: clip.id,
        name: clip.name,
        kind: clip.kind,
        media_sha256: clip.media_id ? sha.get(clip.media_id) ?? null : null,
        start_frame: clip.start_frame,
        end_frame: clip.end_frame,
        source_in: clip.source_in,
        source_out: clip.source_out,
        speed_percent: clip.speed_percent,
        hidden: clip.hidden,
        keyframes: clip.keyframes
      }))
    })),
    captions: cut.snapshot.captions.map((caption) => ({ row_id: caption.row_id, start_frame: caption.start_frame, end_frame: caption.end_frame, text: caption.text }))
  };
  const checksum = `sha256:${createHash2("sha256").update(canonical(body)).digest("hex")}`;
  return { text: JSON.stringify({ ...body, checksum }), checksum };
}
var pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function stopFailed(id) {
  const failed = await one("UPDATE exports SET state = 'failed' WHERE id = $1 AND state = 'running' RETURNING created_at, minutes", [id]);
  if (failed) await giveBackMinutes(failed.minutes, failed.created_at.toISOString().slice(0, 7));
  publish(await exportById(id));
}
async function runExport(message) {
  const claimed = await one("UPDATE exports SET state = 'running' WHERE id = $1 AND state = 'queued' RETURNING id", [message.export_id]);
  if (!claimed) return;
  publish(await exportById(message.export_id));
  for (let step = 1; step <= 10; step += 1) {
    await pause(config.exportStepMs);
    const advanced = await one("UPDATE exports SET progress = $2 WHERE id = $1 AND state = 'running' RETURNING id", [message.export_id, step * 10]);
    if (!advanced) return;
    publish(await exportById(message.export_id));
  }
  const row = await one(`${SELECT} WHERE e.id = $1`, [message.export_id]);
  if (!row || row.state !== "running") return;
  try {
    const manifest = await buildManifest(row);
    const key = `manifests/${row.id}.json`;
    if (!await headObject(key)) await putObject(key, Buffer.from(manifest.text, "utf8"));
    const done = await one(
      `UPDATE exports SET state = 'done', finished_at = now(), manifest_checksum = $2,
         finished_version = (SELECT version FROM projects WHERE id = $3) WHERE id = $1 AND state = 'running' RETURNING id`,
      [row.id, manifest.checksum, row.project_id]
    );
    if (!done) return;
    const finished = await exportById(row.id);
    publish(finished);
    const requester = await one("SELECT email FROM people WHERE id = $1", [row.requested_by]);
    if (requester) {
      await queueMail(
        pool,
        requester.email,
        `Gatecut \xB7 export ready \xB7 ${row.cut_name} \xB7 ${row.size}p`,
        `Manifest checksum: ${manifest.checksum}
Project: ${config.publicUrl}/projects/${row.project_id}
`
      );
      kickOutbox();
    }
  } catch (error) {
    if (!(error instanceof StorageDown)) process.stderr.write(`export ${row.id} failed: ${String(error)}
`);
    await stopFailed(row.id);
  }
}
var REPUBLISH_AFTER_SECONDS = 30;
async function republishLost() {
  const lost = await query(
    "SELECT id, project_id, cut_id, size, requested_by FROM exports WHERE state = 'queued' AND created_at < now() - make_interval(secs => $1)",
    [REPUBLISH_AFTER_SECONDS]
  );
  for (const row of lost) await exportQueue.publish({ export_id: row.id, project_id: row.project_id, cut_id: row.cut_id, size: row.size, requested_by: row.requested_by });
}
function startExports() {
  exportQueue.start(runExport);
  setInterval(() => void republishLost().catch(() => void 0), REPUBLISH_AFTER_SECONDS * 1e3).unref();
}

// server/http.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/tokens.ts
import { createHash as createHash3, randomBytes as randomBytes3 } from "node:crypto";

// shared/codepoints.ts
function codePoints(text2) {
  let count = 0;
  for (const _ of text2) count += 1;
  return count;
}

// server/tokens.ts
var RATE_KEY_TTL_SECONDS = 20;
var hashOf = (token) => createHash3("sha256").update(token).digest("hex");
var windowOf = (nowMs) => Math.floor(nowMs / 1e3 / RATE_WINDOW_SECONDS);
var rateKey = (tokenId, window) => `gatecut:rate:${tokenId}:${window}`;
async function issueToken(raw) {
  const name = typeof raw === "object" && raw !== null ? raw["name"] : void 0;
  if (typeof name !== "string" || name.trim().length === 0 || codePoints(name) > NAME_MAX) throw invalid({ name: FIELD_ERRORS.other });
  const token = `gct_${randomBytes3(20).toString("hex")}`;
  const row = await one(
    "INSERT INTO tokens (id, name, token_hash) VALUES ($1,$2,$3) RETURNING id, created_at",
    [newId("t"), name.trim(), hashOf(token)]
  );
  return { id: row?.id ?? "", name: name.trim(), token, created_at: row?.created_at.toISOString() ?? "" };
}
async function listTokens() {
  const rows = await query("SELECT * FROM tokens ORDER BY created_at, id");
  const window = windowOf(Date.now());
  const endsIn = (window + 1) * RATE_WINDOW_SECONDS * 1e3 - Date.now();
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      created_at: row.created_at.toISOString(),
      last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
      window_requests: Number(await kv.get(rateKey(row.id, window)) ?? 0),
      window_ends_in_ms: endsIn
    }))
  );
}
async function revokeToken(id) {
  const gone = await one("DELETE FROM tokens WHERE id = $1 RETURNING id", [id]);
  return gone !== void 0;
}
async function authenticateToken(header) {
  const match2 = /^Bearer (gct_[0-9a-f]{40})$/.exec(header ?? "");
  const row = match2 ? await one("SELECT id FROM tokens WHERE token_hash = $1", [hashOf(match2[1] ?? "")]) : void 0;
  if (!row) throw new AppError("unauthenticated");
  const now = Date.now();
  const window = windowOf(now);
  const key = rateKey(row.id, window);
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, RATE_KEY_TTL_SECONDS);
  const endsAt = (window + 1) * RATE_WINDOW_SECONDS * 1e3;
  hub.toOwners({ type: "token_window", token_id: row.id, count, window_ends_in_ms: endsAt - now });
  void query("UPDATE tokens SET last_used_at = now() WHERE id = $1", [row.id]);
  if (count > RATE_LIMIT) {
    const seconds = Math.max(1, Math.ceil((endsAt - now) / 1e3));
    throw new AppError("rate_limited", { seconds }, {}, { "retry-after": String(seconds) });
  }
}

// server/http.ts
var BODY_RULES = {
  json: { limit: JSON_BYTES_MAX, type: /^application\/json(\s*;.*)?$/i, label: "application/json; charset=utf-8" },
  octet: { limit: CHUNK_BYTES, type: /^application\/octet-stream$/i, label: "application/octet-stream" },
  srt: { limit: SRT_BYTES_MAX, type: /^application\/x-subrip(\s*;.*)?$/i, label: "application/x-subrip" }
};
var NONE = { id: "", name: "", email: "", handle: "", is_owner: false };
var json = (body, status = 200, headers) => ({ status, body, ...headers ? { headers } : {} });
var empty = (status = 204, headers) => ({ status, ...headers ? { headers } : {} });
function match(route2, parts) {
  if (route2.segments.length !== parts.length) return null;
  const params = {};
  for (const [index, segment] of route2.segments.entries()) {
    const part = parts[index] ?? "";
    if (segment.startsWith(":")) params[segment.slice(1)] = part;
    else if (segment !== part) return null;
  }
  return params;
}
async function readBody(request, limit) {
  const length = request.headers["content-length"];
  if (length !== void 0 && Number(length) > limit) throw new AppError("too_large", { limit });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const part = chunk;
    size += part.length;
    if (size > limit) throw new AppError("too_large", { limit });
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
function hasBody(request) {
  const length = request.headers["content-length"];
  return request.headers["transfer-encoding"] !== void 0 || length !== void 0 && Number(length) > 0;
}
async function dispatch(routes2, request) {
  const url = new URL(request.url ?? "/", "http://local");
  const parts = url.pathname.split("/").filter(Boolean);
  const candidates = routes2.flatMap((route3) => {
    const params2 = match(route3, parts);
    return params2 ? [{ route: route3, params: params2 }] : [];
  });
  if (!candidates.length) throw new AppError("not_found");
  const method = request.method ?? "GET";
  const chosen = candidates.find((candidate) => candidate.route.method === method);
  if (!chosen) {
    throw new AppError("method_not_allowed", {}, {}, { allow: [...new Set(candidates.map((candidate) => candidate.route.method))].join(", ") });
  }
  const { route: route2, params } = chosen;
  let raw = Buffer.alloc(0);
  if (route2.body === "none") {
    if (hasBody(request)) raw = await readBody(request, JSON_BYTES_MAX);
  } else {
    const rule = BODY_RULES[route2.body];
    if (hasBody(request)) {
      const length = request.headers["content-length"];
      if (length !== void 0 && Number(length) > rule.limit) throw new AppError("too_large", { limit: rule.limit });
      if (!rule.type.test((request.headers["content-type"] ?? "").trim())) throw new AppError("unsupported_media_type", { expected: rule.label });
    }
  }
  if (!isOwnOrigin(request.headers.origin, request.headers.host) && method !== "GET" && method !== "HEAD") throw new AppError("forbidden");
  if (route2.body !== "none" && hasBody(request)) raw = await readBody(request, BODY_RULES[route2.body].limit);
  let session = null;
  if (route2.auth === "token") {
    await authenticateToken(request.headers.authorization);
  } else if (route2.auth !== "public") {
    session = await sessionFromCookie(request.headers.cookie);
    if (!session) throw new AppError("unauthenticated");
    if (route2.auth === "owner" && !session.actor.is_owner) throw new AppError("forbidden");
  }
  let parsed = void 0;
  if (route2.body === "json" && raw.length) {
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      parsed = void 0;
    }
  }
  return route2.handler({ params, query: url.searchParams, json: parsed, raw, session, actor: session?.actor ?? NONE, request });
}
function send2(response, reply, head = false) {
  const headers = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...reply.headers
  };
  if (reply.raw !== void 0) {
    headers["content-type"] = reply.type ?? "application/octet-stream";
    response.writeHead(reply.status, { ...headers, "content-length": String(reply.raw.length) });
    response.end(head ? void 0 : reply.raw);
  } else if (reply.body !== void 0) {
    const text2 = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    headers["content-type"] = "application/json; charset=utf-8";
    response.writeHead(reply.status, { ...headers, "content-length": String(Buffer.byteLength(text2)) });
    response.end(head ? void 0 : text2);
  } else {
    response.writeHead(reply.status, headers);
    response.end();
  }
}
function errorReply(error) {
  if (error instanceof AppError) return { status: error.status, body: error.body(), headers: error.headers };
  if (error.code === "23503") {
    const missing = new AppError("not_found");
    return { status: missing.status, body: missing.body() };
  }
  if (error instanceof StorageDown) {
    const mapped = new AppError("storage_unavailable");
    return { status: mapped.status, body: mapped.body() };
  }
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
  const internal = new AppError("internal");
  return { status: internal.status, body: internal.body() };
}
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};
var clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "client");
var PAGES = [/^\/$/, /^\/sign-in$/, /^\/library$/, /^\/profile$/, /^\/projects\/[^/]+$/, /^\/review\/[^/]+$/];
async function serveStatic(request) {
  const pathname = new URL(request.url ?? "/", "http://local").pathname;
  if (pathname.startsWith("/assets/")) {
    const file = path.join(clientDir, pathname);
    if (file.startsWith(clientDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return {
        status: 200,
        raw: fs.readFileSync(file),
        type: TYPES[path.extname(file)] ?? "application/octet-stream",
        headers: { "cache-control": "public, max-age=31536000, immutable" }
      };
    }
  }
  const page = PAGES.some((pattern) => pattern.test(pathname));
  if (page && pathname !== "/sign-in" && !pathname.startsWith("/review/")) {
    const session = await sessionFromCookie(request.headers.cookie);
    if (!session) return { status: 302, headers: { location: "/sign-in" } };
  }
  const shell = path.join(clientDir, "index.html");
  return { status: page ? 200 : 404, raw: fs.readFileSync(shell), type: TYPES[".html"], headers: { "cache-control": "no-cache" } };
}

// shared/keyframes.ts
var CURVES = ["linear", "eased"];
var PROPERTIES = ["x", "y", "scale", "rotation", "opacity"];
var PROPERTY_RANGE = {
  x: [-1e4, 1e4],
  y: [-1e4, 1e4],
  scale: [1, 1e3],
  rotation: [-3600, 3600],
  opacity: [0, 100]
};
function round2(value) {
  const scaled = Math.abs(value) * 100;
  const base = Math.floor(scaled);
  const up = scaled - base >= 0.5 - 1e-4;
  return Math.sign(value) * ((base + (up ? 1 : 0)) / 100) || 0;
}
function interpolate(diamonds, frame2) {
  if (!diamonds || diamonds.length === 0) return null;
  const sorted = [...diamonds].sort((a, b) => a.frame - b.frame);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  if (frame2 <= first.frame) return first.value;
  if (frame2 >= last.frame) return last.value;
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a && b && frame2 >= a.frame && frame2 <= b.frame) {
      const t = (frame2 - a.frame) / (b.frame - a.frame);
      const eased = a.curve === "eased" ? t * t * (3 - 2 * t) : t;
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value;
}

// shared/layers.ts
function frameSize(aspect) {
  return ASPECTS[aspect];
}
function defaultValue(property, size) {
  switch (property) {
    case "x":
      return size.width / 2;
    case "y":
      return size.height / 2;
    case "scale":
      return 100;
    case "rotation":
      return 0;
    case "opacity":
      return 100;
  }
}
function propertyValue(clip, property, frame2, size) {
  return interpolate(clip.keyframes[property], frame2 - clip.start_frame) ?? clip.base[property] ?? defaultValue(property, size);
}
function shownValue(clip, property, frame2, size) {
  return round2(propertyValue(clip, property, frame2, size));
}
function baseBox(clip, media, size) {
  if (clip.kind === "text") return { width: size.width * 0.6, height: size.height * 0.12 };
  if (clip.kind === "wav" || !clip.media_id) return null;
  const dims = media[clip.media_id];
  if (!dims?.width || !dims.height) return null;
  const fit = Math.min(size.width / dims.width, size.height / dims.height);
  return { width: dims.width * fit, height: dims.height * fit };
}
function layerOf(clip, frame2, media, size) {
  const box2 = baseBox(clip, media, size);
  if (!box2) return null;
  const scale = propertyValue(clip, "scale", frame2, size);
  return {
    clip_id: clip.id,
    row_id: clip.row_id,
    x: shownValue(clip, "x", frame2, size),
    y: shownValue(clip, "y", frame2, size),
    width: round2(box2.width * scale / 100),
    height: round2(box2.height * scale / 100),
    scale: round2(scale),
    rotation: shownValue(clip, "rotation", frame2, size),
    opacity: shownValue(clip, "opacity", frame2, size)
  };
}
function layersAt(frame2, clips, rows, media, size) {
  const position = new Map(rows.map((row) => [row.id, row.position]));
  return clips.filter((clip) => !clip.hidden && clip.start_frame <= frame2 && frame2 < clip.end_frame).sort((a, b) => (position.get(b.row_id) ?? 0) - (position.get(a.row_id) ?? 0)).flatMap((clip) => layerOf(clip, frame2, media, size) ?? []);
}

// shared/captions.ts
function cueLines(text2) {
  return text2.split(/\r?\n/);
}
function validCueText(text2) {
  const lines = cueLines(text2);
  return text2.trim().length > 0 && lines.length <= CUE_LINES_MAX && lines.every((line) => line.length > 0 && codePoints(line) <= CUE_LINE_MAX);
}

// server/captions.ts
var TIME_LINE = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2,}):(\d{2}):(\d{2}),(\d{3})$/;
var refuse = (message) => {
  throw invalid({ srt: message });
};
function millis(parts, from) {
  const [h, m, s, ms] = parts.slice(from, from + 4).map((part) => Number(part));
  return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 1e3 + (ms ?? 0);
}
function parseSrt(data, rate) {
  const bom = data.length >= 3 && data[0] === 239 && data[1] === 187 && data[2] === 191;
  let text2;
  try {
    text2 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bom ? data.subarray(3) : data);
  } catch {
    return refuse(SRT_COPY.utf8);
  }
  const firstBreak = text2.indexOf("\n");
  const eol = firstBreak > 0 && text2[firstBreak - 1] === "\r" ? "\r\n" : "\n";
  const lines = text2.split(/\r?\n/);
  const cues = [];
  let at = 0;
  const tooLong = (index) => {
    if (codePoints(lines[index] ?? "") > CUE_LINE_MAX) refuse(SRT_COPY.line(index + 1));
  };
  for (; ; ) {
    while (at < lines.length && lines[at] === "") at += 1;
    if (at >= lines.length) break;
    const number = cues.length + 1;
    if (number > SRT_CUES_MAX) refuse(SRT_COPY.cues);
    tooLong(at);
    const indexLine = lines[at] ?? "";
    at += 1;
    tooLong(at);
    const timing = TIME_LINE.exec(lines[at] ?? "");
    if (!/^\d+$/.test(indexLine) || !timing) refuse(SRT_COPY.time(number));
    at += 1;
    const startMs = millis(timing ?? [], 1);
    const endMs = millis(timing ?? [], 5);
    if (endMs < startMs) refuse(SRT_COPY.order(number));
    const start = msToFrames(rate, startMs);
    const end = msToFrames(rate, endMs);
    if (end - start < 1) refuse(SRT_COPY.short(number));
    const previous = cues[cues.length - 1];
    if (previous && start < previous.end_frame) refuse(SRT_COPY.overlap(number));
    const body = [];
    while (at < lines.length && lines[at] !== "") {
      tooLong(at);
      body.push(lines[at] ?? "");
      at += 1;
    }
    if (body.length > CUE_LINES_MAX) refuse(SRT_COPY.lines(number));
    const cueText2 = body.join("\n");
    if (!validCueText(cueText2)) refuse(SRT_COPY.time(number));
    cues.push({ start_frame: start, end_frame: end, text: cueText2, start_ms: startMs, end_ms: endMs });
  }
  return { cues, eol, bom };
}
async function exportSrt(projectId, rowId, rate, eol, bom) {
  const cues = await query(
    "SELECT start_frame, end_frame, text, orig_start_ms, orig_end_ms FROM captions WHERE project_id = $1 AND row_id = $2 ORDER BY start_frame, seq",
    [projectId, rowId]
  );
  const body = cues.map((cue, index) => {
    const start = cue.orig_start_ms ?? framesToMs(rate, cue.start_frame);
    const end = cue.orig_end_ms ?? framesToMs(rate, cue.end_frame);
    return `${index + 1}${eol}${srtTime(start)} --> ${srtTime(end)}${eol}${cueLines(cue.text).join(eol)}${eol}${eol}`;
  }).join("");
  return Buffer.concat([bom ? Buffer.from([239, 187, 191]) : Buffer.alloc(0), Buffer.from(body, "utf8")]);
}

// server/records.ts
function publicRow(row) {
  return { id: row.id, name: row.name, kind: row.kind, position: row.position, locked: row.locked };
}
function publicCaption(caption) {
  return { id: caption.id, row_id: caption.row_id, start_frame: caption.start_frame, end_frame: caption.end_frame, text: caption.text };
}

// server/timeline/model.ts
var Draft = class {
  projectId;
  rate;
  rows = /* @__PURE__ */ new Map();
  clips = /* @__PURE__ */ new Map();
  captions = /* @__PURE__ */ new Map();
  markers;
  aspect;
  firstRows = /* @__PURE__ */ new Map();
  firstClips = /* @__PURE__ */ new Map();
  firstCaptions = /* @__PURE__ */ new Map();
  firstMarkers = null;
  firstAspect = null;
  constructor(timeline) {
    this.projectId = timeline.projectId;
    this.rate = timeline.rate;
    this.aspect = timeline.aspect;
    this.markers = structuredClone(timeline.markers);
    for (const row of timeline.rows) this.rows.set(row.id, structuredClone(row));
    for (const clip of timeline.clips) this.clips.set(clip.id, structuredClone(clip));
    for (const caption of timeline.captions) this.captions.set(caption.id, structuredClone(caption));
  }
  rowsInOrder() {
    return [...this.rows.values()].sort((a, b) => a.position - b.position);
  }
  row(id) {
    const row = this.rows.get(id);
    if (!row) throw new AppError("not_found");
    return row;
  }
  clip(id) {
    const clip = this.clips.get(id);
    if (!clip) throw new AppError("not_found");
    return clip;
  }
  caption(id) {
    const caption = this.captions.get(id);
    if (!caption) throw new AppError("not_found");
    return caption;
  }
  /** Records the original of a row before it is first changed, and returns the live copy to change. */
  editRow(id) {
    const row = this.row(id);
    if (!this.firstRows.has(id)) this.firstRows.set(id, structuredClone(row));
    return row;
  }
  putRow(row) {
    if (!this.firstRows.has(row.id)) this.firstRows.set(row.id, this.rows.get(row.id) ? structuredClone(this.row(row.id)) : null);
    this.rows.set(row.id, row);
  }
  editClip(id) {
    const clip = this.clip(id);
    if (!this.firstClips.has(id)) this.firstClips.set(id, structuredClone(clip));
    return clip;
  }
  putClip(clip) {
    if (!this.firstClips.has(clip.id)) this.firstClips.set(clip.id, this.clips.get(clip.id) ? structuredClone(this.clip(clip.id)) : null);
    this.clips.set(clip.id, clip);
  }
  dropClip(id) {
    this.editClip(id);
    this.clips.delete(id);
  }
  editCaption(id) {
    const caption = this.caption(id);
    if (!this.firstCaptions.has(id)) this.firstCaptions.set(id, structuredClone(caption));
    return caption;
  }
  putCaption(caption) {
    if (!this.firstCaptions.has(caption.id)) {
      this.firstCaptions.set(caption.id, this.captions.get(caption.id) ? structuredClone(this.caption(caption.id)) : null);
    }
    this.captions.set(caption.id, caption);
  }
  dropCaption(id) {
    this.editCaption(id);
    this.captions.delete(id);
  }
  setMarkers(markers2) {
    this.firstMarkers ??= structuredClone(this.markers);
    this.markers = markers2;
  }
  setAspect(aspect) {
    this.firstAspect ??= this.aspect;
    this.aspect = aspect;
  }
  /** Everything that differs from the original: the persisted change set, the originals and what was created or removed. */
  diff() {
    const changedClips = [];
    const changedCaptions = [];
    const changedRows = [];
    const removed = [];
    const clipBefore = /* @__PURE__ */ new Map();
    const captionBefore = /* @__PURE__ */ new Map();
    const rowBefore = /* @__PURE__ */ new Map();
    for (const [id, before] of this.firstClips) {
      const now = this.clips.get(id) ?? null;
      if (JSON.stringify(before) === JSON.stringify(now)) continue;
      clipBefore.set(id, before);
      if (now) changedClips.push(now);
      else removed.push(id);
    }
    for (const [id, before] of this.firstCaptions) {
      const now = this.captions.get(id) ?? null;
      if (JSON.stringify(before) === JSON.stringify(now)) continue;
      captionBefore.set(id, before);
      if (now) changedCaptions.push(now);
      else removed.push(id);
    }
    for (const [id, before] of this.firstRows) {
      const now = this.rows.get(id) ?? null;
      if (JSON.stringify(before) === JSON.stringify(now)) continue;
      rowBefore.set(id, before);
      if (now) changedRows.push(now);
      else removed.push(id);
    }
    const markersChanged = this.firstMarkers !== null && JSON.stringify(this.firstMarkers) !== JSON.stringify(this.markers);
    const aspectChanged = this.firstAspect !== null && this.firstAspect !== this.aspect;
    return {
      clips: changedClips,
      captions: changedCaptions,
      rows: changedRows,
      removed,
      clipBefore,
      captionBefore,
      rowBefore,
      markersBefore: markersChanged ? this.firstMarkers : null,
      aspectBefore: aspectChanged ? this.firstAspect : null
    };
  }
};
function byTimelineOrder(rows) {
  const position = new Map(rows.map((row) => [row.id, row.position]));
  return (a, b) => a.start_frame - b.start_frame || (position.get(a.row_id) ?? 0) - (position.get(b.row_id) ?? 0) || (a.id < b.id ? -1 : 1);
}
function clipsOnRow(draft, rowId) {
  return [...draft.clips.values()].filter((clip) => clip.row_id === rowId).sort((a, b) => a.start_frame - b.start_frame);
}
function groupMembers(draft, groupId) {
  return [...draft.clips.values()].filter((clip) => clip.group_id === groupId).sort(byTimelineOrder([...draft.rows.values()]));
}
var overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
function findOverlap(draft, rowId, start, end, ignore) {
  for (const clip of clipsOnRow(draft, rowId)) {
    if (!ignore.has(clip.id) && overlaps(clip.start_frame, clip.end_frame, start, end)) return clip;
  }
  return null;
}
function assertUnlocked(draft, rowId) {
  const row = draft.row(rowId);
  if (row.locked) throw new AppError("row_locked", { row: row.name });
}
function timelineLength(draft) {
  let total = 0;
  for (const clip of draft.clips.values()) total = Math.max(total, clip.end_frame);
  for (const caption of draft.captions.values()) total = Math.max(total, caption.end_frame);
  return total;
}
function blockedBy(clip, reason) {
  return new AppError("blocked", { clip: clip.name, reason });
}
var inTheWay = (other) => BLOCKER.inTheWay(other.name);

// server/projects.ts
async function clipsOf(db, project) {
  return (await loadTimeline(db, project)).clips;
}
async function projectRecord(db, row, role) {
  const timeline = await loadTimeline(db, row);
  const draft = new Draft(timeline);
  const lastCut = await one(
    "SELECT id, name, total_frames FROM cuts WHERE project_id = $1 ORDER BY seq DESC LIMIT 1",
    [row.id],
    db
  );
  return {
    id: row.id,
    title: row.title,
    agency: row.agency,
    description: row.description,
    frame_rate: row.frame_rate,
    aspect_ratio: row.aspect_ratio,
    width: ASPECTS[row.aspect_ratio].width,
    height: ASPECTS[row.aspect_ratio].height,
    time_unit: row.time_unit,
    version: row.version,
    total_frames: timelineLength(draft),
    role,
    markers: timeline.markers,
    last_cut: lastCut ?? null
  };
}
async function markersOf(db, row) {
  const rate = rateOf(row.frame_rate);
  const rows = await query(
    "SELECT frame, label, legacy FROM markers WHERE project_id = $1 ORDER BY id",
    [row.id],
    db
  );
  return rows.map((marker) => markerFromRow(marker, rate)).sort((a, b) => a.frame - b.frame);
}
async function listProjects(actor) {
  const rows = await query(
    actor.is_owner ? "SELECT p.*, 'owner' AS role FROM projects p ORDER BY p.position" : "SELECT p.*, m.role FROM projects p JOIN members m ON m.project_id = p.id WHERE m.person_id = $1 ORDER BY p.position",
    actor.is_owner ? [] : [actor.id]
  );
  return Promise.all(rows.map((row) => projectRecord(pool, row, row.role)));
}
async function mediaDimsOf(db, clips) {
  const ids = [...new Set(clips.flatMap((clip) => clip.media_id ? [clip.media_id] : []))];
  if (!ids.length) return {};
  const rows = await query("SELECT id, kind, width, height, sha256 FROM media WHERE id = ANY($1)", [ids], db);
  return Object.fromEntries(rows.map(({ id, ...dims }) => [id, dims]));
}
async function membersOf(db, projectId) {
  const rows = await query(
    `SELECT p.id, p.name, p.email, p.handle, m.role FROM members m JOIN people p ON p.id = m.person_id
      WHERE m.project_id = $1 ORDER BY m.seq`,
    [projectId],
    db
  );
  return rows.map(({ role, ...person }) => ({ person, role }));
}
async function projectDetail(row, role) {
  const timeline = await loadTimeline(pool, row);
  return {
    project: await projectRecord(pool, row, role),
    rows: timeline.rows.map(publicRow),
    clips: timeline.clips,
    captions: timeline.captions.map(publicCaption),
    members: await membersOf(pool, row.id),
    media: await mediaDimsOf(pool, timeline.clips)
  };
}
async function createProject(actor, raw) {
  const input = typeof raw === "object" && raw !== null ? raw : {};
  const errors = {};
  const title = typeof input["title"] === "string" ? input["title"].trim() : "";
  if (!title || codePoints(title) > TITLE_MAX) errors["title"] = FIELD_ERRORS.title;
  if (!isRateLabel(input["frame_rate"])) errors["frame_rate"] = FIELD_ERRORS.frame_rate;
  if (!ASPECT_LABELS.includes(input["aspect_ratio"])) errors["aspect_ratio"] = FIELD_ERRORS.aspect_ratio;
  const agency = typeof input["agency"] === "string" ? input["agency"].trim() : "";
  const description = typeof input["description"] === "string" ? input["description"].trim() : "";
  if (codePoints(agency) > 80) errors["agency"] = FIELD_ERRORS.other;
  if (codePoints(description) > 500) errors["description"] = FIELD_ERRORS.other;
  if (Object.keys(errors).length) throw invalid(errors);
  const id = newId("p");
  const row = await tx(async (db) => {
    await db.query(
      "INSERT INTO projects (id, title, agency, description, frame_rate, aspect_ratio) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, title, agency, description, input["frame_rate"], input["aspect_ratio"]]
    );
    const rows = [["Titles", "video", 1], ["Picture", "video", 2], ["Audio", "audio", 3], ["Captions", "caption", 4]];
    for (const [name, kind, position] of rows) {
      await db.query("INSERT INTO rows (id, project_id, name, kind, position) VALUES ($1,$2,$3,$4,$5)", [newId("r"), id, name, kind, position]);
    }
    await db.query("INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,'owner')", [id, actor.id]);
    return one("SELECT * FROM projects WHERE id = $1", [id], db);
  });
  if (!row) throw notFound();
  return projectRecord(pool, row, "owner");
}

// server/comments.ts
function commentFromRow(row, clips) {
  const clip = row.pin_clip_id ? clips.get(row.pin_clip_id) : void 0;
  return {
    id: row.id,
    author_name: row.author_name,
    body: row.body,
    visibility: row.visibility,
    parent_id: row.parent_id,
    cut_id: row.cut_id,
    pin: {
      frame: row.pin_frame,
      row_id: clip ? clip.row_id : row.pin_row_id,
      clip_id: row.pin_clip_id,
      live_frame: clip && row.pin_offset !== null ? clip.start_frame + row.pin_offset : row.pin_frame
    },
    mentions: row.mentions,
    created_at: row.created_at.toISOString()
  };
}
async function pinClips(db, projectId) {
  const project = await loadProjectRow(db, projectId);
  if (!project) return /* @__PURE__ */ new Map();
  return new Map((await clipsOf(db, project)).map((clip) => [clip.id, clip]));
}
async function listComments(db, projectId, where = "", params = []) {
  const rows = await query(`SELECT * FROM comments WHERE project_id = $1 ${where} ORDER BY seq`, [projectId, ...params], db);
  const clips = await pinClips(db, projectId);
  return rows.map((row) => commentFromRow(row, clips));
}
async function applyPins(db, projectId, effects) {
  const before = /* @__PURE__ */ new Map();
  const after = /* @__PURE__ */ new Map();
  for (const effect of effects) {
    const rows = effect.kind === "shift" ? await query(
      "SELECT * FROM comments WHERE project_id=$1 AND pin_row_id=$2 AND pin_clip_id IS NULL AND pin_frame >= $3 FOR UPDATE",
      [projectId, effect.row_id, effect.from_frame],
      db
    ) : await query("SELECT * FROM comments WHERE project_id=$1 AND pin_clip_id=$2 FOR UPDATE", [projectId, effect.clip_id], db);
    for (const row of rows) {
      const next = effect.kind === "shift" ? row.pin_frame + effect.delta : effect.start_frame + (row.pin_offset ?? 0);
      if (next === row.pin_frame) continue;
      if (!before.has(row.id)) before.set(row.id, row.pin_frame);
      after.set(row.id, next);
      await db.query("UPDATE comments SET pin_frame = $2 WHERE id = $1", [row.id, next]);
    }
  }
  const toList = (map) => [...map].map(([id, frame2]) => ({ id, frame: frame2 }));
  return { ids: [...after.keys()], before: toList(before), after: toList(after) };
}
async function setPinFrames(db, pins) {
  for (const pin of pins) await db.query("UPDATE comments SET pin_frame = $2 WHERE id = $1", [pin.id, pin.frame]);
  return pins.map((pin) => pin.id);
}
async function commentsByIds(db, projectId, ids) {
  if (!ids.length) return [];
  return listComments(db, projectId, "AND id = ANY($2)", [ids]);
}
var MENTION = /(?<![\w@])@([A-Za-z0-9_]+)/g;
function mentionedHandles(body) {
  return [...new Set([...body.matchAll(MENTION)].map((match2) => (match2[1] ?? "").toLowerCase()))];
}
function str(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function parseNote(raw, allowEmpty = false) {
  const input = typeof raw === "object" && raw !== null ? raw : {};
  const body = typeof input["body"] === "string" ? input["body"] : "";
  const length = codePoints(body);
  const errors = {};
  if (length > NOTE_MAX || !allowEmpty && (length < 1 || body.trim().length === 0)) errors["body"] = FIELD_ERRORS.body;
  const frame2 = input["frame"];
  if (typeof frame2 !== "number" || !Number.isInteger(frame2) || frame2 < 0) errors["frame"] = FIELD_ERRORS.other;
  const visibility = input["visibility"];
  if (visibility !== "team" && visibility !== "review") errors["visibility"] = FIELD_ERRORS.other;
  if (Object.keys(errors).length) throw invalid(errors);
  return {
    body,
    frame: frame2,
    row_id: str(input["row_id"]),
    clip_id: str(input["clip_id"]),
    cut_id: str(input["cut_id"]),
    visibility,
    parent_id: str(input["parent_id"])
  };
}
async function projectHandles(db, projectId) {
  const rows = await query(
    `SELECT p.id, p.name, p.email, p.handle FROM people p
       WHERE p.is_owner OR p.id IN (SELECT person_id FROM members WHERE project_id = $1)`,
    [projectId],
    db
  );
  return new Map(rows.map((row) => [row.handle, row]));
}
async function defaultCut(db, projectId) {
  const link = await one("SELECT cut_id FROM review_links WHERE project_id = $1 ORDER BY seq DESC LIMIT 1", [projectId], db);
  if (link) return link.cut_id;
  return (await one("SELECT id FROM cuts WHERE project_id = $1 ORDER BY seq DESC LIMIT 1", [projectId], db))?.id ?? null;
}
async function postNote(projectId, actor, raw) {
  const note = parseNote(raw);
  if (!await loadProjectRow(pool, projectId)) throw notFound();
  const people = await projectHandles(pool, projectId);
  const handles = mentionedHandles(note.body);
  if (handles.length > MENTIONS_MAX) throw invalid({ mentions: FIELD_ERRORS.mentions });
  const unknown = handles.find((handle) => !people.has(handle));
  if (unknown) throw invalid({ mention: mentionCopy(unknown) });
  const created = await tx(async (db) => {
    const clip = note.clip_id ? (await pinClips(db, projectId)).get(note.clip_id) : void 0;
    if (note.clip_id && !clip) throw notFound();
    const parent = note.parent_id ? await one("SELECT author_id FROM comments WHERE id = $1 AND project_id = $2", [note.parent_id, projectId], db) : void 0;
    if (note.parent_id && !parent) throw notFound();
    const cutId = note.visibility === "review" ? note.cut_id ?? await defaultCut(db, projectId) : note.cut_id;
    let offset = null;
    if (clip) {
      const snapshot = cutId ? await one("SELECT snapshot FROM cuts WHERE id = $1 AND project_id = $2", [cutId, projectId], db) : void 0;
      const inCut = snapshot?.snapshot.clips.find((candidate) => candidate.id === clip.id);
      offset = note.frame - (inCut ?? clip).start_frame;
    }
    const id = newId("n");
    await db.query(
      `INSERT INTO comments (id, project_id, author_id, author_name, body, visibility, parent_id, cut_id, pin_frame,
         pin_row_id, pin_clip_id, pin_offset, mentions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, projectId, actor.id, actor.name, note.body, note.visibility, note.parent_id, cutId, note.frame, note.row_id ?? clip?.row_id ?? null, note.clip_id, offset, JSON.stringify(handles)]
    );
    await db.query("DELETE FROM comment_drafts WHERE project_id = $1 AND person_id = $2", [projectId, actor.id]);
    const recipients = /* @__PURE__ */ new Set();
    for (const handle of handles) {
      const person = people.get(handle);
      if (person) recipients.add(person.id);
    }
    if (parent?.author_id) recipients.add(parent.author_id);
    recipients.delete(actor.id);
    await enqueueNotifications(db, [...recipients], projectId, actor.name, note.frame, note.body);
    return (await listComments(db, projectId, "AND id = $2", [id]))[0];
  });
  if (!created) throw notFound();
  hub.toProject(projectId, { type: "comment", comment: created });
  return created;
}

// server/cuts.ts
async function cutRecord(db, row) {
  const approvals = await query("SELECT name, at FROM approvals WHERE cut_id = $1 ORDER BY id", [row.id], db);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    total_frames: row.total_frames,
    shared: row.shared,
    approvals: approvals.map((approval) => ({ name: approval.name, at: approval.at.toISOString() })),
    created_at: row.created_at.toISOString()
  };
}
async function listCuts(projectId) {
  const rows = await query("SELECT id, name, version, total_frames, shared, created_at FROM cuts WHERE project_id = $1 ORDER BY seq", [projectId]);
  return Promise.all(rows.map((row) => cutRecord(pool, row)));
}
async function cutById(db, projectId, cutId) {
  const row = await one("SELECT id, name, version, total_frames, shared, created_at FROM cuts WHERE id = $1 AND project_id = $2", [cutId, projectId], db);
  if (!row) throw notFound();
  return cutRecord(db, row);
}
async function nameCut(projectId, raw) {
  const name = typeof raw === "object" && raw !== null ? raw["name"] : void 0;
  if (typeof name !== "string" || name.trim().length === 0 || codePoints(name) > NAME_MAX) throw invalid({ name: FIELD_ERRORS.cutName });
  const id = newId("k");
  try {
    await tx(async (db) => {
      const project = await loadProjectRow(db, projectId, true);
      if (!project) throw notFound();
      const timeline = await loadTimeline(db, project);
      const snapshot = { rows: timeline.rows, clips: timeline.clips, captions: timeline.captions };
      await db.query(
        "INSERT INTO cuts (id, project_id, name, version, total_frames, snapshot) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, projectId, name, project.version, timelineLength(new Draft(timeline)), JSON.stringify(snapshot)]
      );
    });
  } catch (error) {
    if (error.code === "23505") throw new AppError("cut_name_taken", { cut: name });
    throw error;
  }
  return cutById(pool, projectId, id);
}
async function cutSnapshot(projectId, cutId) {
  const row = await one("SELECT * FROM cuts WHERE id = $1 AND project_id = $2", [cutId, projectId]);
  if (!row) throw notFound();
  return { cut: await cutRecord(pool, row), rows: row.snapshot.rows.map(publicRow), clips: row.snapshot.clips, captions: row.snapshot.captions.map(publicCaption) };
}
var place = (clip) => ({ row_id: clip.row_id, start_frame: clip.start_frame, end_frame: clip.end_frame });
async function compareCuts(projectId, fromId, toId) {
  const [from, to] = await Promise.all([cutSnapshot(projectId, fromId), cutSnapshot(projectId, toId)]);
  const before = new Map(from.clips.map((clip) => [clip.id, clip]));
  const after = new Map(to.clips.map((clip) => [clip.id, clip]));
  const changed = to.clips.flatMap((clip) => {
    const old = before.get(clip.id);
    if (!old || JSON.stringify(place(old)) === JSON.stringify(place(clip))) return [];
    return [{ clip_id: clip.id, from: place(old), to: place(clip) }];
  });
  return {
    added: to.clips.filter((clip) => !before.has(clip.id)).map((clip) => clip.id),
    removed: from.clips.filter((clip) => !after.has(clip.id)).map((clip) => clip.id),
    changed,
    frame_delta: to.cut.total_frames - from.cut.total_frames
  };
}
async function approve(projectId, cutId, actor) {
  const cut = await cutById(pool, projectId, cutId);
  await query("INSERT INTO approvals (cut_id, name) VALUES ($1,$2) ON CONFLICT (cut_id, name) DO NOTHING", [cutId, actor.name]);
  return { cut_id: cut.id, approvals: (await cutById(pool, projectId, cutId)).approvals };
}

// server/members.ts
var ASSIGNABLE = ["editor", "commenter"];
function assignableRole(raw) {
  const role = typeof raw === "object" && raw !== null ? raw["role"] : void 0;
  const found = ASSIGNABLE.find((candidate) => candidate === role);
  if (!found) throw invalid({ role: FIELD_ERRORS.other });
  return found;
}
async function memberOf(projectId, personId) {
  const member = (await membersOf(pool, projectId)).find((candidate) => candidate.person.id === personId);
  if (!member) throw notFound();
  return member;
}
async function addMember(projectId, raw) {
  const email = typeof raw === "object" && raw !== null ? raw["email"] : void 0;
  const role = assignableRole(raw);
  const person = typeof email === "string" ? await one("SELECT id FROM people WHERE lower(email) = lower($1)", [email.trim()]) : void 0;
  if (!person) throw invalid({ email: FIELD_ERRORS.email });
  const added = await one("INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING person_id", [projectId, person.id, role]);
  if (!added) throw invalid({ email: FIELD_ERRORS.other });
  return memberOf(projectId, person.id);
}
async function changeRole(projectId, personId, raw) {
  const role = assignableRole(raw);
  const changed = await one("UPDATE members SET role = $3 WHERE project_id = $1 AND person_id = $2 AND role <> 'owner' RETURNING person_id", [projectId, personId, role]);
  if (!changed) throw notFound();
  hub.roleChanged(projectId, personId, role);
  return memberOf(projectId, personId);
}
async function removeMember(projectId, personId) {
  const removed = await one("DELETE FROM members WHERE project_id = $1 AND person_id = $2 AND role <> 'owner' RETURNING person_id", [projectId, personId]);
  if (!removed) throw notFound();
  hub.roleChanged(projectId, personId, null);
}

// server/ops.ts
import { randomUUID } from "node:crypto";

// server/upgrade.ts
async function upgradeProject(client, projectId) {
  const project = await loadProjectRow(client, projectId, true);
  if (!project || project.time_unit !== "seconds") return;
  const rate = rateOf(project.frame_rate);
  const clips = await query("SELECT * FROM clips WHERE project_id = $1 AND legacy IS NOT NULL", [projectId], client);
  for (const row of clips) {
    const clip = clipFromRow(row, rate);
    await client.query(
      "UPDATE clips SET start_frame=$2, end_frame=$3, source_in=$4, source_out=$5, legacy=NULL WHERE id=$1",
      [clip.id, clip.start_frame, clip.end_frame, clip.source_in, clip.source_out]
    );
  }
  const captions = await query("SELECT * FROM captions WHERE project_id = $1 AND legacy IS NOT NULL", [projectId], client);
  for (const row of captions) {
    const caption = captionFromRow(row, rate);
    await client.query("UPDATE captions SET start_frame=$2, end_frame=$3, legacy=NULL WHERE id=$1", [caption.id, caption.start_frame, caption.end_frame]);
  }
  const markers2 = await query("SELECT id, frame, label, legacy FROM markers WHERE project_id = $1 AND legacy IS NOT NULL", [projectId], client);
  for (const row of markers2) {
    await client.query("UPDATE markers SET frame=$2, legacy=NULL WHERE id=$1", [row.id, markerFromRow(row, rate).frame]);
  }
  const pins = await query("SELECT id, legacy FROM comments WHERE project_id = $1 AND legacy IS NOT NULL", [projectId], client);
  for (const pin of pins) {
    await client.query("UPDATE comments SET pin_frame = $2, legacy = NULL WHERE id = $1", [pin.id, framesOfSeconds(rate, pin.legacy)]);
  }
  await client.query("UPDATE projects SET time_unit = 'frames' WHERE id = $1", [projectId]);
}
async function upgradeOlderProjects() {
  const older = await query("SELECT id FROM projects WHERE time_unit = 'seconds'", [], pool);
  for (const { id } of older) await tx((client) => upgradeProject(client, id));
}

// server/timeline/effects.ts
var edit = (type = "edit") => ({ summary: { type }, stopped: null, pins: [], extraTouched: [] });

// server/timeline/engine.ts
var DEFAULT_TEXT = { text_colour: "ffffff", box_colour: "000000", font_weight: 600 };
var NAME_MAX2 = 60;
function sourceLimit(draft, clip, ctx) {
  if (clip.kind === "text") return Number.POSITIVE_INFINITY;
  if (clip.kind === "png") return secondsToFrames(draft.rate, BigInt(PNG_SOURCE_SECONDS), 1n);
  const media = clip.media_id ? ctx.media.get(clip.media_id) : void 0;
  return media ? secondsToFrames(draft.rate, media.src_num, media.src_den) : clip.source_out;
}
function sourceFramesOf(draft, media) {
  return media.kind === "png" ? secondsToFrames(draft.rate, BigInt(PNG_CLIP_SECONDS), 1n) : secondsToFrames(draft.rate, media.src_num, media.src_den);
}
function clipLabel(name) {
  return [...name].slice(0, NAME_MAX2).join("");
}
function captionName(draft, caption) {
  const ordered = [...draft.captions.values()].filter((candidate) => candidate.row_id === caption.row_id).sort((a, b) => a.start_frame - b.start_frame);
  return `Caption ${ordered.findIndex((candidate) => candidate.id === caption.id) + 1}`;
}
function touchRow(draft, clip) {
  assertUnlocked(draft, clip.row_id);
}
function rowAccepts(row, clip) {
  if (clip.kind === "wav") return row.kind === "audio";
  return row.kind === "video";
}
function ripple(draft, source, editPoint, delta, ignore) {
  const shifting = /* @__PURE__ */ new Map();
  for (const clip of clipsOnRow(draft, source.row_id)) {
    if (!ignore.has(clip.id) && clip.start_frame >= editPoint) shifting.set(clip.id, clip);
  }
  for (const clip of [...shifting.values()]) {
    if (clip.group_id) {
      for (const member of groupMembers(draft, clip.group_id)) if (!ignore.has(member.id)) shifting.set(member.id, member);
    }
  }
  for (const clip of shifting.values()) assertUnlocked(draft, clip.row_id);
  const moving = /* @__PURE__ */ new Set([...shifting.keys(), ...ignore]);
  for (const clip of shifting.values()) {
    if (clip.start_frame + delta < 0) throw blockedBy(clip, BLOCKER.timelineStart);
    const hit = findOverlap(draft, clip.row_id, clip.start_frame + delta, clip.end_frame + delta, moving);
    if (hit) throw blockedBy(clip, inTheWay(hit));
  }
  for (const clip of shifting.values()) {
    const live = draft.editClip(clip.id);
    live.start_frame += delta;
    live.end_frame += delta;
  }
  return { kind: "shift", row_id: source.row_id, from_frame: editPoint, delta };
}
function fixGroupAfterRemoval(draft, groupId) {
  if (!groupId) return;
  const rest = groupMembers(draft, groupId);
  if (rest.length === 1 && rest[0]) draft.editClip(rest[0].id).group_id = null;
}
function applyBody(draft, body, ctx) {
  switch (body.type) {
    case "add_clip":
      return addClip(draft, body, ctx);
    case "add_text":
      return addText(draft, body);
    case "move":
      return move(draft, body);
    case "trim":
      return trimBody(draft, body, ctx);
    case "split":
      return split(draft, body);
    case "remove":
      return remove(draft, body);
    case "set_hidden": {
      const clip = draft.editClip(body.clip_id);
      touchRow(draft, clip);
      clip.hidden = body.hidden;
      return { ...edit(body.hidden ? "hide" : "show"), summary: { type: body.hidden ? "hide" : "show", clip_name: clip.name } };
    }
    case "set_speed":
      return setSpeed(draft, body);
    case "group":
      return group(draft, body);
    case "ungroup":
      return ungroup(draft, body);
    case "add_row": {
      const position = Math.max(0, ...[...draft.rows.values()].map((row) => row.position)) + 1;
      draft.putRow({ id: newId("r"), name: body.name, kind: body.kind, position, locked: false, srt_eol: "\n", srt_bom: false });
      return edit();
    }
    case "reorder_row":
      return reorderRow(draft, body.row_id, body.position);
    case "lock_row":
      draft.editRow(body.row_id).locked = body.locked;
      return edit();
    case "set_keyframe":
      return setKeyframe(draft, body);
    case "remove_keyframe": {
      const clip = draft.editClip(body.clip_id);
      touchRow(draft, clip);
      const kept = (clip.keyframes[body.property] ?? []).filter((diamond) => diamond.frame !== body.frame);
      if (kept.length === (clip.keyframes[body.property] ?? []).length) throw invalid({ frame: FIELD_ERRORS.other });
      if (kept.length) clip.keyframes[body.property] = kept;
      else delete clip.keyframes[body.property];
      return edit();
    }
    case "add_marker": {
      const markers2 = draft.markers.filter((marker) => marker.frame !== body.frame);
      markers2.push({ frame: body.frame, label: body.label });
      draft.setMarkers(markers2.sort((a, b) => a.frame - b.frame));
      return edit();
    }
    case "set_layer":
      return setLayer(draft, body);
    case "caption_add":
      return captionAdd(draft, body);
    case "caption_edit":
      return captionEdit(draft, body);
    case "caption_remove": {
      const caption = draft.editCaption(body.caption_id);
      assertUnlocked(draft, caption.row_id);
      draft.dropCaption(caption.id);
      return edit();
    }
    case "apply_kit": {
      if (!ctx.kit) throw new AppError("not_found");
      for (const clip of draft.clips.values()) {
        if (clip.kind !== "text") continue;
        assertUnlocked(draft, clip.row_id);
        const live = draft.editClip(clip.id);
        live.text_colour = ctx.kit.text_colour;
        live.box_colour = ctx.kit.box_colour;
        live.font_weight = ctx.kit.font_weight;
      }
      return edit();
    }
    case "set_aspect":
      return setAspect(draft, body.aspect_ratio);
    case "restore_cut":
      return restoreCut(draft, ctx);
    case "import_captions":
      return importCaptions(draft, body.row_id, body.cues, body.eol, body.bom);
  }
}
function addClip(draft, body, ctx) {
  const media = ctx.media.get(body.media_id);
  if (!media) throw new AppError("not_found");
  const row = draft.row(body.row_id);
  assertUnlocked(draft, row.id);
  const length = sourceFramesOf(draft, media);
  const clip = {
    id: newId("c"),
    row_id: row.id,
    name: clipLabel(media.name.replace(/\.[^.]+$/, "")),
    kind: media.kind,
    media_id: media.id,
    start_frame: body.start_frame,
    end_frame: body.start_frame + length,
    source_in: 0,
    source_out: length,
    speed_percent: 100,
    hidden: false,
    group_id: null,
    text: null,
    text_colour: null,
    box_colour: null,
    font_weight: null,
    keyframes: {},
    base: {}
  };
  if (!rowAccepts(row, clip)) throw invalid({ row_id: FIELD_ERRORS.other });
  const hit = findOverlap(draft, row.id, clip.start_frame, clip.end_frame, /* @__PURE__ */ new Set());
  if (hit) throw blockedBy(clip, inTheWay(hit));
  draft.putClip(clip);
  return { ...edit("add"), summary: { type: "add", clip_name: clip.name } };
}
function addText(draft, body) {
  const row = draft.row(body.row_id);
  if (row.kind !== "video") throw invalid({ row_id: FIELD_ERRORS.other });
  assertUnlocked(draft, row.id);
  const clip = {
    id: newId("c"),
    row_id: row.id,
    name: clipLabel(body.text),
    kind: "text",
    media_id: null,
    start_frame: body.start_frame,
    end_frame: body.end_frame,
    source_in: 0,
    source_out: body.end_frame - body.start_frame,
    speed_percent: 100,
    hidden: false,
    group_id: null,
    text: body.text,
    ...DEFAULT_TEXT,
    keyframes: {},
    base: {}
  };
  const hit = findOverlap(draft, row.id, clip.start_frame, clip.end_frame, /* @__PURE__ */ new Set());
  if (hit) throw blockedBy(clip, inTheWay(hit));
  draft.putClip(clip);
  return { ...edit("add"), summary: { type: "add", clip_name: clip.name } };
}
function move(draft, body) {
  const clip = draft.clip(body.clip_id);
  const target = draft.row(body.row_id);
  const length = clip.end_frame - clip.start_frame;
  const from = { start: clip.start_frame, row: clip.row_id };
  if (clip.group_id) {
    if (target.id !== clip.row_id) throw invalid({ row_id: FIELD_ERRORS.other });
    return moveGroup(draft, clip, body.start_frame - clip.start_frame);
  }
  assertUnlocked(draft, clip.row_id);
  if (target.id !== clip.row_id) {
    if (!rowAccepts(target, clip)) throw invalid({ row_id: FIELD_ERRORS.other });
    assertUnlocked(draft, target.id);
    if (findOverlap(draft, target.id, body.start_frame, body.start_frame + length, /* @__PURE__ */ new Set([clip.id]))) {
      throw blockedBy(clip, BLOCKER.targetRow);
    }
    const live2 = draft.editClip(clip.id);
    live2.row_id = target.id;
    live2.start_frame = body.start_frame;
    live2.end_frame = body.start_frame + length;
    return moved(clip.name, live2.start_frame, from, live2, null);
  }
  const requested = body.start_frame;
  if (requested === clip.start_frame) throw invalid({ start_frame: FIELD_ERRORS.other });
  const others = clipsOnRow(draft, clip.row_id).filter((other) => other.id !== clip.id);
  let final = requested;
  let blocker = null;
  if (requested > clip.start_frame) {
    const next = others.find((other) => other.start_frame >= clip.end_frame);
    if (next && requested + length > next.start_frame) {
      final = next.start_frame - length;
      blocker = next;
    }
  } else {
    const previous = [...others].reverse().find((other) => other.end_frame <= clip.start_frame);
    if (previous && requested < previous.end_frame) {
      final = previous.end_frame;
      blocker = previous;
    }
  }
  if (final === clip.start_frame && blocker) throw blockedBy(clip, inTheWay(blocker));
  const live = draft.editClip(clip.id);
  live.start_frame = final;
  live.end_frame = final + length;
  return moved(clip.name, final, from, live, blocker ? { at_frame: final, reason: inTheWay(blocker) } : null);
}
function moved(name, at, from, live, stopped) {
  const delta = live.start_frame - from.start;
  return {
    summary: { type: "move", clip_name: name, at_frame: at },
    stopped,
    steps: {
      forward: { k: "shift", clip_id: live.id, clip_name: name, delta, row_id: live.row_id === from.row ? null : live.row_id },
      inverse: { k: "shift", clip_id: live.id, clip_name: name, delta: -delta, row_id: live.row_id === from.row ? null : from.row }
    },
    pins: [],
    extraTouched: []
  };
}
function moveGroup(draft, clip, delta) {
  if (delta === 0) throw invalid({ start_frame: FIELD_ERRORS.other });
  shiftGroup(draft, clip, delta, "group");
  const live = draft.clip(clip.id);
  return moved(clip.name, live.start_frame, { start: clip.start_frame, row: clip.row_id }, live, null);
}
function shiftGroup(draft, clip, delta, mode) {
  const members = clip.group_id ? groupMembers(draft, clip.group_id) : [clip];
  const ids = new Set(members.map((member) => member.id));
  for (const member of members) {
    const row = draft.row(member.row_id);
    const reason = row.locked ? BLOCKER.locked(row.name) : member.start_frame + delta < 0 ? BLOCKER.timelineStart : (() => {
      const hit2 = findOverlap(draft, member.row_id, member.start_frame + delta, member.end_frame + delta, ids);
      return hit2 ? inTheWay(hit2) : null;
    })();
    if (reason === null) continue;
    if (mode === "group") throw new AppError("group_blocked", { member: member.name, reason });
    const hit = findOverlap(draft, member.row_id, member.start_frame + delta, member.end_frame + delta, ids);
    if (row.locked) throw new AppError("row_locked", { row: row.name });
    throw new AppError("undo_blocked", { clip: hit?.name ?? member.name, row: row.name });
  }
  for (const member of members) {
    const live = draft.editClip(member.id);
    live.start_frame += delta;
    live.end_frame += delta;
  }
}
function trimClip(draft, clip, edge, delta, ctx, free) {
  const others = clipsOnRow(draft, clip.row_id).filter((other) => other.id !== clip.id);
  const limit = sourceLimit(draft, clip, ctx);
  let applied = delta;
  let reason = null;
  const speed = clip.speed_percent;
  const clamp = (value, why) => {
    if (value !== applied) {
      applied = value;
      reason = why;
    }
  };
  if (edge === "end") {
    if (delta > 0) {
      const next = free ? void 0 : others.find((other) => other.start_frame >= clip.end_frame);
      if (next) clamp(Math.min(applied, next.start_frame - clip.end_frame), inTheWay(next));
      const room = limit - clip.source_out;
      if (sourceAtSpeed(applied, speed) > room) clamp(lengthAtSpeed(room, speed), BLOCKER.sourceEnd);
    } else {
      const shortest = 1 - (clip.end_frame - clip.start_frame);
      clamp(Math.max(applied, shortest), BLOCKER.newLength);
    }
    const sourceDelta2 = sourceAtSpeed(applied, speed);
    return { start: clip.start_frame, end: clip.end_frame + applied, sourceIn: clip.source_in, sourceOut: clip.source_out + sourceDelta2, reason };
  }
  if (delta < 0) {
    const previous = [...others].reverse().find((other) => other.end_frame <= clip.start_frame);
    const floor = previous ? previous.end_frame : 0;
    if (clip.start_frame + applied < floor) clamp(floor - clip.start_frame, previous ? inTheWay(previous) : BLOCKER.timelineStart);
    if (clip.source_in + sourceAtSpeed(applied, speed) < 0) clamp(-lengthAtSpeed(clip.source_in, speed), BLOCKER.sourceStart);
  } else {
    clamp(Math.min(applied, clip.end_frame - clip.start_frame - 1), BLOCKER.newLength);
  }
  const sourceDelta = sourceAtSpeed(applied, speed);
  return { start: clip.start_frame + applied, end: clip.end_frame, sourceIn: clip.source_in + sourceDelta, sourceOut: clip.source_out, reason };
}
function trimBody(draft, body, ctx) {
  const clip = draft.clip(body.clip_id);
  if (body.ripple && body.edge !== "end") throw invalid({ ripple: FIELD_ERRORS.other });
  if (body.ripple && clip.group_id) throw invalid({ ripple: FIELD_ERRORS.other });
  const members = clip.group_id ? groupMembers(draft, clip.group_id) : [clip];
  const results = /* @__PURE__ */ new Map();
  for (const member of members) {
    const row = draft.row(member.row_id);
    if (row.locked) {
      if (clip.group_id) throw new AppError("group_blocked", { member: member.name, reason: BLOCKER.locked(row.name) });
      throw new AppError("row_locked", { row: row.name });
    }
    const result = trimClip(draft, member, body.edge, body.delta_frames, ctx, body.ripple);
    const changed = result.start !== member.start_frame || result.end !== member.end_frame;
    if (clip.group_id && (result.reason || !changed)) {
      throw new AppError("group_blocked", { member: member.name, reason: result.reason ?? BLOCKER.newLength });
    }
    results.set(member.id, result);
  }
  const own = results.get(clip.id);
  if (!own) throw new AppError("not_found");
  const appliedDelta = body.edge === "end" ? own.end - clip.end_frame : own.start - clip.start_frame;
  if (appliedDelta === 0) throw blockedBy(clip, own.reason ?? BLOCKER.newLength);
  const pins = [];
  const editPoint = clip.end_frame;
  for (const member of members) {
    const result = results.get(member.id);
    if (!result) continue;
    const live = draft.editClip(member.id);
    live.start_frame = result.start;
    live.end_frame = result.end;
    live.source_in = result.sourceIn;
    live.source_out = result.sourceOut;
  }
  if (body.ripple) pins.push(ripple(draft, clip, editPoint, appliedDelta, /* @__PURE__ */ new Set([clip.id])));
  const at = body.edge === "end" ? own.end : own.start;
  const effect = {
    summary: { type: "trim", clip_name: clip.name, at_frame: at },
    stopped: own.reason ? { at_frame: at, reason: own.reason } : null,
    pins,
    extraTouched: []
  };
  if (!body.ripple) {
    effect.steps = {
      forward: { k: "trim", clip_id: clip.id, clip_name: clip.name, edge: body.edge, delta: appliedDelta },
      inverse: { k: "trim", clip_id: clip.id, clip_name: clip.name, edge: body.edge, delta: -appliedDelta }
    };
  }
  return effect;
}
function rebase(diamonds, offset) {
  if (!diamonds?.length) return void 0;
  const later = diamonds.filter((diamond) => diamond.frame >= offset).map((diamond) => ({ ...diamond, frame: diamond.frame - offset }));
  if (later.some((diamond) => diamond.frame === 0)) return later;
  const held = interpolate(diamonds, offset);
  const before = [...diamonds].sort((a, b) => a.frame - b.frame).filter((diamond) => diamond.frame < offset).pop();
  return held === null ? later : [{ frame: 0, value: held, curve: before?.curve ?? "linear" }, ...later];
}
function splitClip(draft, clip, at, rightId) {
  const live = draft.editClip(clip.id);
  const sourceSplit = live.source_in + sourceAtSpeed(at - live.start_frame, live.speed_percent);
  const right = structuredClone(live);
  right.id = rightId;
  right.start_frame = at;
  right.source_in = sourceSplit;
  right.keyframes = {};
  for (const property of Object.keys(live.keyframes)) {
    const diamonds = rebase(live.keyframes[property], at - live.start_frame);
    if (diamonds) right.keyframes[property] = diamonds;
  }
  live.end_frame = at;
  live.source_out = sourceSplit;
  draft.putClip(right);
  return right;
}
function split(draft, body) {
  const clip = draft.clip(body.clip_id);
  touchRow(draft, clip);
  if (body.at_frame <= clip.start_frame || body.at_frame >= clip.end_frame) throw invalid({ at_frame: FIELD_ERRORS.other });
  const rightId = newId("c");
  splitClip(draft, clip, body.at_frame, rightId);
  return {
    summary: { type: "split", clip_name: clip.name, at_frame: body.at_frame },
    stopped: null,
    steps: {
      forward: { k: "resplit", clip_id: clip.id, clip_name: clip.name, at_frame: body.at_frame, right_id: rightId },
      inverse: { k: "join", left_id: clip.id, right_id: rightId, left_name: clip.name }
    },
    pins: [],
    extraTouched: [rightId]
  };
}
function remove(draft, body) {
  const clip = draft.clip(body.clip_id);
  touchRow(draft, clip);
  const pins = [{ kind: "freeze", clip_id: clip.id, start_frame: clip.start_frame }];
  const length = clip.end_frame - clip.start_frame;
  const groupId = clip.group_id;
  draft.dropClip(clip.id);
  fixGroupAfterRemoval(draft, groupId);
  if (body.ripple) pins.push(ripple(draft, clip, clip.end_frame, -length, /* @__PURE__ */ new Set([clip.id])));
  return { summary: { type: "remove", clip_name: clip.name }, stopped: null, pins, extraTouched: groupId ? [`g:${groupId}`] : [] };
}
function setSpeed(draft, body) {
  const clip = draft.clip(body.clip_id);
  if (clip.kind === "text") throw invalid({ clip_id: FIELD_ERRORS.other });
  touchRow(draft, clip);
  const length = Math.max(1, lengthAtSpeed(clip.source_out - clip.source_in, body.speed_percent));
  if (findOverlap(draft, clip.row_id, clip.start_frame, clip.start_frame + length, /* @__PURE__ */ new Set([clip.id]))) {
    throw blockedBy(clip, BLOCKER.newLength);
  }
  const live = draft.editClip(clip.id);
  live.speed_percent = body.speed_percent;
  live.end_frame = clip.start_frame + length;
  return edit("speed");
}
function group(draft, body) {
  const chosen = body.clip_ids.map((id2) => draft.clip(id2));
  const groupIds = new Set(chosen.flatMap((clip) => clip.group_id ? [clip.group_id] : []));
  const members = new Map(chosen.map((clip) => [clip.id, clip]));
  for (const id2 of groupIds) for (const member of groupMembers(draft, id2)) members.set(member.id, member);
  for (const member of members.values()) touchRow(draft, member);
  const id = newId("g");
  for (const member of members.values()) draft.editClip(member.id).group_id = id;
  return { ...edit("group"), extraTouched: [...groupIds].map((existing) => `g:${existing}`) };
}
function ungroup(draft, body) {
  const members = groupMembers(draft, body.group_id);
  if (!members.length) throw new AppError("not_found");
  for (const member of members) touchRow(draft, member);
  for (const member of members) draft.editClip(member.id).group_id = null;
  return { ...edit("ungroup"), extraTouched: [`g:${body.group_id}`] };
}
function reorderRow(draft, rowId, position) {
  const ordered = draft.rowsInOrder();
  const row = draft.row(rowId);
  const without = ordered.filter((candidate) => candidate.id !== rowId);
  without.splice(Math.min(position, ordered.length) - 1, 0, row);
  without.forEach((candidate, index) => {
    if (candidate.position !== index + 1) draft.editRow(candidate.id).position = index + 1;
  });
  return edit();
}
function setKeyframe(draft, body) {
  const clip = draft.editClip(body.clip_id);
  touchRow(draft, clip);
  const diamonds = (clip.keyframes[body.property] ?? []).filter((diamond) => diamond.frame !== body.frame);
  diamonds.push({ frame: body.frame, value: body.value, curve: body.curve });
  clip.keyframes[body.property] = diamonds.sort((a, b) => a.frame - b.frame);
  return edit("set_keyframe");
}
function setLayer(draft, body) {
  const clip = draft.editClip(body.clip_id);
  if (clip.kind === "wav") throw invalid({ clip_id: FIELD_ERRORS.other });
  touchRow(draft, clip);
  if (body.frame >= clip.end_frame - clip.start_frame) throw invalid({ frame: FIELD_ERRORS.other });
  for (const property of ["x", "y", "scale"]) {
    const value = body[property];
    if (value === void 0) continue;
    const existing = clip.keyframes[property];
    if (existing?.length) {
      const kept = existing.find((diamond) => diamond.frame === body.frame);
      clip.keyframes[property] = [...existing.filter((diamond) => diamond.frame !== body.frame), { frame: body.frame, value, curve: kept?.curve ?? "linear" }].sort(
        (a, b) => a.frame - b.frame
      );
    } else {
      clip.base[property] = value;
    }
  }
  return { ...edit("set_layer"), summary: { type: "set_layer", clip_name: clip.name } };
}
function captionRow(draft, rowId) {
  const row = draft.row(rowId);
  if (row.kind !== "caption") throw invalid({ row_id: FIELD_ERRORS.other });
  assertUnlocked(draft, row.id);
  return row;
}
function assertCaptionFree(draft, caption) {
  for (const other of draft.captions.values()) {
    if (other.id !== caption.id && other.row_id === caption.row_id && overlaps(other.start_frame, other.end_frame, caption.start_frame, caption.end_frame)) {
      throw new AppError("blocked", { clip: captionName(draft, caption), reason: BLOCKER.inTheWay(captionName(draft, other)) });
    }
  }
}
function captionAdd(draft, body) {
  captionRow(draft, body.row_id);
  if (body.end_frame <= body.start_frame) throw invalid({ end_frame: FIELD_ERRORS.other });
  const caption = {
    id: newId("cap"),
    row_id: body.row_id,
    start_frame: body.start_frame,
    end_frame: body.end_frame,
    text: body.text,
    orig_start_ms: null,
    orig_end_ms: null
  };
  draft.putCaption(caption);
  assertCaptionFree(draft, caption);
  return edit();
}
function captionEdit(draft, body) {
  const caption = draft.editCaption(body.caption_id);
  captionRow(draft, caption.row_id);
  if (body.end_frame <= body.start_frame) throw invalid({ end_frame: FIELD_ERRORS.other });
  if (caption.start_frame !== body.start_frame || caption.end_frame !== body.end_frame) {
    caption.orig_start_ms = null;
    caption.orig_end_ms = null;
  }
  caption.start_frame = body.start_frame;
  caption.end_frame = body.end_frame;
  caption.text = body.text;
  assertCaptionFree(draft, caption);
  return edit();
}
function roundScaled(value, num, den) {
  const exact = decimalToFraction(value.toFixed(6));
  return roundExact(exact.num * BigInt(num), exact.den * BigInt(den));
}
function setAspect(draft, aspect) {
  const from = frameSize(draft.aspect);
  const to = ASPECTS[aspect];
  for (const clip of draft.clips.values()) {
    const live = draft.editClip(clip.id);
    for (const [property, num, den] of [
      ["x", to.width, from.width],
      ["y", to.height, from.height]
    ]) {
      const base = live.base[property];
      if (base !== void 0) live.base[property] = roundScaled(base, num, den);
      const diamonds = live.keyframes[property];
      if (diamonds) live.keyframes[property] = diamonds.map((diamond) => ({ ...diamond, value: roundScaled(diamond.value, num, den) }));
    }
  }
  draft.setAspect(aspect);
  return { ...edit("set_aspect"), summary: { type: "set_aspect", aspect_ratio: aspect }, extraTouched: ["project"] };
}
function restoreCut(draft, ctx) {
  if (!ctx.cut) throw new AppError("not_found");
  const { snapshot, name } = ctx.cut;
  const wanted = new Map(snapshot.clips.map((clip) => [clip.id, clip]));
  for (const clip of [...draft.clips.values()]) if (!wanted.has(clip.id)) draft.dropClip(clip.id);
  for (const clip of wanted.values()) {
    if (draft.clips.has(clip.id)) draft.editClip(clip.id);
    draft.putClip(structuredClone(clip));
  }
  const wantedCaptions = new Map(snapshot.captions.map((caption) => [caption.id, caption]));
  for (const caption of [...draft.captions.values()]) if (!wantedCaptions.has(caption.id)) draft.dropCaption(caption.id);
  for (const caption of wantedCaptions.values()) {
    if (draft.captions.has(caption.id)) draft.editCaption(caption.id);
    draft.putCaption(structuredClone(caption));
  }
  const diff = draft.diff();
  for (const clip of [...diff.clips, ...[...diff.clipBefore.values()].flatMap((before) => before ? [before] : [])]) {
    assertUnlocked(draft, clip.row_id);
  }
  for (const caption of [...diff.captions, ...[...diff.captionBefore.values()].flatMap((before) => before ? [before] : [])]) {
    assertUnlocked(draft, caption.row_id);
  }
  const pins = [...diff.clipBefore.entries()].filter(([id, before]) => before && !draft.clips.has(id)).map(([id, before]) => ({ kind: "freeze", clip_id: id, start_frame: before?.start_frame ?? 0 }));
  return { summary: { type: "restore_cut", cut_name: name }, stopped: null, pins, extraTouched: ["project"] };
}
function importCaptions(draft, rowId, cues, eol, bom) {
  captionRow(draft, rowId);
  for (const caption of [...draft.captions.values()]) if (caption.row_id === rowId) draft.dropCaption(caption.id);
  for (const cue of cues) {
    draft.putCaption({
      id: newId("cap"),
      row_id: rowId,
      start_frame: cue.start_frame,
      end_frame: cue.end_frame,
      text: cue.text,
      orig_start_ms: cue.start_ms,
      orig_end_ms: cue.end_ms
    });
  }
  const row = draft.editRow(rowId);
  row.srt_eol = eol;
  row.srt_bom = bom;
  return { ...edit("import_captions"), srt: { row_id: rowId } };
}

// server/timeline/parse.ts
var FRAME_MAX = 1e7;
function fail2(field, message = FIELD_ERRORS.other) {
  throw invalid({ [field]: message });
}
function record2(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail2("body");
  return value;
}
function text(raw, field, min = 1, max = 200) {
  const value = raw[field];
  if (typeof value !== "string" || codePoints(value) < min || codePoints(value) > max) return fail2(field);
  return value;
}
function frame(raw, field) {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > FRAME_MAX) return fail2(field);
  return value;
}
function int(raw, field, min, max) {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return fail2(field);
  return value;
}
function bool(raw, field, optional = false) {
  const value = raw[field];
  if (typeof value === "boolean") return value;
  if (optional && value === void 0) return false;
  return fail2(field);
}
function cueText(raw) {
  const value = raw["text"];
  if (typeof value !== "string" || !validCueText(value)) return fail2("text", FIELD_ERRORS.text);
  return value;
}
function oneOf(raw, field, options, message = FIELD_ERRORS.other) {
  const value = raw[field];
  const match2 = options.find((option) => option === value);
  if (match2 === void 0) return fail2(field, message);
  return match2;
}
function layerValue(raw, property) {
  const value = raw[property];
  if (value === void 0) return void 0;
  const [low, high] = PROPERTY_RANGE[property];
  if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) return fail2(property);
  return value;
}
function parseOpId(input) {
  return text(record2(input), "op_id", 1, 64);
}
function parseEnvelope(input, allowInternal) {
  const raw = record2(input);
  const op_id = text(raw, "op_id", 1, 64);
  const base_version = int(raw, "base_version", 0, 2e9);
  return { op_id, base_version, body: parseBody(raw, allowInternal) };
}
function parseBody(raw, allowInternal) {
  const type = raw["type"];
  switch (type) {
    case "add_clip":
      return { type, row_id: text(raw, "row_id"), media_id: text(raw, "media_id"), start_frame: frame(raw, "start_frame") };
    case "add_text": {
      const start_frame = frame(raw, "start_frame");
      const end_frame = frame(raw, "end_frame");
      if (end_frame <= start_frame) return fail2("end_frame");
      return { type, row_id: text(raw, "row_id"), start_frame, end_frame, text: text(raw, "text", 1, 200) };
    }
    case "move":
      return { type, clip_id: text(raw, "clip_id"), start_frame: frame(raw, "start_frame"), row_id: text(raw, "row_id") };
    case "trim":
      return {
        type,
        clip_id: text(raw, "clip_id"),
        edge: oneOf(raw, "edge", ["start", "end"]),
        delta_frames: int(raw, "delta_frames", -FRAME_MAX, FRAME_MAX),
        ripple: bool(raw, "ripple", true)
      };
    case "split":
      return { type, clip_id: text(raw, "clip_id"), at_frame: frame(raw, "at_frame") };
    case "remove":
      return { type, clip_id: text(raw, "clip_id"), ripple: bool(raw, "ripple", true) };
    case "set_hidden":
      return { type, clip_id: text(raw, "clip_id"), hidden: bool(raw, "hidden") };
    case "set_speed":
      return { type, clip_id: text(raw, "clip_id"), speed_percent: int(raw, "speed_percent", SPEED_MIN, SPEED_MAX) };
    case "group": {
      const ids = raw["clip_ids"];
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string" && id.length > 0)) return fail2("clip_ids");
      const unique = [...new Set(ids)];
      if (unique.length < 2) return fail2("clip_ids");
      return { type, clip_ids: unique };
    }
    case "ungroup":
      return { type, group_id: text(raw, "group_id") };
    case "add_row":
      return { type, name: text(raw, "name", 1, 60), kind: oneOf(raw, "kind", ["video", "audio", "caption"]) };
    case "reorder_row":
      return { type, row_id: text(raw, "row_id"), position: int(raw, "position", 1, 1e3) };
    case "lock_row":
      return { type, row_id: text(raw, "row_id"), locked: bool(raw, "locked") };
    case "set_keyframe": {
      const property = oneOf(raw, "property", PROPERTIES);
      const value = raw["value"];
      const [low, high] = PROPERTY_RANGE[property];
      if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high) return fail2("value");
      return {
        type,
        clip_id: text(raw, "clip_id"),
        property,
        frame: frame(raw, "frame"),
        value,
        curve: oneOf(raw, "curve", CURVES)
      };
    }
    case "remove_keyframe":
      return { type, clip_id: text(raw, "clip_id"), property: oneOf(raw, "property", PROPERTIES), frame: frame(raw, "frame") };
    case "add_marker":
      return { type, frame: frame(raw, "frame"), label: typeof raw["label"] === "string" ? text(raw, "label", 0, 40) : "" };
    case "set_layer": {
      const x = layerValue(raw, "x");
      const y = layerValue(raw, "y");
      const scale = layerValue(raw, "scale");
      if (x === void 0 && y === void 0 && scale === void 0) return fail2("x");
      return {
        type,
        clip_id: text(raw, "clip_id"),
        frame: frame(raw, "frame"),
        ...x === void 0 ? {} : { x },
        ...y === void 0 ? {} : { y },
        ...scale === void 0 ? {} : { scale }
      };
    }
    case "caption_add":
      return {
        type,
        row_id: text(raw, "row_id"),
        start_frame: frame(raw, "start_frame"),
        end_frame: frame(raw, "end_frame"),
        text: cueText(raw)
      };
    case "caption_edit":
      return {
        type,
        caption_id: text(raw, "caption_id"),
        start_frame: frame(raw, "start_frame"),
        end_frame: frame(raw, "end_frame"),
        text: cueText(raw)
      };
    case "caption_remove":
      return { type, caption_id: text(raw, "caption_id") };
    case "apply_kit":
      return { type, kit_id: text(raw, "kit_id") };
    case "set_aspect":
    case "restore_cut":
      if (!allowInternal) return fail2("type");
      return type === "set_aspect" ? { type, aspect_ratio: oneOf(raw, "aspect_ratio", ASPECT_LABELS, FIELD_ERRORS.aspect_ratio) } : { type, cut_id: text(raw, "cut_id") };
    default:
      return fail2("type");
  }
}

// server/timeline/steps.ts
function changedFields(before, after) {
  return Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}
function patches(originals, current) {
  const forward = {};
  const inverse = {};
  for (const [id, before] of originals) {
    const after = current(id) ?? null;
    if (before && after) {
      const keys = changedFields(before, after);
      forward[id] = { mode: "patch", fields: Object.fromEntries(keys.map((key) => [key, after[key]])) };
      inverse[id] = { mode: "patch", fields: Object.fromEntries(keys.map((key) => [key, before[key]])) };
    } else if (before) {
      forward[id] = { mode: "drop" };
      inverse[id] = { mode: "put", value: before };
    } else if (after) {
      forward[id] = { mode: "put", value: after };
      inverse[id] = { mode: "drop" };
    }
  }
  return { forward, inverse };
}
function restoreSteps(diff, draft) {
  const clips = patches(diff.clipBefore, (id) => draft.clips.get(id));
  const captions = patches(diff.captionBefore, (id) => draft.captions.get(id));
  const rows = patches(diff.rowBefore, (id) => draft.rows.get(id));
  const names = {};
  for (const [id, clip] of diff.clipBefore) names[id] = (clip ?? draft.clips.get(id))?.name ?? id;
  const make = (side) => ({
    k: "restore",
    clips: clips[side],
    captions: captions[side],
    rows: rows[side],
    markers: side === "forward" ? diff.markersBefore ? draft.markers : null : diff.markersBefore,
    aspect: side === "forward" ? diff.aspectBefore ? draft.aspect : null : diff.aspectBefore,
    pins: [],
    names
  });
  return { forward: make("forward"), inverse: make("inverse") };
}
function overlapError(draft, hit, rowId) {
  const name = "name" in hit ? hit.name : "Caption";
  return new AppError("undo_blocked", { clip: name, row: draft.row(rowId).name });
}
function applyRestore(draft, step) {
  const touchedClips = /* @__PURE__ */ new Set();
  const touchedCaptions = /* @__PURE__ */ new Set();
  const nameOf = (id) => step.names[id] ?? id;
  for (const [id, patch] of Object.entries(step.clips)) {
    if (patch.mode === "patch") {
      if (!draft.clips.has(id)) throw new AppError("undo_missing", { clip: nameOf(id) });
      Object.assign(draft.editClip(id), patch.fields);
    } else if (patch.mode === "put") {
      if (draft.clips.has(id)) draft.editClip(id);
      draft.putClip(structuredClone(patch.value));
    } else {
      if (!draft.clips.has(id)) throw new AppError("undo_missing", { clip: nameOf(id) });
      draft.dropClip(id);
    }
    touchedClips.add(id);
  }
  for (const [id, patch] of Object.entries(step.captions)) {
    if (patch.mode === "patch") {
      if (!draft.captions.has(id)) throw new AppError("undo_missing", { clip: "a caption" });
      Object.assign(draft.editCaption(id), patch.fields);
    } else if (patch.mode === "put") {
      if (draft.captions.has(id)) draft.editCaption(id);
      draft.putCaption(structuredClone(patch.value));
    } else if (draft.captions.has(id)) {
      draft.dropCaption(id);
    }
    touchedCaptions.add(id);
  }
  for (const [id, patch] of Object.entries(step.rows)) {
    if (patch.mode === "patch") Object.assign(draft.editRow(id), patch.fields);
    else if (patch.mode === "put") draft.putRow(structuredClone(patch.value));
    else {
      if ([...draft.clips.values()].some((clip) => clip.row_id === id)) throw new AppError("undo_blocked", { clip: "a clip", row: draft.row(id).name });
      draft.editRow(id);
      draft.rows.delete(id);
    }
  }
  if (step.markers) draft.setMarkers(structuredClone(step.markers));
  if (step.aspect) draft.setAspect(step.aspect);
  for (const id of touchedClips) {
    const clip = draft.clips.get(id);
    if (!clip) continue;
    assertUnlocked(draft, clip.row_id);
    const hit = findOverlap(draft, clip.row_id, clip.start_frame, clip.end_frame, /* @__PURE__ */ new Set([id]));
    if (hit) throw overlapError(draft, hit, clip.row_id);
  }
  for (const id of touchedCaptions) {
    const caption = draft.captions.get(id);
    if (!caption) continue;
    assertUnlocked(draft, caption.row_id);
    for (const other of draft.captions.values()) {
      if (other.id !== id && other.row_id === caption.row_id && overlaps(other.start_frame, other.end_frame, caption.start_frame, caption.end_frame)) {
        throw new AppError("undo_blocked", { clip: "a caption", row: draft.row(caption.row_id).name });
      }
    }
  }
  return { summary: restoreSummary(draft, step), stopped: null, pins: [], extraTouched: [] };
}
function restoreSummary(draft, step) {
  if (step.aspect) return { type: "set_aspect", aspect_ratio: step.aspect };
  const entries = Object.entries(step.clips);
  const only = entries.length === 1 ? entries[0] : void 0;
  if (only) {
    const [id, patch] = only;
    const name = step.names[id] ?? id;
    if (patch.mode === "drop") return { type: "remove", clip_name: name };
    if (patch.mode === "patch" && Object.keys(patch.fields).join() === "hidden") {
      return { type: patch.fields.hidden ? "hide" : "show", clip_name: draft.clips.get(id)?.name ?? name };
    }
  }
  return { type: "edit" };
}
function applyStep(draft, step, ctx) {
  switch (step.k) {
    case "restore":
      return applyRestore(draft, step);
    case "shift": {
      const clip = draft.clips.get(step.clip_id);
      if (!clip) throw new AppError("undo_missing", { clip: step.clip_name });
      if (step.row_id && step.row_id !== clip.row_id) {
        const length = clip.end_frame - clip.start_frame;
        assertUnlocked(draft, clip.row_id);
        assertUnlocked(draft, step.row_id);
        const start = clip.start_frame + step.delta;
        const hit = findOverlap(draft, step.row_id, start, start + length, /* @__PURE__ */ new Set([clip.id]));
        if (start < 0 || hit) throw new AppError("undo_blocked", { clip: hit?.name ?? clip.name, row: draft.row(step.row_id).name });
        const live = draft.editClip(clip.id);
        live.row_id = step.row_id;
        live.start_frame = start;
        live.end_frame = start + length;
      } else {
        shiftGroup(draft, clip, step.delta, "undo");
      }
      return { summary: { type: "move", clip_name: clip.name, at_frame: draft.clip(clip.id).start_frame }, stopped: null, pins: [], extraTouched: [] };
    }
    case "trim": {
      const clip = draft.clips.get(step.clip_id);
      if (!clip) throw new AppError("undo_missing", { clip: step.clip_name });
      try {
        const effect = trimBody(draft, { type: "trim", clip_id: clip.id, edge: step.edge, delta_frames: step.delta, ripple: false }, ctx);
        if (effect.stopped) throw new AppError("undo_blocked", { clip: clip.name, row: draft.row(clip.row_id).name });
        return { ...effect, steps: void 0 };
      } catch (error) {
        if (error instanceof AppError && (error.code === "blocked" || error.code === "group_blocked")) {
          throw new AppError("undo_blocked", { clip: clip.name, row: draft.row(clip.row_id).name });
        }
        throw error;
      }
    }
    case "join": {
      const left = draft.clips.get(step.left_id);
      const right = draft.clips.get(step.right_id);
      if (!left) throw new AppError("undo_missing", { clip: step.left_name });
      if (!right) throw new AppError("undo_missing", { clip: step.left_name });
      if (left.row_id !== right.row_id || left.end_frame !== right.start_frame) {
        throw new AppError("undo_blocked", { clip: right.name, row: draft.row(right.row_id).name });
      }
      assertUnlocked(draft, left.row_id);
      const liveLeft = draft.editClip(left.id);
      liveLeft.end_frame = right.end_frame;
      liveLeft.source_out = right.source_out;
      draft.dropClip(right.id);
      if (right.group_id) {
        const rest = groupMembers(draft, right.group_id);
        if (rest.length === 1 && rest[0]) draft.editClip(rest[0].id).group_id = null;
      }
      return { summary: { type: "edit" }, stopped: null, pins: [], extraTouched: [] };
    }
    case "resplit": {
      const clip = draft.clips.get(step.clip_id);
      if (!clip) throw new AppError("undo_missing", { clip: step.clip_name });
      if (step.at_frame <= clip.start_frame || step.at_frame >= clip.end_frame) {
        throw new AppError("undo_blocked", { clip: clip.name, row: draft.row(clip.row_id).name });
      }
      assertUnlocked(draft, clip.row_id);
      splitClip(draft, clip, step.at_frame, step.right_id);
      return { summary: { type: "split", clip_name: clip.name, at_frame: step.at_frame }, stopped: null, pins: [], extraTouched: [step.right_id] };
    }
  }
}

// server/ops.ts
function opIdOf(raw) {
  const id = typeof raw === "object" && raw !== null ? raw["op_id"] : void 0;
  return typeof id === "string" ? id : null;
}
function requestTargets(body, timeline) {
  const ids = [];
  const clip = (id) => {
    ids.push(id);
    const found = timeline.clips.find((candidate) => candidate.id === id);
    if (found?.group_id) {
      ids.push(`g:${found.group_id}`);
      for (const member of timeline.clips) if (member.group_id === found.group_id) ids.push(member.id);
    }
  };
  switch (body.type) {
    case "move":
    case "trim":
    case "split":
    case "remove":
    case "set_hidden":
    case "set_speed":
    case "set_keyframe":
    case "remove_keyframe":
    case "set_layer":
      clip(body.clip_id);
      break;
    case "group":
      body.clip_ids.forEach(clip);
      break;
    case "ungroup":
      ids.push(`g:${body.group_id}`);
      break;
    case "reorder_row":
    case "lock_row":
    case "import_captions":
      ids.push(body.row_id);
      break;
    case "caption_add":
      ids.push(body.row_id);
      break;
    case "caption_edit":
    case "caption_remove":
      ids.push(body.caption_id);
      break;
    case "set_aspect":
    case "restore_cut":
      ids.push("project");
      break;
    case "add_marker":
      ids.push("markers");
      break;
    default:
      break;
  }
  return ids;
}
async function assertNoConflict(db, projectId, actor, baseVersion, ids, timeline) {
  if (!ids.length) return;
  const hit = await one(
    `SELECT p.name AS winner, o.summary, o.touched FROM ops o JOIN people p ON p.id = o.person_id
      WHERE o.project_id = $1 AND o.version > $2 AND o.person_id <> $3 AND o.touched && $4::text[]
      ORDER BY o.version LIMIT 1`,
    [projectId, baseVersion, actor.id, [...ids]],
    db
  );
  if (!hit) return;
  const contested = hit.touched.filter((id) => ids.includes(id));
  const clips = timeline.clips.filter((clip) => contested.includes(clip.id));
  const rows = timeline.rows.filter((row) => contested.includes(row.id)).map(publicRow);
  const captions = timeline.captions.filter((caption) => contested.includes(caption.id)).map(publicCaption);
  throw new AppError(
    "conflict",
    { winner: hit.winner, clip: clips[0]?.name ?? hit.summary.clip_name ?? "the timeline" },
    { winner: hit.winner, items: [...clips, ...rows, ...captions] }
  );
}
async function contextFor(db, projectId, body, timeline) {
  const mediaIds = new Set(timeline.clips.flatMap((clip) => clip.media_id ? [clip.media_id] : []));
  if (body?.type === "add_clip") mediaIds.add(body.media_id);
  const media = await loadMedia(db, [...mediaIds]);
  let kit = null;
  if (body?.type === "apply_kit") {
    const row = await one(
      "SELECT id, name, text_colour, box_colour, font_weight FROM kits WHERE id = $1",
      [body.kit_id],
      db
    );
    if (!row) throw notFound();
    kit = row;
  }
  let cut = null;
  if (body?.type === "restore_cut") {
    const row = await one("SELECT name, snapshot FROM cuts WHERE id = $1 AND project_id = $2", [body.cut_id, projectId], db);
    if (!row) throw notFound();
    cut = row;
  }
  return { media, kit, cut };
}
function publicChanges(draft, diff, comments) {
  const changes = {
    clips: diff.clips,
    captions: diff.captions.map(publicCaption),
    comments,
    rows: diff.rows.map(publicRow)
  };
  if (diff.markersBefore) changes.markers = draft.markers;
  if (diff.aspectBefore) changes.project = { aspect_ratio: draft.aspect, ...frameSize(draft.aspect) };
  return changes;
}
async function record3(db, project, actor, opId, type, draft, effect, steps, extraTouched, commentIds) {
  const diff = draft.diff();
  await persist(db, project.id, draft, diff);
  const comments = await commentsByIds(db, project.id, commentIds);
  const changes = publicChanges(draft, diff, comments);
  const touched = [
    ...diff.clipBefore.keys(),
    ...diff.captionBefore.keys(),
    ...diff.rowBefore.keys(),
    ...diff.clips.flatMap((clip) => clip.group_id ? [`g:${clip.group_id}`] : []),
    ...effect.extraTouched,
    ...extraTouched
  ];
  if (diff.markersBefore) touched.push("markers");
  const bumped = await one("UPDATE projects SET version = version + 1, updated_at = now() WHERE id = $1 RETURNING version", [project.id], db);
  const version = bumped?.version ?? project.version + 1;
  await db.query(
    `INSERT INTO ops (project_id, version, op_id, person_id, type, summary, changes, removed, stopped, touched, forward, inverse)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      project.id,
      version,
      opId,
      actor.id,
      type,
      JSON.stringify(effect.summary),
      JSON.stringify(changes),
      JSON.stringify(diff.removed),
      effect.stopped ? JSON.stringify(effect.stopped) : null,
      [...new Set(touched)],
      steps.forward ? JSON.stringify(steps.forward) : null,
      steps.inverse ? JSON.stringify(steps.inverse) : null
    ]
  );
  return { result: { version, changes, removed: diff.removed, stopped: effect.stopped }, summary: effect.summary, authorId: actor.id };
}
function announce(projectId, actor, committed) {
  const message = { ...committed.result, author: { id: actor.id, name: actor.name }, op: committed.summary };
  hub.toProject(projectId, { type: "op", ...message });
  void exportsAfterOp(projectId, committed.result.version);
}
async function submitOp(projectId, actor, raw, kind, cutId) {
  const opId = opIdOf(raw);
  if (opId) {
    const replay = await replayOf(projectId, actor.id, opId);
    if (replay) return replay;
  }
  await requireRole(projectId, actor, kind === "ops" ? ["owner", "editor"] : ["owner"]);
  const input = typeof raw === "object" && raw !== null ? { ...raw } : {};
  if (kind === "aspect") input["type"] = "set_aspect";
  if (kind === "restore") {
    input["type"] = "restore_cut";
    input["cut_id"] = cutId;
  }
  return commitEnvelope(projectId, actor, parseEnvelope(input, kind !== "ops"));
}
async function commitEnvelope(projectId, actor, envelope) {
  const outcome = await tx(async (db) => {
    const locked = await loadProjectRow(db, projectId, true);
    if (!locked) throw notFound();
    const first = await one("SELECT * FROM ops WHERE project_id = $1 AND person_id = $2 AND op_id = $3", [projectId, actor.id, envelope.op_id], db);
    if (first) return { committed: { result: resultOf(first), summary: first.summary, authorId: actor.id }, replayed: true };
    await upgradeProject(db, projectId);
    const project = await loadProjectRow(db, projectId) ?? locked;
    const timeline = await loadTimeline(db, project);
    const targets = requestTargets(envelope.body, timeline);
    if (envelope.base_version < project.version) await assertNoConflict(db, projectId, actor, envelope.base_version, targets, timeline);
    const draft = new Draft(timeline);
    const ctx = await contextFor(db, projectId, envelope.body, timeline);
    const effect = applyBody(draft, envelope.body, ctx);
    const diff = draft.diff();
    if (envelope.base_version < project.version) {
      const changed = [...diff.clipBefore.keys(), ...diff.captionBefore.keys(), ...diff.rowBefore.keys()];
      await assertNoConflict(db, projectId, actor, envelope.base_version, changed, timeline);
    }
    const pins = await applyPins(db, projectId, effect.pins);
    const defaults = restoreSteps(diff, draft);
    const steps = effect.steps ?? {
      forward: { ...defaults.forward, pins: pins.after },
      inverse: { ...defaults.inverse, pins: pins.before }
    };
    const committed = await record3(db, project, actor, envelope.op_id, envelope.body.type, draft, effect, steps, targets, pins.ids);
    await db.query("DELETE FROM undo_entries WHERE project_id = $1 AND person_id = $2 AND stack = 'redo'", [projectId, actor.id]);
    await db.query("INSERT INTO undo_entries (project_id, person_id, op_version, stack) VALUES ($1,$2,$3,'undo')", [projectId, actor.id, committed.result.version]);
    return { committed, replayed: false };
  });
  if (!outcome.replayed) announce(projectId, actor, outcome.committed);
  return outcome.committed.result;
}
async function importCaptionsOp(projectId, actor, body) {
  return commitEnvelope(projectId, actor, { op_id: randomUUID(), base_version: Number.MAX_SAFE_INTEGER, body });
}
async function submitHistory(projectId, actor, raw, direction) {
  const opId = opIdOf(raw);
  if (opId) {
    const replay = await replayOf(projectId, actor.id, opId);
    if (replay) return replay;
  }
  await requireRole(projectId, actor, ["owner", "editor"]);
  const opIdValue = parseOpId(raw);
  const from = direction === "undo" ? "undo" : "redo";
  const to = direction === "undo" ? "redo" : "undo";
  const outcome = await tx(async (db) => {
    const locked = await loadProjectRow(db, projectId, true);
    if (!locked) throw notFound();
    const first = await one("SELECT * FROM ops WHERE project_id = $1 AND person_id = $2 AND op_id = $3", [projectId, actor.id, opIdValue], db);
    if (first) return { committed: { result: resultOf(first), summary: first.summary, authorId: actor.id }, replayed: true };
    await upgradeProject(db, projectId);
    const project = await loadProjectRow(db, projectId) ?? locked;
    const entry = await one(
      "SELECT id, op_version FROM undo_entries WHERE project_id = $1 AND person_id = $2 AND stack = $3 ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [projectId, actor.id, from],
      db
    );
    if (!entry) throw new AppError(direction === "undo" ? "nothing_to_undo" : "nothing_to_redo");
    const original = await one("SELECT * FROM ops WHERE project_id = $1 AND version = $2", [projectId, entry.op_version], db);
    const step = direction === "undo" ? original?.inverse : original?.forward;
    if (!original || !step) throw new AppError(direction === "undo" ? "nothing_to_undo" : "nothing_to_redo");
    const timeline = await loadTimeline(db, project);
    const draft = new Draft(timeline);
    const ctx = await contextFor(db, projectId, null, timeline);
    const effect = applyStep(draft, step, ctx);
    const pins = step.k === "restore" ? await setPinFrames(db, step.pins) : [];
    const committed = await record3(db, project, actor, opIdValue, direction, draft, effect, { forward: null, inverse: null }, [], pins);
    await db.query("DELETE FROM undo_entries WHERE id = $1", [entry.id]);
    await db.query("INSERT INTO undo_entries (project_id, person_id, op_version, stack) VALUES ($1,$2,$3,$4)", [projectId, actor.id, entry.op_version, to]);
    return { committed, replayed: false };
  });
  if (!outcome.replayed) announce(projectId, actor, outcome.committed);
  return outcome.committed.result;
}

// server/cursor.ts
function encodeCursor(sortValue, id, extra = "") {
  return Buffer.from(JSON.stringify([sortValue, extra, id])).toString("base64url");
}
function decodeCursor(cursor) {
  if (cursor === null) return null;
  const bad = invalid({ cursor: FIELD_ERRORS.cursor });
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw bad;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const isKey = (item) => typeof item === "string" || typeof item === "number" && Number.isFinite(item);
    if (Array.isArray(value) && value.length === 3 && value.every(isKey)) return { sortValue: value[0], extra: value[1], id: value[2] };
  } catch {
    throw bad;
  }
  throw bad;
}
function pageLimit(raw, fallback = PAGE_DEFAULT) {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > PAGE_MAX) throw invalid({ limit: FIELD_ERRORS.limit });
  return value;
}

// server/media/judge.ts
import { crc32 } from "node:zlib";
var damaged = (reason) => ({ ok: false, reason });
var MOOV_MAX = 32 * 1024 * 1024;
async function boxes(read, from, limit) {
  const found = [];
  let offset = from;
  while (offset < limit) {
    if (limit - offset < 8) return null;
    const head = await read(offset, 16);
    let size = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    let header = 8;
    if (size === 1) {
      if (limit - offset < 16) return null;
      size = Number(head.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) {
      size = limit - offset;
    }
    if (size < header || offset + size > limit) return null;
    found.push({ type, start: offset, header, end: offset + size });
    offset += size;
  }
  return found;
}
async function judgeMp4(file) {
  const top = await boxes((o, l) => file.read(o, Math.min(l, file.size - o)), 0, file.size);
  if (!top || top[0]?.type !== "ftyp") return damaged(UPLOAD_REASONS.mp4);
  const moov = top.find((box2) => box2.type === "moov");
  if (!moov || moov.end - moov.start > MOOV_MAX) return damaged(UPLOAD_REASONS.mp4);
  const payload = await file.read(moov.start + moov.header, moov.end - moov.start - moov.header);
  const inner = await boxes(async (o, l) => payload.subarray(o, o + l), 0, payload.length);
  const mvhd = inner?.find((box2) => box2.type === "mvhd");
  if (!inner || !mvhd) return damaged(UPLOAD_REASONS.mp4);
  const m = payload.subarray(mvhd.start + mvhd.header, mvhd.end);
  const version = m[0];
  if (version !== 0 && version !== 1) return damaged(UPLOAD_REASONS.mp4);
  if (m.length < (version === 0 ? 20 : 32)) return damaged(UPLOAD_REASONS.mp4);
  const timescale = version === 0 ? m.readUInt32BE(12) : m.readUInt32BE(20);
  const duration = version === 0 ? BigInt(m.readUInt32BE(16)) : m.readBigUInt64BE(24);
  if (timescale === 0 || duration === 0n) return damaged(UPLOAD_REASONS.mp4);
  for (const trak of inner.filter((box2) => box2.type === "trak")) {
    const children = await boxes(
      async (o, l) => payload.subarray(o, o + l),
      trak.start + trak.header,
      trak.end
    );
    const tkhd = children?.find((box2) => box2.type === "tkhd");
    if (!tkhd) continue;
    const t = payload.subarray(tkhd.start + tkhd.header, tkhd.end);
    const at = t[0] === 1 ? 88 : 76;
    if (t.length < at + 8) continue;
    const width = t.readUInt32BE(at) >>> 16;
    const height = t.readUInt32BE(at + 4) >>> 16;
    if (width > 0 && height > 0) {
      return { ok: true, media: { kind: "mp4", width, height, src_num: duration, src_den: BigInt(timescale), sample_rate: null, wav: null } };
    }
  }
  return damaged(UPLOAD_REASONS.mp4);
}
async function judgeWav(file) {
  const head = await file.read(0, Math.min(12, file.size));
  if (head.length < 12 || head.readUInt32LE(4) !== file.size - 8 || head.toString("latin1", 8, 12) !== "WAVE") return damaged(UPLOAD_REASONS.wav);
  let format = null;
  let offset = 12;
  while (offset + 8 <= file.size) {
    const chunk = await file.read(offset, 8);
    const id = chunk.toString("latin1", 0, 4);
    const size = chunk.readUInt32LE(4);
    if (id === "fmt ") {
      if (size < 16 || offset + 8 + 16 > file.size) return damaged(UPLOAD_REASONS.wav);
      const f = await file.read(offset + 8, 16);
      if (f.readUInt16LE(0) !== 1) return damaged(UPLOAD_REASONS.wav);
      format = { channels: f.readUInt16LE(2), rate: f.readUInt32LE(4), align: f.readUInt16LE(12), bits: f.readUInt16LE(14) };
    } else if (id === "data") {
      if (!format || offset + 8 + size > file.size) return damaged(UPLOAD_REASONS.wav);
      const { channels, rate, align, bits } = format;
      const valid = channels >= 1 && channels <= 8 && rate >= 8e3 && rate <= 192e3 && (bits === 16 || bits === 24) && align === channels * bits / 8 && size % align === 0;
      if (!valid) return damaged(UPLOAD_REASONS.wav);
      const frames = size / align;
      return {
        ok: true,
        media: {
          kind: "wav",
          width: null,
          height: null,
          src_num: BigInt(frames),
          src_den: BigInt(rate),
          sample_rate: rate,
          wav: { data_offset: offset + 8, sample_frames: frames, block_align: align, bits }
        }
      };
    }
    offset += 8 + size + size % 2;
  }
  return damaged(UPLOAD_REASONS.wav);
}
async function judgePng(file) {
  if (file.size < 33) return damaged(UPLOAD_REASONS.png);
  const head = await file.read(8, 25);
  if (head.readUInt32BE(0) !== 13 || head.toString("latin1", 4, 8) !== "IHDR") return damaged(UPLOAD_REASONS.png);
  if (crc32(head.subarray(4, 21)) !== head.readUInt32BE(21)) return damaged(UPLOAD_REASONS.png);
  const width = head.readUInt32BE(8);
  const height = head.readUInt32BE(12);
  if (width < 1 || width > 16384 || height < 1 || height > 16384) return damaged(UPLOAD_REASONS.png);
  return { ok: true, media: { kind: "png", width, height, src_num: 3600n, src_den: 1n, sample_rate: null, wav: null } };
}
var PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function judgeFile(file) {
  const head = await file.read(0, Math.min(12, file.size));
  if (head.length >= 8 && head.toString("latin1", 4, 8) === "ftyp") return judgeMp4(file);
  if (head.length >= 4 && head.toString("latin1", 0, 4) === "RIFF") return judgeWav(file);
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return judgePng(file);
  return { ok: false, reason: UPLOAD_REASONS.type };
}

// server/media/peaks.ts
var BUCKETS = 1e3;
var BLOCK_BYTES = 4 * 1024 * 1024;
async function computePeaks(size, get) {
  const verdict = await judgeFile({
    size,
    read: async (offset, length) => await get({ start: offset, end: Math.min(size, offset + length) - 1 }) ?? Buffer.alloc(0)
  });
  const wav = verdict.ok ? verdict.media.wav : null;
  if (!wav) throw new Error("stored file is not a readable WAV");
  const full = wav.bits === 16 ? 32768 : 8388608;
  const width = wav.bits / 8;
  const frames = wav.sample_frames;
  const peaks = new Array(BUCKETS).fill(0);
  const bounds = Array.from({ length: BUCKETS + 1 }, (_, i) => Math.floor(i * frames / BUCKETS));
  const maxima = new Array(BUCKETS).fill(0);
  const perBlock = Math.max(1, Math.floor(BLOCK_BYTES / wav.block_align));
  let bucket2 = 0;
  for (let first = 0; first < frames; first += perBlock) {
    const count = Math.min(perBlock, frames - first);
    const start = wav.data_offset + first * wav.block_align;
    const block = await get({ start, end: start + count * wav.block_align - 1 });
    if (!block) throw new Error("stored file is shorter than its header");
    for (let i = 0; i < count; i += 1) {
      const frame2 = first + i;
      while ((bounds[bucket2 + 1] ?? frames) <= frame2) bucket2 += 1;
      const at = i * wav.block_align;
      const sample = width === 2 ? block.readInt16LE(at) : block.readIntLE(at, 3);
      const magnitude = Math.abs(sample);
      if (magnitude > (maxima[bucket2] ?? 0)) maxima[bucket2] = magnitude;
    }
  }
  for (let i = 0; i < BUCKETS; i += 1) peaks[i] = Math.floor(((maxima[i] ?? 0) * 2e4 + full) / (2 * full)) / 1e4;
  return peaks;
}

// server/media/library.ts
var mediaWords = (name, folder) => `${name} ${folder}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
async function usage(db, ids) {
  const rows = await query(
    `SELECT DISTINCT media_id, title FROM (
       SELECT c.media_id, p.title FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.media_id = ANY($1)
       UNION
       SELECT e->>'media_id', p.title FROM cuts k JOIN projects p ON p.id = k.project_id,
         jsonb_array_elements(k.snapshot->'clips') e WHERE e->>'media_id' = ANY($1)
     ) used ORDER BY title`,
    [ids],
    db
  );
  const byMedia = /* @__PURE__ */ new Map();
  for (const row of rows) byMedia.set(row.media_id, [...byMedia.get(row.media_id) ?? [], row.title]);
  return byMedia;
}
async function mediaRecords(db, rows) {
  const used = await usage(db, rows.map((row) => row.id));
  return rows.map(({ seq: _seq, ...row }) => ({ ...row, used_in: used.get(row.id) ?? [] }));
}
async function mediaById(db, id) {
  const row = await one("SELECT * FROM media WHERE id = $1", [id], db);
  return row ? (await mediaRecords(db, [row]))[0] ?? null : null;
}
function parseSearch(q) {
  if (q === null) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length > SEARCH_TERMS_MAX || codePoints(q) > SEARCH_CODEPOINTS_MAX) throw invalid({ q: FIELD_ERRORS.q });
  return terms.map((term) => term.toLowerCase());
}
async function listMedia(params) {
  const terms = parseSearch(params.get("q"));
  const limit = pageLimit(params.get("limit"), 50);
  const cursor = decodeCursor(params.get("cursor"));
  const where = [];
  const values = [];
  const bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  const folder = params.get("folder");
  if (folder !== null) where.push(`folder = ${bind(folder)}`);
  for (const term of terms) where.push(`EXISTS (SELECT 1 FROM unnest(words) w WHERE starts_with(w, ${bind(term)}))`);
  if (cursor) where.push(`(folder, name, id) > (${bind(cursor.sortValue)}, ${bind(cursor.extra)}, ${bind(cursor.id)})`);
  const rows = await query(
    `SELECT * FROM media ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY folder, name, id LIMIT ${bind(limit + 1)}`,
    values
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: await mediaRecords(pool, page),
    next_cursor: rows.length > limit && last ? encodeCursor(last.folder, last.id, last.name) : null
  };
}
async function deleteMedia(id) {
  const row = await tx(async (db) => {
    const found = await one("SELECT * FROM media WHERE id = $1 FOR UPDATE", [id], db);
    if (!found) throw notFound();
    const titles = (await usage(db, [id])).get(id);
    if (titles?.length) throw new AppError("media_in_use", { file: found.name, projects: titles.join(", ") }, { projects: titles });
    await db.query("DELETE FROM media WHERE id = $1", [id]);
    return found;
  });
  await deleteObject(`media/${row.sha256}`);
  await kv.del(`gatecut:peaks:${row.sha256}`);
  await giveBackStorage(row.bytes);
}
async function peaksOf(id) {
  const row = await one("SELECT * FROM media WHERE id = $1", [id]);
  if (!row || row.kind !== "wav") throw notFound();
  const key = `gatecut:peaks:${row.sha256}`;
  const kept = await kv.get(key);
  if (kept) return JSON.parse(kept);
  const stored = await headObject(`media/${row.sha256}`);
  if (!stored) throw notFound();
  const peaks = await computePeaks(stored.size, (range) => getObject(`media/${row.sha256}`, range));
  await kv.set(key, JSON.stringify(peaks));
  return peaks;
}

// server/readapi.ts
function pageOf(rows, params, shape2) {
  const limit = pageLimit(params.get("limit"));
  const cursor = decodeCursor(params.get("cursor"));
  const after = cursor ? Number(cursor.sortValue) : -Infinity;
  const later = rows.filter((row) => row.seq > after);
  const items = later.slice(0, limit);
  const last = items[items.length - 1];
  return { items: items.map(shape2), next_cursor: later.length > limit && last ? encodeCursor(last.seq, "") : null };
}
var workspaceOwner = async () => {
  const row = await one("SELECT id, name, email, handle, is_owner FROM people WHERE is_owner LIMIT 1");
  if (!row) throw notFound();
  return row;
};
var projectShape = (project, updatedAt) => ({
  id: project.id,
  title: project.title,
  agency: project.agency,
  frame_rate: project.frame_rate,
  aspect_ratio: project.aspect_ratio,
  total_frames: project.total_frames,
  updated_at: updatedAt.toISOString()
});
async function updatedAtOf(id) {
  const row = await loadProjectRow(pool, id);
  if (!row) throw notFound();
  return row.updated_at;
}
async function readProjects(params) {
  const projects = await listProjects(await workspaceOwner());
  const rows = await Promise.all(
    projects.map(async (project, index) => ({ seq: index + 1, project, updated: await updatedAtOf(project.id) }))
  );
  return pageOf(rows, params, (row) => projectShape(row.project, row.updated));
}
async function readProject(id) {
  const project = (await listProjects(await workspaceOwner())).find((candidate) => candidate.id === id);
  if (!project) throw notFound();
  return projectShape(project, await updatedAtOf(id));
}
async function requireProject(id) {
  const row = await loadProjectRow(pool, id);
  if (!row) throw notFound();
  return row;
}
async function readClips(id, params) {
  const project = await requireProject(id);
  const timeline = await loadTimeline(pool, project);
  const seqs = new Map((await query("SELECT id, seq FROM clips WHERE project_id = $1", [id])).map((row) => [row.id, row.seq]));
  const rows = timeline.clips.map((clip) => ({ clip, seq: seqs.get(clip.id) ?? 0 })).sort((a, b) => a.seq - b.seq);
  return pageOf(rows, params, ({ clip }) => ({
    id: clip.id,
    row_id: clip.row_id,
    name: clip.name,
    kind: clip.kind,
    start_frame: clip.start_frame,
    end_frame: clip.end_frame,
    hidden: clip.hidden
  }));
}
async function readCuts(id, params) {
  await requireProject(id);
  const rows = await query(
    "SELECT id, name, total_frames, created_at, seq FROM cuts WHERE project_id = $1 AND shared ORDER BY seq",
    [id]
  );
  return pageOf(rows, params, (cut) => ({ id: cut.id, name: cut.name, total_frames: cut.total_frames, created_at: cut.created_at.toISOString() }));
}
async function readExports(id, params) {
  await requireProject(id);
  const rows = await query(
    "SELECT id, cut_id, size, state, minutes, finished_at, seq FROM exports WHERE project_id = $1 ORDER BY seq",
    [id]
  );
  return pageOf(rows, params, (row) => ({
    id: row.id,
    cut_id: row.cut_id,
    size: row.size,
    state: row.state,
    minutes: row.minutes,
    finished_at: row.finished_at ? row.finished_at.toISOString() : null
  }));
}
async function readComments(id, params) {
  await requireProject(id);
  const rows = await query(
    "SELECT * FROM comments WHERE project_id = $1 AND visibility = 'review' ORDER BY seq",
    [id]
  );
  const clips = await pinClips(pool, id);
  return pageOf(rows, params, (row) => {
    const comment = commentFromRow(row, clips);
    return {
      id: comment.id,
      cut_id: comment.cut_id,
      frame: comment.pin.frame,
      body: comment.body,
      author_name: comment.author_name,
      created_at: comment.created_at
    };
  });
}

// server/review.ts
import { createHash as createHash4, randomBytes as randomBytes4 } from "node:crypto";
function linkRecord(row) {
  return {
    id: row.id,
    token: row.token,
    url: `${config.publicUrl}/review/${row.token}`,
    cut_id: row.cut_id,
    expires_at: row.expires_at.toISOString(),
    state: linkState(row)
  };
}
var newToken = () => `rv-${randomBytes4(15).toString("hex")}`;
async function markShared(cutId) {
  await query("UPDATE cuts SET shared = true WHERE id = $1", [cutId]);
}
async function createLink(projectId, raw) {
  const input = typeof raw === "object" && raw !== null ? raw : {};
  const seconds = input["expires_in_seconds"];
  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < LINK_MIN_SECONDS || seconds > LINK_MAX_SECONDS) {
    throw invalid({ expires_in_seconds: FIELD_ERRORS.expires_in_seconds });
  }
  if (typeof input["cut_id"] !== "string") throw invalid({ cut_id: FIELD_ERRORS.other });
  await cutById(pool, projectId, input["cut_id"]);
  const row = await one(
    "INSERT INTO review_links (id, project_id, cut_id, token, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(secs => $5)) RETURNING *",
    [newId("l"), projectId, input["cut_id"], newToken(), seconds]
  );
  if (!row) throw notFound();
  await markShared(row.cut_id);
  return linkRecord(row);
}
async function listLinks(projectId) {
  const rows = await query("SELECT * FROM review_links WHERE project_id = $1 ORDER BY seq", [projectId]);
  return rows.map(linkRecord);
}
async function linkById(id) {
  const row = await one("SELECT * FROM review_links WHERE id = $1", [id]);
  if (!row) throw notFound();
  return row;
}
async function ownerName() {
  const owner = await one("SELECT p.name FROM workspace w JOIN people p ON p.id = w.owner_id LIMIT 1");
  return owner?.name ?? "the owner";
}
function assertActive(link, owner) {
  const state = linkState(link);
  if (state === "revoked") throw new AppError("link_revoked", { owner });
  if (state === "expired") throw new AppError("link_expired", { owner });
}
async function endedError(linkId) {
  const link = await linkById(linkId);
  return new AppError(linkState(link) === "expired" ? "link_expired" : "link_revoked", { owner: await ownerName() });
}
async function shareCut(linkId, raw) {
  const link = await linkById(linkId);
  const cutId = typeof raw === "object" && raw !== null ? raw["cut_id"] : void 0;
  if (typeof cutId !== "string") throw invalid({ cut_id: FIELD_ERRORS.other });
  const cut = await cutById(pool, link.project_id, cutId);
  const row = await one("UPDATE review_links SET cut_id = $2 WHERE id = $1 AND NOT revoked AND expires_at > now() RETURNING *", [linkId, cutId]);
  if (!row) throw await endedError(linkId);
  await markShared(cutId);
  const shared = { ...cut, shared: true };
  hub.toProject(link.project_id, { type: "cut_shared", cut: shared });
  hub.toReview(link.id, { type: "cut_shared", cut: shared });
  return linkRecord(row);
}
async function regenerateLink(linkId) {
  const fresh = await tx(async (db) => {
    const old = await one("UPDATE review_links SET revoked = true WHERE id = $1 AND NOT revoked RETURNING *", [linkId], db);
    if (!old) return void 0;
    return one(
      "INSERT INTO review_links (id, project_id, cut_id, token, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [newId("l"), old.project_id, old.cut_id, newToken(), old.expires_at],
      db
    );
  });
  if (!fresh) throw await endedError(linkId);
  hub.closeLink(linkId);
  return linkRecord(fresh);
}
async function revokeLink(linkId) {
  await linkById(linkId);
  await query("UPDATE review_links SET revoked = true WHERE id = $1", [linkId]);
  hub.closeLink(linkId);
}
async function activeLink(token) {
  const link = await one("SELECT * FROM review_links WHERE token = $1", [token]);
  if (!link) throw notFound();
  assertActive(link, await ownerName());
  return link;
}
async function reviewBody(token) {
  const link = await activeLink(token);
  const project = await loadProjectRow(pool, link.project_id);
  const cut = await one(
    "SELECT id, name, total_frames, snapshot FROM cuts WHERE id = $1",
    [link.cut_id]
  );
  if (!project || !cut) throw notFound();
  const comments = await listComments(pool, project.id, "AND visibility = 'review' AND cut_id = $2", [cut.id]);
  const approvals = (await cutById(pool, project.id, cut.id)).approvals;
  const size = frameSize(project.aspect_ratio);
  const payload = {
    project: { title: project.title, frame_rate: project.frame_rate, aspect_ratio: project.aspect_ratio, width: size.width, height: size.height },
    owner_name: await ownerName(),
    cut: {
      id: cut.id,
      name: cut.name,
      total_frames: cut.total_frames,
      rows: cut.snapshot.rows.map(publicRow),
      clips: cut.snapshot.clips,
      captions: cut.snapshot.captions.map(publicCaption),
      media: await mediaDimsOf(pool, cut.snapshot.clips),
      markers: await markersOf(pool, project)
    },
    comments,
    approvals
  };
  const body = JSON.stringify(payload);
  return { body, etag: `"${createHash4("sha256").update(body).digest("hex")}"` };
}
function clientName(raw, field) {
  const name = typeof raw === "object" && raw !== null ? raw[field] : void 0;
  if (typeof name !== "string" || name.trim().length === 0 || codePoints(name) > NAME_MAX) throw invalid({ name: FIELD_ERRORS.reviewerName });
  return name.trim();
}
function clipAt(snapshot, frame2) {
  const position = new Map(snapshot.rows.map((row) => [row.id, row.position]));
  return snapshot.clips.filter((clip) => clip.kind !== "wav" && clip.start_frame <= frame2 && frame2 < clip.end_frame).sort((a, b) => (position.get(a.row_id) ?? 0) - (position.get(b.row_id) ?? 0))[0];
}
async function clientComment(token, raw) {
  const link = await activeLink(token);
  const input = typeof raw === "object" && raw !== null ? raw : {};
  const errors = {};
  let name = "";
  try {
    name = clientName(raw, "name");
  } catch (error) {
    if (error instanceof AppError) Object.assign(errors, error.extra["errors"] ?? {});
  }
  const note = (() => {
    try {
      return parseNote({ body: input["body"], frame: input["frame"], visibility: "review" });
    } catch (error) {
      if (error instanceof AppError) Object.assign(errors, error.extra["errors"] ?? {});
      return null;
    }
  })();
  if (Object.keys(errors).length || !note) throw invalid(errors);
  const cut = await one("SELECT snapshot FROM cuts WHERE id = $1", [link.cut_id]);
  const clip = cut ? clipAt(cut.snapshot, note.frame) : void 0;
  const id = newId("n");
  await query(
    `INSERT INTO comments (id, project_id, author_name, body, visibility, cut_id, pin_frame, pin_row_id, pin_clip_id, pin_offset, mentions)
     VALUES ($1,$2,$3,$4,'review',$5,$6,$7,$8,$9,'[]')`,
    [id, link.project_id, name, note.body, link.cut_id, note.frame, clip?.row_id ?? null, clip?.id ?? null, clip ? note.frame - clip.start_frame : null]
  );
  const comment = (await listComments(pool, link.project_id, "AND id = $2", [id]))[0];
  if (!comment) throw notFound();
  hub.toProject(link.project_id, { type: "comment", comment });
  hub.toReview(link.id, { type: "comment", comment });
  return comment;
}
async function clientApproval(token, raw) {
  const link = await activeLink(token);
  const name = clientName(raw, "name");
  await query("INSERT INTO approvals (cut_id, name) VALUES ($1,$2) ON CONFLICT (cut_id, name) DO NOTHING", [link.cut_id, name]);
  return { cut_id: link.cut_id, approvals: (await cutById(pool, link.project_id, link.cut_id)).approvals };
}

// server/uploads.ts
import { createHash as createHash5 } from "node:crypto";
var chunkKey = (uploadId, n) => `uploads/${uploadId}/${n}`;
var chunkCount = (bytes) => Math.ceil(bytes / CHUNK_BYTES);
var expectedLength = (row, n) => n === row.chunks - 1 ? row.bytes - n * CHUNK_BYTES : CHUNK_BYTES;
async function assertStorage() {
  if (!await reachable()) throw new AppError("storage_unavailable");
}
function validName(name) {
  return typeof name === "string" && codePoints(name) >= 1 && codePoints(name) <= 120 && !/[/\\\u0000-\u001f\u007f]/.test(name) && !name.startsWith(".");
}
function validFolder(folder) {
  if (typeof folder !== "string" || codePoints(folder) < 1 || codePoints(folder) > 80 || /[\u0000-\u001f\u007f]/.test(folder)) return false;
  return folder.split(" / ").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
function shape(row) {
  return { upload_id: row.id, chunk_bytes: CHUNK_BYTES, chunks: row.chunks, chunks_received: [...row.received].sort((a, b) => a - b) };
}
async function createUpload(personId, raw) {
  const input = typeof raw === "object" && raw !== null ? raw : {};
  const errors = {};
  if (!validName(input["file_name"])) errors["file_name"] = FIELD_ERRORS.file_name;
  if (!validFolder(input["folder"])) errors["folder"] = FIELD_ERRORS.other;
  const bytes = input["bytes"];
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1 || bytes > UPLOAD_BYTES_MAX) errors["bytes"] = FIELD_ERRORS.other;
  const sha256 = input["sha256"];
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) errors["sha256"] = FIELD_ERRORS.other;
  const replaces = input["replaces"];
  if (replaces !== void 0 && typeof replaces !== "string") errors["replaces"] = FIELD_ERRORS.other;
  if (Object.keys(errors).length) throw invalid(errors);
  const file = { name: input["file_name"], folder: input["folder"], bytes, sha256 };
  const existing = await one("SELECT id FROM media WHERE sha256 = $1", [file.sha256]);
  if (existing) return { status: 200, body: { duplicate: true, media: await mediaById(pool, existing.id) } };
  const open = await one("SELECT * FROM uploads WHERE person_id = $1 AND sha256 = $2 AND state IN ('open','receiving') ORDER BY seq LIMIT 1", [personId, file.sha256]);
  if (open) {
    if (open.bytes !== file.bytes) throw invalid({ bytes: FIELD_ERRORS.other });
    return { status: 200, body: shape(open) };
  }
  const current = await allowance();
  if (current.storage_bytes_used + file.bytes > current.storage_bytes_allowance) throw allowanceExceeded(current);
  if (typeof replaces === "string" && !await one("SELECT 1 FROM media WHERE id = $1", [replaces])) throw notFound();
  await assertStorage();
  const row = {
    id: newId("u"),
    person_id: personId,
    file_name: file.name,
    folder: file.folder,
    bytes: file.bytes,
    sha256: file.sha256,
    replaces: typeof replaces === "string" ? replaces : null,
    chunks: chunkCount(file.bytes),
    received: [],
    state: "open"
  };
  const inserted = await one(
    `INSERT INTO uploads (id, person_id, file_name, folder, bytes, sha256, replaces, chunks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (person_id, sha256) WHERE state IN ('open','receiving') DO NOTHING RETURNING id`,
    [row.id, row.person_id, row.file_name, row.folder, row.bytes, row.sha256, row.replaces, row.chunks]
  );
  if (inserted) return { status: 201, body: shape(row) };
  const raced = await one("SELECT * FROM uploads WHERE person_id = $1 AND sha256 = $2 AND state IN ('open','receiving')", [personId, file.sha256]);
  if (!raced) throw notFound();
  return { status: 200, body: shape(raced) };
}
async function listUploads(personId) {
  const rows = await query("SELECT * FROM uploads WHERE person_id = $1 AND state IN ('open','receiving') ORDER BY seq", [personId]);
  return rows.map((row) => ({
    upload_id: row.id,
    file_name: row.file_name,
    folder: row.folder,
    bytes: row.bytes,
    sha256: row.sha256,
    chunks: row.chunks,
    chunks_received: [...row.received].sort((a, b) => a - b),
    state: row.state === "receiving" ? "receiving" : "open"
  }));
}
async function ownUpload(personId, id) {
  const row = await one("SELECT * FROM uploads WHERE id = $1 AND person_id = $2", [id, personId]);
  if (!row) throw notFound();
  return row;
}
async function uploadState(personId, id) {
  const row = await ownUpload(personId, id);
  const received = [...row.received].sort((a, b) => a - b);
  const next = Array.from({ length: row.chunks }, (_, n) => n).find((n) => !received.includes(n));
  return { state: row.state, chunks_received: received, next_chunk: row.state === "confirmed" || row.state === "refused" ? null : next ?? null };
}
async function putChunk(personId, id, n, body) {
  const row = await ownUpload(personId, id);
  if (row.state === "confirmed" || row.state === "refused") throw new AppError("upload_refused", { file: row.file_name, reason: row.state });
  if (!Number.isInteger(n) || n < 0 || n >= row.chunks || body.length !== expectedLength(row, n)) throw invalid({ chunk: FIELD_ERRORS.other });
  if (row.received.includes(n)) return;
  await assertStorage();
  await putObject(chunkKey(id, n), body);
  await query(
    "UPDATE uploads SET received = CASE WHEN $2 = ANY(received) THEN received ELSE array_append(received, $2) END, state = 'receiving' WHERE id = $1",
    [id, n]
  );
}
function chunkedFile(row) {
  let held = null;
  const chunk = async (n) => {
    if (held?.n === n) return held.bytes;
    const bytes = await getObject(chunkKey(row.id, n));
    if (!bytes) throw new StorageDown("chunk object missing");
    held = { n, bytes };
    return bytes;
  };
  return {
    size: row.bytes,
    async read(offset, length) {
      const parts = [];
      let at = offset;
      const end = Math.min(offset + length, row.bytes);
      while (at < end) {
        const n = Math.floor(at / CHUNK_BYTES);
        const bytes = await chunk(n);
        const from = at - n * CHUNK_BYTES;
        const slice = bytes.subarray(from, Math.min(bytes.length, from + (end - at)));
        parts.push(slice);
        at += slice.length;
      }
      return Buffer.concat(parts);
    }
  };
}
async function dropChunks(row) {
  for (let n = 0; n < row.chunks; n += 1) await deleteObject(chunkKey(row.id, n)).catch(() => void 0);
}
async function refuse2(row, reason) {
  await query("UPDATE uploads SET state = 'refused' WHERE id = $1", [row.id]);
  await dropChunks(row);
  throw new AppError("upload_refused", { file: row.file_name, reason }, { reason });
}
async function assemble(row, key) {
  if (row.chunks === 1) {
    const only = await getObject(chunkKey(row.id, 0));
    if (!only) throw new StorageDown("chunk object missing");
    await putObject(key, only);
    return;
  }
  const uploadId = await createMultipart(key);
  try {
    const tags = [];
    for (let n = 0; n < row.chunks; n += 1) {
      const part = await getObject(chunkKey(row.id, n));
      if (!part) throw new StorageDown("chunk object missing");
      tags.push(await uploadPart(key, uploadId, n + 1, part));
    }
    await completeMultipart(key, uploadId, tags);
  } catch (error) {
    await abortMultipart(key, uploadId);
    throw error;
  }
}
async function digest(row) {
  const hash = createHash5("sha256");
  for (let n = 0; n < row.chunks; n += 1) {
    const part = await getObject(chunkKey(row.id, n));
    if (!part) throw new StorageDown("chunk object missing");
    hash.update(part);
  }
  return hash.digest("hex");
}
async function checkReplacement(media, replaces) {
  const old = await one("SELECT kind FROM media WHERE id = $1", [replaces]);
  if (!old) throw notFound();
  if (old.kind !== media.kind) return UPLOAD_REASONS.replaceType;
  const uses = await query(
    "SELECT p.id AS project_id, p.title, MAX(c.source_out) AS source_out FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.media_id = $1 GROUP BY p.id, p.title ORDER BY p.title",
    [replaces]
  );
  for (const use of uses) {
    const project = await loadProjectRow(pool, use.project_id);
    if (!project) continue;
    const timeline = await loadTimeline(pool, project);
    const longest = Math.max(...timeline.clips.filter((clip) => clip.media_id === replaces).map((clip) => clip.source_out));
    const frames = secondsToFrames(rateOf(project.frame_rate), media.src_num, media.src_den);
    if (frames < longest) return UPLOAD_REASONS.replaceShort(use.title);
  }
  return null;
}
var pause2 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function completeUpload(personId, id) {
  const row = await ownUpload(personId, id);
  if (row.state === "completing") {
    await pause2(200);
    return completeUpload(personId, id);
  }
  if (row.state === "confirmed") {
    const media = await one("SELECT id FROM media WHERE sha256 = $1", [row.sha256]);
    const record4 = media ? await mediaById(pool, media.id) : null;
    if (record4) return { status: 200, body: { duplicate: true, media: record4 } };
  }
  const missing = Array.from({ length: row.chunks }, (_, n) => n).filter((n) => !row.received.includes(n));
  if (missing.length) throw new AppError("upload_incomplete", { missing: missing.join(", ") }, { missing });
  await assertStorage();
  const claimed = await one("UPDATE uploads SET state = 'completing' WHERE id = $1 AND state IN ('open','receiving') RETURNING *", [id]);
  if (!claimed) return completeUpload(personId, id);
  try {
    return await listUpload(claimed);
  } catch (error) {
    await query("UPDATE uploads SET state = 'receiving' WHERE id = $1 AND state = 'completing'", [id]);
    throw error;
  }
}
async function listUpload(row) {
  if (await digest(row) !== row.sha256) return refuse2(row, UPLOAD_REASONS.checksum);
  const verdict = await judgeFile(chunkedFile(row));
  if (!verdict.ok) return refuse2(row, verdict.reason);
  const judged = verdict.media;
  if (row.replaces) {
    const reason = await checkReplacement(judged, row.replaces);
    if (reason) return refuse2(row, reason);
  }
  const duplicate = await one("SELECT id FROM media WHERE sha256 = $1", [row.sha256]);
  if (duplicate) {
    await finish(row);
    const media = await mediaById(pool, duplicate.id);
    if (!media) throw notFound();
    return { status: 200, body: { duplicate: true, media } };
  }
  const replacing = row.replaces ? await one("SELECT bytes, sha256 FROM media WHERE id = $1", [row.replaces]) : void 0;
  if (!await takeStorage(row.bytes)) throw allowanceExceeded(await allowance());
  let listed = null;
  try {
    if (!await headObject(`media/${row.sha256}`)) await assemble(row, `media/${row.sha256}`);
    listed = await tx(async (db) => {
      const mediaId = row.replaces ?? newId("m");
      const seconds = roundExact(judged.src_num * 1000n, judged.src_den) / 1e3;
      const duration = judged.kind === "png" ? null : seconds;
      if (row.replaces) {
        await db.query(
          `UPDATE media SET kind=$2, bytes=$3, sha256=$4, width=$5, height=$6, duration_seconds=$7, sample_rate=$8,
             src_num=$9, src_den=$10 WHERE id=$1`,
          [mediaId, judged.kind, row.bytes, row.sha256, judged.width, judged.height, duration, judged.sample_rate, judged.src_num, judged.src_den]
        );
      } else {
        await db.query(
          `INSERT INTO media (id, name, kind, folder, bytes, sha256, width, height, duration_seconds, sample_rate, src_num, src_den, words)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            mediaId,
            row.file_name,
            judged.kind,
            row.folder,
            row.bytes,
            row.sha256,
            judged.width,
            judged.height,
            duration,
            judged.sample_rate,
            judged.src_num,
            judged.src_den,
            mediaWords(row.file_name, row.folder)
          ]
        );
      }
      return mediaById(db, mediaId);
    });
  } catch (error) {
    await giveBackStorage(row.bytes);
    throw error;
  }
  if (!listed) throw notFound();
  if (replacing) {
    await giveBackStorage(replacing.bytes);
    if (!await one("SELECT 1 FROM media WHERE sha256 = $1", [replacing.sha256])) {
      await deleteObject(`media/${replacing.sha256}`);
      await kv.del(`gatecut:peaks:${replacing.sha256}`);
    }
  }
  await finish(row);
  return { status: 201, body: { duplicate: false, media: listed } };
}
async function finish(row) {
  await query("UPDATE uploads SET state = 'confirmed' WHERE id = $1", [row.id]);
  await dropChunks(row);
}

// server/routes.ts
var routes = [];
function route(method, path2, auth, body, handler) {
  routes.push({ method, segments: path2.split("/").filter(Boolean), auth, body, handler });
}
var MEMBER = ["owner", "editor", "commenter"];
var CUTTERS = ["owner", "editor"];
var OWNER = ["owner"];
var bodyOf = (ctx) => typeof ctx.json === "object" && ctx.json !== null ? ctx.json : {};
async function projectRow(id) {
  const row = await loadProjectRow(pool, id);
  if (!row) throw notFound();
  return row;
}
async function requireLibrary(ctx) {
  if (ctx.actor.is_owner) return;
  const editor = await one("SELECT 1 FROM members WHERE person_id = $1 AND role = 'editor' LIMIT 1", [ctx.actor.id]);
  if (!editor) throw forbidden();
}
route("GET", "/api/health", "public", "none", async () => json({ status: "ok" }));
route("POST", "/api/session", "public", "json", async (ctx) => {
  const { email, password } = bodyOf(ctx);
  const session = await signIn(email, password);
  const { is_owner: _owner, ...person } = session.actor;
  return json({ person }, 200, { "set-cookie": sessionCookie(session.sessionId) });
});
route("GET", "/api/session", "session", "none", async (ctx) => {
  const { is_owner, ...person } = ctx.actor;
  return json({ person, is_owner });
});
route("DELETE", "/api/session", "session", "none", async (ctx) => {
  await signOut(ctx.session?.sessionId ?? "");
  return empty(204, { "set-cookie": clearedCookie });
});
route("GET", "/api/status", "owner", "none", async () => {
  const [storage, queue, mail] = await Promise.all([reachable(), exportQueue.ensure(), smtpReachable()]);
  const word = (up) => up ? "up" : "down";
  return json({ storage: word(storage), queue: word(queue), mail: word(mail) });
});
route("GET", "/api/allowance", "session", "none", async () => json(await allowance()));
route("GET", "/api/profile", "session", "none", async () => {
  const row = await one("SELECT p.name, w.availability FROM workspace w JOIN people p ON p.id = w.owner_id LIMIT 1");
  return json({ name: row?.name ?? "", availability: row?.availability ?? "" });
});
route("PUT", "/api/profile", "owner", "json", async (ctx) => {
  const availability = bodyOf(ctx)["availability"];
  if (typeof availability !== "string" || codePoints(availability) > AVAILABILITY_MAX) throw invalid({ availability: FIELD_ERRORS.other });
  await query("UPDATE workspace SET availability = $1", [availability]);
  return json({ name: ctx.actor.name, availability });
});
route("GET", "/api/outbox", "owner", "none", async () => json({ items: await outboxItems() }));
route("GET", "/api/projects", "session", "none", async (ctx) => json({ items: await listProjects(ctx.actor) }));
route("POST", "/api/projects", "owner", "json", async (ctx) => json(await createProject(ctx.actor, ctx.json), 201));
route("GET", "/api/projects/:id", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  const role = await requireRole(id, ctx.actor, MEMBER);
  return json(await projectDetail(await projectRow(id), role));
});
route("PUT", "/api/projects/:id", "session", "json", async (ctx) => json(await submitOp(ctx.params["id"] ?? "", ctx.actor, ctx.json, "aspect")));
route("GET", "/api/projects/:id/ops", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const after = Number(ctx.query.get("after") ?? 0);
  if (!Number.isInteger(after) || after < 0) throw invalid({ after: FIELD_ERRORS.other });
  return json({ ops: await listOps(id, after) });
});
route("POST", "/api/projects/:id/ops", "session", "json", async (ctx) => json(await submitOp(ctx.params["id"] ?? "", ctx.actor, ctx.json, "ops")));
route("POST", "/api/projects/:id/undo", "session", "json", async (ctx) => json(await submitHistory(ctx.params["id"] ?? "", ctx.actor, ctx.json, "undo")));
route("POST", "/api/projects/:id/redo", "session", "json", async (ctx) => json(await submitHistory(ctx.params["id"] ?? "", ctx.actor, ctx.json, "redo")));
route("GET", "/api/projects/:id/frames/:frame", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const frame2 = Number(ctx.params["frame"]);
  if (!Number.isInteger(frame2) || frame2 < 0) throw invalid({ frame: FIELD_ERRORS.other });
  const project = await projectRow(id);
  const timeline = await loadTimeline(pool, project);
  const media = await mediaDimsOf(pool, timeline.clips);
  const layers = layersAt(frame2, timeline.clips, timeline.rows, media, frameSize(project.aspect_ratio));
  return json({ frame: frame2, timecode: timecode(rateOf(project.frame_rate), frame2), layers });
});
route("GET", "/api/projects/:id/members", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json({ items: await membersOf(pool, id) });
});
route("POST", "/api/projects/:id/members", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json(await addMember(id, ctx.json), 201);
});
route("PUT", "/api/projects/:id/members/:person", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json(await changeRole(id, ctx.params["person"] ?? "", ctx.json));
});
route("DELETE", "/api/projects/:id/members/:person", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  await removeMember(id, ctx.params["person"] ?? "");
  return empty();
});
route("POST", "/api/projects/:id/rows/:row/captions/import", "session", "srt", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, CUTTERS);
  const project = await projectRow(id);
  const rowId = ctx.params["row"] ?? "";
  const row = await one("SELECT kind FROM rows WHERE id = $1 AND project_id = $2", [rowId, id]);
  if (!row) throw notFound();
  const parsed = parseSrt(ctx.raw, rateOf(project.frame_rate));
  const result = await importCaptionsOp(id, ctx.actor, { type: "import_captions", row_id: rowId, cues: parsed.cues, eol: parsed.eol, bom: parsed.bom });
  return json({ cues: parsed.cues.length, version: result.version });
});
route("GET", "/api/projects/:id/rows/:row/captions/export", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, CUTTERS);
  const project = await projectRow(id);
  const row = await one("SELECT kind, srt_eol, srt_bom FROM rows WHERE id = $1 AND project_id = $2", [ctx.params["row"] ?? "", id]);
  if (!row) throw notFound();
  if (row.kind !== "caption") throw invalid({ row_id: FIELD_ERRORS.other });
  const raw = await exportSrt(id, ctx.params["row"] ?? "", rateOf(project.frame_rate), row.srt_eol, row.srt_bom);
  return { status: 200, raw, type: "application/x-subrip; charset=utf-8", headers: { "content-disposition": `attachment; filename="${id}-${ctx.params["row"]}.srt"` } };
});
route("GET", "/api/projects/:id/cuts", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json({ items: await listCuts(id) });
});
route("POST", "/api/projects/:id/cuts", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json(await nameCut(id, ctx.json), 201);
});
route("GET", "/api/projects/:id/cuts/:cut", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json(await cutSnapshot(id, ctx.params["cut"] ?? ""));
});
route("GET", "/api/projects/:id/cuts/:a/compare/:b", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json(await compareCuts(id, ctx.params["a"] ?? "", ctx.params["b"] ?? ""));
});
route("POST", "/api/projects/:id/cuts/:cut/approval", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, ["owner", "commenter"]);
  return json(await approve(id, ctx.params["cut"] ?? "", ctx.actor));
});
route(
  "POST",
  "/api/projects/:id/cuts/:cut/restore",
  "session",
  "json",
  async (ctx) => json(await submitOp(ctx.params["id"] ?? "", ctx.actor, ctx.json, "restore", ctx.params["cut"] ?? ""))
);
route("POST", "/api/projects/:id/review-links", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json(await createLink(id, ctx.json), 201);
});
route("GET", "/api/projects/:id/review-links", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  return json({ items: await listLinks(id) });
});
route("PUT", "/api/review-links/:id", "owner", "json", async (ctx) => json(await shareCut(ctx.params["id"] ?? "", ctx.json)));
route("POST", "/api/review-links/:id/regenerate", "owner", "none", async (ctx) => json(await regenerateLink(ctx.params["id"] ?? ""), 201));
route("DELETE", "/api/review-links/:id", "owner", "none", async (ctx) => {
  await revokeLink(ctx.params["id"] ?? "");
  return empty();
});
route("GET", "/api/review/:token", "public", "none", async (ctx) => {
  const { body, etag } = await reviewBody(ctx.params["token"] ?? "");
  const headers = { etag, "cache-control": "private, no-cache" };
  if (ctx.request.headers["if-none-match"] === etag) return { status: 304, headers };
  return json(body, 200, headers);
});
route("POST", "/api/review/:token/comments", "public", "json", async (ctx) => json(await clientComment(ctx.params["token"] ?? "", ctx.json), 201));
route("POST", "/api/review/:token/approve", "public", "json", async (ctx) => json(await clientApproval(ctx.params["token"] ?? "", ctx.json)));
route("GET", "/api/projects/:id/comments", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const cut = ctx.query.get("cut_id");
  return json({ items: cut ? await listComments(pool, id, "AND cut_id = $2", [cut]) : await listComments(pool, id) });
});
route("POST", "/api/projects/:id/comments", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json(await postNote(id, ctx.actor, ctx.json), 201);
});
route("GET", "/api/projects/:id/comment-draft", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const draft = await one(
    "SELECT body, frame, row_id, clip_id, cut_id, visibility, parent_id, updated_at FROM comment_drafts WHERE project_id = $1 AND person_id = $2",
    [id, ctx.actor.id]
  );
  return json({ draft: draft ?? null });
});
route("PUT", "/api/projects/:id/comment-draft", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  const note = parseNote(ctx.json, true);
  const draft = await one(
    `INSERT INTO comment_drafts (project_id, person_id, body, frame, row_id, clip_id, cut_id, visibility, parent_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (project_id, person_id) DO UPDATE SET body=$3, frame=$4, row_id=$5, clip_id=$6, cut_id=$7, visibility=$8, parent_id=$9, updated_at=now()
     RETURNING body, frame, row_id, clip_id, cut_id, visibility, parent_id, updated_at`,
    [id, ctx.actor.id, note.body, note.frame, note.row_id, note.clip_id, note.cut_id, note.visibility, note.parent_id]
  );
  return json({ draft });
});
route("POST", "/api/projects/:id/exports", "session", "json", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, OWNER);
  const started = await startExport(id, ctx.actor, ctx.json);
  return json(started.body, started.status);
});
route("GET", "/api/projects/:id/exports", "session", "none", async (ctx) => {
  const id = ctx.params["id"] ?? "";
  await requireRole(id, ctx.actor, MEMBER);
  return json({ items: await listExports(id) });
});
route("GET", "/api/exports/:id", "session", "none", async (ctx) => {
  await requireRole(await projectOfExport(ctx.params["id"] ?? ""), ctx.actor, MEMBER);
  return json(await exportById(ctx.params["id"] ?? ""));
});
route("POST", "/api/exports/:id/cancel", "session", "none", async (ctx) => {
  await requireRole(await projectOfExport(ctx.params["id"] ?? ""), ctx.actor, OWNER);
  return json(await cancelExport(ctx.params["id"] ?? ""));
});
route("GET", "/api/exports/:id/manifest", "session", "none", async (ctx) => {
  await requireRole(await projectOfExport(ctx.params["id"] ?? ""), ctx.actor, MEMBER);
  return { status: 302, headers: { location: await manifestLink(ctx.params["id"] ?? "") } };
});
var kitFields = (ctx) => {
  const input = bodyOf(ctx);
  const errors = {};
  const colour = (field) => {
    const value = input[field];
    if (typeof value !== "string" || !/^[0-9a-fA-F]{6}$/.test(value)) errors[field] = FIELD_ERRORS.other;
    return typeof value === "string" ? value.toLowerCase() : "";
  };
  const name = typeof input["name"] === "string" ? input["name"].trim() : "";
  if (!name || codePoints(name) > 60) errors["name"] = FIELD_ERRORS.other;
  const weight = input["font_weight"];
  if (weight !== 400 && weight !== 600) errors["font_weight"] = FIELD_ERRORS.other;
  const fields = { name, text_colour: colour("text_colour"), box_colour: colour("box_colour"), font_weight: weight };
  if (Object.keys(errors).length) throw invalid(errors);
  return fields;
};
route("GET", "/api/kits", "session", "none", async (ctx) => {
  await requireLibrary(ctx);
  return json({ items: await query("SELECT id, name, text_colour, box_colour, font_weight FROM kits ORDER BY seq") });
});
route("POST", "/api/kits", "owner", "json", async (ctx) => {
  const kit = kitFields(ctx);
  const row = await one("INSERT INTO kits (id, name, text_colour, box_colour, font_weight) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, text_colour, box_colour, font_weight", [newId("kit"), kit.name, kit.text_colour, kit.box_colour, kit.font_weight]);
  return json(row, 201);
});
route("PUT", "/api/kits/:id", "owner", "json", async (ctx) => {
  const kit = kitFields(ctx);
  const row = await one("UPDATE kits SET name=$2, text_colour=$3, box_colour=$4, font_weight=$5 WHERE id=$1 RETURNING id, name, text_colour, box_colour, font_weight", [ctx.params["id"], kit.name, kit.text_colour, kit.box_colour, kit.font_weight]);
  if (!row) throw notFound();
  return json(row);
});
route("POST", "/api/tokens", "owner", "json", async (ctx) => json(await issueToken(ctx.json), 201));
route("GET", "/api/tokens", "owner", "none", async () => json({ items: await listTokens() }));
route("DELETE", "/api/tokens/:id", "owner", "none", async (ctx) => {
  if (!await revokeToken(ctx.params["id"] ?? "")) throw notFound();
  return empty();
});
route("POST", "/api/uploads", "owner", "json", async (ctx) => {
  const made = await createUpload(ctx.actor.id, ctx.json);
  return json(made.body, made.status);
});
route("GET", "/api/uploads", "owner", "none", async (ctx) => json({ items: await listUploads(ctx.actor.id) }));
route("PUT", "/api/uploads/:id/chunks/:n", "owner", "octet", async (ctx) => {
  await putChunk(ctx.actor.id, ctx.params["id"] ?? "", Number(ctx.params["n"]), ctx.raw);
  return empty();
});
route("GET", "/api/uploads/:id", "owner", "none", async (ctx) => json(await uploadState(ctx.actor.id, ctx.params["id"] ?? "")));
route("POST", "/api/uploads/:id/complete", "owner", "none", async (ctx) => {
  const done = await completeUpload(ctx.actor.id, ctx.params["id"] ?? "");
  return json(done.body, done.status);
});
route("GET", "/api/media", "session", "none", async (ctx) => {
  await requireLibrary(ctx);
  return json(await listMedia(ctx.query));
});
route("GET", "/api/media/:id/peaks", "session", "none", async (ctx) => {
  await requireLibrary(ctx);
  return json({ peaks: await peaksOf(ctx.params["id"] ?? "") });
});
route("DELETE", "/api/media/:id", "owner", "none", async (ctx) => {
  await deleteMedia(ctx.params["id"] ?? "");
  return empty();
});
route("GET", "/api/v1/projects", "token", "none", async (ctx) => json(await readProjects(ctx.query)));
route("GET", "/api/v1/projects/:id", "token", "none", async (ctx) => json(await readProject(ctx.params["id"] ?? "")));
route("GET", "/api/v1/projects/:id/clips", "token", "none", async (ctx) => json(await readClips(ctx.params["id"] ?? "", ctx.query)));
route("GET", "/api/v1/projects/:id/cuts", "token", "none", async (ctx) => json(await readCuts(ctx.params["id"] ?? "", ctx.query)));
route("GET", "/api/v1/projects/:id/exports", "token", "none", async (ctx) => json(await readExports(ctx.params["id"] ?? "", ctx.query)));
route("GET", "/api/v1/projects/:id/comments", "token", "none", async (ctx) => json(await readComments(ctx.params["id"] ?? "", ctx.query)));
var apiRoutes = routes;

// server/seed.ts
import { randomBytes as randomBytes5 } from "node:crypto";

// server/standins.ts
import { createHash as createHash6 } from "node:crypto";
import { crc32 as crc322, deflateSync } from "node:zlib";
var box = (type, payload) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
};
function mp4StandIn(name, width, height, timescale, duration) {
  const ftyp = box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isom")]));
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(duration, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(7, 0);
  tkhd.writeUInt32BE(1, 12);
  tkhd.writeUInt32BE(duration, 20);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  const moov = box("moov", Buffer.concat([box("mvhd", mvhd), box("trak", box("tkhd", tkhd))]));
  return Buffer.concat([ftyp, moov, box("free", Buffer.from(name, "utf8"))]);
}
function wavStandIn(samples) {
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const amplitude = 16384 * i / samples;
    data.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * 110 * i / 8e3)), i * 2);
  }
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(8e3, 4);
  fmt.writeUInt32LE(16e3, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const head = Buffer.alloc(8);
  head.write("fmt ", 0, "latin1");
  head.writeUInt32LE(16, 4);
  const dataHead = Buffer.alloc(8);
  dataHead.write("data", 0, "latin1");
  dataHead.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([Buffer.from("WAVE"), head, fmt, dataHead, data]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}
function pngChunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc322(typed), 0);
  return Buffer.concat([head, typed, tail]);
}
function pngStandIn(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
var sha256Of = (data) => createHash6("sha256").update(data).digest("hex");

// server/seed.ts
var PEOPLE = [
  { id: "noor", name: "Noor Achterberg", email: "noor@gatecut.example", password: "reel-owner-4417", handle: "noor", owner: true },
  { id: "idris", name: "Idris Fallowfield", email: "idris@kestrelvane.example", password: "reel-editor-2290", handle: "idris", owner: false },
  { id: "pia", name: "Pia Marchetti", email: "pia@kestrelvane.example", password: "reel-editor-5531", handle: "pia", owner: false },
  { id: "maren", name: "Maren Okafor", email: "maren@kestrelvane.example", password: "reel-producer-8812", handle: "maren", owner: false },
  { id: "theo", name: "Theo Brandt", email: "theo@lowtide.example", password: "reel-editor-6604", handle: "theo", owner: false }
];
var MEDIA = [
  { id: "hl-a001-c003", file: "HL_A001_C003.mp4", folder: "Harbour Light / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 24e3, duration: 480480 } },
  { id: "hl-a002-c011", file: "HL_A002_C011.mp4", folder: "Harbour Light / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 24e3, duration: 288288 } },
  { id: "hl-a004-c002", file: "HL_A004_C002.mp4", folder: "Harbour Light / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 24e3, duration: 600600 } },
  { id: "harbour-bed", file: "harbour_bed.wav", folder: "Harbour Light / Audio", header: { kind: "wav", samples: 240240 } },
  { id: "cl-hero-01", file: "CL_HERO_01.mp4", folder: "Copperline / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25e3, duration: 16e5 } },
  { id: "cl-hero-02", file: "CL_HERO_02.mp4", folder: "Copperline / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25e3, duration: 15e5 } },
  { id: "sm-reel-01", file: "SM_REEL_01.mp4", folder: "Saltmarsh / Rushes", header: { kind: "mp4", width: 1080, height: 1920, timescale: 25e3, duration: 375e3 } },
  { id: "ng-run-01", file: "NG_RUN_01.mp4", folder: "Northgate / Rushes", header: { kind: "mp4", width: 1080, height: 1080, timescale: 3e4, duration: 600600 } },
  { id: "fb-expl-01", file: "FB_EXPL_01.mp4", folder: "Ferrow Bank / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 24, duration: 1080 } },
  { id: "bh-recap-01", file: "BH_RECAP_01.mp4", folder: "Blue Hour / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25e3, duration: 15e5 } },
  { id: "qs-014", file: "QS_014.mp4", folder: "Quayside / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25e3, duration: 6e5 } },
  { id: "qs-022", file: "QS_022.mp4", folder: "Quayside / Rushes", header: { kind: "mp4", width: 1920, height: 1080, timescale: 25e3, duration: 3e5 } },
  { id: "ol-int-01", file: "OL_INT_01.mp4", folder: "Orchard Lane / Rushes", header: { kind: "mp4", width: 1080, height: 1350, timescale: 24e3, duration: 1801800 } },
  { id: "kv-logo", file: "kv_logo.png", folder: "Kestrel & Vane / Brand", header: { kind: "png", width: 1200, height: 400 } }
];
function standIn(media) {
  const h = media.header;
  if (h.kind === "mp4") return mp4StandIn(media.file, h.width, h.height, h.timescale, h.duration);
  if (h.kind === "wav") return wavStandIn(h.samples);
  return pngStandIn(h.width, h.height, [58, 46, 36]);
}
async function ensureSeedObjects(sha) {
  for (const media of MEDIA) {
    const key = `media/${sha.get(media.id)}`;
    try {
      if (!await headObject(key)) await putObject(key, standIn(media));
    } catch {
      return;
    }
  }
}
function seedMediaSha() {
  return new Map(MEDIA.map((media) => [media.id, sha256Of(standIn(media))]));
}
var KESTREL = "Kestrel & Vane";
var LOWTIDE = "Lowtide Studio";
var OWNER2 = [["noor", "owner"]];
var picture = (id) => [{ id, name: "Picture", kind: "video" }];
var markers = (...frames) => frames.map((frame2) => ({ frame: frame2, label: "" }));
var solo = (id, row, media, name, frames) => ({
  id,
  row,
  media,
  name,
  kind: "mp4",
  start: 0,
  end: frames,
  sourceIn: 0,
  sourceOut: frames
});
var PROJECTS = [
  {
    id: "harbour-light",
    title: "Harbour Light 30s",
    agency: KESTREL,
    description: "Thirty seconds for a harbour lamp-maker's anniversary.",
    rate: "23.976",
    aspect: "16:9",
    members: [["noor", "owner"], ["idris", "editor"], ["pia", "editor"], ["maren", "commenter"]],
    rows: [
      { id: "hl-titles", name: "Titles", kind: "video" },
      { id: "hl-picture", name: "Picture", kind: "video" },
      { id: "hl-music", name: "Music", kind: "audio", locked: true },
      { id: "hl-captions", name: "Captions", kind: "caption" }
    ],
    clips: [
      { id: "hl-c1", row: "hl-picture", media: "hl-a001-c003", name: "HL_A001_C003", kind: "mp4", start: 0, end: 240, sourceIn: 48, sourceOut: 288, group: "hl-g1" },
      {
        id: "hl-c2",
        row: "hl-picture",
        media: "hl-a002-c011",
        name: "HL_A002_C011",
        kind: "mp4",
        start: 240,
        end: 480,
        sourceIn: 0,
        sourceOut: 240,
        keyframes: {
          opacity: [{ frame: 0, value: 0, curve: "eased" }, { frame: 24, value: 100, curve: "linear" }],
          scale: [{ frame: 0, value: 100, curve: "linear" }, { frame: 240, value: 120, curve: "linear" }]
        }
      },
      { id: "hl-c3", row: "hl-picture", media: "hl-a004-c002", name: "HL_A004_C002", kind: "mp4", start: 480, end: 719, sourceIn: 120, sourceOut: 359 },
      { id: "hl-c4", row: "hl-music", media: "harbour-bed", name: "harbour_bed", kind: "wav", start: 0, end: 719, sourceIn: 0, sourceOut: 719 },
      { id: "hl-c5", row: "hl-titles", name: "Harbour Light", kind: "text", start: 24, end: 120, sourceIn: 0, sourceOut: 96, group: "hl-g1", text: "Harbour Light" }
    ],
    markers: [{ frame: 0, label: "Open" }, { frame: 240, label: "Gull" }, { frame: 480, label: "Lamp" }, { frame: 600, label: "Tagline" }]
  },
  {
    id: "copperline",
    title: "Copperline Launch Teaser",
    agency: KESTREL,
    description: "Launch teaser for a copper cookware line.",
    rate: "25",
    aspect: "16:9",
    members: [["noor", "owner"], ["maren", "commenter"]],
    rows: picture("cl-picture"),
    clips: [solo("cl-c1", "cl-picture", "cl-hero-01", "CL_HERO_01", 1500), { ...solo("cl-c2", "cl-picture", "cl-hero-02", "CL_HERO_02", 1450), start: 1500, end: 2950 }],
    markers: markers(0, 750, 1500, 2250)
  },
  {
    id: "saltmarsh",
    title: "Saltmarsh Coffee Reels",
    agency: LOWTIDE,
    description: "Three vertical reels for a roastery.",
    rate: "25",
    aspect: "9:16",
    members: OWNER2,
    rows: picture("sm-picture"),
    clips: [solo("sm-c1", "sm-picture", "sm-reel-01", "SM_REEL_01", 375)],
    markers: markers(0, 125, 250, 350)
  },
  {
    id: "northgate",
    title: "Northgate Run Club",
    agency: LOWTIDE,
    description: "Square spots for a weekly running club.",
    rate: "29.97",
    aspect: "1:1",
    members: OWNER2,
    rows: picture("ng-picture"),
    clips: [solo("ng-c1", "ng-picture", "ng-run-01", "NG_RUN_01", 600)],
    markers: markers(0, 150, 300, 450)
  },
  {
    id: "ferrow-bank",
    title: "Ferrow Bank Explainer",
    agency: KESTREL,
    description: "Explainer for a small regional bank.",
    rate: "24",
    aspect: "16:9",
    members: OWNER2,
    rows: picture("fb-picture"),
    clips: [solo("fb-c1", "fb-picture", "fb-expl-01", "FB_EXPL_01", 1080)],
    markers: markers(0, 360, 720)
  },
  {
    id: "blue-hour",
    title: "Blue Hour Festival Recap",
    agency: LOWTIDE,
    description: "One-minute recap of a night market.",
    rate: "25",
    aspect: "16:9",
    members: OWNER2,
    rows: picture("bh-picture"),
    clips: [solo("bh-c1", "bh-picture", "bh-recap-01", "BH_RECAP_01", 1500)],
    markers: markers(0, 500, 1e3)
  },
  {
    id: "quayside",
    title: "Quayside Teaser",
    agency: KESTREL,
    description: "An older teaser kept for reference.",
    rate: "25",
    aspect: "16:9",
    legacy: true,
    members: OWNER2,
    rows: picture("qs-picture"),
    clips: [
      { id: "qs-c1", row: "qs-picture", media: "qs-014", name: "QS_014", kind: "mp4", start: 0, end: 0, sourceIn: 0, sourceOut: 0, legacy: { start: "0", source_in: "0", source_out: "12.34" } },
      { id: "qs-c2", row: "qs-picture", media: "qs-022", name: "QS_022", kind: "mp4", start: 0, end: 0, sourceIn: 0, sourceOut: 0, legacy: { start: "12.34", source_in: "2.02", source_out: "9.5" } }
    ],
    markers: [{ frame: 0, label: "", legacy: "0" }, { frame: 0, label: "", legacy: "6.1" }, { frame: 0, label: "", legacy: "12.34" }]
  },
  {
    id: "orchard-lane",
    title: "Orchard Lane Interview",
    agency: LOWTIDE,
    description: "Sit-down interview with an orchard keeper.",
    rate: "23.976",
    aspect: "4:5",
    legacy: true,
    members: OWNER2,
    rows: picture("ol-picture"),
    clips: [{ id: "ol-c1", row: "ol-picture", media: "ol-int-01", name: "OL_INT_01", kind: "mp4", start: 0, end: 0, sourceIn: 0, sourceOut: 0, legacy: { start: "0", source_in: "4.2", source_out: "64.2" } }],
    markers: [{ frame: 0, label: "", legacy: "0" }, { frame: 0, label: "", legacy: "30" }, { frame: 0, label: "", legacy: "60" }]
  }
];
function clipRecord(seed2, rowId) {
  return {
    id: seed2.id,
    row_id: rowId,
    name: seed2.name ?? seed2.text ?? seed2.id,
    kind: seed2.kind,
    media_id: seed2.media ?? null,
    start_frame: seed2.start,
    end_frame: seed2.end,
    source_in: seed2.sourceIn,
    source_out: seed2.sourceOut,
    speed_percent: 100,
    hidden: false,
    group_id: seed2.group ?? null,
    text: seed2.text ?? null,
    text_colour: seed2.kind === "text" ? "ffffff" : null,
    box_colour: seed2.kind === "text" ? "000000" : null,
    font_weight: seed2.kind === "text" ? 600 : null,
    keyframes: seed2.keyframes ?? {},
    base: {}
  };
}
async function seed(client) {
  const existing = await client.query("SELECT 1 FROM people LIMIT 1");
  if (existing.rowCount) return;
  const sha = seedMediaSha();
  for (const person of PEOPLE) {
    await client.query("INSERT INTO people (id, name, email, handle, password_hash, is_owner) VALUES ($1,$2,$3,$4,$5,$6)", [
      person.id,
      person.name,
      person.email,
      person.handle,
      hashPassword(person.password),
      person.owner
    ]);
  }
  await client.query("INSERT INTO workspace (id, owner_id, availability, carried_storage_bytes, opening_minutes, opening_month) VALUES ($1,'noor',$2,$3,$4,$5)", [
    `ws-${randomBytes5(8).toString("hex")}`,
    "Booked through 14 November; taking new cuts from 17 November.",
    412e8,
    212,
    currentMonth()
  ]);
  for (const media of MEDIA) {
    const h = media.header;
    const bytes = standIn(media).length;
    const [num, den] = h.kind === "mp4" ? [BigInt(h.duration), BigInt(h.timescale)] : h.kind === "wav" ? [BigInt(h.samples), 8000n] : [3600n, 1n];
    await client.query(
      `INSERT INTO media (id, name, kind, folder, bytes, sha256, width, height, duration_seconds, sample_rate, src_num, src_den, words)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        media.id,
        media.file,
        h.kind,
        media.folder,
        bytes,
        sha.get(media.id),
        h.kind === "wav" ? null : h.width,
        h.kind === "wav" ? null : h.height,
        h.kind === "png" ? null : roundExact(num * 1000n, den) / 1e3,
        h.kind === "wav" ? 8e3 : null,
        num,
        den,
        mediaWords(media.file, media.folder)
      ]
    );
  }
  for (const project of PROJECTS) {
    await client.query(
      "INSERT INTO projects (id, title, agency, description, frame_rate, aspect_ratio, time_unit) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [project.id, project.title, project.agency, project.description, project.rate, project.aspect, project.legacy ? "seconds" : "frames"]
    );
    for (const [person, role] of project.members) await client.query("INSERT INTO members (project_id, person_id, role) VALUES ($1,$2,$3)", [project.id, person, role]);
    for (const [index, row] of project.rows.entries()) {
      await client.query("INSERT INTO rows (id, project_id, name, kind, position, locked) VALUES ($1,$2,$3,$4,$5,$6)", [row.id, project.id, row.name, row.kind, index + 1, row.locked ?? false]);
    }
    for (const clip of project.clips) {
      const record4 = clipRecord(clip, clip.row);
      await client.query(
        `INSERT INTO clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out, speed_percent, hidden,
           group_id, text, text_colour, box_colour, font_weight, keyframes, base, legacy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,100,false,$11,$12,$13,$14,$15,$16,'{}',$17)`,
        [
          record4.id,
          project.id,
          record4.row_id,
          record4.name,
          record4.kind,
          record4.media_id,
          record4.start_frame,
          record4.end_frame,
          record4.source_in,
          record4.source_out,
          record4.group_id,
          record4.text,
          record4.text_colour,
          record4.box_colour,
          record4.font_weight,
          JSON.stringify(record4.keyframes),
          clip.legacy ? JSON.stringify(clip.legacy) : null
        ]
      );
    }
    for (const marker of project.markers) {
      await client.query("INSERT INTO markers (project_id, frame, label, legacy) VALUES ($1,$2,$3,$4)", [project.id, marker.frame, marker.label, marker.legacy ?? null]);
    }
  }
  await seedHarbourLight(client);
  await seedCopperlineCut(client);
}
async function seedHarbourLight(client) {
  const project = PROJECTS[0];
  if (!project) return;
  const captions = [
    ["hl-cap-1", 30, 96, "Every boat comes home"],
    ["hl-cap-2", 264, 360, "to the same light."],
    ["hl-cap-3", 600, 700, "Harbour Light. Since 1898."]
  ];
  for (const [id, start, end, text2] of captions) {
    await client.query("INSERT INTO captions (id, project_id, row_id, start_frame, end_frame, text) VALUES ($1,'harbour-light','hl-captions',$2,$3,$4)", [id, start, end, text2]);
  }
  const rows = project.rows.map((row, index) => ({ id: row.id, name: row.name, kind: row.kind, position: index + 1, locked: row.locked ?? false, srt_eol: "\n", srt_bom: false }));
  const clips = project.clips.map((clip) => clipRecord(clip, clip.row));
  const capRecords = captions.map(([id, start, end, text2]) => ({ id, row_id: "hl-captions", start_frame: start, end_frame: end, text: text2, orig_start_ms: null, orig_end_ms: null }));
  const cutOne = {
    rows,
    captions: capRecords,
    clips: clips.map((clip) => clip.id === "hl-c3" ? { ...clip, start_frame: 500, source_out: 339 } : clip)
  };
  const cutTwo = { rows, clips, captions: capRecords };
  for (const [id, name, snapshot, shared] of [["hl-cut-1", "Cut 1", cutOne, true], ["hl-cut-2", "Cut 2", cutTwo, false]]) {
    await client.query("INSERT INTO cuts (id, project_id, name, version, total_frames, shared, snapshot) VALUES ($1,'harbour-light',$2,1,719,$3,$4)", [id, name, shared, JSON.stringify(snapshot)]);
  }
  await client.query("INSERT INTO review_links (id, project_id, cut_id, token, expires_at) VALUES ('hl-link-1','harbour-light','hl-cut-1','rv-harbour-cut1-7f3a2c', now() + interval '30 days')");
  await client.query(
    `INSERT INTO comments (id, project_id, author_id, author_name, body, visibility, cut_id, pin_frame, pin_row_id, pin_clip_id, pin_offset, mentions)
     VALUES ('hl-n1','harbour-light','maren','Maren Okafor','Hold on the gull a beat longer @noor','team',NULL,300,'hl-picture','hl-c2',60,'["noor"]'),
            ('hl-n2','harbour-light',NULL,'Ada Brightwater','Can the lamp shot hold longer?','review','hl-cut-1',560,'hl-picture','hl-c3',60,'[]')`
  );
}
async function seedCopperlineCut(client) {
  const project = PROJECTS[1];
  if (!project) return;
  const rows = project.rows.map((row, index) => ({ id: row.id, name: row.name, kind: row.kind, position: index + 1, locked: false, srt_eol: "\n", srt_bom: false }));
  const snapshot = { rows, clips: project.clips.map((clip) => clipRecord(clip, clip.row)), captions: [] };
  await client.query("INSERT INTO cuts (id, project_id, name, version, total_frames, snapshot) VALUES ('cl-cut-1','copperline',$1,1,2950,$2)", ["Director's 2m", JSON.stringify(snapshot)]);
}

// server/index.ts
async function retried(step) {
  const deadline = Date.now() + 6e4;
  for (; ; ) {
    try {
      return await step();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
  }
}
async function settle() {
  await upgradeOlderProjects();
  await ensureBucket().catch(() => void 0);
  await ensureSeedObjects(seedMediaSha());
  await retried(ensureCounters);
  startExports();
  startMail();
  setInterval(() => hub.sweepExpired(), 500).unref();
}
var schemaReady = migrate(seed);
schemaReady.then(settle).catch((error) => {
  process.stderr.write(`boot failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
  process.exit(1);
});
var server = http.createServer((request, response) => {
  void (async () => {
    try {
      const path2 = new URL(request.url ?? "/", "http://local").pathname;
      if (path2 !== "/api/health") await schemaReady;
      send2(response, path2.startsWith("/api/") ? await dispatch(apiRoutes, request) : await serveStatic(request));
    } catch (error) {
      send2(response, errorReply(error));
    }
  })();
});
server.on("upgrade", (request, socket, head) => hub.upgrade(request, socket, head));
server.listen(config.port, "0.0.0.0");
async function shutdown() {
  hub.closeAll();
  await exportQueue.close();
  server.close();
  await pool.end().catch(() => void 0);
  process.exit(0);
}
process.on("unhandledRejection", (reason) => process.stderr.write(`unhandled rejection: ${String(reason)}
`));
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
