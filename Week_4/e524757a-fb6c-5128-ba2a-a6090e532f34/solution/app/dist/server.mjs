var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// server/config.ts
import { fileURLToPath } from "node:url";
function text(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === void 0) throw new Error(`${name} is not set`);
  return value;
}
function number(name, fallback) {
  return Number(text(name, String(fallback)));
}
var port, config, SESSION_SECONDS;
var init_config = __esm({
  "server/config.ts"() {
    "use strict";
    port = number("APP_PUBLIC_PORT", 4173);
    config = {
      port,
      publicUrl: text("APP_PUBLIC_URL", `http://localhost:${port}`).replace(/\/$/, ""),
      publicDir: text("PUBLIC_DIR", fileURLToPath(new URL("./public", import.meta.url))),
      databaseUrl: text("DATABASE_URL"),
      s3: {
        endpoint: text("S3_ENDPOINT").replace(/\/$/, ""),
        region: text("S3_REGION"),
        bucket: text("S3_BUCKET"),
        pathStyle: text("S3_FORCE_PATH_STYLE", "true") === "true",
        accessKeyId: text("S3_ACCESS_KEY_ID"),
        secretAccessKey: text("S3_SECRET_ACCESS_KEY")
      },
      smtp: { host: text("SMTP_HOST"), port: number("SMTP_PORT", 1025) },
      mailFrom: text("MAIL_FROM", "Hushfoot <hello@hushfoot.example>"),
      gradingRoutes: process.env.GRADING_ROUTES === "on",
      worldTickMs: number("WORLD_TICK_MS", 100),
      worldDayTicks: number("WORLD_DAY_TICKS", 14400),
      duskStartHour: number("DUSK_START_HOUR", 18),
      duskEndHour: number("DUSK_END_HOUR", 20),
      rainStartHour: number("RAIN_START_HOUR", 6),
      rainEndHour: number("RAIN_END_HOUR", 9),
      photoTickGrace: number("PHOTO_TICK_GRACE", 30),
      photoMaxBytes: number("PHOTO_MAX_BYTES", 2e6),
      liveIntervalMs: number("LIVE_INTERVAL_MS", 1e3),
      safariSeatReleaseSeconds: number("SAFARI_SEAT_RELEASE_SECONDS", 30),
      postcardLimit: number("POSTCARD_LIMIT", 10),
      postcardWindowSeconds: number("POSTCARD_WINDOW_SECONDS", 3600),
      confirmCodeTtlSeconds: number("CONFIRM_CODE_TTL_SECONDS", 86400)
    };
    SESSION_SECONDS = 30 * 24 * 60 * 60;
  }
});

// server/schema.ts
var SCHEMA;
var init_schema = __esm({
  "server/schema.ts"() {
    "use strict";
    SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind text NOT NULL,
  frozen boolean NOT NULL,
  tick integer NOT NULL,
  anchor_tick integer NOT NULL DEFAULT 0,
  anchor_ms bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  world_id text NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  handle text NOT NULL UNIQUE,
  email text NOT NULL,
  password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  ranger boolean NOT NULL DEFAULT false,
  confirm_code text,
  confirm_code_expires timestamptz,
  island integer NOT NULL DEFAULT 1,
  tile_x integer NOT NULL DEFAULT 3,
  tile_y integer NOT NULL DEFAULT 12,
  heading text NOT NULL DEFAULT 'E',
  music integer NOT NULL DEFAULT 60,
  effects integer NOT NULL DEFAULT 80,
  graphics text NOT NULL DEFAULT 'full',
  hall_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS players_email ON players (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id),
  creature_id text NOT NULL,
  island integer NOT NULL,
  tick integer NOT NULL,
  size integer NOT NULL,
  centring integer NOT NULL,
  facing integer NOT NULL,
  sharpness integer NOT NULL,
  total integer NOT NULL,
  measures jsonb,
  pose jsonb,
  shot_key text,
  answer jsonb,
  image_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_player ON photos (player_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS photos_shot_key ON photos (player_id, shot_key) WHERE shot_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS film_ledger (
  player_id text NOT NULL REFERENCES players(id),
  change_id text NOT NULL,
  account text NOT NULL CHECK (account IN ('satchel', 'locker')),
  amount integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('start', 'photo', 'page', 'refill', 'restart')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS film_ledger_player ON film_ledger (player_id, account);

CREATE TABLE IF NOT EXISTS album_pages (
  player_id text NOT NULL REFERENCES players(id),
  creature_id text NOT NULL,
  photo_id text NOT NULL REFERENCES photos(id),
  PRIMARY KEY (player_id, creature_id)
);

CREATE TABLE IF NOT EXISTS stamps (
  player_id text NOT NULL REFERENCES players(id),
  island integer NOT NULL,
  PRIMARY KEY (player_id, island)
);

CREATE TABLE IF NOT EXISTS hall_frames (
  player_id text NOT NULL REFERENCES players(id),
  photo_id text NOT NULL REFERENCES photos(id),
  frame integer NOT NULL,
  caption text NOT NULL DEFAULT '',
  PRIMARY KEY (player_id, photo_id)
);

CREATE TABLE IF NOT EXISTS likes (
  photo_id text NOT NULL REFERENCES photos(id),
  visitor_id text NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS safaris (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  world_id text NOT NULL REFERENCES worlds(id),
  code text NOT NULL,
  host_id text NOT NULL REFERENCES players(id),
  guest_id text REFERENCES players(id),
  status text NOT NULL DEFAULT 'open',
  guest_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS safaris_one_running_per_host ON safaris (host_id) WHERE status <> 'ended';

CREATE TABLE IF NOT EXISTS sightings (
  id bigserial PRIMARY KEY,
  safari_id text NOT NULL REFERENCES safaris(id),
  island integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  by_id text NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safari_photos (
  safari_id text NOT NULL REFERENCES safaris(id),
  photo_id text NOT NULL REFERENCES photos(id),
  PRIMARY KEY (safari_id, photo_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  world_id text NOT NULL REFERENCES worlds(id),
  author_id text NOT NULL REFERENCES players(id),
  text text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  decided_by text REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_entries (
  island integer NOT NULL,
  player_id text NOT NULL REFERENCES players(id),
  photo_id text NOT NULL REFERENCES photos(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (island, player_id)
);

CREATE TABLE IF NOT EXISTS postcards (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id),
  photo_id text NOT NULL REFERENCES photos(id),
  recipient text NOT NULL,
  line text NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  posted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS postcards_sender ON postcards (player_id, posted_at);

CREATE TABLE IF NOT EXISTS request_keys (
  player_id text NOT NULL REFERENCES players(id),
  kind text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (player_id, kind, key)
);
`;
  }
});

// server/db.ts
import pg from "pg";
async function rows(db, text2, values = []) {
  return (await db.query(text2, values)).rows;
}
async function one(db, text2, values = []) {
  return (await rows(db, text2, values))[0];
}
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
function isDatabaseDown(error) {
  const { code, message } = error;
  return code !== void 0 && DOWN_CODES.has(code) || /Connection terminated|timeout exceeded when trying to connect|ECONNREFUSED/.test(message ?? "");
}
async function migrate(seed) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7203441)");
    await client.query(SCHEMA);
    await seed(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock(7203441)").catch(() => void 0);
    client.release();
  }
}
var pool, DOWN_CODES;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    init_config();
    init_schema();
    pg.types.setTypeParser(20, (value) => Number(value));
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 3e3, idleTimeoutMillis: 1e4 });
    pool.on("error", () => void 0);
    pool.on("connect", (client) => client.on("error", () => void 0));
    DOWN_CODES = /* @__PURE__ */ new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EPIPE", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006"]);
  }
});

// server/errors.ts
var CATALOGUE, STORAGE_COPY, MAIL_COPY, ApiError;
var init_errors = __esm({
  "server/errors.ts"() {
    "use strict";
    CATALOGUE = {
      not_signed_in: [401, "Sign in first."],
      bad_credentials: [401, "That email and password don't match."],
      unconfirmed: [403, "Confirm your email to post postcards, pin notes and enter boards."],
      not_ranger: [403, "Only rangers can do that."],
      not_host: [403, "Only the host can do that."],
      own_photo: [403, "You can't like your own photo."],
      bad_origin: [403, "That request came from another site."],
      not_found: [404, "Nothing here."],
      no_safari: [404, "No safari with that code."],
      photo_too_large: [413, (limit) => `Photos can be at most ${Number(limit).toLocaleString("en-US")} bytes.`],
      too_large: [413, "That request is too large."],
      not_an_image: [415, "Photos must be PNG or JPEG images."],
      out_of_film: [409, "Out of film. Refill at Saltmarsh Harbour."],
      shot_key_reused: [409, "That shot key was already used for another photo."],
      request_key_reused: [409, "That request key was already used for something else."],
      email_taken: [409, "That email already has an account."],
      safari_full: [409, "That safari is full."],
      safari_ended: [409, "That safari has ended."],
      own_safari: [409, "You are the host of this safari."],
      note_decided: [409, (outcome) => `Already ${outcome}.`],
      note_not_approved: [409, "Only an approved note can be removed."],
      not_at_harbour: [409, "Refill film works only on Saltmarsh Harbour."],
      film_full: [409, "Your film is already full."],
      tick_passed: [422, "That moment has passed. Photo refused."],
      tick_ahead: [422, "That moment hasn't happened yet. Photo refused."],
      cannot_stand: [422, "No one could stand there. Photo refused."],
      camera_too_far: [422, "The camera was too far from the explorer. Photo refused."],
      nothing_in_frame: [422, "No creature in frame. Photo refused."],
      bad_pose: [422, "That photo's details aren't valid."],
      not_land: [422, "That tile isn't land."],
      bad_name: [422, "Enter a name of 1 to 40 characters."],
      bad_email: [422, "Enter a valid email address."],
      bad_password: [422, "Use a password of at least 8 characters."],
      bad_code: [422, "That code isn't right."],
      code_expired: [422, "That code has expired. Send a new one."],
      note_empty: [422, "Write a note first."],
      note_too_long: [422, "Notes can be at most 140 characters."],
      bad_reason: [422, "Choose a reason."],
      line_empty: [422, "Write a line for your postcard."],
      line_too_long: [422, "Postcard lines can be at most 140 characters."],
      caption_too_long: [422, "Captions can be at most 140 characters."],
      hall_full: [422, "A hall holds 12 photos."],
      wrong_island: [422, "That photo wasn't taken on this island."],
      bad_request: [422, "That request isn't valid."],
      postcard_limit: [429, (limit) => `You can send ${limit} postcards an hour. Try again later.`],
      storage_unavailable: [503, (variant) => STORAGE_COPY[variant] ?? ""],
      mail_unavailable: [503, (variant) => MAIL_COPY[variant] ?? ""],
      database_unavailable: [503, "The islands are unreachable. Try again soon."]
    };
    STORAGE_COPY = {
      photo: "Storage unreachable. Photo not kept, and your frame is still on the roll.",
      postcard: "Storage unreachable. Postcard not sent.",
      image: "Storage unreachable. Photo not available."
    };
    MAIL_COPY = {
      postcard: "Mail unreachable. Postcard not sent.",
      code: "Mail unreachable. No code sent."
    };
    ApiError = class extends Error {
      /** `detail` fills the copy that varies: the photo limit, the note outcome, the storage or mail variant. */
      constructor(code, detail = "", headers = {}) {
        const [status, copy] = CATALOGUE[code];
        super(typeof copy === "string" ? copy : copy(detail));
        this.headers = headers;
        this.status = status;
        this.code = code;
      }
      headers;
      status;
      code;
      get body() {
        return { error: this.code, message: this.message };
      }
    };
  }
});

// server/film.ts
import { randomUUID } from "node:crypto";
async function filmOf(db, playerId) {
  const row = await one(db, `SELECT COALESCE(SUM(amount), 0)::int AS film FROM film_ledger WHERE player_id = $1 AND account = $2`, [playerId, "satchel"]);
  return row.film;
}
async function changeFilm(db, playerId, amount, reason) {
  if (amount === 0) return;
  await db.query(
    `INSERT INTO film_ledger (player_id, change_id, account, amount, reason) VALUES ($1, $2, 'satchel', $3, $4), ($1, $2, 'locker', $5, $4)`,
    [playerId, randomUUID(), amount, reason, -amount]
  );
}
var init_film = __esm({
  "server/film.ts"() {
    "use strict";
    init_db();
  }
});

// shared/types.ts
var FULL_ROLL;
var init_types = __esm({
  "shared/types.ts"() {
    "use strict";
    FULL_ROLL = 36;
  }
});

// server/players.ts
import { createHash, randomBytes, randomInt, randomUUID as randomUUID2, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
async function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(password, salt, 32)).toString("hex")}`;
}
async function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(":");
  return timingSafeEqual(await derive(password, Buffer.from(salt, "hex"), 32), Buffer.from(hash, "hex"));
}
function toPlayer(row, own) {
  const player = { id: row.id, name: row.name, handle: row.handle, confirmed: row.confirmed, ranger: row.ranger };
  if (own) player.email = row.email;
  return player;
}
function sixDigitCode() {
  return String(randomInt(0, 1e6)).padStart(6, "0");
}
function handleFor(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  return `${slug || "explorer"}-${randomBytes(3).toString("hex")}`;
}
async function createPlayer(db, input) {
  const id = randomUUID2();
  const row = await one(
    db,
    `INSERT INTO players (id, world_id, name, handle, email, password_hash, confirmed, ranger, hall_public, confirm_code, confirm_code_expires)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $10::text IS NULL THEN NULL ELSE now() + make_interval(secs => $11) END)
     RETURNING ${PLAYER_COLUMNS}`,
    [
      id,
      input.worldId,
      input.name,
      handleFor(input.name),
      input.email,
      await hashPassword(input.password),
      input.confirmed ?? false,
      input.ranger ?? false,
      input.hallPublic ?? false,
      input.code ?? null,
      config.confirmCodeTtlSeconds
    ]
  );
  await changeFilm(db, id, FULL_ROLL, "start");
  return row;
}
async function openSession(db, playerId) {
  const token = randomBytes(32).toString("base64url");
  await db.query("INSERT INTO sessions (token_hash, player_id) VALUES ($1, $2)", [hashToken(token), playerId]);
  return token;
}
async function playerOfToken(db, token) {
  return one(db, `SELECT ${PLAYER_COLUMNS.split(", ").map((c) => `p.${c}`).join(", ")} FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = $1 AND s.created_at > now() - make_interval(secs => $2)`, [hashToken(token), SESSION_SECONDS]);
}
async function playerOfCredentials(db, email, password) {
  const row = await one(db, `SELECT ${PLAYER_COLUMNS}, password_hash FROM players WHERE lower(email) = lower($1)`, [email]);
  if (!row || !await passwordMatches(password, row.password_hash)) throw new ApiError("bad_credentials");
  return row;
}
var derive, PLAYER_COLUMNS, positionOf, settingsOf, hashToken;
var init_players = __esm({
  "server/players.ts"() {
    "use strict";
    init_config();
    init_db();
    init_film();
    init_types();
    init_errors();
    derive = promisify(scrypt);
    PLAYER_COLUMNS = "id, world_id, name, handle, email, confirmed, ranger, island, tile_x, tile_y, heading, music, effects, graphics, hall_public";
    positionOf = (row) => ({ island: row.island, tile: [row.tile_x, row.tile_y], heading: row.heading });
    settingsOf = (row) => ({ music: row.music, effects: row.effects, graphics: row.graphics });
    hashToken = (token) => createHash("sha256").update(token).digest("hex");
  }
});

// server/http.ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
function route(method, path, auth, handler) {
  routes.push({ method, pattern: new RegExp(`^${path.replace(/:\w+/g, "([^/]+)")}$`), auth, handler });
}
function markDatabaseReady() {
  databaseReady = true;
}
async function readBody(req, limit, tooLarge) {
  const chunks = [];
  let size = 0;
  for await (const chunk2 of req) {
    size += chunk2.length;
    if (size <= limit) chunks.push(chunk2);
  }
  if (size > limit) throw new ApiError(tooLarge, String(config.photoMaxBytes));
  return Buffer.concat(chunks);
}
function parseJson(buffer) {
  if (buffer.length === 0) return {};
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"), (_key, text2) => {
      if (typeof text2 === "string" && text2.includes("\0")) throw new Error("NUL");
      return text2;
    });
  } catch {
    throw new ApiError("bad_request");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiError("bad_request");
  return value;
}
function cookieOf(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return void 0;
}
function sessionToken(req) {
  return cookieOf(req, SESSION_COOKIE);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === void 0) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
function send(res, reply) {
  const headers = { "Cache-Control": "no-store", ...reply.headers };
  if (reply.bytes) {
    res.writeHead(reply.status, { ...headers, "Content-Type": reply.bytes.type, "Content-Length": reply.bytes.data.length });
    res.end(reply.bytes.data);
    return;
  }
  if (reply.body === void 0) {
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = JSON.stringify(reply.body);
  res.writeHead(reply.status, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}
function sendError(res, error) {
  send(res, { status: error.status, body: error.body, headers: error.headers });
}
function decodeParams(url, pattern) {
  try {
    const params = (url.pathname.match(pattern) ?? []).slice(1).map(decodeURIComponent);
    if (params.some((part) => part.includes("\0"))) throw new ApiError("not_found");
    return params;
  } catch (error) {
    throw error instanceof ApiError ? error : new ApiError("not_found");
  }
}
async function api(req, res, url) {
  const method = req.method ?? "GET";
  const found = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
  if (!found) throw new ApiError("not_found");
  if (!databaseReady && url.pathname !== "/api/health") throw new ApiError("database_unavailable");
  const token = sessionToken(req);
  const player = found.auth === "none" || !token ? null : await playerOfToken(pool, token) ?? null;
  if (found.auth === "required" && !player) throw new ApiError("not_signed_in");
  if (method !== "GET" && !sameOrigin(req)) throw new ApiError("bad_origin");
  const params = decodeParams(url, found.pattern);
  for (const [name, value] of url.searchParams) if (name.includes("\0") || value.includes("\0")) throw new ApiError("bad_request");
  let body;
  const context = {
    req,
    res,
    url,
    player,
    params,
    tab: String(req.headers["x-tab-id"] ?? ""),
    json: async () => {
      body ??= readBody(req, JSON_LIMIT, "too_large");
      return parseJson(await body);
    },
    raw: (limit, tooLarge) => readBody(req, limit, tooLarge)
  };
  const reply = await found.handler(context);
  if (reply) send(res, reply);
}
async function shell(req, meOf2) {
  const template = await readFile(join(config.publicDir, "index.html"), "utf8");
  const token = sessionToken(req);
  const player = databaseReady && token ? await playerOfToken(pool, token).catch(() => void 0) : void 0;
  const me = player ? await meOf2(player).catch(() => null) : null;
  const data = JSON.stringify(me).replace(/</g, "\\u003c");
  return Buffer.from(template.replace(SESSION_SLOT, `<script type="application/json" id="session">${data}</script>`));
}
async function serveStatic(req, res, pathname, meOf2) {
  if (pathname.split("/").some((part) => part.startsWith("."))) throw new ApiError("not_found");
  const asset = pathname.startsWith("/assets/");
  if (!asset) {
    if (extname(pathname) !== "") throw new ApiError("not_found");
    const page = await shell(req, meOf2);
    res.writeHead(200, { "Content-Type": TYPES[".html"], "Content-Length": page.length, "Cache-Control": "no-store" });
    res.end(page);
    return;
  }
  const file = join(config.publicDir, normalize(pathname));
  if (!file.startsWith(config.publicDir + sep)) throw new ApiError("not_found");
  let data;
  try {
    data = await readFile(file);
  } catch {
    throw new ApiError("not_found");
  }
  const hashed = /-[A-Za-z0-9]{8}\.\w+$/.test(file);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Content-Length": data.length,
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache"
  });
  res.end(data);
}
function createHttpServer(meOf2) {
  const server = createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      sendError(res, new ApiError("not_found"));
      return;
    }
    const run = url.pathname.startsWith("/api/") || url.pathname === "/api" ? api(req, res, url) : serveStatic(req, res, url.pathname, meOf2);
    run.catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof ApiError) sendError(res, error);
      else {
        if (!isDatabaseDown(error)) console.error(error);
        sendError(res, new ApiError("database_unavailable"));
      }
    });
  });
  return server;
}
var SESSION_COOKIE, JSON_LIMIT, routes, databaseReady, sessionCookie, clearedCookie, TYPES, SESSION_SLOT;
var init_http = __esm({
  "server/http.ts"() {
    "use strict";
    init_config();
    init_db();
    init_errors();
    init_players();
    SESSION_COOKIE = "hf_session";
    JSON_LIMIT = 64e3;
    routes = [];
    databaseReady = false;
    sessionCookie = (token) => `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
    clearedCookie = `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
    TYPES = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".woff2": "font/woff2",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".json": "application/json",
      ".map": "application/json"
    };
    SESSION_SLOT = '<script type="application/json" id="session"></script>';
  }
});

