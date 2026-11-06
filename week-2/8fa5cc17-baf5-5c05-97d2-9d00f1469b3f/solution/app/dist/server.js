// src/server/main.ts
import { createServer } from "node:http";

// src/server/config.ts
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
function seconds(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
var config = {
  databaseUrl: required("DATABASE_URL"),
  s3: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE").toLowerCase() !== "false",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY")
  },
  port: Number(process.env.APP_PUBLIC_PORT) || 4173,
  lockoutWindowSeconds: seconds("QUIRE_LOCKOUT_WINDOW_SECONDS", 900),
  sessionIdleSeconds: seconds("QUIRE_SESSION_IDLE_SECONDS", 1209600)
};

// src/server/app.ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/server/errors.ts
var HttpError = class extends Error {
  status;
  body;
  headers;
  constructor(status2, body, headers = {}) {
    super(typeof body === "object" && body && !Array.isArray(body) ? String(body.error ?? body.status) : "error");
    this.status = status2;
    this.body = body;
    this.headers = headers;
  }
};
function apiError(status2, code, extra = {}, headers = {}) {
  return new HttpError(status2, { error: code, ...extra }, headers);
}
var validation = (errors) => apiError(422, "validation", { errors });
var notFound = () => apiError(404, "not_found");
var statusBody = (status2, value) => new HttpError(status2, { status: value });
var FieldErrors = class {
  errors = {};
  add(field, message) {
    if (!(field in this.errors)) this.errors[field] = message;
  }
  get any() {
    return Object.keys(this.errors).length > 0;
  }
  throwIfAny() {
    if (this.any) throw validation(this.errors);
  }
};

// src/server/http.ts
var JSON_LIMIT = 1e6;
var UPLOAD_REQUEST_LIMIT = 101e5;
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var isUuid = (value) => typeof value === "string" && UUID.test(value);
function header(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
function mediaType(req) {
  return (header(req, "content-type") ?? "").split(";")[0].trim().toLowerCase();
}
async function readBody(raw, limit) {
  const declared = Number(header(raw, "content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    raw.resume();
    throw apiError(413, "too_large");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of raw) {
    size += chunk.length;
    if (size > limit) {
      raw.resume();
      throw apiError(413, "too_large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function acceptBody(raw, kind) {
  const limit = kind === "multipart" ? UPLOAD_REQUEST_LIMIT : JSON_LIMIT;
  const rawBody = await readBody(raw, limit);
  const type = mediaType(raw);
  if (kind === "multipart") {
    if (type !== "multipart/form-data") throw apiError(415, "unsupported_media_type");
    return { rawBody, body: null };
  }
  const hasBody = rawBody.length > 0 || type !== "";
  if (!hasBody) return { rawBody, body: kind === "json" ? void 0 : null };
  if (type !== "application/json") throw apiError(415, "unsupported_media_type");
  if (rawBody.length === 0) return { rawBody, body: void 0 };
  try {
    return { rawBody, body: JSON.parse(rawBody.toString("utf8")) };
  } catch {
    return { rawBody, body: null };
  }
}
function send(res, reply) {
  const headers = { ...reply.headers };
  let payload;
  if (reply.bytes) payload = reply.bytes;
  else if (reply.rawJson !== void 0) payload = reply.rawJson;
  else if (reply.body !== void 0) payload = JSON.stringify(reply.body);
  if (payload !== void 0 && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (payload !== void 0) headers["Content-Length"] = String(Buffer.byteLength(payload));
  res.writeHead(reply.status, headers);
  res.end(payload);
}
function errorReply(error) {
  return { status: error.status, body: error.body, headers: error.headers };
}
function route(method, path2, body, handler, options = {}) {
  const keys = [];
  const pattern = new RegExp(
    "^" + path2.replace(/:(\w+)/g, (_, key) => {
      keys.push(key);
      return "([^/]+)";
    }) + "$"
  );
  return { method, pattern, keys, body, handler, ...options };
}
function match(routes2, method, path2) {
  let pathMatched = false;
  for (const r of routes2) {
    const m = r.pattern.exec(path2);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method && !(method === "HEAD" && r.method === "GET")) continue;
    const params = {};
    r.keys.forEach((key, i) => params[key] = decodeURIComponent(m[i + 1]));
    return { route: r, params, unknownResource: Object.values(params).some((v) => !isUuid(v)) };
  }
  return pathMatched ? "method" : null;
}
var ok = (body, status2 = 200) => ({ status: status2, body });
var noContent = () => ({ status: 204 });
function objectBody(req) {
  const b = req.body;
  return b !== null && typeof b === "object" && !Array.isArray(b) ? b : {};
}

// src/server/db.ts
import pg from "pg";
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v);
var pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", () => void 0);
var db = {
  async query(sql, params = []) {
    return (await pool.query(sql, params)).rows;
  }
};
async function transaction(fn) {
  const client = await pool.connect();
  const after = [];
  const tx = {
    async query(sql, params = []) {
      return (await client.query(sql, params)).rows;
    },
    afterCommit(cb) {
      after.push(cb);
    }
  };
  let result;
  try {
    await client.query("BEGIN");
    result = await fn(tx);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => void 0);
    client.release();
    throw error;
  }
  client.release();
  for (const cb of after) await Promise.resolve().then(cb).catch(() => void 0);
  return result;
}
async function one(q, sql, params = []) {
  return (await q.query(sql, params))[0];
}

// src/server/idempotency.ts
var KEY = /^[\x21-\x7e]{1,100}$/;
var KEEP_HOURS = 48;
function idempotencyKey(req) {
  const raw = req.raw.headers["idempotency-key"];
  if (raw === void 0) return null;
  const value = Array.isArray(raw) ? raw.join(",") : raw;
  if (!KEY.test(value)) throw validation({ idempotency_key: "Use 1 to 100 visible characters." });
  return value;
}
function canonical(body) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  };
  const value = body !== null && typeof body === "object" && !Array.isArray(body) ? { after_block_id: null, ...body } : body;
  return JSON.stringify(sort(value) ?? null);
}
async function withIdempotency(req, key, work) {
  const endpoint = `${req.method} ${req.path}`;
  const request = canonical(req.body);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
    try {
      const { rows } = await client.query(
        `SELECT endpoint, request::text AS request, status, response FROM idempotency_records
          WHERE key = $1 AND created_at > now() - make_interval(hours => $2)`,
        [key, KEEP_HOURS]
      );
      const seen = rows[0];
      if (seen) {
        if (seen.endpoint !== endpoint || canonical(JSON.parse(seen.request)) !== request) throw apiError(409, "idempotency_conflict");
        return { status: seen.status, rawJson: seen.response, headers: { "Idempotent-Replay": "true" } };
      }
      let reply;
      try {
        reply = await work();
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        reply = errorReply(error);
      }
      if (reply.status < 500) {
        await client.query(
          `INSERT INTO idempotency_records (endpoint, key, request, status, response, created_at) VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (key) DO UPDATE SET endpoint = EXCLUDED.endpoint, request = EXCLUDED.request, status = EXCLUDED.status, response = EXCLUDED.response, created_at = now()`,
          [endpoint, key, request, reply.status, JSON.stringify(reply.body ?? null)]
        );
      }
      return reply;
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    }
  } finally {
    client.release();
  }
}
function sweepIdempotency() {
  setInterval(() => {
    pool.query("DELETE FROM idempotency_records WHERE created_at < now() - make_interval(hours => $1)", [KEEP_HOURS]).catch(() => void 0);
  }, 36e5).unref();
}

// src/server/events.ts
var KEEP_ALIVE_MS = 15e3;
var KEEP_EVENTS_MS = 60 * 6e4;
var SESSION_END_CLOSE_MS = 1e3;
var channels = /* @__PURE__ */ new Set();
var broadcastThrough = 0;
var pumping = Promise.resolve();
var listeners = /* @__PURE__ */ new Set();
async function emit(tx, event, data) {
  const [{ last_id: id }] = await tx.query("UPDATE sync_sequence SET last_id = last_id + 1 WHERE id = 1 RETURNING last_id");
  await tx.query("INSERT INTO sync_events (id, event, data, created_at) VALUES ($1, $2, $3, now())", [id, event, JSON.stringify(data)]);
  tx.afterCommit(pump);
}
function onEvent(fn) {
  listeners.add(fn);
}
function frame(event, data, id) {
  return `${id === void 0 ? "" : `id: ${id}
`}event: ${event}
data: ${JSON.stringify(data)}

`;
}
function pump() {
  pumping = pumping.then(async () => {
    const rows = await db.query(
      "SELECT id, event, data FROM sync_events WHERE id > $1 ORDER BY id",
      [broadcastThrough]
    );
    for (const row of rows) {
      broadcastThrough = row.id;
      const text = frame(row.event, row.data, row.id);
      for (const ch of channels) ch.res.write(text);
      for (const fn of listeners) fn(row.event, row.data);
    }
  }).catch(() => void 0);
  return pumping;
}
function broadcastUnnumbered(event, data) {
  const text = frame(event, data);
  for (const ch of channels) ch.res.write(text);
}
async function initEvents() {
  const [row] = await db.query("SELECT last_id FROM sync_sequence WHERE id = 1");
  broadcastThrough = row.last_id;
  setInterval(() => {
    db.query("DELETE FROM sync_events WHERE created_at < now() - make_interval(secs => $1)", [KEEP_EVENTS_MS / 1e3]).catch(() => void 0);
  }, 6e4).unref();
}
async function openChannel(res, sessionId, lastEventId, onClose) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 2000\n\n");
  const channel = { sessionId, res, onClose };
  pumping = pumping.then(async () => {
    if (lastEventId !== void 0) {
      const n = /^\d+$/.test(lastEventId.trim()) ? Number(lastEventId.trim()) : NaN;
      const [bounds] = await db.query("SELECT min(id) AS oldest FROM sync_events");
      const latest = broadcastThrough;
      const reachable = Number.isSafeInteger(n) && n <= latest && (n === latest || bounds.oldest !== null && n >= bounds.oldest - 1);
      if (!reachable) {
        res.write(frame("sync.reset", {}, latest));
      } else {
        const missed = await db.query(
          "SELECT id, event, data FROM sync_events WHERE id > $1 AND id <= $2 ORDER BY id",
          [n, latest]
        );
        for (const row of missed) res.write(frame(row.event, row.data, row.id));
      }
    }
    channels.add(channel);
  }).catch(() => void 0);
  await pumping;
  const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), KEEP_ALIVE_MS);
  res.on("close", () => {
    clearInterval(keepAlive);
    channels.delete(channel);
    channel.onClose();
  });
}
function rotateChannels(oldId, newId) {
  for (const ch of channels) if (ch.sessionId === oldId) ch.sessionId = newId;
}
function endSessionChannels(sessionId) {
  for (const ch of channels) {
    if (ch.sessionId !== sessionId) continue;
    ch.res.write(frame("session.ended", {}));
    setTimeout(() => ch.res.end(), SESSION_END_CLOSE_MS).unref();
  }
}

// src/server/lockout.ts
var EMAIL_FAILURES = 5;
var ADDRESS_FAILURES = 50;
var windowSeconds = () => config.lockoutWindowSeconds;
async function lockedFor(tx, identities) {
  let longest = 0;
  for (const id of identities) {
    const [row] = await tx.query(
      `SELECT extract(epoch FROM locked_until - now())::float8 AS left FROM sign_in_locks
        WHERE identity_kind = $1 AND identity = $2 AND locked_until > now()`,
      [id.kind, id.value]
    );
    if (row) longest = Math.max(longest, row.left);
  }
  return longest;
}
async function recordFailure(tx, identities) {
  for (const id of identities) {
    await tx.query("INSERT INTO sign_in_failures (identity_kind, identity, failed_at) VALUES ($1, $2, now())", [id.kind, id.value]);
    const [{ count }] = await tx.query(
      `SELECT count(*)::int AS count FROM sign_in_failures
        WHERE identity_kind = $1 AND identity = $2 AND failed_at > now() - make_interval(secs => $3)`,
      [id.kind, id.value, windowSeconds()]
    );
    if (count >= id.threshold) {
      await tx.query(
        `INSERT INTO sign_in_locks (identity_kind, identity, locked_until) VALUES ($1, $2, now() + make_interval(secs => $3))
         ON CONFLICT (identity_kind, identity) DO UPDATE SET locked_until = EXCLUDED.locked_until`,
        [id.kind, id.value, windowSeconds()]
      );
      await tx.query("DELETE FROM sign_in_failures WHERE identity_kind = $1 AND identity = $2", [id.kind, id.value]);
    }
  }
  return lockedFor(tx, identities);
}
async function clearFailures(tx, identity) {
  await tx.query("DELETE FROM sign_in_failures WHERE identity_kind = $1 AND identity = $2", [identity.kind, identity.value]);
}
var retryAfter = (seconds2) => String(Math.max(1, Math.ceil(seconds2)));

// src/server/model.ts
var iso = (d) => (d instanceof Date ? d : new Date(String(d))).toISOString();
var BACKLINKS_SQL = (objectColumn) => `(SELECT count(*)::int FROM link_edges le WHERE le.to_object_id = ${objectColumn})`;
async function backlinkCount(q, objectId) {
  const [row] = await q.query(`SELECT ${BACKLINKS_SQL("$1::uuid")} AS n`, [objectId]);
  return row.n;
}
var LIBRARY_ORDER = "ORDER BY t.builtin_rank NULLS LAST, t.created_at, t.id";
async function loadTypes(q) {
  const types = await q.query(
    `SELECT t.id, t.name, t.builtin_rank IS NOT NULL AS builtin FROM object_types t ${LIBRARY_ORDER}`
  );
  const fields = await q.query(
    "SELECT type_id, name, kind, required, options, target_type_id FROM fields ORDER BY position"
  );
  return types.map((t) => ({ ...t, fields: fields.filter((f) => f.type_id === t.id).map(({ type_id: _t, ...f }) => f) }));
}
function typeJson(t) {
  return {
    id: t.id,
    name: t.name,
    builtin: t.builtin,
    fields: t.fields.map((f) => ({ name: f.name, kind: f.kind, required: f.required, options: f.options, target_type_id: f.target_type_id }))
  };
}
var OBJECT_SELECT = `
  SELECT o.id, o.type_id, t.name AS type_name, o.title, o.daily_date, o.properties, o.share_visibility,
         COALESCE((SELECT array_agg(cm.collection_id::text ORDER BY cm.collection_id) FROM collection_members cm WHERE cm.object_id = o.id), '{}') AS collection_ids,
         ${BACKLINKS_SQL("o.id")} AS backlinks, o.created_at, o.updated_at
    FROM objects o JOIN object_types t ON t.id = o.type_id`;
function objectJson(o, fields, blocks) {
  const properties = {};
  for (const f of fields) properties[f.name] = o.properties[f.name] ?? null;
  return {
    id: o.id,
    type_id: o.type_id,
    type_name: o.type_name,
    title: o.title,
    daily_date: o.daily_date,
    properties,
    share_visibility: o.share_visibility,
    collection_ids: o.collection_ids,
    backlinks: o.backlinks,
    created_at: iso(o.created_at),
    updated_at: iso(o.updated_at),
    ...blocks ? { blocks } : {}
  };
}
async function fieldsOf(q, typeId) {
  return q.query("SELECT name, kind, required, options, target_type_id FROM fields WHERE type_id = $1 ORDER BY position", [typeId]);
}
async function loadObject(q, id) {
  return (await q.query(`${OBJECT_SELECT} WHERE o.id = $1`, [id]))[0];
}
var BLOCK_SELECT = `
  SELECT b.id, b.object_id, b.kind, b.position,
         COALESCE(ob.body, b.body) AS body, COALESCE(ob.version, b.version) AS version,
         ob.id AS origin_block_id, ob.object_id AS origin_object_id, oo.title AS origin_title,
         CASE WHEN ob.id IS NULL THEN NULL ELSE ${BACKLINKS_SQL("ob.object_id")} END AS origin_backlinks,
         a.id AS attachment_id, a.filename, a.content_type, a.size_bytes
    FROM blocks b
    LEFT JOIN blocks ob ON ob.id = b.origin_block_id
    LEFT JOIN objects oo ON oo.id = ob.object_id
    LEFT JOIN attachments a ON a.id = b.attachment_id`;
function blockJson(b) {
  return {
    id: b.id,
    object_id: b.object_id,
    kind: b.kind,
    position: b.position,
    body: b.kind === "attachment" ? null : b.body,
    version: b.kind === "attachment" ? null : b.version,
    origin: b.origin_block_id ? { block_id: b.origin_block_id, object_id: b.origin_object_id, object_title: b.origin_title, backlinks: b.origin_backlinks } : null,
    attachment: b.attachment_id ? { id: b.attachment_id, filename: b.filename, content_type: b.content_type, size_bytes: b.size_bytes } : null
  };
}
async function loadBlocks(q, objectId) {
  return q.query(`${BLOCK_SELECT} WHERE b.object_id = $1 ORDER BY b.position`, [objectId]);
}
async function loadBlock(q, id) {
  return (await q.query(`${BLOCK_SELECT} WHERE b.id = $1`, [id]))[0];
}
async function fullObject(q, id) {
  const o = await loadObject(q, id);
  if (!o) return void 0;
  return objectJson(o, await fieldsOf(q, o.type_id), (await loadBlocks(q, id)).map(blockJson));
}

