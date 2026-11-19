// server/instance.ts
import { createServer } from "node:http";

// server/config.ts
function required(name) {
  const value = process.env[name];
  if (value === void 0 || value === "") throw new Error(`${name} is not set`);
  return value;
}
var publicPort = Number(process.env.APP_PUBLIC_PORT ?? 4173);
var idleSeconds = Number(process.env.SESSION_IDLE_SECONDS ?? 1800);
function instanceConfig() {
  return {
    instanceId: required("GANDYBOARD_INSTANCE"),
    databaseUrl: required("DATABASE_URL"),
    valkeyUrl: required("VALKEY_URL"),
    gotenbergUrl: required("GOTENBERG_URL"),
    internalToken: required("GANDYBOARD_INTERNAL_TOKEN")
  };
}

// server/db.ts
import pg from "pg";
pg.types.setTypeParser(20, (value) => Number(value));
pg.types.setTypeParser(1700, (value) => Number(value));
var pool;
function openPool(databaseUrl) {
  pool = new pg.Pool({ connectionString: databaseUrl, max: 24 });
  pool.on("error", () => void 0);
  return pool;
}
function db() {
  if (pool === void 0) throw new Error("database pool is not open");
  return pool;
}
async function transaction(work) {
  const client = await db().connect();
  const tx = { client, afterCommit: [] };
  try {
    await client.query("begin");
    const result = await work(tx);
    await client.query("commit");
    for (const hook of tx.afterCommit) hook();
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
}
async function rows(client, text, values = []) {
  const result = await client.query(text, values);
  return result.rows;
}
async function one(client, text, values = []) {
  return (await rows(client, text, values))[0];
}
var SCHEMA = `
create table if not exists users (
  id text primary key, email text not null unique, display_name text not null, password_hash text not null,
  is_founder boolean not null default false, walkthrough_done boolean not null default false);
create table if not exists auth_sessions (
  token_hash text primary key, user_id text not null references users(id), last_seen timestamptz not null default now());
create table if not exists workspaces (
  id text primary key, name text not null, standards jsonb not null, standards_revision integer not null default 1,
  created_at timestamptz not null default now());
create table if not exists members (
  workspace_id text not null references workspaces(id), user_id text not null references users(id),
  role text not null, revision integer not null default 1, created_at timestamptz not null default now(),
  primary key (workspace_id, user_id));
create table if not exists idempotency_keys (
  workspace_id text not null, user_id text not null, key text not null, fingerprint text not null,
  status integer not null, body jsonb not null, primary key (workspace_id, user_id, key));
create table if not exists layouts (
  id text primary key, workspace_id text not null references workspaces(id), name text not null,
  revision integer not null default 0, content jsonb not null, trash jsonb not null default '[]',
  module_revisions jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists layout_versions (
  id text primary key, layout_id text not null references layouts(id), number integer not null, state text not null,
  label text not null, canonical_hash text not null, content jsonb not null, saved_by text not null,
  saved_at timestamptz not null default now(), restored_from text, revision integer not null default 1,
  unique (layout_id, number));
create table if not exists layout_history (
  id bigserial primary key, layout_id text not null, module_id text, actor_id text, actor_name text,
  at timestamptz not null default now(), action text not null, object_id text, from_value text, to_value text);
create index if not exists layout_history_layout on layout_history (layout_id, id desc);
create table if not exists sessions (
  id text primary key, workspace_id text not null references workspaces(id), layout_id text not null references layouts(id),
  name text not null, status text not null, hold_reason text, ratio integer not null, revision bigint not null default 0,
  control_revision integer not null default 0, session_version integer not null default 1, tick bigint not null default 0,
  last_tick_at timestamptz, layout_version_id text not null, layout_version_number integer not null,
  timetable_version integer not null, state jsonb not null, created_at timestamptz not null default now());
create index if not exists sessions_status on sessions (status);
create table if not exists session_ticks (
  session_id text not null, tick bigint not null, revision bigint not null, positions jsonb not null,
  counters jsonb not null, committed_at timestamptz not null default now(), unique (session_id, tick));
create table if not exists event_outbox (
  stream text not null, seq bigint not null, type text not null, payload jsonb not null, published_at timestamptz,
  unique (stream, seq));
create index if not exists event_outbox_pending on event_outbox (stream, seq) where published_at is null;
create table if not exists crew_packets (
  id text primary key, session_id text not null, workspace_id text not null, state text not null,
  content_hash text not null default '', pdf_bytes bytea, session_version integer not null, failure text,
  issued_by text not null, issued_at timestamptz not null default now(), ready_at timestamptz,
  updated_at timestamptz not null default now());
create index if not exists crew_packets_session on crew_packets (session_id, issued_at);
`;
var SCHEMA_LOCK = 7190001;
async function applySchemaAndSeed(seed) {
  const client = await db().connect();
  try {
    await client.query("select pg_advisory_lock($1)", [SCHEMA_LOCK]);
    try {
      await client.query(SCHEMA);
      await client.query("begin");
      try {
        await seed(client);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [SCHEMA_LOCK]);
    }
  } finally {
    client.release();
  }
}

// server/http/errors.ts
var ApiError = class extends Error {
  constructor(status, code, message2, extras = {}) {
    super(message2);
    this.status = status;
    this.code = code;
    this.extras = extras;
  }
  get body() {
    return { error: { code: this.code, message: this.message, ...this.extras } };
  }
};
var sessionRequired = () => new ApiError(401, "session_required", "Your sign-in has ended. Sign in to carry on.");
var invalidCredentials = () => new ApiError(401, "invalid_credentials", "That email and password do not match.");
var forbidden = () => new ApiError(403, "forbidden", "You do not have access to this.");
var notFound = () => new ApiError(404, "not_found", "That item is not in this workspace.");
var keyRequired = () => new ApiError(422, "idempotency_key_required", "This request needs a key.");
var keyReused = () => new ApiError(422, "idempotency_key_reused", "This key was already used with different details.");
var staleRevision = (currentRevision) => new ApiError(409, "stale_revision", "Someone changed this first. Review the latest and try again.", { current_revision: currentRevision });
var valkeyUnavailable = () => new ApiError(503, "valkey_unavailable", "Live updates are paused. Sessions are held at their last committed tick.");
var invalidFields = (fields) => new ApiError(422, "invalid_fields", "Check the highlighted fields.", { fields });
var bodyTooLarge = () => new ApiError(413, "body_too_large", "That request is too large.");
var badJson = () => new ApiError(400, "bad_json", "That request could not be read.");
var badContentType = () => new ApiError(415, "bad_content_type", "Send JSON.");
var instancesRestarting = () => new ApiError(503, "instances_restarting", "Gandyboard is restarting. Try again in a moment.");
var rule = (code, message2, extras = {}) => new ApiError(422, code, message2, extras);
var serverError = () => new ApiError(500, "server_error", "Something went wrong. Try again.");
var pieceRefused = (findings) => new ApiError(422, "validation_failed", "This piece breaks the club standard.", { findings });
var versionRefused = (findings) => new ApiError(422, "validation_failed", "This version breaks the club standard.", { findings });
var openEndTaken = (label, takenBy, currentRevision, pieceId) => new ApiError(409, "open_end_taken", `Open end ${label} was just extended by ${takenBy}. Nothing was changed.`, { current_revision: currentRevision, piece_id: pieceId });
var routeConflict = (message2, extras) => new ApiError(422, "route_conflict", message2, extras);

// server/auth.ts
import { randomBytes as randomBytes2, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// server/canonical.ts
import { createHash, randomBytes } from "node:crypto";
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value;
  const keys = Object.keys(record).filter((key) => record[key] !== void 0).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}
function canonicalHash(value) {
  return sha256Hex(canonicalJson(value));
}
function newId(prefix) {
  return `${prefix}-${randomBytes(5).toString("hex")}`;
}

// server/auth.ts
var scrypt = promisify(scryptCallback);
var KEY_LENGTH = 32;
async function hashPassword(password) {
  const salt = randomBytes2(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}
async function matches(password, stored) {
  const [salt, key] = stored.split(":");
  const derived = await scrypt(password, Buffer.from(salt, "hex"), KEY_LENGTH);
  return timingSafeEqual(derived, Buffer.from(key, "hex"));
}
var UNKNOWN_PERSON_HASH = hashPassword("unknown person");
async function signIn(email, password) {
  const found = await one(
    db(),
    "select id, email, display_name, password_hash from users where email = $1",
    [email.trim().toLowerCase()]
  );
  if (!await matches(password, found?.password_hash ?? await UNKNOWN_PERSON_HASH) || found === void 0) throw invalidCredentials();
  const token = randomBytes2(32).toString("hex");
  await db().query("insert into auth_sessions (token_hash, user_id) values ($1, $2)", [sha256Hex(token), found.id]);
  await db().query(`delete from auth_sessions where last_seen < now() - ($1 || ' seconds')::interval`, [String(idleSeconds)]);
  return { user: { id: found.id, email: found.email, display_name: found.display_name }, token };
}
async function signOut(token) {
  await db().query("delete from auth_sessions where token_hash = $1", [sha256Hex(token)]);
}
async function userForToken(token) {
  return one(
    db(),
    `with seen as (
       update auth_sessions set last_seen = now()
       where token_hash = $1 and last_seen > now() - ($2 || ' seconds')::interval returning user_id)
     select u.id, u.email, u.display_name, u.is_founder, u.walkthrough_done from users u join seen on seen.user_id = u.id`,
    [sha256Hex(token), String(idleSeconds)]
  );
}
async function roleIn(workspaceId, userId) {
  return (await one(db(), "select role from members where workspace_id = $1 and user_id = $2", [workspaceId, userId]))?.role;
}

// server/services/outbox.ts
var DRAIN_LOCK = 7190002;
var wake = () => void 0;
async function writeOutbox(tx, stream, seq, type, payload) {
  await tx.client.query("insert into event_outbox (stream, seq, type, payload) values ($1, $2, $3, $4)", [stream, seq, type, JSON.stringify(payload)]);
  tx.afterCommit.push(() => wake());
}
var Outbox = class {
  constructor(valkey) {
    this.valkey = valkey;
    wake = () => this.kick();
  }
  draining = false;
  again = false;
  start() {
    setInterval(() => this.kick(), 200);
  }
  kick() {
    if (this.draining) {
      this.again = true;
      return;
    }
    void this.drain();
  }
  async drain() {
    if (!this.valkey.up) return;
    this.draining = true;
    const client = await db().connect();
    try {
      const got = await client.query("select pg_try_advisory_lock($1) as locked", [DRAIN_LOCK]);
      if (!got.rows[0].locked) return;
      try {
        do {
          this.again = false;
          for (; ; ) {
            const batch = await rows(client, "select stream, seq, type, payload from event_outbox where published_at is null order by stream, seq limit 100");
            if (batch.length === 0) break;
            for (const event of batch) {
              await this.valkey.publish(event.stream, event.seq, event.type, JSON.stringify(event.payload));
              await client.query("update event_outbox set published_at = now() where stream = $1 and seq = $2", [event.stream, event.seq]);
            }
          }
        } while (this.again);
      } finally {
        await client.query("select pg_advisory_unlock($1)", [DRAIN_LOCK]);
      }
    } catch {
      return;
    } finally {
      client.release();
      this.draining = false;
    }
  }
};

// server/services/valkey.ts
import { Redis } from "ioredis";
var LEASE_SCRIPT = `
local holder = redis.call('get', KEYS[1])
if holder == false then
  redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
elseif holder == ARGV[1] then
  redis.call('pexpire', KEYS[1], ARGV[2])
  return 1
end
return 0`;
var LEASE_MS = 3e3;
var STREAM_KEEP = 2e3;
var sessionStream = (sessionId) => `gandyboard:session:${sessionId}:events`;
var layoutStream = (layoutId) => `gandyboard:layout:${layoutId}:events`;
var leaseKey = (sessionId) => `gandyboard:session:${sessionId}:tick-lease`;
function options() {
  return {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 1500,
    commandTimeout: 2500,
    retryStrategy: (attempt) => Math.min(attempt * 250, 2e3),
    reconnectOnError: () => false
  };
}
function entriesOf(raw) {
  return raw.map(([id, fields]) => {
    const record = {};
    for (let i = 0; i < fields.length; i += 2) record[fields[i]] = fields[i + 1];
    return { seq: Number(id.split("-")[0]), type: record.type, payload: record.payload };
  });
}
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var Valkey = class {
  constructor(url, instanceId) {
    this.instanceId = instanceId;
    this.commands = new Redis(url, options());
    this.reader = new Redis(url, options());
    this.commands.on("error", () => void 0);
    this.reader.on("error", () => void 0);
    this.commands.defineCommand("holdLease", { numberOfKeys: 1, lua: LEASE_SCRIPT });
  }
  commands;
  reader;
  listeners = [];
  up = false;
  // True once the first probe has answered, so a cold start is not mistaken for an outage.
  settled = false;
  failures = 0;
  onChange(listener) {
    this.listeners.push(listener);
  }
  set(up) {
    if (up === this.up) return;
    this.up = up;
    for (const listener of this.listeners) listener(up);
  }
  // Probes every half second; two failures in a row mean down, one answer means up.
  watch() {
    const probe = async () => {
      try {
        if (this.commands.status === "wait") await Promise.race([this.commands.connect(), delay(2e3).then(() => Promise.reject(new Error("no connection")))]);
        if (await this.commands.ping() !== "PONG") throw new Error("no pong");
        this.failures = 0;
        this.set(true);
      } catch {
        this.failures += 1;
        if (this.failures >= 2 || !this.settled) this.set(false);
      }
      this.settled = true;
      setTimeout(() => void probe(), 500);
    };
    void probe();
  }
  async ping() {
    try {
      return await this.commands.ping() === "PONG";
    } catch {
      return false;
    }
  }
  async holdLease(sessionId) {
    const result = await this.commands.holdLease(leaseKey(sessionId), this.instanceId, LEASE_MS);
    return result === 1;
  }
  async leaseHolder(sessionId) {
    return this.commands.get(leaseKey(sessionId));
  }
  // Idempotent: an entry that is already on the stream counts as published.
  async publish(stream, seq, type, payload) {
    try {
      await this.commands.xadd(stream, "MAXLEN", "~", STREAM_KEEP, `${seq}-0`, "type", type, "payload", payload);
    } catch (error) {
      if (!(error instanceof Error) || !/equal or smaller/.test(error.message)) throw error;
    }
  }
  async newest(stream) {
    const entries = await this.commands.xrevrange(stream, "+", "-", "COUNT", 1);
    return entries.length === 0 ? 0 : Number(entries[0][0].split("-")[0]);
  }
  async oldest(stream) {
    const entries = await this.commands.xrange(stream, "-", "+", "COUNT", 1);
    return entries.length === 0 ? null : Number(entries[0][0].split("-")[0]);
  }
  async after(stream, seq, count) {
    return entriesOf(await this.commands.xrange(stream, `(${seq}-0`, "+", "COUNT", count));
  }
  async read(cursors) {
    const streams = [...cursors.keys()];
    if (streams.length === 0) return [];
    if (this.reader.status === "wait") this.reader.connect().catch(() => void 0);
    const answer = await this.reader.xread("BLOCK", 300, "STREAMS", ...streams, ...streams.map((stream) => `${cursors.get(stream)}-0`));
    return (answer ?? []).map(([stream, raw]) => ({ stream, entries: entriesOf(raw) }));
  }
};

// server/services/layout-store.ts
var COLUMNS = "id, workspace_id, name, revision, content, trash, module_revisions";
async function loadLayout(client, workspaceId, layoutId, forUpdate) {
  return one(client, `select ${COLUMNS} from layouts where id = $1 and workspace_id = $2${forUpdate ? " for update" : ""}`, [layoutId, workspaceId]);
}
var workingHash = (content) => canonicalHash(content);
function layoutCounts(layout) {
  const { content } = layout;
  return {
    modules: content.modules.length,
    pieces: content.modules.reduce((sum, module) => sum + module.pieces.length, 0),
    blocks: content.blocks.length,
    trash: layout.trash.length
  };
}
async function saveLayout(tx, layout, change) {
  layout.revision += 1;
  await tx.client.query(
    "update layouts set name = $2, revision = $3, content = $4, trash = $5, module_revisions = $6 where id = $1",
    [layout.id, layout.name, layout.revision, JSON.stringify(layout.content), JSON.stringify(layout.trash), JSON.stringify(layout.module_revisions)]
  );
  for (const entry of change.history ?? []) {
    await tx.client.query(
      "insert into layout_history (layout_id, module_id, actor_id, actor_name, action, object_id, from_value, to_value) values ($1, $2, $3, $4, $5, $6, $7, $8)",
      [layout.id, entry.module_id ?? null, change.actor.id, change.actor.display_name, entry.action, entry.object_id, entry.from ?? null, entry.to ?? null]
    );
  }
  await writeOutbox(tx, layoutStream(layout.id), layout.revision, change.type, {
    seq: layout.revision,
    type: change.type,
    actor: change.actor,
    layout: { revision: layout.revision, working_hash: workingHash(layout.content), counts: layoutCounts(layout) },
    detail: change.detail
  });
}
async function layoutHistory(client, layoutId, objectId) {
  const found = await rows(
    client,
    `select id, actor_id, actor_name, at, action, object_id, from_value, to_value from layout_history
     where layout_id = $1 and ($2::text is null or object_id = $2) order by id desc limit 500`,
    [layoutId, objectId]
  );
  return found.map((row) => ({
    id: String(row.id),
    actor: row.actor_id === null ? null : { id: row.actor_id, display_name: row.actor_name ?? "" },
    at: row.at.toISOString(),
    action: row.action,
    object_id: row.object_id,
    from: row.from_value,
    to: row.to_value
  }));
}

// server/domain/session/state.ts
function blockById(state, id) {
  const block = state.blocks.find((candidate) => candidate.id === id);
  if (block === void 0) throw new Error(`block ${id} is not in the session`);
  return block;
}
function trainById(state, id) {
  return state.trains.find((train) => train.id === id);
}
function grantedAuthorities(state) {
  return state.authorities.filter((authority) => authority.state === "Granted");
}
var fastClockSeconds = (tick, ratio) => tick * ratio;
function fastClockLabel(seconds) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
function occupiedBlockIds(train, state) {
  const occupied = [];
  let left = train.length_mm;
  train.trail_block_ids.forEach((blockId2, index) => {
    const stretch = index === 0 ? train.head_offset_mm : blockById(state, blockId2).length_mm;
    if (left > 0 && stretch > 0) occupied.push(blockId2);
    left -= stretch;
  });
  return occupied;
}
function reservedBlockIds(state) {
  return new Set(grantedAuthorities(state).flatMap((authority) => authority.remaining_block_ids));
}
function blockStates(state) {
  const occupant = /* @__PURE__ */ new Map();
  for (const train of state.trains) for (const id of occupiedBlockIds(train, state)) occupant.set(id, train.number);
  const reserved = reservedBlockIds(state);
  const covering = (blockId2) => grantedAuthorities(state).find((authority) => authority.remaining_block_ids.includes(blockId2))?.id ?? null;
  return [...state.blocks].sort((a, b) => a.number - b.number).map((block) => {
    const blockState = block.out_of_service ? "out_of_service" : occupant.has(block.id) ? "occupied" : reserved.has(block.id) ? "reserved" : "free";
    return {
      id: block.id,
      number: block.number,
      name: block.name,
      kind: block.kind,
      length_mm: block.length_mm,
      state: blockState,
      train_number: block.out_of_service ? null : occupant.get(block.id) ?? null,
      authority_id: covering(block.id)
    };
  });
}
function countersOf(blocks, state) {
  const count = (states) => blocks.filter((block) => states.includes(block.state)).length;
  return {
    occupied_blocks: count(["occupied", "out_of_service"]),
    reserved_blocks: count(["reserved"]),
    free_blocks: count(["free"]),
    trains: state.trains.length,
    open_conflicts: state.conflicts.filter((conflict) => conflict.state === "Open").length
  };
}
function snapshotTrain(train, state) {
  return {
    id: train.id,
    number: train.number,
    name: train.name,
    direction: train.direction,
    speed_mph: train.speed_mph,
    length_mm: train.length_mm,
    head_block_id: train.head_block_id,
    head_offset_mm: train.head_offset_mm,
    trail_block_ids: train.trail_block_ids,
    occupied_block_ids: occupiedBlockIds(train, state),
    distance_run_mm: train.distance_run_mm,
    carry: train.carry,
    authority_id: train.authority_id,
    revision: train.revision
  };
}
function positionsOf(state) {
  return state.trains.map((train) => ({
    train_id: train.id,
    number: train.number,
    head_block_id: train.head_block_id,
    head_offset_mm: train.head_offset_mm,
    trail_block_ids: train.trail_block_ids,
    distance_run_mm: train.distance_run_mm,
    carry: train.carry
  }));
}
function buildSnapshot(row) {
  const { state } = row;
  const blocks = blockStates(state);
  const fast = fastClockSeconds(row.tick, row.ratio);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    hold_reason: row.hold_reason,
    ratio: row.ratio,
    revision: row.revision,
    control_revision: row.control_revision,
    session_version: row.session_version,
    tick: row.tick,
    fast_clock_seconds: fast,
    fast_clock_label: fastClockLabel(fast),
    layout_version_id: row.layout_version_id,
    layout_version_number: row.layout_version_number,
    timetable_version: row.timetable_version,
    trains: state.trains.map((train) => snapshotTrain(train, state)),
    blocks,
    turnouts: state.turnouts,
    authorities: state.authorities,
    conflicts: state.conflicts,
    deadlocks: state.deadlocks,
    timetable_progress: state.timetable_progress,
    counters: countersOf(blocks, state)
  };
}

// server/services/session-store.ts
var COLUMNS2 = `id, workspace_id, layout_id, name, status, hold_reason, ratio, revision, control_revision, session_version, tick,
  last_tick_at, layout_version_id, layout_version_number, timetable_version, state`;
async function loadSession(client, sessionId, forUpdate) {
  return one(client, `select ${COLUMNS2} from sessions where id = $1${forUpdate ? " for update" : ""}`, [sessionId]);
}
async function loadWorkspaceSession(client, workspaceId, sessionId, forUpdate) {
  return one(client, `select ${COLUMNS2} from sessions where id = $1 and workspace_id = $2${forUpdate ? " for update" : ""}`, [sessionId, workspaceId]);
}
async function listSessions(client, workspaceId) {
  return rows(client, `select id, name, status, tick, layout_version_number from sessions where workspace_id = $1 order by created_at, id`, [workspaceId]);
}
async function sessionsOfLayout(client, layoutId) {
  return rows(client, `select ${COLUMNS2} from sessions where layout_id = $1 and status <> 'Ended' order by id for update`, [layoutId]);
}
async function saveSession(tx, row, change) {
  row.revision += 1;
  if (change.control === true) row.control_revision += 1;
  await tx.client.query(
    `update sessions set status = $2, hold_reason = $3, revision = $4, control_revision = $5, session_version = $6, tick = $7,
       last_tick_at = $8, state = $9 where id = $1`,
    [row.id, row.status, row.hold_reason, row.revision, row.control_revision, row.session_version, row.tick, row.last_tick_at, JSON.stringify(row.state)]
  );
  const snapshot2 = buildSnapshot(row);
  await writeOutbox(tx, sessionStream(row.id), row.revision, change.type, { seq: row.revision, type: change.type, session: snapshot2, detail: change.detail });
  if (change.type === "tick.committed") {
    await tx.client.query(
      "insert into session_ticks (session_id, tick, revision, positions, counters) values ($1, $2, $3, $4, $5)",
      [row.id, row.tick, row.revision, JSON.stringify(positionsOf(row.state)), JSON.stringify(snapshot2.counters)]
    );
  }
}
async function changeStatus(tx, row, next, detail) {
  row.status = next.status;
  row.hold_reason = next.hold_reason;
  if (next.status === "Running") row.last_tick_at = /* @__PURE__ */ new Date();
  await saveSession(tx, row, { type: "session.status", control: true, detail });
}

// server/http/pipeline.ts
var COOKIE = "gandyboard_session";
var BODY_LIMIT = 1e6;
var KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;
function compile(route) {
  const names = [];
  const source = route.path.replace(/:([a-z_]+)/g, (_, name) => {
    names.push(name);
    return "([^/]+)";
  });
  return { route, names, pattern: new RegExp(`^${source}$`) };
}
function matchRoute(compiled, method, path) {
  for (const candidate of compiled) {
    if (candidate.route.method !== method) continue;
    const match = candidate.pattern.exec(path);
    if (match === null) continue;
    try {
      const decoded = (text) => decodeURIComponent(text).replaceAll("\0", "\uFFFD");
      return { route: candidate.route, params: Object.fromEntries(candidate.names.map((name, i) => [name, decoded(match[i + 1])])) };
    } catch {
      return void 0;
    }
  }
  return void 0;
}
var compileRoutes = (routes2) => routes2.map(compile);
function cookieToken(req) {
  const header = req.headers.cookie;
  if (header === void 0) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => {
      if (size > BODY_LIMIT) return reject(bodyTooLarge());
      if (size === 0) return resolve({});
      if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return reject(badContentType());
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reject(badJson());
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return reject(badJson());
      return resolve(parsed);
    });
  });
}
function allowed(access, role, user) {
  if (access === "open" || access === "user") return true;
  if (access === "founder") return user.is_founder;
  return role !== null && access.includes(role);
}
var valkeyOut = (c) => !c.services.valkey.up || c.session?.hold_reason === "valkey";
async function lockRow(c, load, forUpdate) {
  if (load === "layout") {
    const layout = await loadLayout(c.client, c.workspaceId, c.params.layout, forUpdate);
    if (layout === void 0) throw notFound();
    c.layout = layout;
  } else if (load === "session") {
    const session = await loadWorkspaceSession(c.client, c.workspaceId, c.params.session, forUpdate);
    if (session === void 0) throw notFound();
    c.session = session;
  } else if (load === "workspace") {
    await c.client.query(`select 1 from workspaces where id = $1${forUpdate ? " for update" : ""}`, [c.workspaceId]);
  }
}
async function storedKey(client, scope, userId, key) {
  return one(client, "select fingerprint, status, body from idempotency_keys where workspace_id = $1 and user_id = $2 and key = $3", [scope, userId, key]);
}
function jsonReply(status, body) {
  return { status, body };
}
async function runRoute(route, params, req, res, services) {
  const isWrite = route.method !== "GET";
  const body = isWrite ? await readBody(req) : {};
  const url = new URL(req.url ?? "/", "http://localhost");
  const token = cookieToken(req);
  const user = route.access === "open" || token === null ? void 0 : await userForToken(token);
  if (route.access !== "open" && user === void 0) throw sessionRequired();
  const workspaceId = params.workspace ?? null;
  let role = null;
  if (workspaceId !== null && user !== void 0) {
    role = await roleIn(workspaceId, user.id) ?? null;
    if (role === null) throw forbidden();
  }
  if (user !== void 0 && !allowed(route.access, role, user)) throw forbidden();
  const c = { req, res, services, params, query: url.searchParams, body, user, role, workspaceId, token, tx: null, client: db(), found: {} };
  if (!isWrite) {
    await lockRow(c, route.load ?? null, false);
    await route.resolve?.(c);
    if (route.live === true && valkeyOut(c)) throw valkeyUnavailable();
    return route.handle(c);
  }
  return writeRoute(route, c);
}
async function writeRoute(route, c) {
  const client = await db().connect();
  const tx = { client, afterCommit: [] };
  c.tx = tx;
  c.client = client;
  try {
    await client.query("begin");
    await lockRow(c, route.load ?? null, true);
    await route.resolve?.(c);
    const scope = c.workspaceId ?? "";
    let key = null;
    if (route.key !== false) {
      const header = c.req.headers["idempotency-key"];
      if (typeof header !== "string" || !KEY_PATTERN.test(header)) throw keyRequired();
      key = header;
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`${scope}|${c.user.id}|${key}`]);
      const fingerprint = sha256Hex(`${c.req.method}
${c.req.url?.split("?")[0]}
${canonicalJson(c.body)}`);
      const stored = await storedKey(client, scope, c.user.id, key);
      if (stored !== void 0) {
        if (stored.fingerprint !== fingerprint) throw keyReused();
        await client.query("rollback");
        return jsonReply(stored.status, stored.body);
      }
      c.found.fingerprint = fingerprint;
    }
    let reply;
    try {
      await client.query("savepoint handler");
      if (route.revision !== void 0) {
        const revision = c.body.revision;
        if (!Number.isInteger(revision)) throw invalidFields({ revision: "Reload and try again." });
        const current = route.revision(c);
        if (revision !== current) throw staleRevision(current);
      }
      if (route.live === true && valkeyOut(c)) throw valkeyUnavailable();
      reply = await route.handle(c);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409 && error.status !== 422 || key === null) throw error;
      await client.query("rollback to savepoint handler");
      reply = jsonReply(error.status, error.body);
    }
    if (key !== null && "body" in reply) {
      await client.query(
        "insert into idempotency_keys (workspace_id, user_id, key, fingerprint, status, body) values ($1, $2, $3, $4, $5, $6)",
        [scope, c.user.id, key, c.found.fingerprint, reply.status, JSON.stringify(reply.body)]
      );
    }
    await client.query("commit");
    for (const hook of tx.afterCommit) hook();
    return reply;
  } catch (error) {
    await client.query("rollback").catch(() => void 0);
    throw error;
  } finally {
    client.release();
  }
}