// shared/island.ts
function islandById(id) {
  return ISLANDS.find((island) => island.id === id);
}
function tileKind(island, x, y) {
  if (x <= 0 || y <= 0 || x >= GRID - 1 || y >= GRID - 1) return "water";
  const { pond } = island;
  if (x >= pond.x[0] && x <= pond.x[1] && y >= pond.y[0] && y <= pond.y[1]) return "water";
  if (island.rocks.some(([rx, ry]) => rx === x && ry === y)) return "rock";
  if (island.lighthouse && island.lighthouse[0] === x && island.lighthouse[1] === y) return "lighthouse";
  return "land";
}
function isLand(island, x, y) {
  return tileKind(island, x, y) === "land";
}
function creatureById(id) {
  return CREATURES.find((creature) => creature.id === id);
}
function creaturesOfIsland(island) {
  return CREATURES.filter((creature) => creature.island === island);
}
var GRID, HEADINGS, OPPOSITE, ISLANDS, SPOTS, HARBOUR, stay, patrol, CREATURES;
var init_island = __esm({
  "shared/island.ts"() {
    "use strict";
    GRID = 24;
    HEADINGS = ["N", "E", "S", "W"];
    OPPOSITE = { N: "S", E: "W", S: "N", W: "E" };
    ISLANDS = [
      { id: 1, name: "Saltmarsh Harbour", pond: { x: [15, 17], y: [3, 5] }, rocks: [[6, 6], [7, 6], [8, 6], [14, 14], [14, 15], [14, 16]] },
      { id: 2, name: "Fernhollow", pond: { x: [4, 6], y: [15, 17] }, rocks: [[10, 4], [10, 5], [10, 6], [17, 17], [18, 17], [19, 17]] },
      { id: 3, name: "Driftglass Reef", pond: { x: [11, 13], y: [11, 13] }, rocks: [[5, 18], [6, 18], [7, 18], [18, 5], [18, 6], [18, 7]] },
      { id: 4, name: "Mistcrown Fells", pond: { x: [17, 19], y: [15, 17] }, rocks: [[4, 9], [5, 9], [6, 9], [12, 2], [12, 3], [12, 4]] },
      { id: 5, name: "Lantern Point", pond: { x: [3, 5], y: [3, 5] }, rocks: [[9, 15], [10, 15], [11, 15], [16, 9], [16, 10], [16, 11]], lighthouse: [20, 4] }
    ];
    SPOTS = [
      { spot: 1, tile: [3, 12], heading: "E" },
      { spot: 2, tile: [12, 10], heading: "N" },
      { spot: 3, tile: [8, 20], heading: "N" },
      { spot: 4, tile: [20, 12], heading: "W" }
    ];
    HARBOUR = 1;
    stay = (x, y, heading) => ({ stay: { at: [x, y], heading } });
    patrol = (ax, ay, bx, by, ticksPerTile) => ({
      patrol: { from: [ax, ay], to: [bx, by], ticksPerTile }
    });
    CREATURES = [
      { id: "mossback-newt", name: "Mossback newt", island: 1, size: 1, present: "always", route: stay(12, 6, "S") },
      { id: "reedpipe-heron", name: "Reedpipe heron", island: 1, size: 2, present: "always", route: patrol(6, 16, 10, 16, 10) },
      { id: "gloamfin-moth", name: "Gloamfin moth", island: 1, size: 1, present: "dusk only", route: stay(18, 12, "W") },
      { id: "puddle-lark", name: "Puddle lark", island: 1, size: 1, present: "rain only", route: patrol(4, 4, 4, 9, 5) },
      { id: "bracken-hare", name: "Bracken hare", island: 2, size: 1, present: "always", route: patrol(8, 8, 14, 8, 6) },
      { id: "mossfern-stag", name: "Mossfern stag", island: 2, size: 3, present: "always", route: patrol(12, 13, 12, 18, 8) },
      { id: "lantern-toad", name: "Lantern toad", island: 2, size: 1, present: "dusk only", route: stay(16, 12, "W") },
      { id: "drizzle-snail", name: "Drizzle snail", island: 2, size: 1, present: "rain only", route: stay(20, 6, "S") },
      { id: "glasswing-crab", name: "Glasswing crab", island: 3, size: 1, present: "always", route: patrol(3, 6, 9, 6, 6) },
      { id: "tidewhistle-otter", name: "Tidewhistle otter", island: 3, size: 2, present: "always", route: patrol(15, 16, 20, 16, 8) },
      { id: "duskshell-snipe", name: "Duskshell snipe", island: 3, size: 1, present: "dusk only", route: stay(6, 12, "E") },
      { id: "rainbead-gecko", name: "Rainbead gecko", island: 3, size: 1, present: "rain only", route: patrol(15, 3, 15, 8, 5) },
      { id: "cragtail-goat", name: "Cragtail goat", island: 4, size: 2, present: "always", route: patrol(8, 14, 8, 20, 10) },
      { id: "fell-mouse", name: "Fell mouse", island: 4, size: 1, present: "always", route: patrol(15, 4, 20, 4, 4) },
      { id: "mistcrown-owl", name: "Mistcrown owl", island: 4, size: 2, present: "dusk only", route: stay(14, 8, "S") },
      { id: "cloudpuff-vole", name: "Cloudpuff vole", island: 4, size: 1, present: "rain only", route: stay(6, 4, "E") },
      { id: "beacon-gull", name: "Beacon gull", island: 5, size: 2, present: "always", route: patrol(12, 20, 18, 20, 6) },
      { id: "shingle-plover", name: "Shingle plover", island: 5, size: 1, present: "always", route: patrol(4, 12, 4, 18, 5) },
      { id: "wickwing-bat", name: "Wickwing bat", island: 5, size: 1, present: "dusk only", route: stay(8, 8, "S") },
      { id: "sleetfoot-fox", name: "Sleetfoot fox", island: 5, size: 2, present: "rain only", route: patrol(13, 4, 13, 10, 8) }
    ];
  }
});