// src/server/passwords.ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
var KEY_LENGTH = 64;
var COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derive(password, salt) {
  return new Promise((resolve, reject) => scrypt(password, salt, KEY_LENGTH, COST, (error, key) => error ? reject(error) : resolve(key)));
}
async function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await derive(password, salt)).toString("base64")}`;
}
async function verifyPassword(password, stored) {
  const [, salt, key] = stored.split("$");
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// src/shared/ot.ts
var MAX_OPS = 1e3;
function kindOf(op) {
  if ("insert" in op) return "insert";
  return "retain" in op ? "retain" : "delete";
}
function opLength(op) {
  if ("insert" in op) return op.insert.length;
  return "retain" in op ? op.retain : op.delete;
}
function baseLengthOf(ops) {
  let n = 0;
  for (const op of ops) if (!("insert" in op)) n += opLength(op);
  return n;
}
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function isOp(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const record = value;
  switch (keys[0]) {
    case "retain":
      return isPositiveInteger(record.retain);
    case "delete":
      return isPositiveInteger(record.delete);
    case "insert":
      return typeof record.insert === "string" && record.insert.length > 0;
    default:
      return false;
  }
}
function opsFit(value, baseLength) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_OPS) return false;
  if (!value.every(isOp)) return false;
  return baseLengthOf(value) === baseLength;
}
function pushOp(out, op) {
  if (opLength(op) === 0) return;
  const last = out[out.length - 1];
  if (last !== void 0 && kindOf(last) === kindOf(op)) {
    if ("insert" in last && "insert" in op) out[out.length - 1] = { insert: last.insert + op.insert };
    else if ("retain" in last && "retain" in op) out[out.length - 1] = { retain: last.retain + op.retain };
    else if ("delete" in last && "delete" in op) out[out.length - 1] = { delete: last.delete + op.delete };
    return;
  }
  out.push(op);
}
function cursor(ops) {
  return { ops, index: 0, offset: 0 };
}
function kindAt(c) {
  return c.index < c.ops.length ? kindOf(c.ops[c.index]) : void 0;
}
function remaining(c) {
  return c.index < c.ops.length ? opLength(c.ops[c.index]) - c.offset : 0;
}
function take(c, max) {
  const op = c.ops[c.index];
  const n = Math.min(max, opLength(op) - c.offset);
  let piece;
  if ("insert" in op) piece = { insert: op.insert.slice(c.offset, c.offset + n) };
  else if ("retain" in op) piece = { retain: n };
  else piece = { delete: n };
  c.offset += n;
  if (c.offset === opLength(op)) {
    c.index += 1;
    c.offset = 0;
  }
  return piece;
}
function sameBase() {
  throw new RangeError("The op lists were not made against texts of the same length.");
}
function footprint(ops) {
  const deletes = [];
  const inserts = [];
  let pos = 0;
  for (const op of ops) {
    if ("retain" in op) pos += op.retain;
    else if ("insert" in op) inserts.push(pos);
    else {
      const last = deletes[deletes.length - 1];
      if (last !== void 0 && last[1] === pos) last[1] = pos + op.delete;
      else deletes.push([pos, pos + op.delete]);
      pos += op.delete;
    }
  }
  return { deletes, inserts };
}
function insertInsideDelete(inserts, deletes) {
  return inserts.some((p) => deletes.some(([start, end]) => start < p && p < end));
}
function isConflict(a, b) {
  const fa = footprint(a);
  const fb = footprint(b);
  const deletesOverlap = fa.deletes.some(([s1, e1]) => fb.deletes.some(([s2, e2]) => Math.min(e1, e2) - Math.max(s1, s2) > 0));
  return deletesOverlap || insertInsideDelete(fa.inserts, fb.deletes) || insertInsideDelete(fb.inserts, fa.deletes);
}
function transformPair(committed, incoming) {
  if (isConflict(committed, incoming)) return null;
  const c = cursor(committed);
  const i = cursor(incoming);
  const committedOut = [];
  const incomingOut = [];
  for (; ; ) {
    const kc = kindAt(c);
    const ki = kindAt(i);
    if (kc === "insert") {
      const piece = take(c, Infinity);
      pushOp(committedOut, piece);
      pushOp(incomingOut, { retain: opLength(piece) });
      continue;
    }
    if (ki === "insert") {
      const piece = take(i, Infinity);
      pushOp(incomingOut, piece);
      pushOp(committedOut, { retain: opLength(piece) });
      continue;
    }
    if (kc === void 0 || ki === void 0) {
      if (kc !== ki) sameBase();
      break;
    }
    const n = Math.min(remaining(c), remaining(i));
    take(c, n);
    take(i, n);
    if (kc === "retain" && ki === "retain") {
      pushOp(committedOut, { retain: n });
      pushOp(incomingOut, { retain: n });
    } else if (kc === "delete" && ki === "retain") {
      pushOp(committedOut, { delete: n });
    } else if (kc === "retain" && ki === "delete") {
      pushOp(incomingOut, { delete: n });
    }
  }
  return { incoming: incomingOut, committed: committedOut };
}
function transformOffset(offset, ops) {
  let moved = offset;
  let pos = 0;
  for (const op of ops) {
    if ("insert" in op) {
      if (pos <= offset) moved += op.insert.length;
    } else if ("retain" in op) {
      pos += op.retain;
    } else {
      if (offset >= pos + op.delete) moved -= op.delete;
      else if (offset > pos) moved -= offset - pos;
      pos += op.delete;
    }
    if (pos > offset) break;
  }
  return moved;
}

// src/shared/richtext.ts
import { parseFragment } from "parse5";
var BLOCK_LIMIT = 2e4;
var NO_MARKS = { strong: false, em: false, code: false, href: null };
var DROPPED = /* @__PURE__ */ new Set(["script", "style", "iframe", "object", "embed", "template", "noscript"]);
var CONTAINERS = /* @__PURE__ */ new Set(["p", "li", "blockquote", "ul", "ol"]);
var LINK_SCHEMES = /* @__PURE__ */ new Set(["http", "https", "mailto"]);
var HTML_WHITESPACE = /^[ \t\n\f\r]*$/;
function isContainerName(name) {
  return CONTAINERS.has(name);
}
function allowedHref(element) {
  const attr = element.attrs.find((a) => a.name === "href");
  if (attr === void 0) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(attr.value.trim());
  return scheme !== null && LINK_SCHEMES.has(scheme[1].toLowerCase()) ? attr.value : null;
}
function markedBy(element, marks) {
  switch (element.tagName) {
    case "strong":
    case "b":
      return { ...marks, strong: true };
    case "em":
    case "i":
      return { ...marks, em: true };
    case "code":
      return { ...marks, code: true };
    case "a": {
      const href = allowedHref(element);
      return href === null ? marks : { ...marks, href };
    }
    default:
      return marks;
  }
}
var LeafBuilder = class {
  leaves = [];
  nextId = 1;
  container(name) {
    const id = this.nextId;
    this.nextId += 1;
    return { name, id };
  }
  build(nodes) {
    this.walk(nodes, { path: [], open: null }, NO_MARKS);
    return this.leaves;
  }
  walk(nodes, scope, marks) {
    for (const node of nodes) {
      if ("value" in node) this.text(node.value, scope, marks);
      else if ("tagName" in node) this.element(node, scope, marks);
    }
  }
  element(element, scope, marks) {
    const name = element.tagName;
    if (DROPPED.has(name)) return;
    if (name === "br") {
      this.leafFor(scope).items.push({ ch: "\n", br: true, marks });
      return;
    }
    if (!isContainerName(name)) {
      this.walk(element.childNodes, scope, markedBy(element, marks));
      return;
    }
    let parentPath = scope.path;
    while (parentPath.length > 0 && parentPath[parentPath.length - 1].name === "p") parentPath = parentPath.slice(0, -1);
    if (name === "li" && parentPath.length > 0 && parentPath[parentPath.length - 1].name === "li") {
      parentPath = parentPath.slice(0, -1);
    }
    const inner = { path: [...parentPath, this.container(name)], open: null };
    const before = this.leaves.length;
    this.walk(element.childNodes, inner, marks);
    if (this.leaves.length === before && name !== "ul" && name !== "ol") this.leaves.push({ path: inner.path, items: [] });
    if (this.leaves.length > before) scope.open = null;
  }
  text(value, scope, marks) {
    if (value === "") return;
    const last = scope.path[scope.path.length - 1];
    if (last !== void 0 && (last.name === "ul" || last.name === "ol") && HTML_WHITESPACE.test(value)) return;
    const items = this.leafFor(scope).items;
    for (const ch of value.split("")) items.push({ ch, br: false, marks });
  }
  /** The leaf inline content goes into; inline content outside p, li or blockquote gets its own p per run. */
  leafFor(scope) {
    if (scope.open !== null) return scope.open;
    const last = scope.path[scope.path.length - 1];
    const wraps = last === void 0 || last.name === "ul" || last.name === "ol";
    const leaf = { path: wraps ? [...scope.path, this.container("p")] : scope.path, items: [] };
    this.leaves.push(leaf);
    scope.open = leaf;
    return leaf;
  }
};
function parseLeaves(html) {
  return new LeafBuilder().build(parseFragment(html).childNodes);
}
function escapeText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
var MARK_ORDER = ["a", "strong", "em", "code"];
function hasMark(marks, mark) {
  if (mark.name === "a") return marks.href !== null && marks.href === mark.href;
  return marks[mark.name];
}
function marksOf(marks) {
  const out = [];
  if (marks.href !== null) out.push({ name: "a", href: marks.href });
  for (const name of ["strong", "em", "code"]) if (marks[name]) out.push({ name, href: null });
  return out;
}
function openTag(mark, rel) {
  if (mark.name !== "a") return `<${mark.name}>`;
  const relAttr = rel ? ' rel="noopener noreferrer nofollow"' : "";
  return `<a href="${escapeAttr(mark.href ?? "")}"${relAttr}>`;
}
function serialiseInline(items, rel) {
  let out = "";
  const stack = [];
  items.forEach((item, index) => {
    const keep = stack.findIndex((mark) => !hasMark(item.marks, mark));
    if (keep !== -1) {
      for (const mark of stack.splice(keep).reverse()) out += `</${mark.name}>`;
    }
    const missing = marksOf(item.marks).filter((mark) => !stack.some((open) => open.name === mark.name));
    const span = (mark) => {
      let end = index;
      while (end < items.length && hasMark(items[end].marks, mark)) end += 1;
      return end - index;
    };
    missing.sort((x, y) => span(y) - span(x) || MARK_ORDER.indexOf(x.name) - MARK_ORDER.indexOf(y.name));
    for (const mark of missing) {
      out += openTag(mark, rel);
      stack.push(mark);
    }
    out += item.br ? "<br>" : escapeText(item.ch);
  });
  for (const mark of stack.reverse()) out += `</${mark.name}>`;
  return out;
}
function serialiseLeaves(leaves, depth, rel) {
  let out = "";
  let i = 0;
  while (i < leaves.length) {
    const leaf = leaves[i];
    if (leaf.path.length === depth) {
      out += leaf.items.length === 0 && leaves.length > 1 ? "<p></p>" : serialiseInline(leaf.items, rel);
      i += 1;
      continue;
    }
    const container = leaf.path[depth];
    let j = i;
    while (j < leaves.length && leaves[j].path.length > depth && leaves[j].path[depth].id === container.id) j += 1;
    out += `<${container.name}>${serialiseLeaves(leaves.slice(i, j), depth + 1, rel)}</${container.name}>`;
    i = j;
  }
  return out;
}
function serialise(leaves, rel) {
  if (leaves.length === 0 || leaves.length === 1 && leaves[0].items.length === 0) return "";
  return serialiseLeaves(leaves, 0, rel);
}
function sanitizeBody(html) {
  return serialise(parseLeaves(html), false);
}
function renderBody(stored) {
  return serialise(parseLeaves(stored), true);
}
function joinLeaves(stored, lineBreak) {
  return parseLeaves(stored).map((leaf) => leaf.items.map((item) => item.br ? lineBreak : item.ch).join("")).join(lineBreak);
}
function editText(stored) {
  return joinLeaves(stored, "\n");
}
function plainText(stored) {
  return joinLeaves(stored, " ").replace(/^ +| +$/g, "");
}
function textToBody(text) {
  return text === "" ? "" : `<p>${escapeText(text).replace(/\n/g, "<br>")}</p>`;
}
function applyOpsToBody(stored, ops) {
  const leaves = parseLeaves(stored);
  const firstPath = leaves.length > 0 ? leaves[0].path : [{ name: "p", id: 0 }];
  const units = [];
  leaves.forEach((leaf, index) => {
    if (index > 0) units.push({ leafPath: leaf.path });
    for (const item of leaf.items) units.push({ item });
  });
  const out = [];
  let pos = 0;
  for (const op of ops) {
    if ("retain" in op) {
      out.push(...units.slice(pos, pos + op.retain));
      pos += op.retain;
    } else if ("delete" in op) {
      pos += op.delete;
    } else {
      const neighbour = out.length > 0 ? out[out.length - 1] : units[pos];
      const marks = neighbour !== void 0 && "item" in neighbour ? neighbour.item.marks : NO_MARKS;
      for (const ch of op.insert.split("")) out.push({ item: { ch, br: ch === "\n", marks } });
    }
  }
  out.push(...units.slice(pos));
  const result = [{ path: firstPath, items: [] }];
  for (const unit of out) {
    const current = result[result.length - 1];
    if ("item" in unit) current.items.push(unit.item);
    else if (unit.leafPath.length === current.path.length && unit.leafPath.every((c, i) => current.path[i].id === c.id)) {
      current.items.push({ ch: "\n", br: true, marks: NO_MARKS });
    } else {
      result.push({ path: unit.leafPath, items: [] });
    }
  }
  return serialise(result, false);
}

// src/server/presence.ts
var PRESENCE_TTL_MS = 3e4;
var timers = /* @__PURE__ */ new Map();
var timerKey = (sessionId, blockId) => `${sessionId}/${blockId}`;
function announceDrop(sessionId, blockId, label) {
  broadcastUnnumbered("presence.changed", { block_id: blockId, session_id: sessionId, label, anchor: null, head: null });
}
async function drop(where, params) {
  const rows = await db.query(
    `DELETE FROM presence p USING device_sessions s WHERE s.id = p.session_id AND ${where} RETURNING p.session_id, p.block_id, s.label`,
    params
  );
  for (const r of rows) {
    clearTimeout(timers.get(timerKey(r.session_id, r.block_id)));
    timers.delete(timerKey(r.session_id, r.block_id));
    announceDrop(r.session_id, r.block_id, r.label);
  }
}
var dropPresence = (sessionId, blockId) => drop("p.session_id = $1 AND p.block_id = $2", [sessionId, blockId]);
var dropSessionPresence = (sessionId) => drop("p.session_id = $1", [sessionId]);
async function reportPresence(session, blockId, body) {
  const { anchor, head, version } = body;
  const errors = new FieldErrors();
  const base = Number.isInteger(version) ? await one(db, "SELECT body FROM revisions WHERE block_id = $1 AND version = $2", [blockId, version]) : void 0;
  const length = base ? editText(base.body).length : -1;
  const inside = (v) => Number.isInteger(v) && v >= 0 && v <= length;
  if (!inside(anchor)) errors.add("anchor", "Use offsets inside the block.");
  if (!inside(head)) errors.add("head", "Use offsets inside the block.");
  errors.throwIfAny();
  const later = await db.query(
    "SELECT ops, body FROM revisions WHERE block_id = $1 AND version > $2 ORDER BY version",
    [blockId, version]
  );
  let a = anchor;
  let h = head;
  for (const rev of later) {
    if (Array.isArray(rev.ops)) {
      a = transformOffset(a, rev.ops);
      h = transformOffset(h, rev.ops);
    } else {
      const len = editText(rev.body).length;
      a = Math.min(a, len);
      h = Math.min(h, len);
    }
  }
  const current = version + later.length;
  await db.query(
    `INSERT INTO presence (session_id, block_id, anchor, head, version, reported_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (session_id, block_id) DO UPDATE SET anchor = $3, head = $4, version = $5, reported_at = now()`,
    [session.id, blockId, a, h, current]
  );
  broadcastUnnumbered("presence.changed", { block_id: blockId, session_id: session.id, label: session.label, anchor: a, head: h });
  const key = timerKey(session.id, blockId);
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => void dropPresence(session.id, blockId), PRESENCE_TTL_MS));
}

// src/server/sessions.ts
import { createHash, randomBytes as randomBytes2, randomUUID } from "node:crypto";
var SWEEP_MS = 2e3;
var COOKIE = "quire_session";
var tokenHash = (token) => createHash("sha256").update(token).digest("hex");
var randomToken = () => randomBytes2(32).toString("base64url");
function deviceLabel(userAgent) {
  const ua = userAgent ?? "";
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\/|Chromium\//.test(ua) ? "Chrome" : /Version\/[\d.]+.*Safari\//.test(ua) ? "Safari" : null;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /CrOS/.test(ua) ? "ChromeOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return browser && os ? `${browser} on ${os}` : "Unknown browser";
}
function cookieHeader(token) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}
function cookieToken(req) {
  for (const part of (header(req, "cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}
async function startSession(tx, label) {
  const token = randomToken();
  const session = { id: randomUUID(), csrfToken: randomToken(), label };
  await tx.query(
    "INSERT INTO device_sessions (id, token_hash, csrf_token, label, created_at, last_seen_at) VALUES ($1, $2, $3, $4, now(), now())",
    [session.id, tokenHash(token), session.csrfToken, label]
  );
  await emit(tx, "sessions.changed", {});
  return { token, session };
}
async function rotateSession(tx, oldId) {
  const token = randomToken();
  const id = randomUUID();
  const csrfToken = randomToken();
  const [row] = await tx.query(
    "UPDATE device_sessions SET id = $1, token_hash = $2, csrf_token = $3, last_seen_at = now() WHERE id = $4 RETURNING label",
    [id, tokenHash(token), csrfToken, oldId]
  );
  await tx.query("UPDATE presence SET session_id = $1 WHERE session_id = $2", [id, oldId]);
  await emit(tx, "sessions.changed", {});
  return { token, session: { id, csrfToken, label: row.label } };
}
var liveSessionsWhere = (param) => `ended_at IS NULL AND last_seen_at > now() - make_interval(secs => ${param})`;
async function endSessions(tx, ids) {
  if (!ids.length) return;
  await tx.query("UPDATE device_sessions SET ended_at = now() WHERE id = ANY($1::uuid[]) AND ended_at IS NULL", [ids]);
  await emit(tx, "sessions.changed", {});
  tx.afterCommit(async () => {
    for (const id of ids) {
      endSessionChannels(id);
      await dropSessionPresence(id);
    }
  });
}
async function authenticate(req) {
  const token = cookieToken(req);
  if (token) {
    const [row] = await db.query(
      `UPDATE device_sessions SET last_seen_at = now()
        WHERE token_hash = $1 AND ${liveSessionsWhere("$2")}
        RETURNING id, csrf_token, label`,
      [tokenHash(token), config.sessionIdleSeconds]
    );
    if (row) return { id: row.id, csrfToken: row.csrf_token, label: row.label };
  }
  throw apiError(401, "unauthenticated");
}
async function optionalSession(cookie) {
  const token = cookieToken({ headers: { cookie } });
  if (!token) return null;
  const [row] = await db.query(
    `UPDATE device_sessions SET last_seen_at = now() WHERE token_hash = $1 AND ${liveSessionsWhere("$2")}
     RETURNING (SELECT theme FROM workspace_settings WHERE id = 1) AS theme`,
    [tokenHash(token), config.sessionIdleSeconds]
  );
  return row ? { theme: row.theme } : null;
}
function requireCsrf(req, session) {
  if (header(req, "x-csrf-token") !== session.csrfToken) throw apiError(403, "csrf_failed");
}
function startIdleSweep() {
  setInterval(() => {
    transaction(async (tx) => {
      const idle = await tx.query(
        `SELECT id FROM device_sessions WHERE ended_at IS NULL AND last_seen_at <= now() - make_interval(secs => $1) FOR UPDATE SKIP LOCKED`,
        [config.sessionIdleSeconds]
      );
      await endSessions(tx, idle.map((r) => r.id));
    }).catch(() => void 0);
  }, SWEEP_MS).unref();
}

// src/shared/time.ts
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var DAY_MS = 864e5;
var formatters = /* @__PURE__ */ new Map();
function formatter(zone) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
    formatters.set(zone, f);
  }
  return f;
}
function isTimeZone(name) {
  if (typeof name !== "string" || name.trim() === "" || name !== name.trim()) return false;
  try {
    formatter(name);
    return true;
  } catch {
    return false;
  }
}
function zonedParts(instant, zone) {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatter(zone).formatToParts(instant)) {
    if (part.type in out) out[part.type] = Number(part.value);
  }
  return out;
}
var pad = (n, width = 2) => String(n).padStart(width, "0");
function isoDate(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}
function homeDate(instant, zone) {
  const p = zonedParts(instant, zone);
  return isoDate(p.year, p.month, p.day);
}
function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function dateUtc(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function addDays(date, days) {
  const t = new Date(dateUtc(date) + days * DAY_MS);
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function shortTime(instant, zone) {
  const p = zonedParts(instant, zone);
  return `${p.day} ${MONTHS[p.month - 1].slice(0, 3)} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}
