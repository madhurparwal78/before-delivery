import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import { config, limits } from "./config";
import { initDb, poolDb, withTransaction, type Db } from "./db";
import { initClock, businessNow, setBusinessNow, persistClock } from "./clock";
import { ApiError, sendError, notFound, forbidden, validation, conflict, gone, tooLarge, storageUnavailable } from "./errors";
import {
  requireUser, createSession, sessionCookie, clearSessionCookie, verifyPassword,
  hashPassword, userFromRequest, findUserByHandle, findUserByEmail, type UserRef,
} from "./auth";
import { canSeeBoard, roleOnBoard, visiblePin, boardOrNotFound } from "./access";
import { pinsJson, pinJson, pinCounts } from "./pinjson";
import { boardJson, boardOrder, boardCover, boardFollowerCount, userFollowerCount, userFollowingCount } from "./boardjson";
import { applyBoardChange } from "./boardchange";
import { runBulkOperation, undoOperation, renumberContainer, renumberSections, operationJson } from "./operations";
import { processUpload } from "./image";
import { putObject, getObject, checkStorage, deleteObjects } from "./storage";
import { sendMail } from "./mail";
import {
  initLive, broadcastFeed, broadcastCounts, broadcastFollow, broadcastMembership,
  broadcastPinChanged, broadcastOperationExpired, broadcastClock, boardViewers, announceViewers,
} from "./live";
import { extractTags, sourceHost, nameProblem, trimmedName, isEmail, words } from "./domain";
import { seedDemoContent } from "./demo";
import { runGradingSeed } from "./grading";

const app = express();
const PUBLIC_DIR = join(__dirname, "..", "public");
const JSON_BODY_LIMIT = 65_536;

// ---------- Helpers: untrusted body access without unchecked casts ----------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

// ---------- Server boundary (DP-07) ----------

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host ?? "";
    const allowed = new Set([
      config.publicUrl.replace(/\/+$/, ""),
      `http://${host}`, `https://${host}`,
    ]);
    if (!allowed.has(origin.replace(/\/+$/, ""))) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});

app.use(express.json({ limit: JSON_BODY_LIMIT, type: "application/json" }) as RequestHandler);
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const e = err as { type?: string; status?: number; statusCode?: number; expose?: boolean };
  if (e && (e.type === "entity.too.large" || e.status === 413 || e.statusCode === 413)) {
    sendError(res, tooLarge(JSON_BODY_LIMIT));
    return;
  }
  if (e && e.type === "entity.parse.failed") {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  next(err);
});

// Storage probe at least every 5 seconds (DP-08); health reports unavailable while down.
let storageOk = false;
async function storageLoop(): Promise<void> {
  for (;;) {
    try {
      const state = await checkStorage();
      storageOk = state.ok;
    } catch { storageOk = false; }
    await new Promise(r => setTimeout(r, 5_000));
  }
}

async function storageAvailableNow(): Promise<boolean> {
  const state = await checkStorage();
  storageOk = state.ok;
  return state.ok;
}

// ---------- Public endpoints ----------

app.get("/api/health", (_req, res) => {
  res.status(200).json(storageOk ? { status: "ok" } : { status: "unavailable" });
});

app.get("/api/config", (_req, res) => {
  res.json({
    now: businessNow().toISOString(),
    time_zone: config.timeZone,
    undo_seconds: config.undoSeconds,
    invite_ttl_seconds: config.inviteTtlSeconds,
    limits,
  });
});

// ---------- Accounts (DP-05) ----------

app.post("/api/accounts", async (req, res) => {
  const body = asRecord(req.body);
  const email = str(body.email);
  const password = str(body.password);
  const name = str(body.name);
  const handle = str(body.handle);
  if (!isEmail(email)) throw validation("email");
  if (password.length < 8) throw validation("password");
  if ([...name.trim()].length < 1 || [...name].length > 50) throw validation("name");
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw validation("handle");
  const taken = await poolDb.queryOne<{ id: string }>(`select id from users where lower(handle) = lower($1)`, [handle]);
  if (taken) throw conflict("handle_taken");
  const pendingTaken = await poolDb.queryOne<{ email: string }>(
    `select email from pending_accounts where lower(handle) = lower($1) and lower(email) <> lower($2)`,
    [handle, email]
  );
  if (pendingTaken) throw conflict("handle_taken");

  const existing = await findUserByEmail(email);
  const now = businessNow();
  if (existing) {
    // The same reply whether or not the email has an account (DP-05, DP-53).
    void sendMail(email, "You already have a Mothlight account",
      `You already have a Mothlight account.\nSign in here: ${config.publicUrl}/signin`);
  } else {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await poolDb.query(`delete from signup_codes where email = $1`, [email.toLowerCase()]);
    await poolDb.query(`delete from pending_accounts where email = $1`, [email.toLowerCase()]);
    await poolDb.query(
      `insert into pending_accounts (email, password_hash, name, handle, created_at) values ($1, $2, $3, $4, $5)`,
      [email.toLowerCase(), hashPassword(password), name, handle, now]
    );
    await poolDb.query(`insert into signup_codes (email, code, created_at) values ($1, $2, $3)`, [email.toLowerCase(), code, now]);
    void sendMail(email, `Your Mothlight code is ${code}`, `Your Mothlight code is ${code}`);
  }
  res.status(202).json({ status: "code_sent" });
});

app.post("/api/accounts/confirm", async (req, res) => {
  const body = asRecord(req.body);
  const email = str(body.email).toLowerCase();
  const code = str(body.code);
  const row = await poolDb.queryOne<{ code: string }>(
    `select code from signup_codes where email = $1 order by created_at desc limit 1`, [email]
  );
  if (!row || row.code !== code) throw validation("code");
  const pending = await poolDb.queryOne<{ name: string; handle: string; password_hash: string }>(
    `select name, handle, password_hash from pending_accounts where email = $1`, [email]
  );
  const now = businessNow();
  let userId: number;
  if (pending) {
    const inserted = await poolDb.queryOne<{ id: string; name: string; handle: string }>(
      `insert into users (email, password_hash, name, handle, created_at) values ($1, $2, $3, $4, $5) returning id, name, handle`,
      [email, pending.password_hash, pending.name, pending.handle, now]
    );
    userId = Number(inserted!.id);
    await poolDb.query(`delete from pending_accounts where email = $1`, [email]);
  } else {
    const user = await findUserByEmail(email);
    if (!user) throw validation("code");
    userId = Number(user.id);
  }
  await poolDb.query(`delete from signup_codes where email = $1`, [email]);
  const token = await createSession(userId);
  res.setHeader("Set-Cookie", sessionCookie(token));
  const created = await poolDb.queryOne<{ name: string; handle: string }>(`select name, handle from users where id = $1`, [userId]);
  res.json({ user: { id: userId, name: created!.name, handle: created!.handle } });
});

app.post("/api/session", async (req, res) => {
  const body = asRecord(req.body);
  const email = str(body.email);
  const password = str(body.password);
  const user = await poolDb.queryOne<{ id: string; name: string; handle: string; email: string; password_hash: string }>(
    `select id, name, handle, email, password_hash from users where lower(email) = lower($1)`, [email]
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const token = await createSession(Number(user.id));
  res.setHeader("Set-Cookie", sessionCookie(token));
  res.json({ user: { id: Number(user.id), name: user.name, handle: user.handle, email: user.email } });
});

app.delete("/api/session", (req, res) => {
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === "ml_session") void poolDb.query(`delete from sessions where token = $1`, [rest.join("=")]);
    }
  }
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(204).end();
});

app.get("/api/me", async (req, res) => {
  const user = await requireUser(req);
  res.json({ user: { id: Number(user.id), name: user.name, handle: user.handle, email: user.email } });
});

// ---------- Grading routes (DP-04) ----------

function gradingGuard(req: Request): void {
  if (!config.gradingKey || req.headers["x-grading-key"] !== config.gradingKey) throw notFound();
}

app.post("/api/grading/seed", async (req, res) => {
  gradingGuard(req);
  const ids = await runGradingSeed(asRecord(req.body));
  res.status(201).json({ ids });
});

app.post("/api/grading/clock", async (req, res) => {
  gradingGuard(req);
  const body = asRecord(req.body);
  const now = await setBusinessNow(str(body.now));
  broadcastClock(now.toISOString());
  await expireOperations();
  res.json({ now: now.toISOString() });
});

// ---------- Home feed (DP-14, DP-89) ----------

interface FeedPin { id: number; rootId: number; createdAt: Date; ownerId: number; ownerName: string; }

async function feedPins(db: Db, viewer: UserRef, max: number): Promise<FeedPin[]> {
  const rows = await db.query<{ id: string; root_id: string | null; created_at: Date; owner_id: string; owner_name: string }>(
    `select p.id, p.root_id, p.created_at, p.owner_id, u.name as owner_name
     from pins p
     join boards b on b.id = p.board_id
     join users u on u.id = p.owner_id
     where p.status = 'live'
       and (
         (b.visibility = 'public' and b.owner_id in (select target_id from follows_users where follower_id = $1))
         or (b.visibility = 'public' and p.board_id in (select board_id from follows_boards where follower_id = $1))
         or (p.board_id in (select board_id from board_members where user_id = $1))
         or (p.board_id in (select id from boards where owner_id = $1))
       )
     order by p.created_at desc, p.id asc
     limit $2`,
    [viewer.id, max * 4]
  );
  return rows.map(r => ({
    id: Number(r.id),
    rootId: r.root_id === null ? Number(r.id) : Number(r.root_id),
    createdAt: new Date(r.created_at),
    ownerId: Number(r.owner_id),
    ownerName: r.owner_name,
  }));
}