// server/validate.ts
function readTile(value) {
  return Array.isArray(value) && value.length === 2 && isInteger(value[0]) && isInteger(value[1]) ? [value[0], value[1]] : null;
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value).sort(([p], [q]) => p < q ? -1 : 1).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
var isInteger, isHeading, isIslandId, EMAIL, isText, lengthOf, isBlank;
var init_validate = __esm({
  "server/validate.ts"() {
    "use strict";
    init_island();
    isInteger = (value) => typeof value === "number" && Number.isInteger(value);
    isHeading = (value) => typeof value === "string" && HEADINGS.includes(value);
    isIslandId = (value) => isInteger(value) && ISLANDS.some((island) => island.id === value);
    EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    isText = (value) => typeof value === "string";
    lengthOf = (text2) => Array.from(text2).length;
    isBlank = (text2) => text2.trim() === "";
  }
});

// server/world.ts
function tickOf(row) {
  return row.frozen ? row.tick : row.anchor_tick + Math.floor((row.now_ms - row.anchor_ms) / config.worldTickMs);
}
async function readClocks(db, ids) {
  const found = await rows(db, `SELECT id, frozen, tick, anchor_tick, anchor_ms, ${NOW_MS} AS now_ms FROM worlds WHERE id = ANY($1)`, [ids]);
  return found.map((row) => ({ id: row.id, tick: tickOf(row) }));
}
async function readTick(db, worldId) {
  const row = await one(db, `SELECT id, frozen, tick, anchor_tick, anchor_ms, ${NOW_MS} AS now_ms FROM worlds WHERE id = $1`, [worldId]);
  return tickOf(row);
}
function hourOf(tick) {
  return Math.floor(tick % config.worldDayTicks * 24 / config.worldDayTicks);
}
function minuteOf(tick) {
  const hourTicks = config.worldDayTicks / 24;
  return Math.floor(tick % hourTicks * 60 / hourTicks);
}
function placeOf(creature, tick) {
  if ("stay" in creature.route) {
    const { at, heading } = creature.route.stay;
    return { x: at[0], y: at[1], heading };
  }
  const { from, to, ticksPerTile } = creature.route.patrol;
  const length = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]);
  const step = [Math.sign(to[0] - from[0]), Math.sign(to[1] - from[1])];
  const k = Math.floor(tick / ticksPerTile) % (2 * length);
  if (k < length) return { x: from[0] + step[0] * k, y: from[1] + step[1] * k, heading: HEADING_TOWARD[`${step[0]},${step[1]}`] };
  const back = k - length;
  return { x: to[0] - step[0] * back, y: to[1] - step[1] * back, heading: HEADING_TOWARD[`${-step[0]},${-step[1]}`] };
}
function creaturesAt(tick) {
  const hour = hourOf(tick);
  return CREATURES.filter((creature) => creature.present === "always" || (creature.present === "dusk only" ? isDusk(hour) : isRaining(hour))).map((creature) => ({ id: creature.id, name: creature.name, island: creature.island, size: creature.size, ...placeOf(creature, tick) })).sort((p, q) => p.id < q.id ? -1 : 1);
}
function worldEvent(tick) {
  const hour = hourOf(tick);
  const minute = minuteOf(tick);
  return {
    tick,
    hour,
    minute,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    weather: isRaining(hour) ? "rain" : "clear",
    dusk: isDusk(hour),
    creatures: creaturesAt(tick)
  };
}
function worldAnswer(worldId, tick, lighthouse) {
  return { world: worldId, ...worldEvent(tick), lighthouse };
}
var NOW_MS, isDusk, isRaining, HEADING_TOWARD;
var init_world = __esm({
  "server/world.ts"() {
    "use strict";
    init_config();
    init_db();
    init_island();
    NOW_MS = "(extract(epoch from clock_timestamp()) * 1000)::bigint";
    isDusk = (hour) => hour >= config.duskStartHour && hour < config.duskEndHour;
    isRaining = (hour) => hour >= config.rainStartHour && hour < config.rainEndHour;
    HEADING_TOWARD = { "1,0": "E", "-1,0": "W", "0,1": "S", "0,-1": "N" };
  }
});

// server/live.ts
import pg2 from "pg";
async function publish(db, audience, name, data) {
  const envelope = { audience, name, data };
  await db.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(envelope)]);
}
async function announceClock() {
  const envelope = { audience: {}, name: "clock", data: null };
  await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(envelope)]);
}
function write(stream, name, data) {
  if (!stream.res.writableEnded) stream.res.write(`event: ${name}
data: ${JSON.stringify(data)}

`);
}
function reaches(audience, stream) {
  return (audience.players?.includes(stream.playerId) ?? false) || audience.world === stream.worldId || audience.rangers === stream.worldId && stream.ranger || audience.hall !== void 0 && audience.hall === stream.hall;
}
async function tickWorlds() {
  if (ticking || streams.size === 0) return;
  ticking = true;
  try {
    const worldIds = [...new Set([...streams].map((s) => s.worldId))];
    for (const clock of await readClocks(pool, worldIds)) {
      if (lastTick.get(clock.id) === clock.tick) continue;
      lastTick.set(clock.id, clock.tick);
      const event = worldEvent(clock.tick);
      for (const stream of streams) if (stream.worldId === clock.id) write(stream, "world", event);
    }
  } finally {
    ticking = false;
  }
}
function dispatch(payload) {
  let envelope;
  try {
    envelope = JSON.parse(payload);
  } catch {
    return;
  }
  if (envelope.name === "clock") {
    void tickWorlds().catch(() => void 0);
    return;
  }
  const now = Date.now();
  recent.push({ at: now, envelope });
  while (recent[0] && recent[0].at < now - REPLAY_MS) recent.shift();
  for (const stream of streams) if (reaches(envelope.audience, stream)) write(stream, envelope.name, envelope.data);
}
async function listen() {
  const client = new pg2.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 3e3 });
  const again = () => {
    setTimeout(() => void listen(), 1e3);
  };
  client.on("notification", (message) => {
    if (message.payload) dispatch(message.payload);
  });
  client.on("error", () => client.end().catch(() => void 0));
  client.on("end", again);
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  } catch {
    client.removeAllListeners("end");
    await client.end().catch(() => void 0);
    again();
  }
}
async function pulse() {
  for (const stream of streams) if (!stream.res.writableEnded) stream.res.write(": ping\n\n");
  await seatSeen([...new Set([...streams].map((s) => s.playerId))]);
  await tickWorlds();
}
function startLive() {
  void listen();
  setInterval(() => void pulse().catch(() => void 0), config.liveIntervalMs);
}
async function openStream(context) {
  const player = context.player;
  const { res } = context;
  const stream = { res, playerId: player.id, worldId: player.world_id, ranger: player.ranger, hall: context.url.searchParams.get("hall") ?? void 0 };
  let closed = false;
  res.on("close", () => {
    closed = true;
    streams.delete(stream);
    if (![...streams].some((s) => s.playerId === stream.playerId)) void seatSeen([stream.playerId]).catch(() => void 0);
  });
  const tick = await readTick(pool, player.world_id);
  if (closed) return void 0;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.socket?.setNoDelay(true);
  res.write("retry: 1000\n\n");
  streams.add(stream);
  write(stream, "world", worldEvent(tick));
  lastTick.set(player.world_id, tick);
  const link = context.url.searchParams.get("link") ?? "";
  const age = Math.min(Number(context.url.searchParams.get("age")) || 0, REPLAY_MS);
  if (link !== "" && age > 0 && !replayed.has(link)) {
    for (const { at, envelope } of recent) {
      if (at >= Date.now() - age && envelope.name !== "clock" && reaches(envelope.audience, stream)) write(stream, envelope.name, envelope.data);
    }
  }
  if (link !== "") {
    if (replayed.size > 5e3) replayed.clear();
    replayed.add(link);
  }
  void seatSeen([player.id]).catch(() => void 0);
  return void 0;
}
var CHANNEL, streams, REPLAY_MS, recent, replayed, lastTick, ticking, seatSeen;
var init_live = __esm({
  "server/live.ts"() {
    "use strict";
    init_config();
    init_db();
    init_http();
    init_world();
    CHANNEL = "hushfoot_live";
    streams = /* @__PURE__ */ new Set();
    REPLAY_MS = 1e4;
    recent = [];
    replayed = /* @__PURE__ */ new Set();
    lastTick = /* @__PURE__ */ new Map();
    ticking = false;
    seatSeen = (playerIds) => pool.query(`UPDATE safaris SET guest_seen_at = now() WHERE status = 'joined' AND guest_id = ANY($1)`, [playerIds]);
    route("GET", "/api/live", "required", openStream);
  }
});