function expiresDisplay(instant, zone) {
  return `${shortTime(instant, zone)} ${zone}`;
}
function localMinute(instant, zone) {
  const p = zonedParts(instant, zone);
  return `${isoDate(p.year, p.month, p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
function isLocalMinute(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && isRealDate(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60;
}
function localMinuteToInstant(value, zone) {
  const [date, time] = value.split("T");
  const asUtc = dateUtc(date) + Number(time.slice(0, 2)) * 36e5 + Number(time.slice(3, 5)) * 6e4;
  const offsets = /* @__PURE__ */ new Set();
  for (const probe of [asUtc - DAY_MS, asUtc - 3 * 36e5, asUtc, asUtc + 3 * 36e5, asUtc + DAY_MS]) {
    const p = zonedParts(probe, zone);
    const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    offsets.add(local - Math.floor(probe / 1e3) * 1e3);
  }
  const fits = [...offsets].map((offset) => asUtc - offset).filter((instant) => localMinute(instant, zone) === value);
  return fits.length ? Math.min(...fits) : null;
}

// src/server/workspace.ts
async function loadSettings(q) {
  const row = await one(q, "SELECT home_time_zone, theme FROM workspace_settings WHERE id = 1");
  if (!row) throw new Error("workspace settings missing");
  return { home_time_zone: row.home_time_zone, theme: row.theme };
}
async function homeToday(q) {
  const { home_time_zone: zone } = await loadSettings(q);
  return { date: homeDate(Date.now(), zone), zone };
}
var homeDateOf = (instant, zone) => homeDate(instant.getTime(), zone);

// src/server/routes/account.ts
var PASSWORD_MIN = 12;
var PASSWORD_MAX = 200;
var decoyHash = hashPassword("quire-decoy-password");
var owner = async () => {
  const row = await one(db, "SELECT email, display_name, password_hash FROM owner_account LIMIT 1");
  if (!row) throw new Error("owner missing");
  return row;
};
var normaliseEmail = (email) => email.trim().toLowerCase();
async function signIn(req) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  if (typeof body.email !== "string" || body.email.trim() === "") errors.add("email", "Enter your email address.");
  if (typeof body.password !== "string" || body.password === "") errors.add("password", "Enter your password.");
  errors.throwIfAny();
  const email = normaliseEmail(body.email);
  const identities = [
    { kind: "email", value: email, threshold: EMAIL_FAILURES },
    { kind: "address", value: req.clientAddress, threshold: ADDRESS_FAILURES }
  ];
  const locked = await transaction((tx) => lockedFor(tx, identities));
  if (locked > 0) throw apiError(429, "locked", {}, { "Retry-After": retryAfter(locked) });
  const account = await owner();
  const known = normaliseEmail(account.email) === email;
  const matches2 = await verifyPassword(body.password, known ? account.password_hash : await decoyHash);
  if (!known || !matches2) {
    const nowLocked = await transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(18471)");
      return recordFailure(tx, identities);
    });
    if (nowLocked > 0) throw apiError(429, "locked", {}, { "Retry-After": retryAfter(nowLocked) });
    throw apiError(401, "invalid_credentials");
  }
  const signedIn = await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(18471)");
    const lockedNow = await lockedFor(tx, identities);
    if (lockedNow > 0) return lockedNow;
    await clearFailures(tx, identities[0]);
    return startSession(tx, deviceLabel(req.headers["user-agent"]));
  });
  if (typeof signedIn === "number") throw apiError(429, "locked", {}, { "Retry-After": retryAfter(signedIn) });
  const { token, session } = signedIn;
  return {
    status: 200,
    body: { user: { email: account.email, display_name: account.display_name }, csrf_token: session.csrfToken },
    headers: { "Set-Cookie": cookieHeader(token) }
  };
}
async function signOut(req) {
  await transaction((tx) => endSessions(tx, [req.session.id]));
  return { status: 204, headers: { "Set-Cookie": `${cookieHeader("")}; Max-Age=0` } };
}
async function sessionInfo(req) {
  const account = await owner();
  const settings = await loadSettings(db);
  return ok({
    user: { email: account.email, display_name: account.display_name },
    csrf_token: req.session.csrfToken,
    session_id: req.session.id,
    home_time_zone: settings.home_time_zone,
    theme: settings.theme
  });
}
async function changePassword(req) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  const account = await owner();
  const current = typeof body.current_password === "string" ? body.current_password : "";
  if (!current || !await verifyPassword(current, account.password_hash)) errors.add("current_password", "That isn't your current password.");
  const next = typeof body.new_password === "string" ? body.new_password : "";
  const length = [...next].length;
  if (length < PASSWORD_MIN) errors.add("new_password", "Use at least 12 characters.");
  else if (length > PASSWORD_MAX) errors.add("new_password", "Use at most 200 characters.");
  errors.throwIfAny();
  const hash = await hashPassword(next);
  const rotated = await transaction(async (tx) => {
    await tx.query("UPDATE owner_account SET password_hash = $1", [hash]);
    const others = await tx.query(`SELECT id FROM device_sessions WHERE ended_at IS NULL AND id <> $1`, [req.session.id]);
    await endSessions(tx, others.map((r) => r.id));
    return rotateSession(tx, req.session.id);
  });
  rotateChannels(req.session.id, rotated.session.id);
  return { status: 200, body: { csrf_token: rotated.session.csrfToken }, headers: { "Set-Cookie": cookieHeader(rotated.token) } };
}
async function listSessions(req) {
  const rows = await db.query(
    `SELECT id, label, created_at, last_seen_at FROM device_sessions WHERE ${liveSessionsWhere("$1")} ORDER BY created_at DESC, id`,
    [config.sessionIdleSeconds]
  );
  return ok({
    sessions: rows.map((s) => ({
      id: s.id,
      label: s.label,
      created_at: iso(s.created_at),
      last_seen_at: iso(s.last_seen_at),
      current: s.id === req.session.id
    }))
  });
}
async function revokeSession(req) {
  const id = req.params.id;
  const live = await db.query(`SELECT 1 FROM device_sessions WHERE id = $1 AND ${liveSessionsWhere("$2")}`, [id, config.sessionIdleSeconds]);
  if (!live.length) throw notFound();
  if (id === req.session.id) throw apiError(409, "current_session");
  await transaction((tx) => endSessions(tx, [id]));
  return noContent();
}
async function events(req) {
  const lastId = req.headers["last-event-id"];
  const session = req.session;
  await openChannel(req.res, session.id, Array.isArray(lastId) ? lastId[0] : lastId, () => void dropSessionPresence(session.id));
  return { status: 0 };
}
async function getSettings() {
  return ok({ ...await loadSettings(db) });
}
async function putSettings(req) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!has("home_time_zone") && !has("theme")) errors.add("home_time_zone", "Choose a time zone from the list.");
  if (has("home_time_zone") && !isTimeZone(body.home_time_zone)) errors.add("home_time_zone", "Choose a time zone from the list.");
  if (has("theme") && body.theme !== "paper" && body.theme !== "lamplight") errors.add("theme", "Choose Paper or Lamplight.");
  errors.throwIfAny();
  const settings = await transaction(async (tx) => {
    if (has("home_time_zone")) await tx.query("UPDATE workspace_settings SET home_time_zone = $1 WHERE id = 1", [body.home_time_zone]);
    if (has("theme")) await tx.query("UPDATE workspace_settings SET theme = $1 WHERE id = 1", [body.theme]);
    const saved = await loadSettings(tx);
    await emit(tx, "settings.saved", { ...saved });
    return saved;
  });
  return ok({ ...settings });
}
var accountRoutes = [
  route("POST", "/api/auth/sign-in", "json", signIn, { open: true }),
  route("POST", "/api/auth/sign-out", "none", signOut),
  route("GET", "/api/session", "none", sessionInfo),
  route("POST", "/api/account/password", "json", changePassword),
  route("GET", "/api/sessions", "none", listSessions),
  route("DELETE", "/api/sessions/:id", "none", revokeSession),
  route("GET", "/api/events", "none", events),
  route("GET", "/api/settings", "none", getSettings),
  route("PUT", "/api/settings", "json", putSettings)
];

// src/server/routes/attachments.ts
import { randomUUID as randomUUID5 } from "node:crypto";

// src/server/multipart.ts
function boundaryOf(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return m ? (m[1] ?? m[2]).trim() : null;
}
function headerParam(headerValue, name) {
  const m = new RegExp(`(?:^|;)\\s*${name}=(?:"([^"]*)"|([^;]+))`, "i").exec(headerValue);
  if (!m) return null;
  return m[1] !== void 0 ? m[1] : m[2].trim();
}
function filePart(body, contentType) {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const headerStart = start + delimiter.length + 2;
    const headerEnd = body.indexOf("\r\n\r\n", headerStart);
    if (headerEnd === -1) return null;
    const next = body.indexOf(delimiter, headerEnd + 4);
    if (next === -1) return null;
    const headers = body.subarray(headerStart, headerEnd).toString("utf8");
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] ?? "";
    if (headerParam(disposition, "name") === "file") {
      return {
        filename: headerParam(disposition, "filename") ?? "",
        contentType: (/content-type:([^\r\n]*)/i.exec(headers)?.[1] ?? "").split(";")[0].trim().toLowerCase(),
        bytes: body.subarray(headerEnd + 4, next - 2)
        // drop the CRLF before the next delimiter
      };
    }
    start = next;
  }
  return null;
}

// src/server/storage.ts
import { createHash as createHash2, createHmac } from "node:crypto";
var CALL_TIMEOUT_MS = 3e3;
var OUTAGE_MEMORY_MS = 5e3;
var DELETE_RETRY_MS = 2e3;
var unavailableUntil = 0;
var sha256 = (data) => createHash2("sha256").update(data).digest("hex");
var hmac = (key, data) => createHmac("sha256", key).update(data).digest();
var encodeSegment = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
var StorageUnavailable = class extends Error {
};
async function call(method, key, options = {}) {
  if (Date.now() < unavailableUntil) throw new StorageUnavailable();
  const { endpoint, region, bucket, forcePathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = forcePathStyle ? base.host : `${bucket}.${base.host}`;
  const path2 = (forcePathStyle ? `/${encodeSegment(bucket)}` : "") + (key ? "/" + key.split("/").map(encodeSegment).join("/") : forcePathStyle ? "" : "/");
  const query = Object.entries(options.query ?? {}).sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`).join("&");
  const body = options.body ?? Buffer.alloc(0);
  const now = /* @__PURE__ */ new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers = { host, "x-amz-content-sha256": sha256(body), "x-amz-date": amzDate };
  if (options.contentType) headers["content-type"] = options.contentType;
  const names = Object.keys(headers).sort();
  const canonical2 = [method, path2 || "/", query, names.map((n) => `${n}:${headers[n]}
`).join(""), names.join(";"), headers["x-amz-content-sha256"]].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  let signingKey = hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, "s3", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(`AWS4-HMAC-SHA256
${amzDate}
${scope}
${sha256(canonical2)}`).digest("hex");
  const { host: _host, ...sent } = headers;
  sent.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    const response = await fetch(`${base.protocol}//${host}${path2 || "/"}${query ? "?" + query : ""}`, {
      method,
      headers: sent,
      body: method === "PUT" ? new Uint8Array(body) : void 0,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.status >= 500) throw new StorageUnavailable();
    return { status: response.status, headers: response.headers, body: bytes };
  } catch (error) {
    unavailableUntil = Date.now() + OUTAGE_MEMORY_MS;
    throw error instanceof StorageUnavailable ? error : new StorageUnavailable();
  }
}
async function orUnavailable(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageUnavailable) throw apiError(503, "storage_unavailable");
    throw error;
  }
}
async function storageAvailable() {
  try {
    const head = await call("HEAD", "");
    if (head.status === 404) await call("PUT", "");
    return true;
  } catch {
    return false;
  }
}
async function putObject(key, body, contentType) {
  const r = await call("PUT", key, { body, contentType });
  if (r.status !== 200) throw new StorageUnavailable();
}
async function objectSize(key) {
  const r = await call("HEAD", key);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new StorageUnavailable();
  return Number(r.headers.get("content-length"));
}
async function getObject(key) {
  const r = await call("GET", key);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new StorageUnavailable();
  return r.body;
}
async function deleteObject(key) {
  const r = await call("DELETE", key);
  if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw new StorageUnavailable();
}
var xmlText = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
async function listKeys(prefix) {
  const keys = [];
  let token = null;
  do {
    const query = { "list-type": "2", prefix };
    if (token) query["continuation-token"] = token;
    const r = await call("GET", "", { query });
    if (r.status !== 200) throw new StorageUnavailable();
    const xml = r.body.toString("utf8");
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(xmlText(m[1]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(/<NextContinuationToken>([^<]*)</.exec(xml)?.[1] ?? "") || null : null;
  } while (token);
  return keys;
}
function deleteEventually(keys) {
  for (const key of keys) {
    const attempt = () => {
      deleteObject(key).catch(() => setTimeout(attempt, DELETE_RETRY_MS));
    };
    attempt();
  }
}
function deletePrefixEventually(prefix) {
  const attempt = () => {
    listKeys(prefix).then((keys) => deleteEventually(keys), () => setTimeout(attempt, DELETE_RETRY_MS));
  };
  attempt();
}

// src/server/routes/blocks.ts
import { randomUUID as randomUUID4 } from "node:crypto";

// src/server/edges.ts
import { randomUUID as randomUUID2 } from "node:crypto";
async function lockObjects(tx, ids) {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length) await tx.query("SELECT id FROM objects WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE", [sorted]);
}
async function announceCounts(tx, ids) {
  const counts = /* @__PURE__ */ new Map();
  for (const id of [...new Set(ids)]) {
    const exists = await tx.query("SELECT 1 FROM objects WHERE id = $1", [id]);
    if (!exists.length) continue;
    const n = await backlinkCount(tx, id);
    counts.set(id, n);
    await emit(tx, "backlinks.changed", { object_id: id, backlinks: n });
  }
  return counts;
}
async function addQuoteEdge(tx, hostId, originObjectId, quoteBlockId) {
  await tx.query(
    `INSERT INTO link_edges (id, from_object_id, to_object_id, kind, quote_block_id, created_at) VALUES ($1, $2, $3, 'quote', $4, clock_timestamp())`,
    [randomUUID2(), hostId, originObjectId, quoteBlockId]
  );
}
async function setRelationEdge(tx, objectId, field, target) {
  const old = await tx.query(
    `DELETE FROM link_edges WHERE from_object_id = $1 AND kind = 'relation' AND field_name = $2 RETURNING to_object_id`,
    [objectId, field]
  );
  if (target) {
    await tx.query(
      `INSERT INTO link_edges (id, from_object_id, to_object_id, kind, field_name, created_at) VALUES ($1, $2, $3, 'relation', $4, clock_timestamp())`,
      [randomUUID2(), objectId, target, field]
    );
  }
  return [...old.map((r) => r.to_object_id), ...target ? [target] : []];
}

// src/server/routes/objects.ts
import { randomUUID as randomUUID3 } from "node:crypto";

// src/server/properties.ts
var TEXT_PROPERTY_LIMIT = 2e3;
var codePoints = (s) => [...s].length;
function isWebAddress(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
async function checkProperties(q, fields, given, existing, errors, options) {
  const input = given !== null && typeof given === "object" && !Array.isArray(given) ? given : {};
  const out = { ...existing };
  for (const name of Object.keys(input)) {
    if (!fields.some((f) => f.name === name)) errors.add(`properties.${name}`, "That field is not on this type.");
  }
  for (const f of fields) {
    const key = `properties.${f.name}`;
    if (!(f.name in input)) {
      if (options.creating) {
        if (f.required) errors.add(key, "This field is required.");
        out[f.name] = null;
      }
      continue;
    }
    const value = input[f.name];
    if (value === null || value === void 0) {
      if (f.required) errors.add(key, "This field is required.");
      out[f.name] = null;
      continue;
    }
    switch (f.kind) {
      case "text":
        if (typeof value !== "string" || codePoints(value) > TEXT_PROPERTY_LIMIT) errors.add(key, "Use at most 2,000 characters.");
        else out[f.name] = value;
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) errors.add(key, "Enter a number.");
        else out[f.name] = value;
        break;
      case "date":
        if (!isRealDate(value)) errors.add(key, "Use a real date as YYYY-MM-DD.");
        else out[f.name] = value;
        break;
      case "url":
        if (typeof value !== "string" || !isWebAddress(value)) errors.add(key, "Use a web address starting with http or https.");
        else out[f.name] = value;
        break;
      case "select":
        if (typeof value !== "string" || !(f.options ?? []).includes(value)) errors.add(key, "Choose one of the options.");
        else out[f.name] = value;
        break;
      case "relation": {
        const target = await relationTarget(q, f, value);
        if (typeof value === "string" && value === options.objectId) errors.add(key, "A note can't link to itself.");
        else if (!target) errors.add(key, `Choose a note of type ${await typeName(q, f.target_type_id)}.`);
        else out[f.name] = value;
        break;
      }
    }
  }
  return out;
}
async function relationTarget(q, f, value) {
  if (!isUuid(value)) return false;
  const rows = await q.query("SELECT 1 FROM objects WHERE id = $1 AND type_id = $2", [value, f.target_type_id]);
  return rows.length > 0;
}
async function typeName(q, id) {
  const rows = await q.query("SELECT name FROM object_types WHERE id = $1", [id]);
  return rows[0]?.name ?? "";
}

// src/shared/query.ts
var QUERY_TEXT_CAP = 500;
var MAX_NESTING = 8;
var DAY_MS2 = 864e5;
function compareCodePoints(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  const shared = Math.min(x.length, y.length);
  for (let i = 0; i < shared; i++) {
    const diff2 = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (diff2 !== 0) return diff2;
  }
  return x.length - y.length;
}
function compareText(a, b) {
  return compareCodePoints(a.toLowerCase(), b.toLowerCase());
}
function compareIds(a, b) {
  return compareText(a, b);
}
var BUILTINS = ["@title", "@backlinks", "@updated"];
function valueKind(subject) {
  if ("builtin" in subject) {
    return subject.builtin === "@title" ? "text" : subject.builtin === "@backlinks" ? "number" : "date";
  }
  return subject.field.kind === "url" ? "text" : subject.field.kind;
}
function findField(type, name) {
  const wanted = name.toLowerCase();
  return type.fields.find((f) => f.name.toLowerCase() === wanted);
}
function findBuiltin(name) {
  const wanted = name.toLowerCase();
  return BUILTINS.find((b) => b === wanted);
}
function readSubject(subject, obj) {
  if ("builtin" in subject) {
    return subject.builtin === "@title" ? obj.title : subject.builtin === "@backlinks" ? obj.backlinks : obj.updatedDate;
  }
  return obj.properties[subject.field.name] ?? null;
}
function relationTarget2(obj, field, ctx) {
  const id = obj.properties[field.name];
  return typeof id === "string" ? ctx.objectById(id) ?? null : null;
}
function sortValue(subject, obj, ctx) {
  if ("field" in subject && subject.field.kind === "relation") return relationTarget2(obj, subject.field, ctx)?.title ?? null;
  const value = readSubject(subject, obj);
  if (value !== null && "field" in subject && subject.field.kind === "select") return (subject.field.options ?? []).indexOf(String(value));
  return value;
}
function compareSortValues(kind, a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return kind === "date" ? x < y ? -1 : x > y ? 1 : 0 : compareText(x, y);
}
function sortSubject(type, key) {
  const builtin = findBuiltin(key);
  if (builtin !== void 0) return { builtin };
  const field = findField(type, key);
  return field === void 0 ? void 0 : { field };
}
function isSortKey(type, key) {
  return sortSubject(type, key) !== void 0;
}
function sortObjects(objs, type, sort, ctx) {
  const keys = sort.flatMap((s) => {
    const subject = sortSubject(type, s.key);
    return subject === void 0 ? [] : [{ subject, kind: valueKind(subject), sign: s.dir === "desc" ? -1 : 1 }];
  });
  const rows = objs.map((obj) => ({ obj, values: keys.map((k) => sortValue(k.subject, obj, ctx)) }));
  rows.sort((a, b) => {
    for (let i = 0; i < keys.length; i++) {
      const x = a.values[i];
      const y = b.values[i];
      if (x === null || y === null) {
        if (x !== y) return x === null ? 1 : -1;
        continue;
      }
      const order = compareSortValues(keys[i].kind, x, y);
      if (order !== 0) return keys[i].sign * order;
    }
    return compareText(a.obj.title, b.obj.title) || compareIds(a.obj.id, b.obj.id);
  });
  return rows.map((r) => r.obj);
}
var GROUPABLE_KINDS = ["select", "relation", "date", "text"];
var NO_VALUE_LABEL = "No value";
function groupField(type, groupBy) {
  const field = findField(type, groupBy);
  return field !== void 0 && GROUPABLE_KINDS.includes(field.kind) ? field : void 0;
}
function groupObjects(rows, field, ctx) {
  const groups = /* @__PURE__ */ new Map();
  const noValue = { key: null, label: NO_VALUE_LABEL, rows: [] };
  for (const obj of rows) {
    const stored = obj.properties[field.name];
    const label = field.kind === "relation" ? relationTarget2(obj, field, ctx)?.title : stored;
    if (typeof stored !== "string" || typeof label !== "string") {
      noValue.rows.push(obj);
      continue;
    }
    const group = groups.get(stored) ?? { key: stored, label, rows: [] };
    group.rows.push(obj);
    groups.set(stored, group);
  }
  const ordered = [...groups.values()].sort((a, b) => compareText(a.label, b.label));
  return noValue.rows.length > 0 ? [...ordered, noValue] : ordered;
}
var QueryError = class extends Error {
};
var KEYWORDS = ["and", "or", "not", "today", "null"];
var OPS = ["!=", "<=", ">=", "=", "~", "<", ">"];
var isComparisonOp = (text) => OPS.some((op) => op === text);
var isDigit = (ch) => ch !== void 0 && ch >= "0" && ch <= "9";
var isWordStart = (ch) => ch !== void 0 && /[\p{L}_]/u.test(ch);
var isWordPart = (ch) => ch !== void 0 && /[\p{L}\p{Nd}_]/u.test(ch);
function isRealDate2(date) {
  const [y, m, d] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}
function addDays2(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS2).toISOString().slice(0, 10);
}
var OPERATORS_BY_KIND = {
  text: ["=", "!=", "~"],
  number: ["=", "!=", "<", "<=", ">", ">="],
  date: ["=", "!=", "<", "<=", ">", ">="],
  select: ["=", "!="],
  relation: ["=", "!="]
};
var Parser = class {
  chars;
  pos = 0;
  type;
  typeById;
  constructor(chars, type, typeById2) {
    this.chars = chars;
    this.type = type;
    this.typeById = typeById2;
  }
  parse() {
    const condition = this.parseOr(0);
    const rest = this.peek();
    if (rest.kind !== "end") this.unexpected(rest);
    return condition;
  }
  fail(message, start) {
    throw new QueryError(`${message} at column ${start + 1}.`);
  }
  unexpected(token) {
    if (token.kind === "end") this.fail("Unexpected end of query", this.chars.length);
    this.fail(`Unexpected ${token.text}`, token.start);
  }
  skipSpace() {
    while (this.pos < this.chars.length && /\s/u.test(this.chars[this.pos])) this.pos++;
  }
  /** Reads the token at the cursor without consuming it. */
  peek() {
    this.skipSpace();
    return this.lex(this.pos);
  }
  take() {
    const token = this.peek();
    this.pos = token.end;
    return token;
  }
  token(kind, start, end, value) {
    const text = this.chars.slice(start, end).join("");
    return { kind, text, value: value ?? text, start, end };
  }
  lex(start) {
    const c = this.chars;
    const ch = c[start];
    if (ch === void 0) return this.token("end", start, start);
    if (ch === '"') return this.lexString(start);
    if (ch === "[") {
      const close = c.indexOf("]", start + 1);
      if (close < 0) this.fail("Unexpected end of query", c.length);
      return this.token("bracket", start, close + 1, c.slice(start + 1, close).join(""));
    }
    if (ch === "@") {
      let end = start + 1;
      while (isWordPart(c[end])) end++;
      return this.token(end > start + 1 ? "at" : "symbol", start, end);
    }
    if (isWordStart(ch)) {
      let end = start + 1;
      while (isWordPart(c[end])) end++;
      return this.token("word", start, end);
    }
    if (isDigit(ch) || ch === "-" && isDigit(c[start + 1])) return this.lexNumberOrDate(start);
    const op = OPS.find((o) => Array.from(o).every((oc, i) => c[start + i] === oc));
    if (op !== void 0) return this.token("op", start, start + op.length);
    return this.token("symbol", start, start + 1);
  }
  lexString(start) {
    const c = this.chars;
    let value = "";
    for (let i = start + 1; i < c.length; i++) {
      if (c[i] === '"') return this.token("string", start, i + 1, value);
      if (c[i] === "\\") {
        const next = c[i + 1];
        if (next === void 0) break;
        if (next !== '"' && next !== "\\") this.fail(`Unexpected \\${next}`, i);
        value += next;
        i++;
      } else value += c[i];
    }
    return this.fail("Unclosed string", start);
  }
  lexNumberOrDate(start) {
    const c = this.chars;
    const dateText = c.slice(start, start + 10).join("");
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText) && !isDigit(c[start + 10])) {
      if (!isRealDate2(dateText)) this.fail("Not a real date", start);
      return this.token("date", start, start + 10);
    }
    let end = start + 1;
    while (isDigit(c[end])) end++;
    if (c[end] === "." && isDigit(c[end + 1])) {
      end += 2;
      while (isDigit(c[end])) end++;
    }
    return this.token("number", start, end);
  }
  isKeyword(token, keyword) {
    return token.kind === "word" && token.text.toLowerCase() === keyword;
  }
  parseOr(depth) {
    const items = [this.parseAnd(depth)];
    while (this.isKeyword(this.peek(), "or")) {
      this.take();
      items.push(this.parseAnd(depth));
    }
    return items.length === 1 ? items[0] : { kind: "or", items };
  }
  parseAnd(depth) {
    const items = [this.parseNot(depth)];
    while (this.isKeyword(this.peek(), "and")) {
      this.take();
      items.push(this.parseNot(depth));
    }
    return items.length === 1 ? items[0] : { kind: "and", items };
  }
  parseNot(depth) {
    const token = this.peek();
    const opensNot = this.isKeyword(token, "not");
    if (opensNot || token.kind === "symbol" && token.text === "(") {
      if (depth >= MAX_NESTING) this.fail("Too deeply nested", token.start);
      this.take();
      if (opensNot) return { kind: "not", item: this.parseNot(depth + 1) };
      const inner = this.parseOr(depth + 1);
      const close = this.take();
      if (!(close.kind === "symbol" && close.text === ")")) this.unexpected(close);
      return inner;
    }
    return this.parseComparison();
  }
  /** A name token resolved against a type: a field (any case), or a built-in when allowed. */
  resolveName(token, type, builtins) {
    if (token.kind === "at") {
      const builtin = findBuiltin(token.text);
      return builtin !== void 0 && builtins.includes(builtin) ? { builtin } : void 0;
    }
    const field = findField(type, token.value);
    return field === void 0 ? void 0 : { field };
  }
  isName(token) {
    return token.kind === "bracket" || token.kind === "at" || token.kind === "word" && !KEYWORDS.includes(token.text.toLowerCase());
  }
  parsePath() {
    const first = this.take();
    if (!this.isName(first)) this.unexpected(first);
    const firstSubject = this.resolveName(first, this.type, BUILTINS);
    if (firstSubject === void 0) this.fail(`Unknown field ${first.value}`, first.start);
    const dot = this.peek();
    if (!(dot.kind === "symbol" && dot.text === ".")) return { path: { via: null, subject: firstSubject }, name: first.value };
    this.take();
    const second = this.take();
    if (!this.isName(second)) this.unexpected(second);
    const name = `${first.value}.${second.value}`;
    const via = "field" in firstSubject && firstSubject.field.kind === "relation" ? firstSubject.field : null;
    const targetTypeId = via?.targetTypeId ?? null;
    const target = targetTypeId === null ? void 0 : this.typeById(targetTypeId);
    const subject = via === null || target === void 0 ? void 0 : this.resolveName(second, target, ["@title"]);
    if (subject === void 0) this.fail(`Unknown field ${name}`, first.start);
    return { path: { via, subject }, name };
  }
  parseComparison() {
    const { path: path2, name } = this.parsePath();
    const kind = valueKind(path2.subject);
    const opToken = this.take();
    const op = opToken.text;
    if (opToken.kind !== "op" || !isComparisonOp(op)) return this.unexpected(opToken);
    if (!OPERATORS_BY_KIND[kind].includes(op)) this.fail(`${op} does not fit ${name}`, opToken.start);
    const valueToken = this.take();
    if (this.isKeyword(valueToken, "null") && (op === "=" || op === "!=")) {
      return { kind: "cmp", path: path2, op, operand: { kind: "null" } };
    }
    return { kind: "cmp", path: path2, op, operand: this.operand(kind, valueToken, path2.subject, name) };
  }
  operand(kind, token, subject, name) {
    if (kind === "number" && token.kind === "number") return { kind: "number", value: Number(token.text) };
    if (kind === "date" && token.kind === "date") return { kind: "date", value: token.text };
    if (kind === "date" && this.isKeyword(token, "today")) return { kind: "today", offsetDays: this.todayOffset() };
    if ((kind === "text" || kind === "relation") && token.kind === "string") return { kind: "string", value: token.value };
    if (kind === "select" && token.kind === "string") {
      const options = "field" in subject ? subject.field.options ?? [] : [];
      const wanted = token.value.toLowerCase();
      if (!options.some((o) => o.toLowerCase() === wanted)) this.fail(`"${token.value}" is not an option of ${name}`, token.start);
      return { kind: "string", value: token.value };
    }
    return this.unexpected(token);
  }
  /** The optional `+ Nd` or `- Nd` after `today`. */
  todayOffset() {
    this.skipSpace();
    const sign = this.chars[this.pos];
    if (sign !== "+" && sign !== "-") return 0;
    this.pos++;
    this.skipSpace();
    let end = this.pos;
    while (isDigit(this.chars[end])) end++;
    if (end === this.pos || this.chars[end] !== "d") this.unexpected(this.lex(this.pos));
    const days = Number(this.chars.slice(this.pos, end).join(""));
    this.pos = end + 1;
    return sign === "-" ? -days : days;
  }
};
function checkQuery(text, type, ctx) {
  const chars = Array.from(text);
  if (chars.length > QUERY_TEXT_CAP) return { ok: false, message: `Use at most ${QUERY_TEXT_CAP} characters.` };
  if (text.trim() === "") return { ok: true, query: { condition: null } };
  try {
    return { ok: true, query: { condition: new Parser(chars, type, (id) => ctx.typeById(id)).parse() } };
  } catch (error) {
    if (error instanceof QueryError) return { ok: false, message: error.message };
    throw error;
  }
}
function compareOrdered(op, order) {
  switch (op) {
    case "<":
      return order < 0;
    case "<=":
      return order <= 0;
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "!=":
      return order !== 0;
    default:
      return order === 0;
  }
}
function evaluateComparison(cmp, obj, ctx) {
  const holder = cmp.path.via === null ? obj : relationTarget2(obj, cmp.path.via, ctx);
  const subject = cmp.path.subject;
  const kind = valueKind(subject);
  let value = holder === null ? null : readSubject(subject, holder);
  if (holder !== null && kind === "relation" && "field" in subject) value = relationTarget2(holder, subject.field, ctx)?.title ?? null;
  const { op, operand } = cmp;
  if (operand.kind === "null") return op === "=" ? value === null : value !== null;
  if (value === null) return false;
  if (operand.kind === "number") return compareOrdered(op, Number(value) - operand.value);
  if (operand.kind === "date" || operand.kind === "today") {
    const date = operand.kind === "date" ? operand.value : addDays2(ctx.today, operand.offsetDays);
    const stored2 = String(value);
    return compareOrdered(op, stored2 < date ? -1 : stored2 > date ? 1 : 0);
  }
  const stored = String(value).toLowerCase();
  const wanted = operand.value.toLowerCase();
  return op === "~" ? stored.includes(wanted) : compareOrdered(op, stored === wanted ? 0 : 1);
}
function evaluate(condition, obj, ctx) {
  switch (condition.kind) {
    case "or":
      return condition.items.some((c) => evaluate(c, obj, ctx));
    case "and":
      return condition.items.every((c) => evaluate(c, obj, ctx));
    case "not":
      return !evaluate(condition.item, obj, ctx);
    case "cmp":
      return evaluateComparison(condition, obj, ctx);
  }
}
function matches(query, obj, ctx) {
  return query.condition === null || evaluate(query.condition, obj, ctx);
}