function groupFeedPins(pins: FeedPin[]): Array<{ pinId: number; size: number; owners: string[] }> {
  const ordered = [...pins].sort((a, b) => (b.createdAt.getTime() - a.createdAt.getTime()) || (a.id - b.id));
  const groups = new Map<number, FeedPin[]>();
  for (const p of ordered) {
    const list = groups.get(p.rootId) ?? [];
    list.push(p);
    groups.set(p.rootId, list);
  }
  const out: Array<{ pinId: number; size: number; owners: string[] }> = [];
  const seen = new Set<number>();
  for (const p of ordered) {
    if (seen.has(p.rootId)) continue;
    seen.add(p.rootId);
    const members = groups.get(p.rootId)!;
    const owners: string[] = [];
    for (const m of members) if (!owners.includes(m.ownerName)) owners.push(m.ownerName);
    out.push({ pinId: p.id, size: members.length, owners });
  }
  return out;
}

app.get("/api/feed", async (req, res) => {
  const user = await requireUser(req);
  const pins = await feedPins(poolDb, user, 60);
  const groups = groupFeedPins(pins);
  const json = await pinsJson(poolDb, user, groups.map(g => g.pinId));
  const withGroup = json.map(pin => {
    const g = groups.find(x => x.pinId === pin.id)!;
    return { ...pin, group: { size: g.size, owners: g.owners } };
  });
  res.json({ pins: withGroup });
});

// ---------- Pin creation (DP-23 to DP-30) ----------

function validatePinText(title: string, description: string, alt: string, source: string): void {
  if ([...title].length < 1 || [...title].length > config.titleMax) throw validation("title");
  if ([...description].length > config.descriptionMax) throw validation("description");
  if ([...alt.trim()].length < 1 || [...alt].length > 500) throw validation("alt");
  if (source !== "" && !isValidSource(source)) throw validation("source");
}

function isValidSource(source: string): boolean {
  try {
    const url = new URL(source);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function sniffImageType(buf: Buffer): "png" | "jpeg" | null {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  return null;
}

app.post("/api/pins", async (req, res) => {
  const user = await requireUser(req);
  const form = await readMultipart(req);
  const title = form.title;
  const description = form.description ?? "";
  const alt = form.alt ?? "";
  const source = form.source ?? "";
  const boardId = num(form.board);
  const sectionId = form.section === "" || form.section === undefined ? null : num(form.section);
  if (boardId === null) throw validation("board");

  // Error order: record (404), role (403), type (415), bytes (413), duplicate (409), validation (422), storage (503).
  const board = await poolDb.queryOne<{ id: string }>(`select id from boards where id = $1`, [boardId]);
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  const role = await roleOnBoard(poolDb, user, boardId);
  if (role !== "owner" && role !== "editor") throw forbidden();
  if (sectionId !== null) {
    const section = await poolDb.queryOne<{ id: string }>(`select id from sections where id = $1 and board_id = $2`, [sectionId, boardId]);
    if (!section) throw notFound();
  }

  const image = form.image;
  if (!sniffImageType(image)) throw new ApiError(415, "unsupported_type");
  if (image.length > config.imageMaxBytes) throw tooLarge(config.imageMaxBytes);

  // Validation before storage work, so refusals never need a draft to exist.
  validatePinText(title, description, alt, source);

  if (!storageOk) throw storageUnavailable();
  const processed = await processUpload(image).catch((e: unknown) => {
    if (e instanceof ApiError) throw e;
    throw storageUnavailable();
  });

  // Duplicate check against the uploader's own pins (DP-27).
  const dup = await poolDb.queryOne<{ pin_id: string; board_id: string; board_name: string }>(
    `select p.id as pin_id, b.id as board_id, b.name as board_name
     from pins p join images i on i.id = p.image_id join boards b on b.id = p.board_id
     where p.owner_id = $1 and i.sha256 = $2 and p.status in ('live','deleted')
     order by p.created_at asc, p.id asc limit 1`,
    [user.id, processed.sha256]
  );
  if (dup) {
    throw conflict("duplicate_image", {
      pin_id: Number(dup.pin_id),
      board: { id: Number(dup.board_id), name: dup.board_name },
    });
  }

  const pinId = await createPinWithImage(user, { title, description, alt, source, boardId, sectionId }, processed);
  await broadcastFeedForPins([pinId]);
  res.status(201).json(await pinJson(poolDb, user, pinId));
});

function storageExt(format: "png" | "jpeg"): string { return format === "jpeg" ? "jpg" : "png"; }

async function createPinWithImage(
  user: UserRef,
  args: { title: string; description: string; alt: string; source: string; boardId: number; sectionId: number | null },
  processed: Awaited<ReturnType<typeof processUpload>>
): Promise<number> {
  // A draft becomes live only after storage confirms every file (DP-28).
  const now = businessNow();
  const draft = await withTransaction(async tx => {
    const image = await tx.queryOne<{ id: string }>(
      `insert into images (width, height, sha256, format, created_at) values ($1, $2, $3, $4, $5) returning id`,
      [processed.width, processed.height, processed.sha256, processed.format, now]
    );
    const imageId = Number(image!.id);
    const pin = await tx.queryOne<{ id: string }>(
      `insert into pins (owner_id, board_id, section_id, image_id, root_id, title, description, alt, source, source_host, tags, position, status, created_at, updated_at)
       values ($1, $2, $3, $4, null, $5, $6, $7, $8, $9, $10, 1, 'draft', $11, $11) returning id`,
      [user.id, args.boardId, args.sectionId, imageId, args.title, args.description, args.alt,
       args.source || null, args.source ? sourceHost(args.source) : null,
       extractTags(args.title, args.description), now]
    );
    return { pinId: Number(pin!.id), imageId };
  });

  const keys: string[] = [];
  try {
    const ext = storageExt(processed.format);
    const ctype = processed.format === "jpeg" ? "image/jpeg" : "image/png";
    const originalKey = `images/${draft.imageId}/original.${ext}`;
    await putObject(originalKey, processed.original, ctype);
    keys.push(originalKey);
    for (const v of processed.variants) {
      const key = `images/${draft.imageId}/w${v.width}.${ext}`;
      await putObject(key, v.bytes, ctype);
      keys.push(key);
    }
  } catch {
    // If any write fails the draft is discarded and no object remains (DP-28).
    try { await deleteObjects(keys); } catch { /* the outage left nothing to remove */ }
    await poolDb.query(`delete from pins where id = $1 and status = 'draft'`, [draft.pinId]);
    await poolDb.query(`delete from images where id = $1`, [draft.imageId]);
    throw storageUnavailable();
  }

  await withTransaction(async tx => {
    await tx.query(
      `update pins set position = position + 1 where board_id = $1 and section_id is not distinct from $2 and status = 'live' and id <> $3`,
      [args.boardId, args.sectionId, draft.pinId]
    );
    await tx.query(`update pins set position = 1, status = 'live' where id = $1`, [draft.pinId]);
  });
  await applyBoardChange(poolDb, {
    boardId: args.boardId, actor: user, change: "added",
    pin: { id: draft.pinId, title: args.title }, lastSaved: true,
  });
  return draft.pinId;
}

async function readMultipart(req: Request): Promise<{ image: Buffer; title: string; description?: string; alt?: string; source?: string; board?: unknown; section?: string }> {
  const contentType = req.headers["content-type"] ?? "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new ApiError(400, "invalid_body");
  const boundary = "--" + (m[1] ?? m[2]).trim();
  const chunks: Buffer[] = [];
  let total = 0;
  const maxTotal = config.imageMaxBytes + 65_536;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxTotal) {
        // Cut the request off with 413 (server boundary), but let the response go out.
        settled = true;
        reject(tooLarge(config.imageMaxBytes));
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!settled) { settled = true; resolve(); } });
    req.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
  });
  const body = Buffer.concat(chunks);
  const parts = splitParts(body, boundary);
  const fields: Record<string, string> = {};
  let image = Buffer.alloc(0);
  for (const part of parts) {
    const { name, filename, data } = parsePart(part);
    if (!name) continue;
    if (filename !== null) { if (name === "image") image = data; }
    else fields[name] = data.toString("utf8");
  }
  if (!image || image.length === 0) throw validation("image");
  return {
    image,
    title: fields.title ?? "",
    description: fields.description,
    alt: fields.alt,
    source: fields.source,
    board: fields.board,
    section: fields.section,
  };
}

function splitParts(body: Buffer, boundary: string): Buffer[] {
  const parts: Buffer[] = [];
  const marker = Buffer.from(boundary);
  let start = body.indexOf(marker);
  while (start !== -1) {
    const next = body.indexOf(marker, start + marker.length);
    if (next === -1) break;
    const part = body.subarray(start + marker.length, next);
    if (part.length > 4) parts.push(part);
    start = next;
  }
  return parts;
}