// server/safaris.ts
import { randomInt as randomInt2 } from "node:crypto";
async function toSafari(db, row) {
  const sightings = await rows(db, "SELECT s.island, s.x, s.y, p.name AS by FROM sightings s JOIN players p ON p.id = s.by_id WHERE s.safari_id = $1 ORDER BY s.id", [row.id]);
  return {
    code: row.code,
    status: row.status,
    host: { id: row.host_id, name: row.host_name },
    guest: row.guest_id && row.guest_name ? { id: row.guest_id, name: row.guest_name } : null,
    sightings
  };
}
async function safariByCode(db, worldId, code) {
  const row = await one(db, `${SELECT} WHERE s.world_id = $1 AND s.code = $2`, [worldId, code]);
  if (!row) throw new ApiError("no_safari");
  return row;
}
async function guestOfHost(db, hostId) {
  const row = await one(db, `SELECT guest_id FROM safaris WHERE host_id = $1 AND status = 'joined'`, [hostId]);
  return row?.guest_id ?? null;
}
async function feedSeatedGuest(db, hostId, photoId) {
  const row = await one(
    db,
    `WITH seated AS (SELECT id, guest_id FROM safaris WHERE host_id = $1 AND status = 'joined'),
          fed AS (INSERT INTO safari_photos (safari_id, photo_id) SELECT id, $2 FROM seated)
     SELECT guest_id FROM seated`,
    [hostId, photoId]
  );
  return row?.guest_id ?? null;
}
function newCode() {
  return Array.from({ length: 6 }, () => String.fromCharCode(65 + randomInt2(26))).join("");
}
async function freeSeats() {
  const freed = await rows(
    pool,
    `WITH stale AS (
       SELECT id, guest_id FROM safaris
       WHERE status = 'joined' AND guest_seen_at < now() - make_interval(secs => $1) FOR UPDATE SKIP LOCKED)
     UPDATE safaris s SET guest_id = NULL, status = 'open', guest_seen_at = NULL FROM stale WHERE s.id = stale.id
     RETURNING s.id, stale.guest_id`,
    [config.safariSeatReleaseSeconds]
  );
  for (const { id, guest_id } of freed) {
    const row = await one(pool, `${SELECT} WHERE s.id = $1`, [id]);
    const guest = await one(pool, "SELECT name FROM players WHERE id = $1", [guest_id]);
    await publish(pool, { players: [row.host_id, guest_id] }, "safari_left", { guest_name: guest.name, safari: await toSafari(pool, row) });
  }
}
function startSeatSweeper() {
  setInterval(() => void freeSeats().catch(() => void 0), 500);
}
var SELECT, participants;
var init_safaris = __esm({
  "server/safaris.ts"() {
    "use strict";
    init_config();
    init_db();
    init_errors();
    init_http();
    init_live();
    init_validate();
    init_island();
    SELECT = `SELECT s.id, s.world_id, s.code, s.host_id, s.guest_id, s.status, h.name AS host_name, g.name AS guest_name
  FROM safaris s JOIN players h ON h.id = s.host_id LEFT JOIN players g ON g.id = s.guest_id`;
    participants = (row) => row.guest_id ? [row.host_id, row.guest_id] : [row.host_id];
    route("POST", "/api/safaris", "required", async (c) => {
      const player = c.player;
      const running = () => one(pool, `${SELECT} WHERE s.host_id = $1 AND s.status <> 'ended'`, [player.id]);
      for (let current = await running(); ; current = await running()) {
        if (current) return { status: 200, body: { safari: await toSafari(pool, current) } };
        const made = await one(pool, "INSERT INTO safaris (world_id, code, host_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id", [player.world_id, newCode(), player.id]);
        if (made) {
          const row = await one(pool, `${SELECT} WHERE s.id = $1`, [made.id]);
          return { status: 201, body: { safari: await toSafari(pool, row) } };
        }
      }
    });
    route("GET", "/api/safaris/current", "required", async (c) => {
      const player = c.player;
      const row = await one(pool, `${SELECT} WHERE (s.host_id = $1 OR s.guest_id = $1) AND s.status <> 'ended' ORDER BY s.created_at DESC LIMIT 1`, [player.id]);
      return { status: 200, body: { safari: row ? await toSafari(pool, row) : null } };
    });
    route("POST", "/api/safaris/:code/join", "required", async (c) => {
      const player = c.player;
      const row = await safariByCode(pool, player.world_id, c.params[0]);
      if (row.guest_id === player.id && row.status === "joined") return { status: 200, body: { safari: await toSafari(pool, row) } };
      if (row.host_id === player.id) throw new ApiError("own_safari");
      if (row.status === "ended") throw new ApiError("safari_ended");
      const seated = await one(pool, `UPDATE safaris SET guest_id = $2, status = 'joined', guest_seen_at = now() WHERE id = $1 AND status = 'open' RETURNING id`, [row.id, player.id]);
      if (!seated) throw new ApiError("safari_full");
      const safari = await toSafari(pool, await safariByCode(pool, player.world_id, row.code));
      await publish(pool, { players: [row.host_id, player.id] }, "safari_joined", { guest_name: player.name, safari });
      const host = await one(pool, "SELECT island, tile_x, tile_y FROM players WHERE id = $1", [row.host_id]);
      await publish(pool, { players: [player.id] }, "host_position", { island: host.island, tile: [host.tile_x, host.tile_y] });
      return { status: 200, body: { safari } };
    });
    route("POST", "/api/safaris/:code/sightings", "required", async (c) => {
      const player = c.player;
      const row = await safariByCode(pool, player.world_id, c.params[0]);
      if (row.host_id !== player.id) throw new ApiError("not_host");
      if (row.status === "ended") throw new ApiError("safari_ended");
      const body = await c.json();
      const tile = readTile(body.tile);
      if (!isIslandId(body.island) || !tile || tile.some((n) => n < 0 || n >= GRID)) throw new ApiError("bad_request");
      const marked = await one(pool, `INSERT INTO sightings (safari_id, island, x, y, by_id)
    SELECT id, $2, $3, $4, $5 FROM safaris WHERE id = $1 AND status <> 'ended' RETURNING id`, [row.id, body.island, tile[0], tile[1], player.id]);
      if (!marked) throw new ApiError("safari_ended");
      const sighting = { island: body.island, x: tile[0], y: tile[1], by: player.name };
      await publish(pool, { players: participants(row) }, "sighting", { sighting, host_name: player.name });
      return { status: 201, body: { sighting } };
    });
    route("POST", "/api/safaris/:code/leave", "required", async (c) => {
      const player = c.player;
      const row = await safariByCode(pool, player.world_id, c.params[0]);
      if (row.guest_id !== player.id || row.status !== "joined") throw new ApiError("no_safari");
      const left = await one(pool, `UPDATE safaris SET guest_id = NULL, status = 'open', guest_seen_at = NULL WHERE id = $1 AND guest_id = $2 AND status = 'joined' RETURNING id`, [row.id, player.id]);
      if (!left) throw new ApiError("no_safari");
      const safari = await toSafari(pool, await safariByCode(pool, player.world_id, row.code));
      await publish(pool, { players: [row.host_id, player.id] }, "safari_left", { guest_name: player.name, safari });
      return { status: 200, body: { safari } };
    });
    route("POST", "/api/safaris/:code/end", "required", async (c) => {
      const player = c.player;
      const row = await safariByCode(pool, player.world_id, c.params[0]);
      if (row.host_id !== player.id) throw new ApiError("not_host");
      if (row.status === "ended") throw new ApiError("safari_ended");
      const ended = await one(pool, `UPDATE safaris SET status = 'ended' WHERE id = $1 AND status <> 'ended' RETURNING id`, [row.id]);
      if (!ended) throw new ApiError("safari_ended");
      const safari = await toSafari(pool, await safariByCode(pool, player.world_id, row.code));
      await publish(pool, { players: participants(row) }, "safari_ended", { safari });
      return { status: 200, body: { safari } };
    });
  }
});

// shared/frame.ts
function frameOffsets(tile, heading, creature) {
  const [ex, ey] = tile;
  const [cx, cy] = creature;
  switch (heading) {
    case "N":
      return { a: ey - cy, l: cx - ex };
    case "E":
      return { a: cx - ex, l: cy - ey };
    case "S":
      return { a: cy - ey, l: ex - cx };
    case "W":
      return { a: ex - cx, l: ey - cy };
  }
}
function inFrame(tile, heading, zoom, creatures) {
  const found = [];
  for (const creature of creatures) {
    const { a, l } = frameOffsets(tile, heading, [creature.x, creature.y]);
    if (a >= 1 && a <= 24 && 2 * zoom * Math.abs(l) <= a) found.push({ id: creature.id, a, l });
  }
  return found.sort((p, q) => p.a - q.a || Math.abs(p.l) - Math.abs(q.l) || (p.id < q.id ? -1 : 1));
}
var init_frame = __esm({
  "shared/frame.ts"() {
    "use strict";
  }
});

// server/score.ts
function scorePhoto(pose, present) {
  const subject = inFrame(pose.tile, pose.heading, pose.zoom, present)[0];
  if (!subject) return null;
  const creature = present.find((c) => c.id === subject.id);
  const { a, l } = frameOffsets(pose.tile, pose.heading, [creature.x, creature.y]);
  const bestDistance = 2 * pose.zoom * creature.size;
  const size = Math.max(0, MAX_SIZE - 10 * Math.abs(a - bestDistance));
  const centring = Math.max(0, MAX_CENTRING - 10 * Math.abs(l) * pose.zoom);
  const creatureFacing = creature.heading === OPPOSITE[pose.heading] ? "toward" : creature.heading === pose.heading ? "away" : "side";
  const facing = { toward: MAX_FACING, side: 15, away: 0 }[creatureFacing];
  const sharpness = Math.max(0, 20 - 5 * Math.abs(pose.focus - a));
  return {
    creature,
    score: { size, centring, facing, sharpness, total: size + centring + facing + sharpness },
    measures: { distance: a, best_distance: bestDistance, offset: Math.abs(l), focus_error: Math.abs(pose.focus - a), creature_facing: creatureFacing }
  };
}
var MAX_SIZE, MAX_CENTRING, MAX_FACING;
var init_score = __esm({
  "server/score.ts"() {
    "use strict";
    init_frame();
    init_island();
    MAX_SIZE = 30;
    MAX_CENTRING = 25;
    MAX_FACING = 25;
  }
});