// src/server/routes/objects.ts
var NAME_LIMIT = 60;
var TITLE_LIMIT = 200;
var KINDS = ["text", "number", "date", "url", "select", "relation"];
var DAILY_RANK = 3;
var codePoints2 = (s) => [...s].length;
async function checkField(tx, raw, prefix, taken, errors) {
  const f = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const name = typeof f.name === "string" ? f.name.trim() : "";
  if (!name || codePoints2(name) > NAME_LIMIT) errors.add(`${prefix}name`, "Give the field a name.");
  else if (taken.includes(name.toLowerCase())) errors.add(`${prefix}name`, "Field names must be different.");
  const kind = typeof f.kind === "string" ? f.kind : "";
  if (!KINDS.includes(kind)) errors.add(`${prefix}kind`, "Choose text, number, date, url, select or relation.");
  let options = null;
  if (kind === "select") {
    options = Array.isArray(f.options) ? [...new Set(f.options.filter((o) => typeof o === "string").map((o) => o.trim()).filter(Boolean))] : [];
    if (!options.length) errors.add(`${prefix}options`, "Add at least one option.");
  }
  let target = null;
  if (kind === "relation") {
    const found = isUuid(f.target_type_id) ? await tx.query("SELECT 1 FROM object_types WHERE id = $1", [f.target_type_id]) : [];
    if (!found.length) errors.add(`${prefix}target_type_id`, "Choose the type this field links to.");
    else target = f.target_type_id;
  }
  return { name, kind, required: f.required === true, options, target_type_id: target };
}
async function insertField(tx, typeId, field) {
  const [{ n }] = await tx.query("SELECT count(*)::int AS n FROM fields WHERE type_id = $1", [typeId]);
  await tx.query(
    "INSERT INTO fields (id, type_id, position, name, kind, required, options, target_type_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [randomUUID3(), typeId, n, field.name, field.kind, field.required, field.options ? JSON.stringify(field.options) : null, field.target_type_id]
  );
}
async function typeById(q, id) {
  const t = (await loadTypes(q)).find((x) => x.id === id);
  if (!t) throw notFound();
  return typeJson(t);
}
async function listTypes() {
  return ok({ types: (await loadTypes(db)).map(typeJson) });
}
async function createType(req) {
  const body = objectBody(req);
  const created = await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(18472)");
    const errors = new FieldErrors();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || codePoints2(name) > NAME_LIMIT) errors.add("name", "Give the type a name.");
    else if ((await tx.query("SELECT 1 FROM object_types WHERE lower(name) = lower($1)", [name])).length) {
      errors.add("name", "A type with this name already exists.");
    }
    const fields = [];
    const rawFields = Array.isArray(body.fields) ? body.fields : [];
    for (const [i, raw] of rawFields.entries()) {
      fields.push(await checkField(tx, raw, `fields.${i}.`, fields.map((f) => f.name.toLowerCase()), errors));
    }
    errors.throwIfAny();
    const id = randomUUID3();
    await tx.query("INSERT INTO object_types (id, name, builtin_rank, created_at) VALUES ($1, $2, NULL, clock_timestamp())", [id, name]);
    for (const f of fields) await insertField(tx, id, f);
    return typeById(tx, id);
  });
  return ok(created, 201);
}
async function addField(req) {
  const body = objectBody(req);
  const result = await transaction(async (tx) => {
    const type = await one(tx, "SELECT builtin_rank FROM object_types WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!type) throw notFound();
    if (type.builtin_rank === DAILY_RANK) throw apiError(409, "builtin_type");
    const errors = new FieldErrors();
    const taken = (await fieldsOf(tx, req.params.id)).map((f) => f.name.toLowerCase());
    const field = await checkField(tx, body, "", taken, errors);
    errors.throwIfAny();
    await insertField(tx, req.params.id, field);
    return typeById(tx, req.params.id);
  });
  return ok(result, 201);
}
async function deleteType(req) {
  await transaction(async (tx) => {
    const type = await one(tx, "SELECT builtin_rank FROM object_types WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!type) throw notFound();
    if (type.builtin_rank !== null) throw apiError(409, "builtin_type");
    const used = await tx.query(
      "SELECT 1 FROM objects WHERE type_id = $1 UNION ALL SELECT 1 FROM fields WHERE target_type_id = $1 AND type_id <> $1 LIMIT 1",
      [req.params.id]
    );
    if (used.length) throw apiError(409, "type_in_use");
    await tx.query("DELETE FROM object_types WHERE id = $1", [req.params.id]);
  });
  return noContent();
}
function byTitle(rows) {
  return [...rows].sort((a, b) => compareText(a.title, b.title) || compareIds(a.id, b.id));
}
async function listObjects(req) {
  const typeId = req.query.get("type_id");
  if (!isUuid(typeId)) throw validation({ type_id: "Choose a type." });
  const rows = await db.query(`${OBJECT_SELECT} WHERE o.type_id = $1`, [typeId]);
  const fields = await fieldsOf(db, typeId);
  return ok({ objects: byTitle(rows).map((o) => objectJson(o, fields)) });
}
function checkTitle(value, errors) {
  const title = typeof value === "string" ? value.trim() : "";
  if (!title || codePoints2(title) > TITLE_LIMIT) errors.add("title", "Give the note a title.");
  return title;
}
async function syncRelations(tx, objectId, fields, before, after) {
  const touched = [];
  for (const f of fields) {
    if (f.kind !== "relation" || (before[f.name] ?? null) === (after[f.name] ?? null)) continue;
    touched.push(...await setRelationEdge(tx, objectId, f.name, after[f.name] ?? null));
  }
  return touched;
}
async function createObject(req) {
  const body = objectBody(req);
  const id = randomUUID3();
  await transaction(async (tx) => {
    const errors = new FieldErrors();
    const type = isUuid(body.type_id) ? await one(tx, "SELECT builtin_rank FROM object_types WHERE id = $1", [body.type_id]) : void 0;
    if (!type) errors.add("type_id", "Choose a type.");
    else if (type.builtin_rank === DAILY_RANK) errors.add("type_id", "Daily notes are created from Today.");
    const title = checkTitle(body.title, errors);
    const fields = type ? await fieldsOf(tx, body.type_id) : [];
    const properties = type ? await checkProperties(tx, fields, body.properties, {}, errors, { creating: true, objectId: null }) : {};
    errors.throwIfAny();
    const targets = fields.filter((f) => f.kind === "relation").map((f) => properties[f.name]).filter((v) => typeof v === "string");
    await lockObjects(tx, targets);
    await tx.query(
      `INSERT INTO objects (id, type_id, title, properties, share_visibility, created_at, updated_at) VALUES ($1, $2, $3, $4, 'follow', now(), now())`,
      [id, body.type_id, title, JSON.stringify(properties)]
    );
    const touched = await syncRelations(tx, id, fields, {}, properties);
    await emit(tx, "object.saved", { object_id: id });
    await announceCounts(tx, touched);
  });
  return ok(await fullObject(db, id) ?? null, 201);
}
async function getObject2(req) {
  const object = await fullObject(db, req.params.id);
  if (!object) throw notFound();
  return ok(object);
}
async function patchObject(req) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    const existing = await one(
      tx,
      "SELECT type_id, properties FROM objects WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (!existing) throw notFound();
    const errors = new FieldErrors();
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const title = has("title") ? checkTitle(body.title, errors) : null;
    const fields = await fieldsOf(tx, existing.type_id);
    const properties = has("properties") ? await checkProperties(tx, fields, body.properties, existing.properties, errors, { creating: false, objectId: req.params.id }) : existing.properties;
    if (has("share_visibility") && body.share_visibility !== "follow" && body.share_visibility !== "never") {
      errors.add("share_visibility", "Choose follow or never.");
    }
    errors.throwIfAny();
    const targets = fields.filter((f) => f.kind === "relation").flatMap((f) => [existing.properties[f.name], properties[f.name]]).filter((v) => typeof v === "string");
    await lockObjects(tx, targets);
    await tx.query(
      `UPDATE objects SET title = COALESCE($2, title), properties = $3, share_visibility = COALESCE($4, share_visibility), updated_at = now() WHERE id = $1`,
      [req.params.id, title, JSON.stringify(properties), has("share_visibility") ? body.share_visibility : null]
    );
    const touched = await syncRelations(tx, req.params.id, fields, existing.properties, properties);
    await emit(tx, "object.saved", { object_id: req.params.id });
    await announceCounts(tx, touched);
  });
  return ok(await fullObject(db, req.params.id) ?? null);
}
async function deleteObject2(req) {
  const keys = await transaction(async (tx) => {
    const target = await loadObject(tx, req.params.id);
    if (!target) throw notFound();
    const outgoing = await tx.query("SELECT DISTINCT to_object_id FROM link_edges WHERE from_object_id = $1", [req.params.id]);
    const quotes = await tx.query(
      `SELECT q.id, q.object_id FROM blocks q JOIN blocks ob ON ob.id = q.origin_block_id
        WHERE ob.object_id = $1 AND q.object_id <> $1`,
      [req.params.id]
    );
    const holders = await tx.query(
      `SELECT o.id, o.type_id, f.name FROM objects o JOIN fields f ON f.type_id = o.type_id
        WHERE f.kind = 'relation' AND o.properties ->> f.name = $1 AND o.id::text <> $1`,
      [req.params.id]
    );
    await lockObjects(tx, [req.params.id, ...outgoing.map((r) => r.to_object_id), ...quotes.map((q) => q.object_id), ...holders.map((h) => h.id)]);
    for (const q of quotes) await tx.query("DELETE FROM blocks WHERE id = $1", [q.id]);
    for (const hostId of new Set(quotes.map((q) => q.object_id))) await renumber(tx, hostId);
    for (const h of holders) {
      await tx.query(`UPDATE objects SET properties = jsonb_set(properties, ARRAY[$2::text], 'null'::jsonb), updated_at = now() WHERE id = $1`, [h.id, h.name]);
    }
    const attachments = await tx.query("SELECT storage_key FROM attachments WHERE object_id = $1", [req.params.id]);
    await tx.query("DELETE FROM presence WHERE block_id IN (SELECT id FROM blocks WHERE object_id = $1)", [req.params.id]);
    await tx.query("UPDATE blocks SET origin_block_id = NULL WHERE object_id = $1", [req.params.id]);
    await tx.query("DELETE FROM objects WHERE id = $1", [req.params.id]);
    for (const q of quotes) await emit(tx, "block.removed", { object_id: q.object_id, block_id: q.id });
    for (const h of new Set(holders.map((x) => x.id))) await emit(tx, "object.saved", { object_id: h });
    await emit(tx, "object.removed", { object_id: req.params.id });
    await announceCounts(tx, outgoing.map((r) => r.to_object_id));
    return attachments.map((a) => a.storage_key);
  });
  deleteEventually(keys);
  return noContent();
}
async function renumber(tx, objectId) {
  await tx.query(
    `UPDATE blocks b SET position = r.n FROM (SELECT id, row_number() OVER (ORDER BY position, id) AS n FROM blocks WHERE object_id = $1) r
      WHERE b.id = r.id AND b.position <> r.n`,
    [objectId]
  );
}
async function backlinks(req) {
  if (!await loadObject(db, req.params.id)) throw notFound();
  const rows = await db.query(
    `SELECT le.id AS edge_id, le.from_object_id, o.title AS from_title, le.kind, le.field_name, le.quote_block_id AS block_id, le.created_at
       FROM link_edges le JOIN objects o ON o.id = le.from_object_id
      WHERE le.to_object_id = $1 ORDER BY le.created_at DESC, le.id DESC`,
    [req.params.id]
  );
  return ok({
    count: rows.length,
    backlinks: rows.map((r) => ({ edge_id: r.edge_id, from_object_id: r.from_object_id, from_title: r.from_title, kind: r.kind, field_name: r.field_name, block_id: r.block_id }))
  });
}
var objectRoutes = [
  route("GET", "/api/types", "none", listTypes),
  route("POST", "/api/types", "json", createType),
  route("POST", "/api/types/:id/fields", "json", addField),
  route("DELETE", "/api/types/:id", "none", deleteType),
  route("GET", "/api/objects", "none", listObjects),
  route("POST", "/api/objects", "json", createObject),
  route("GET", "/api/objects/:id", "none", getObject2),
  route("PATCH", "/api/objects/:id", "json", patchObject),
  route("DELETE", "/api/objects/:id", "none", deleteObject2),
  route("GET", "/api/objects/:id/backlinks", "none", backlinks)
];