// server/http/static.ts
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
var ROOT = fileURLToPath(new URL("../web/", import.meta.url));
var TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};
async function serveStatic(path, res) {
  const relative = path === "/" ? "index.html" : normalize(path).replace(/^[/\\]+/, "");
  if (relative.startsWith("..") || !(relative === "index.html" || relative.startsWith("assets/") || relative.startsWith("fonts/"))) return false;
  try {
    const bytes = await readFile(join(ROOT, relative));
    const immutable = relative !== "index.html";
    res.writeHead(200, {
      "Content-Type": TYPES[extname(relative)] ?? "application/octet-stream",
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

// server/routes/helpers.ts
var json = (status, body) => ({ status, body });
function textField(body, name, label, max = 80) {
  const value = body[name];
  if (typeof value !== "string" || value.trim() === "" || value.trim().length > max) {
    throw invalidFields({ [name]: `Enter ${label} of up to ${max} characters.` });
  }
  return value.trim();
}
var actorOf = (c) => ({ id: c.user.id, display_name: c.user.display_name });
var txOf = (c) => c.tx;

// server/routes/auth.ts
var authRoutes = [
  {
    method: "POST",
    path: "/api/auth/sign-in",
    access: "open",
    key: false,
    async handle(c) {
      const { email, password } = c.body;
      if (typeof email !== "string" || typeof password !== "string") throw invalidFields({ email: "Enter your email.", password: "Enter your password." });
      const { user, token } = await signIn(email, password);
      return {
        status: 200,
        body: { user, idle_seconds: idleSeconds },
        headers: { "Set-Cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/` }
      };
    }
  },
  {
    method: "POST",
    path: "/api/auth/sign-out",
    access: "user",
    key: false,
    async handle(c) {
      await signOut(c.token);
      return { status: 204, raw: Buffer.alloc(0), headers: { "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` } };
    }
  },
  {
    method: "GET",
    path: "/api/me",
    access: "user",
    async handle(c) {
      const memberships = await rows(
        db(),
        `select w.id as workspace_id, w.name as workspace_name, m.role from members m join workspaces w on w.id = m.workspace_id
         where m.user_id = $1 order by w.created_at, w.id`,
        [c.user.id]
      );
      return json(200, {
        user: { id: c.user.id, email: c.user.email, display_name: c.user.display_name, walkthrough_done: c.user.walkthrough_done },
        memberships
      });
    }
  },
  {
    method: "POST",
    path: "/api/me/walkthrough",
    access: "user",
    key: false,
    async handle(c) {
      await db().query("update users set walkthrough_done = true where id = $1", [c.user.id]);
      return json(200, { walkthrough_done: true });
    }
  }
];

// shared/geometry.ts
var RADIANS = Math.PI / 180;
function normalizeHeading(degrees) {
  const wrapped = (degrees % 360 + 360) % 360;
  return Math.round(wrapped * 100) / 100;
}
function turnoutAngleDeg(frogNumber) {
  return Math.round(2 * Math.atan(1 / (2 * frogNumber)) / RADIANS * 100) / 100;
}
function curveLengthMm(radiusMm, angleDeg) {
  return Math.round(radiusMm * angleDeg * RADIANS);
}
function pieceLengthMm(body) {
  return body.kind === "curve" ? curveLengthMm(body.radius_mm, body.angle_deg) : body.length_mm;
}
var turnSign = (hand) => hand === "left" ? 1 : -1;
function curveCentre(start, hand, radiusMm) {
  const h = start.heading_deg * RADIANS;
  return { x: start.x_mm - turnSign(hand) * radiusMm * Math.sin(h), y: start.y_mm + turnSign(hand) * radiusMm * Math.cos(h) };
}
function onArc(centre, hand, radiusMm, headingRad) {
  return { x: centre.x + turnSign(hand) * radiusMm * Math.sin(headingRad), y: centre.y - turnSign(hand) * radiusMm * Math.cos(headingRad) };
}
function turn(start, hand, radiusMm, angleDeg, rise) {
  const sign = turnSign(hand);
  const arrival = onArc(curveCentre(start, hand, radiusMm), hand, radiusMm, start.heading_deg * RADIANS + sign * angleDeg * RADIANS);
  return {
    x_mm: Math.round(arrival.x),
    y_mm: Math.round(arrival.y),
    elevation_mm: start.elevation_mm + rise,
    heading_deg: normalizeHeading(start.heading_deg + sign * angleDeg)
  };
}
function run(start, lengthMm, bearingDeg, headingDeg, rise) {
  const b = bearingDeg * RADIANS;
  return {
    x_mm: Math.round(start.x_mm + lengthMm * Math.cos(b)),
    y_mm: Math.round(start.y_mm + lengthMm * Math.sin(b)),
    elevation_mm: start.elevation_mm + rise,
    heading_deg: normalizeHeading(headingDeg)
  };
}
function pieceEnds(start, body) {
  if (body.kind === "straight") {
    return { length_mm: pieceLengthMm(body), end: run(start, body.length_mm, start.heading_deg, start.heading_deg, body.rise_mm), diverging_end: null };
  }
  if (body.kind === "curve") {
    return { length_mm: pieceLengthMm(body), end: turn(start, body.hand, body.radius_mm, body.angle_deg, body.rise_mm), diverging_end: null };
  }
  const sign = turnSign(body.hand);
  const angle = turnoutAngleDeg(body.frog_number);
  return {
    length_mm: pieceLengthMm(body),
    end: run(start, body.length_mm, start.heading_deg, start.heading_deg, body.rise_mm),
    diverging_end: run(start, body.length_mm, start.heading_deg + sign * angle / 2, start.heading_deg + sign * angle, body.rise_mm)
  };
}

// server/domain/layout-model.ts
function pointOf(end) {
  return { x_mm: end.x_mm, y_mm: end.y_mm, elevation_mm: end.elevation_mm, heading_deg: end.heading_deg };
}
function endLabel(module, pieceId, branch) {
  if (pieceId === null) return `${module.name} start`;
  const piece = module.pieces.find((p) => p.id === pieceId);
  const ordinal = module.pieces.findIndex((p) => p.id === pieceId) + 1;
  if (piece?.kind === "turnout") return `${module.name} ${ordinal} ${branch === "through" ? "straight" : "diverging"}`;
  return `${module.name} ${ordinal}`;
}
function newModule(id, name, endplates, origin, newId2) {
  const module = { id, name, endplates, origin, pieces: [], open_ends: [] };
  module.open_ends.push({
    id: newId2("oe"),
    label: endLabel(module, null, "through"),
    x_mm: origin.x_mm,
    y_mm: origin.y_mm,
    elevation_mm: 0,
    heading_deg: origin.heading_deg,
    piece_id: null
  });
  return module;
}
function findOpenEnd(module, openEndId) {
  return module.open_ends.find((end) => end.id === openEndId);
}
function consumerOf(module, openEndId) {
  return module.pieces.find((piece) => piece.open_end_id === openEndId);
}
function followersOf(module, pieceId) {
  return module.pieces.filter((piece) => piece.after_piece_id === pieceId);
}
function openEndFrom(module, id, pieceId, branch, at) {
  return { id, label: endLabel(module, pieceId, branch), ...pointOf(at), piece_id: pieceId };
}
function appendPiece(module, openEndId, body, addedBy, newId2) {
  const consumed = module.open_ends.find((end) => end.id === openEndId);
  if (consumed === void 0) throw new Error(`open end ${openEndId} is not open`);
  const parent = module.pieces.find((piece2) => piece2.id === consumed.piece_id);
  const start = pointOf(consumed);
  const ends = pieceEnds(start, body);
  const piece = {
    ...body,
    id: newId2("pc"),
    length_mm: ends.length_mm,
    block_id: parent?.block_id ?? null,
    note: "",
    start,
    end: ends.end,
    open_end_id: consumed.id,
    open_end_label: consumed.label,
    after_piece_id: consumed.piece_id,
    added_by: addedBy
  };
  module.pieces.push(piece);
  module.open_ends = module.open_ends.filter((end) => end.id !== consumed.id);
  module.open_ends.push(openEndFrom(module, newId2("oe"), piece.id, "through", ends.end));
  if (ends.diverging_end !== null) module.open_ends.push(openEndFrom(module, newId2("oe"), piece.id, "diverging", ends.diverging_end));
  return piece;
}
function removePiece(module, pieceId) {
  const piece = module.pieces.find((p) => p.id === pieceId);
  if (piece === void 0) throw new Error(`piece ${pieceId} is not in ${module.id}`);
  module.pieces = module.pieces.filter((p) => p.id !== pieceId);
  module.open_ends = module.open_ends.filter((end) => end.piece_id !== pieceId);
  module.open_ends.push({
    id: piece.open_end_id,
    label: piece.open_end_label,
    ...pointOf(piece.start),
    piece_id: piece.after_piece_id
  });
}
function descendantIds(module, pieceId) {
  const found = /* @__PURE__ */ new Set([pieceId]);
  for (const piece of module.pieces) {
    if (piece.after_piece_id !== null && found.has(piece.after_piece_id)) found.add(piece.id);
  }
  return found;
}
function changeRise(module, pieceId, riseMm) {
  const piece = module.pieces.find((p) => p.id === pieceId);
  if (piece === void 0) throw new Error(`piece ${pieceId} is not in ${module.id}`);
  const delta = riseMm - piece.rise_mm;
  const family = descendantIds(module, pieceId);
  piece.rise_mm = riseMm;
  for (const member of module.pieces) {
    if (!family.has(member.id)) continue;
    if (member.id !== pieceId) member.start.elevation_mm += delta;
    member.end.elevation_mm += delta;
  }
  for (const end of module.open_ends) {
    if (end.piece_id !== null && family.has(end.piece_id)) end.elevation_mm += delta;
  }
}
var byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function normalizeContent(content) {
  return {
    modules: content.modules.map((module) => ({
      ...module,
      endplates: [...module.endplates].sort((a, b) => a.end < b.end ? -1 : 1),
      open_ends: [...module.open_ends].sort(byId)
    })).sort(byId),
    blocks: [...content.blocks].sort(byId),
    stations: [...content.stations].sort(byId),
    turnouts: [...content.turnouts].sort(byId),
    trains: [...content.trains].sort(byId),
    timetable: { version: content.timetable.version, entries: [...content.timetable.entries].sort(byId) }
  };
}

// shared/endplates.ts
function standardEndplate(type, standards) {
  return type === "double" ? { width_mm: standards.endplate_double_mm, track_offsets_mm: [-standards.double_track_offset_mm, standards.double_track_offset_mm] } : { width_mm: standards.endplate_single_mm, track_offsets_mm: [0] };
}

// shared/units.ts
var MM_PER_INCH = 25.4;

// server/domain/units.ts
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}
function formatInches(mm) {
  const eighths = Math.round(mm / MM_PER_INCH * 8);
  const whole = Math.floor(eighths / 8);
  const remainder = eighths % 8;
  if (remainder === 0) return `${whole} in`;
  const divisor = gcd(remainder, 8);
  const fraction = `${remainder / divisor}/${8 / divisor}`;
  return whole === 0 ? `${fraction} in` : `${whole} ${fraction} in`;
}
function formatLength(mm, units) {
  if (units === "in") return formatInches(mm);
  return `${Math.round(mm * 100) / 100} mm`;
}
function formatHundredthsLength(hundredthsMm, units) {
  return formatLength(hundredthsMm / 100, units);
}

// server/domain/rules.ts
function finding(rule2, moduleId, pieceId, measured, limit, message2) {
  return { rule: rule2, module_id: moduleId, piece_id: pieceId, measured_mm: measured, limit_mm: limit, message: message2 };
}
function straightSince(module, afterPieceId) {
  let straight = 0;
  let cursor = afterPieceId === null ? void 0 : module.pieces.find((p) => p.id === afterPieceId);
  while (cursor !== void 0) {
    if (cursor.kind === "curve") return { curve: cursor, straight_mm: straight };
    straight += cursor.length_mm;
    cursor = cursor.after_piece_id === null ? void 0 : module.pieces.find((p) => p.id === cursor?.after_piece_id);
  }
  return { curve: null, straight_mm: straight };
}
function pieceFindings(module, afterPieceId, body, pieceId, standards) {
  const found = [];
  const units = standards.display_units;
  if (body.kind === "curve" && body.mainline && body.radius_mm < standards.min_radius_mm) {
    found.push(finding(
      "min_radius",
      module.id,
      pieceId,
      body.radius_mm,
      standards.min_radius_mm,
      `Curve radius ${formatLength(body.radius_mm, units)} is under the ${formatLength(standards.min_radius_mm, units)} minimum.`
    ));
  }
  const length = pieceLengthMm(body);
  if (Math.abs(body.rise_mm) * 1e3 > standards.max_grade_tenths_percent * length) {
    const measured = Math.round(Math.abs(body.rise_mm) * 1e3 / length);
    found.push(finding(
      "max_grade",
      module.id,
      pieceId,
      measured,
      standards.max_grade_tenths_percent,
      `Grade ${(measured / 10).toFixed(1)}% is over the ${(standards.max_grade_tenths_percent / 10).toFixed(1)}% maximum.`
    ));
  }
  if (body.kind === "turnout" && body.frog_number < standards.min_frog_number) {
    found.push(finding(
      "min_turnout",
      module.id,
      pieceId,
      body.frog_number,
      standards.min_frog_number,
      `Turnout #${body.frog_number} is under the #${standards.min_frog_number} minimum.`
    ));
  }
  if (body.kind === "curve") {
    const before = straightSince(module, afterPieceId);
    if (before.curve !== null && before.curve.kind === "curve" && before.curve.hand !== body.hand && before.straight_mm < standards.reverse_curve_straight_mm) {
      found.push(finding(
        "reverse_curve",
        module.id,
        pieceId,
        before.straight_mm,
        standards.reverse_curve_straight_mm,
        `Only ${formatLength(before.straight_mm, units)} of straight between reverse curves; ${formatLength(standards.reverse_curve_straight_mm, units)} needed.`
      ));
    }
  }
  return found;
}
function runLength(pieces) {
  return pieces.reduce((sum, piece) => sum + piece.length_mm, 0);
}
function leadingRun(module) {
  const run2 = [];
  for (const piece of module.pieces) {
    const linked = run2.length === 0 ? piece.after_piece_id === null : piece.after_piece_id === run2[run2.length - 1].id;
    if (!linked || piece.kind !== "straight" || piece.rise_mm !== 0) break;
    run2.push(piece);
  }
  return runLength(run2);
}
function trailingRun(module) {
  const run2 = [];
  let cursor = module.pieces[module.pieces.length - 1];
  while (cursor !== void 0 && cursor.kind === "straight" && cursor.rise_mm === 0) {
    run2.push(cursor);
    const parent = cursor.after_piece_id;
    cursor = parent === null ? void 0 : module.pieces.find((p) => p.id === parent);
  }
  return runLength(run2);
}
function moduleFindings(module, standards) {
  const found = [];
  const units = standards.display_units;
  for (const plate of module.endplates) {
    const expected = standardEndplate(plate.track_offsets_mm.length === 2 ? "double" : "single", standards);
    if (plate.width_mm !== expected.width_mm) {
      found.push(finding(
        "endplate_width",
        module.id,
        null,
        plate.width_mm,
        expected.width_mm,
        `Endplate ${plate.end} is ${formatLength(plate.width_mm, units)}; the standard is ${formatLength(expected.width_mm, units)}.`
      ));
    }
    const off = Math.max(...plate.track_offsets_mm.map((offset, i) => Math.abs(offset - (expected.track_offsets_mm[i] ?? 0))));
    if (off > 0) {
      found.push(finding("track_centred", module.id, null, off, 0, `Track at endplate ${plate.end} is off-centre by ${formatLength(off, units)}.`));
    }
  }
  if (module.pieces.length === 0) {
    found.push(finding("empty_module", module.id, null, 0, 0, `Module ${module.name} has no track.`));
    return found;
  }
  const straights = [["A", leadingRun(module)], ["B", trailingRun(module)]];
  for (const [end, run2] of straights) {
    if (run2 < standards.end_straight_mm) {
      found.push(finding(
        "end_straight",
        module.id,
        null,
        run2,
        standards.end_straight_mm,
        `Only ${formatLength(run2, units)} straight and level at end ${end}; ${formatLength(standards.end_straight_mm, units)} needed.`
      ));
    }
  }
  const change = Math.abs(module.pieces[module.pieces.length - 1].end.elevation_mm - module.pieces[0].start.elevation_mm) * 100;
  const step = standards.elevation_step_hundredths_mm;
  if (Math.abs(change - Math.round(change / step) * step) > 100) {
    found.push(finding(
      "elevation_step",
      module.id,
      null,
      change,
      step,
      `Elevation change ${formatHundredthsLength(change, units)} is not a multiple of ${formatHundredthsLength(step, units)}.`
    ));
  }
  for (const piece of module.pieces) {
    if (piece.block_id === null) {
      found.push(finding("unassigned_block", module.id, piece.id, 0, 0, `Piece ${piece.id} has no block.`));
    }
  }
  return found;
}
function checkLayout(content, standards) {
  return content.modules.flatMap((module) => [
    ...module.pieces.flatMap((piece) => pieceFindings(module, piece.after_piece_id, piece, piece.id, standards)),
    ...moduleFindings(module, standards)
  ]);
}

// server/domain/packets.ts
function packetContent(state) {
  const stationName = (id) => state.stations.find((station) => station.id === id)?.name ?? id;
  const trains = [...state.trains].sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number));
  const entries = (trainId) => state.timetable.filter((entry) => entry.train_id === trainId).sort((a, b) => a.depart_fast_seconds - b.depart_fast_seconds || a.id.localeCompare(b.id));
  const startName = (trainId) => {
    const train = state.trains.find((candidate) => candidate.id === trainId);
    const block = state.blocks.find((candidate) => candidate.id === train?.start_block_id);
    return state.stations.find((station) => block !== void 0 && station.block_ids.includes(block.id))?.name ?? block?.name ?? "";
  };
  const timetable = [...state.timetable].sort((a, b) => a.depart_fast_seconds - b.depart_fast_seconds || a.id.localeCompare(b.id)).map((entry) => ({
    entry_id: entry.id,
    time: fastClockLabel(entry.depart_fast_seconds),
    train_number: state.trains.find((train) => train.id === entry.train_id)?.number ?? entry.train_id,
    station: stationName(entry.station_id)
  }));
  const orders = trains.map((train) => {
    const own = entries(train.id);
    const first = own.length > 0 ? stationName(own[0].station_id) : startName(train.id);
    const last = own.length > 0 ? stationName(own[own.length - 1].station_id) : first;
    const departing = fastClockLabel(own.length > 0 ? own[0].depart_fast_seconds : 0);
    return `Train ${train.number} ${train.name}: run ${train.direction} from ${first} to ${last}, departing ${departing}.`;
  });
  const blocks = [...state.blocks].sort((a, b) => a.number - b.number);
  return {
    timetable,
    train_orders: orders,
    block_table: blocks.map((block) => ({ number: block.number, name: block.name, kind: block.kind, length_mm: block.length_mm })),
    track_diagram: blocks.map((block) => ({ number: block.number, name: block.name, kind: block.kind }))
  };
}
var packetHash = (sessionVersion, content) => canonicalHash({ session_version: sessionVersion, content });
var escapeHtml = (text) => text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch);
function diagram(blocks, pinned) {
  const width = 720;
  const mainline = blocks.filter((block) => block.kind !== "loop");
  const total = mainline.reduce((sum, block) => sum + (pinned.find((p) => p.number === block.number)?.length_mm ?? 1), 0);
  const spans = /* @__PURE__ */ new Map();
  let cursor = 0;
  for (const block of mainline) {
    const length = pinned.find((p) => p.number === block.number)?.length_mm ?? 1;
    spans.set(block.number, [cursor / total * width, (cursor + length) / total * width]);
    cursor += length;
  }
  const drawn = blocks.map((block) => {
    const [x0, x1] = spans.get(block.number) ?? loopSpan(block.number, pinned, spans);
    const y = block.kind === "loop" ? 70 : 20;
    const fill = block.kind === "loop" ? "#E8ECF4" : block.kind === "approach" ? "#FFE3B8" : "#CDEBD8";
    return `<g><rect x="${x0.toFixed(1)}" y="${y}" width="${Math.max(x1 - x0 - 4, 8).toFixed(1)}" height="34" rx="6" fill="${fill}" stroke="#0158B4" stroke-width="1.5"/><text x="${((x0 + x1) / 2 - 2).toFixed(1)}" y="${y + 22}" font-size="11" text-anchor="middle" fill="#2B3145">${block.number}</text></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="120" viewBox="0 0 ${width} 120">${drawn.join("")}</svg>`;
}
function loopSpan(number, pinned, spans) {
  const loop = pinned.find((block) => block.number === number);
  const neighbours = (loop?.neighbour_ids ?? []).map((id) => pinned.find((block) => block.id === id)).filter((b) => b !== void 0);
  if (neighbours.length >= 2) {
    const west = spans.get(Math.min(...neighbours.map((b) => b.number)));
    const east = spans.get(Math.max(...neighbours.map((b) => b.number)));
    if (west !== void 0 && east !== void 0) return [west[1], east[0]];
  }
  const anchor = neighbours[0]?.number ?? number;
  const beside = [...spans.keys()].filter((n) => number < anchor ? n < anchor : n > anchor).sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0];
  return spans.get(beside) ?? [0, 80];
}
function packetHtml(sessionName, sessionVersion, content, pinned) {
  const rowsOf = (cells) => cells.map((cell) => `<tr>${cell.map((text) => `<td>${escapeHtml(text)}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Crew packet</title><style>
body{font-family:Helvetica,Arial,sans-serif;color:#2B3145;font-size:12px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;color:#0158B4;margin:18px 0 6px;border-bottom:2px solid #0158B4}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #AEB8D0;padding:4px 6px;text-align:left}th{background:#E8ECF4}
p.order{margin:3px 0}</style></head><body>
<h1>${escapeHtml(sessionName)}</h1><div>Session version ${sessionVersion}</div>
<h2>Timetable</h2><table><tr><th>Time</th><th>Train</th><th>Station</th></tr>${rowsOf(content.timetable.map((row) => [row.time, row.train_number, row.station]))}</table>
<h2>Train orders</h2>${content.train_orders.map((line) => `<p class="order">${escapeHtml(line)}</p>`).join("")}
<h2>Block table</h2><table><tr><th>Block</th><th>Name</th><th>Kind</th><th>Length</th></tr>${rowsOf(content.block_table.map((row) => [String(row.number), row.name, row.kind, `${row.length_mm} mm`]))}</table>
<h2>Track diagram</h2>${diagram(content.track_diagram, pinned)}
</body></html>`;
}
function packetFooterHtml(sessionVersion, hash) {
  return `<html><head><style>body{font-family:Helvetica,Arial,sans-serif;font-size:7px;width:100%;text-align:center;color:#2B3145;margin:0}</style></head><body><span>Session version ${sessionVersion} | Content hash ${hash}</span></body></html>`;
}

// server/services/packets.ts
var COLUMNS3 = `id, session_id, state, content_hash, session_version, failure, issued_by, issued_at, ready_at,
  case when pdf_bytes is null then null else length(pdf_bytes) end as byte_length`;
function toPacket(row) {
  return {
    id: row.id,
    state: row.state,
    session_version: row.session_version,
    content_hash: row.content_hash,
    failure: row.failure,
    issued_by: row.issued_by,
    issued_at: row.issued_at.toISOString(),
    ready_at: row.ready_at === null ? null : row.ready_at.toISOString(),
    byte_length: row.byte_length
  };
}
async function listPackets(client, sessionId) {
  return (await rows(client, `select ${COLUMNS3} from crew_packets where session_id = $1 order by issued_at, id`, [sessionId])).map(toPacket);
}
async function loadPacket(client, sessionId, packetId) {
  const row = await one(client, `select ${COLUMNS3} from crew_packets where session_id = $1 and id = $2`, [sessionId, packetId]);
  return row === void 0 ? void 0 : toPacket(row);
}
async function loadPacketBytes(client, sessionId, packetId) {
  const row = await one(client, "select pdf_bytes from crew_packets where session_id = $1 and id = $2", [sessionId, packetId]);
  return row === void 0 ? void 0 : row.pdf_bytes;
}
async function packetNow(client, packetId) {
  return toPacket(await one(client, `select ${COLUMNS3} from crew_packets where id = $1`, [packetId]));
}
async function issuePacket(tx, sessionId, workspaceId, sessionVersion, issuedBy) {
  const session = await loadSession(tx.client, sessionId, true);
  if (session === void 0) throw new Error("session vanished");
  const id = newId("pk");
  await tx.client.query(
    `insert into crew_packets (id, session_id, workspace_id, state, session_version, issued_by) values ($1, $2, $3, 'Queued', $4, $5)`,
    [id, sessionId, workspaceId, sessionVersion, issuedBy]
  );
  const packet = await packetNow(tx.client, id);
  await saveSession(tx, session, { type: "packet.changed", detail: { packet } });
  return packet;
}
async function supersedeReady(client, sessionId) {
  const found = await rows(client, `update crew_packets set state = 'Superseded', updated_at = now() where session_id = $1 and state = 'Ready' returning id`, [sessionId]);
  return found.map((row) => row.id);
}
var RENDERING_STALE_MS = 3e4;
var PacketWorker = class {
  constructor(gotenberg, valkey) {
    this.gotenberg = gotenberg;
    this.valkey = valkey;
  }
  active = /* @__PURE__ */ new Set();
  start() {
    setInterval(() => void this.poll(), 500);
  }
  async poll() {
    const queued = await rows(db(), `select id, session_id from crew_packets where state = 'Queued' order by issued_at limit 5`).catch(() => []);
    for (const packet of queued) {
      if (this.active.has(packet.id)) continue;
      this.active.add(packet.id);
      void this.render(packet.id, packet.session_id).catch(() => void 0).finally(() => this.active.delete(packet.id));
    }
    const stale = await rows(
      db(),
      `select id, session_id from crew_packets where state = 'Rendering' and updated_at < now() - interval '${RENDERING_STALE_MS / 1e3} seconds' limit 5`
    ).catch(() => []);
    for (const packet of stale) {
      if (!this.active.has(packet.id)) await this.fail(packet.id, packet.session_id, "gotenberg_unreachable").catch(() => void 0);
    }
  }
  async move(packetId, sessionId, from, to, values) {
    return transaction(async (tx) => {
      const session = await loadSession(tx.client, sessionId, true);
      const current = await one(tx.client, "select state from crew_packets where id = $1 for update", [packetId]);
      if (session === void 0 || current?.state !== from) return false;
      await tx.client.query(
        `update crew_packets set state = $2, failure = $3, pdf_bytes = coalesce($4, pdf_bytes), content_hash = coalesce($5, content_hash),
           session_version = coalesce($6, session_version), ready_at = case when $2 = 'Ready' then now() else ready_at end, updated_at = now() where id = $1`,
        [packetId, to, values.failure ?? null, values.pdf ?? null, values.hash ?? null, values.version ?? null]
      );
      await saveSession(tx, session, { type: "packet.changed", detail: { packet: await packetNow(tx.client, packetId) } });
      return true;
    });
  }
  async fail(packetId, sessionId, failure) {
    const from = (await one(db(), "select state from crew_packets where id = $1", [packetId]))?.state;
    if (from === "Queued" || from === "Rendering") await this.move(packetId, sessionId, from, "Failed", { failure });
  }
  async render(packetId, sessionId) {
    if (!await this.move(packetId, sessionId, "Queued", "Rendering", {})) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const session = await loadSession(db(), sessionId, false);
      if (session === void 0) return;
      const content = packetContent(session.state);
      const hash = packetHash(session.session_version, content);
      let pdf;
      try {
        pdf = await this.gotenberg.render(packetHtml(session.name, session.session_version, content, session.state.blocks), packetFooterHtml(session.session_version, hash));
      } catch {
        await this.fail(packetId, sessionId, "gotenberg_unreachable");
        return;
      }
      if (!await this.valkey.ping()) {
        await this.fail(packetId, sessionId, "valkey_unreachable");
        return;
      }
      const current = await loadSession(db(), sessionId, false);
      const unchanged = current !== void 0 && packetHash(current.session_version, packetContent(current.state)) === hash;
      if (unchanged || attempt === 2) {
        await this.move(packetId, sessionId, "Rendering", "Ready", { pdf, hash, version: session.session_version });
        return;
      }
    }
  }
};

// server/services/rename.ts
async function renameInSessions(tx, layout, kind, id, name) {
  for (const session of await sessionsOfLayout(tx.client, layout.id)) {
    const target = kind === "block" ? session.state.blocks.find((block) => block.id === id) : session.state.stations.find((station) => station.id === id);
    if (target === void 0) continue;
    const from = target.name;
    target.name = name;
    const superseded = await supersedeReady(tx.client, session.id);
    await saveSession(tx, session, { type: "name.changed", detail: { kind, id, from, to: name, superseded_packet_ids: superseded } });
  }
}

// shared/roles.ts
var BUILDERS = ["founder", "manager", "member"];
var MANAGERS = ["founder", "manager"];
var RUNNERS = ["founder", "manager", "operator"];
var EVERYONE = ["founder", "manager", "member", "operator"];

// server/routes/stream.ts
async function serveEvents(c, stream, committedSeq) {
  const header = c.req.headers["last-event-id"];
  const raw = typeof header === "string" ? header : c.query.get("last_event_id");
  const lastEventId = raw === null || raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);
  c.res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no"
  });
  c.res.write(": connected\n\n");
  await c.services.hub.subscribe(stream, c.res, lastEventId, committedSeq);
  return { streamed: true };
}

// server/routes/layouts.ts
async function standardsOf(client, workspaceId) {
  const [row] = await rows(client, "select standards from workspaces where id = $1", [workspaceId]);
  return row.standards;
}
async function commit(c, change) {
  c.layout.content = normalizeContent(c.layout.content);
  await saveLayout(txOf(c), c.layout, change);
}
var moduleOf = (layout, id) => layout.content.modules.find((module) => module.id === id);
var moduleRevision = (layout, id) => layout.module_revisions[id] ?? 0;
var bumpModuleRevision = (layout, id) => {
  layout.module_revisions[id] = moduleRevision(layout, id) + 1;
};
function writeReceipt(c) {
  return { layout_revision: c.layout.revision, working_hash: workingHash(c.layout.content) };
}
function parsePiece(raw) {
  const body = raw ?? {};
  const fields = {};
  const whole = (name, min, max) => {
    const value = body[name];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fields[`piece.${name}`] = `Enter a whole number from ${min} to ${max}.`;
    return value;
  };
  const rise = body.rise_mm === void 0 ? 0 : whole("rise_mm", -2e3, 2e3);
  const mainline = body.mainline === void 0 ? true : body.mainline;
  if (typeof mainline !== "boolean") fields["piece.mainline"] = "Choose true or false.";
  const hand = body.hand;
  let piece;
  if (body.kind === "straight") {
    piece = { kind: "straight", length_mm: whole("length_mm", 1, 5e3), rise_mm: rise, mainline };
  } else if (body.kind === "curve") {
    if (hand !== "left" && hand !== "right") fields["piece.hand"] = "Choose left or right.";
    piece = { kind: "curve", radius_mm: whole("radius_mm", 1, 2e4), angle_deg: whole("angle_deg", 1, 90), hand, rise_mm: rise, mainline };
  } else if (body.kind === "turnout") {
    if (hand !== "left" && hand !== "right") fields["piece.hand"] = "Choose left or right.";
    piece = { kind: "turnout", frog_number: whole("frog_number", 1, 30), hand, length_mm: whole("length_mm", 1, 5e3), rise_mm: rise, mainline };
  } else {
    fields["piece.kind"] = "Choose straight, curve or turnout.";
  }
  if (Object.keys(fields).length > 0 || piece === void 0) throw invalidFields(fields);
  return piece;
}
function parseEndplates(raw) {
  const plates2 = Array.isArray(raw) ? raw : [];
  const valid = plates2.length === 2 && plates2.every((plate, index) => plate.end === (index === 0 ? "A" : "B") && Number.isInteger(plate.width_mm) && Array.isArray(plate.track_offsets_mm) && plate.track_offsets_mm.length >= 1 && plate.track_offsets_mm.every(Number.isInteger));
  if (!valid) throw invalidFields({ endplates: "Give endplates A and B with a width and track offsets in whole millimetres." });
  return plates2.map((plate) => ({ end: plate.end, width_mm: plate.width_mm, track_offsets_mm: plate.track_offsets_mm }));
}
function searchBlocks(blocks, query) {
  const needle = (query ?? "").trim().toLowerCase();
  return [...blocks].sort((a, b) => a.number - b.number).filter((block) => needle === "" || block.name.toLowerCase().includes(needle) || String(block.number) === needle).map((block) => ({ id: block.id, number: block.number, name: block.name, kind: block.kind }));
}
function placeOrigin(layout) {
  const placed = layout.content.modules.length + layout.trash.length;
  return { x_mm: -4500 + placed % 4 * 2400, y_mm: -3500 - Math.floor(placed / 4) * 1500, heading_deg: 0 };
}
var layoutRoutes = [
  {
    method: "GET",
    path: "/api/workspaces/:workspace/layouts",
    access: EVERYONE,
    async handle(c) {
      const found = await rows(c.client, "select id, workspace_id, name, revision, content, trash, module_revisions from layouts where workspace_id = $1 order by created_at, id", [c.workspaceId]);
      return json(200, { layouts: found.map((layout) => ({ id: layout.id, name: layout.name, revision: layout.revision, counts: layoutCounts(layout) })) });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts",
    access: MANAGERS,
    load: "workspace",
    async handle(c) {
      const name = textField(c.body, "name", "a layout name");
      const content = normalizeContent({ modules: [], blocks: [], stations: [], turnouts: [], trains: [], timetable: { version: 0, entries: [] } });
      const id = newId("lay");
      await txOf(c).client.query("insert into layouts (id, workspace_id, name, revision, content) values ($1, $2, $3, 1, $4)", [id, c.workspaceId, name, JSON.stringify(content)]);
      return json(201, { layout: { id, name, revision: 1, counts: { modules: 0, pieces: 0, blocks: 0, trash: 0 } } });
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/layouts/:layout",
    access: EVERYONE,
    load: "layout",
    async handle(c) {
      return json(200, {
        id: c.layout.id,
        name: c.layout.name,
        revision: c.layout.revision,
        working_hash: workingHash(c.layout.content),
        content: c.layout.content,
        module_revisions: c.layout.module_revisions,
        counts: layoutCounts(c.layout)
      });
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/layouts/:layout/blocks",
    access: EVERYONE,
    load: "layout",
    async handle(c) {
      return json(200, { blocks: searchBlocks(c.layout.content.blocks, c.query.get("q")) });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/check",
    access: BUILDERS,
    load: "layout",
    key: false,
    async handle(c) {
      const findings = checkLayout(c.layout.content, await standardsOf(c.client, c.workspaceId));
      return json(200, { passed: findings.length === 0, findings });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/modules",
    access: BUILDERS,
    load: "layout",
    revision: (c) => c.layout.revision,
    async handle(c) {
      const name = textField(c.body, "name", "a module name");
      const module = newModule(newId("mod"), name, parseEndplates(c.body.endplates), placeOrigin(c.layout), newId);
      c.layout.content.modules.push(module);
      c.layout.module_revisions[module.id] = 1;
      await commit(c, { type: "module.changed", actor: actorOf(c), detail: { module_id: module.id, change: "added" }, history: [{ action: "module.added", object_id: module.id, module_id: module.id }] });
      return json(201, { module: moduleOf(c.layout, module.id), layout_revision: c.layout.revision });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/modules/:module/trash",
    access: BUILDERS,
    load: "layout",
    resolve(c) {
      if (moduleOf(c.layout, c.params.module) === void 0) throw notFound();
    },
    revision: (c) => c.layout.revision,
    async handle(c) {
      const module = moduleOf(c.layout, c.params.module);
      const { content } = c.layout;
      const blocks = content.blocks.filter((block) => block.module_id === module.id);
      const owned = new Set(blocks.map((block) => block.id));
      const turnouts = content.turnouts.filter((turnout) => owned.has(turnout.stem_block_id));
      const entry = { module, blocks, turnouts, revision: moduleRevision(c.layout, module.id), trashed_by: c.user.display_name, trashed_at: (/* @__PURE__ */ new Date()).toISOString() };
      content.modules = content.modules.filter((candidate) => candidate.id !== module.id);
      content.blocks = content.blocks.filter((block) => !owned.has(block.id));
      content.turnouts = content.turnouts.filter((turnout) => !owned.has(turnout.stem_block_id));
      delete c.layout.module_revisions[module.id];
      c.layout.trash.push(entry);
      await commit(c, { type: "module.changed", actor: actorOf(c), detail: { module_id: module.id, change: "trashed" }, history: [{ action: "module.trashed", object_id: module.id, module_id: module.id, from: module.name }] });
      return json(200, writeReceipt(c));
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/layouts/:layout/trash",
    access: EVERYONE,
    load: "layout",
    async handle(c) {
      const modules = c.layout.trash.map((entry) => ({ id: entry.module.id, name: entry.module.name, trashed_by: entry.trashed_by, trashed_at: entry.trashed_at }));
      return json(200, { modules });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/trash/:module/undo",
    access: MANAGERS,
    load: "layout",
    resolve(c) {
      const entry = c.layout.trash.find((candidate) => candidate.module.id === c.params.module);
      if (entry === void 0) throw notFound();
      c.found.entry = entry;
    },
    revision: (c) => c.layout.revision,
    async handle(c) {
      const entry = c.found.entry;
      const { content } = c.layout;
      content.modules.push(entry.module);
      content.blocks.push(...entry.blocks);
      content.turnouts.push(...entry.turnouts);
      c.layout.module_revisions[entry.module.id] = entry.revision + 1;
      c.layout.trash = c.layout.trash.filter((candidate) => candidate !== entry);
      await commit(c, { type: "module.changed", actor: actorOf(c), detail: { module_id: entry.module.id, change: "restored" }, history: [{ action: "module.restored", object_id: entry.module.id, module_id: entry.module.id, to: entry.module.name }] });
      return json(200, { module: moduleOf(c.layout, entry.module.id), ...writeReceipt(c) });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/trash/:module/purge",
    access: MANAGERS,
    load: "layout",
    resolve(c) {
      if (!c.layout.trash.some((candidate) => candidate.module.id === c.params.module)) throw notFound();
    },
    revision: (c) => c.layout.revision,
    async handle(c) {
      c.layout.trash = c.layout.trash.filter((candidate) => candidate.module.id !== c.params.module);
      await txOf(c).client.query(
        `update layout_history set action = 'purged', object_id = null, module_id = null, from_value = null, to_value = null where layout_id = $1 and module_id = $2`,
        [c.layout.id, c.params.module]
      );
      await commit(c, { type: "module.changed", actor: actorOf(c), detail: { change: "purged" }, history: [{ action: "purged", object_id: null }] });
      return json(200, { layout_revision: c.layout.revision });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/modules/:module/pieces",
    access: BUILDERS,
    load: "layout",
    async resolve(c) {
      const module = moduleOf(c.layout, c.params.module);
      if (module === void 0) throw notFound();
      c.found.module = module;
      const taker = typeof c.body.open_end_id === "string" ? consumerOf(module, c.body.open_end_id) : void 0;
      if (taker?.added_by != null) {
        const [row] = await rows(c.client, "select display_name from users where id = $1", [taker.added_by]);
        c.found.takerName = row?.display_name;
      }
    },
    // A consumed open end answers open_end_taken in place of stale_revision; a stale revision with the end open stays stale.
    revision(c) {
      const module = c.found.module;
      const openEndId = c.body.open_end_id;
      if (typeof openEndId !== "string") throw invalidFields({ open_end_id: "Select an open end." });
      if (findOpenEnd(module, openEndId) === void 0) {
        const taker = consumerOf(module, openEndId);
        if (taker === void 0) throw invalidFields({ open_end_id: "That open end is not on this module." });
        throw openEndTaken(taker.open_end_label, String(c.found.takerName ?? "another member"), moduleRevision(c.layout, module.id), taker.id);
      }
      return moduleRevision(c.layout, module.id);
    },
    async handle(c) {
      const module = c.found.module;
      const openEnd = findOpenEnd(module, c.body.open_end_id);
      const body = parsePiece(c.body.piece);
      const findings = pieceFindings(module, openEnd.piece_id, body, null, await standardsOf(c.client, c.workspaceId));
      if (findings.length > 0) throw pieceRefused(findings);
      const piece = appendPiece(module, openEnd.id, body, c.user.id, newId);
      bumpModuleRevision(c.layout, module.id);
      await commit(c, { type: "piece.added", actor: actorOf(c), detail: { module_id: module.id, piece_id: piece.id }, history: [{ action: "piece.added", object_id: piece.id, module_id: module.id }] });
      const saved = moduleOf(c.layout, module.id);
      return json(201, { piece: saved.pieces.find((candidate) => candidate.id === piece.id), open_ends: saved.open_ends, module_revision: moduleRevision(c.layout, module.id), ...writeReceipt(c) });
    }
  },
  {
    method: "PATCH",
    path: "/api/workspaces/:workspace/layouts/:layout/modules/:module/pieces/:piece",
    access: BUILDERS,
    load: "layout",
    resolve(c) {
      const module = moduleOf(c.layout, c.params.module);
      const piece = module?.pieces.find((candidate) => candidate.id === c.params.piece);
      if (module === void 0 || piece === void 0) throw notFound();
      c.found.module = module;
      c.found.piece = piece;
    },
    revision: (c) => moduleRevision(c.layout, c.params.module),
    async handle(c) {
      const module = c.found.module;
      const piece = c.found.piece;
      const fields = {};
      const rise = c.body.rise_mm;
      if (rise !== void 0 && (typeof rise !== "number" || !Number.isInteger(rise) || Math.abs(rise) > 2e3)) fields.rise_mm = "Enter a whole number of millimetres.";
      const blockId2 = c.body.block_id;
      if (blockId2 !== void 0 && blockId2 !== null && blockId2 !== "" && !c.layout.content.blocks.some((block) => block.id === blockId2)) fields.block_id = "Choose a block on this layout.";
      const note = c.body.note;
      if (note !== void 0 && (typeof note !== "string" || note.length > 500)) fields.note = "Write a note of up to 500 characters.";
      if (Object.keys(fields).length > 0) throw invalidFields(fields);
      if (typeof rise === "number") {
        const findings = pieceFindings(module, piece.after_piece_id, { ...piece, rise_mm: rise }, piece.id, await standardsOf(c.client, c.workspaceId));
        if (findings.length > 0) throw pieceRefused(findings);
        changeRise(module, piece.id, rise);
      }
      if (blockId2 !== void 0) piece.block_id = blockId2 === null || blockId2 === "" ? null : blockId2;
      if (typeof note === "string") piece.note = note;
      bumpModuleRevision(c.layout, module.id);
      await commit(c, { type: "piece.changed", actor: actorOf(c), detail: { module_id: module.id, piece_id: piece.id }, history: [{ action: "piece.changed", object_id: piece.id, module_id: module.id }] });
      const saved = moduleOf(c.layout, module.id);
      return json(200, { piece: saved.pieces.find((candidate) => candidate.id === piece.id), module_revision: moduleRevision(c.layout, module.id), ...writeReceipt(c) });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/modules/:module/pieces/:piece/remove",
    access: BUILDERS,
    load: "layout",
    resolve(c) {
      const module = moduleOf(c.layout, c.params.module);
      if (module === void 0 || !module.pieces.some((candidate) => candidate.id === c.params.piece)) throw notFound();
      c.found.module = module;
    },
    revision: (c) => moduleRevision(c.layout, c.params.module),
    async handle(c) {
      const module = c.found.module;
      if (followersOf(module, c.params.piece).length > 0) throw rule("piece_has_followers", "Remove the pieces after this one first.");
      removePiece(module, c.params.piece);
      bumpModuleRevision(c.layout, module.id);
      await commit(c, { type: "piece.removed", actor: actorOf(c), detail: { module_id: module.id, piece_id: c.params.piece }, history: [{ action: "piece.removed", object_id: c.params.piece, module_id: module.id }] });
      const saved = moduleOf(c.layout, module.id);
      return json(200, { open_ends: saved.open_ends, module_revision: moduleRevision(c.layout, module.id), ...writeReceipt(c) });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/blocks",
    access: BUILDERS,
    load: "layout",
    revision: (c) => c.layout.revision,
    async handle(c) {
      const name = textField(c.body, "name", "a block name", 60);
      const kind = c.body.kind;
      if (kind !== "plain" && kind !== "loop" && kind !== "approach") throw invalidFields({ kind: "Choose plain, loop or approach." });
      const numbers = [...c.layout.content.blocks, ...c.layout.trash.flatMap((entry) => entry.blocks)].map((block2) => block2.number);
      const number = Math.max(0, ...numbers) + 1;
      const block = { id: `blk-${String(number).padStart(2, "0")}`, number, name, kind, module_id: null, neighbour_ids: [] };
      c.layout.content.blocks.push(block);
      await commit(c, { type: "module.changed", actor: actorOf(c), detail: { block_id: block.id, change: "block added" }, history: [{ action: "block.added", object_id: block.id, to: name }] });
      return json(201, { block, layout_revision: c.layout.revision });
    }
  },
  {
    method: "PATCH",
    path: "/api/workspaces/:workspace/layouts/:layout/blocks/:block",
    access: MANAGERS,
    load: "layout",
    resolve(c) {
      if (!c.layout.content.blocks.some((block) => block.id === c.params.block)) throw notFound();
    },
    revision: (c) => c.layout.revision,
    async handle(c) {
      const name = textField(c.body, "name", "a name", 60);
      const block = c.layout.content.blocks.find((candidate) => candidate.id === c.params.block);
      const from = block.name;
      block.name = name;
      await renameInSessions(txOf(c), c.layout, "block", block.id, name);
      await commit(c, { type: "name.changed", actor: actorOf(c), detail: { kind: "block", id: block.id, from, to: name }, history: [{ action: "block.renamed", object_id: block.id, from, to: name }] });
      return json(200, { block, layout_revision: c.layout.revision });
    }
  },
  {
    method: "PATCH",
    path: "/api/workspaces/:workspace/layouts/:layout/stations/:station",
    access: MANAGERS,
    load: "layout",
    resolve(c) {
      if (!c.layout.content.stations.some((station) => station.id === c.params.station)) throw notFound();
    },
    revision: (c) => c.layout.revision,
    async handle(c) {
      const name = textField(c.body, "name", "a name", 60);
      const station = c.layout.content.stations.find((candidate) => candidate.id === c.params.station);
      const from = station.name;
      station.name = name;
      await renameInSessions(txOf(c), c.layout, "station", station.id, name);
      await commit(c, { type: "name.changed", actor: actorOf(c), detail: { kind: "station", id: station.id, from, to: name }, history: [{ action: "station.renamed", object_id: station.id, from, to: name }] });
      return json(200, { station, layout_revision: c.layout.revision });
    }
  },
  {
    method: "PUT",
    path: "/api/workspaces/:workspace/layouts/:layout/timetable",
    access: MANAGERS,
    load: "layout",
    revision: (c) => c.layout.revision,
    async handle(c) {
      const { content } = c.layout;
      const entries = Array.isArray(c.body.entries) ? c.body.entries : null;
      if (entries === null) throw invalidFields({ entries: "Send the timetable entries." });
      const fields = {};
      const seen = /* @__PURE__ */ new Set();
      entries.forEach((entry, index) => {
        if (typeof entry.id !== "string" || entry.id === "" || seen.has(entry.id)) fields[`entries.${index}.id`] = "Each entry needs its own id.";
        seen.add(String(entry.id));
        if (!content.trains.some((train) => train.id === entry.train_id)) fields[`entries.${index}.train_id`] = "Choose a train on this layout.";
        if (!content.stations.some((station) => station.id === entry.station_id)) fields[`entries.${index}.station_id`] = "Choose a station on this layout.";
        const depart = entry.depart_fast_seconds;
        if (typeof depart !== "number" || !Number.isInteger(depart) || depart < 0 || depart > 86399) fields[`entries.${index}.depart_fast_seconds`] = "Enter whole seconds from 0 to 86399.";
      });
      if (Object.keys(fields).length > 0) throw invalidFields(fields);
      const [{ newest }] = await rows(c.client, `select coalesce(max((content->'timetable'->>'version')::int), 0) as newest from layout_versions where layout_id = $1`, [c.layout.id]);
      const version = Math.max(newest, content.timetable.version) + 1;
      content.timetable = {
        version,
        entries: entries.map((entry) => ({ id: entry.id, train_id: entry.train_id, station_id: entry.station_id, depart_fast_seconds: entry.depart_fast_seconds }))
      };
      await commit(c, { type: "timetable.changed", actor: actorOf(c), detail: { version }, history: [{ action: "timetable.saved", object_id: null, to: String(version) }] });
      return json(200, { timetable: c.layout.content.timetable, layout_revision: c.layout.revision });
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/layouts/:layout/history",
    access: EVERYONE,
    load: "layout",
    async handle(c) {
      return json(200, { history: await layoutHistory(c.client, c.layout.id, c.query.get("object_id")) });
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/layouts/:layout/events",
    access: EVERYONE,
    load: "layout",
    live: true,
    handle: (c) => serveEvents(c, layoutStream(c.layout.id), c.layout.revision)
  }
];

// server/routes/ops.ts
async function leasesOf(port, token) {
  if (port === null) return [];
  try {
    const answer = await fetch(`http://127.0.0.1:${port}/internal/leases`, { headers: { "x-gandyboard-internal": token }, signal: AbortSignal.timeout(1500) });
    return (await answer.json()).leases;
  } catch {
    return [];
  }
}
async function valkeyUpEverywhere(c) {
  if (!c.services.valkey.up) return false;
  const others = c.services.peers().filter((peer) => peer.id !== c.services.instanceId && peer.port !== null);
  const answers = await Promise.all(others.map(async (peer) => {
    try {
      const answer = await fetch(`http://127.0.0.1:${peer.port}/internal/valkey`, { headers: { "x-gandyboard-internal": c.services.internalToken }, signal: AbortSignal.timeout(1500) });
      return (await answer.json()).up;
    } catch {
      return true;
    }
  }));
  return answers.every(Boolean);
}
var opsRoutes = [
  {
    method: "GET",
    path: "/api/health",
    access: "open",
    async handle() {
      return json(200, { status: "ok" });
    }
  },
  {
    method: "GET",
    path: "/api/status",
    access: "user",
    async handle(c) {
      return json(200, {
        valkey: await valkeyUpEverywhere(c) ? "up" : "down",
        gotenberg: c.services.gotenberg.up ? "up" : "down",
        instance: c.services.instanceId
      });
    }
  },
  {
    method: "GET",
    path: "/api/ops/instances",
    access: "founder",
    async handle(c) {
      const instances = await Promise.all(c.services.peers().map(async (peer) => ({
        id: peer.id,
        up: peer.up,
        leases: peer.id === c.services.instanceId ? [...c.services.engine.leases] : await leasesOf(peer.port, c.services.internalToken)
      })));
      return json(200, { instances });
    }
  },
  {
    method: "POST",
    path: "/api/ops/instances/:instance/stop",
    access: "founder",
    key: false,
    async handle(c) {
      const delay2 = c.body.restart_after_ms;
      if (!Number.isInteger(delay2) || delay2 < 0 || delay2 > 6e4) {
        throw invalidFields({ restart_after_ms: "Enter a whole number of milliseconds from 0 to 60000." });
      }
      const target = c.services.peers().find((peer) => peer.id === c.params.instance);
      if (target === void 0) throw invalidFields({ instance: "Choose instance a or b." });
      if (target.id === c.services.instanceId) {
        c.res.on("finish", () => c.services.stop(delay2));
      } else if (target.port !== null) {
        void fetch(`http://127.0.0.1:${target.port}/internal/stop`, {
          method: "POST",
          headers: { "x-gandyboard-internal": c.services.internalToken, "content-type": "application/json" },
          body: JSON.stringify({ restart_after_ms: delay2 }),
          signal: AbortSignal.timeout(1500)
        }).catch(() => void 0);
      }
      return { status: 202, body: { instance: target.id } };
    }
  }
];

// server/domain/session/routing.ts
var MAX_ROUTE_BLOCKS = 8;
function blocksAhead(state, block, direction) {
  return block.neighbour_ids.map((id) => state.blocks.find((candidate) => candidate.id === id)).filter((candidate) => candidate !== void 0).filter((candidate) => direction === "east" ? candidate.number > block.number : candidate.number < block.number);
}
function allPaths(state, from, to, direction) {
  const found = [];
  const walk = (at, path) => {
    for (const next of blocksAhead(state, at, direction)) {
      const extended = [...path, next];
      if (next.id === to) found.push(extended);
      else walk(next, extended);
    }
  };
  walk(from, []);
  return found;
}
function cost(path) {
  return path.reduce((sum, block) => sum + block.length_mm, 0);
}
function lowerNumbers(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i].number !== b[i].number) return a[i].number - b[i].number;
  return a.length - b.length;
}
function findRoute(state, train, destinationId, viaId) {
  const head = blockById(state, train.head_block_id);
  const destination = blockById(state, destinationId);
  const candidates = allPaths(state, head, destinationId, train.direction).filter((path) => viaId === null || path.some((block) => block.id === viaId)).sort((a, b) => cost(a) - cost(b) || lowerNumbers(a, b));
  if (candidates.length === 0) throw rule("no_route", `There is no road from here to ${destination.name}.`);
  if (candidates[0].length > MAX_ROUTE_BLOCKS) {
    throw rule("route_too_long", "That road is more than 8 blocks. Choose a nearer destination.");
  }
  return candidates[0].map((block) => block.id);
}
function crossings(state, headBlockId, route) {
  const found = [];
  const chain = [headBlockId, ...route];
  for (let i = 0; i < route.length; i += 1) {
    const pair = [chain[i], chain[i + 1]];
    for (const turnout of state.turnout_defs) {
      if (!pair.includes(turnout.stem_block_id)) continue;
      if (pair.includes(turnout.normal_block_id)) found.push({ turnout, position: "normal", entering_block_id: chain[i + 1] });
      if (pair.includes(turnout.reverse_block_id)) found.push({ turnout, position: "reverse", entering_block_id: chain[i + 1] });
    }
  }
  return found;
}
function firstBlocker(state, train, route) {
  const states = new Map(blockStates(state).map((block) => [block.id, block]));
  const crossed = crossings(state, train.head_block_id, route);
  const trainOf2 = (authorityId) => {
    const authority = state.authorities.find((candidate) => candidate.id === authorityId);
    return authority === void 0 ? null : trainById(state, authority.train_id)?.number ?? null;
  };
  for (const blockId2 of route) {
    const block = states.get(blockId2);
    if (block === void 0) continue;
    if (block.state === "out_of_service") return { block_id: blockId2, other_train_number: null };
    if (block.state === "occupied") return { block_id: blockId2, other_train_number: block.train_number };
    if (block.state === "reserved") return { block_id: blockId2, other_train_number: trainOf2(block.authority_id) };
    for (const crossing of crossed.filter((item) => item.entering_block_id === blockId2)) {
      const turnout = state.turnouts.find((candidate) => candidate.id === crossing.turnout.id);
      if (turnout?.locked_by_authority_id != null && turnout.position !== crossing.position) {
        return { block_id: blockId2, other_train_number: trainOf2(turnout.locked_by_authority_id) };
      }
    }
  }
  return null;
}
function previewRoute(state, train, destinationId, viaId) {
  const route = findRoute(state, train, destinationId, viaId);
  const blocker = firstBlocker(state, train, route);
  return {
    route_block_ids: route,
    limit_block_id: route[route.length - 1],
    clear: blocker === null,
    conflict_block_id: blocker?.block_id ?? null,
    other_train_number: blocker?.other_train_number ?? null
  };
}

// server/domain/session/authority.ts
var DEFAULT_TIME_LIMIT_S = 3600;
var MIN_TIME_LIMIT_S = 6;
var MAX_TIME_LIMIT_S = 43200;
function closeConflicts(state, shouldClose) {
  const closed = [];
  for (const conflict of state.conflicts) {
    if (conflict.state === "Open" && shouldClose(conflict)) {
      conflict.state = "Closed";
      conflict.revision += 1;
      closed.push(conflict.id);
    }
  }
  return closed;
}
function grant(state, train, route, fastSeconds2, limitSeconds) {
  const authority = {
    id: newId("au"),
    train_id: train.id,
    state: "Granted",
    block_ids: route,
    remaining_block_ids: route,
    limit_block_id: route[route.length - 1],
    expires_fast_seconds: fastSeconds2 + limitSeconds,
    ended_reason: null,
    revision: 1
  };
  state.authorities.push(authority);
  train.authority_id = authority.id;
  train.revision += 1;
  for (const crossing of crossings(state, train.head_block_id, route)) {
    const turnout = state.turnouts.find((candidate) => candidate.id === crossing.turnout.id);
    if (turnout !== void 0) {
      turnout.position = crossing.position;
      turnout.locked_by_authority_id = authority.id;
    }
  }
  closeConflicts(state, (conflict) => conflict.train_id === train.id);
  return authority;
}
function refuse(state, train, route, blocker) {
  const authority = {
    id: newId("au"),
    train_id: train.id,
    state: "Refused",
    block_ids: route,
    remaining_block_ids: [],
    limit_block_id: route[route.length - 1],
    expires_fast_seconds: 0,
    ended_reason: null,
    revision: 1
  };
  const other = blocker.other_train_number === null ? null : state.trains.find((candidate) => candidate.number === blocker.other_train_number);
  const conflict = {
    id: newId("cf"),
    state: "Open",
    train_id: train.id,
    other_train_id: other?.id ?? null,
    block_id: blocker.block_id,
    note: "",
    revision: 1
  };
  closeConflicts(state, (existing) => existing.train_id === train.id);
  state.authorities.push(authority);
  state.conflicts.push(conflict);
  train.revision += 1;
  return { authority, conflict };
}
function unlockTurnouts(state, authorityId) {
  for (const turnout of state.turnouts) {
    if (turnout.locked_by_authority_id === authorityId) turnout.locked_by_authority_id = null;
  }
}
function endAuthority(state, authority, endedState, reason) {
  authority.state = endedState;
  authority.ended_reason = reason;
  authority.remaining_block_ids = [];
  authority.revision += 1;
  const train = state.trains.find((candidate) => candidate.id === authority.train_id);
  if (train !== void 0 && train.authority_id === authority.id) train.authority_id = null;
  unlockTurnouts(state, authority.id);
}
function grantedFor(state, train) {
  return grantedAuthorities(state).find((authority) => authority.train_id === train.id);
}

// server/domain/session/deadlock.ts
function cycles(edges) {
  const reach = (from) => {
    const seen = /* @__PURE__ */ new Set();
    const stack = [...edges.get(from) ?? []];
    while (stack.length > 0) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...edges.get(next) ?? []);
    }
    return seen;
  };
  const groups = /* @__PURE__ */ new Map();
  for (const node of edges.keys()) {
    if (!reach(node).has(node)) continue;
    const members = [...edges.keys()].filter((other) => reach(node).has(other) && reach(other).has(node));
    groups.set([...members].sort().join("|"), members);
  }
  return [...groups.values()];
}
function raiseDeadlocks(state, tick) {
  const edges = /* @__PURE__ */ new Map();
  for (const conflict of state.conflicts) {
    if (conflict.state !== "Open" || conflict.other_train_id === null) continue;
    edges.set(conflict.train_id, [...edges.get(conflict.train_id) ?? [], conflict.other_train_id]);
  }
  const raised = [];
  for (const members of cycles(edges)) {
    const numbers = members.map((id) => state.trains.find((train) => train.id === id)?.number ?? id).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
    const known = state.deadlocks.some((deadlock2) => deadlock2.state === "Open" && deadlock2.train_numbers.join(",") === numbers.join(","));
    if (known) continue;
    const deadlock = { id: newId("dl"), state: "Open", raised_at_tick: tick, train_numbers: numbers };
    state.deadlocks.push(deadlock);
    raised.push(deadlock);
  }
  return raised;
}
function openDeadlockOf(state, trainNumber) {
  return state.deadlocks.find((deadlock) => deadlock.state === "Open" && deadlock.train_numbers.includes(trainNumber));
}
function clearDeadlocksOf(state, trainNumber) {
  const cleared = [];
  for (const deadlock of state.deadlocks) {
    if (deadlock.state === "Open" && deadlock.train_numbers.includes(trainNumber)) {
      deadlock.state = "Cleared";
      cleared.push(deadlock.id);
    }
  }
  return cleared;
}

// server/domain/session/commands.ts
function parseHighball(body, state) {
  const fields = {};
  const destination = typeof body.destination_block_id === "string" ? body.destination_block_id : "";
  if (!state.blocks.some((block) => block.id === destination)) fields.destination_block_id = "Choose a destination block.";
  const via = body.via_block_id === void 0 || body.via_block_id === null || body.via_block_id === "" ? null : body.via_block_id;
  if (via !== null && (typeof via !== "string" || !state.blocks.some((block) => block.id === via))) fields.via_block_id = "Choose a block on this layout.";
  const limit = body.time_limit_fast_seconds === void 0 ? DEFAULT_TIME_LIMIT_S : body.time_limit_fast_seconds;
  if (!Number.isInteger(limit) || limit < MIN_TIME_LIMIT_S || limit > MAX_TIME_LIMIT_S) {
    fields.time_limit_fast_seconds = `Enter a whole number from ${MIN_TIME_LIMIT_S} to ${MAX_TIME_LIMIT_S}.`;
  }
  if (Object.keys(fields).length > 0) throw invalidFields(fields);
  return { destination_block_id: destination, via_block_id: via, time_limit_fast_seconds: limit };
}
function highball(state, train, request3, fastSeconds2) {
  const deadlock = openDeadlockOf(state, train.number);
  if (deadlock !== void 0 && state.conflicts.some((conflict2) => conflict2.state === "Open" && conflict2.train_id === train.id)) {
    throw deadlockOpen(deadlock.train_numbers);
  }
  if (grantedFor(state, train) !== void 0) throw rule("authority_active", `Train ${train.number} already has the road.`);
  const route = findRoute(state, train, request3.destination_block_id, request3.via_block_id);
  const blocker = firstBlocker(state, train, route);
  if (blocker === null) return { granted: true, authority: grant(state, train, route, fastSeconds2, request3.time_limit_fast_seconds) };
  const { authority, conflict } = refuse(state, train, route, blocker);
  const block = blockById(state, blocker.block_id);
  const message2 = blocker.other_train_number === null ? `${block.name} is out of service.` : `Train ${blocker.other_train_number} holds ${block.name}.`;
  return { granted: false, authority, conflict, message: message2, reachable_block_ids: route.slice(0, route.indexOf(blocker.block_id)) };
}
function deadlockOpen(numbers) {
  return rule("deadlock_open", `Trains ${numbers.join(", ")} are deadlocked. Use Back to loop or Recall.`);
}
function cancelAuthority(state, authority) {
  if (authority.state !== "Granted") throw rule("authority_ended", "That authority has already ended.");
  const train = trainById(state, authority.train_id);
  if (train !== void 0 && blockById(state, train.head_block_id).kind === "approach") {
    throw rule("approach_locked", `Train ${train.number} is on the approach. The authority cannot be cancelled.`);
  }
  endAuthority(state, authority, "Released", "cancelled");
  if (train !== void 0) train.revision += 1;
}
function freeForTrain(state, block, train) {
  const without = {
    ...state,
    trains: state.trains.filter((other) => other.id !== train.id),
    authorities: state.authorities.filter((authority) => authority.train_id !== train.id)
  };
  return blockStates(without).find((candidate) => candidate.id === block.id)?.state === "free";
}
function dispatcherMove(state, train, target, offsetMm) {
  const revoked = state.authorities.filter((authority) => authority.state === "Granted" && authority.train_id === train.id);
  for (const authority of revoked) endAuthority(state, authority, "Revoked", "moved");
  const closed = closeConflicts(state, (conflict) => conflict.train_id === train.id || conflict.other_train_id === train.id);
  const cleared = clearDeadlocksOf(state, train.number);
  train.head_block_id = target.id;
  train.head_offset_mm = offsetMm;
  train.trail_block_ids = [target.id];
  train.revision += 1;
  return { train_id: train.id, revoked_authority_ids: revoked.map((a) => a.id), closed_conflict_ids: closed, cleared_deadlock_ids: cleared };
}
function blocksBetween(state, fromId, toId) {
  const seen = /* @__PURE__ */ new Set([fromId]);
  let frontier = [fromId];
  for (let steps = 0; frontier.length > 0; steps += 1) {
    if (frontier.includes(toId)) return steps;
    frontier = frontier.flatMap((id) => blockById(state, id).neighbour_ids).filter((id) => {
      if (seen.has(id) || !state.blocks.some((block) => block.id === id)) return false;
      seen.add(id);
      return true;
    });
  }
  return Infinity;
}
function backToLoop(state, train) {
  const loops = state.blocks.filter((block2) => block2.kind === "loop" && freeForTrain(state, block2, train)).map((block2) => ({ block: block2, distance: blocksBetween(state, train.head_block_id, block2.id) })).filter((candidate) => candidate.distance !== Infinity).sort((a, b) => a.distance - b.distance || a.block.number - b.block.number);
  if (loops.length === 0) throw rule("no_free_loop", `No loop is free for Train ${train.number}.`);
  const { block } = loops[0];
  return { block, detail: dispatcherMove(state, train, block, block.length_mm) };
}
function recall(state, train) {
  const block = blockById(state, train.start_block_id);
  if (!freeForTrain(state, block, train)) throw rule("recall_blocked", `${block.name} is not free.`);
  return { block, detail: dispatcherMove(state, train, block, train.start_offset_mm) };
}
function parseExtraTrain(body, state) {
  const fields = {};
  const number = typeof body.number === "string" ? body.number.trim() : "";
  if (!/^[A-Za-z0-9-]{1,10}$/.test(number)) fields.number = "Enter a train number of letters, digits or dashes.";
  else if (state.trains.some((train) => train.number === number)) fields.number = "That train number is already in this session.";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name === "" || name.length > 60) fields.name = "Enter a train name of up to 60 characters.";
  const length = body.length_mm;
  if (!Number.isInteger(length) || length < 300 || length > 2400) fields.length_mm = "Length runs from 300 to 2400 mm.";
  const speed = body.speed_mph;
  if (!Number.isInteger(speed) || speed < 5 || speed > 60) fields.speed_mph = "Speed runs from 5 to 60 mph.";
  const direction = body.direction;
  if (direction !== "east" && direction !== "west") fields.direction = "Choose East or West.";
  const start = typeof body.start_block_id === "string" ? state.blocks.find((block) => block.id === body.start_block_id) : void 0;
  if (start === void 0) fields.start_block_id = "Choose a start block.";
  if (Object.keys(fields).length > 0) throw invalidFields(fields);
  return {
    number,
    name,
    length_mm: length,
    speed_mph: speed,
    direction,
    start
  };
}
function addExtraTrain(state, request3) {
  const free = blockStates(state).find((block) => block.id === request3.start.id)?.state === "free";
  if (!free) throw rule("block_in_use", `${request3.start.name} is in use.`);
  const train = {
    id: newId("tx"),
    number: request3.number,
    name: request3.name,
    direction: request3.direction,
    speed_mph: request3.speed_mph,
    length_mm: request3.length_mm,
    head_block_id: request3.start.id,
    head_offset_mm: request3.start.length_mm,
    trail_block_ids: [request3.start.id],
    distance_run_mm: 0,
    carry: 0,
    authority_id: null,
    revision: 1,
    start_block_id: request3.start.id,
    start_offset_mm: request3.start.length_mm
  };
  state.trains.push(train);
  return train;
}
function setBlockService(state, block, outOfService) {
  if (outOfService) {
    const current = blockStates(state).find((candidate) => candidate.id === block.id);
    if (current?.state !== "free") throw rule("block_in_use", `${block.name} is in use.`);
  }
  block.out_of_service = outOfService;
}
function throwTurnout(state, turnoutId, position) {
  const turnout = state.turnouts.find((candidate) => candidate.id === turnoutId);
  if (turnout === void 0) throw new Error(`turnout ${turnoutId} is not in the session`);
  if (turnout.locked_by_authority_id !== null) {
    const authority = state.authorities.find((candidate) => candidate.id === turnout.locked_by_authority_id);
    const train = authority === void 0 ? void 0 : trainById(state, authority.train_id);
    throw rule("turnout_locked", `Turnout ${turnout.id} is locked by Train ${train?.number ?? ""}.`);
  }
  turnout.position = position;
}
function saveNote(conflict, note) {
  if (typeof note !== "string" || note.length > 500) throw invalidFields({ note: "Write a note of up to 500 characters." });
  if (conflict.state !== "Open") throw rule("conflict_closed", "That conflict is closed.");
  conflict.note = note;
  conflict.revision += 1;
}
function withdraw(state, conflict) {
  const train = trainById(state, conflict.train_id);
  const deadlock = train === void 0 ? void 0 : openDeadlockOf(state, train.number);
  if (deadlock !== void 0) throw deadlockOpen(deadlock.train_numbers);
  if (conflict.state !== "Open") throw rule("conflict_closed", "That conflict is closed.");
  closeConflicts(state, (candidate) => candidate.id === conflict.id);
}

// shared/session-states.ts
function nextStatus(current, cause) {
  const { status, hold_reason: reason } = current;
  switch (cause) {
    case "start":
      return status === "Scheduled" ? { status: "Running", hold_reason: null } : null;
    case "hold":
      return status === "Running" ? { status: "Held", hold_reason: "operator" } : null;
    case "resume":
      return status === "Held" && reason === "operator" || status === "Interrupted" ? { status: "Running", hold_reason: null } : null;
    case "end":
      return status === "Running" || status === "Held" || status === "Interrupted" ? { status: "Ended", hold_reason: null } : null;
    case "valkey_down":
      return status === "Running" ? { status: "Held", hold_reason: "valkey" } : null;
    case "valkey_up":
      return status === "Held" && reason === "valkey" ? { status: "Running", hold_reason: null } : null;
    case "lease_lost":
      return status === "Running" ? { status: "Interrupted", hold_reason: null } : null;
  }
}
var isActive = (status) => status === "Running" || status === "Held";
var canAddExtraTrain = (status) => status === "Scheduled" || isActive(status);

// server/domain/session/transitions.ts
function transitionOrRefuse(current, command) {
  const next = nextStatus(current, command);
  if (next === null) throw rule("session_transition", `A ${current.status} session cannot do that.`);
  return next;
}
function requireActive(status) {
  if (!isActive(status)) throw rule("session_not_active", "This session is not running.");
}
function requireCanAddTrain(status) {
  if (!canAddExtraTrain(status)) throw rule("session_transition", `A ${status} session cannot do that.`);
}

// server/domain/reference-layout.ts
var RADIUS = 1067;
var FOLD_RADIUS = 1150;
var BLOCK_IDS = Array.from({ length: 12 }, (_, i) => `blk-${String(i + 1).padStart(2, "0")}`);
var blockId = (number) => BLOCK_IDS[number - 1];
var BLOCKS = [
  { number: 1, name: "Wren Quay Road", kind: "plain", module: "mod-wren", neighbours: [3] },
  { number: 2, name: "Wren Quay Loop", kind: "loop", module: "mod-wren", neighbours: [3] },
  { number: 3, name: "Wren Approach", kind: "approach", module: "mod-wren", neighbours: [1, 2, 4] },
  { number: 4, name: "Single Line West", kind: "plain", module: "mod-west", neighbours: [3, 5] },
  { number: 5, name: "Fernhill West Approach", kind: "approach", module: "mod-fernhill", neighbours: [4, 6, 7] },
  { number: 6, name: "Fernhill Main", kind: "plain", module: "mod-fernhill", neighbours: [5, 8] },
  { number: 7, name: "Fernhill Loop", kind: "loop", module: "mod-fernhill", neighbours: [5, 8] },
  { number: 8, name: "Fernhill East Approach", kind: "approach", module: "mod-fernhill", neighbours: [6, 7, 9] },
  { number: 9, name: "Single Line East", kind: "plain", module: "mod-east", neighbours: [8, 10] },
  { number: 10, name: "Tarn Approach", kind: "approach", module: "mod-tarn", neighbours: [9, 11, 12] },
  { number: 11, name: "Tarn Head Road", kind: "plain", module: "mod-tarn", neighbours: [10] },
  { number: 12, name: "Tarn Head Loop", kind: "loop", module: "mod-tarn", neighbours: [10] }
];
var MODULE_NAMES = [
  ["mod-east", "Single Line East"],
  ["mod-fernhill", "Fernhill"],
  ["mod-tarn", "Tarn Head"],
  ["mod-west", "Single Line West"],
  ["mod-wren", "Wren Quay"]
];
var TIMETABLE = [
  ["tt-1", "t101", "st-wren", 720],
  ["tt-2", "t101", "st-fernhill", 1500],
  ["tt-3", "t101", "st-tarn", 2400],
  ["tt-4", "t202", "st-tarn", 720],
  ["tt-5", "t202", "st-fernhill", 1500],
  ["tt-6", "t202", "st-wren", 2400],
  ["tt-7", "t303", "st-wren", 900],
  ["tt-8", "t303", "st-fernhill", 1800]
];
var Builder = class {
  constructor(module, newId2, at) {
    this.newId = newId2;
    this.at = at;
    this.module = module;
    this.cursor = module.open_ends[0].id;
  }
  module;
  cursor;
  lay(body, forkFrom) {
    const piece = appendPiece(this.module, forkFrom ?? this.cursor, body, null, this.newId);
    piece.block_id = blockId(this.at.block);
    const ends = this.module.open_ends.filter((end) => end.piece_id === piece.id);
    this.cursor = ends[0].id;
    return ends.map((end) => end.id);
  }
  straight(...lengths) {
    for (const length of lengths) this.lay({ kind: "straight", length_mm: length, rise_mm: 0, mainline: true });
    return this;
  }
  curve(hand, angleDeg, count = 1, radius = RADIUS) {
    for (let i = 0; i < count; i += 1) this.lay({ kind: "curve", radius_mm: radius, angle_deg: angleDeg, hand, rise_mm: 0, mainline: true });
    return this;
  }
  // Lays a turnout; the cursor stays on the through leg and the diverging end id is returned.
  turnout(hand) {
    const [, diverging] = this.lay({ kind: "turnout", frog_number: 6, hand, length_mm: 305, rise_mm: 0, mainline: true });
    return diverging;
  }
  // Builds a branch from an open end, returns to the previous cursor and answers the branch's last open end.
  branch(from, block, build) {
    const saved = this.cursor;
    const savedBlock = this.at.block;
    this.cursor = from;
    this.at.block = block;
    build(this);
    const last = this.cursor;
    this.cursor = saved;
    this.at.block = savedBlock;
    return last;
  }
  block(number) {
    this.at.block = number;
    return this;
  }
  // The module's last open end joins the next module (or a turnout's unused leg), so it stays closed.
  dropEnd(endId = this.cursor) {
    this.module.open_ends = this.module.open_ends.filter((end) => end.id !== endId);
  }
  end() {
    const end = this.module.open_ends.find((open) => open.id === this.cursor);
    if (end === void 0) throw new Error("module has no open end");
    return { x_mm: end.x_mm, y_mm: end.y_mm, heading_deg: end.heading_deg };
  }
};
function plates() {
  return [{ end: "A", width_mm: 610, track_offsets_mm: [0] }, { end: "B", width_mm: 610, track_offsets_mm: [0] }];
}
function referenceModules(newId2) {
  const position = { block: 3 };
  const make = (id, origin) => {
    const name = MODULE_NAMES.find(([moduleId]) => moduleId === id)?.[1] ?? id;
    return new Builder(newModule(id, name, plates(), origin, newId2), newId2, position);
  };
  const wren = make("mod-wren", { x_mm: 0, y_mm: 0, heading_deg: 180 });
  wren.block(3).straight(595, 600);
  const wrenLoop = wren.turnout("left");
  wren.block(1).straight(1e3, 1e3, 1e3);
  wren.branch(wrenLoop, 2, (b) => b.curve("left", 20).straight(1343).curve("right", 29.53).straight(735));
  const west = make("mod-west", { x_mm: 0, y_mm: 0, heading_deg: 0 });
  west.block(4).straight(194).curve("left", 15, 12, FOLD_RADIUS).straight(194);
  const fernhill = make("mod-fernhill", west.end());
  fernhill.block(5).straight(595, 600);
  const fernhillLoop = fernhill.turnout("right");
  fernhill.block(6).curve("left", 30).straight(305).curve("right", 30).straight(154).curve("right", 30).straight(305).curve("left", 30);
  fernhill.block(8);
  const throatLoop = fernhill.turnout("right");
  fernhill.straight(595, 600);
  const loopEnd = fernhill.branch(fernhillLoop, 7, (b) => b.curve("right", 20.47).straight(305).curve("left", 30).straight(159).curve("left", 30).straight(326).curve("right", 30).straight(152));
  const east = make("mod-east", fernhill.end());
  east.block(9).straight(194).curve("right", 15, 12, FOLD_RADIUS).straight(194);
  const tarn = make("mod-tarn", east.end());
  tarn.block(10).straight(595, 600);
  const tarnLoop = tarn.turnout("left");
  tarn.block(11).straight(1e3, 1e3, 1e3);
  tarn.branch(tarnLoop, 12, (b) => b.curve("left", 20).straight(1343).curve("right", 29.53).straight(735));
  fernhill.dropEnd(throatLoop);
  fernhill.dropEnd(loopEnd);
  west.dropEnd();
  fernhill.dropEnd();
  east.dropEnd();
  return [wren, west, fernhill, east, tarn].map((builder) => builder.module);
}
function referenceTrains() {
  return [
    { id: "t101", number: "101", name: "Wren Quay Pickup", direction: "east", speed_mph: 40, length_mm: 1200, start_block_id: blockId(1), head_offset_mm: 2800 },
    { id: "t202", number: "202", name: "Tarn Head Mixed", direction: "west", speed_mph: 40, length_mm: 1200, start_block_id: blockId(11), head_offset_mm: 2800 },
    { id: "t303", number: "303", name: "Fernhill Shuttle", direction: "east", speed_mph: 25, length_mm: 900, start_block_id: blockId(2), head_offset_mm: 2800 }
  ];
}
function referenceBlocks() {
  return BLOCKS.map((spec) => ({
    id: blockId(spec.number),
    number: spec.number,
    name: spec.name,
    kind: spec.kind,
    module_id: spec.module,
    neighbour_ids: spec.neighbours.map(blockId)
  }));
}
function referenceStations() {
  return [
    { id: "st-fernhill", name: "Fernhill", block_ids: [blockId(6), blockId(7)] },
    { id: "st-tarn", name: "Tarn Head", block_ids: [blockId(11), blockId(12)] },
    { id: "st-wren", name: "Wren Quay", block_ids: [blockId(1), blockId(2)] }
  ];
}
function referenceTurnouts() {
  return [
    { id: "T1", stem_block_id: blockId(3), normal_block_id: blockId(1), reverse_block_id: blockId(2) },
    { id: "T2", stem_block_id: blockId(5), normal_block_id: blockId(6), reverse_block_id: blockId(7) },
    { id: "T3", stem_block_id: blockId(8), normal_block_id: blockId(6), reverse_block_id: blockId(7) },
    { id: "T4", stem_block_id: blockId(10), normal_block_id: blockId(11), reverse_block_id: blockId(12) }
  ];
}
function referenceTimetable(version, firstDepart) {
  return {
    version,
    entries: TIMETABLE.map(([id, train, station, depart]) => ({
      id,
      train_id: train,
      station_id: station,
      depart_fast_seconds: id === "tt-1" ? firstDepart : depart
    }))
  };
}
function referenceContent(newId2, timetableVersion, firstDepart) {
  return normalizeContent({
    modules: referenceModules(newId2),
    blocks: referenceBlocks(),
    stations: referenceStations(),
    turnouts: referenceTurnouts(),
    trains: referenceTrains(),
    timetable: referenceTimetable(timetableVersion, firstDepart)
  });
}

// shared/blockpaths.ts
function blockLengths(content) {
  const lengths = /* @__PURE__ */ new Map();
  for (const module of content.modules) {
    for (const piece of module.pieces) {
      if (piece.block_id !== null) lengths.set(piece.block_id, (lengths.get(piece.block_id) ?? 0) + piece.length_mm);
    }
  }
  return lengths;
}

// server/domain/session/pin.ts
function pinContent(content) {
  const lengths = blockLengths(content);
  const trains = content.trains.map((spec) => ({
    id: spec.id,
    number: spec.number,
    name: spec.name,
    direction: spec.direction,
    speed_mph: spec.speed_mph,
    length_mm: spec.length_mm,
    head_block_id: spec.start_block_id,
    head_offset_mm: spec.head_offset_mm,
    trail_block_ids: [spec.start_block_id],
    distance_run_mm: 0,
    carry: 0,
    authority_id: null,
    revision: 1,
    start_block_id: spec.start_block_id,
    start_offset_mm: spec.head_offset_mm
  }));
  return {
    blocks: content.blocks.map((block) => ({
      id: block.id,
      number: block.number,
      name: block.name,
      kind: block.kind,
      length_mm: lengths.get(block.id) ?? 0,
      neighbour_ids: block.neighbour_ids,
      out_of_service: false
    })),
    stations: content.stations,
    turnout_defs: content.turnouts,
    timetable: content.timetable.entries,
    trains,
    turnouts: content.turnouts.map((turnout) => ({ id: turnout.id, position: "normal", locked_by_authority_id: null })),
    authorities: [],
    conflicts: [],
    deadlocks: [],
    timetable_progress: content.timetable.entries.map((entry) => ({ entry_id: entry.id, arrived_fast_seconds: null }))
  };
}

// server/domain/standards.ts
var DEFAULT_STANDARDS = {
  endplate_single_mm: 610,
  endplate_double_mm: 660,
  double_track_offset_mm: 25,
  end_straight_mm: 152,
  min_radius_mm: 1067,
  max_grade_tenths_percent: 20,
  min_frog_number: 6,
  reverse_curve_straight_mm: 305,
  elevation_step_hundredths_mm: 1905,
  display_units: "in"
};
var NUMERIC_FIELDS = [
  "endplate_single_mm",
  "endplate_double_mm",
  "double_track_offset_mm",
  "end_straight_mm",
  "min_radius_mm",
  "max_grade_tenths_percent",
  "min_frog_number",
  "reverse_curve_straight_mm",
  "elevation_step_hundredths_mm"
];
function parseStandards(body) {
  const fields = {};
  const profile = {};
  for (const name of NUMERIC_FIELDS) {
    const value = body[name];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1e6) fields[name] = "Enter a whole number of at least zero.";
    else profile[name] = value;
  }
  if (body.display_units !== "in" && body.display_units !== "mm") fields.display_units = "Choose inches or millimetres.";
  else profile.display_units = body.display_units;
  if (Object.keys(fields).length > 0) throw invalidFields(fields);
  return profile;
}

// server/seed.ts
var PASSWORD = "gandyboard-demo-1";
var PEOPLE = [
  { name: "Founder Fishplate", email: "founder@fishplate.example", role: "founder", workspace: null, walked: true },
  { name: "Morgan Tarn", email: "manager@tarnvalley.example", role: "manager", workspace: "tarn-valley", walked: true },
  { name: "Robin Tarn", email: "member@tarnvalley.example", role: "member", workspace: "tarn-valley", walked: true },
  { name: "Sam Tarn", email: "member2@tarnvalley.example", role: "member", workspace: "tarn-valley", walked: true },
  { name: "Alex Tarn", email: "operator@tarnvalley.example", role: "operator", workspace: "tarn-valley", walked: true },
  { name: "Jo Tarn", email: "operator2@tarnvalley.example", role: "operator", workspace: "tarn-valley", walked: true },
  { name: "Riley Tarn", email: "newmember@tarnvalley.example", role: "member", workspace: "tarn-valley", walked: false },
  { name: "Casey Marsh", email: "manager@saltmarsh.example", role: "manager", workspace: "saltmarsh", walked: true },
  { name: "Dale Marsh", email: "operator@saltmarsh.example", role: "operator", workspace: "saltmarsh", walked: true }
];
var counter = 0;
var sequentialIds = (prefix) => `${prefix}-${(++counter).toString(36)}`;
function versionContent(number) {
  counter = 0;
  return referenceContent(sequentialIds, number, number * 60);
}
async function insertVersion(client, layoutId, number, content, savedBy) {
  const id = newId("ver");
  await client.query(
    `insert into layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by) values ($1, $2, $3, 'Published', $4, $5, $6, $7)`,
    [id, layoutId, number, `Issue ${number}`, canonicalHash(content), JSON.stringify(content), savedBy]
  );
  return id;
}
async function insertSession(client, input) {
  await client.query(
    `insert into sessions (id, workspace_id, layout_id, name, status, ratio, last_tick_at, layout_version_id, layout_version_number, timetable_version, state)
     values ($1, $2, $3, $4, $5, $6, case when $5 = 'Running' then now() else null end, $7, $8, $9, $10)`,
    [input.id, input.workspaceId, input.layoutId, input.name, input.status, input.ratio, input.versionId, input.versionNumber, input.content.timetable.version, JSON.stringify(pinContent(input.content))]
  );
}
async function addFounders(client, workspaceId) {
  await client.query(`insert into members (workspace_id, user_id, role) select $1, id, 'founder' from users where is_founder on conflict do nothing`, [workspaceId]);
}
async function createWorkspaceRow(client, id, name) {
  await client.query("insert into workspaces (id, name, standards) values ($1, $2, $3)", [id, name, JSON.stringify(DEFAULT_STANDARDS)]);
  await addFounders(client, id);
}
async function createLayoutRow(client, workspaceId, layoutId, name, content) {
  const revisions = Object.fromEntries(content.modules.map((module) => [module.id, 1]));
  await client.query("insert into layouts (id, workspace_id, name, revision, content, module_revisions) values ($1, $2, $3, 1, $4, $5)", [layoutId, workspaceId, name, JSON.stringify(content), JSON.stringify(revisions)]);
}
async function createFromTemplate(tx, name, template, actor) {
  const client = tx.client;
  const workspaceId = newId("ws");
  const layoutId = newId("lay");
  await createWorkspaceRow(client, workspaceId, name);
  if (template === "empty") {
    const empty = normalizeContent({ modules: [], blocks: [], stations: [], turnouts: [], trains: [], timetable: { version: 0, entries: [] } });
    await createLayoutRow(client, workspaceId, layoutId, "First layout", empty);
    return { workspace: { id: workspaceId, name }, layout: { id: layoutId }, version: null };
  }
  const content = referenceContent(newId, 1, 720);
  await createLayoutRow(client, workspaceId, layoutId, "Reference layout", content);
  const versionId = await insertVersion(client, layoutId, 1, content, actor.display_name);
  return { workspace: { id: workspaceId, name }, layout: { id: layoutId }, version: { id: versionId } };
}
async function seedDatabase(client) {
  const seeded = await client.query(`select 1 from users where email = 'founder@fishplate.example'`);
  if (seeded.rowCount !== 0) return;
  const hash = await hashPassword(PASSWORD);
  for (const person of PEOPLE) {
    await client.query(
      "insert into users (id, email, display_name, password_hash, is_founder, walkthrough_done) values ($1, $2, $3, $4, $5, $6)",
      [newId("u"), person.email, person.name, hash, person.role === "founder", person.walked]
    );
  }
  const clubs = [
    {
      id: "tarn-valley",
      name: "Tarn Valley Model Railway Club",
      layoutId: "tarn-main",
      layoutName: "Tarn Valley Main Line",
      versions: 12,
      sessions: [{ id: "thursday-running", name: "Thursday running", status: "Scheduled" }, { id: "tarn-shakedown", name: "Tarn shakedown", status: "Running" }]
    },
    {
      id: "saltmarsh",
      name: "Saltmarsh Modular Group",
      layoutId: "saltmarsh-branch",
      layoutName: "Saltmarsh Branch",
      versions: 1,
      sessions: [{ id: "saltmarsh-rehearsal", name: "Saltmarsh rehearsal", status: "Running" }]
    }
  ];
  for (const club of clubs) {
    await createWorkspaceRow(client, club.id, club.name);
    for (const person of PEOPLE.filter((candidate) => candidate.workspace === club.id)) {
      await client.query(`insert into members (workspace_id, user_id, role) select $1, id, $3 from users where email = $2`, [club.id, person.email, person.role]);
    }
    const newest = versionContent(club.versions);
    await createLayoutRow(client, club.id, club.layoutId, club.layoutName, newest);
    let newestId = "";
    for (let number = 1; number <= club.versions; number += 1) {
      newestId = await insertVersion(client, club.layoutId, number, versionContent(number), "Founder Fishplate");
    }
    for (const session of club.sessions) {
      await insertSession(client, { id: session.id, workspaceId: club.id, layoutId: club.layoutId, name: session.name, status: session.status, ratio: 6, versionId: newestId, versionNumber: club.versions, content: newest });
    }
  }
}

// server/routes/sessions.ts
var snapshot = (c) => buildSnapshot(c.session);
var fastSeconds = (c) => fastClockSeconds(c.session.tick, c.session.ratio);
function findTrain(c) {
  const train = c.session.state.trains.find((candidate) => candidate.id === c.params.train);
  if (train === void 0) throw notFound();
  c.found.train = train;
}
var trainOf = (c) => c.found.train;
var trainRevision = (c) => trainOf(c).revision;
var controlRevision = (c) => c.session.control_revision;
function control(command, path) {
  return {
    method: "POST",
    path: `/api/workspaces/:workspace/sessions/:session/${path}`,
    access: RUNNERS,
    load: "session",
    revision: controlRevision,
    live: true,
    async handle(c) {
      const from = c.session.status;
      const next = transitionOrRefuse(c.session, command);
      await changeStatus(txOf(c), c.session, next, { cause: command, from, to: next.status });
      return json(200, snapshot(c));
    }
  };
}
var sessionRoutes = [
  {
    method: "GET",
    path: "/api/workspaces/:workspace/sessions",
    access: EVERYONE,
    async handle(c) {
      return json(200, { sessions: await listSessions(c.client, c.workspaceId) });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/sessions",
    access: RUNNERS,
    load: "workspace",
    async handle(c) {
      const name = textField(c.body, "name", "a session name");
      const ratio = c.body.ratio === void 0 ? 6 : c.body.ratio;
      if (!Number.isInteger(ratio) || ratio < 1 || ratio > 12) throw invalidFields({ ratio: "Enter a whole number from 1 to 12." });
      const version = typeof c.body.layout_version_id === "string" ? await one(
        txOf(c).client,
        `select v.id, v.layout_id, v.number, v.state, v.content from layout_versions v join layouts l on l.id = v.layout_id where v.id = $1 and l.workspace_id = $2`,
        [c.body.layout_version_id, c.workspaceId]
      ) : void 0;
      if (version === void 0) throw invalidFields({ layout_version_id: "Choose a Published version." });
      if (version.state !== "Published") throw rule("version_not_published", "Only a Published version can run a session.");
      const id = newId("ses");
      await insertSession(txOf(c).client, {
        id,
        workspaceId: c.workspaceId,
        layoutId: version.layout_id,
        name,
        status: "Scheduled",
        ratio,
        versionId: version.id,
        versionNumber: version.number,
        content: version.content
      });
      c.session = await loadSession(txOf(c).client, id, false);
      return json(201, snapshot(c));
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/sessions/:session",
    access: EVERYONE,
    load: "session",
    handle: async (c) => json(200, snapshot(c))
  },
  control("start", "start"),
  control("hold", "hold"),
  control("resume", "resume"),
  control("end", "end"),
  {
    method: "POST",
    path: "/api/workspaces/:workspace/sessions/:session/trains",
    access: RUNNERS,
    load: "session",
    revision: (c) => c.session.session_version,
    live: true,
    async handle(c) {
      requireCanAddTrain(c.session.status);
      const train = addExtraTrain(c.session.state, parseExtraTrain(c.body, c.session.state));
      c.session.session_version += 1;
      const superseded = await supersedeReady(txOf(c).client, c.session.id);
      await saveSession(txOf(c), c.session, { type: "session.version", detail: { train_id: train.id, number: train.number, superseded_packet_ids: superseded } });
      return json(201, snapshot(c));
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/sessions/:session/trains/:train/route-preview",
    access: RUNNERS,
    load: "session",
    key: false,
    resolve: findTrain,
    async handle(c) {
      const destination = c.body.destination_block_id;
      const via = c.body.via_block_id;
      const known = (id) => typeof id === "string" && c.session.state.blocks.some((block) => block.id === id);
      if (!known(destination)) throw invalidFields({ destination_block_id: "Choose a destination block." });
      if (via !== void 0 && via !== null && via !== "" && !known(via)) throw invalidFields({ via_block_id: "Choose a block on this layout." });
      return json(200, previewRoute(c.session.state, trainOf(c), destination, via === void 0 || via === null || via === "" ? null : via));
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/sessions/:session/blocks",
    access: EVERYONE,
    load: "session",
    handle: async (c) => json(200, { blocks: searchBlocks(c.session.state.blocks, c.query.get("q")) })
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/sessions/:session/trains/:train/authorities",
    access: RUNNERS,
    load: "session",
    resolve: findTrain,
    revision: trainRevision,
    live: true,
    async handle(c) {
      requireActive(c.session.status);
      const train = trainOf(c);
      const outcome = highball(c.session.state, train, parseHighball(c.body, c.session.state), fastSeconds(c));
      if (outcome.granted) {
        await saveSession(txOf(c), c.session, { type: "authority.granted", detail: { authority: outcome.authority, train_number: train.number } });
        return json(201, { authority: outcome.authority, session: snapshot(c) });
      }
      await saveSession(txOf(c), c.session, { type: "authority.refused", detail: { authority: outcome.authority, conflict: outcome.conflict, train_number: train.number } });
      const refusal = routeConflict(outcome.message, {
        authority: outcome.authority,
        conflict: outcome.conflict,
        reachable_block_ids: outcome.reachable_block_ids
      });
      return { status: refusal.status, body: refusal.body };
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/sessions/:session/authorities/:authority/cancel",
    access: RUNNERS,
    load: "session",
    resolve(c) {
      const authority = c.session.state.authorities.find((candidate) => candidate.id === c.params.authority);
      if (authority === void 0) throw notFound();
      c.found.authority = authority;
    },
    revision: (c) => c.found.authority.revision,
    live: true,
    async handle(c) {
      requireActive(c.session.status);
      const authority = c.found.authority;
      cancelAuthority(c.session.state, authority);
      await saveSession(txOf(c), c.session, { type: "authority.released", detail: { authority_id: authority.id, ended_reason: "cancelled" } });
      return json(200, { authority, session: snapshot(c) });
    }
  },
  ...["back-to-loop", "recall"].map((command) => ({
    method: "POST",
    path: `/api/workspaces/:workspace/sessions/:session/trains/:train/${command}`,
    access: RUNNERS,
    load: "session",
    resolve: findTrain,
    revision: trainRevision,
    live: true,
    async handle(c) {
      requireActive(c.session.status);
      const moved = command === "recall" ? recall(c.session.state, trainOf(c)) : backToLoop(c.session.state, trainOf(c));
      await saveSession(txOf(c), c.session, { type: "train.moved", detail: { ...moved.detail, block_id: moved.block.id, command } });
      return json(200, snapshot(c));
    }
  })),
  {
    method: "PATCH",
    path: "/api/workspaces/:workspace/sessions/:session/conflicts/:conflict",
    access: RUNNERS,
    load: "session",
    resolve(c) {
      const conflict = c.session.state.conflicts.find((candidate) => candidate.id === c.params.conflict);
      if (conflict === void 0) throw notFound();
      c.found.conflict = conflict;
    },
    revision: (c) => c.found.conflict.revision,
    live: true,
    async handle(c) {
      const conflict = c.found.conflict;
      saveNote(conflict, c.body.note);
      await saveSession(txOf(c), c.session, { type: "conflict.changed", detail: { conflict_id: conflict.id } });
      return json(200, { conflict });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/sessions/:session/conflicts/:conflict/withdraw",
    access: RUNNERS,
    load: "session",
    resolve(c) {
      const conflict = c.session.state.conflicts.find((candidate) => candidate.id === c.params.conflict);
      if (conflict === void 0) throw notFound();
      c.found.conflict = conflict;
    },
    revision: (c) => c.found.conflict.revision,
    live: true,
    async handle(c) {
      const conflict = c.found.conflict;
      withdraw(c.session.state, conflict);
      await saveSession(txOf(c), c.session, { type: "conflict.closed", detail: { conflict_id: conflict.id } });
      return json(200, snapshot(c));
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/sessions/:session/blocks/:block/service",
    access: RUNNERS,
    load: "session",
    resolve(c) {
      if (!c.session.state.blocks.some((block) => block.id === c.params.block)) throw notFound();
    },
    revision: controlRevision,
    live: true,
    async handle(c) {
      requireActive(c.session.status);
      if (typeof c.body.out_of_service !== "boolean") throw invalidFields({ out_of_service: "Choose true or false." });
      const block = c.session.state.blocks.find((candidate) => candidate.id === c.params.block);
      setBlockService(c.session.state, block, c.body.out_of_service);
      await saveSession(txOf(c), c.session, { type: "block.changed", control: true, detail: { block_id: block.id, out_of_service: block.out_of_service } });
      return json(200, snapshot(c));
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/sessions/:session/turnouts/:turnout/throw",
    access: RUNNERS,
    load: "session",
    resolve(c) {
      if (!c.session.state.turnouts.some((turnout) => turnout.id === c.params.turnout)) throw notFound();
    },
    revision: controlRevision,
    live: true,
    async handle(c) {
      requireActive(c.session.status);
      if (c.body.position !== "normal" && c.body.position !== "reverse") throw invalidFields({ position: "Choose normal or reverse." });
      throwTurnout(c.session.state, c.params.turnout, c.body.position);
      await saveSession(txOf(c), c.session, { type: "turnout.changed", control: true, detail: { turnout_id: c.params.turnout, position: c.body.position } });
      return json(200, snapshot(c));
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/sessions/:session/events",
    access: EVERYONE,
    load: "session",
    live: true,
    handle: (c) => serveEvents(c, sessionStream(c.session.id), c.session.revision)
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/sessions/:session/packets",
    access: EVERYONE,
    load: "session",
    handle: async (c) => json(200, { packets: await listPackets(c.client, c.session.id) })
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/sessions/:session/packets/preview",
    access: EVERYONE,
    load: "session",
    async handle(c) {
      const content = packetContent(c.session.state);
      return json(200, { session_version: c.session.session_version, content, content_hash: packetHash(c.session.session_version, content) });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/sessions/:session/packets",
    access: RUNNERS,
    load: "session",
    revision: (c) => c.session.session_version,
    async handle(c) {
      const packet = await issuePacket(txOf(c), c.session.id, c.workspaceId, c.session.session_version, c.user.display_name);
      return json(202, { packet });
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/sessions/:session/packets/:packet",
    access: EVERYONE,
    load: "session",
    async handle(c) {
      const packet = await loadPacket(c.client, c.session.id, c.params.packet);
      if (packet === void 0) throw notFound();
      return json(200, packet);
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/sessions/:session/packets/:packet/pdf",
    access: EVERYONE,
    load: "session",
    async handle(c) {
      const bytes = await loadPacketBytes(c.client, c.session.id, c.params.packet);
      if (bytes === void 0) throw notFound();
      if (bytes === null) throw rule("packet_no_pdf", "This packet has no PDF.");
      return { status: 200, raw: bytes, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="crew-packet-${c.params.packet}.pdf"` } };
    }
  }
];

// server/routes/versions.ts
var COLUMNS4 = "id, number, state, label, canonical_hash, saved_by, saved_at, restored_from, revision";
var toVersion = (row) => ({ ...row, saved_at: row.saved_at.toISOString() });
async function findVersion(c) {
  const found = await one(c.client, `select ${COLUMNS4} from layout_versions where layout_id = $1 and id = $2${c.tx === null ? "" : " for update"}`, [c.layout.id, c.params.version]);
  if (found === void 0) throw notFound();
  return found;
}
async function bumpLayoutEvent(c, detail) {
  await saveLayout(txOf(c), c.layout, { type: "version.changed", actor: actorOf(c), detail });
}
async function transition(c, from, to) {
  const version = c.found.version;
  if (version.state !== from) throw rule("version_transition", `A ${version.state} version cannot do that.`);
  if (to === "Validated") {
    const content = (await one(c.client, "select content from layout_versions where id = $1", [version.id]))?.content;
    const findings = checkLayout(content, await standardsOf(c.client, c.workspaceId));
    if (findings.length > 0) throw versionRefused(findings);
  }
  const updated = await one(txOf(c).client, `update layout_versions set state = $2, revision = revision + 1 where id = $1 returning ${COLUMNS4}`, [version.id, to]);
  await bumpLayoutEvent(c, { version_id: version.id, change: to });
  return json(200, to === "Validated" ? { version: toVersion(updated), report: { passed: true, findings: [] } } : { version: toVersion(updated) });
}
var versionRoutes = [
  {
    method: "GET",
    path: "/api/workspaces/:workspace/layouts/:layout/versions",
    access: EVERYONE,
    load: "layout",
    async handle(c) {
      const found = await rows(c.client, `select ${COLUMNS4} from layout_versions where layout_id = $1 order by number`, [c.layout.id]);
      return json(200, { versions: found.map(toVersion) });
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/layouts/:layout/versions/:version",
    access: EVERYONE,
    load: "layout",
    async handle(c) {
      const row = await findVersion(c);
      const content = (await one(c.client, "select content from layout_versions where id = $1", [row.id]))?.content;
      return json(200, { ...toVersion(row), content });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/versions",
    access: BUILDERS,
    load: "layout",
    revision: (c) => c.layout.revision,
    async handle(c) {
      const label = textField(c.body, "label", "a label", 60);
      const [{ next }] = await rows(c.client, "select coalesce(max(number), 0) + 1 as next from layout_versions where layout_id = $1", [c.layout.id]);
      const saved = await one(
        txOf(c).client,
        `insert into layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by) values ($1, $2, $3, 'Draft', $4, $5, $6, $7) returning ${COLUMNS4}`,
        [newId("ver"), c.layout.id, next, label, workingHash(c.layout.content), JSON.stringify(c.layout.content), c.user.display_name]
      );
      await bumpLayoutEvent(c, { version_id: saved.id, change: "saved" });
      return json(201, { version: toVersion(saved), layout_revision: c.layout.revision });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/versions/:version/validate",
    access: BUILDERS,
    load: "layout",
    async resolve(c) {
      c.found.version = await findVersion(c);
    },
    revision: (c) => c.found.version.revision,
    handle: (c) => transition(c, "Draft", "Validated")
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/versions/:version/publish",
    access: MANAGERS,
    load: "layout",
    async resolve(c) {
      c.found.version = await findVersion(c);
    },
    revision: (c) => c.found.version.revision,
    handle: (c) => transition(c, "Validated", "Published")
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/layouts/:layout/versions/:version/restore",
    access: MANAGERS,
    load: "layout",
    async resolve(c) {
      c.found.version = await findVersion(c);
    },
    revision: (c) => c.layout.revision,
    async handle(c) {
      const source = c.found.version;
      const stored = await one(c.client, "select content from layout_versions where id = $1", [source.id]);
      const [{ next }] = await rows(c.client, "select coalesce(max(number), 0) + 1 as next from layout_versions where layout_id = $1", [c.layout.id]);
      c.layout.content = stored.content;
      const revision = c.layout.revision + 1;
      c.layout.module_revisions = Object.fromEntries(c.layout.content.modules.map((module) => [module.id, revision]));
      const restored = await one(
        txOf(c).client,
        `insert into layout_versions (id, layout_id, number, state, label, canonical_hash, content, saved_by, restored_from)
         values ($1, $2, $3, 'Draft', $4, $5, $6, $7, $8) returning ${COLUMNS4}`,
        [newId("ver"), c.layout.id, next, `Restored from ${source.label}`, source.canonical_hash, JSON.stringify(c.layout.content), c.user.display_name, source.id]
      );
      await saveLayout(txOf(c), c.layout, {
        type: "version.changed",
        actor: actorOf(c),
        detail: { version_id: restored.id, change: "restored", restored_from: source.id },
        history: [{ action: "version.restored", object_id: null, from: source.label, to: String(next) }]
      });
      return json(201, { version: toVersion(restored), layout_revision: c.layout.revision, working_hash: workingHash(c.layout.content) });
    }
  }
];

// server/routes/workspaces.ts
var MEMBER_ROLES = ["manager", "member", "operator"];
var isMemberRole = (role) => MEMBER_ROLES.includes(role);
var MEMBER_SQL = `select m.user_id, u.display_name, u.email, m.role, m.revision from members m join users u on u.id = m.user_id
  where m.workspace_id = $1`;
var workspaceRoutes = [
  {
    method: "GET",
    path: "/api/workspaces",
    access: "user",
    async handle(c) {
      const found = await rows(
        db(),
        `select w.id, w.name, m.role from members m join workspaces w on w.id = m.workspace_id where m.user_id = $1 order by w.created_at, w.id`,
        [c.user.id]
      );
      return json(200, { workspaces: found });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces",
    access: "founder",
    async handle(c) {
      const name = textField(c.body, "name", "a workspace name");
      if (c.body.template !== "reference" && c.body.template !== "empty") throw invalidFields({ template: "Choose a template." });
      const made = await createFromTemplate(txOf(c), name, c.body.template, actorOf(c));
      return json(201, made);
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace",
    access: EVERYONE,
    async handle(c) {
      const [workspace] = await rows(
        c.client,
        "select id, name, standards, standards_revision from workspaces where id = $1",
        [c.workspaceId]
      );
      const [counts] = await rows(
        c.client,
        `select (select count(*) from members where workspace_id = $1)::int as members, (select count(*) from layouts where workspace_id = $1)::int as layouts,
                (select count(*) from sessions where workspace_id = $1)::int as sessions`,
        [c.workspaceId]
      );
      return json(200, { id: workspace.id, name: workspace.name, role: c.role, standards: { ...workspace.standards, revision: workspace.standards_revision }, counts });
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/members",
    access: EVERYONE,
    async handle(c) {
      const found = await rows(c.client, `${MEMBER_SQL} order by (m.role = 'founder') desc, m.created_at, m.user_id`, [c.workspaceId]);
      return json(200, { members: found });
    }
  },
  {
    method: "POST",
    path: "/api/workspaces/:workspace/members",
    access: MANAGERS,
    load: "workspace",
    async handle(c) {
      const fields = {};
      const displayName = typeof c.body.display_name === "string" ? c.body.display_name.trim() : "";
      const email = typeof c.body.email === "string" ? c.body.email.trim().toLowerCase() : "";
      const password = typeof c.body.password === "string" ? c.body.password : "";
      if (displayName === "" || displayName.length > 80) fields.display_name = "Enter a display name of up to 80 characters.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = "Enter an email address.";
      if (password.length < 8) fields.password = "Enter a password of at least 8 characters.";
      if (!isMemberRole(c.body.role)) fields.role = "Choose Manager, Member or Operator.";
      if (Object.keys(fields).length > 0) throw invalidFields(fields);
      const client = txOf(c).client;
      await client.query(
        "insert into users (id, email, display_name, password_hash) values ($1, $2, $3, $4) on conflict (email) do nothing",
        [newId("u"), email, displayName, await hashPassword(password)]
      );
      const [{ id: userId }] = await rows(client, "select id from users where email = $1", [email]);
      const added = await client.query("insert into members (workspace_id, user_id, role) values ($1, $2, $3) on conflict do nothing", [c.workspaceId, userId, c.body.role]);
      if (added.rowCount === 0) throw rule("member_exists", "That person is already a member.");
      const [member] = await rows(client, `${MEMBER_SQL} and m.user_id = $2`, [c.workspaceId, userId]);
      return json(201, { member });
    }
  },
  {
    method: "PATCH",
    path: "/api/workspaces/:workspace/members/:user",
    access: MANAGERS,
    load: "workspace",
    async resolve(c) {
      const [member] = await rows(c.client, `${MEMBER_SQL} and m.user_id = $2 for update of m`, [c.workspaceId, c.params.user]);
      if (member === void 0) throw notFound();
      c.found.member = member;
    },
    revision: (c) => c.found.member.revision,
    async handle(c) {
      const member = c.found.member;
      if (!isMemberRole(c.body.role) || member.role === "founder") throw invalidFields({ role: "Choose Manager, Member or Operator for this person." });
      const client = txOf(c).client;
      await client.query("update members set role = $3, revision = revision + 1 where workspace_id = $1 and user_id = $2", [c.workspaceId, c.params.user, c.body.role]);
      const [changed] = await rows(client, `${MEMBER_SQL} and m.user_id = $2`, [c.workspaceId, c.params.user]);
      return json(200, { member: changed });
    }
  },
  {
    method: "GET",
    path: "/api/workspaces/:workspace/standards",
    access: EVERYONE,
    async handle(c) {
      const [row] = await rows(c.client, "select standards, standards_revision from workspaces where id = $1", [c.workspaceId]);
      return json(200, { ...row.standards, revision: row.standards_revision });
    }
  },
  {
    method: "PUT",
    path: "/api/workspaces/:workspace/standards",
    access: MANAGERS,
    load: "workspace",
    async resolve(c) {
      const [row] = await rows(c.client, "select standards_revision from workspaces where id = $1", [c.workspaceId]);
      c.found.revision = row.standards_revision;
    },
    revision: (c) => c.found.revision,
    async handle(c) {
      const profile = parseStandards(c.body);
      const client = txOf(c).client;
      const [row] = await rows(
        client,
        "update workspaces set standards = $2, standards_revision = standards_revision + 1 where id = $1 returning standards_revision",
        [c.workspaceId, JSON.stringify(profile)]
      );
      const saved = { ...profile, revision: row.standards_revision };
      return json(200, saved);
    }
  }
];

// server/routes/index.ts
var all = [...authRoutes, ...workspaceRoutes, ...layoutRoutes, ...versionRoutes, ...sessionRoutes, ...opsRoutes];
var routes = compileRoutes(all);

// server/domain/session/movement.ts
var SPEED_FACTOR = 16093440;
var SPEED_DIVISOR = 3135600;
function scaleAdvance(speedMph, carry) {
  const total = speedMph * SPEED_FACTOR + carry;
  return { advance_mm: Math.floor(total / SPEED_DIVISOR), carry: total % SPEED_DIVISOR };
}
function nextBlockInRoute(train, authority) {
  const at = authority.block_ids.indexOf(train.head_block_id);
  return authority.block_ids[at + 1];
}
function moveHead(state, train, authority, advanceMm) {
  const entered = [];
  let remaining = advanceMm;
  for (; ; ) {
    const length = blockById(state, train.head_block_id).length_mm;
    const room = length - train.head_offset_mm;
    if (room >= remaining) {
      train.head_offset_mm += remaining;
      train.distance_run_mm += remaining;
      break;
    }
    const next = nextBlockInRoute(train, authority);
    train.head_offset_mm = length;
    train.distance_run_mm += room;
    if (next === void 0) break;
    remaining -= room;
    train.head_block_id = next;
    train.head_offset_mm = 0;
    train.trail_block_ids = [next, ...train.trail_block_ids];
    entered.push(next);
  }
  return entered;
}
function pruneTrail(state, train) {
  let covered = 0;
  const kept = [];
  for (const [index, blockId2] of train.trail_block_ids.entries()) {
    kept.push(blockId2);
    covered += index === 0 ? train.head_offset_mm : blockById(state, blockId2).length_mm;
    if (covered >= train.length_mm) break;
  }
  train.trail_block_ids = kept;
}

// server/domain/session/tick.ts
function giveBackBlocks(state, authority, train) {
  const occupied = new Set(occupiedBlockIds(train, state));
  const reached = authority.block_ids.indexOf(train.head_block_id);
  authority.remaining_block_ids = authority.block_ids.filter((id, index) => index > reached || occupied.has(id));
}
function releaseClearedTurnouts(state, authority) {
  for (const turnout of state.turnout_defs) {
    const locked = state.turnouts.find((candidate) => candidate.id === turnout.id)?.locked_by_authority_id === authority.id;
    const touching = [turnout.stem_block_id, turnout.normal_block_id, turnout.reverse_block_id].filter((id) => authority.block_ids.includes(id));
    if (locked && !touching.some((id) => authority.remaining_block_ids.includes(id))) unlockTurnouts(state, authority.id);
  }
}
function applyTick(state, ratio, tick) {
  const fast = fastClockSeconds(tick, ratio);
  const detail = { tick, arrivals: [], authorities_released: [], authorities_revoked: [], deadlocks_raised: [] };
  const entered = /* @__PURE__ */ new Map();
  for (const authority of grantedAuthorities(state)) {
    const train = trainById(state, authority.train_id);
    if (train === void 0) continue;
    const step = scaleAdvance(train.speed_mph, train.carry);
    train.carry = step.carry;
    entered.set(train.id, moveHead(state, train, authority, step.advance_mm));
    pruneTrail(state, train);
    giveBackBlocks(state, authority, train);
    releaseClearedTurnouts(state, authority);
  }
  for (const [trainId, blocks] of entered) {
    const train = trainById(state, trainId);
    if (train === void 0) continue;
    for (const entry of state.timetable.filter((candidate) => candidate.train_id === trainId)) {
      const station = state.stations.find((candidate) => candidate.id === entry.station_id);
      const progress = state.timetable_progress.find((candidate) => candidate.entry_id === entry.id);
      if (station === void 0 || progress === void 0 || progress.arrived_fast_seconds !== null) continue;
      if (blocks.some((blockId2) => station.block_ids.includes(blockId2))) {
        progress.arrived_fast_seconds = fast;
        detail.arrivals.push({ entry_id: entry.id, train_number: train.number, arrived_fast_seconds: fast });
      }
    }
  }
  for (const authority of grantedAuthorities(state)) {
    const train = trainById(state, authority.train_id);
    if (train !== void 0 && train.head_block_id === authority.limit_block_id && train.head_offset_mm === blockById(state, authority.limit_block_id).length_mm) {
      endAuthority(state, authority, "Released", "completed");
      detail.authorities_released.push({ id: authority.id, train_number: train.number, ended_reason: "completed" });
    }
  }
  for (const authority of grantedAuthorities(state)) {
    if (fast >= authority.expires_fast_seconds) {
      endAuthority(state, authority, "Revoked", "expired");
      detail.authorities_revoked.push({ id: authority.id, train_number: trainById(state, authority.train_id)?.number ?? "", ended_reason: "expired" });
    }
  }
  detail.deadlocks_raised = raiseDeadlocks(state, tick).map((deadlock) => ({ id: deadlock.id, train_numbers: deadlock.train_numbers }));
  return detail;
}

// server/services/engine.ts
var STEP_MS = 100;
var TICK_MS = 1e3;
var MIN_GAP_MS = 900;
var INTERRUPT_AFTER_MS = 5e3;
var Engine = class {
  constructor(valkey, outbox) {
    this.valkey = valkey;
    this.outbox = outbox;
    valkey.onChange((up) => {
      if (up) this.recovered = true;
    });
  }
  leases = /* @__PURE__ */ new Set();
  stepping = false;
  recovered = false;
  start() {
    setInterval(() => void this.step(), STEP_MS);
  }
  async step() {
    if (this.stepping || !this.valkey.settled) return;
    this.stepping = true;
    try {
      if (!this.valkey.up) {
        this.leases.clear();
        await this.changeAll("Running", null, "valkey_down");
        return;
      }
      if (this.recovered) {
        this.recovered = false;
        this.outbox.kick();
        await this.changeAll("Held", "valkey", "valkey_up");
      }
      const running = await rows(
        db(),
        `select id, coalesce(extract(epoch from (clock_timestamp() - last_tick_at)) * 1000, 0) as since_ms from sessions where status = 'Running'`
      );
      const ids = new Set(running.map((session) => session.id));
      for (const held of [...this.leases]) if (!ids.has(held)) this.leases.delete(held);
      await Promise.all(running.map((session) => this.advance(session).catch(() => void 0)));
    } finally {
      this.stepping = false;
    }
  }
  async advance(session) {
    if (this.leases.has(session.id) && session.since_ms < TICK_MS - STEP_MS) return;
    if (session.since_ms > INTERRUPT_AFTER_MS && await this.valkey.leaseHolder(session.id) === null) {
      await this.change(session.id, "lease_lost");
      return;
    }
    if (!await this.valkey.holdLease(session.id)) {
      this.leases.delete(session.id);
      return;
    }
    this.leases.add(session.id);
    if (session.since_ms >= TICK_MS) await this.commitTick(session.id);
  }
  async commitTick(sessionId) {
    await transaction(async (tx) => {
      const row = await loadSession(tx.client, sessionId, true);
      if (row === void 0 || row.status !== "Running" || row.last_tick_at === null) return;
      const since = await one(tx.client, "select extract(epoch from (clock_timestamp() - $1::timestamptz)) * 1000 as ms", [row.last_tick_at]);
      if (since === void 0 || since.ms < MIN_GAP_MS) return;
      row.tick += 1;
      const detail = applyTick(row.state, row.ratio, row.tick);
      row.last_tick_at = since.ms < 2 * TICK_MS ? new Date(row.last_tick_at.getTime() + TICK_MS) : /* @__PURE__ */ new Date();
      await saveSession(tx, row, { type: "tick.committed", detail });
    });
  }
  // Automatic changes: a Valkey outage holds sessions, its return resumes them, a lost lease interrupts.
  async change(sessionId, cause) {
    await transaction(async (tx) => {
      const row = await loadSession(tx.client, sessionId, true);
      if (row === void 0) return;
      if (cause === "lease_lost") {
        const gap = await one(tx.client, "select coalesce(extract(epoch from (clock_timestamp() - $1::timestamptz)) * 1000, 0) as ms", [row.last_tick_at]);
        if ((gap?.ms ?? 0) <= INTERRUPT_AFTER_MS) return;
      }
      const next = nextStatus(row, cause);
      if (next === null) return;
      await changeStatus(tx, row, next, { cause, from: row.status, to: next.status });
    });
  }
  async changeAll(status, reason, cause) {
    const found = await rows(
      db(),
      `select id from sessions where status = $1 and ($2::text is null or hold_reason = $2)`,
      [status, reason]
    );
    for (const session of found) await this.change(session.id, cause).catch(() => void 0);
  }
};

// server/services/gotenberg.ts
import { request } from "node:http";
var RENDER_TIMEOUT_MS = 2e4;
var PROBE_TIMEOUT_MS = 2e3;
var PROBE_MS = 5e3;
function exchange(url, timeoutMs, form) {
  return new Promise((resolve, reject) => {
    const headers = form === void 0 ? {} : { "content-type": form.contentType, "content-length": form.body.length };
    const outgoing = request(url, { method: form === void 0 ? "GET" : "POST", headers, agent: false, signal: AbortSignal.timeout(timeoutMs) }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const status = incoming.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, bytes: Buffer.concat(chunks) });
      });
    });
    outgoing.on("error", reject);
    outgoing.end(form?.body);
  });
}
var Gotenberg = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  up = false;
  watch() {
    const probe = async () => {
      try {
        this.up = (await exchange(`${this.baseUrl}/health`, PROBE_TIMEOUT_MS)).ok;
      } catch {
        this.up = false;
      }
      setTimeout(() => void probe(), PROBE_MS);
    };
    void probe();
  }
  async render(html, footerHtml) {
    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    form.append("files", new Blob([footerHtml], { type: "text/html" }), "footer.html");
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.7");
    form.append("marginTop", "0.6");
    form.append("marginBottom", "0.8");
    const encoded = new Response(form);
    try {
      const answer = await exchange(`${this.baseUrl}/forms/chromium/convert/html`, RENDER_TIMEOUT_MS, {
        contentType: encoded.headers.get("content-type"),
        body: Buffer.from(await encoded.arrayBuffer())
      });
      if (!answer.ok) throw new Error("Gotenberg refused the render");
      if (answer.bytes.length === 0) throw new Error("Gotenberg returned no bytes");
      this.up = true;
      return answer.bytes;
    } catch (error) {
      this.up = false;
      throw error;
    }
  }
};

// server/services/streams.ts
var REPLAY_BATCH = 500;
var HEARTBEAT_MS = 1e4;
function message(seq, type, payload) {
  return `id: ${seq}
event: ${type}
data: ${payload}

`;
}
var StreamHub = class {
  constructor(valkey) {
    this.valkey = valkey;
    valkey.onChange((up) => {
      if (!up) this.closeAll();
    });
  }
  subscribers = /* @__PURE__ */ new Map();
  cursors = /* @__PURE__ */ new Map();
  running = false;
  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
    setInterval(() => {
      for (const set of this.subscribers.values()) for (const subscriber of set) subscriber.res.write(": keep-alive\n\n");
    }, HEARTBEAT_MS);
  }
  closeAll() {
    for (const set of this.subscribers.values()) for (const subscriber of set) subscriber.res.end();
    this.subscribers.clear();
    this.cursors.clear();
  }
  async loop() {
    for (; ; ) {
      if (this.cursors.size === 0 || !this.valkey.up) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      try {
        for (const { stream, entries } of await this.valkey.read(this.cursors)) {
          for (const entry of entries) {
            this.cursors.set(stream, Math.max(this.cursors.get(stream) ?? 0, entry.seq));
            for (const subscriber of this.subscribers.get(stream) ?? []) this.deliver(subscriber, entry);
          }
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  deliver(subscriber, entry) {
    if (subscriber.buffer !== null) {
      subscriber.buffer.push(entry);
      return;
    }
    if (entry.seq <= subscriber.lastSent) return;
    subscriber.lastSent = entry.seq;
    subscriber.res.write(message(entry.seq, entry.type, entry.payload));
  }
  // Replays what the browser missed (or sends one resync when it has aged out), then carries on live.
  async subscribe(stream, res, lastEventId, committedSeq) {
    const subscriber = { res, lastSent: lastEventId ?? committedSeq, buffer: [] };
    const set = this.subscribers.get(stream) ?? /* @__PURE__ */ new Set();
    this.subscribers.set(stream, set);
    set.add(subscriber);
    res.on("close", () => {
      set.delete(subscriber);
      if (set.size === 0) {
        this.subscribers.delete(stream);
        this.cursors.delete(stream);
      }
    });
    if (!this.cursors.has(stream)) this.cursors.set(stream, await this.valkey.newest(stream));
    if (lastEventId !== null) {
      const oldest = await this.valkey.oldest(stream);
      const newest = await this.valkey.newest(stream);
      if (newest > lastEventId && (oldest === null || oldest > lastEventId + 1)) {
        res.write(`event: resync
data: ${JSON.stringify({ reason: "replay_aged_out" })}

`);
        subscriber.lastSent = newest;
      } else {
        for (let from = lastEventId; ; ) {
          const batch = await this.valkey.after(stream, from, REPLAY_BATCH);
          for (const entry of batch) {
            from = entry.seq;
            subscriber.lastSent = entry.seq;
            res.write(message(entry.seq, entry.type, entry.payload));
          }
          if (batch.length < REPLAY_BATCH) break;
        }
      }
    }
    const held = subscriber.buffer ?? [];
    subscriber.buffer = null;
    for (const entry of held) this.deliver(subscriber, entry);
  }
};

// server/instance.ts
function send(res, reply) {
  if ("streamed" in reply) return;
  if ("raw" in reply) {
    res.writeHead(reply.status, reply.headers);
    res.end(reply.raw);
    return;
  }
  const body = JSON.stringify(reply.body);
  res.writeHead(reply.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...reply.headers });
  res.end(body);
}
function sendError(res, error) {
  if (!(error instanceof ApiError)) console.error(error);
  const failure = error instanceof ApiError ? error : serverError();
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(failure.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(failure.body));
}
async function waitForDatabase() {
  for (; ; ) {
    try {
      await db().query("select 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
async function startInstance() {
  const config = instanceConfig();
  openPool(config.databaseUrl);
  await waitForDatabase();
  await applySchemaAndSeed(seedDatabase);
  const valkey = new Valkey(config.valkeyUrl, config.instanceId);
  const gotenberg = new Gotenberg(config.gotenbergUrl);
  const outbox = new Outbox(valkey);
  const hub = new StreamHub(valkey);
  const engine = new Engine(valkey, outbox);
  let peers = [];
  const services = {
    instanceId: config.instanceId,
    internalToken: config.internalToken,
    valkey,
    outbox,
    hub,
    engine,
    gotenberg,
    peers: () => peers,
    stop: (restartAfterMs) => {
      process.send?.({ type: "stop", restart_after_ms: restartAfterMs }, () => process.kill(process.pid, "SIGKILL"));
    }
  };
  process.on("message", (message2) => {
    if (message2.type === "peers" && message2.peers !== void 0) peers = message2.peers;
  });
  valkey.watch();
  gotenberg.watch();
  outbox.start();
  hub.start();
  engine.start();
  new PacketWorker(gotenberg, valkey).start();
  const server = createServer((req, res) => {
    void handle(req, res, services);
  });
  server.keepAliveTimeout = 65e3;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  process.send?.({ type: "ready", port: typeof address === "object" && address !== null ? address.port : 0 });
}
async function handle(req, res, services) {
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (path.startsWith("/internal/")) {
      await internal(path, req, res, services);
      return;
    }
    const matched = matchRoute(routes, req.method ?? "GET", path);
    if (matched !== void 0) {
      send(res, await runRoute(matched.route, matched.params, req, res, services));
      return;
    }
    if (path.startsWith("/api/")) throw notFound();
    if (req.method === "GET" && await serveStatic(path, res)) return;
    throw notFound();
  } catch (error) {
    sendError(res, error);
  }
}
async function internal(path, req, res, services) {
  if (req.headers["x-gandyboard-internal"] !== services.internalToken) throw notFound();
  if (path === "/internal/leases") {
    send(res, { status: 200, body: { leases: [...services.engine.leases] } });
    return;
  }
  if (path === "/internal/valkey") {
    send(res, { status: 200, body: { up: services.valkey.up } });
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  send(res, { status: 202, body: {} });
  res.on("finish", () => services.stop(body.restart_after_ms ?? 0));
}

// server/supervisor.ts
import { fork } from "node:child_process";
import { randomBytes as randomBytes3 } from "node:crypto";
import { createServer as createServer2, request as request2, Agent } from "node:http";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var INSTANCE_IDS = ["a", "b"];
var RESTART_DELAY_MS = 400;
var KEEP_ALIVE_MS = 65e3;
function startSupervisor() {
  const token = randomBytes3(24).toString("hex");
  const slots = INSTANCE_IDS.map((id) => ({ id, child: null, port: null, restartAfterMs: RESTART_DELAY_MS }));
  const agent = new Agent({ keepAlive: true, maxSockets: 256 });
  let turn2 = 0;
  const peers = () => slots.map((slot) => ({ id: slot.id, up: slot.port !== null, port: slot.port }));
  const broadcast = () => {
    for (const slot of slots) {
      if (slot.port !== null && slot.child?.connected) slot.child.send({ type: "peers", peers: peers() }, () => void 0);
    }
  };
  const launch = (slot) => {
    const child = fork(fileURLToPath2(import.meta.url), [], {
      env: { ...process.env, GANDYBOARD_ROLE: "instance", GANDYBOARD_INSTANCE: slot.id, GANDYBOARD_INTERNAL_TOKEN: token },
      stdio: ["ignore", "inherit", "inherit", "ipc"]
    });
    slot.child = child;
    child.on("message", (message2) => {
      if (message2.type === "ready") {
        slot.port = message2.port ?? null;
        broadcast();
      } else if (message2.type === "stop") {
        slot.restartAfterMs = message2.restart_after_ms ?? RESTART_DELAY_MS;
      }
    });
    child.on("exit", () => {
      slot.port = null;
      slot.child = null;
      broadcast();
      const delay2 = slot.restartAfterMs;
      slot.restartAfterMs = RESTART_DELAY_MS;
      setTimeout(() => launch(slot), delay2);
    });
  };
  slots.forEach(launch);
  const refuse2 = (res) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const failure = instancesRestarting();
    res.writeHead(failure.status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(failure.body));
  };
  const forward = (req, res) => {
    const named = req.headers["x-gandyboard-route"];
    const live = slots.filter((slot) => slot.port !== null);
    const target = typeof named === "string" ? live.find((slot) => slot.id === named) : live[turn2++ % Math.max(live.length, 1)];
    if (target === void 0 || (req.url ?? "").startsWith("/internal")) return refuse2(res);
    const upstream = request2({ host: "127.0.0.1", port: target.port, method: req.method, path: req.url, headers: req.headers, agent }, (answer) => {
      const { connection: _connection, "keep-alive": _keepAlive, ...headers } = answer.headers;
      res.writeHead(answer.statusCode ?? 502, { ...headers, "x-gandyboard-instance": target.id });
      answer.pipe(res);
      answer.on("close", () => {
        if (!answer.complete) res.destroy();
      });
    });
    upstream.on("error", () => refuse2(res));
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  };
  const server = createServer2(forward);
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 5e3;
  server.listen(publicPort, "0.0.0.0");
}

// server/main.ts
if (process.env.GANDYBOARD_ROLE === "instance") {
  startInstance().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  startSupervisor();
}
