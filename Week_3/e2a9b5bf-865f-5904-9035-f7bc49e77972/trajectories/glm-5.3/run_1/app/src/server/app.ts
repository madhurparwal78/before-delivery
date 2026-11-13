// The Lowlamp Field Log server: schema, seed, API and the app shell.
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import { readConfig, type AppConfig } from "./config.js";
import { createPool, prepare } from "./db.js";
import { makeStorage } from "./services/storage.js";
import { makeRenderer } from "./services/renderer.js";
import { makeMail } from "./services/mail.js";
import { apiErrorHandler, errors } from "./errors.js";
import { applySyncBatch } from "./sync.js";
import {
  accountForSession, checkLock, createSession, deleteSession, hashPassword, lockKeyFor,
  recordFailure, resetFailures, SESSION_COOKIE, verifyPassword,
} from "./auth.js";
import { fieldMessages } from "#shared/messages.js";
import { catalogue } from "#shared/catalogue.js";
import { normaliseEmail, validDisplayName, validPassword, validKitName, validTelescopeFocal, validEyepieceFocal, validApparentField, validBarlowFactor, validLatitude, validLongitude, validTimeZone } from "./validate.js";
import { SYNC_CHANGE_LIMIT } from "#shared/strokes.js";
import { programSummariesFor, programDetailFor } from "./programs.js";
import { checkPacket, createPacket, finishRender, loadPacket, mapPacket, replaceRows, sendPacket, startRender } from "./packets.js";
import { observationFromRow, sessionFromRow, OBSERVATION_SELECT, SESSION_SELECT, PACKET_SELECT, type ObservationRow, type SessionRow } from "./rows.js";

const publicDir = join(process.cwd(), "public");

export interface ServerContext {
  readonly config: AppConfig;
  readonly pool: ReturnType<typeof createPool>;
  readonly storage: ReturnType<typeof makeStorage>;
  readonly renderer: ReturnType<typeof makeRenderer>;
  readonly mail: ReturnType<typeof makeMail>;
}

function noStore(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
}

async function requireAccount(req: Request): Promise<string> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const account = await accountForSession(req.app.locals["pool"], token);
  if (!account) throw errors.unauthenticated();
  return account.id;
}