// src/shared/diff.ts
function diffTokens(plain) {
  return plain.match(/\s+|\S+/g) ?? [];
}
function forwardTrace(a, b) {
  const n = a.length;
  const m = b.length;
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 1);
  const snapshots = [];
  for (let d = 0; d <= n + m; d++) {
    let done = false;
    for (let k = -d; k <= d && !done; k += 2) {
      let x = k === -d || k !== d && v[k - 1 + offset] < v[k + 1 + offset] ? v[k + 1 + offset] : v[k - 1 + offset] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      done = x >= n && y >= m;
    }
    snapshots.push(v.slice(offset - d - 1, offset + d + 2));
    if (done) break;
  }
  return { snapshots, at: (d, k) => snapshots[d][k + d + 1] };
}
function recoverSteps(a, b, trace) {
  const reversed = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.snapshots.length - 1; d > 0; d--) {
    const k = x - y;
    const insertion = k === -d || k !== d && trace.at(d - 1, k - 1) < trace.at(d - 1, k + 1);
    const prevK = insertion ? k + 1 : k - 1;
    const prevX = trace.at(d - 1, prevK);
    const prevY = prevX - prevK;
    const snakeStart = insertion ? prevX : prevX + 1;
    while (x > snakeStart) {
      x--;
      y--;
      reversed.push({ op: "equal", token: a[x] });
    }
    reversed.push(insertion ? { op: "insert", token: b[prevY] } : { op: "delete", token: a[prevX] });
    x = prevX;
    y = prevY;
  }
  while (x > 0) {
    x--;
    reversed.push({ op: "equal", token: a[x] });
  }
  return reversed.reverse();
}
function pushMerged(ops, op, text) {
  if (text === "") return;
  const last = ops[ops.length - 1];
  if (last !== void 0 && last.op === op) last.text += text;
  else ops.push({ op, text });
}
function wordDiff(fromPlain, toPlain) {
  const a = diffTokens(fromPlain);
  const b = diffTokens(toPlain);
  const steps = recoverSteps(a, b, forwardTrace(a, b));
  const ops = [];
  let deleted = "";
  let inserted = "";
  for (const step of steps) {
    if (step.op === "equal") {
      pushMerged(ops, "delete", deleted);
      pushMerged(ops, "insert", inserted);
      deleted = "";
      inserted = "";
      pushMerged(ops, "equal", step.token);
    } else if (step.op === "delete") deleted += step.token;
    else inserted += step.token;
  }
  pushMerged(ops, "delete", deleted);
  pushMerged(ops, "insert", inserted);
  return ops;
}

// src/shared/search.ts
var SEARCH_CAP = 200;
var RESULT_LIMIT = 20;
var TITLE_WEIGHT = 3;
var K1 = 1.2;
var B = 0.75;
var TYPO_MIN_LENGTH = 5;
var TYPO_FACTOR = 0.5;
var RECENCY_BOOST = 0.2;
var RECENCY_HALF_LIFE_DAYS = 14;
var SNIPPET_LENGTH = 80;
var SNIPPET_LEAD = 20;
var DAY_MS3 = 864e5;
function spannedTokens(text) {
  const tokens = [];
  let term = "";
  let start = 0;
  let end = 0;
  let at = 0;
  for (const cluster of text.match(/[\s\S][\p{M}ᅠ-ᇿힰ-퟿]*/gu) ?? []) {
    const width = Array.from(cluster).length;
    for (const ch of cluster.normalize("NFKC").toLowerCase()) {
      if (/[\p{L}\p{N}]/u.test(ch)) {
        if (term === "") start = at;
        term += ch;
        end = at + width;
      } else if (term !== "") {
        tokens.push({ term, start, end });
        term = "";
      }
    }
    at += width;
  }
  if (term !== "") tokens.push({ term, start, end });
  return tokens;
}
function searchTokens(text) {
  return spannedTokens(text).map((t) => t.term);
}
function isOneEditApart(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  const x = Array.from(a);
  const y = Array.from(b);
  if (Math.abs(x.length - y.length) > 1 || a === b) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  const skipLong = short.length < long.length ? 1 : 0;
  const skipShort = 1 - skipLong;
  for (let j = i; j + skipShort < short.length; j++) {
    if (short[j + skipShort] !== long[j + 1]) return false;
  }
  return true;
}
function indexDocument(doc) {
  const titleTokens = spannedTokens(doc.title);
  const blockTokens = doc.blockTexts.map(spannedTokens);
  const tf = /* @__PURE__ */ new Map();
  for (const t of titleTokens) tf.set(t.term, (tf.get(t.term) ?? 0) + TITLE_WEIGHT);
  let bodyLength = 0;
  for (const tokens of blockTokens) {
    bodyLength += tokens.length;
    for (const t of tokens) tf.set(t.term, (tf.get(t.term) ?? 0) + 1);
  }
  return { doc, titleTokens, blockTokens, tf, length: bodyLength + TITLE_WEIGHT * titleTokens.length };
}
function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS3);
}
function snippetFor(text, tokens, isMatch) {
  const chars = Array.from(text);
  const matched = tokens.filter((t) => isMatch(t.term));
  let from = 0;
  let to = chars.length;
  if (chars.length > SNIPPET_LENGTH) {
    from = Math.max(0, Math.min(matched[0].start - SNIPPET_LEAD, chars.length - SNIPPET_LENGTH));
    to = from + SNIPPET_LENGTH;
  }
  const segments = [];
  let at = from;
  for (const t of matched) {
    if (t.start < from || t.end > to) continue;
    if (t.start > at) segments.push({ text: chars.slice(at, t.start).join(""), match: false });
    segments.push({ text: chars.slice(t.start, t.end).join(""), match: true });
    at = t.end;
  }
  if (at < to) segments.push({ text: chars.slice(at, to).join(""), match: false });
  return segments;
}
function rankNotes(q, docs, today2) {
  const terms = [...new Set(searchTokens(q))];
  if (terms.length === 0) return [];
  const indexed = docs.map(indexDocument);
  const avgdl = indexed.reduce((sum, d) => sum + d.length, 0) / Math.max(1, indexed.length);
  const documentFrequency = /* @__PURE__ */ new Map();
  for (const d of indexed) for (const term of d.tf.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const idf = (term) => {
    const n = documentFrequency.get(term) ?? 0;
    return Math.log(1 + (indexed.length - n + 0.5) / (n + 0.5));
  };
  const typoTerms = /* @__PURE__ */ new Map();
  for (const term of terms) {
    if (Array.from(term).length < TYPO_MIN_LENGTH) continue;
    typoTerms.set(term, [...documentFrequency.keys()].filter((indexTerm) => isOneEditApart(term, indexTerm)));
  }
  const matching = /* @__PURE__ */ new Set([...terms, ...[...typoTerms.values()].flat()]);
  const isMatch = (token) => matching.has(token);
  const scored = [];
  for (const d of indexed) {
    const termScore = (term) => {
      const tf = d.tf.get(term) ?? 0;
      return tf === 0 ? 0 : idf(term) * tf * (K1 + 1) / (tf + K1 * (1 - B + B * d.length / avgdl));
    };
    let sum = 0;
    for (const term of terms) {
      let best = 0;
      for (const near of typoTerms.get(term) ?? []) best = Math.max(best, termScore(near));
      sum += Math.max(termScore(term), TYPO_FACTOR * best);
    }
    const total = sum * (1 + RECENCY_BOOST * 2 ** (-daysBetween(d.doc.updatedDate, today2) / RECENCY_HALF_LIFE_DAYS));
    if (total <= 0) continue;
    const titleMatches = d.titleTokens.some((t) => isMatch(t.term));
    const blockIndex = d.blockTokens.findIndex((tokens) => tokens.some((t) => isMatch(t.term)));
    const snippet = titleMatches ? snippetFor(d.doc.title, d.titleTokens, isMatch) : snippetFor(d.doc.blockTexts[blockIndex], d.blockTokens[blockIndex], isMatch);
    scored.push({
      total,
      result: {
        object_id: d.doc.objectId,
        title: d.doc.title,
        type_name: d.doc.typeName,
        score: Math.round(total * 1e4) / 1e4,
        snippet
      }
    });
  }
  scored.sort(
    (a, b) => b.total - a.total || compareText(a.result.title, b.result.title) || compareIds(a.result.object_id, b.result.object_id)
  );
  return scored.slice(0, RESULT_LIMIT).map((s) => s.result);
}

// src/server/routes/blocks.ts
var REVISIONS_KEPT = 200;
var EXCERPT_CHARS = 60;
var SEARCH_LIMIT = 20;
var EDIT_ID = /^[\x21-\x7e]{1,64}$/;
var BODY_TOO_LONG = "A block can hold at most 20,000 characters.";
var NOT_IN_NOTE = "That block is not in this note.";
var cut = (text, n) => [...text].slice(0, n).join("");
function storedBody(value, errors) {
  const body = typeof value === "string" ? sanitizeBody(value) : "";
  if (typeof value !== "string" || body.length > BLOCK_LIMIT) errors.add("body", BODY_TOO_LONG);
  return body;
}
async function slotAfter(tx, objectId, afterId) {
  if (afterId) {
    const after = await one(tx, "SELECT position FROM blocks WHERE id = $1 AND object_id = $2", [afterId, objectId]);
    if (after) {
      await tx.query("UPDATE blocks SET position = position + 1 WHERE object_id = $1 AND position > $2", [objectId, after.position]);
      return after.position + 1;
    }
  }
  const [{ n }] = await tx.query("SELECT COALESCE(max(position), 0)::int AS n FROM blocks WHERE object_id = $1", [objectId]);
  return n + 1;
}
async function afterIsValid(tx, objectId, afterId) {
  if (afterId === null || afterId === void 0) return true;
  if (!isUuid(afterId)) return false;
  return (await tx.query("SELECT 1 FROM blocks WHERE id = $1 AND object_id = $2", [afterId, objectId])).length > 0;
}
var touchObject = (tx, objectId) => tx.query("UPDATE objects SET updated_at = now() WHERE id = $1", [objectId]);
async function announceBlock(tx, blockId, extra) {
  const shown = await tx.query("SELECT id FROM blocks WHERE id = $1 OR origin_block_id = $1 ORDER BY (id = $1) DESC, id", [blockId]);
  for (const { id } of shown) {
    const b = await loadBlock(tx, id);
    if (b) await emit(tx, "block.saved", { object_id: b.object_id, block: blockJson(b), ...extra });
  }
}
async function insertTextBlock(tx, objectId, body, afterId, label) {
  const id = randomUUID4();
  const position = await slotAfter(tx, objectId, afterId);
  await tx.query(
    `INSERT INTO blocks (id, object_id, kind, position, body, plain, version, edited_at) VALUES ($1, $2, 'text', $3, $4, $5, 1, clock_timestamp())`,
    [id, objectId, position, body, plainText(body)]
  );
  await tx.query(
    `INSERT INTO revisions (block_id, version, body, ops, edit_kind, label, created_at) VALUES ($1, 1, $2, NULL, 'create', $3, clock_timestamp())`,
    [id, body, label]
  );
  await touchObject(tx, objectId);
  await announceBlock(tx, id, { ops: null, base_version: 0, label, edit_id: null });
  return id;
}
async function requireObject(tx, id) {
  if (!(await tx.query("SELECT 1 FROM objects WHERE id = $1", [id])).length) throw notFound();
}
async function createBlock(req) {
  const body = objectBody(req);
  const id = await transaction(async (tx) => {
    await requireObject(tx, req.params.id);
    const errors = new FieldErrors();
    const stored = storedBody(body.body, errors);
    if (!await afterIsValid(tx, req.params.id, body.after_block_id)) errors.add("after_block_id", NOT_IN_NOTE);
    errors.throwIfAny();
    return insertTextBlock(tx, req.params.id, stored, body.after_block_id ?? null, req.session.label);
  });
  return ok(blockJson(await blockOr404(db, id)), 201);
}
async function blockOr404(q, id) {
  const b = await loadBlock(q, id);
  if (!b) throw notFound();
  return b;
}
var conflict = async (tx, requestedId) => apiError(409, "version_conflict", { current: blockJson(await blockOr404(tx, requestedId)) });
async function lockOrigin(tx, requested) {
  if (requested.kind === "attachment") throw apiError(409, "not_editable");
  const origin = await one(
    tx,
    "SELECT id, object_id, body, version FROM blocks WHERE id = $1 FOR UPDATE",
    [requested.origin_block_id ?? requested.id]
  );
  if (!origin) throw notFound();
  return origin;
}
async function commitVersion(tx, origin, body, kind, ops, label, editId) {
  const version = origin.version + 1;
  await tx.query(
    "UPDATE blocks SET body = $2, plain = $3, version = $4, edited_at = clock_timestamp() WHERE id = $1",
    [origin.id, body, plainText(body), version]
  );
  await tx.query(
    `INSERT INTO revisions (block_id, version, body, ops, edit_kind, label, created_at) VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [origin.id, version, body, ops ? JSON.stringify(ops) : null, kind, label]
  );
  await tx.query("DELETE FROM revisions WHERE block_id = $1 AND version <= $2", [origin.id, version - REVISIONS_KEPT]);
  await touchObject(tx, origin.object_id);
  await announceBlock(tx, origin.id, { ops, base_version: origin.version, label, edit_id: editId });
}
async function transformOverLater(tx, blockId, base, ops) {
  const later = await tx.query(
    "SELECT ops, edit_kind FROM revisions WHERE block_id = $1 AND version > $2 ORDER BY version",
    [blockId, base]
  );
  let incoming = ops;
  for (const rev of later) {
    if (rev.edit_kind !== "ops" || !rev.ops) return null;
    const t = transformPair(rev.ops, incoming);
    if (!t) return null;
    incoming = t.incoming;
  }
  return incoming;
}
async function patchBlock(req) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  const base = body.base_version;
  if (typeof base !== "number" || !Number.isInteger(base) || base < 1) errors.add("base_version", "Send the version you started from.");
  if (body.edit_id !== void 0 && (typeof body.edit_id !== "string" || !EDIT_ID.test(body.edit_id))) errors.add("edit_id", "Use 1 to 64 visible characters.");
  const editId = typeof body.edit_id === "string" ? body.edit_id : null;
  const replacing = typeof body.body === "string" && body.ops === void 0;
  await transaction(async (tx) => {
    const requested = await blockOr404(tx, req.params.id);
    const origin = await lockOrigin(tx, requested);
    errors.throwIfAny();
    const baseVersion = base;
    if (replacing) {
      if (baseVersion !== origin.version) throw await conflict(tx, requested.id);
      const stored = storedBody(body.body, errors);
      errors.throwIfAny();
      await commitVersion(tx, origin, stored, "replace", null, req.session.label, editId);
      return;
    }
    if (baseVersion > origin.version) throw validation({ base_version: "Send the version you started from." });
    const baseRev = await one(tx, "SELECT body FROM revisions WHERE block_id = $1 AND version = $2", [origin.id, baseVersion]);
    if (!baseRev) throw await conflict(tx, requested.id);
    if (!opsFit(body.ops, editText(baseRev.body).length)) throw validation({ ops: `Those changes don't fit version ${baseVersion}.` });
    const merged = await transformOverLater(tx, origin.id, baseVersion, body.ops);
    if (!merged) throw await conflict(tx, requested.id);
    const next = applyOpsToBody(origin.body, merged);
    if (next.length > BLOCK_LIMIT) throw validation({ body: BODY_TOO_LONG });
    await commitVersion(tx, origin, next, "ops", merged, req.session.label, editId);
  });
  return ok(blockJson(await blockOr404(db, req.params.id)));
}
async function deleteBlock(req) {
  let reply = { status: 204 };
  let keys = [];
  await transaction(async (tx) => {
    const b = await blockOr404(tx, req.params.id);
    if (b.kind === "quote") {
      await lockObjects(tx, [b.origin_object_id]);
      await tx.query("DELETE FROM blocks WHERE id = $1", [b.id]);
      await renumber(tx, b.object_id);
      await touchObject(tx, b.object_id);
      await emit(tx, "block.removed", { object_id: b.object_id, block_id: b.id });
      const counts = await announceCounts(tx, [b.origin_object_id]);
      reply = { status: 200, body: { origin_object_id: b.origin_object_id, origin_backlinks: counts.get(b.origin_object_id) ?? 0 } };
      return;
    }
    if (b.kind === "text") {
      const [{ n }] = await tx.query("SELECT count(*)::int AS n FROM blocks WHERE origin_block_id = $1", [b.id]);
      if (n > 0) throw apiError(409, "block_quoted", { quoted_in: n });
    } else {
      keys = (await tx.query("SELECT storage_key FROM attachments WHERE id = $1", [b.attachment_id])).map((r) => r.storage_key);
    }
    await tx.query("DELETE FROM presence WHERE block_id = $1", [b.id]);
    await tx.query("DELETE FROM blocks WHERE id = $1", [b.id]);
    if (b.attachment_id) await tx.query("DELETE FROM attachments WHERE id = $1", [b.attachment_id]);
    await renumber(tx, b.object_id);
    await touchObject(tx, b.object_id);
    await emit(tx, "block.removed", { object_id: b.object_id, block_id: b.id });
  });
  deleteEventually(keys);
  return reply;
}
async function moveBlock(req) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    const b = await blockOr404(tx, req.params.id);
    if (b.kind === "attachment") throw apiError(409, "not_movable");
    const errors = new FieldErrors();
    const targetId = body.object_id;
    const target = isUuid(targetId) ? await one(tx, "SELECT id FROM objects WHERE id = $1", [targetId]) : void 0;
    if (!target) errors.add("object_id", "That note no longer exists.");
    else if (b.kind === "quote" && b.origin_object_id === target.id) errors.add("object_id", "Quote a block from another note.");
    else if (b.kind === "text" && (await tx.query("SELECT 1 FROM blocks WHERE origin_block_id = $1 AND object_id = $2", [b.id, target.id])).length) {
      errors.add("object_id", "That note quotes this block.");
    }
    if (target && (body.after_block_id === b.id || !await afterIsValid(tx, target.id, body.after_block_id))) errors.add("after_block_id", NOT_IN_NOTE);
    errors.throwIfAny();
    const to = target.id;
    const quotes = b.kind === "text" ? await tx.query("SELECT id FROM blocks WHERE origin_block_id = $1", [b.id]) : [];
    const countChanges = quotes.length ? [b.object_id, to] : [];
    await lockObjects(tx, [b.object_id, to, ...b.origin_object_id ? [b.origin_object_id] : []]);
    await placeBlock(tx, b.id, b.object_id, to, body.after_block_id ?? null);
    if (b.kind === "quote") await tx.query("UPDATE link_edges SET from_object_id = $2 WHERE quote_block_id = $1", [b.id, to]);
    if (quotes.length) await tx.query("UPDATE link_edges SET to_object_id = $2 WHERE quote_block_id = ANY($1::uuid[])", [quotes.map((q) => q.id), to]);
    await touchObject(tx, b.object_id);
    await touchObject(tx, to);
    await emit(tx, "block.removed", { object_id: b.object_id, block_id: b.id });
    await announceBlock(tx, b.id, { ops: null, base_version: b.version ?? 0, label: req.session.label, edit_id: null });
    await announceCounts(tx, countChanges);
  });
  return ok(blockJson(await blockOr404(db, req.params.id)));
}
async function placeBlock(tx, blockId, from, to, afterId) {
  await tx.query("UPDATE blocks SET object_id = $2 WHERE id = $1", [blockId, to]);
  if (from !== to) await renumber(tx, from);
  const ids = (await tx.query("SELECT id FROM blocks WHERE object_id = $1 AND id <> $2 ORDER BY position, id", [to, blockId])).map((r) => r.id);
  ids.splice(afterId ? ids.indexOf(afterId) + 1 : ids.length, 0, blockId);
  await tx.query("UPDATE blocks b SET position = x.n FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, n) WHERE b.id = x.id", [ids]);
}
async function quoteBlock(req) {
  const body = objectBody(req);
  const result = await transaction(async (tx) => {
    await requireObject(tx, req.params.id);
    const errors = new FieldErrors();
    const picked = isUuid(body.origin_block_id) ? await loadBlock(tx, body.origin_block_id) : void 0;
    const origin = picked?.kind === "quote" ? await loadBlock(tx, picked.origin_block_id) : picked;
    if (!origin) errors.add("origin_block_id", "That block no longer exists.");
    else if (origin.kind !== "text") errors.add("origin_block_id", "Only text blocks can be quoted.");
    else if (origin.object_id === req.params.id) errors.add("origin_block_id", "Quote a block from another note.");
    if (!await afterIsValid(tx, req.params.id, body.after_block_id)) errors.add("after_block_id", NOT_IN_NOTE);
    errors.throwIfAny();
    const o = origin;
    await lockObjects(tx, [o.object_id, req.params.id]);
    const id = randomUUID4();
    const position = await slotAfter(tx, req.params.id, body.after_block_id ?? null);
    await tx.query(
      `INSERT INTO blocks (id, object_id, kind, position, origin_block_id, edited_at) VALUES ($1, $2, 'quote', $3, $4, clock_timestamp())`,
      [id, req.params.id, position, o.id]
    );
    await addQuoteEdge(tx, req.params.id, o.object_id, id);
    await touchObject(tx, req.params.id);
    const quoteRow = await blockOr404(tx, id);
    await emit(tx, "block.saved", { object_id: req.params.id, block: blockJson(quoteRow), ops: null, base_version: 0, label: req.session.label, edit_id: null });
    const counts = await announceCounts(tx, [o.object_id]);
    return { block: blockJson(quoteRow), origin_backlinks: counts.get(o.object_id) ?? await backlinkCount(tx, o.object_id) };
  });
  return ok(result, 201);
}
async function postPresence(req) {
  const b = await blockOr404(db, req.params.id);
  if (b.kind === "attachment") throw apiError(409, "not_editable");
  await reportPresence(req.session, b.origin_block_id ?? b.id, objectBody(req));
  return noContent();
}
async function deletePresence(req) {
  const b = await loadBlock(db, req.params.id);
  if (b) await dropPresence(req.session.id, b.origin_block_id ?? b.id);
  return noContent();
}
async function historyBlock(id) {
  const b = await loadBlock(db, id);
  if (!b || b.kind === "attachment") throw notFound();
  return b.origin_block_id ?? b.id;
}
async function revisions(req) {
  const id = await historyBlock(req.params.id);
  const rows = await db.query(
    "SELECT version, body, label, created_at FROM revisions WHERE block_id = $1 ORDER BY version DESC",
    [id]
  );
  return ok({ revisions: rows.map((r) => ({ version: r.version, body: r.body, plain: plainText(r.body), label: r.label, created_at: r.created_at.toISOString() })) });
}
async function keptBody(blockId, version) {
  const v = typeof version === "string" && /^\d+$/.test(version) ? Number(version) : version;
  if (typeof v !== "number" || !Number.isInteger(v)) return void 0;
  return (await one(db, "SELECT body FROM revisions WHERE block_id = $1 AND version = $2", [blockId, v]))?.body;
}
async function diff(req) {
  const id = await historyBlock(req.params.id);
  const from = await keptBody(id, req.query.get("from"));
  const to = await keptBody(id, req.query.get("to"));
  const errors = new FieldErrors();
  if (from === void 0) errors.add("from", "That version is not kept.");
  if (to === void 0) errors.add("to", "That version is not kept.");
  errors.throwIfAny();
  return ok({ from: Number(req.query.get("from")), to: Number(req.query.get("to")), ops: wordDiff(plainText(from), plainText(to)) });
}
async function restore(req) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    const requested = await blockOr404(tx, req.params.id);
    const origin = await lockOrigin(tx, requested);
    if (typeof body.base_version !== "number" || !Number.isInteger(body.base_version)) throw validation({ base_version: "Send the version you started from." });
    if (body.base_version !== origin.version) throw await conflict(tx, requested.id);
    const kept = await keptBody(origin.id, body.version);
    if (kept === void 0) throw validation({ version: "That version is not kept." });
    await commitVersion(tx, origin, kept, "restore", null, req.session.label, null);
  });
  return ok(blockJson(await blockOr404(db, req.params.id)));
}
async function searchBlocks(req) {
  const q = (req.query.get("q") ?? "").trim();
  if ([...q].length > SEARCH_CAP) throw validation({ q: "Search with at most 200 characters." });
  const exclude = req.query.get("exclude_object_id");
  const rows = await db.query(
    `SELECT b.id, b.object_id, o.title, b.plain FROM blocks b JOIN objects o ON o.id = b.object_id
      WHERE b.kind = 'text' AND ($1 = '' OR strpos(lower(b.plain), lower($1)) > 0)
        AND ($2::uuid IS NULL OR b.object_id <> $2::uuid)
      ORDER BY b.edited_at DESC, b.id LIMIT $3`,
    [q, isUuid(exclude) ? exclude : null, SEARCH_LIMIT]
  );
  return ok({ results: rows.map((r) => ({ block_id: r.id, object_id: r.object_id, object_title: r.title, excerpt: cut(r.plain, EXCERPT_CHARS) })) });
}
var blockRoutes = [
  route("POST", "/api/objects/:id/blocks", "json", createBlock),
  route("GET", "/api/blocks/search", "none", searchBlocks),
  route("PATCH", "/api/blocks/:id", "json", patchBlock),
  route("DELETE", "/api/blocks/:id", "none", deleteBlock),
  route("POST", "/api/blocks/:id/move", "json", moveBlock),
  route("POST", "/api/blocks/:id/presence", "json", postPresence),
  route("DELETE", "/api/blocks/:id/presence", "none", deletePresence),
  route("GET", "/api/blocks/:id/revisions", "none", revisions),
  route("GET", "/api/blocks/:id/diff", "none", diff),
  route("POST", "/api/blocks/:id/restore", "json", restore),
  route("POST", "/api/objects/:id/quotes", "json", quoteBlock, { idempotent: true })
];