// server/s3.ts
import { createHash as createHash2, createHmac } from "node:crypto";
async function send2(method, key, body = Buffer.alloc(0), contentType, timeout = TIMEOUT_MS) {
  const { endpoint, region, bucket, pathStyle, accessKeyId, secretAccessKey } = config.s3;
  const base = new URL(endpoint);
  const host = pathStyle ? base.host : `${bucket}.${base.host}`;
  const path = (pathStyle ? `/${bucket}` : "") + (key ? `/${key.split("/").map(encode).join("/")}` : "");
  const now = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = now.slice(0, 8);
  const payload = sha256(body);
  const headers = { host, "x-amz-content-sha256": payload, "x-amz-date": now };
  if (contentType) headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const scope = `${day}/${region}/s3/aws4_request`;
  const canonical = [method, path || "/", "", names.map((n) => `${n}:${headers[n]}
`).join(""), names.join(";"), payload].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", now, scope, sha256(canonical)].join("\n");
  const signingKey = [day, region, "s3", "aws4_request"].reduce((k, part) => hmac(k, part), `AWS4${secretAccessKey}`);
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  try {
    return await fetch(`${base.protocol}//${host}${path}`, {
      method,
      headers,
      body: method === "PUT" ? new Uint8Array(body) : void 0,
      signal: AbortSignal.timeout(timeout)
    });
  } catch {
    throw new StorageError(`${method} ${key} failed`);
  }
}
async function putObject(key, body, contentType) {
  const response = await send2("PUT", key, body, contentType);
  if (!response.ok) throw new StorageError(`PUT ${key}: ${response.status}`);
}
async function getObject(key) {
  const response = await send2("GET", key);
  if (!response.ok) throw new StorageError(`GET ${key}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function deleteObject(key) {
  const response = await send2("DELETE", key);
  if (!response.ok) throw new StorageError(`DELETE ${key}: ${response.status}`);
}
async function storageAnswers() {
  try {
    return (await send2("HEAD", "", Buffer.alloc(0), void 0, PROBE_TIMEOUT_MS)).ok;
  } catch {
    return false;
  }
}
var StorageError, TIMEOUT_MS, PROBE_TIMEOUT_MS, sha256, hmac, encode;
var init_s3 = __esm({
  "server/s3.ts"() {
    "use strict";
    init_config();
    StorageError = class extends Error {
    };
    TIMEOUT_MS = 5e3;
    PROBE_TIMEOUT_MS = 1500;
    sha256 = (data) => createHash2("sha256").update(data).digest("hex");
    hmac = (key, data) => createHmac("sha256", key).update(data).digest();
    encode = (segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }
});

// server/grading.ts
var grading_exports = {};
import { randomBytes as randomBytes2, randomUUID as randomUUID5 } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
function chunk(kind, data) {
  const head = Buffer.concat([Buffer.from(kind), data]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  head.copy(out, 4);
  out.writeUInt32BE(crc32(head), 8 + data.length);
  return out;
}
function solidPng(red, green, blue) {
  const size = 16;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const pixel = (x, y) => {
    const light = 1.25 - (x + y) / (4 * (size - 1));
    const subject = Math.hypot(x - 7.5, y - 8.5) < 4 ? 0.55 : 1;
    return [red, green, blue].map((channel) => Math.min(255, Math.round(channel * light * subject)));
  };
  const rows2 = Array.from({ length: size }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, (_2, x) => pixel(x, y)).flat())]));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows2))), chunk("IEND", Buffer.alloc(0))]);
}
function rowsOf(total) {
  const size = Math.min(MAX_SIZE, total);
  const centring = Math.min(MAX_CENTRING, total - size);
  const facing = Math.min(MAX_FACING, total - size - centring);
  return [size, centring, facing, total - size - centring - facing];
}
var DEFAULT_TICK, PHOTOS, PEOPLE;
var init_grading = __esm({
  "server/grading.ts"() {
    "use strict";
    init_db();
    init_errors();
    init_http();
    init_live();
    init_film();
    init_players();
    init_score();
    init_safaris();
    init_s3();
    init_validate();
    DEFAULT_TICK = 6e3;
    PHOTOS = [
      { key: "heron", owner: "explorer", creature: "reedpipe-heron", total: 74, tick: 5200, colour: [120, 150, 190] },
      { key: "moth", owner: "explorer", creature: "gloamfin-moth", total: 81, tick: 5300, colour: [190, 150, 110] },
      { key: "lark", owner: "explorer", creature: "puddle-lark", total: 66, tick: 5400, colour: [110, 170, 130] },
      { key: "friend_heron", owner: "friend", creature: "reedpipe-heron", total: 74, tick: 5100, colour: [100, 140, 180] },
      { key: "rival_lark", owner: "rival", creature: "puddle-lark", total: 66, tick: 5300, colour: [130, 160, 120] },
      { key: "rival_private", owner: "rival", creature: "mossback-newt", total: 55, tick: 5e3, colour: [90, 130, 100] }
    ];
    PEOPLE = [
      { key: "explorer", name: "Ada Explorer" },
      { key: "friend", name: "Finn Friend" },
      { key: "rival", name: "Rhea Rival" },
      { key: "ranger", name: "Sal Ranger", ranger: true },
      { key: "ranger2", name: "Una Ranger", ranger: true },
      { key: "newcomer", name: "Nia Newcomer", confirmed: false }
    ];
    route("POST", "/api/grading/world", "none", async (c) => {
      const body = await c.json();
      const tick = body.tick === void 0 ? DEFAULT_TICK : body.tick;
      if (!isInteger(tick) || tick < 0) throw new ApiError("bad_request");
      const ids = new Map(PHOTOS.map((photo) => [photo.key, randomUUID5()]));
      try {
        await Promise.all(PHOTOS.map((photo) => putObject(`photos/${ids.get(photo.key)}.png`, solidPng(...photo.colour), "image/png")));
      } catch (error) {
        if (error instanceof StorageError) throw new ApiError("storage_unavailable", "image");
        throw error;
      }
      const token = randomBytes2(4).toString("hex");
      const answer = await transaction(async (client) => {
        const world = await one(client, `INSERT INTO worlds (kind, frozen, tick) VALUES ('grading', true, $1) RETURNING id`, [tick]);
        const players = /* @__PURE__ */ new Map();
        for (const person of PEOPLE) {
          const email = `${person.key}-${token}@example.test`;
          const password = `Tide-${randomBytes2(6).toString("hex")}`;
          const row = await createPlayer(client, {
            worldId: world.id,
            name: `${person.name} ${token}`,
            email,
            password,
            confirmed: person.confirmed ?? true,
            ranger: person.ranger ?? false,
            hallPublic: person.key === "explorer"
          });
          players.set(person.key, { row, email, password });
        }
        const id = (key) => players.get(key).row.id;
        for (const photo of PHOTOS) {
          const [size, centring, facing, sharpness] = rowsOf(photo.total);
          await client.query(
            `INSERT INTO photos (id, player_id, creature_id, island, tick, size, centring, facing, sharpness, total, image_key) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10)`,
            [ids.get(photo.key), id(photo.owner), photo.creature, photo.tick, size, centring, facing, sharpness, photo.total, `photos/${ids.get(photo.key)}.png`]
          );
        }
        const photoId = (key) => ids.get(key);
        await changeFilm(client, id("explorer"), -6, "photo");
        for (const key of ["heron", "moth", "lark"]) {
          const creature = PHOTOS.find((p) => p.key === key).creature;
          await client.query("INSERT INTO album_pages (player_id, creature_id, photo_id) VALUES ($1, $2, $3)", [id("explorer"), creature, photoId(key)]);
        }
        await client.query("INSERT INTO stamps (player_id, island) VALUES ($1, 2), ($1, 3)", [id("explorer")]);
        for (const [frame, key] of ["heron", "moth", "lark"].entries()) {
          await client.query("INSERT INTO hall_frames (player_id, photo_id, frame) VALUES ($1, $2, $3)", [id("explorer"), photoId(key), frame + 1]);
        }
        await client.query("INSERT INTO hall_frames (player_id, photo_id, frame) VALUES ($1, $2, 1)", [id("rival"), photoId("rival_private")]);
        await client.query("INSERT INTO board_entries (island, player_id, photo_id) VALUES (1, $1, $2)", [id("rival"), photoId("rival_lark")]);
        const approved = await one(client, `INSERT INTO notes (world_id, author_id, text, status, decided_by) VALUES ($1, $2, 'Fresh water at the harbour tap.', 'approved', $3) RETURNING id`, [world.id, id("explorer"), id("ranger")]);
        const pending = await one(client, `INSERT INTO notes (world_id, author_id, text) VALUES ($1, $2, 'Seal pups on the dock at low tide.') RETURNING id`, [world.id, id("friend")]);
        const code = newCode();
        const safari = await one(client, `INSERT INTO safaris (world_id, code, host_id) VALUES ($1, $2, $3) RETURNING id`, [world.id, code, id("explorer")]);
        await client.query("INSERT INTO sightings (safari_id, island, x, y, by_id) VALUES ($1, 1, 12, 6, $2)", [safari.id, id("explorer")]);
        const who = (key) => {
          const { row, email, password } = players.get(key);
          return { id: row.id, name: row.name, handle: row.handle, email, password };
        };
        return {
          world: { id: world.id, tick },
          ...Object.fromEntries(PEOPLE.map((person) => [person.key, who(person.key)])),
          photos: Object.fromEntries(PHOTOS.map((photo) => [photo.key, photoId(photo.key)])),
          safari: { code },
          notes: { pending: pending.id, approved: approved.id }
        };
      });
      return { status: 201, body: answer };
    });
    route("POST", "/api/grading/clock", "none", async (c) => {
      const body = await c.json();
      const moved = isText(body.world) && isInteger(body.tick) && body.tick >= 0 ? await one(pool, `UPDATE worlds SET tick = $2 WHERE id = $1 AND frozen RETURNING id`, [body.world, body.tick]) : void 0;
      if (!moved) {
        const known = isText(body.world) && await one(pool, "SELECT 1 FROM worlds WHERE id = $1 AND frozen", [body.world]);
        throw new ApiError(known ? "bad_request" : "not_found");
      }
      await announceClock();
      return { status: 200, body: { world: body.world, tick: body.tick } };
    });
  }
});

// server/main.ts
init_config();
init_db();
init_http();

// server/auth.ts
init_config();
init_db();
init_errors();
init_http();

// server/mail.ts
init_config();
import nodemailer from "nodemailer";
var MailError = class extends Error {
};
var transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  ignoreTLS: true,
  connectionTimeout: 4e3,
  greetingTimeout: 4e3,
  socketTimeout: 8e3
});
async function sendMail(message) {
  try {
    await transport.sendMail({
      from: config.mailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      attachments: message.attachment ? [message.attachment] : []
    });
  } catch {
    throw new MailError("mail not accepted");
  }
}

// server/auth.ts
init_players();
init_validate();
var UNIQUE_VIOLATION = "23505";
async function mailCode(to, code) {
  await sendMail({ to, subject: "Your Hushfoot confirmation code", text: `Your code is ${code}.

Type it on the Hushfoot confirm page to post postcards, pin notes and enter boards.` });
}
async function mainWorldId() {
  const world = await one(pool, `SELECT id FROM worlds WHERE kind = 'main'`);
  return world.id;
}
route("POST", "/api/signup", "none", async (c) => {
  const body = await c.json();
  const name = isText(body.name) ? body.name.trim() : "";
  const email = isText(body.email) ? body.email.trim() : "";
  const password = isText(body.password) ? body.password : "";
  if (EMAIL.test(email) && await one(pool, "SELECT 1 FROM players WHERE lower(email) = lower($1)", [email])) throw new ApiError("email_taken");
  if (name === "" || lengthOf(name) > 40) throw new ApiError("bad_name");
  if (!EMAIL.test(email)) throw new ApiError("bad_email");
  if (lengthOf(password) < 8) throw new ApiError("bad_password");
  const code = sixDigitCode();
  const worldId = await mainWorldId();
  const player = await transaction((client) => createPlayer(client, { worldId, name, email, password, code })).catch((error) => {
    throw error.code === UNIQUE_VIOLATION ? new ApiError("email_taken") : error;
  });
  const sent = await mailCode(email, code).then(() => true, (error) => {
    if (error instanceof MailError) return false;
    throw error;
  });
  const token = await openSession(pool, player.id);
  return { status: 201, body: { player: toPlayer(player, true), code_sent: sent }, headers: { "Set-Cookie": sessionCookie(token) } };
});
route("POST", "/api/session", "none", async (c) => {
  const body = await c.json();
  const player = await playerOfCredentials(pool, isText(body.email) ? body.email.trim() : "", isText(body.password) ? body.password : "");
  const token = await openSession(pool, player.id);
  return { status: 200, body: { player: toPlayer(player, true) }, headers: { "Set-Cookie": sessionCookie(token) } };
});
route("DELETE", "/api/session", "none", async (c) => {
  const token = sessionToken(c.req);
  if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  return { status: 204, headers: { "Set-Cookie": clearedCookie } };
});
route("POST", "/api/confirm", "required", async (c) => {
  const player = c.player;
  const body = await c.json();
  if (player.confirmed) return { status: 200, body: { player: toPlayer(player, true) } };
  const stored = await one(pool, "SELECT confirm_code, confirm_code_expires < now() AS expired FROM players WHERE id = $1", [player.id]);
  if (!stored?.confirm_code || !isText(body.code) || body.code.trim() !== stored.confirm_code) throw new ApiError("bad_code");
  if (stored.expired) throw new ApiError("code_expired");
  const confirmed = await one(pool, `UPDATE players SET confirmed = true, confirm_code = NULL, confirm_code_expires = NULL WHERE id = $1 RETURNING ${PLAYER_COLUMNS}`, [player.id]);
  return { status: 200, body: { player: toPlayer(confirmed, true) } };
});
route("POST", "/api/confirm/resend", "required", async (c) => {
  const player = c.player;
  const code = sixDigitCode();
  await pool.query(`UPDATE players SET confirm_code = $2, confirm_code_expires = now() + make_interval(secs => $3) WHERE id = $1`, [player.id, code, config.confirmCodeTtlSeconds]);
  await mailCode(player.email, code).catch((error) => {
    if (error instanceof MailError) throw new ApiError("mail_unavailable", "code");
    throw error;
  });
  return { status: 200, body: { sent: true } };
});

// server/me.ts
init_db();
init_errors();
init_http();
init_live();
init_players();

// server/albums.ts
init_db();
init_film();
init_island();
var PAGE_TOTAL = 60;
var STAMPS_FOR_LIGHTHOUSE = 3;
function lighthouseOf(stamps) {
  return stamps >= STAMPS_FOR_LIGHTHOUSE ? "open" : "closed";
}
async function stampCount(db, playerId) {
  const [row] = await rows(db, "SELECT COUNT(*)::int AS n FROM stamps WHERE player_id = $1", [playerId]);
  return row.n;
}
async function readAlbums(db, playerId) {
  const pages = await rows(
    db,
    "SELECT a.creature_id, a.photo_id, p.total FROM album_pages a JOIN photos p ON p.id = a.photo_id WHERE a.player_id = $1",
    [playerId]
  );
  const stamped = new Set((await rows(db, "SELECT island FROM stamps WHERE player_id = $1", [playerId])).map((s) => s.island));
  const albums = ISLANDS.map((island) => {
    const listed = creaturesOfIsland(island.id).map((creature) => {
      const page = pages.find((p) => p.creature_id === creature.id);
      return { creature: creature.id, creature_name: creature.name, filled: page !== void 0, photo_id: page?.photo_id ?? null, total: page?.total ?? null };
    });
    return { island: island.id, island_name: island.name, pages: listed, pages_filled: listed.filter((p) => p.filled).length, stamp: stamped.has(island.id) };
  });
  return { albums, stamps: stamped.size, lighthouse: lighthouseOf(stamped.size), film: await filmOf(db, playerId) };
}

// server/me.ts
init_film();
init_types();
init_safaris();
init_validate();
init_world();
init_island();
var self = (c) => c.player;
async function announceHost(db, host, position) {
  const guest = await guestOfHost(db, host.id);
  if (guest) await publish(db, { players: [guest] }, "host_position", { island: position.island, tile: position.tile });
}
async function meOf(me) {
  const stamps = await stampCount(pool, me.id);
  return { player: toPlayer(me, true), position: positionOf(me), film: await filmOf(pool, me.id), stamps, lighthouse: lighthouseOf(stamps), settings: settingsOf(me) };
}
route("GET", "/api/me", "required", async (c) => ({ status: 200, body: await meOf(self(c)) }));
route("PUT", "/api/me/position", "required", async (c) => {
  const me = self(c);
  const body = await c.json();
  const tile = readTile(body.tile);
  if (!isIslandId(body.island) || !tile || !isHeading(body.heading)) throw new ApiError("bad_request");
  if (!isLand(islandById(body.island), tile[0], tile[1])) throw new ApiError("not_land");
  const moved = await one(pool, `UPDATE players SET island = $2, tile_x = $3, tile_y = $4, heading = $5 WHERE id = $1 RETURNING ${PLAYER_COLUMNS}`, [me.id, body.island, tile[0], tile[1], body.heading]);
  const position = positionOf(moved);
  await publish(pool, { players: [me.id] }, "position", { ...position, tab: c.tab });
  await announceHost(pool, me, position);
  return { status: 200, body: { position } };
});
route("GET", "/api/me/albums", "required", async (c) => ({ status: 200, body: await readAlbums(pool, self(c).id) }));
var lockPlayer = (client, playerId) => one(client, `SELECT ${PLAYER_COLUMNS} FROM players WHERE id = $1 FOR UPDATE`, [playerId]);
route("POST", "/api/me/refill", "required", async (c) => {
  const me = self(c);
  await transaction(async (client) => {
    const locked = await lockPlayer(client, me.id);
    if (locked.island !== HARBOUR) throw new ApiError("not_at_harbour");
    const film = await filmOf(client, me.id);
    if (film >= FULL_ROLL) throw new ApiError("film_full");
    await changeFilm(client, me.id, FULL_ROLL - film, "refill");
  });
  await publish(pool, { players: [me.id] }, "progress", await readAlbums(pool, me.id));
  return { status: 200, body: { film: FULL_ROLL } };
});
route("POST", "/api/me/restart", "required", async (c) => {
  const me = self(c);
  const start = SPOTS[0];
  const moved = await transaction(async (client) => {
    await lockPlayer(client, me.id);
    await client.query("DELETE FROM album_pages WHERE player_id = $1", [me.id]);
    await client.query("DELETE FROM stamps WHERE player_id = $1", [me.id]);
    await changeFilm(client, me.id, FULL_ROLL - await filmOf(client, me.id), "restart");
    return await one(client, `UPDATE players SET island = $2, tile_x = $3, tile_y = $4, heading = $5 WHERE id = $1 RETURNING ${PLAYER_COLUMNS}`, [me.id, HARBOUR, start.tile[0], start.tile[1], start.heading]);
  });
  const position = positionOf(moved);
  await publish(pool, { players: [me.id] }, "restart", { position, progress: await readAlbums(pool, me.id) });
  await announceHost(pool, me, position);
  return { status: 200, body: { position, film: FULL_ROLL, stamps: 0, lighthouse: "closed" } };
});
route("GET", "/api/me/settings", "required", async (c) => ({ status: 200, body: { settings: settingsOf(self(c)) } }));
route("PUT", "/api/me/settings", "required", async (c) => {
  const me = self(c);
  const body = await c.json();
  const volume = (value) => isInteger(value) && value >= 0 && value <= 100;
  if (!volume(body.music) || !volume(body.effects) || body.graphics !== "full" && body.graphics !== "balanced" && body.graphics !== "light") throw new ApiError("bad_request");
  const saved = await one(pool, `UPDATE players SET music = $2, effects = $3, graphics = $4 WHERE id = $1 RETURNING ${PLAYER_COLUMNS}`, [me.id, body.music, body.effects, body.graphics]);
  const settings = settingsOf(saved);
  return { status: 200, body: { settings } };
});
route("GET", "/api/world", "required", async (c) => {
  const me = self(c);
  const stamps = await stampCount(pool, me.id);
  return { status: 200, body: worldAnswer(me.world_id, await readTick(pool, me.world_id), lighthouseOf(stamps)) };
});

// server/main.ts
init_live();
init_safaris();

// server/photos.ts
init_config();
init_db();
init_errors();
init_http();
init_live();
import { randomUUID as randomUUID3 } from "node:crypto";
init_film();
init_safaris();
init_score();

// server/turns.ts
var locks = /* @__PURE__ */ new Map();
async function inTurn(key, work) {
  const before = locks.get(key) ?? Promise.resolve();
  const turn = before.then(work, work);
  locks.set(key, turn);
  try {
    return await turn;
  } finally {
    if (locks.get(key) === turn) locks.delete(key);
  }
}

// server/photos.ts
init_s3();
init_validate();
init_world();
init_island();
var PAGE_REWARD = 6;
var ZOOMS = [1, 2, 4];
var FOCUSES = [2, 4, 8, 16];
var WHOLE_REQUEST_EXTRA = 64e3;
var PHOTO_COLUMNS = "p.id, p.player_id, p.creature_id, p.island, p.tick, p.size, p.centring, p.facing, p.sharpness, p.total, p.image_key";
function toPhoto(row) {
  return {
    id: row.id,
    creature: row.creature_id,
    creature_name: creatureById(row.creature_id).name,
    island: row.island,
    tick: row.tick,
    score: { size: row.size, centring: row.centring, facing: row.facing, sharpness: row.sharpness, total: row.total },
    image_url: `/api/photos/${row.id}/image`
  };
}
async function visiblePhoto(db, photoId, viewerId) {
  const row = await one(
    db,
    `SELECT ${PHOTO_COLUMNS} FROM photos p WHERE p.id = $1 AND (
       p.player_id = $2
       OR EXISTS (SELECT 1 FROM hall_frames f JOIN players o ON o.id = f.player_id WHERE f.photo_id = p.id AND o.hall_public)
       OR EXISTS (SELECT 1 FROM board_entries b WHERE b.photo_id = p.id)
       OR EXISTS (SELECT 1 FROM postcards c WHERE c.photo_id = p.id)
       OR EXISTS (SELECT 1 FROM safari_photos sp JOIN safaris s ON s.id = sp.safari_id WHERE sp.photo_id = p.id AND s.guest_id = $2 AND s.status = 'joined'))`,
    [photoId, viewerId]
  );
  if (!row) throw new ApiError("not_found");
  return row;
}
async function ownPhoto(db, photoId, playerId) {
  const row = isText(photoId) ? await one(db, `SELECT ${PHOTO_COLUMNS} FROM photos p WHERE p.id = $1 AND p.player_id = $2`, [photoId, playerId]) : void 0;
  if (!row) throw new ApiError("not_found");
  return row;
}
async function readStoredImage(row, variant) {
  try {
    return await getObject(row.image_key);
  } catch (error) {
    if (error instanceof StorageError) throw new ApiError("storage_unavailable", variant);
    throw error;
  }
}
function readPose(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  const pose = raw;
  const tile = readTile(pose.tile);
  const camera = Array.isArray(pose.camera) && pose.camera.length === 2 && pose.camera.every((n) => typeof n === "number" && Number.isFinite(n)) ? pose.camera : null;
  if (!isIslandId(pose.island) || !tile || !camera || !isHeading(pose.heading) || !ZOOMS.includes(pose.zoom) || !FOCUSES.includes(pose.focus) || !isInteger(pose.tick) || pose.tick < 0) return null;
  return { island: pose.island, tile, camera, heading: pose.heading, zoom: pose.zoom, focus: pose.focus, tick: pose.tick };
}
function readSignature(image) {
  if (image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { type: "image/png", extension: "png" };
  if (image[0] === 255 && image[1] === 216 && image[2] === 255) return { type: "image/jpeg", extension: "jpg" };
  return null;
}
async function receive(c) {
  const raw = await c.raw(config.photoMaxBytes + WHOLE_REQUEST_EXTRA, "photo_too_large");
  let form;
  try {
    form = await new Request("http://localhost/", { method: "POST", headers: { "content-type": String(c.req.headers["content-type"]) }, body: new Uint8Array(raw) }).formData();
  } catch {
    throw new ApiError("bad_request");
  }
  const image = form.get("image");
  const pose = form.get("pose");
  let parsed = null;
  try {
    parsed = typeof pose === "string" ? JSON.parse(pose) : null;
  } catch {
    parsed = null;
  }
  return { image: image instanceof File ? Buffer.from(await image.arrayBuffer()) : null, pose: parsed };
}
async function keep(me, pose, image, kind, shotKey) {
  const present = creaturesAt(pose.tick).filter((creature) => creature.island === pose.island);
  const scored = scorePhoto({ tile: pose.tile, heading: pose.heading, zoom: pose.zoom, focus: pose.focus }, present);
  if (!scored) throw new ApiError("nothing_in_frame");
  const id = randomUUID3();
  const imageKey = `photos/${id}.${kind.extension}`;
  let stored = false;
  try {
    return await transaction(async (client) => {
      await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [me.id]);
      if (await filmOf(client, me.id) < 1) throw new ApiError("out_of_film");
      try {
        await putObject(imageKey, image, kind.type);
      } catch (error) {
        if (error instanceof StorageError) throw new ApiError("storage_unavailable", "photo");
        throw error;
      }
      stored = true;
      const { score, measures, creature } = scored;
      await client.query(
        `INSERT INTO photos (id, player_id, creature_id, island, tick, size, centring, facing, sharpness, total, measures, pose, shot_key, image_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [id, me.id, creature.id, pose.island, pose.tick, score.size, score.centring, score.facing, score.sharpness, score.total, measures, pose, shotKey, imageKey]
      );
      await changeFilm(client, me.id, -1, "photo");
      const existing = await one(client, "SELECT p.total FROM album_pages a JOIN photos p ON p.id = a.photo_id WHERE a.player_id = $1 AND a.creature_id = $2", [me.id, creature.id]);
      const pageFilled = score.total >= PAGE_TOTAL && !existing;
      if (pageFilled) {
        await client.query("INSERT INTO album_pages (player_id, creature_id, photo_id) VALUES ($1, $2, $3)", [me.id, creature.id, id]);
        await changeFilm(client, me.id, PAGE_REWARD, "page");
      } else if (existing && score.total > existing.total) {
        await client.query("UPDATE album_pages SET photo_id = $3 WHERE player_id = $1 AND creature_id = $2", [me.id, creature.id, id]);
      }
      const [counted] = await rows(client, "SELECT COUNT(*)::int AS n FROM album_pages WHERE player_id = $1 AND creature_id = ANY($2)", [me.id, creaturesOfIsland(pose.island).map((c) => c.id)]);
      const pagesFilled = counted.n;
      const stampEarned = pagesFilled === creaturesOfIsland(pose.island).length && (await client.query("INSERT INTO stamps (player_id, island) VALUES ($1, $2) ON CONFLICT DO NOTHING", [me.id, pose.island])).rowCount === 1;
      const answer = {
        photo: {
          id,
          creature: creature.id,
          creature_name: creature.name,
          island: pose.island,
          tick: pose.tick,
          score,
          measures,
          album: { page_filled: pageFilled, pages_filled: pagesFilled, stamp_earned: stampEarned },
          film: await filmOf(client, me.id),
          image_url: `/api/photos/${id}/image`
        }
      };
      await client.query("UPDATE photos SET answer = $2 WHERE id = $1", [id, answer]);
      return { answer, guest: await feedSeatedGuest(client, me.id, id) };
    });
  } catch (error) {
    if (stored) await deleteObject(imageKey).catch(() => void 0);
    throw error;
  }
}
route("POST", "/api/photos", "required", async (c) => {
  const me = c.player;
  const { image, pose: rawPose } = await receive(c);
  const shotKey = isText(c.req.headers["shot-key"]) && c.req.headers["shot-key"] !== "" ? c.req.headers["shot-key"] : null;
  const pose = readPose(rawPose);
  const run = async () => {
    let keyUsed = false;
    if (shotKey) {
      const used = await one(pool, "SELECT answer, pose FROM photos WHERE player_id = $1 AND shot_key = $2", [me.id, shotKey]);
      if (used) {
        if (pose && stable(pose) === stable(used.pose)) return { replay: used.answer };
        keyUsed = true;
      }
    }
    if (image && image.length > config.photoMaxBytes) throw new ApiError("photo_too_large", String(config.photoMaxBytes));
    const kind = image ? readSignature(image) : null;
    if (!image || !kind) throw new ApiError("not_an_image");
    if (await filmOf(pool, me.id) < 1) throw new ApiError("out_of_film");
    if (keyUsed) throw new ApiError("shot_key_reused");
    if (!pose) throw new ApiError("bad_pose");
    const serverTick = await readTick(pool, me.world_id);
    if (pose.tick < serverTick - config.photoTickGrace) throw new ApiError("tick_passed");
    if (pose.tick > serverTick) throw new ApiError("tick_ahead");
    if (!isLand(islandById(pose.island), pose.tile[0], pose.tile[1])) throw new ApiError("cannot_stand");
    if (Math.abs(pose.camera[0] - pose.tile[0]) > 1 || Math.abs(pose.camera[1] - pose.tile[1]) > 1) throw new ApiError("camera_too_far");
    return keep(me, pose, image, kind, shotKey);
  };
  const result = await (shotKey ? inTurn(`${me.id}:${shotKey}`, run) : run());
  if ("replay" in result) return { status: 201, body: result.replay };
  const { answer, guest } = result;
  await publish(pool, { players: [me.id] }, "progress", await readAlbums(pool, me.id));
  if (guest) {
    const { measures: _m, album: _a, film: _f, ...photo } = answer.photo;
    await publish(pool, { players: [guest] }, "safari_photo", { host_name: me.name, photo });
  }
  return { status: 201, body: answer };
});
route("GET", "/api/me/photos", "required", async (c) => {
  const found = await rows(pool, `SELECT ${PHOTO_COLUMNS} FROM photos p WHERE p.player_id = $1 ORDER BY p.created_at DESC`, [c.player.id]);
  return { status: 200, body: { photos: found.map(toPhoto) } };
});
route("GET", "/api/photos/:id", "required", async (c) => ({ status: 200, body: { photo: toPhoto(await visiblePhoto(pool, c.params[0], c.player.id)) } }));
route("GET", "/api/photos/:id/image", "optional", async (c) => {
  const row = await visiblePhoto(pool, c.params[0], c.player?.id ?? null);
  const data = await readStoredImage(row, "image");
  return { status: 200, bytes: { data, type: row.image_key.endsWith(".png") ? "image/png" : "image/jpeg" } };
});