function parsePart(part: Buffer): { name: string | null; filename: string | null; data: Buffer } {
  const headerEnd = part.indexOf("\r\n\r\n");
  if (headerEnd === -1) return { name: null, filename: null, data: Buffer.alloc(0) };
  const headers = part.subarray(0, headerEnd).toString("utf8");
  const data = part.subarray(headerEnd + 4, part.length - 2);
  const nameMatch = /name="([^"]*)"/.exec(headers);
  const fileMatch = /filename="([^"]*)"/.exec(headers);
  return { name: nameMatch ? nameMatch[1] : null, filename: fileMatch ? fileMatch[1] : null, data };
}

async function broadcastFeedForPins(pinIds: number[]): Promise<void> {
  await broadcastFeed(pinIds);
}

async function broadcastCountsFor(pinId: number): Promise<void> {
  const counts = await pinCounts(poolDb, null, [pinId]);
  const c = counts.get(pinId);
  if (c) await broadcastCounts(pinId, { saves: c.saves, comments: c.comments, reactions: c.reactions });
}

// ---------- Pin read, edit, delete (DP-36, DP-68) ----------

app.get("/api/pins/:id", async (req, res) => {
  const user = await userFromRequest(req);
  const pin = await visiblePin(poolDb, user, Number(req.params.id));
  res.json(await pinJson(poolDb, user, Number(pin.id)));
});

app.patch("/api/pins/:id", async (req, res) => {
  const user = await requireUser(req);
  const pinId = Number(req.params.id);
  const pin = await poolDb.queryOne<{ id: string; owner_id: string; board_id: string; version: number; title: string; description: string; alt: string; source: string | null }>(
    `select id, owner_id, board_id, version, title, description, alt, source from pins where id = $1 and status = 'live'`,
    [pinId]
  );
  if (!pin || !(await canSeeBoard(poolDb, user, Number(pin.board_id)))) throw notFound();
  if (pin.owner_id !== String(user.id)) throw forbidden();

  const body = asRecord(req.body);
  const version = num(body.version);
  if (version === null || !Number.isInteger(version)) throw validation("version");
  if (version !== pin.version) {
    const current = await pinJson(poolDb, user, pinId);
    throw conflict("version_conflict", { current });
  }

  const title = body.title !== undefined ? str(body.title) : pin.title;
  const description = body.description !== undefined ? str(body.description) : pin.description;
  const alt = body.alt !== undefined ? str(body.alt) : pin.alt;
  const source = body.source !== undefined ? (body.source === null ? "" : str(body.source)) : (pin.source ?? "");
  validatePinText(title, description, alt, source);

  const now = businessNow();
  await poolDb.query(
    `update pins set title = $2, description = $3, alt = $4, source = $5, source_host = $6, tags = $7, version = version + 1, updated_at = $8 where id = $1`,
    [pinId, title, description, alt, source || null, source ? sourceHost(source) : null,
     extractTags(title, description), now]
  );
  await applyBoardChange(poolDb, { boardId: Number(pin.board_id), actor: user, change: "updated", pin: { id: pinId, title }, lastSaved: false });
  await broadcastPinChanged(pinId, pin.version + 1);
  res.json(await pinJson(poolDb, user, pinId));
});

app.delete("/api/pins/:id", async (req, res) => {
  const user = await requireUser(req);
  const pinId = Number(req.params.id);
  const pin = await poolDb.queryOne<{ id: string; owner_id: string; board_id: string; title: string }>(
    `select id, owner_id, board_id, title from pins where id = $1 and status = 'live'`, [pinId]
  );
  if (!pin || !(await canSeeBoard(poolDb, user, Number(pin.board_id)))) throw notFound();
  if (pin.owner_id !== String(user.id)) throw forbidden();
  const op = await runBulkOperation(poolDb, user, { kind: "delete", pinIds: [pinId], targetBoard: null, targetSection: null });
  await broadcastCountsFor(pinId);
  res.json(operationJson(op, null));
});

// ---------- Saves (DP-32 to DP-35) ----------