// src/shared/upload.ts
var startsWith = (bytes, sig, at = 0) => bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);
var ascii = (text) => [...text].map((c) => c.charCodeAt(0));
function detectUploadType(bytes) {
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (startsWith(bytes, [255, 216, 255])) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  return null;
}
function storedFilename(partName) {
  const base = partName.split(/[/\\]/).pop() ?? "";
  const cut2 = [...base.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()].slice(0, 200).join("");
  return cut2 === "" || cut2 === "." || cut2 === ".." ? "attachment" : cut2;
}
var isImageType = (type) => type.startsWith("image/");

// src/server/routes/attachments.ts
var FILE_LIMIT = 1e7;
function attachmentReply(bytes, contentType) {
  return {
    status: 200,
    bytes,
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": isImageType(contentType) ? "inline" : "attachment"
    }
  };
}
async function upload(req) {
  const objectId = req.params.id;
  if (!(await db.query("SELECT 1 FROM objects WHERE id = $1", [objectId])).length) throw notFound();
  const part = filePart(req.rawBody, header(req, "content-type") ?? "");
  if (!part) throw apiError(415, "unsupported_media_type");
  if (part.bytes.length > FILE_LIMIT) throw apiError(413, "too_large");
  const detected = detectUploadType(part.bytes);
  if (!detected || detected !== part.contentType) throw apiError(415, "unsupported_media_type");
  const attachmentId = randomUUID5();
  const key = `attachments/${objectId}/${attachmentId}`;
  const filename = storedFilename(part.filename);
  await orUnavailable(async () => {
    await putObject(key, part.bytes, detected);
    if (await objectSize(key) !== part.bytes.length) {
      deleteEventually([key]);
      throw apiError(503, "storage_unavailable");
    }
  }).catch((error) => {
    deleteEventually([key]);
    throw error;
  });
  let blockId;
  try {
    blockId = await transaction(async (tx) => {
      const exists = await one(tx, "SELECT 1 AS ok FROM objects WHERE id = $1 FOR UPDATE", [objectId]);
      if (!exists) throw notFound();
      await tx.query(
        "INSERT INTO attachments (id, object_id, filename, content_type, size_bytes, storage_key) VALUES ($1, $2, $3, $4, $5, $6)",
        [attachmentId, objectId, filename, detected, part.bytes.length, key]
      );
      const id = randomUUID5();
      const [{ n }] = await tx.query("SELECT COALESCE(max(position), 0)::int AS n FROM blocks WHERE object_id = $1", [objectId]);
      await tx.query(
        `INSERT INTO blocks (id, object_id, kind, position, attachment_id, edited_at) VALUES ($1, $2, 'attachment', $3, $4, clock_timestamp())`,
        [id, objectId, n + 1, attachmentId]
      );
      await touchObject(tx, objectId);
      const row = await blockOr404(tx, id);
      await emit(tx, "block.saved", { object_id: objectId, block: blockJson(row), ops: null, base_version: 0, label: req.session.label, edit_id: null });
      return id;
    });
  } catch (error) {
    deleteEventually([key]);
    throw error;
  }
  return ok(blockJson(await blockOr404(db, blockId)), 201);
}
async function download(req) {
  const row = await one(db, "SELECT storage_key, content_type FROM attachments WHERE id = $1", [req.params.id]);
  if (!row) throw notFound();
  const bytes = await orUnavailable(() => getObject(row.storage_key));
  if (!bytes) throw apiError(503, "storage_unavailable");
  return attachmentReply(bytes, row.content_type);
}
async function storage() {
  return ok({ storage: await storageAvailable() ? "available" : "unavailable" });
}
var attachmentRoutes = [
  route("POST", "/api/objects/:id/attachments", "multipart", upload),
  route("GET", "/api/attachments/:id", "none", download),
  route("GET", "/api/storage", "none", storage)
];

// src/server/routes/collections.ts
import { randomBytes as randomBytes3, randomUUID as randomUUID6 } from "node:crypto";

// src/server/share.ts
function linkStatus(link2, now = Date.now()) {
  if (link2.revoked_at) return "revoked";
  return now >= link2.expires_at.getTime() ? "expired" : "active";
}
function shareLinkJson(link2, zone) {
  const expires = link2.expires_at.getTime();
  return {
    id: link2.id,
    collection_id: link2.collection_id,
    url: `/s/${link2.token}`,
    status: linkStatus(link2),
    expires_at: localMinute(expires, zone),
    expires_at_display: expiresDisplay(expires, zone),
    expires_at_utc: iso(link2.expires_at),
    time_zone: zone,
    created_at: iso(link2.created_at),
    revoked_at: link2.revoked_at ? iso(link2.revoked_at) : null
  };
}
var SHARE_LINK_SELECT = "SELECT id, collection_id, token, expires_at, created_at, revoked_at FROM share_links";
var ACTIVE_LINK_SQL = "revoked_at IS NULL AND expires_at > now()";
async function linkByToken(q, token) {
  return one(q, `${SHARE_LINK_SELECT} WHERE token = $1`, [token]);
}
async function scopeOf(q, link2) {
  const rows = await q.query(
    `SELECT o.id FROM objects o JOIN collection_members cm ON cm.object_id = o.id
      WHERE cm.collection_id = $1 AND o.share_visibility = 'follow'`,
    [link2.collection_id]
  );
  return new Set(rows.map((r) => r.id));
}
var cacheKey = (linkId, objectId) => `share-cache/${linkId}/${objectId}.html`;
function writeShareCache(linkId, objectId, html, originObjectIds) {
  putObject(cacheKey(linkId, objectId), Buffer.from(html, "utf8"), "text/html; charset=utf-8").then(() => db.query(
    `INSERT INTO share_cache (share_link_id, object_id, origin_object_ids) VALUES ($1, $2, $3)
       ON CONFLICT (share_link_id, object_id) DO UPDATE SET origin_object_ids = EXCLUDED.origin_object_ids`,
    [linkId, objectId, originObjectIds]
  )).catch(() => void 0);
}
async function dropLinkCache(linkId) {
  await db.query("DELETE FROM share_cache WHERE share_link_id = $1", [linkId]);
  deletePrefixEventually(`share-cache/${linkId}/`);
}
async function dropObjectCache(objectId) {
  const rows = await db.query(
    "DELETE FROM share_cache WHERE object_id = $1 OR $1 = ANY(origin_object_ids) RETURNING share_link_id, object_id",
    [objectId]
  );
  deleteEventually(rows.map((r) => cacheKey(r.share_link_id, r.object_id)));
}

// src/shared/board.ts
var GRID = 8;
var BOARD_LIMIT = 8e3;
var DEFAULT_ORIGIN = 16;
var DEFAULT_COLUMNS = 4;
var DEFAULT_STEP_X = 256;
var DEFAULT_STEP_Y = 192;
function validCoord(v) {
  return Number.isInteger(v) && v % GRID === 0 && Math.abs(v) <= BOARD_LIMIT;
}
function defaultPosition(i) {
  return {
    x: DEFAULT_ORIGIN + i % DEFAULT_COLUMNS * DEFAULT_STEP_X,
    y: DEFAULT_ORIGIN + Math.floor(i / DEFAULT_COLUMNS) * DEFAULT_STEP_Y
  };
}

// src/server/routes/collections.ts
var MAX_DAYS_MS = 90 * 864e5;
var MAX_POSITIONS = 200;
var NAME_LIMIT2 = 120;
async function collectionOr404(q, id) {
  const row = await one(q, "SELECT id, name FROM collections WHERE id = $1", [id]);
  if (!row) throw notFound();
  return row;
}
async function listCollections() {
  const rows = await db.query(
    `SELECT c.id, c.name, (SELECT count(*)::int FROM collection_members m WHERE m.collection_id = c.id) AS object_count FROM collections c`
  );
  return ok({ collections: rows.sort((a, b) => compareText(a.name, b.name) || compareIds(a.id, b.id)) });
}
async function createCollection(req) {
  const body = objectBody(req);
  const created = await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(18473)");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || [...name].length > NAME_LIMIT2) throw validation({ name: "Give the collection a name." });
    if ((await tx.query("SELECT 1 FROM collections WHERE lower(name) = lower($1)", [name])).length) {
      throw validation({ name: "A collection with this name already exists." });
    }
    const id = randomUUID6();
    await tx.query("INSERT INTO collections (id, name, created_at) VALUES ($1, $2, now())", [id, name]);
    return { id, name, object_count: 0 };
  });
  return ok(created, 201);
}
async function members(collectionId) {
  return byTitle(await db.query(
    `${OBJECT_SELECT} WHERE o.id IN (SELECT object_id FROM collection_members WHERE collection_id = $1)`,
    [collectionId]
  ));
}
async function getCollection(req) {
  const c = await collectionOr404(db, req.params.id);
  const objects = [];
  for (const o of await members(c.id)) objects.push(objectJson(o, await fieldsOf(db, o.type_id)));
  return ok({ id: c.id, name: c.name, objects });
}
async function addMember(req) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const exists = isUuid(body.object_id) && (await tx.query("SELECT 1 FROM objects WHERE id = $1", [body.object_id])).length > 0;
    if (!exists) throw validation({ object_id: "That note no longer exists." });
    const added = await tx.query(
      "INSERT INTO collection_members (collection_id, object_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING object_id",
      [req.params.id, body.object_id]
    );
    if (added.length) await emit(tx, "object.saved", { object_id: body.object_id });
  });
  return noContent();
}
async function removeMember(req) {
  await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const removed = await tx.query(
      "DELETE FROM collection_members WHERE collection_id = $1 AND object_id = $2 RETURNING object_id",
      [req.params.id, req.params.objectId]
    );
    if (!removed.length) throw notFound();
    await tx.query("DELETE FROM board_positions WHERE collection_id = $1 AND object_id = $2", [req.params.id, req.params.objectId]);
    await emit(tx, "object.saved", { object_id: req.params.objectId });
  });
  return noContent();
}
async function deleteCollection(req) {
  const revoked = await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const links = await tx.query(
      `UPDATE share_links SET revoked_at = now() WHERE collection_id = $1 AND ${ACTIVE_LINK_SQL} RETURNING id`,
      [req.params.id]
    );
    const memberIds = await tx.query("SELECT object_id FROM collection_members WHERE collection_id = $1", [req.params.id]);
    await tx.query("DELETE FROM collections WHERE id = $1", [req.params.id]);
    for (const l of links) await emit(tx, "share_link.changed", { collection_id: req.params.id, share_link_id: l.id });
    for (const m of memberIds) await emit(tx, "object.saved", { object_id: m.object_id });
    return links.map((l) => l.id);
  });
  for (const id of revoked) await dropLinkCache(id);
  return noContent();
}
async function boardJson(collectionId) {
  const objects = await members(collectionId);
  const stored = new Map((await db.query(
    "SELECT object_id, x, y FROM board_positions WHERE collection_id = $1",
    [collectionId]
  )).map((p) => [p.object_id, p]));
  const ids = new Set(objects.map((o) => o.id));
  const edges = await db.query(
    "SELECT id, from_object_id, to_object_id FROM link_edges WHERE from_object_id = ANY($1::uuid[]) AND to_object_id = ANY($1::uuid[]) ORDER BY id",
    [[...ids]]
  );
  return {
    collection_id: collectionId,
    cards: objects.map((o, i) => {
      const p = stored.get(o.id);
      const at = p ?? defaultPosition(i);
      return { object_id: o.id, title: o.title, x: at.x, y: at.y, stored: Boolean(p) };
    }),
    edges: edges.map((e) => ({ id: e.id, from: e.from_object_id, to: e.to_object_id }))
  };
}
async function getBoard(req) {
  await collectionOr404(db, req.params.id);
  return ok(await boardJson(req.params.id));
}
async function putBoard(req) {
  const body = objectBody(req);
  await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const positions = Array.isArray(body.positions) ? body.positions : null;
    if (!positions || positions.length < 1 || positions.length > MAX_POSITIONS) throw validation({ positions: "Send 1 to 200 positions." });
    const memberIds = new Set((await tx.query("SELECT object_id FROM collection_members WHERE collection_id = $1", [req.params.id])).map((r) => r.object_id));
    const errors = new FieldErrors();
    const clean = [];
    positions.forEach((p, i) => {
      const e = p !== null && typeof p === "object" ? p : {};
      if (!isUuid(e.object_id) || !memberIds.has(e.object_id)) errors.add(`positions.${i}.object_id`, "That note is not in this collection.");
      if (!validCoord(e.x)) errors.add(`positions.${i}.x`, "Use a multiple of 8 between -8000 and 8000.");
      if (!validCoord(e.y)) errors.add(`positions.${i}.y`, "Use a multiple of 8 between -8000 and 8000.");
      clean.push({ object_id: e.object_id, x: e.x, y: e.y });
    });
    errors.throwIfAny();
    for (const p of clean) {
      await tx.query(`INSERT INTO board_positions (collection_id, object_id, x, y) VALUES ($1, $2, $3, $4)
                      ON CONFLICT (collection_id, object_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y`, [req.params.id, p.object_id, p.x, p.y]);
    }
    await emit(tx, "board.saved", { collection_id: req.params.id, positions: clean });
  });
  return ok(await boardJson(req.params.id));
}
async function listLinks(req) {
  await collectionOr404(db, req.params.id);
  const { home_time_zone: zone } = await loadSettings(db);
  const rows = await db.query(`${SHARE_LINK_SELECT} WHERE collection_id = $1 ORDER BY created_at DESC, id DESC`, [req.params.id]);
  return ok({ share_links: rows.map((l) => shareLinkJson(l, zone)) });
}
var newToken = () => randomBytes3(24).toString("base64url");
async function insertLink(tx, collectionId, expires) {
  const [row] = await tx.query(
    `INSERT INTO share_links (id, collection_id, token, expires_at, created_at) VALUES ($1, $2, $3, $4, clock_timestamp())
     RETURNING id, collection_id, token, expires_at, created_at, revoked_at`,
    [randomUUID6(), collectionId, newToken(), expires]
  );
  await emit(tx, "share_link.changed", { collection_id: collectionId, share_link_id: row.id });
  return row;
}
async function createLink(req) {
  const body = objectBody(req);
  const { home_time_zone: zone } = await loadSettings(db);
  const link2 = await transaction(async (tx) => {
    await collectionOr404(tx, req.params.id);
    const value = body.expires_at;
    if (!isLocalMinute(value)) throw validation({ expires_at: "Use a date and time." });
    const instant = localMinuteToInstant(value, zone);
    if (instant === null) throw validation({ expires_at: "That time does not exist in your home clock." });
    const now = Date.now();
    if (value <= localMinute(now, zone)) throw validation({ expires_at: "Choose a time after the current minute." });
    if (instant - now > MAX_DAYS_MS) throw validation({ expires_at: "Links can last at most 90 days." });
    return insertLink(tx, req.params.id, new Date(instant));
  });
  return ok(shareLinkJson(link2, zone), 201);
}
async function endLink(tx, id) {
  const current = await one(tx, `${SHARE_LINK_SELECT} WHERE id = $1`, [id]);
  if (!current) throw notFound();
  const [ended] = await tx.query(
    `UPDATE share_links SET revoked_at = clock_timestamp() WHERE id = $1 AND ${ACTIVE_LINK_SQL}
     RETURNING id, collection_id, token, expires_at, created_at, revoked_at`,
    [id]
  );
  if (!ended) {
    const fresh = await one(tx, `${SHARE_LINK_SELECT} WHERE id = $1`, [id]);
    throw apiError(409, "link_not_active", { status: linkStatus(fresh ?? current) });
  }
  await emit(tx, "share_link.changed", { collection_id: ended.collection_id, share_link_id: ended.id });
  return ended;
}
async function revokeLink(req) {
  const { home_time_zone: zone } = await loadSettings(db);
  const ended = await transaction((tx) => endLink(tx, req.params.id));
  await dropLinkCache(ended.id);
  return ok(shareLinkJson(ended, zone));
}
async function regenerateLink(req) {
  const { home_time_zone: zone } = await loadSettings(db);
  const { ended, fresh } = await transaction(async (tx) => {
    const old = await endLink(tx, req.params.id);
    return { ended: old, fresh: await insertLink(tx, old.collection_id, old.expires_at) };
  });
  await dropLinkCache(ended.id);
  return ok(shareLinkJson(fresh, zone), 201);
}
var collectionRoutes = [
  route("GET", "/api/collections", "none", listCollections),
  route("POST", "/api/collections", "json", createCollection),
  route("GET", "/api/collections/:id", "none", getCollection),
  route("DELETE", "/api/collections/:id", "none", deleteCollection),
  route("POST", "/api/collections/:id/objects", "json", addMember),
  route("DELETE", "/api/collections/:id/objects/:objectId", "none", removeMember),
  route("GET", "/api/collections/:id/board", "none", getBoard),
  route("PUT", "/api/collections/:id/board", "json", putBoard),
  route("GET", "/api/collections/:id/share-links", "none", listLinks),
  route("POST", "/api/collections/:id/share-links", "json", createLink),
  route("POST", "/api/share-links/:id/revoke", "none", revokeLink),
  route("POST", "/api/share-links/:id/regenerate", "none", regenerateLink)
];