export function buildApp(context: ServerContext): Express {
  const app = express();
  app.locals["pool"] = context.pool;
  app.locals["context"] = context;
  app.disable("x-powered-by");
  app.use(cookieParser());

  // ---- server boundary ---------------------------------------------------
  app.use((req, res, next) => {
    const isSync = req.path === "/api/sync" && req.method === "POST";
    const limit = isSync ? 5_000_000 : 100_000;
    let size = 0;
    let exceeded = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit && !exceeded) {
        exceeded = true;
        res.status(413).json({ error: "too_large" });
        req.destroy();
      }
    });
    next();
  });

  app.use(express.json({
    limit: "5000000kb",
    type: "application/json",
  }));

  app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const origin = req.headers["origin"];
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (parsed.host !== (req.headers["host"] ?? "")) return next(errors.crossOrigin());
      } catch {
        return next(errors.crossOrigin());
      }
    }
    next();
  });

  const wrap = (handler: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) => {
      handler(req, res).catch(next);
    };

  // ---- health ------------------------------------------------------------
  app.get("/api/health", wrap(async (req, res) => {
    try {
      await context.pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "starting" });
    }
  }));

  app.use("/api", (req, res, next) => {
    // Only a request that actually carries a body must declare application/json.
    const length = Number(req.headers["content-length"] ?? "0");
    if (req.method !== "GET" && req.method !== "HEAD" && length > 0) {
      const contentType = (req.headers["content-type"] ?? "").split(";")[0];
      if (contentType !== "application/json") {
        return next(errors.unsupportedMediaType());
      }
    }
    next();
  });

  // ---- accounts ------------------------------------------------------------
  app.post("/api/auth/signup", wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const email = normaliseEmail(body["email"]);
    const password = validPassword(body["password"]);
    const name = validDisplayName(body["display_name"]);
    const fields: Record<string, string> = {};
    if (email.error) fields["email"] = email.error;
    if (password.error) fields["password"] = password.error;
    if (name.error) fields["display_name"] = name.error;
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const existing = await context.pool.query("SELECT id FROM accounts WHERE email_normalised = $1", [email.normalised]);
    if (existing.rows.length > 0) throw errors.emailTaken();
    const id = crypto.randomUUID();
    await context.pool.query(
      "INSERT INTO accounts (id, email, email_normalised, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)",
      [id, email.normalised, email.normalised, name.name, hashPassword(password.password!)],
    );
    const session = await createSession(context.pool, context.config, id);
    res.cookie(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: context.config.signinSessionSeconds });
    res.status(201).json({ account: { id, email: email.normalised, display_name: name.name } });
  }));

  app.post("/api/auth/signin", wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const email = normaliseEmail(body["email"]);
    const password = typeof body["password"] === "string" ? body["password"] : "";
    const fields: Record<string, string> = {};
    if (email.error) fields["email"] = email.error;
    if (password.length < 1) fields["password"] = fieldMessages.password;
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    // Attempts for one email are counted one at a time, serialised on a
    // per-email advisory lock held for the whole attempt (DP-61).
    const client = await context.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [lockKeyFor(email.normalised!)]);
      const lock = await checkLock(client, context.config, email.normalised!);
      if (lock.locked) {
        await client.query("COMMIT");
        res.setHeader("Retry-After", String(lock.retryAfterSeconds));
        res.status(429).json({ error: "too_many_attempts" });
        return;
      }
      const account = await client.query<{ id: string; email: string; display_name: string; password_hash: string }>(
        "SELECT id, email, display_name, password_hash FROM accounts WHERE email_normalised = $1",
        [email.normalised],
      );
      const row = account.rows[0];
      if (!row || !verifyPassword(password, row.password_hash)) {
        await recordFailure(client, email.normalised!);
        await client.query("COMMIT");
        res.status(401).json({ error: "bad_credentials" });
        return;
      }
      await resetFailures(client, email.normalised!);
      await client.query("COMMIT");
      const session = await createSession(context.pool, context.config, row.id);
      res.cookie(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: context.config.signinSessionSeconds });
      res.json({ account: { id: row.id, email: row.email, display_name: row.display_name } });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // connection already broken
      }
      throw error;
    } finally {
      client.release();
    }
  }));

  app.post("/api/auth/signout", wrap(async (req, res) => {
    await requireAccount(req).catch(() => { throw errors.unauthenticated(); });
    await deleteSession(context.pool, req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  }));

  app.get("/api/auth/me", wrap(async (req, res) => {
    noStore(res);
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const account = await accountForSession(context.pool, token);
    if (!account) throw errors.unauthenticated();
    res.json({ account: { id: account.id, email: account.email, display_name: account.display_name } });
  }));

  // ---- kit and sites ---------------------------------------------------------
  app.get("/api/kit", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const telescopes = await context.pool.query("SELECT id, name, aperture_mm, focal_length_mm FROM telescopes WHERE account_id = $1 ORDER BY position, created_at", [accountId]);
    const eyepieces = await context.pool.query("SELECT id, name, focal_length_mm, apparent_field_deg FROM eyepieces WHERE account_id = $1 ORDER BY focal_length_mm DESC, created_at ASC", [accountId]);
    const barlows = await context.pool.query("SELECT id, name, factor FROM barlows WHERE account_id = $1 ORDER BY created_at", [accountId]);
    res.json({
      telescopes: telescopes.rows,
      eyepieces: eyepieces.rows.map((row) => ({ ...row, focal_length_mm: Number(row.focal_length_mm), apparent_field_deg: Number(row.apparent_field_deg) })),
      barlows: barlows.rows.map((row) => ({ ...row, factor: Number(row.factor) })),
      trains: [
        { id: "straight", name: "Straight through", rotation_deg: 180, mirrored: false, sentence: "North down, east right." },
        { id: "mirror_diagonal", name: "Mirror diagonal", rotation_deg: 0, mirrored: true, sentence: "North up, east right." },
        { id: "erecting_prism", name: "Erecting prism", rotation_deg: 0, mirrored: false, sentence: "North up, east left." },
      ],
    });
  }));

  app.post("/api/kit/telescopes", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const body = req.body as Record<string, unknown>;
    const name = validKitName(body["name"]);
    const unit = body["aperture_unit"] === "in" ? "in" : body["aperture_unit"] === "mm" ? "mm" : null;
    const apertureRaw = typeof body["aperture"] === "number" ? body["aperture"] : typeof body["aperture"] === "string" ? Number(body["aperture"]) : null;
    const focal = validTelescopeFocal(body["focal_length_mm"]);
    const fields: Record<string, string> = {};
    if (name.error) fields["name"] = name.error;
    if (unit === null || apertureRaw === null || !Number.isFinite(apertureRaw)) fields["aperture"] = fieldMessages.aperture;
    else {
      const mm = unit === "in" ? Math.round(apertureRaw * 254) / 10 : apertureRaw;
      if (mm < 25 || mm > 1600) fields["aperture"] = fieldMessages.aperture;
    }
    if (focal.error) fields["focal_length_mm"] = focal.error;
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const mm = unit === "in" ? Math.round(apertureRaw! * 254) / 10 : apertureRaw!;
    const positionRow = await context.pool.query("SELECT coalesce(max(position), 0) + 1 AS next FROM telescopes WHERE account_id = $1", [accountId]);
    const id = crypto.randomUUID();
    await context.pool.query(
      "INSERT INTO telescopes (id, account_id, name, aperture_mm, focal_length_mm, position) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, accountId, name.name, mm, focal.value, positionRow.rows[0]?.next ?? 1],
    );
    const row = await context.pool.query("SELECT id, name, aperture_mm, focal_length_mm FROM telescopes WHERE id = $1", [id]);
    res.status(201).json(row.rows[0]);
  }));

  app.post("/api/kit/eyepieces", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const body = req.body as Record<string, unknown>;
    const name = validKitName(body["name"]);
    const focal = validEyepieceFocal(body["focal_length_mm"]);
    const field = validApparentField(body["apparent_field_deg"]);
    const fields: Record<string, string> = {};
    if (name.error) fields["name"] = name.error;
    if (focal.error) fields["focal_length_mm"] = focal.error;
    if (field.error) fields["apparent_field_deg"] = field.error;
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const id = crypto.randomUUID();
    await context.pool.query(
      "INSERT INTO eyepieces (id, account_id, name, focal_length_mm, apparent_field_deg) VALUES ($1,$2,$3,$4,$5)",
      [id, accountId, name.name, focal.value, field.value],
    );
    const row = await context.pool.query("SELECT id, name, focal_length_mm, apparent_field_deg FROM eyepieces WHERE id = $1", [id]);
    res.status(201).json({ ...row.rows[0], focal_length_mm: Number(row.rows[0].focal_length_mm), apparent_field_deg: Number(row.rows[0].apparent_field_deg) });
  }));

  app.post("/api/kit/barlows", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const body = req.body as Record<string, unknown>;
    const name = validKitName(body["name"]);
    const factor = validBarlowFactor(body["factor"]);
    const fields: Record<string, string> = {};
    if (name.error) fields["name"] = name.error;
    if (factor.error) fields["factor"] = factor.error;
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const id = crypto.randomUUID();
    await context.pool.query("INSERT INTO barlows (id, account_id, name, factor) VALUES ($1,$2,$3,$4)", [id, accountId, name.name, factor.value]);
    const row = await context.pool.query("SELECT id, name, factor FROM barlows WHERE id = $1", [id]);
    res.status(201).json({ ...row.rows[0], factor: Number(row.rows[0].factor) });
  }));

  app.get("/api/sites", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const rows = await context.pool.query("SELECT id, name, latitude, longitude, time_zone FROM sites WHERE account_id = $1 ORDER BY position, created_at", [accountId]);
    res.json({ sites: rows.rows.map((row) => ({ ...row, latitude: Number(row.latitude), longitude: Number(row.longitude) })) });
  }));

  app.post("/api/sites", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const body = req.body as Record<string, unknown>;
    const name = validKitName(body["name"]);
    const latitude = validLatitude(body["latitude"]);
    const longitude = validLongitude(body["longitude"]);
    const timeZone = validTimeZone(body["time_zone"]);
    const fields: Record<string, string> = {};
    if (name.error) fields["name"] = name.error;
    if (latitude.error) fields["latitude"] = latitude.error;
    if (longitude.error) fields["longitude"] = longitude.error;
    if (timeZone.error) fields["time_zone"] = timeZone.error;
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const positionRow = await context.pool.query("SELECT coalesce(max(position), 0) + 1 AS next FROM sites WHERE account_id = $1", [accountId]);
    const id = crypto.randomUUID();
    await context.pool.query(
      "INSERT INTO sites (id, account_id, name, latitude, longitude, time_zone, position) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, accountId, name.name, latitude.value, longitude.value, timeZone.timeZone, positionRow.rows[0]?.next ?? 1],
    );
    const row = await context.pool.query("SELECT id, name, latitude, longitude, time_zone FROM sites WHERE id = $1", [id]);
    res.status(201).json({ ...row.rows[0], latitude: Number(row.rows[0].latitude), longitude: Number(row.rows[0].longitude) });
  }));

  // ---- catalogue, sessions and observations ------------------------------
  app.get("/api/objects", wrap(async (req, res) => {
    noStore(res);
    await requireAccount(req);
    res.json({ objects: catalogue });
  }));

  app.get("/api/objects/:objectId/history", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const objectId = req.params["objectId"]!;
    if (!catalogue.some((o) => o.id === objectId)) throw errors.notFound();
    const rows = await context.pool.query<ObservationRow>(
      `${OBSERVATION_SELECT} WHERE o.object_id = $1 AND o.account_id = $2 AND o.deleted = false
       ORDER BY (o.observed_at IS NULL), o.observed_at DESC, o.created_at DESC`,
      [objectId, accountId],
    );
    const object = catalogue.find((o) => o.id === objectId)!;
    res.json({ object: { id: object.id, designation: object.designation, name: object.name, kind: object.kind }, observations: rows.rows.map(observationFromRow) });
  }));

  app.get("/api/sessions", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const rows = await context.pool.query<SessionRow>(
      `${SESSION_SELECT} WHERE s.account_id = $1 ORDER BY s.started_at DESC`,
      [accountId],
    );
    res.json({ sessions: rows.rows.map(sessionFromRow) });
  }));

  app.get("/api/sessions/:sessionId", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const rows = await context.pool.query<SessionRow>(`${SESSION_SELECT} WHERE s.id = $1 AND s.account_id = $2`, [req.params["sessionId"], accountId]);
    const session = rows.rows[0];
    if (!session) throw errors.notFound();
    const observations = await context.pool.query<ObservationRow>(
      `${OBSERVATION_SELECT} WHERE o.session_id = $1 AND o.account_id = $2 AND o.deleted = false ORDER BY o.created_at ASC`,
      [session.id, accountId],
    );
    res.json({ ...sessionFromRow(session), observations: observations.rows.map(observationFromRow) });
  }));

  app.get("/api/observations/:observationId", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const rows = await context.pool.query<ObservationRow>(
      `${OBSERVATION_SELECT} WHERE o.id = $1 AND o.account_id = $2 AND o.deleted = false`,
      [req.params["observationId"], accountId],
    );
    const observation = rows.rows[0];
    if (!observation) throw errors.notFound();
    res.json(observationFromRow(observation));
  }));

  app.get("/api/observations/:observationId/strokes", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const rows = await context.pool.query<{ strokes_sha256: string | null; account_id: string; deleted: boolean }>(
      "SELECT strokes_sha256, account_id, deleted FROM observations WHERE id = $1",
      [req.params["observationId"]],
    );
    const record = rows.rows[0];
    if (!record || record.account_id !== accountId || record.deleted || !record.strokes_sha256) throw errors.notFound();
    try {
      const bytes = await context.storage.get(`observers/${accountId}/strokes/${req.params["observationId"]}/${record.strokes_sha256}.json`);
      res.type("application/json").send(Buffer.from(bytes));
    } catch {
      throw errors.storageUnavailable();
    }
  }));

  app.get("/api/observations/:observationId/raster", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const rows = await context.pool.query<{ raster_sha256: string | null; account_id: string; deleted: boolean }>(
      "SELECT raster_sha256, account_id, deleted FROM observations WHERE id = $1",
      [req.params["observationId"]],
    );
    const record = rows.rows[0];
    if (!record || record.account_id !== accountId || record.deleted || !record.raster_sha256) throw errors.notFound();
    try {
      const bytes = await context.storage.get(`observers/${accountId}/rasters/${req.params["observationId"]}/${record.raster_sha256}.png`);
      res.type("image/png").send(Buffer.from(bytes));
    } catch {
      throw errors.storageUnavailable();
    }
  }));

  // ---- sync ----------------------------------------------------------------
  app.post("/api/sync", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const body = req.body as Record<string, unknown>;
    const device = typeof body["device"] === "string" ? body["device"].trim() : "";
    const changes = body["changes"];
    const fields: Record<string, string> = {};
    if (device.length < 1 || device.length > 40) fields["device"] = fieldMessages.device;
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > SYNC_CHANGE_LIMIT) {
      fields["changes"] = "Send from 1 to 200 changes.";
    }
    if (Object.keys(fields).length > 0) throw errors.validation(fields);
    const results = await applySyncBatch(context.pool, context.storage, accountId, device, changes as never);
    res.json({ results });
  }));

  // ---- programs --------------------------------------------------------------
  app.get("/api/programs", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const programs = await programSummariesFor(context.pool, accountId);
    res.json({ programs });
  }));

  app.get("/api/programs/:programId", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const detail = await programDetailFor(context.pool, accountId, req.params["programId"]!);
    if (!detail) throw errors.notFound();
    res.json(detail);
  }));

  app.post("/api/programs/:programId/follow", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const program = await context.pool.query("SELECT id FROM programs WHERE id = $1", [req.params["programId"]]);
    if (program.rows.length === 0) throw errors.notFound();
    await context.pool.query("INSERT INTO program_follows (account_id, program_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [accountId, req.params["programId"]]);
    res.json({ following: true });
  }));

  app.delete("/api/programs/:programId/follow", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const program = await context.pool.query("SELECT id FROM programs WHERE id = $1", [req.params["programId"]]);
    if (program.rows.length === 0) throw errors.notFound();
    await context.pool.query("DELETE FROM program_follows WHERE account_id = $1 AND program_id = $2", [accountId, req.params["programId"]]);
    res.json({ following: false });
  }));

  // ---- packets ------------------------------------------------------------
  app.get("/api/packets", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const rows = await context.pool.query(`${PACKET_SELECT} WHERE account_id = $1 ORDER BY created_at DESC, number DESC`, [accountId]);
    res.json({ packets: rows.rows.map((row) => mapPacket(row as never)) });
  }));

  app.post("/api/packets", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const body = req.body as Record<string, unknown>;
    const programId = typeof body["program_id"] === "string" ? body["program_id"] : null;
    const observationIds = Array.isArray(body["observation_ids"]) ? (body["observation_ids"] as unknown[]).filter((id): id is string => typeof id === "string") : null;
    if (!programId || !observationIds) throw errors.validation({ program_id: "Choose a program." });
    const record = await createPacket(context.pool, accountId, programId, observationIds);
    res.status(201).json(mapPacket(record));
  }));

  app.get("/api/packets/:packetId", wrap(async (req, res) => {
    noStore(res);
    const accountId = await requireAccount(req);
    const record = await loadPacket(context.pool, accountId, req.params["packetId"]!);
    if (!record) throw errors.notFound();
    res.json(mapPacket(record));
  }));

  app.put("/api/packets/:packetId/rows", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const body = req.body as Record<string, unknown>;
    const observationIds = Array.isArray(body["observation_ids"]) ? (body["observation_ids"] as unknown[]).filter((id): id is string => typeof id === "string") : null;
    if (!observationIds) throw errors.validation({ observation_ids: "A packet holds from 1 to 200 observations." });
    const record = await replaceRows(context.pool, accountId, req.params["packetId"]!, body["revision"] as number | undefined, observationIds);
    res.json(mapPacket(record));
  }));

  app.post("/api/packets/:packetId/check", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const outcome = await checkPacket(context.pool, accountId, req.params["packetId"]!, (req.body as Record<string, unknown>)["revision"] as number | undefined);
    if (outcome.reasons) {
      throw errors.incomplete(outcome.reasons);
    }
    res.json(mapPacket(outcome.record!));
  }));

  app.post("/api/packets/:packetId/render", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const record = await startRender(context.pool, accountId, req.params["packetId"]!, (req.body as Record<string, unknown>)["revision"] as number | undefined);
    res.status(202).json(mapPacket(record));
    // The render finishes outside the request; its result applies only while
    // that attempt is the newest (DP-74).
    void finishRender(context.pool, context.storage, context.renderer, accountId, record.id);
  }));

  app.post("/api/packets/:packetId/send", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const account = await accountForSession(context.pool, token);
    if (!account) throw errors.unauthenticated();
    const outcome = await sendPacket(
      context.pool, context.storage, context.mail, { mailFrom: context.config.mailFrom },
      accountId, req.params["packetId"]!, (req.body as Record<string, unknown>)["revision"] as number | undefined,
      { email: account.email, display_name: account.display_name },
    );
    const record = outcome.record;
    if (outcome.outcome === "sent") res.json(mapPacket(record));
    else if (outcome.outcome === "mail_unavailable") res.status(503).json({ error: "mail_unavailable", packet: mapPacket(record) });
    else if (outcome.outcome === "storage_unavailable") res.status(503).json({ error: "storage_unavailable", packet: mapPacket(record) });
    else res.status(502).json({ error: "mail_rejected", packet: mapPacket(record) });
  }));

  app.get("/api/packets/:packetId/pdf", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const record = await loadPacket(context.pool, accountId, req.params["packetId"]!);
    if (!record) throw errors.notFound();
    if (!record.pdf) throw errors.noPdf();
    try {
      const bytes = await context.storage.get(`observers/${accountId}/packets/${record.id}/${record.pdf.sha256}.pdf`);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="lowlamp-packet-${record.number}.pdf"`);
      res.send(Buffer.from(bytes));
    } catch {
      throw errors.storageUnavailable();
    }
  }));

  app.get("/api/packets/:packetId/strokes/:observationId", wrap(async (req, res) => {
    const accountId = await requireAccount(req);
    const record = await loadPacket(context.pool, accountId, req.params["packetId"]!);
    if (!record) throw errors.notFound();
    const row = record.rows.find((entry) => entry.observation_id === req.params["observationId"]);
    if (!row || !row.strokes_sha256) throw errors.notFound();
    try {
      const bytes = await context.storage.get(`observers/${accountId}/strokes/${row.observation_id}/${row.strokes_sha256}.json`);
      res.type("application/json").send(Buffer.from(bytes));
    } catch {
      throw errors.storageUnavailable();
    }
  }));

  // ---- static shell and unknown routes -----------------------------------
  const blockedPaths = ["/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/.env", "/npm-debug.log"];
  app.use((req, res, next) => {
    const path = req.path;
    if (blockedPaths.some((blocked) => path === blocked || path.startsWith(`${blocked}/`)) || path.startsWith("/src") || path.startsWith("/node_modules")) {
      return next(errors.notFound());
    }
    next();
  });

  app.use(express.static(publicDir, { index: "index.html", fallthrough: true, setHeaders: (res) => noStore(res) }));

  app.get(/^\/api\/.*/, (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.get(/^\/.*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(join(publicDir, "index.html"));
  });

  app.use(apiErrorHandler);

  return app;
}