app.post("/api/pins/:id/saves", async (req, res) => {
  const user = await requireUser(req);
  const body = asRecord(req.body);
  const pinId = Number(req.params.id);
  const source = await poolDb.queryOne<{ id: string; board_id: string; root_id: string | null; title: string; description: string; alt: string; source: string | null; source_host: string | null; tags: string[]; image_id: string }>(
    `select id, board_id, root_id, title, description, alt, source, source_host, tags, image_id from pins where id = $1 and status = 'live'`,
    [pinId]
  );
  if (!source || !(await canSeeBoard(poolDb, user, Number(source.board_id)))) throw notFound();

  const boardId = num(body.board);
  if (boardId === null) throw validation("board");
  const sectionId = body.section === null || body.section === undefined ? null : num(body.section);
  const targetBoard = await poolDb.queryOne<{ id: string; name: string }>(`select id, name from boards where id = $1`, [boardId]);
  if (!targetBoard || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  const role = await roleOnBoard(poolDb, user, boardId);
  if (role === null || role === "viewer") throw forbidden();
  if (sectionId !== null) {
    const section = await poolDb.queryOne<{ id: string }>(`select id from sections where id = $1 and board_id = $2`, [sectionId, boardId]);
    if (!section) throw notFound();
  }

  const rootId = source.root_id === null ? Number(source.id) : Number(source.root_id);
  const already = await poolDb.queryOne<{ id: string }>(
    `select id from pins where board_id = $1 and status = 'live' and (id = $2 or root_id = $2)`,
    [boardId, rootId]
  );
  if (already) {
    throw conflict("already_on_board", { board: { id: boardId, name: targetBoard.name } });
  }

  const now = businessNow();
  const saved = await withTransaction(async tx => {
    await tx.query(
      `update pins set position = position + 1 where board_id = $1 and section_id is not distinct from $2 and status = 'live'`,
      [boardId, sectionId]
    );
    const inserted = await tx.queryOne<{ id: string }>(
      `insert into pins (owner_id, board_id, section_id, image_id, root_id, title, description, alt, source, source_host, tags, position, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, 'live', $12, $12) returning id`,
      [user.id, boardId, sectionId, Number(source.image_id), rootId, source.title, source.description, source.alt,
       source.source, source.source_host, source.tags ?? [], now]
    );
    return Number(inserted!.id);
  });
  await applyBoardChange(poolDb, { boardId, actor: user, change: "added", pin: { id: saved, title: source.title }, lastSaved: true });
  await broadcastFeedForPins([saved]);
  await broadcastCountsFor(pinId);
  res.status(201).json(await pinJson(poolDb, user, saved));
});

// ---------- Comments and replies (DP-69) ----------

app.get("/api/pins/:id/comments", async (req, res) => {
  const user = await userFromRequest(req);
  const pin = await visiblePin(poolDb, user, Number(req.params.id));
  const comments = await poolDb.query<{
    id: string; author_id: string; author_name: string; author_handle: string;
    text: string | null; deleted: boolean; created_at: Date; parent_id: string | null;
  }>(
    `select c.id, c.author_id, u.name as author_name, u.handle as author_handle, c.text, c.deleted, c.created_at, c.parent_id
     from comments c join users u on u.id = c.author_id
     where c.pin_id = $1 order by c.created_at, c.id`,
    [Number(pin.id)]
  );
  const live = comments.filter(c => !c.deleted);
  const top = live.filter(c => c.parent_id === null);
  const json = top.map(c => ({
    id: Number(c.id),
    author: { id: Number(c.author_id), name: c.author_name, handle: c.author_handle },
    text: c.deleted ? null : c.text,
    deleted: c.deleted,
    created_at: c.created_at.toISOString(),
    replies: live.filter(r => r.parent_id === c.id).map(r => ({
      id: Number(r.id),
      author: { id: Number(r.author_id), name: r.author_name, handle: r.author_handle },
      text: r.text,
      deleted: false,
      created_at: r.created_at.toISOString(),
    })),
  }));
  res.json({ count: live.length, comments: json });
});

app.post("/api/pins/:id/comments", async (req, res) => {
  const user = await requireUser(req);
  const body = asRecord(req.body);
  const pin = await visiblePin(poolDb, user, Number(req.params.id));
  const text = str(body.text);
  if ([...text].length < 1 || [...text].length > config.commentMax) throw validation("text");
  let parentId: number | null = null;
  if (body.parent !== null && body.parent !== undefined) {
    const parent = await poolDb.queryOne<{ id: string; parent_id: string | null; deleted: boolean }>(
      `select id, parent_id, deleted from comments where id = $1 and pin_id = $2`, [num(body.parent), Number(pin.id)]
    );
    if (!parent || parent.deleted) throw notFound();
    // Replying to a reply attaches to the top-level comment (one level of replies).
    parentId = parent.parent_id === null ? Number(parent.id) : Number(parent.parent_id);
  }
  const inserted = await poolDb.queryOne<{ id: string; created_at: Date }>(
    `insert into comments (pin_id, author_id, parent_id, text, created_at) values ($1, $2, $3, $4, $5) returning id, created_at`,
    [Number(pin.id), user.id, parentId, text, businessNow()]
  );
  await broadcastCountsFor(Number(pin.id));
  res.status(201).json({
    id: Number(inserted!.id),
    author: { id: Number(user.id), name: user.name, handle: user.handle },
    text,
    deleted: false,
    created_at: inserted!.created_at.toISOString(),
    replies: [],
  });
});

app.delete("/api/comments/:id", async (req, res) => {
  const user = await requireUser(req);
  const comment = await poolDb.queryOne<{ id: string; pin_id: string; author_id: string }>(
    `select id, pin_id, author_id from comments where id = $1`, [Number(req.params.id)]
  );
  if (!comment) throw notFound();
  const pin = await poolDb.queryOne<{ id: string; owner_id: string }>(`select id, owner_id from pins where id = $1`, [Number(comment.pin_id)]);
  if (!pin || !(await canSeeBoard(poolDb, user, Number(pin.id)))) throw notFound();
  if (comment.author_id !== String(user.id) && pin.owner_id !== String(user.id)) throw forbidden();
  const hasLiveReplies = await poolDb.queryOne<{ id: string }>(
    `select id from comments where parent_id = $1 and deleted = false limit 1`, [Number(comment.id)]
  );
  if (hasLiveReplies) {
    // A deleted comment with replies leaves the placeholder (DP-69).
    await poolDb.query(`update comments set deleted = true, text = null where id = $1`, [Number(comment.id)]);
  } else {
    await poolDb.query(`delete from comments where id = $1`, [Number(comment.id)]);
  }
  await broadcastCountsFor(Number(comment.pin_id));
  res.status(204).end();
});

// ---------- Reactions (DP-70) ----------

app.put("/api/pins/:id/reaction", async (req, res) => {
  const user = await requireUser(req);
  const body = asRecord(req.body);
  const pin = await visiblePin(poolDb, user, Number(req.params.id));
  const type = str(body.type);
  if (type !== "love" && type !== "idea" && type !== "wow" && type !== "thanks") throw validation("type");
  const existing = await poolDb.queryOne<{ type: string }>(
    `select type from reactions where pin_id = $1 and user_id = $2`, [Number(pin.id), user.id]
  );
  let mine: string | null = type;
  if (existing && existing.type === type) {
    await poolDb.query(`delete from reactions where pin_id = $1 and user_id = $2`, [Number(pin.id), user.id]);
    mine = null;
  } else if (existing) {
    await poolDb.query(`update reactions set type = $3, created_at = $4 where pin_id = $1 and user_id = $2`, [Number(pin.id), user.id, type, businessNow()]);
  } else {
    await poolDb.query(`insert into reactions (pin_id, user_id, type, created_at) values ($1, $2, $3, $4)`, [Number(pin.id), user.id, type, businessNow()]);
  }
  const counts = await pinCounts(poolDb, null, [Number(pin.id)]);
  const c = counts.get(Number(pin.id))!;
  await broadcastCounts(Number(pin.id), { saves: c.saves, comments: c.comments, reactions: c.reactions });
  res.json({ mine, reactions: c.reactions });
});

// ---------- Boards ----------

app.post("/api/boards", async (req, res) => {
  const user = await requireUser(req);
  const body = asRecord(req.body);
  const name = trimmedName(str(body.name));
  const visibility = str(body.visibility);
  if (nameProblem(name, "name")) throw validation("name");
  if (visibility !== "public" && visibility !== "secret") throw validation("visibility");
  const taken = await poolDb.queryOne<{ id: string }>(
    `select id from boards where owner_id = $1 and lower(name) = lower($2)`, [user.id, name]
  );
  if (taken) throw conflict("board_name_taken");
  const now = businessNow();
  const board = await poolDb.queryOne<{ id: string }>(
    `insert into boards (owner_id, name, name_key, visibility, seq, created_at) values ($1, $2, $3, $4, 0, $5) returning id`,
    [user.id, name, name.toLowerCase(), visibility, now]
  );
  res.status(201).json(await boardJson(poolDb, user, Number(board!.id)));
});

app.get("/api/boards/mine", async (req, res) => {
  const user = await requireUser(req);
  const q = typeof req.query.q === "string" ? req.query.q : "";
  // Boards the viewer owns or edits, in the Last saved to order.
  const boards = await poolDb.query<{ id: string; name: string; visibility: "public" | "secret"; pin_count: string }>(
    `select b.id, b.name, b.visibility,
            (select count(*)::text from pins p where p.board_id = b.id and p.status = 'live') as pin_count,
            b.last_saved_at, b.id as bid
     from boards b
     left join board_members m on m.board_id = b.id and m.user_id = $1 and m.role = 'editor'
     where b.owner_id = $1 or m.user_id = $1
     order by b.last_saved_at desc nulls last, b.id asc`,
    [user.id]
  );
  const needle = q.trim().toLowerCase();
  const filtered = needle === ""
    ? boards
    : boards.filter(b => b.name.toLowerCase().split(/\s+/).some(w => w.startsWith(needle)));
  res.json({
    boards: filtered.map(b => ({ id: Number(b.id), name: b.name, visibility: b.visibility, pin_count: Number(b.pin_count) })),
  });
});

app.get("/api/boards/:id", async (req, res) => {
  const user = await userFromRequest(req);
  const json = await boardJson(poolDb, user, Number(req.params.id));
  if (!json) throw notFound();
  res.json(json);
});

app.patch("/api/boards/:id", async (req, res) => {
  const user = await requireUser(req);
  const boardId = Number(req.params.id);
  const board = await poolDb.queryOne<{ id: string; owner_id: string }>(`select id, owner_id from boards where id = $1`, [boardId]);
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  if (board.owner_id !== String(user.id)) throw forbidden();
  const body = asRecord(req.body);
  if (body.name !== undefined) {
    const name = trimmedName(str(body.name));
    if (nameProblem(name, "name")) throw validation("name");
    const taken = await poolDb.queryOne<{ id: string }>(
      `select id from boards where owner_id = $1 and lower(name) = lower($2) and id <> $3`, [user.id, name, boardId]
    );
    if (taken) throw conflict("board_name_taken");
    await poolDb.query(`update boards set name = $2, name_key = $3 where id = $1`, [boardId, name, name.toLowerCase()]);
  }
  if (body.visibility !== undefined) {
    const visibility = str(body.visibility);
    if (visibility !== "public" && visibility !== "secret") throw validation("visibility");
    await poolDb.query(`update boards set visibility = $2 where id = $1`, [boardId, visibility]);
  }
  if (body.cover !== undefined) {
    if (body.cover !== null) {
      const pinId = num(body.cover);
      if (pinId === null) throw validation("cover");
      const pin = await poolDb.queryOne<{ id: string; board_id: string }>(
        `select id, board_id from pins where id = $1 and status = 'live'`, [pinId]
      );
      if (!pin || !(await canSeeBoard(poolDb, user, Number(pin.board_id)))) throw notFound();
      if (Number(pin.board_id) !== boardId) throw validation("cover");
    }
    await poolDb.query(`update boards set cover_pin_id = $2 where id = $1`, [boardId, body.cover === null ? null : num(body.cover)]);
  }
  await applyBoardChange(poolDb, { boardId, actor: user, change: "updated", pin: null, section: null, lastSaved: false });
  res.json(await boardJson(poolDb, user, boardId));
});

app.delete("/api/boards/:id", async (req, res) => {
  const user = await requireUser(req);
  const boardId = Number(req.params.id);
  const board = await poolDb.queryOne<{ id: string; owner_id: string }>(`select id, owner_id from boards where id = $1`, [boardId]);
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  if (board.owner_id !== String(user.id)) throw forbidden();
  const imageIds = await poolDb.query<{ image_id: string }>(
    `select distinct p.image_id from pins p join images i on i.id = p.image_id
     where p.board_id = $1 and p.image_id not in (
       select image_id from pins where board_id <> $1
     )`,
    [boardId]
  );
  await withTransaction(async tx => {
    await tx.query(`delete from boards where id = $1`, [boardId]);
  });
  // Storage objects are removed within 60 seconds unless a live pin shares the image.
  for (const row of imageIds) {
    const imageId = Number(row.image_id);
    const shared = await poolDb.queryOne<{ id: string }>(
      `select p.id from pins p join images i on i.id = p.image_id where i.id = $1 and p.status = 'live' limit 1`, [imageId]
    );
    if (!shared) {
      try {
        await deleteObjects([`images/${imageId}/original.png`, `images/${imageId}/original.jpg`,
          `images/${imageId}/w236.png`, `images/${imageId}/w236.jpg`,
          `images/${imageId}/w474.png`, `images/${imageId}/w474.jpg`,
          `images/${imageId}/w736.png`, `images/${imageId}/w736.jpg`]);
      } catch { /* a storage outage does not block the delete */ }
    }
  }
  res.status(204).end();
});

app.get("/api/boards/:id/viewers", async (req, res) => {
  const user = await requireUser(req);
  const boardId = Number(req.params.id);
  if (!(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  res.json({ viewers: await boardViewers(boardId) });
});

app.get("/api/boards/:id/members", async (req, res) => {
  const user = await requireUser(req);
  const boardId = Number(req.params.id);
  const board = await boardOrNotFound(poolDb, user, boardId);
  const owner = await poolDb.queryOne<{ id: string; name: string; handle: string }>(
    `select id, name, handle from users where id = $1`, [Number(board.owner_id)]
  );
  const members = await poolDb.query<{ id: string; name: string; handle: string; role: string }>(
    `select u.id, u.name, u.handle, m.role from board_members m join users u on u.id = m.user_id where m.board_id = $1 order by m.created_at, u.id`,
    [boardId]
  );
  const role = await roleOnBoard(poolDb, user, boardId);
  const invites = role === "owner"
    ? await poolDb.query<{ id: string; email: string; role: string; expires_at: Date }>(
        `select id, email, role, expires_at from invites where board_id = $1 and status = 'pending' order by id`, [boardId]
      )
    : [];
  res.json({
    owner: { id: Number(owner!.id), name: owner!.name, handle: owner!.handle },
    members: members.map(m => ({ user: { id: Number(m.id), name: m.name, handle: m.handle }, role: m.role })),
    invites: invites.map(i => ({ id: Number(i.id), email: i.email, role: i.role, expires_at: i.expires_at.toISOString() })),
  });
});

// ---------- Roles (DP-52, DP-58) ----------

app.patch("/api/boards/:id/members/:userId", async (req, res) => {
  const user = await requireUser(req);
  const boardId = Number(req.params.id);
  const targetId = num(req.params.userId);
  if (targetId === null) throw notFound();
  const board = await poolDb.queryOne<{ id: string; owner_id: string }>(`select id, owner_id from boards where id = $1`, [boardId]);
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  if (board.owner_id !== String(user.id)) throw forbidden();
  if (targetId === Number(board.owner_id)) throw notFound(); // the owner is not a member row
  const body = asRecord(req.body);
  const role = str(body.role);
  if (role !== "editor" && role !== "viewer") throw validation("role");
  const member = await poolDb.queryOne<{ user_id: string }>(
    `select user_id from board_members where board_id = $1 and user_id = $2`, [boardId, targetId]
  );
  if (!member) throw notFound();
  await poolDb.query(`update board_members set role = $3 where board_id = $1 and user_id = $2`, [boardId, targetId, role]);
  await broadcastMembership(boardId, targetId, role as "editor" | "viewer");
  await announceViewers(boardId);
  const target = await poolDb.queryOne<{ name: string; handle: string }>(`select name, handle from users where id = $1`, [targetId]);
  res.json({ user: { id: targetId, name: target!.name, handle: target!.handle }, role });
});

app.delete("/api/boards/:id/members/:userId", async (req, res) => {
  const user = await requireUser(req);
  const boardId = Number(req.params.id);
  const targetId = num(req.params.userId);
  if (targetId === null) throw notFound();
  const board = await poolDb.queryOne<{ id: string; owner_id: string }>(`select id, owner_id from boards where id = $1`, [boardId]);
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  const isOwner = board.owner_id === String(user.id);
  const isSelf = targetId === Number(user.id);
  if (!isOwner && !isSelf) throw forbidden();
  if (isOwner && targetId === Number(board.owner_id)) throw notFound();
  const member = await poolDb.queryOne<{ user_id: string }>(
    `select user_id from board_members where board_id = $1 and user_id = $2`, [boardId, targetId]
  );
  if (!member) throw notFound();
  await poolDb.query(`delete from board_members where board_id = $1 and user_id = $2`, [boardId, targetId]);
  await broadcastMembership(boardId, targetId, null);
  await announceViewers(boardId);
  res.status(204).end();
});

// ---------- Invites (DP-53 to DP-56) ----------

app.post("/api/boards/:id/invites", async (req, res) => {
  const user = await requireUser(req);
  const boardId = Number(req.params.id);
  const board = await poolDb.queryOne<{ id: string; owner_id: string; name: string }>(`select id, owner_id, name from boards where id = $1`, [boardId]);
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  if (board.owner_id !== String(user.id)) throw forbidden();
  const body = asRecord(req.body);
  const email = str(body.email);
  const role = str(body.role);
  if (!isEmail(email)) throw validation("email");
  if (role !== "editor" && role !== "viewer") throw validation("role");
  const alreadyMember = await poolDb.queryOne<{ user_id: string }>(
    `select m.user_id from board_members m join users u on u.id = m.user_id
     where m.board_id = $1 and lower(u.email) = lower($2)`, [boardId, email]
  );
  if (alreadyMember) throw conflict("already_member");
  const invitedUser = await findUserByEmail(email);
  if (invitedUser && Number(invitedUser.id) === Number(user.id)) throw conflict("already_member");

  const now = businessNow();
  const token = randomBytes(32).toString("base64url");
  await poolDb.query(
    `update invites set status = 'revoked' where board_id = $1 and lower(email) = lower($2) and status = 'pending'`,
    [boardId, email]
  );
  await poolDb.query(
    `insert into invites (board_id, email, role, token, status, sent_at, expires_at) values ($1, $2, $3, $4, 'pending', $5, $6)`,
    [boardId, email.toLowerCase(), role, token, now, new Date(now.getTime() + config.inviteTtlSeconds * 1000)]
  );
  void sendMail(email, `${user.name} invited you to ${board.name}`,
    `${user.name} invited you to ${board.name}.\nRole: ${role === "editor" ? "Editor" : "Viewer"}\n${config.publicUrl}/invites/${token}`);
  res.status(202).json({ status: "sent", email });
});

app.delete("/api/invites/:id", async (req, res) => {
  const user = await requireUser(req);
  const inviteId = num(req.params.id);
  if (inviteId === null) throw notFound();
  const invite = await poolDb.queryOne<{ id: string; board_id: string; owner_id: string; status: string }>(
    `select i.id, i.board_id, b.owner_id, i.status from invites i join boards b on b.id = i.board_id where i.id = $1`,
    [inviteId]
  );
  if (!invite || !(await canSeeBoard(poolDb, user, Number(invite.board_id)))) throw notFound();
  if (invite.owner_id !== String(user.id)) throw forbidden();
  if (invite.status !== "pending") throw conflict("invite_not_pending");
  await poolDb.query(`update invites set status = 'revoked' where id = $1`, [inviteId]);
  res.status(204).end();
});

app.get("/api/invites/:token", async (req, res) => {
  const invite = await poolDb.queryOne<{ id: string; board_id: string; role: string; status: string; expires_at: Date }>(
    `select id, board_id, role, status, expires_at from invites where token = $1`, [req.params.token]
  );
  if (!invite) throw notFound();
  const board = await poolDb.queryOne<{ id: string; name: string; owner_id: string }>(`select id, name, owner_id from boards where id = $1`, [Number(invite.board_id)]);
  if (!board) throw notFound();
  const inviter = await poolDb.queryOne<{ name: string }>(`select name from users where id = $1`, [Number(board.owner_id)]);
  const expired = invite.status === "pending" && businessNow().getTime() >= invite.expires_at.getTime();
  res.json({
    board: { id: Number(invite.board_id), name: board.name },
    inviter: { name: inviter?.name ?? "" },
    role: invite.role,
    status: expired ? "expired" : invite.status,
    expires_at: invite.expires_at.toISOString(),
  });
});

app.post("/api/invites/:token/accept", async (req, res) => {
  const user = await requireUser(req);
  const invite = await poolDb.queryOne<{ id: string; board_id: string; email: string; role: string; status: string; expires_at: Date }>(
    `select id, board_id, email, role, status, expires_at from invites where token = $1`, [req.params.token]
  );
  if (!invite) throw notFound();
  const board = await poolDb.queryOne<{ id: string; owner_id: string; name: string }>(`select id, owner_id, name from boards where id = $1`, [Number(invite.board_id)]);
  if (!board) throw notFound();
  if (invite.status === "revoked") throw gone("invite_revoked");
  if (invite.status === "accepted") throw gone("invite_used");
  if (businessNow().getTime() >= invite.expires_at.getTime()) throw gone("invite_expired");
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) throw forbidden();
  const alreadyMember = await poolDb.queryOne<{ user_id: string }>(
    `select user_id from board_members where board_id = $1 and user_id = $2`, [Number(invite.board_id), user.id]
  );
  if (alreadyMember) throw conflict("already_member");
  await poolDb.query(`update invites set status = 'accepted', accepted_at = $2 where id = $1`, [Number(invite.id), businessNow()]);
  await poolDb.query(
    `insert into board_members (board_id, user_id, role, created_at) values ($1, $2, $3, $4)`,
    [Number(invite.board_id), user.id, invite.role, businessNow()]
  );
  await announceViewers(Number(invite.board_id));
  const owner = await poolDb.queryOne<{ email: string }>(`select email from users where id = $1`, [Number(board.owner_id)]);
  if (owner) {
    void sendMail(owner.email, `${user.name} joined ${board.name}`,
      `${user.name} joined ${board.name}.\n${config.publicUrl}/b/${Number(invite.board_id)}`);
  }
  res.json({ board_id: Number(invite.board_id), role: invite.role });
});

// ---------- Sections ----------

app.post("/api/boards/:id/sections", async (req, res) => {
  const user = await requireUser(req);
  const boardId = Number(req.params.id);
  const board = await poolDb.queryOne<{ id: string; owner_id: string }>(`select id, owner_id from boards where id = $1`, [boardId]);
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  const role = await roleOnBoard(poolDb, user, boardId);
  if (role !== "owner" && role !== "editor") throw forbidden();
  const body = asRecord(req.body);
  const name = trimmedName(str(body.name));
  if (nameProblem(name, "name")) throw validation("name");
  const taken = await poolDb.queryOne<{ id: string }>(
    `select id from sections where board_id = $1 and lower(name) = lower($2)`, [boardId, name]
  );
  if (taken) throw conflict("section_name_taken");
  const max = await poolDb.queryOne<{ n: string }>(`select count(*)::text as n from sections where board_id = $1`, [boardId]);
  const position = Number(max!.n) + 1;
  const inserted = await poolDb.queryOne<{ id: string }>(
    `insert into sections (board_id, name, name_key, position, created_at) values ($1, $2, $3, $4, $5) returning id`,
    [boardId, name, name.toLowerCase(), position, businessNow()]
  );
  await applyBoardChange(poolDb, { boardId, actor: user, change: "section_added", section: { id: Number(inserted!.id), name }, lastSaved: false });
  res.status(201).json({ id: Number(inserted!.id), name, position });
});

app.patch("/api/sections/:id", async (req, res) => {
  const user = await requireUser(req);
  const sectionId = Number(req.params.id);
  const section = await poolDb.queryOne<{ id: string; board_id: string; position: number }>(
    `select id, board_id, position from sections where id = $1`, [sectionId]
  );
  if (!section || !(await canSeeBoard(poolDb, user, Number(section.board_id)))) throw notFound();
  const role = await roleOnBoard(poolDb, user, Number(section.board_id));
  if (role !== "owner" && role !== "editor") throw forbidden();
  const body = asRecord(req.body);
  const name = trimmedName(str(body.name));
  if (nameProblem(name, "name")) throw validation("name");
  const taken = await poolDb.queryOne<{ id: string }>(
    `select id from sections where board_id = $1 and lower(name) = lower($2) and id <> $3`,
    [Number(section.board_id), name, sectionId]
  );
  if (taken) throw conflict("section_name_taken");
  await poolDb.query(`update sections set name = $2, name_key = $3 where id = $1`, [sectionId, name, name.toLowerCase()]);
  await applyBoardChange(poolDb, { boardId: Number(section.board_id), actor: user, change: "section_renamed", section: { id: sectionId, name }, lastSaved: false });
  res.json({ id: sectionId, name, position: section.position });
});

// ---------- Moves (DP-45, DP-46, DP-49) ----------

app.post("/api/boards/:id/moves", async (req, res) => {
  const user = await requireUser(req);
  const boardId = Number(req.params.id);
  const board = await poolDb.queryOne<{ id: string; owner_id: string; seq: string }>(
    `select id, owner_id, seq from boards where id = $1`, [boardId]
  );
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  const role = await roleOnBoard(poolDb, user, boardId);
  if (role !== "owner" && role !== "editor") throw forbidden();
  const body = asRecord(req.body);
  const kind = str(body.kind);
  const position = num(body.position);
  const baseSeq = num(body.base_seq) ?? 0;
  const seqBefore = Number(board.seq);

  if (kind === "pin") {
    const id = num(body.id);
    if (id === null) throw notFound();
    const pin = await poolDb.queryOne<{ id: string; board_id: string; section_id: string | null; title: string; position: number }>(
      `select id, board_id, section_id, title, position from pins where id = $1 and status = 'live'`, [id]
    );
    if (!pin || !(await canSeeBoard(poolDb, user, Number(pin.board_id)))) throw notFound();
    const section = body.section === null || body.section === undefined ? null : num(body.section);
    if (section === null) {
      // Moving into the unsectioned area of this board.
    } else {
      const target = await poolDb.queryOne<{ id: string }>(`select id from sections where id = $1 and board_id = $2`, [section, boardId]);
      if (!target) throw notFound();
    }
    // 422 position below 1 or above the container's count after removal (API).
    const sameContainer = Number(pin.board_id) === boardId
      && (pin.section_id === null ? null : Number(pin.section_id)) === section;
    const countAfterRemoval = (await containerCount(poolDb, boardId, section)) - (sameContainer ? 1 : 0);
    if (position === null || position < 1 || position > Math.max(countAfterRemoval, 1)) throw validation("position");
    await withTransaction(async tx => {
      if (sameContainer) {
        await tx.query(
          `update pins set position = position - 1 where board_id = $1 and section_id is not distinct from $2 and position > $3`,
          [boardId, section, pin.position]
        );
        await tx.query(
          `update pins set position = position + 1 where board_id = $1 and section_id is not distinct from $2 and position >= $3 and id <> $4`,
          [boardId, section, position, id]
        );
      } else {
        await tx.query(
          `update pins set position = position - 1 where board_id = $1 and section_id is not distinct from $2 and position > $3`,
          [Number(pin.board_id), pin.section_id, pin.position]
        );
        await tx.query(
          `update pins set position = position + 1 where board_id = $1 and section_id is not distinct from $2 and position >= $3`,
          [boardId, section, position]
        );
      }
      await tx.query(`update pins set board_id = $2, section_id = $3, position = $4 where id = $1`,
        [id, boardId, section, position]);
      await renumberContainer(tx, Number(pin.board_id), pin.section_id === null ? null : Number(pin.section_id));
      await renumberContainer(tx, boardId, section);
    });
    await applyBoardChange(poolDb, { boardId, actor: user, change: "moved", pin: { id, title: pin.title }, lastSaved: false });
    if (!sameContainer && Number(pin.board_id) !== boardId) {
      await applyBoardChange(poolDb, { boardId: Number(pin.board_id), actor: user, change: "removed", pin: { id, title: pin.title }, lastSaved: false });
    }
    res.json({ seq: seqBefore + 1, rebased: baseSeq < seqBefore, order: await boardOrder(poolDb, boardId) });
  } else if (kind === "section") {
    const id = num(body.id);
    if (id === null) throw notFound();
    const sec = await poolDb.queryOne<{ id: string; board_id: string; name: string; position: number }>(
      `select id, board_id, name, position from sections where id = $1`, [id]
    );
    if (!sec || !(await canSeeBoard(poolDb, user, Number(sec.board_id)))) throw notFound();
    const count = Number((await poolDb.queryOne<{ n: string }>(`select count(*)::text as n from sections where board_id = $1`, [boardId]))!.n);
    const sameBoard = Number(sec.board_id) === boardId;
    const limit = sameBoard ? count - 1 : count + 1;
    if (position === null || position < 1 || position > limit) throw validation("position");
    await withTransaction(async tx => {
      if (sameBoard) {
        await tx.query(`update sections set position = position - 1 where board_id = $1 and position > $2`, [boardId, sec.position]);
        await tx.query(`update sections set position = position + 1 where board_id = $1 and position >= $2`, [boardId, position]);
      } else {
        await tx.query(`update sections set position = position - 1 where board_id = $1 and position > $2`, [Number(sec.board_id), sec.position]);
        await tx.query(`update sections set position = position + 1 where board_id = $1 and position >= $2`, [boardId, position]);
      }
      await tx.query(`update sections set board_id = $2, position = $3 where id = $1`, [id, boardId, position]);
      await renumberSections(tx, boardId);
      if (!sameBoard) await renumberSections(tx, Number(sec.board_id));
    });
    await applyBoardChange(poolDb, { boardId, actor: user, change: "section_moved", section: { id, name: sec.name }, lastSaved: false });
    res.json({ seq: seqBefore + 1, rebased: baseSeq < seqBefore, order: await boardOrder(poolDb, boardId) });
  } else {
    throw validation("kind");
  }
});

async function containerCount(db: Db, boardId: number, sectionId: number | null): Promise<number> {
  const row = await db.queryOne<{ n: string }>(
    `select count(*)::text as n from pins where board_id = $1 and section_id is not distinct from $2 and status = 'live'`,
    [boardId, sectionId]
  );
  return Number(row!.n);
}

// ---------- Operations (DP-40 to DP-43) ----------

app.post("/api/operations", async (req, res) => {
  const user = await requireUser(req);
  const body = asRecord(req.body);
  const kind = str(body.kind);
  if (kind !== "move" && kind !== "copy" && kind !== "delete") throw validation("kind");
  const pinsRaw = Array.isArray(body.pins) ? body.pins : [];
  const pinIds = pinsRaw.map(v => num(v)).filter((v): v is number => v !== null);
  if (pinsRaw.length === 0 || pinIds.length !== pinsRaw.length || new Set(pinIds).size !== pinIds.length) {
    throw validation("pins");
  }
  const pins = await poolDb.query<{ id: string; board_id: string; owner_id: string; title: string }>(
    `select id, board_id, owner_id, title from pins where id = any($1::bigint[]) and status = 'live'`,
    [pinIds]
  );
  if (pins.length !== pinIds.length) throw notFound();
  for (const pin of pins) {
    if (!(await canSeeBoard(poolDb, user, Number(pin.board_id)))) throw notFound();
  }

  let targetBoard: number | null = null;
  let targetSection: number | null = null;
  let targetBoardName: string | null = null;
  if (kind !== "delete") {
    targetBoard = num(body.board);
    if (targetBoard === null) throw validation("board");
    const board = await poolDb.queryOne<{ id: string; name: string; owner_id: string }>(
      `select id, name, owner_id from boards where id = $1`, [targetBoard]
    );
    if (!board || !(await canSeeBoard(poolDb, user, targetBoard))) throw notFound();
    const role = await roleOnBoard(poolDb, user, targetBoard);
    if (role !== "owner" && role !== "editor") throw forbidden();
    targetBoardName = board.name;
    if (body.section !== null && body.section !== undefined) {
      targetSection = num(body.section);
      const section = await poolDb.queryOne<{ id: string }>(`select id from sections where id = $1 and board_id = $2`, [targetSection, targetBoard]);
      if (!section || targetSection === null) throw notFound();
    }
    // One root original per board (DP-34, DP-40): refused as a whole.
    const rootOf = new Map<number, number>();
    for (const pin of pins) {
      rootOf.set(Number(pin.id), await pinRootId(poolDb, Number(pin.id)));
    }
    if (new Set(rootOf.values()).size !== rootOf.size) {
      throw conflict("already_on_board", { board: { id: targetBoard, name: targetBoardName } });
    }
    for (const [pinId, rootId] of rootOf) {
      const clash = await poolDb.queryOne<{ id: string }>(
        `select id from pins where board_id = $1 and status = 'live' and (id = $2 or root_id = $2) and id <> all($3::bigint[])`,
        [targetBoard, rootId, pinIds]
      );
      if (clash) {
        // A move to the pin's own board is allowed; the pins just go to the target container.
        const ownBoard = pins.find(p => Number(p.id) === pinId)!;
        if (!(kind === "move" && Number(ownBoard.board_id) === targetBoard)) {
          throw conflict("already_on_board", { board: { id: targetBoard, name: targetBoardName } });
        }
      }
    }
  }

  for (const pin of pins) {
    const role = await roleOnBoard(poolDb, user, Number(pin.board_id));
    if (role !== "owner" && role !== "editor") throw forbidden();
  }

  const op = await withTransaction(async tx => {
    return runBulkOperation(tx, user, { kind, pinIds, targetBoard, targetSection, targetBoardName: targetBoardName ?? undefined });
  });
  for (const pinId of pinIds) await broadcastCountsFor(pinId);
  res.status(201).json(operationJson(op, targetBoardName));
});

async function pinRootId(db: Db, pinId: number): Promise<number> {
  const row = await db.queryOne<{ root_id: string | null; id: string }>(`select root_id, id from pins where id = $1`, [pinId]);
  return row!.root_id === null ? Number(row!.id) : Number(row!.root_id);
}

app.post("/api/operations/:id/undo", async (req, res) => {
  const user = await requireUser(req);
  const { op, boardName } = await withTransaction(async tx => undoOperation(tx, user, num(req.params.id)!));
  const entries = (op.payload as { pins: Array<{ pinId: number }> }).pins;
  for (const entry of entries) await broadcastCountsFor(entry.pinId);
  res.json(operationJson(op, boardName));
});

/** Expires open operations whose deadline passed on the business clock (DP-42). */
export async function expireOperations(): Promise<void> {
  const now = businessNow();
  const rows = await poolDb.query<{ id: string; user_id: string }>(
    `update operations set status = 'expired' where status = 'open' and deadline <= $1 returning id, user_id`,
    [now]
  );
  for (const row of rows) {
    await broadcastOperationExpired(Number(row.id), Number(row.user_id));
  }
}

// ---------- Follows (DP-16) ----------

app.put("/api/follows/users/:id", async (req, res) => {
  const user = await requireUser(req);
  const targetId = num(req.params.id);
  if (targetId === null) throw notFound();
  if (targetId === Number(user.id)) throw validation("user");
  const target = await poolDb.queryOne<{ id: string }>(`select id from users where id = $1`, [targetId]);
  if (!target) throw notFound();
  await poolDb.query(
    `insert into follows_users (follower_id, target_id, created_at) values ($1, $2, $3) on conflict do nothing`,
    [user.id, targetId, businessNow()]
  );
  await broadcastFollow("user", targetId, await userFollowerCount(poolDb, targetId));
  res.json({ following: true, followers: await userFollowerCount(poolDb, targetId) });
});

app.delete("/api/follows/users/:id", async (req, res) => {
  const user = await requireUser(req);
  const targetId = num(req.params.id);
  if (targetId === null) throw notFound();
  if (targetId === Number(user.id)) throw validation("user");
  await poolDb.query(`delete from follows_users where follower_id = $1 and target_id = $2`, [user.id, targetId]);
  await broadcastFollow("user", targetId, await userFollowerCount(poolDb, targetId));
  res.json({ following: false, followers: await userFollowerCount(poolDb, targetId) });
});

app.put("/api/follows/boards/:id", async (req, res) => {
  const user = await requireUser(req);
  const boardId = num(req.params.id);
  if (boardId === null) throw notFound();
  const board = await poolDb.queryOne<{ id: string; owner_id: string; visibility: string }>(`select id, owner_id, visibility from boards where id = $1`, [boardId]);
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  if (board.owner_id === String(user.id)) throw validation("board");
  if (board.visibility !== "public") throw validation("board");
  await poolDb.query(
    `insert into follows_boards (follower_id, board_id, created_at) values ($1, $2, $3) on conflict do nothing`,
    [user.id, boardId, businessNow()]
  );
  await broadcastFollow("board", boardId, await boardFollowerCount(poolDb, boardId));
  res.json({ following: true, followers: await boardFollowerCount(poolDb, boardId) });
});

app.delete("/api/follows/boards/:id", async (req, res) => {
  const user = await requireUser(req);
  const boardId = num(req.params.id);
  if (boardId === null) throw notFound();
  const board = await poolDb.queryOne<{ id: string; owner_id: string }>(`select id, owner_id from boards where id = $1`, [boardId]);
  if (!board || !(await canSeeBoard(poolDb, user, boardId))) throw notFound();
  await poolDb.query(`delete from follows_boards where follower_id = $1 and board_id = $2`, [user.id, boardId]);
  await broadcastFollow("board", boardId, await boardFollowerCount(poolDb, boardId));
  res.json({ following: false, followers: await boardFollowerCount(poolDb, boardId) });
});

// ---------- Users and profiles (DP-64) ----------

app.get("/api/users/:handle", async (req, res) => {
  const viewer = await userFromRequest(req);
  const user = await findUserByHandle(req.params.handle);
  if (!user) throw notFound();
  const sort = req.query.sort === "az" ? "az" : req.query.sort === "newest" ? "newest" : "last_saved";
  const boards = await poolDb.query<{ id: string; name: string; visibility: "public" | "secret"; pin_count: string; last_saved_at: Date | null; created_at: Date; cover_pin_id: string | null }>(
    `select b.id, b.name, b.visibility, b.created_at, b.last_saved_at, b.cover_pin_id,
            (select count(*)::text from pins p where p.board_id = b.id and p.status = 'live') as pin_count
     from boards b where b.owner_id = $1`,
    [user.id]
  );
  const visible: typeof boards = [];
  for (const b of boards) {
    if (await canSeeBoard(poolDb, viewer, Number(b.id))) visible.push(b);
  }
  if (sort === "az") {
    visible.sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : Number(a.id) - Number(b.id));
  } else if (sort === "newest") {
    visible.sort((a, b) => (b.created_at.getTime() - a.created_at.getTime()) || (Number(a.id) - Number(b.id)));
  } else {
    visible.sort((a, b) => {
      const av = a.last_saved_at ? a.last_saved_at.getTime() : -Infinity;
      const bv = b.last_saved_at ? b.last_saved_at.getTime() : -Infinity;
      return bv === av ? Number(a.id) - Number(b.id) : bv - av;
    });
  }
  const boardJsons = [];
  for (const b of visible) {
    const coverPinId = await boardCover(poolDb, { id: Number(b.id), cover_pin_id: b.cover_pin_id === null ? null : Number(b.cover_pin_id) });
    const cover = coverPinId
      ? { pin_id: coverPinId, url: `/media/${coverPinId}/236` }
      : null;
    boardJsons.push({
      id: Number(b.id), name: b.name, visibility: b.visibility,
      pin_count: Number(b.pin_count), cover,
    });
  }
  const followers = await userFollowerCount(poolDb, Number(user.id));
  const following = await userFollowingCount(poolDb, Number(user.id));
  const pinTotal = await poolDb.queryOne<{ n: string }>(
    `select count(*)::text as n from pins p join boards b on b.id = p.board_id
     where p.owner_id = $1 and p.status = 'live' and (b.visibility = 'public' or b.owner_id = $1)`,
    [user.id]
  );
  let followingUser = false;
  if (viewer) {
    followingUser = (await poolDb.queryOne<{ f: string }>(
      `select 1::text as f from follows_users where follower_id = $1 and target_id = $2`, [viewer.id, user.id]
    )) !== null;
  }
  res.json({
    user: { id: Number(user.id), name: user.name, handle: user.handle },
    followers,
    following,
    pin_total: Number(pinTotal!.n),
    board_total: visible.length,
    boards: boardJsons,
    following_user: followingUser,
  });
});

app.get("/api/users/:handle/pins", async (req, res) => {
  const viewer = await userFromRequest(req);
  const user = await findUserByHandle(req.params.handle);
  if (!user) throw notFound();
  const rows = await poolDb.query<{ id: string }>(
    `select p.id from pins p join boards b on b.id = p.board_id
     where p.owner_id = $1 and p.status = 'live'
       and (b.visibility = 'public' or b.owner_id = $1 or exists (
         select 1 from board_members m where m.board_id = b.id and m.user_id = $2
       ))
     order by p.created_at desc, p.id asc limit 60`,
    [user.id, viewer?.id ?? 0]
  );
  res.json({ pins: await pinsJson(poolDb, viewer, rows.map(r => Number(r.id))) });
});

// ---------- Search (DP-65, DP-66) ----------

app.get("/api/search", async (req, res) => {
  const viewer = await userFromRequest(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const tag = typeof req.query.tag === "string" ? req.query.tag.toLowerCase() : "";
  const board = typeof req.query.board === "string" ? num(req.query.board) : null;
  const candidates = await poolDb.query<{
    id: string; title: string; description: string; tags: string[]; board_id: string;
    board_name: string; board_visibility: "public" | "secret"; owner_id: string;
    created_at: Date;
  }>(
    `select p.id, p.title, p.description, p.tags, p.board_id, b.name as board_name,
            b.visibility as board_visibility, p.owner_id, p.created_at
     from pins p join boards b on b.id = p.board_id
     where p.status = 'live' and b.visibility = 'public'
     order by p.created_at desc, p.id asc`
  );
  const queryWords = words(q).map(w => w.toLowerCase());
  const matchQ = (pin: typeof candidates[number]): boolean => {
    if (queryWords.length === 0) return true;
    const titleWords = words(pin.title).map(w => w.toLowerCase());
    const descWords = words(pin.description).map(w => w.toLowerCase());
    const tagWords = (pin.tags ?? []).map(t => t.toLowerCase());
    const all = [...titleWords, ...descWords, ...tagWords];
    return queryWords.every(qw => all.some(w => w.startsWith(qw)));
  };
  const visible = [];
  for (const c of candidates) {
    if (board !== null && Number(c.board_id) !== board) continue;
    if (tag !== "" && !(c.tags ?? []).some(t => t.toLowerCase() === tag)) continue;
    if (!matchQ(c)) continue;
    visible.push(c);
  }
  // The tag facet counts pins matching q and the board filter; the board facet q and the tag filter.
  const tagCounts = new Map<string, number>();
  const boardCounts = new Map<number, { name: string; count: number; id: number }>();
  for (const c of candidates) {
    const boardOk = board === null || Number(c.board_id) === board;
    const tagOk = tag === "" || (c.tags ?? []).some(t => t.toLowerCase() === tag);
    if (boardOk && matchQ(c)) {
      for (const t of c.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    if (tagOk && matchQ(c)) {
      const entry = boardCounts.get(Number(c.board_id));
      if (entry) entry.count++;
      else boardCounts.set(Number(c.board_id), { id: Number(c.board_id), name: c.board_name, count: 1 });
    }
  }
  const tags = [...tagCounts.entries()]
    .filter(([, count]) => count >= 1)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([t, count]) => ({ tag: t, count }));
  const boards = [...boardCounts.values()]
    .filter(b => b.count >= 1)
    .sort((a, b) => b.count - a.count || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.id - b.id))
    .map(b => ({ id: b.id, name: b.name, count: b.count }));
  const ordered = visible
    .sort((a, b) => (b.created_at.getTime() - a.created_at.getTime()) || (Number(a.id) - Number(b.id)))
    .slice(0, 60);
  res.json({
    pins: await pinsJson(poolDb, viewer, ordered.map(p => Number(p.id))),
    tags,
    boards,
  });
});

// ---------- Tag suggestions (DP-88) ----------

app.get("/api/tags/suggest", async (req, res) => {
  const user = await requireUser(req);
  const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
  if (!/^[\p{L}\p{N}_]{1,30}$/u.test(prefix)) throw validation("prefix");
  const rows = await poolDb.query<{ tags: string[] }>(
    `select p.tags from pins p join boards b on b.id = p.board_id
     where p.owner_id = $1 and p.status = 'live'`,
    [user.id]
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const t of row.tags ?? []) {
      if (t.toLowerCase().startsWith(prefix.toLowerCase())) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 5)
    .map(([tag, count]) => ({ tag, count }));
  res.json({ tags });
});

// ---------- Media (DP-62, DP-28) ----------

app.get("/media/:pinId/:width", async (req, res) => {
  const viewer = await userFromRequest(req);
  const pinId = num(req.params.pinId);
  if (pinId === null) throw notFound();
  const widthRaw = req.params.width;
  if (widthRaw !== "original" && num(widthRaw) === null) throw notFound();
  const width = widthRaw === "original" ? null : num(widthRaw);
  const pin = await poolDb.queryOne<{ image_id: string; board_id: string }>(
    `select image_id, board_id from pins where id = $1 and status = 'live'`, [pinId]
  );
  if (!pin || !(await canSeeBoard(poolDb, viewer, Number(pin.board_id)))) throw notFound();
  const image = await poolDb.queryOne<{ width: number; height: number; format: "png" | "jpeg" }>(
    `select width, height, format from images where id = $1`, [Number(pin.image_id)]
  );
  if (!image) throw notFound();
  const displayWidths = [236, 474, 736].filter(w => w <= image.width);
  let chosenWidth: number | null;
  if (width === null) {
    chosenWidth = null;
  } else {
    if (!displayWidths.includes(width)) throw notFound();
    chosenWidth = width;
  }
  if (!storageOk) {
    try { await storageAvailableNow(); } catch { /* the probe keeps the last state */ }
  }
  if (!storageOk) throw storageUnavailable();
  const ext = image.format === "jpeg" ? "jpg" : "png";
  const key = chosenWidth === null
    ? `images/${Number(pin.image_id)}/original.${ext}`
    : `images/${Number(pin.image_id)}/w${chosenWidth}.${ext}`;
  try {
    const bytes = await getObject(key);
    if (!bytes) throw notFound();
    res.setHeader("Content-Type", image.format === "jpeg" ? "image/jpeg" : "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.status(200).send(bytes);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw storageUnavailable();
  }
});

// ---------- Static assets and the client app ----------

app.use(express.static(PUBLIC_DIR, { index: false, fallthrough: true, maxAge: "1h" }));

app.get("/{*path}", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  // The app never serves its own files (DP-07).
  if (req.path === "/run.json" || req.path === "/package.json" || req.path === "/build.mjs"
    || req.path === "/tsconfig.json" || req.path === "/AGENTS.md" || req.path === "/THIRD_PARTY_NOTICES.md") {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const index = join(PUBLIC_DIR, "index.html");
  if (!existsSync(index)) { next(); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(readFileSync(index, "utf8"));
});

// ---------- Error handling: one shape for the whole API (DP-06) ----------

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    sendError(res, err);
    return;
  }
  console.error("unhandled error", req.method, req.path, err);
  res.status(500).json({ error: "internal" });
});

// ---------- Background work ----------

/** Removes storage objects of pins gone for good, within 60 seconds of expiry. */
async function sweeperLoop(): Promise<void> {
  for (;;) {
    try {
      const gone = await poolDb.query<{ image_id: string }>(
        `select distinct p.image_id from pins p
         where p.status = 'gone' and p.image_id not in (
           select image_id from pins where status in ('live','draft','deleted')
         )`
      );
      for (const row of gone) {
        const imageId = Number(row.image_id);
        await poolDb.query(`delete from pins where image_id = $1 and status = 'gone'`, [imageId]);
        await poolDb.query(`delete from images where id = $1`, [imageId]);
        try {
          const exts = ["png", "jpg"];
          const keys: string[] = [];
          for (const ext of exts) {
            keys.push(`images/${imageId}/original.${ext}`);
            for (const w of [236, 474, 736]) keys.push(`images/${imageId}/w${w}.${ext}`);
          }
          await deleteObjects(keys);
        } catch { /* retry on the next sweep */ }
      }
      await expireOperations();
      await persistClock();
    } catch (e) {
      console.error("sweeper error", e);
    }
    await new Promise(r => setTimeout(r, 15_000));
  }
}

async function clockLoop(): Promise<void> {
  for (;;) {
    await new Promise(r => setTimeout(r, 30_000));
    broadcastClock(businessNow().toISOString());
  }
}

// ---------- Startup (DP-01, DP-03, DP-91) ----------

async function main(): Promise<void> {
  await initDb();
  await initClock();
  const httpServer = createServer(app);
  initLive(httpServer);
  const port = config.port;
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Mothlight serving on 0.0.0.0:${port}`);
  });
  void storageLoop();
  void sweeperLoop();
  void clockLoop();
  // Demo content is created once on a database with no people (DP-91).
  void seedDemoContent().catch(e => console.error("demo seed failed", e));
}

main().catch(e => {
  console.error("startup failed", e);
  process.exit(1);
});