// src/server/routes/daily.ts
import { randomUUID as randomUUID7 } from "node:crypto";
var RECENT = 7;
var EXCERPT_CHARS2 = 30;
async function dailyNote(tx, date) {
  const [type] = await tx.query("SELECT id FROM object_types WHERE builtin_rank = $1", [DAILY_RANK]);
  const inserted = await tx.query(
    `INSERT INTO objects (id, type_id, title, daily_date, properties, share_visibility, created_at, updated_at)
     VALUES ($1, $2, $3, $4::date, '{}', 'follow', now(), now()) ON CONFLICT (daily_date) DO NOTHING RETURNING id`,
    [randomUUID7(), type.id, date, date]
  );
  if (inserted.length) {
    await emit(tx, "object.saved", { object_id: inserted[0].id });
    return { id: inserted[0].id, created: true };
  }
  const [row] = await tx.query("SELECT id FROM objects WHERE daily_date = $1", [date]);
  return { id: row.id, created: false };
}
async function today() {
  const result = await transaction(async (tx) => {
    const { date } = await homeToday(tx);
    return { date, ...await dailyNote(tx, date) };
  });
  return ok({ date: result.date, object: await fullObject(db, result.id) ?? null }, result.created ? 201 : 200);
}
async function capture(req) {
  const body = objectBody(req);
  const errors = new FieldErrors();
  const stored = storedBody(body.body, errors);
  errors.throwIfAny();
  const result = await transaction(async (tx) => {
    const { date } = await homeToday(tx);
    const note = await dailyNote(tx, date);
    const after = typeof body.after_block_id === "string" ? await one(tx, "SELECT id FROM blocks WHERE id::text = $1 AND object_id = $2", [body.after_block_id, note.id]) : void 0;
    const id = await insertTextBlock(tx, note.id, stored, after?.id ?? null, req.session.label);
    return { date, objectId: note.id, id };
  });
  return ok({ date: result.date, object_id: result.objectId, block: blockJson(await blockOr404(db, result.id)) }, 201);
}
async function byDate(req) {
  const date = req.query.get("date");
  if (!isRealDate(date)) throw validation({ date: "Use YYYY-MM-DD." });
  const row = await one(db, "SELECT id FROM objects WHERE daily_date = $1", [date]);
  if (!row) throw notFound();
  return ok(await fullObject(db, row.id) ?? null);
}
async function recent() {
  const rows = await db.query(
    "SELECT daily_date, id FROM objects WHERE daily_date IS NOT NULL ORDER BY daily_date DESC LIMIT $1",
    [RECENT]
  );
  return ok({ notes: rows.map((r) => ({ date: r.daily_date, object_id: r.id })) });
}
async function timeline() {
  const { date: todayDate } = await homeToday(db);
  const notes = await db.query("SELECT id, daily_date FROM objects WHERE daily_date IS NOT NULL ORDER BY daily_date");
  const blocks = await db.query(
    `SELECT b.id, b.object_id, b.kind, b.plain, ob.plain AS origin_plain, a.filename
       FROM blocks b JOIN objects o ON o.id = b.object_id
       LEFT JOIN blocks ob ON ob.id = b.origin_block_id LEFT JOIN attachments a ON a.id = b.attachment_id
      WHERE o.daily_date IS NOT NULL ORDER BY b.position`
  );
  const byNote = new Map(notes.map((n) => [n.daily_date, n.id]));
  const first = notes.length && notes[0].daily_date < todayDate ? notes[0].daily_date : todayDate;
  const days = [];
  for (let d = first; d <= todayDate; d = addDays(d, 1)) {
    const objectId = byNote.get(d) ?? null;
    const own = objectId ? blocks.filter((b) => b.object_id === objectId) : [];
    days.push({
      date: d,
      object_id: objectId,
      block_count: own.length,
      blocks: own.map((b) => ({
        id: b.id,
        kind: b.kind,
        movable: b.kind !== "attachment",
        excerpt: [...(b.kind === "quote" ? b.origin_plain : b.kind === "attachment" ? b.filename : b.plain) ?? ""].slice(0, EXCERPT_CHARS2).join("")
      }))
    });
  }
  return ok({ today: todayDate, days });
}
var dailyRoutes = [
  route("POST", "/api/daily/today", "none", today),
  route("POST", "/api/daily/today/blocks", "json", capture, { idempotent: true }),
  route("GET", "/api/daily", "none", byDate),
  route("GET", "/api/daily/recent", "none", recent),
  route("GET", "/api/timeline", "none", timeline)
];

// src/server/routes/queries.ts
import { randomUUID as randomUUID8 } from "node:crypto";
var RESULT_CAP = 200;
var MAX_SORT_KEYS = 3;
async function graph(req) {
  const linkId = req.query.get("share_link_id");
  let scope = null;
  if (linkId !== null) {
    const link2 = isUuid(linkId) ? await one(db, `${SHARE_LINK_SELECT} WHERE id = $1`, [linkId]) : void 0;
    if (!link2 || linkStatus(link2) !== "active") throw validation({ share_link_id: "Choose an active share link." });
    scope = await scopeOf(db, link2);
  }
  const nodes = await db.query(OBJECT_SELECT);
  const edges = await db.query(
    "SELECT id, from_object_id, to_object_id, kind FROM link_edges ORDER BY id"
  );
  return ok({
    nodes: nodes.map((n) => ({
      id: n.id,
      title: n.title,
      type_id: n.type_id,
      type_name: n.type_name,
      collection_ids: n.collection_ids,
      backlinks: n.backlinks,
      ...scope ? { in_scope: scope.has(n.id) } : {}
    })),
    edges: edges.map((e) => ({ id: e.id, from: e.from_object_id, to: e.to_object_id, kind: e.kind }))
  });
}
async function search(req) {
  const q = req.query.get("q") ?? "";
  if ([...q.trim()].length > SEARCH_CAP) throw validation({ q: "Search with at most 200 characters." });
  if (q.trim() === "") return ok({ results: [] });
  const { date, zone } = await homeToday(db);
  const objects = await db.query(
    "SELECT o.id, o.title, t.name AS type_name, o.updated_at FROM objects o JOIN object_types t ON t.id = o.type_id"
  );
  const blocks = await db.query(`SELECT object_id, plain FROM blocks WHERE kind = 'text' ORDER BY object_id, position`);
  const texts = /* @__PURE__ */ new Map();
  for (const b of blocks) texts.set(b.object_id, [...texts.get(b.object_id) ?? [], b.plain]);
  const docs = objects.map((o) => ({
    objectId: o.id,
    title: o.title,
    typeName: o.type_name,
    blockTexts: texts.get(o.id) ?? [],
    updatedDate: homeDateOf(o.updated_at, zone)
  }));
  return ok({ results: rankNotes(q, docs, date) });
}
var queryType = (t) => ({
  id: t.id,
  name: t.name,
  fields: t.fields.map((f) => ({ name: f.name, kind: f.kind, options: f.options, targetTypeId: f.target_type_id }))
});
async function queryContext() {
  const types = await loadTypes(db);
  const { date, zone } = await homeToday(db);
  const rows = await db.query(OBJECT_SELECT);
  const objects = rows.map((o) => ({
    id: o.id,
    title: o.title,
    typeId: o.type_id,
    backlinks: o.backlinks,
    updatedDate: homeDateOf(o.updated_at, zone),
    properties: o.properties
  }));
  const byId = new Map(objects.map((o) => [o.id, o]));
  const typeById2 = new Map(types.map((t) => [t.id, queryType(t)]));
  return {
    ctx: { today: date, typeById: (id) => typeById2.get(id), objectById: (id) => byId.get(id) },
    types,
    objects,
    typeNames: new Map(rows.map((o) => [o.id, o.type_name])),
    updated: new Map(rows.map((o) => [o.id, iso(o.updated_at)]))
  };
}
var queryJson = (q) => ({ id: q.id, name: q.name, type_id: q.type_id, text: q.text, group_by: q.group_by, sort: q.sort });
var QUERY_SELECT = "SELECT id, name, type_id, text, group_by, sort FROM saved_queries";
function checkText(text, type, ctx, errors) {
  if (typeof text !== "string") {
    errors.add("text", "Unexpected end of query at column 1.");
    return;
  }
  if ([...text].length > QUERY_TEXT_CAP) {
    errors.add("text", "Use at most 500 characters.");
    return;
  }
  if (!type) return;
  const checked = checkQuery(text, type, ctx);
  if (!checked.ok) errors.add("text", checked.message);
}
async function check(req) {
  const body = objectBody(req);
  const { ctx } = await queryContext();
  const errors = new FieldErrors();
  const type = isUuid(body.type_id) ? ctx.typeById(body.type_id) : void 0;
  if (!type) errors.add("type_id", "Choose a type.");
  checkText(body.text, type, ctx, errors);
  errors.throwIfAny();
  return ok({ ok: true });
}
async function listQueries() {
  const rows = await db.query(QUERY_SELECT);
  return ok({ queries: rows.sort((a, b) => compareText(a.name, b.name) || compareIds(a.id, b.id)).map(queryJson) });
}
async function getQuery(req) {
  const row = await one(db, `${QUERY_SELECT} WHERE id = $1`, [req.params.id]);
  if (!row) throw notFound();
  return ok(queryJson(row));
}
async function createQuery(req) {
  const body = objectBody(req);
  const { ctx } = await queryContext();
  const errors = new FieldErrors();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.add("name", "Give the query a name.");
  const type = isUuid(body.type_id) ? ctx.typeById(body.type_id) : void 0;
  if (!type) errors.add("type_id", "Choose a type.");
  checkText(body.text, type, ctx, errors);
  const groupBy = body.group_by ?? null;
  if (groupBy !== null && (typeof groupBy !== "string" || !type || !groupField(type, groupBy))) {
    errors.add("group_by", "Group by a select, relation, date or text field of this type.");
  }
  const sort = Array.isArray(body.sort) ? body.sort : [];
  if (sort.length < 1 || sort.length > MAX_SORT_KEYS) errors.add("sort", "Use one to three sort keys.");
  else {
    sort.forEach((s, i) => {
      const entry = s !== null && typeof s === "object" ? s : {};
      if (typeof entry.key !== "string" || !type || !isSortKey(type, entry.key)) errors.add(`sort.${i}.key`, "That sort key is not on this type.");
      if (entry.dir !== "asc" && entry.dir !== "desc") errors.add(`sort.${i}.dir`, "Use asc or desc.");
    });
  }
  errors.throwIfAny();
  const row = {
    id: randomUUID8(),
    name,
    type_id: body.type_id,
    text: body.text,
    group_by: groupBy,
    sort: sort.map((s) => ({ key: s.key, dir: s.dir }))
  };
  await db.query(
    "INSERT INTO saved_queries (id, name, type_id, text, group_by, sort, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
    [row.id, row.name, row.type_id, row.text, row.group_by, JSON.stringify(row.sort)]
  );
  return ok(queryJson(row), 201);
}
async function results(req) {
  const saved = await one(db, `${QUERY_SELECT} WHERE id = $1`, [req.params.id]);
  if (!saved) throw notFound();
  const { ctx, objects, typeNames, updated } = await queryContext();
  const type = ctx.typeById(saved.type_id);
  const checked = type ? checkQuery(saved.text, type, ctx) : null;
  if (!type || !checked?.ok) return ok({ results: [], groups: null });
  const matching = objects.filter((o) => o.typeId === type.id && matches(checked.query, o, ctx));
  const sorted = sortObjects(matching, type, saved.sort, ctx).slice(0, RESULT_CAP);
  const row = (o) => ({ id: o.id, title: o.title, type_name: typeNames.get(o.id) ?? "", backlinks: o.backlinks, updated_at: updated.get(o.id) ?? "" });
  const field = saved.group_by ? groupField(type, saved.group_by) : void 0;
  return ok({
    results: sorted.map(row),
    groups: field ? groupObjects(sorted, field, ctx).map((g) => ({ key: g.key, label: g.label, count: g.rows.length, results: g.rows.map(row) })) : null
  });
}
async function deleteQuery(req) {
  const rows = await db.query("DELETE FROM saved_queries WHERE id = $1 RETURNING id", [req.params.id]);
  if (!rows.length) throw notFound();
  return noContent();
}
var queryRoutes = [
  route("GET", "/api/graph", "none", graph),
  route("GET", "/api/search", "none", search),
  route("GET", "/api/queries", "none", listQueries),
  route("POST", "/api/queries/check", "json", check),
  route("POST", "/api/queries", "json", createQuery),
  route("GET", "/api/queries/:id", "none", getQuery),
  route("GET", "/api/queries/:id/results", "none", results),
  route("DELETE", "/api/queries/:id", "none", deleteQuery)
];

// src/server/shareSurface.ts
var SHARE_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
var OUTSIDE_QUOTE = "Quoted from a note outside this share.";
var escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
async function link(token) {
  const found = await linkByToken(db, token);
  if (!found) throw statusBody(404, "unknown");
  return found;
}
async function activeLink(token) {
  const found = await link(token);
  const status2 = linkStatus(found);
  if (status2 !== "active") throw statusBody(410, status2);
  return found;
}
async function status(token) {
  const found = await link(token);
  const { home_time_zone: zone } = await loadSettings(db);
  return { status: linkStatus(found), expires_at_display: expiresDisplay(found.expires_at.getTime(), zone) };
}
async function collection(token) {
  const found = await activeLink(token);
  const { home_time_zone: zone } = await loadSettings(db);
  const scope = await scopeOf(db, found);
  const [c] = await db.query("SELECT name FROM collections WHERE id = $1", [found.collection_id]);
  const objects = byTitle(await db.query(
    `SELECT o.id, o.title, t.name AS type_name FROM objects o JOIN object_types t ON t.id = o.type_id
      WHERE o.id = ANY($1::uuid[])`,
    [[...scope]]
  ));
  return { status: "active", collection: { name: c?.name ?? "" }, expires_at_display: expiresDisplay(found.expires_at.getTime(), zone), objects };
}
async function sharedObject(token, objectId) {
  const found = await activeLink(token);
  const scope = await scopeOf(db, found);
  if (!isUuid(objectId) || !scope.has(objectId)) throw apiError(404, "not_in_share");
  const o = await loadObject(db, objectId);
  if (!o) throw apiError(404, "not_in_share");
  const fields = await fieldsOf(db, o.type_id);
  const properties = {};
  for (const f of fields) {
    const value = o.properties[f.name] ?? null;
    if (f.kind !== "relation") properties[f.name] = value;
    else if (typeof value === "string" && scope.has(value)) {
      const target = await loadObject(db, value);
      if (target) properties[f.name] = target.title;
    }
  }
  const blocks = [];
  const html = [`<article><h1>${escapeHtml(o.title)}</h1>`];
  const origins = [];
  for (const b of await loadBlocks(db, objectId)) {
    if (b.kind === "text") {
      blocks.push({ id: b.id, kind: "text", position: b.position, body: b.body });
      html.push(`<div class="block">${renderBody(b.body ?? "")}</div>`);
    } else if (b.kind === "quote") {
      if (b.origin_object_id && scope.has(b.origin_object_id)) {
        blocks.push({ id: b.id, kind: "quote", position: b.position, body: b.body, origin: { object_id: b.origin_object_id, object_title: b.origin_title } });
        html.push(`<figure><blockquote>${renderBody(b.body ?? "")}</blockquote><figcaption>Quoted from ${escapeHtml(b.origin_title ?? "")}</figcaption></figure>`);
        origins.push(b.origin_object_id);
      } else {
        blocks.push({ kind: "quote", hidden: true });
        html.push(`<figure><p>${OUTSIDE_QUOTE}</p></figure>`);
      }
    } else {
      blocks.push({ id: b.id, kind: "attachment", position: b.position, attachment: { id: b.attachment_id, filename: b.filename, content_type: b.content_type, size_bytes: b.size_bytes } });
      html.push(`<figure><figcaption>${escapeHtml(b.filename ?? "")}</figcaption></figure>`);
    }
  }
  html.push("</article>");
  const backlinks2 = (await db.query(
    `SELECT le.from_object_id, o.title AS from_title, le.kind FROM link_edges le JOIN objects o ON o.id = le.from_object_id
      WHERE le.to_object_id = $1 ORDER BY le.created_at DESC, le.id DESC`,
    [objectId]
  )).filter((b) => scope.has(b.from_object_id));
  writeShareCache(found.id, objectId, html.join(""), origins);
  return { id: o.id, title: o.title, type_name: o.type_name, properties, blocks, backlinks: backlinks2 };
}
async function sharedAttachment(token, attachmentId) {
  const found = await activeLink(token);
  const scope = await scopeOf(db, found);
  const [row] = isUuid(attachmentId) ? await db.query(
    "SELECT object_id, storage_key, content_type FROM attachments WHERE id = $1",
    [attachmentId]
  ) : [];
  if (!row || !scope.has(row.object_id)) throw apiError(404, "not_in_share");
  const bytes = await orUnavailable(() => getObject(row.storage_key));
  if (!bytes) throw apiError(503, "storage_unavailable");
  return attachmentReply(bytes, row.content_type);
}
async function shareApi(method, path2) {
  const parts = path2.split("/").slice(2).map((p) => decodeURIComponent(p));
  if (method !== "GET" && method !== "HEAD") return errorReply(apiError(405, "read_only", {}, { Allow: "GET, HEAD" }));
  const [token, ...rest] = parts;
  if (!token) return null;
  try {
    if (rest.length === 0 || rest.length === 2 && rest[0] === "o") return "page";
    if (rest[0] !== "api") return null;
    if (rest.length === 2 && rest[1] === "status") return { status: 200, body: await status(token) };
    if (rest.length === 2 && rest[1] === "collection") return { status: 200, body: await collection(token) };
    if (rest.length === 3 && rest[1] === "objects") return { status: 200, body: await sharedObject(token, rest[2]) };
    if (rest.length === 3 && rest[1] === "attachments") return await sharedAttachment(token, rest[2]);
    return null;
  } catch (error) {
    if (error instanceof HttpError) return errorReply(error);
    throw error;
  }
}