// server/halls.ts
init_db();
init_errors();
init_http();
init_live();
init_validate();
var HALL_SIZE = 12;
var CAPTION_LIMIT = 140;
async function framesOf(db, ownerId, viewerId) {
  const found = await rows(
    db,
    `SELECT f.frame, f.caption, ${PHOTO_COLUMNS},
            (SELECT COUNT(*)::int FROM likes l WHERE l.photo_id = p.id) AS likes,
            EXISTS (SELECT 1 FROM likes l WHERE l.photo_id = p.id AND l.visitor_id = $2) AS liked_by_me
     FROM hall_frames f JOIN photos p ON p.id = f.photo_id WHERE f.player_id = $1 ORDER BY f.frame`,
    [ownerId, viewerId]
  );
  return found.map((row) => ({ frame: row.frame, caption: row.caption, photo: toPhoto(row), likes: row.likes, liked_by_me: row.liked_by_me }));
}
async function ownHall(db, me) {
  const hall = await one(db, "SELECT hall_public FROM players WHERE id = $1", [me.id]);
  const frames = (await framesOf(db, me.id, null)).map(({ liked_by_me: _liked, ...frame }) => frame);
  return { handle: me.handle, public: hall.hall_public, frames };
}
route("GET", "/api/me/hall", "required", async (c) => ({ status: 200, body: { hall: await ownHall(pool, c.player) } }));
route("PUT", "/api/me/hall", "required", async (c) => {
  const me = c.player;
  const body = await c.json();
  if (body.public !== void 0 && typeof body.public !== "boolean") throw new ApiError("bad_request");
  let wanted = null;
  if (body.frames !== void 0) {
    if (!Array.isArray(body.frames)) throw new ApiError("bad_request");
    wanted = [];
    for (const item of body.frames) {
      if (typeof item !== "object" || item === null || item.caption !== void 0 && !isText(item.caption)) throw new ApiError("bad_request");
      wanted.push({ photo: (await ownPhoto(pool, item.photo, me.id)).id, caption: item.caption ?? "" });
    }
    if (new Set(wanted.map((w) => w.photo)).size !== wanted.length) throw new ApiError("bad_request");
    if (wanted.length > HALL_SIZE) throw new ApiError("hall_full");
    if (wanted.some((w) => lengthOf(w.caption) > CAPTION_LIMIT)) throw new ApiError("caption_too_long");
  }
  await transaction(async (client) => {
    if (body.public !== void 0) await client.query("UPDATE players SET hall_public = $2 WHERE id = $1", [me.id, body.public]);
    if (wanted) {
      await client.query("DELETE FROM hall_frames WHERE player_id = $1", [me.id]);
      for (const [index, item] of wanted.entries()) await client.query("INSERT INTO hall_frames (player_id, photo_id, frame, caption) VALUES ($1, $2, $3, $4)", [me.id, item.photo, index + 1, item.caption]);
    }
  });
  return { status: 200, body: { hall: await ownHall(pool, me) } };
});
route("GET", "/api/halls/:handle", "optional", async (c) => {
  const owner = await one(pool, "SELECT id, name, hall_public FROM players WHERE handle = $1", [c.params[0]]);
  if (!owner || !owner.hall_public && owner.id !== c.player?.id) throw new ApiError("not_found");
  const hall = { handle: c.params[0], owner_name: owner.name, frames: await framesOf(pool, owner.id, c.player?.id ?? null) };
  return { status: 200, body: { hall } };
});
async function setLike(c, liked) {
  const me = c.player;
  const hung = await one(
    pool,
    `SELECT o.id AS owner_id, o.handle FROM hall_frames f JOIN players o ON o.id = f.player_id WHERE f.photo_id = $1 AND (o.hall_public OR o.id = $2)`,
    [c.params[0], me.id]
  );
  if (!hung) throw new ApiError("not_found");
  if (hung.owner_id === me.id) throw new ApiError("own_photo");
  const photoId = c.params[0];
  const changed = liked ? (await pool.query("INSERT INTO likes (photo_id, visitor_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [photoId, me.id])).rowCount === 1 : (await pool.query("DELETE FROM likes WHERE photo_id = $1 AND visitor_id = $2", [photoId, me.id])).rowCount === 1;
  const counted = await one(pool, "SELECT COUNT(*)::int AS likes FROM likes WHERE photo_id = $1", [photoId]);
  if (changed) {
    const photo = toPhoto(await one(pool, `SELECT ${PHOTO_COLUMNS} FROM photos p WHERE p.id = $1`, [photoId]));
    await publish(pool, { players: [hung.owner_id, me.id], hall: hung.handle }, "like", { photo: photoId, creature_name: photo.creature_name, likes: counted.likes, visitor: me.id, visitor_name: me.name, liked });
  }
  return { status: 200, body: { likes: counted.likes, liked } };
}
route("PUT", "/api/photos/:id/like", "required", (c) => setLike(c, true));
route("DELETE", "/api/photos/:id/like", "required", (c) => setLike(c, false));

// server/notes.ts
init_db();
init_errors();
init_http();
init_live();

// server/request-keys.ts
init_db();
init_errors();
init_validate();
import { createHash as createHash3 } from "node:crypto";
function requestKeyOf(c) {
  const key = c.req.headers["request-key"];
  return typeof key === "string" && key !== "" ? key : null;
}
async function lookUp(playerId, kind, c, body) {
  const key = requestKeyOf(c);
  const hash = createHash3("sha256").update(stable(body)).digest("hex");
  const stored = key ? await one(pool, "SELECT body_hash, status, response FROM request_keys WHERE player_id = $1 AND kind = $2 AND key = $3", [playerId, kind, key]) : void 0;
  return { key, hash, replay: stored && stored.body_hash === hash ? { status: stored.status, body: stored.response } : null, used: stored !== void 0 && stored.body_hash !== hash };
}
function assertUnused(state) {
  if (state.used) throw new ApiError("request_key_reused");
}
async function remember(db, playerId, kind, state, answer) {
  if (state.key) await db.query("INSERT INTO request_keys (player_id, kind, key, body_hash, status, response) VALUES ($1, $2, $3, $4, $5, $6)", [playerId, kind, state.key, state.hash, answer.status, answer.body]);
}

// server/notes.ts
init_validate();
var NOTE_LIMIT = 140;
var REASONS = ["Not about the islands", "Unkind", "Shares personal details"];
var SELECT2 = `SELECT n.id, n.text, n.author_id, a.name AS author_name, n.status, n.reason, d.name AS decided_by
  FROM notes n JOIN players a ON a.id = n.author_id LEFT JOIN players d ON d.id = n.decided_by`;
var toNote = (row) => ({ id: row.id, text: row.text, author_name: row.author_name, status: row.status, reason: row.reason, decided_by: row.decided_by });
async function noteOf(db, worldId, id) {
  const row = await one(db, `${SELECT2} WHERE n.id = $1 AND n.world_id = $2`, [id, worldId]);
  if (!row) throw new ApiError("not_found");
  return row;
}
function assertRanger(me) {
  if (!me.ranger) throw new ApiError("not_ranger");
}
route("GET", "/api/notes", "required", async (c) => {
  const me = c.player;
  const found = await rows(pool, `${SELECT2} WHERE n.world_id = $1 AND (n.status = 'approved' OR n.author_id = $2) ORDER BY n.created_at DESC`, [me.world_id, me.id]);
  return { status: 200, body: { notes: found.map(toNote) } };
});
route("GET", "/api/ranger/notes", "required", async (c) => {
  const me = c.player;
  assertRanger(me);
  const found = await rows(pool, `${SELECT2} WHERE n.world_id = $1 AND n.status = 'pending' ORDER BY n.created_at`, [me.world_id]);
  return { status: 200, body: { notes: found.map(toNote) } };
});
route("POST", "/api/notes", "required", async (c) => {
  const me = c.player;
  const body = await c.json();
  return inTurn(`note:${me.id}`, async () => {
    const state = await lookUp(me.id, "note", c, body);
    if (state.replay) return state.replay;
    if (!me.confirmed) throw new ApiError("unconfirmed");
    assertUnused(state);
    const text2 = isText(body.text) ? body.text : "";
    if (isBlank(text2)) throw new ApiError("note_empty");
    if (lengthOf(text2) > NOTE_LIMIT) throw new ApiError("note_too_long");
    const answer = await transaction(async (client) => {
      const made = await one(client, "INSERT INTO notes (world_id, author_id, text) VALUES ($1, $2, $3) RETURNING id", [me.world_id, me.id, text2]);
      const stored = { status: 201, body: { note: { id: made.id, text: text2, status: "pending" } } };
      await remember(client, me.id, "note", state, stored);
      return stored;
    });
    await publish(pool, { rangers: me.world_id }, "note", { kind: "pending", note: toNote(await noteOf(pool, me.world_id, answer.body.note.id)) });
    return answer;
  });
});
async function decide(me, id, status, reason) {
  const decided = await one(pool, `UPDATE notes SET status = $3, reason = $4, decided_by = $2 WHERE id = $1 AND status = 'pending' RETURNING id`, [id, me.id, status, reason]);
  if (!decided) await refuseDecided(me, id);
  const note = toNote(await noteOf(pool, me.world_id, id));
  const author = await one(pool, "SELECT author_id FROM notes WHERE id = $1", [id]);
  if (status === "approved") await publish(pool, { world: me.world_id }, "note", { kind: "approved", note });
  else await publish(pool, { players: [author.author_id], rangers: me.world_id }, "note", { kind: "declined", note });
  return note;
}
async function refuseDecided(me, id) {
  const row = await noteOf(pool, me.world_id, id);
  throw new ApiError("note_decided", `${row.status} by ${row.decided_by}`);
}
route("POST", "/api/notes/:id/approve", "required", async (c) => {
  const me = c.player;
  const row = await noteOf(pool, me.world_id, c.params[0]);
  assertRanger(me);
  if (row.status !== "pending") await refuseDecided(me, row.id);
  return { status: 200, body: { note: await decide(me, row.id, "approved", null) } };
});
route("POST", "/api/notes/:id/decline", "required", async (c) => {
  const me = c.player;
  const row = await noteOf(pool, me.world_id, c.params[0]);
  assertRanger(me);
  if (row.status !== "pending") await refuseDecided(me, row.id);
  const body = await c.json();
  if (!isText(body.reason) || !REASONS.includes(body.reason)) throw new ApiError("bad_reason");
  return { status: 200, body: { note: await decide(me, row.id, "declined", body.reason) } };
});
route("DELETE", "/api/notes/:id", "required", async (c) => {
  const me = c.player;
  const row = await noteOf(pool, me.world_id, c.params[0]);
  assertRanger(me);
  if (row.status !== "approved") throw new ApiError("note_not_approved");
  await pool.query("DELETE FROM notes WHERE id = $1", [row.id]);
  await publish(pool, { world: me.world_id }, "note", { kind: "removed", note: toNote(row) });
  return { status: 204 };
});

// server/boards.ts
init_db();
init_errors();
init_http();
init_live();
init_validate();
init_island();
async function rankedEntries(db, island, worldId) {
  return rows(
    db,
    `SELECT ROW_NUMBER() OVER (ORDER BY p.total DESC, p.tick ASC, e.created_at ASC)::int AS rank,
            pl.id AS player_id, pl.name AS player, pl.handle, p.creature_id AS creature, p.total, p.tick, p.id AS photo
     FROM board_entries e JOIN players pl ON pl.id = e.player_id JOIN photos p ON p.id = e.photo_id
     WHERE e.island = $1 AND pl.world_id = $2 ORDER BY rank`,
    [island, worldId]
  );
}
var toEntry = ({ player_id: _player, ...entry }) => ({ ...entry, creature_name: creatureNameOf(entry.creature) });
var creatureNameOf = (id) => creatureById(id).name;
function islandOf(param) {
  const island = Number(param);
  if (!isIslandId(island) || !islandById(island)) throw new ApiError("not_found");
  return island;
}
route("GET", "/api/boards/:island", "required", async (c) => {
  const me = c.player;
  const all = await rankedEntries(pool, islandOf(c.params[0]), me.world_id);
  const text2 = c.url.searchParams.get("player");
  const shown = text2 === null ? all : all.filter((entry) => entry.player.toLowerCase().includes(text2.toLowerCase()));
  const board = { entries: shown.map(toEntry), total: all.length, shown: shown.length };
  return { status: 200, body: board };
});
route("POST", "/api/boards/:island/entries", "required", async (c) => {
  const me = c.player;
  const island = islandOf(c.params[0]);
  const body = await c.json();
  const photo = await ownPhoto(pool, body.photo, me.id);
  if (!me.confirmed) throw new ApiError("unconfirmed");
  if (photo.island !== island) throw new ApiError("wrong_island");
  const { before, entered } = await transaction(async (client) => {
    await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [me.id]);
    const earlier = await one(client, "SELECT p.total FROM board_entries e JOIN photos p ON p.id = e.photo_id WHERE e.island = $1 AND e.player_id = $2", [island, me.id]);
    const better = !earlier || photo.total > earlier.total;
    if (!earlier) await client.query("INSERT INTO board_entries (island, player_id, photo_id) VALUES ($1, $2, $3)", [island, me.id, photo.id]);
    else if (better) await client.query("UPDATE board_entries SET photo_id = $3 WHERE island = $1 AND player_id = $2", [island, me.id, photo.id]);
    return { before: earlier, entered: better };
  });
  const mine = (await rankedEntries(pool, island, me.world_id)).find((entry) => entry.player_id === me.id);
  if (entered) await publish(pool, { world: me.world_id }, "board", { island, player_name: me.name, rank: mine.rank });
  return { status: before ? 200 : 201, body: { entry: toEntry(mine) } };
});

// server/postcards.ts
init_config();
init_db();
init_errors();
init_http();
import { randomUUID as randomUUID4 } from "node:crypto";
init_validate();
init_island();
var LINE_LIMIT = 140;
async function assertWithinLimit(me) {
  const window = await one(
    pool,
    `SELECT COUNT(*)::int AS sent, COALESCE(CEIL(EXTRACT(EPOCH FROM MIN(posted_at) + make_interval(secs => $2) - now())), 0)::int AS retry
     FROM postcards WHERE player_id = $1 AND posted_at > now() - make_interval(secs => $2)`,
    [me.id, config.postcardWindowSeconds]
  );
  if (window && window.sent >= config.postcardLimit) throw new ApiError("postcard_limit", String(config.postcardLimit), { "Retry-After": String(Math.max(1, window.retry)) });
}
route("POST", "/api/postcards", "required", async (c) => {
  const me = c.player;
  const body = await c.json();
  return inTurn(`postcard:${me.id}`, async () => {
    const state = await lookUp(me.id, "postcard", c, body);
    if (state.replay) return state.replay;
    const photo = await ownPhoto(pool, body.photo, me.id);
    if (!me.confirmed) throw new ApiError("unconfirmed");
    assertUnused(state);
    const recipient = isText(body.recipient) ? body.recipient.trim() : "";
    const line = isText(body.line) ? body.line : "";
    if (!EMAIL.test(recipient)) throw new ApiError("bad_email");
    if (isBlank(line)) throw new ApiError("line_empty");
    if (lengthOf(line) > LINE_LIMIT) throw new ApiError("line_too_long");
    await assertWithinLimit(me);
    const image = await readStoredImage(photo, "postcard");
    const id = randomUUID4();
    const url = `${config.publicUrl}/postcards/${id}`;
    const { creature_name, score, island } = toPhoto(photo);
    await sendMail({
      to: recipient,
      subject: `A postcard from ${me.name} on ${islandById(island).name}`,
      text: `${line}

${creature_name}, ${score.total} points
${url}
`,
      attachment: { filename: `postcard.${photo.image_key.split(".").pop()}`, content: image }
    }).catch((error) => {
      if (error instanceof MailError) throw new ApiError("mail_unavailable", "postcard");
      throw error;
    });
    const answer = { status: 201, body: { postcard: { id, url, status: "posted" } } };
    await transaction(async (client) => {
      await client.query("INSERT INTO postcards (id, player_id, photo_id, recipient, line) VALUES ($1, $2, $3, $4, $5)", [id, me.id, photo.id, recipient, line]);
      await remember(client, me.id, "postcard", state, answer);
    });
    return answer;
  });
});
route("GET", "/api/postcards/:id", "none", async (c) => {
  const card = await one(
    pool,
    `SELECT c.id, c.photo_id, c.line, s.name AS sender_name, p.creature_id, p.island, p.total
     FROM postcards c JOIN players s ON s.id = c.player_id JOIN photos p ON p.id = c.photo_id WHERE c.id = $1`,
    [c.params[0]]
  );
  if (!card) throw new ApiError("not_found");
  const postcard = {
    id: card.id,
    image_url: `/api/photos/${card.photo_id}/image`,
    creature_name: creatureById(card.creature_id).name,
    total: card.total,
    island_name: islandById(card.island).name,
    line: card.line,
    sender_name: card.sender_name
  };
  return { status: 200, body: { postcard } };
});

// server/main.ts
init_live();
init_safaris();

// server/seed.ts
init_db();
init_players();
var MAIN_START_TICK = 6e3;
async function seedMainWorld(client) {
  const world = await one(client, `SELECT id FROM worlds WHERE kind = 'main'`);
  const worldId = world?.id ?? (await one(
    client,
    `INSERT INTO worlds (kind, frozen, tick, anchor_tick, anchor_ms) VALUES ('main', false, $1, $1, (extract(epoch from clock_timestamp()) * 1000)::bigint) RETURNING id`,
    [MAIN_START_TICK]
  )).id;
  if (!await one(client, "SELECT 1 FROM players WHERE lower(email) = $1", ["ranger@hushfoot.example"])) {
    await createPlayer(client, { worldId, name: "Sal Marram", email: "ranger@hushfoot.example", password: "Harbour-Ranger-1", confirmed: true, ranger: true });
  }
}

// server/health.ts
init_db();
init_http();
init_s3();
var BUDGET_MS = 1500;
async function databaseAnswers() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), BUDGET_MS));
  const query = pool.query("SELECT 1").then(() => true, () => false);
  return Promise.race([query, timeout]);
}
route("GET", "/api/health", "none", async () => {
  const [database, storage] = await Promise.all([databaseAnswers(), storageAnswers()]);
  return { status: 200, body: { status: database && storage ? "ok" : "unavailable" } };
});

// server/main.ts
async function prepareDatabase() {
  try {
    await migrate(seedMainWorld);
    markDatabaseReady();
  } catch (error) {
    if (!isDatabaseDown(error)) console.error(error);
    setTimeout(() => void prepareDatabase(), 1e3);
  }
}
if (config.gradingRoutes) await Promise.resolve().then(() => (init_grading(), grading_exports));
createHttpServer(meOf).listen(config.port, "0.0.0.0");
startLive();
startSeatSweeper();
void prepareDatabase();
process.on("SIGTERM", () => void pool.end().finally(() => process.exit(0)));