// src/shared/motion.ts
var QUIRE_CURVE_CSS = "cubic-bezier(0.2, 0, 0, 1)";
var FADE_MS = 120;
var PRESS_MS = 100;
var ARRIVAL_MARK_MS = 2e3;
var SPRING_STIFFNESS = 400;
var SPRING_MASS = 1;
var SPRING_OMEGA = Math.sqrt(SPRING_STIFFNESS / SPRING_MASS);

// src/shared/tokens.ts
var TOKEN_NAMES = ["paper", "ink", "rule", "accent", "link"];
var TOKEN_VARS = {
  paper: "--quire-paper",
  ink: "--quire-ink",
  rule: "--quire-rule",
  accent: "--quire-accent",
  link: "--quire-link"
};
var THEMES = {
  paper: {
    paper: [244, 240, 230],
    ink: [31, 28, 24],
    rule: [207, 198, 180],
    accent: [178, 58, 36],
    link: [47, 107, 106]
  },
  lamplight: {
    paper: [30, 26, 21],
    ink: [237, 228, 211],
    rule: [74, 65, 54],
    accent: [224, 103, 76],
    link: [127, 184, 181]
  }
};
function rgbCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
function tokenCss(theme) {
  const paper = THEMES[theme].paper;
  const tokens = TOKEN_NAMES.map((name) => `${TOKEN_VARS[name]}: ${rgbCss(THEMES[theme][name])};`).join(" ");
  return `${tokens} --quire-clear: rgb(${paper[0]} ${paper[1]} ${paper[2]} / 0);`;
}

// src/server/tokensCss.ts
var TOKENS_CSS = [
  `:root, :root[data-theme="paper"] { ${tokenCss("paper")} }`,
  `:root[data-theme="lamplight"] { ${tokenCss("lamplight")} }`,
  `:root { --curve: ${QUIRE_CURVE_CSS}; --press-ms: ${PRESS_MS}ms; --fade-ms: ${FADE_MS}ms; --arrival-ms: ${ARRIVAL_MARK_MS}ms; }`
].join("\n");

// src/server/app.ts
var HERE = path.dirname(fileURLToPath(import.meta.url));
var PUBLIC = path.join(HERE, "public");
var FONTS = path.join(HERE, "..", "public", "fonts");
var ready = false;
var markReady = () => {
  ready = true;
};
var HEALTH_PATH = "/api/health";
var routes = [...accountRoutes, ...objectRoutes, ...blockRoutes, ...dailyRoutes, ...attachmentRoutes, ...queryRoutes, ...collectionRoutes];
var MUTATING = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
var WORKSPACE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
var WORKSPACE_PATH = /^\/(today|timeline|queries|graph|settings|o\/[^/]+|types\/[^/]+|collections\/[^/]+|collections\/[^/]+\/board|queries\/[^/]+)$/;
var ASSETS = /* @__PURE__ */ new Map([["main.js", "text/javascript"], ["main.css", "text/css"], ["share.js", "text/javascript"], ["share.css", "text/css"]]);
var FONT_FILE = /^[a-z0-9-]+\.woff2$/;
var PRELOADED_FONTS = [
  "source-serif-4-latin-400-normal",
  "source-serif-4-latin-600-normal",
  "source-serif-4-latin-400-italic",
  "fraunces-latin-400-normal",
  "fraunces-latin-600-normal",
  "fraunces-latin-400-italic",
  "ibm-plex-mono-latin-400-normal",
  "ibm-plex-mono-latin-500-normal"
];
function shell(entry, theme) {
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quire</title>
${PRELOADED_FONTS.map((f) => `<link rel="preload" href="/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join("\n")}
<link rel="stylesheet" href="/assets/tokens.css">
<link rel="stylesheet" href="/assets/${entry}.css">
<script type="module" src="/assets/${entry}.js"></script>
</head>
<body><div id="root"></div></body>
</html>`;
}
async function apiReply(raw, res, url) {
  const method = raw.method ?? "GET";
  if (url.pathname === HEALTH_PATH && (method === "GET" || method === "HEAD")) {
    return ready ? { status: 200, body: { status: "ok" } } : errorReply(statusBody(503, "starting"));
  }
  const found = match(routes, method, url.pathname);
  if (found === null || found === "method") throw notFound();
  if (!ready) return errorReply(statusBody(503, "starting"));
  const { route: r, params, unknownResource } = found;
  const { rawBody, body } = await acceptBody(raw, r.body);
  const req = {
    method,
    path: url.pathname,
    query: url.searchParams,
    headers: raw.headers,
    params,
    rawBody,
    body,
    raw,
    res,
    clientAddress: raw.socket.remoteAddress ?? "",
    session: { id: "", csrfToken: "", label: "" }
  };
  if (!r.open) {
    req.session = await authenticate(req);
    if (MUTATING.has(method)) requireCsrf(req, req.session);
  }
  const key = r.idempotent ? idempotencyKey(req) : null;
  const run = async () => {
    if (unknownResource) throw notFound();
    return r.handler(req);
  };
  return key ? withIdempotency(req, key, run) : run();
}
async function serveFile(file, type) {
  try {
    return { status: 200, bytes: await readFile(file), headers: { "Content-Type": type, "Cache-Control": "no-cache" } };
  } catch {
    throw notFound();
  }
}
async function handle(raw, res) {
  const url = new URL(raw.url ?? "/", "http://quire.local");
  const method = raw.method ?? "GET";
  const p = url.pathname;
  try {
    if (p === "/s" || p.startsWith("/s/")) {
      const reply = await shareApi(method, p);
      if (reply === "page") return send(res, { status: 200, bytes: Buffer.from(shell("share", "paper")), headers: { ...SHARE_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
      const answer = reply ?? errorReply(notFound());
      return send(res, { ...answer, headers: { ...answer.headers, ...SHARE_HEADERS } });
    }
    if (p === "/api" || p.startsWith("/api/")) {
      const reply = await apiReply(raw, res, url);
      if (reply.status !== 0) send(res, reply);
      return;
    }
    if (method !== "GET" && method !== "HEAD") throw apiError(405, "method_not_allowed");
    if (p === "/assets/tokens.css") return send(res, { status: 200, bytes: Buffer.from(TOKENS_CSS), headers: { "Content-Type": "text/css", "Cache-Control": "no-cache" } });
    if (p.startsWith("/assets/") && ASSETS.has(p.slice(8))) return send(res, await serveFile(path.join(PUBLIC, p.slice(8)), ASSETS.get(p.slice(8))));
    if (p.startsWith("/fonts/") && FONT_FILE.test(p.slice(7))) return send(res, await serveFile(path.join(FONTS, p.slice(7)), "font/woff2"));
    const session = ready ? await optionalSession(header(raw, "cookie")) : null;
    const page = (status2) => ({
      status: status2,
      bytes: Buffer.from(shell("main", session?.theme ?? "paper")),
      headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": WORKSPACE_CSP, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
    });
    if (p === "/") return send(res, { status: 302, headers: { Location: session ? "/today" : "/sign-in" } });
    if (p === "/sign-in") {
      if (session) return send(res, { status: 302, headers: { Location: "/today" } });
      return send(res, page(200));
    }
    if (WORKSPACE_PATH.test(p)) {
      if (!session) return send(res, { status: 302, headers: { Location: `/sign-in?return=${encodeURIComponent(p + url.search)}` } });
      return send(res, page(200));
    }
    return send(res, page(404));
  } catch (error) {
    if (error instanceof HttpError) return send(res, errorReply(error));
    console.error("request failed", method, p, error instanceof Error ? error.message : "error");
    if (!res.headersSent) send(res, errorReply(apiError(500, "server_error")));
    else res.end();
  }
}

// src/server/seed.ts
import { randomUUID as randomUUID9 } from "node:crypto";

// src/server/schema.ts
var SCHEMA = `
CREATE TABLE IF NOT EXISTS owner_account (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_settings (
  id int PRIMARY KEY CHECK (id = 1),
  home_time_zone text NOT NULL,
  theme text NOT NULL CHECK (theme IN ('paper', 'lamplight'))
);
CREATE TABLE IF NOT EXISTS device_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE TABLE IF NOT EXISTS sign_in_failures (
  identity_kind text NOT NULL,
  identity text NOT NULL,
  failed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_failures_identity ON sign_in_failures (identity_kind, identity, failed_at);
CREATE TABLE IF NOT EXISTS sign_in_locks (
  identity_kind text NOT NULL,
  identity text NOT NULL,
  locked_until timestamptz NOT NULL,
  PRIMARY KEY (identity_kind, identity)
);
CREATE TABLE IF NOT EXISTS object_types (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  builtin_rank int,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS object_types_name ON object_types (lower(name));
CREATE TABLE IF NOT EXISTS fields (
  id uuid PRIMARY KEY,
  type_id uuid NOT NULL REFERENCES object_types(id) ON DELETE CASCADE,
  position int NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  required boolean NOT NULL,
  options jsonb,
  target_type_id uuid REFERENCES object_types(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fields_name ON fields (type_id, lower(name));
CREATE TABLE IF NOT EXISTS objects (
  id uuid PRIMARY KEY,
  type_id uuid NOT NULL REFERENCES object_types(id),
  title text NOT NULL,
  daily_date date UNIQUE,
  properties jsonb NOT NULL DEFAULT '{}',
  share_visibility text NOT NULL DEFAULT 'follow',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS blocks (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('text', 'quote', 'attachment')),
  position int NOT NULL,
  body text,
  plain text,
  version int,
  origin_block_id uuid REFERENCES blocks(id),
  attachment_id uuid REFERENCES attachments(id) ON DELETE CASCADE,
  edited_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS blocks_object ON blocks (object_id, position);
CREATE INDEX IF NOT EXISTS blocks_origin ON blocks (origin_block_id);
CREATE TABLE IF NOT EXISTS revisions (
  block_id uuid NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  version int NOT NULL,
  body text NOT NULL,
  ops jsonb,
  edit_kind text NOT NULL CHECK (edit_kind IN ('create', 'ops', 'replace', 'restore')),
  label text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (block_id, version)
);
CREATE TABLE IF NOT EXISTS link_edges (
  id uuid PRIMARY KEY,
  from_object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quote', 'relation')),
  quote_block_id uuid REFERENCES blocks(id) ON DELETE CASCADE,
  field_name text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS link_edges_to ON link_edges (to_object_id);
CREATE INDEX IF NOT EXISTS link_edges_from ON link_edges (from_object_id);
CREATE TABLE IF NOT EXISTS presence (
  session_id uuid NOT NULL,
  block_id uuid NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  anchor int NOT NULL,
  head int NOT NULL,
  version int NOT NULL,
  reported_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, block_id)
);
CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_name ON collections (lower(name));
CREATE TABLE IF NOT EXISTS collection_members (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, object_id)
);
CREATE TABLE IF NOT EXISTS board_positions (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  x int NOT NULL,
  y int NOT NULL,
  PRIMARY KEY (collection_id, object_id)
);
CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS saved_queries (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  type_id uuid NOT NULL REFERENCES object_types(id) ON DELETE CASCADE,
  text text NOT NULL,
  group_by text,
  sort jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  endpoint text NOT NULL,
  key text NOT NULL,
  request jsonb NOT NULL,
  status int NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (key)
);
CREATE TABLE IF NOT EXISTS sync_sequence (
  id int PRIMARY KEY CHECK (id = 1),
  last_id bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_events (
  id bigint PRIMARY KEY,
  event text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS share_cache (
  share_link_id uuid NOT NULL,
  object_id uuid NOT NULL,
  origin_object_ids uuid[] NOT NULL,
  PRIMARY KEY (share_link_id, object_id)
);
INSERT INTO sync_sequence (id, last_id) VALUES (1, 0) ON CONFLICT DO NOTHING;
`;

// src/server/seed.ts
var SEED_LABEL = "Seed";
async function addType(tx, name, rank, fields) {
  const id = randomUUID9();
  await tx.query("INSERT INTO object_types (id, name, builtin_rank, created_at) VALUES ($1, $2, $3, now())", [id, name, rank]);
  for (const [i, [field, kind, options, target]] of fields.entries()) {
    await tx.query(
      "INSERT INTO fields (id, type_id, position, name, kind, required, options, target_type_id) VALUES ($1, $2, $3, $4, $5, false, $6, $7)",
      [randomUUID9(), id, i, field, kind, options ? JSON.stringify(options) : null, target]
    );
  }
  return id;
}
async function addObject(tx, typeId, title, properties, sharing = "follow") {
  const id = randomUUID9();
  await tx.query(
    "INSERT INTO objects (id, type_id, title, properties, share_visibility, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())",
    [id, typeId, title, JSON.stringify(properties), sharing]
  );
  return id;
}
async function addTextBlock(tx, objectId, position, text) {
  const id = randomUUID9();
  const body = textToBody(text);
  await tx.query(
    `INSERT INTO blocks (id, object_id, kind, position, body, plain, version, edited_at) VALUES ($1, $2, 'text', $3, $4, $5, 1, now())`,
    [id, objectId, position, body, plainText(body)]
  );
  await tx.query(
    `INSERT INTO revisions (block_id, version, body, ops, edit_kind, label, created_at) VALUES ($1, 1, $2, NULL, 'create', $3, now())`,
    [id, body, SEED_LABEL]
  );
  return id;
}
async function addQuote(tx, hostId, position, originBlockId, originObjectId) {
  const id = randomUUID9();
  await tx.query(
    `INSERT INTO blocks (id, object_id, kind, position, origin_block_id, edited_at) VALUES ($1, $2, 'quote', $3, $4, now())`,
    [id, hostId, position, originBlockId]
  );
  await tx.query(
    `INSERT INTO link_edges (id, from_object_id, to_object_id, kind, quote_block_id, created_at) VALUES ($1, $2, $3, 'quote', $4, now())`,
    [randomUUID9(), hostId, originObjectId, id]
  );
}
async function addRelation(tx, fromId, toId, field) {
  await tx.query(
    `INSERT INTO link_edges (id, from_object_id, to_object_id, kind, field_name, created_at) VALUES ($1, $2, $3, 'relation', $4, now())`,
    [randomUUID9(), fromId, toId, field]
  );
}
async function applySchemaAndSeed() {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(18470)");
    await tx.query(SCHEMA);
    const [existing] = await tx.query("SELECT id FROM owner_account");
    if (existing) return;
    await tx.query(
      "INSERT INTO owner_account (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
      [randomUUID9(), "tamsin@oakgall.test", "Tamsin Okoro", await hashPassword("commonplace-1847")]
    );
    await tx.query(`INSERT INTO workspace_settings (id, home_time_zone, theme) VALUES (1, 'Europe/London', 'paper')`);
    const person = await addType(tx, "Person", 1, [["Affiliation", "text", null, null]]);
    const source = await addType(tx, "Source", 0, [
      ["Author", "relation", null, person],
      ["Year", "number", null, null],
      ["Kind", "select", ["Book", "Article", "Chapter", "Thesis"], null],
      ["Link", "url", null, null]
    ]);
    const conceptType = await addType(tx, "Concept", 2, [["Definition", "text", null, null]]);
    await addType(tx, "Daily note", 3, []);
    const hesper = await addObject(tx, person, "Hesper Vane", { Affiliation: "Collegium of Lower Fen" });
    const odile = await addObject(tx, person, "Odile Marchetti", { Affiliation: "Saltmarsh Institute" });
    const margin = await addObject(tx, source, "The Gathered Margin", { Author: hesper, Year: 1987, Kind: "Book" });
    const lamplight = await addObject(tx, source, "Reading by Lamplight", { Author: odile, Year: 2011, Kind: "Article" });
    const florilegium = await addObject(tx, conceptType, "Florilegium", { Definition: "A gathering of excerpts arranged for reuse." });
    const chapter = await addObject(tx, conceptType, "Chapter three argument", { Definition: null }, "never");
    await addRelation(tx, margin, hesper, "Author");
    await addRelation(tx, lamplight, odile, "Author");
    const marginFirst = await addTextBlock(tx, margin, 1, "Every reader keeps two books: the one in hand and the one they write in its margins.");
    await addTextBlock(tx, margin, 2, "A heading is a promise to return.");
    const lamplightBlock = await addTextBlock(tx, lamplight, 1, "Lamplight narrows the page until only one line can be trusted at a time.");
    await addTextBlock(tx, florilegium, 1, "Gathered under one heading, borrowed lines start to argue with each other.");
    await addQuote(tx, florilegium, 2, marginFirst, margin);
    await addQuote(tx, florilegium, 3, lamplightBlock, lamplight);
    await addTextBlock(tx, chapter, 1, "The margin is where the argument starts, not where it ends.");
    await addQuote(tx, chapter, 2, lamplightBlock, lamplight);
    const collection2 = randomUUID9();
    await tx.query(`INSERT INTO collections (id, name, created_at) VALUES ($1, 'Advisor reading \u2014 autumn', now())`, [collection2]);
    for (const member of [margin, florilegium, chapter]) {
      await tx.query("INSERT INTO collection_members (collection_id, object_id) VALUES ($1, $2)", [collection2, member]);
    }
    await tx.query(
      `INSERT INTO saved_queries (id, name, type_id, text, group_by, sort, created_at) VALUES ($1, 'Sources by backlinks', $2, '', NULL, $3, now())`,
      [randomUUID9(), source, JSON.stringify([{ key: "@backlinks", dir: "desc" }])]
    );
  });
}

// src/server/main.ts
var DB_RETRY_MS = 2e3;
async function boot() {
  for (; ; ) {
    try {
      await applySchemaAndSeed();
      await initEvents();
      break;
    } catch (error) {
      console.error("database not ready:", error instanceof Error ? error.message : "unknown error");
      await new Promise((resolve) => setTimeout(resolve, DB_RETRY_MS));
    }
  }
  startIdleSweep();
  sweepIdempotency();
  onEvent((event, data) => {
    if ((event === "object.saved" || event === "object.removed") && data && typeof data === "object" && !Array.isArray(data)) {
      void dropObjectCache(String(data.object_id)).catch(() => void 0);
    }
  });
  void storageAvailable().then((up) => {
    if (!up) console.error("object store unreachable at start; attachments wait for it");
  });
  markReady();
}
var server = createServer((req, res) => void handle(req, res));
server.requestTimeout = 0;
server.listen(config.port, "0.0.0.0", () => console.log(`Quire listening on port ${config.port}`));
void boot();
