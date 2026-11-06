// The API routes. One precedence ladder holds for the whole API, decided
// here in one place before any handler runs.

import type { Config } from "./config";
import type { Db } from "./db";
import type { Store } from "./store";
import {
  HttpError,
  type Request,
  type Response,
  jsonResponse,
  emptyResponse,
  bytesResponse,
  textResponse,
  cookieOf,
  clearCookie,
  tokenOfCookie,
  loadSession,
  sessionEnded,
  createSession,
  endSession,
  now,
  newId,
  newToken,
  newSalt,
  hashPassword,
  passwordMatches,
  jsonOf,
  strOf,
  numOf,
  boolOf,
  sha256Hex,
  parseMultipart,
  findFile,
  JSON_BODY_LIMIT,
  UPLOAD_BODY_LIMIT,
  FRAME_FILE_LIMIT,
  ATTACHMENT_FILE_LIMIT,
  dateOfText,
  timeOfText,
  searchOf,
  type Json,
} from "./http";
import { deliverPending, queueMail } from "./mail";
import * as board from "./domain/board";
import { seededDrawing } from "./schema";
import { Hollowreed, Quaymill, RateLimited, type Track } from "./providers";
import { renderPdf } from "./pdf";
import * as shared from "../shared/main";
import {
  ARTIST_COPY,
  COPY,
  VISITOR_COPY,
  PRIVATE_COPY,
  FEE_COPY,
  MAIL_ADDRESS,
  type Town,
  type Language,
} from "../shared/copy";
import type { Instant } from "../shared/tz";
import {
  wallDate,
  wallTime,
  longDate,
  instantText,
  instantOfWall,
  weekStartOfAmsterdam,
  dateOnly,
} from "../shared/tz";
import { foldForCompare } from "../shared/folding";
import { timecode } from "../shared/timecode";
import {
  realSecondsText,
  secondsToFrames,
  nominalFrames,
  convertFrames,
  isFrameRate,
  type FrameRate,
} from "../shared/framerate";
import { Rat } from "../shared/rat";
import { parsePositiveDecimal } from "../shared/framerate";
import { amountText, type Currency, isCurrency, taxOfMilestone, taxPercentOfPlace, splitMilestones } from "../shared/money";
import { calendarFile, CALENDAR_FILE_NAME, CALENDAR_MIME } from "../shared/ics";
import { editDecisionList } from "../shared/edl";
import { shotList, type ShotListFrame } from "../shared/shotlist";

type Handler = (req: Request, store: Store, db: Db) => Promise<Response>;

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler; needsSession: boolean; stateChanging: boolean };

const routes: Route[] = [];

// The desk's own routes need the session; the published ones are named below.
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/sign-up",
  "/api/sign-in",
  "/api/sign-out",
  "/api/enquiries",
  "/api/today",
]);

function route(method: string, path: string, handler: Handler, opts: { session?: boolean } = {}): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:(\w+)/g, (_m, key) => {
        keys.push(key);
        return "([^/]+)";
      }) +
      "$",
  );
  const needsSession = opts.session ?? !(PUBLIC_PATHS.has(path) || path.startsWith("/api/r/") || path.startsWith("/api/s/") || path.startsWith("/api/f/"));
  routes.push({
    method,
    pattern,
    keys,
    handler,
    needsSession,
    stateChanging: method !== "GET" && method !== "HEAD",
  });
}

// The precedence ladder, for the whole API.
export async function dispatch(req: Request, store: Store, db: Db): Promise<Response> {
  const method = req.method === "HEAD" ? "GET" : req.method;
  let matched: Route | null = null;
  for (const r of routes) {
    const m = r.pattern.exec(req.path);
    if (m === null) continue;
    if (r.method !== method) {
      matched = matched ?? r;
      continue;
    }
    matched = r;
    req.params = {};
    r.keys.forEach((key, i) => {
      req.params[key] = decodeURIComponent(m[i + 1]!);
    });
    break;
  }
  if (matched === null) {
    throw new HttpError(404, "unknownRoute", "There is nothing at this address.");
  }
  if (matched.method !== method) {
    throw new HttpError(405, "methodNotAllowed", "That method is not allowed here.", null, {
      Allow: matched.method,
    });
  }

  // 1. A body or file over its size limit, judged on Content-Length first.
  const declared = Number(req.headers["content-length"] ?? "0");
  const contentType = req.headers["content-type"] ?? "";
  const isUpload = contentType.startsWith("multipart/form-data");
  if (isUpload) {
    if (declared > UPLOAD_BODY_LIMIT) {
      throw new HttpError(413, "tooLarge", "This upload is over its size limit.");
    }
  } else if (method !== "GET" && declared > JSON_BODY_LIMIT) {
    throw new HttpError(413, "tooLarge", "This request is over its size limit.");
  }

  // 2. A foreign Origin on a state-changing request: 403, and no response
  // ever echoes a foreign Origin with credentials allowed.
  if (matched.stateChanging) {
    const origin = req.headers["origin"];
    if (origin !== undefined && origin.length > 0 && !isOwnOrigin(req, origin)) {
      throw new HttpError(403, "foreignOrigin", "This address is not for that origin.");
    }
  }

  // 3. Authentication.
  if (matched.needsSession) {
    const token = tokenOfCookie(req.headers.cookie);
    const session = await loadSession(db, req.config, req.headers.cookie);
    if (session === null) {
      const ended = token !== null && await sessionEnded(db, token);
      throw new HttpError(
        401,
        ended ? "session_ended" : "notSignedIn",
        ended ? COPY.sessionEnded : "Sign in to keep going.",
      );
    }
    req.session = session;
  }

  return await matched.handler(req, store, db);
}

function isOwnOrigin(req: Request, origin: string): boolean {
  const own = new URL(req.config.appPublicUrl);
  const ownPort = own.port === "" ? "" : `:${own.port}`;
  return origin === `${own.protocol}//${own.hostname}${ownPort}`;
}

export async function deliverMail(config: Config, db: Db): Promise<void> {
  await deliverPending(config, db);
}

export async function tick(config: Config, db: Db, store: Store): Promise<void> {
  const at = now();
  await tickRenders(config, db, store, at);
  await tickReminders(config, db, at);
  await tickErasure(db, store, at);
  await tickClientWaits(db, at);
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

route("GET", "/api/health", async () => jsonResponse(200, { status: "ok" }));

route("POST", "/api/sign-up", async (req, _store, db) => {
  const body = jsonOf(req);
  const name = requireName(body);
  const email = requireEmail(body);
  const password = requireNewPassword(body);
  const held = await db.one("select id from desks where lower(email) = lower($1)", [email]);
  if (held !== null) {
    throw new HttpError(409, "emailHeld", "That mail address is already on another desk.");
  }
  const salt = newSalt();
  const id = newId();
  await db.query(
    "insert into desks (id, name, email, password_salt, password_hash, created_at) values ($1, $2, $3, $4, $5, $6)",
    [id, name, email, salt, hashPassword(password, salt), String(now())],
  );
  const token = await createSession(db, req.config, id);
  return withCookie(jsonResponse(201, { id, name, email }), token);
});

route("POST", "/api/sign-in", async (req, _store, db) => {
  const body = jsonOf(req);
  const email = requireEmail(body);
  const password = strOf(body, "password");
  if (password === null) {
    throw new HttpError(422, "password", "A password has at least 10 characters.", { password: COPY.passwordRule });
  }
  const row = await db.one("select id, name, email, password_salt, password_hash from desks where lower(email) = lower($1)", [email]);
  if (row === null || !passwordMatches(password, String(row.password_salt), String(row.password_hash))) {
    throw new HttpError(401, "wrongSignIn", COPY.wrongSignIn);
  }
  const token = await createSession(db, req.config, String(row.id));
  return withCookie(
    jsonResponse(200, { id: String(row.id), name: String(row.name), email: String(row.email) }),
    token,
  );
});

route("POST", "/api/sign-out", async (req, _store, db) => {
  const token = tokenOfCookie(req.headers.cookie);
  if (token !== null) {
    await endSession(db, token);
  }
  return {
    status: 204,
    headers: { "set-cookie": clearCookie() },
    body: null,
  };
});

route("GET", "/api/session", async (req, _store, db) => {
  const row = await deskOf(db, req);
  return jsonResponse(200, { id: row.id, name: row.name, email: row.email });
});

route("POST", "/api/password", async (req, _store, db) => {
  const body = jsonOf(req);
  const current = strOf(body, "currentPassword");
  const next = strOf(body, "newPassword");
  if (current === null || next === null) {
    throw new HttpError(422, "password", "A password has at least 10 characters.", {
      newPassword: COPY.passwordRule,
    });
  }
  if (next.length < 10) {
    throw new HttpError(422, "newPassword", "A password has at least 10 characters.", {
      newPassword: COPY.passwordRule,
    });
  }
  const desk = await deskRow(db, req);
  if (!passwordMatches(current, String(desk.password_salt), String(desk.password_hash))) {
    throw new HttpError(422, "currentPassword", ARTIST_COPY.currentPasswordWrong, {
      currentPassword: ARTIST_COPY.currentPasswordWrong,
    });
  }
  const salt = newSalt();
  await db.query("update desks set password_salt = $1, password_hash = $2 where id = $3", [
    salt,
    hashPassword(next, salt),
    desk.id,
  ]);
  // The other sessions end; this one stays. The ended ones are recorded so a
  // cookie from them answers session_ended rather than notSignedIn.
  const token = tokenOfCookie(req.headers.cookie);
  if (token !== null) {
    const others = await db.many("select token from sessions where token <> $1 and desk_id = $2", [
      token,
      desk.id,
    ]);
    for (const other of others) {
      await db.query("insert into ended_sessions (token, at) values ($1, $2)", [
        String(other.token),
        String(now()),
      ]);
    }
    await db.query("delete from sessions where token <> $1 and desk_id = $2", [token, desk.id]);
  }
  return emptyResponse(204);
});

async function deskOf(db: Db, req: Request): Promise<{ id: string; name: string; email: string }> {
  if (req.session === null) throw new HttpError(401, "notSignedIn", "Sign in to keep going.");
  const row = await deskRow(db, req);
  return { id: row.id, name: row.name, email: row.email };
}

async function deskRow(db: Db, req: Request): Promise<{ id: string; name: string; email: string; password_salt: string; password_hash: string }> {
  const row = await db.one("select id, name, email, password_salt, password_hash from desks where id = $1", [
    req.session!.deskId,
  ]);
  if (row === null) throw new HttpError(401, "notSignedIn", "Sign in to keep going.");
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    password_salt: String(row.password_salt),
    password_hash: String(row.password_hash),
  };
}

function withCookie(response: Response, token: string): Response {
  return { ...response, headers: { ...response.headers, "set-cookie": cookieOf(token) } };
}

function requireName(body: Json): string {
  const name = strOf(body, "name");
  if (name === null || name.trim().length === 0) {
    throw new HttpError(422, "name", COPY.typeAName, { name: COPY.typeAName });
  }
  return name.trim();
}

function requireEmail(body: Json): string {
  const email = strOf(body, "email");
  if (email === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new HttpError(422, "email", COPY.typeAnEmail, { email: COPY.typeAnEmail });
  }
  return email.trim();
}

function requireNewPassword(body: Json): string {
  const password = strOf(body, "password");
  if (password === null || password.length < 10) {
    throw new HttpError(422, "password", COPY.passwordRule, { password: COPY.passwordRule });
  }
  return password;
}

// ---------------------------------------------------------------------------
// Clients and producers
// ---------------------------------------------------------------------------

route("GET", "/api/clients", async (req, _store, db) => {
  const clients = await db.many(
    "select c.id, c.name, c.place, c.state, c.closes_at, c.created_at, count(j.id) as jobs from clients c left join jobs j on j.client_id = c.id and j.state <> 'archived' where c.desk_id = $1 and c.state <> 'erased' group by c.id, c.name, c.place, c.state, c.closes_at, c.created_at order by c.created_at, c.id",
    [req.session!.deskId],
  );
  const total = clients.length;
  const erased = await db.many(
    "select id, name, erased_at from clients where desk_id = $1 and state = 'erased' order by erased_at, id",
    [req.session!.deskId],
  );
  return jsonResponse(200, {
    clients: clients.map(clientView),
    total,
    erasedClients: erased.map((e) => ({
      id: String(e.id),
      name: String(e.name),
      erasedAt: instantText(Number(e.erased_at)),
    })),
  });
});

function clientView(row: Record<string, unknown>): Json {
  return {
    id: String(row.id),
    name: String(row.name),
    place: String(row.place),
    state: String(row.state),
    closesAt: row.closes_at === null ? null : instantText(Number(row.closes_at)),
    createdAt: instantText(Number(row.created_at)),
  };
}

route("POST", "/api/clients", async (req, _store, db) => {
  const body = jsonOf(req);
  const name = requireName(body);
  const place = strOf(body, "place");
  if (place === null || !PLACES.includes(place as never)) {
    throw new HttpError(422, "place", "Pick a place from the list.", { place: "Pick a place from the list." });
  }
  const id = newId();
  await db.query(
    "insert into clients (id, desk_id, name, place, state, closes_at, erased_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [id, req.session!.deskId, name, place, "active", null, null, String(now())],
  );
  const row = await db.one("select id, name, place, state, closes_at, created_at from clients where id = $1", [id]);
  return jsonResponse(201, clientView(row!));
});

route("GET", "/api/clients/:id", async (req, _store, db) => {
  const row = await clientOfDesk(db, req.session!.deskId, req.params.id!);
  const producers = await db.many("select * from producers where client_id = $1 order by name", [row.id]);
  const jobs = await db.many(
    "select * from jobs where client_id = $1 and state <> 'archived' order by created_at, id",
    [row.id],
  );
  return jsonResponse(200, {
    ...clientView(row),
    producers: producers.map(producerView),
    jobs: jobs.map(jobView),
  });
});

route("PATCH", "/api/clients/:id", async (req, _store, db) => {
  const row = await clientOfDesk(db, req.session!.deskId, req.params.id!);
  const body = jsonOf(req);
  const name = strOf(body, "name") ?? String(row.name);
  const place = strOf(body, "place") ?? String(row.place);
  if (String(row.state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  await db.query("update clients set name = $1, place = $2 where id = $3", [name, place, row.id]);
  const after = await db.one("select * from clients where id = $1", [row.id]);
  return jsonResponse(200, clientView(after!));
});

route("DELETE", "/api/clients/:id", async (req, _store, db) => {
  const row = await clientOfDesk(db, req.session!.deskId, req.params.id!);
  const jobs = await db.one("select count(*) as n from jobs where client_id = $1", [row.id]);
  if (Number(jobs!.n) > 0) {
    throw new HttpError(409, "hasJobs", ARTIST_COPY.clientHasJobs);
  }
  await db.query("delete from producers where client_id = $1", [row.id]);
  await db.query("delete from clients where id = $1", [row.id]);
  return emptyResponse(204);
});

route("POST", "/api/clients/:id/close", async (req, _store, db) => {
  const row = await clientOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(row.state) !== "active") {
    throw new HttpError(409, "notActive", ARTIST_COPY.closingNoChange);
  }
  const closesAt = now() + req.config.timers.closureWaitSeconds;
  await db.query("update clients set state = 'closing', closes_at = $1 where id = $2", [
    String(closesAt),
    row.id,
  ]);
  const after = await db.one("select * from clients where id = $1", [row.id]);
  return jsonResponse(200, clientView(after!));
});

route("POST", "/api/clients/:id/bring-back", async (req, _store, db) => {
  const row = await clientOfDesk(db, req.session!.deskId, req.params.id!);
  const state = String(row.state);
  if (state === "active") {
    throw new HttpError(409, "notClosing", ARTIST_COPY.notClosing);
  }
  if (state === "erased" || state === "erasing") {
    throw new HttpError(404, "unknownClient", "There is nothing at this address.");
  }
  if (Number(row.closes_at) <= now()) {
    throw new HttpError(409, "waitPassed", ARTIST_COPY.waitPassed);
  }
  await db.query("update clients set state = 'active', closes_at = null where id = $1", [row.id]);
  const after = await db.one("select * from clients where id = $1", [row.id]);
  return jsonResponse(200, clientView(after!));
});

route("GET", "/api/clients/:id/producers", async (req, _store, db) => {
  const row = await clientOfDesk(db, req.session!.deskId, req.params.id!);
  const producers = await db.many("select * from producers where client_id = $1 order by name", [row.id]);
  return jsonResponse(200, { producers: producers.map(producerView) });
});

route("POST", "/api/clients/:id/producers", async (req, _store, db) => {
  const row = await clientOfDesk(db, req.session!.deskId, req.params.id!);
  const body = jsonOf(req);
  const name = requireName(body);
  const email = requireEmail(body);
  const town = strOf(body, "town");
  const language = strOf(body, "language");
  if (town === null || !TOWNS.includes(town as never)) {
    throw new HttpError(422, "town", "Pick a town from the list.", { town: "Pick a town from the list." });
  }
  if (language === null || !LANGUAGES.includes(language as never)) {
    throw new HttpError(422, "language", "Pick a language from the list.", { language: "Pick a language from the list." });
  }
  const id = newId();
  await db.query(
    "insert into producers (id, client_id, name, email, town, language) values ($1, $2, $3, $4, $5, $6)",
    [id, row.id, name, email, town, language],
  );
  const after = await db.one("select * from producers where id = $1", [id]);
  return jsonResponse(201, producerView(after!));
});

route("PATCH", "/api/producers/:id", async (req, _store, db) => {
  const row = await producerOfDesk(db, req.session!.deskId, req.params.id!);
  const body = jsonOf(req);
  const name = strOf(body, "name") ?? String(row.name);
  const email = strOf(body, "email") ?? String(row.email);
  const town = strOf(body, "town") ?? String(row.town);
  const language = strOf(body, "language") ?? String(row.language);
  if (!TOWNS.includes(town as never) || !LANGUAGES.includes(language as never)) {
    throw new HttpError(422, "shape", "Pick a town and a language from the lists.", {
      town: "Pick a town from the list.",
    });
  }
  await db.query("update producers set name = $1, email = $2, town = $3, language = $4 where id = $5", [
    name,
    email,
    town,
    language,
    row.id,
  ]);
  const after = await db.one("select * from producers where id = $1", [row.id]);
  return jsonResponse(200, producerView(after!));
});

function producerView(row: Record<string, unknown>): Json {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: String(row.name),
    email: String(row.email),
    town: String(row.town),
    language: String(row.language),
  };
}

async function clientOfDesk(db: Db, deskId: string, clientId: string): Promise<Record<string, unknown>> {
  const row = await db.one("select * from clients where id = $1 and desk_id = $2", [clientId, deskId]);
  if (row === null || String(row.state) === "erased") {
    throw new HttpError(404, "unknownClient", "There is nothing at this address.");
  }
  return row;
}

async function producerOfDesk(db: Db, deskId: string, producerId: string): Promise<Record<string, unknown>> {
  const row = await db.one(
    "select p.* from producers p join clients c on c.id = p.client_id where p.id = $1 and c.desk_id = $2 and c.state <> 'erased'",
    [producerId, deskId],
  );
  if (row === null) {
    throw new HttpError(404, "unknownProducer", "There is nothing at this address.");
  }
  return row;
}

const PLACES = ["netherlands", "ontario", "newYork", "dubai"];
const TOWNS = ["amsterdam", "newYork", "toronto", "dubai"];
const LANGUAGES = ["en", "nl", "fr", "ar"];

// ---------------------------------------------------------------------------
// Jobs and search
// ---------------------------------------------------------------------------

function jobView(row: Record<string, unknown>): Json {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    clientName: String(row.client_name ?? ""),
    title: String(row.title),
    adId: String(row.ad_id),
    dueDate: String(row.due_date),
    targetSeconds: Number(row.target_seconds),
    frameRate: String(row.frame_rate),
    aspect: String(row.aspect),
    state: String(row.state),
    createdAt: instantText(Number(row.created_at)),
  };
}

// The Jobs list sorts by the chosen key, then by id ascending. A next-page
// cursor follows that order, so a job present when paging began is never
// repeated or skipped while new ones arrive.
route("GET", "/api/jobs", async (req, _store, db) => {
  const deskId = req.session!.deskId;
  const clientFilter = req.query.get("clientId");
  const stateFilter = req.query.get("state");
  const rateFilter = req.query.get("frameRate");
  const sort = req.query.get("sort") ?? "dueDate";
  const cursor = req.query.get("cursor");
  const limit = Math.min(25, Number(req.query.get("limit") ?? "25") || 25);
  const conditions = ["j.desk_id = $1", "j.state <> 'archived'"];
  const params: (string | number)[] = [deskId];
  if (clientFilter !== null && clientFilter !== "") {
    params.push(clientFilter);
    conditions.push(`j.client_id = $${params.length}`);
  }
  if (stateFilter === "archived") {
    conditions[1] = "j.state = 'archived'";
  } else if (stateFilter !== null && stateFilter !== "") {
    params.push(stateFilter);
    conditions.push(`j.state = $${params.length}`);
  }
  if (rateFilter !== null && rateFilter !== "") {
    params.push(rateFilter);
    conditions.push(`j.frame_rate = $${params.length}`);
  }
  const sortKey = sort === "title" ? "fold_lower(j.title), j.id" : "j.due_date, fold_lower(j.title), j.id";
  const where = conditions.join(" and ");
  const totalRow = await db.one(`select count(*) as n from jobs j where ${where}`, params);
  let query = `select j.id, j.client_id, c.name as client_name, j.title, j.ad_id, j.due_date, j.target_seconds, j.frame_rate, j.aspect, j.state, j.created_at from jobs j join clients c on c.id = j.client_id where ${where}`;
  const cursorRow = cursor === null ? null : await db.one("select id from jobs where id = $1 and desk_id = $2", [cursor, deskId]);
  if (cursorRow !== null) {
    query += ` and (${sortKey}) > (select ${sortKey === "fold_lower(j.title), j.id" ? "fold_lower(title), id" : "due_date, fold_lower(title), id"} from jobs where id = '${cursor}')`;
  }
  query += ` order by ${sortKey} limit ${limit + 1}`;
  const rows = await db.many(query, params);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return jsonResponse(200, {
    jobs: page.map(jobView),
    total: Number(totalRow!.n),
    nextCursor: hasMore && page.length > 0 ? String(page[page.length - 1]!.id) : null,
  });
});

route("POST", "/api/jobs", async (req, _store, db) => {
  const body = jsonOf(req);
  const clientId = strOf(body, "clientId");
  const title = strOf(body, "title");
  const adId = strOf(body, "adId");
  const dueDate = strOf(body, "dueDate");
  const targetSeconds = numOf(body, "targetSeconds");
  const frameRate = strOf(body, "frameRate");
  const aspect = strOf(body, "aspect");
  if (title === null || title.trim().length === 0) {
    throw new HttpError(422, "title", COPY.typeATitle, { title: COPY.typeATitle });
  }
  if (adId === null || board.adIdProblem(adId) !== null) {
    const message = board.adIdProblem(adId ?? "") ?? ARTIST_COPY.adIdShape;
    throw new HttpError(422, "adId", message, { adId: message });
  }
  if (dueDate === null || dateOfText(dueDate) === null) {
    throw new HttpError(422, "dueDate", COPY.typeADate, { dueDate: COPY.typeADate });
  }
  if (targetSeconds === null || !TARGET_SECONDS.includes(targetSeconds as never)) {
    throw new HttpError(422, "targetSeconds", "Pick a target length from the list.", {
      targetSeconds: "Pick a target length from the list.",
    });
  }
  if (frameRate === null || !isFrameRate(frameRate)) {
    throw new HttpError(422, "frameRate", "Pick a frame rate from the list.", {
      frameRate: "Pick a frame rate from the list.",
    });
  }
  if (aspect === null || !ASPECTS.includes(aspect as never)) {
    throw new HttpError(422, "aspect", "Pick an aspect from the list.", { aspect: "Pick an aspect from the list." });
  }
  const client = await clientOfDesk(db, req.session!.deskId, clientId ?? "");
  if (String(client.state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const id = newId();
  await db.query(
    "insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds, frame_rate, aspect, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [id, req.session!.deskId, client.id, title.trim(), adId, dueDate, targetSeconds, frameRate, aspect, "draft", String(now())],
  );
  await db.query("insert into board_stamps (job_id, stamp, frame_rate) values ($1, $2, $3)", [
    id,
    newToken(),
    frameRate,
  ]);
  const row = await jobRow(db, id);
  await addHistory(db, id, "jobCreated", String((await deskRow(db, req)).name), `Job created.`);
  return jsonResponse(201, jobView(row));
});

const TARGET_SECONDS = [6, 15, 30, 60];
const ASPECTS = ["16:9", "1:1", "9:16"];

async function jobRow(db: Db, jobId: string): Promise<Record<string, unknown>> {
  const row = await db.one(
    "select j.id, j.client_id, c.name as client_name, j.title, j.ad_id, j.due_date, j.target_seconds, j.frame_rate, j.aspect, j.state, j.created_at from jobs j join clients c on c.id = j.client_id where j.id = $1",
    [jobId],
  );
  if (row === null) throw new HttpError(404, "unknownJob", "There is nothing at this address.");
  return row;
}

async function jobOfDesk(db: Db, deskId: string, jobId: string): Promise<Record<string, unknown>> {
  const row = await db.one(
    "select j.*, c.state as client_state from jobs j join clients c on c.id = j.client_id where j.id = $1 and j.desk_id = $2",
    [jobId, deskId],
  );
  if (row === null || String(row.client_state) === "erased") {
    throw new HttpError(404, "unknownJob", "There is nothing at this address.");
  }
  return row;
}

route("GET", "/api/jobs/:id", async (req, _store, db) => {
  const row = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  return jsonResponse(200, jobView(row));
});

route("PATCH", "/api/jobs/:id", async (req, _store, db) => {
  const row = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(row.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const body = jsonOf(req);
  const title = strOf(body, "title") ?? String(row.title);
  const adId = strOf(body, "adId") ?? String(row.ad_id);
  const dueDate = strOf(body, "dueDate") ?? String(row.due_date);
  const targetSeconds = numOf(body, "targetSeconds") ?? Number(row.target_seconds);
  if (board.adIdProblem(adId) !== null) {
    const message = board.adIdProblem(adId) ?? ARTIST_COPY.adIdShape;
    throw new HttpError(422, "adId", message, { adId: message });
  }
  if (dateOfText(dueDate) === null) {
    throw new HttpError(422, "dueDate", COPY.typeADate, { dueDate: COPY.typeADate });
  }
  if (!TARGET_SECONDS.includes(targetSeconds as never)) {
    throw new HttpError(422, "targetSeconds", "Pick a target length from the list.", {
      targetSeconds: "Pick a target length from the list.",
    });
  }
  await db.query("update jobs set title = $1, ad_id = $2, due_date = $3, target_seconds = $4 where id = $5", [
    title,
    adId,
    dueDate,
    targetSeconds,
    row.id,
  ]);
  const after = await jobRow(db, String(row.id));
  await addHistory(db, String(row.id), "jobSaved", String((await deskRow(db, req)).name), "Job saved.");
  return jsonResponse(200, jobView(after));
});

route("POST", "/api/jobs/:id/duplicate", async (req, _store, db) => {
  const row = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const id = newId();
  await db.query(
    "insert into jobs (id, desk_id, client_id, title, ad_id, due_date, target_seconds, frame_rate, aspect, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [
      id,
      req.session!.deskId,
      String(row.client_id),
      `${String(row.title)} copy`,
      String(row.ad_id),
      String(row.due_date),
      Number(row.target_seconds),
      String(row.frame_rate),
      String(row.aspect),
      "draft",
      String(now()),
    ],
  );
  await db.query("insert into board_stamps (job_id, stamp, frame_rate) values ($1, $2, $3)", [
    id,
    newToken(),
    String(row.frame_rate),
  ]);
  const frames = await db.many("select * from frames where job_id = $1 order by position", [String(row.id)]);
  let position = 1;
  for (const frame of frames) {
    await db.query(
      "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [
        newId(),
        id,
        Number(frame.number),
        position,
        Number(frame.duration_frames),
        String(frame.action_note),
        String(frame.audio_note),
        String(frame.shot),
        String(frame.visual),
        frame.file_name === null ? null : String(frame.file_name),
        frame.width === null ? null : Number(frame.width),
        frame.height === null ? null : Number(frame.height),
        frame.sha256 === null ? null : String(frame.sha256),
        Boolean(frame.seeded),
        String(now()),
      ],
    );
    position++;
  }
  const after = await jobRow(db, id);
  await addHistory(db, id, "jobDuplicated", String((await deskRow(db, req)).name), "Job duplicated.");
  return jsonResponse(201, jobView(after));
});

route("POST", "/api/jobs/:id/archive", async (req, _store, db) => {
  const row = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  await db.query("update jobs set state = 'archived' where id = $1", [row.id]);
  const after = await jobRow(db, String(row.id));
  await addHistory(db, String(row.id), "jobArchived", String((await deskRow(db, req)).name), "Job archived.");
  return jsonResponse(200, jobView(after));
});

// Search matches job titles, client names and the names of a client's
// producers anywhere in the name, by the folding table, and keeps to the desk.
route("GET", "/api/search", async (req, _store, db) => {
  const q = searchOf(req.query.get("q"));
  if (q === null) {
    return jsonResponse(200, { jobs: [], clients: [], producers: [], total: 0 });
  }
  const needle = foldForCompare(q);
  const deskId = req.session!.deskId;
  const jobs = await db.many(
    "select j.id, j.title from jobs j join clients c on c.id = j.client_id where j.desk_id = $1 and j.state <> 'archived' and c.state in ('active','closing','erasing')",
    [deskId],
  );
  const clients = await db.many(
    "select id, name from clients where desk_id = $1 and state in ('active','closing','erasing')",
    [deskId],
  );
  const producers = await db.many(
    "select p.id, p.name, p.client_id from producers p join clients c on c.id = p.client_id where c.desk_id = $1 and c.state in ('active','closing','erasing')",
    [deskId],
  );
  const matchedJobs = jobs.filter((j) => foldForCompare(String(j.title)).includes(needle));
  const matchedClients = clients.filter((c) => foldForCompare(String(c.name)).includes(needle));
  const matchedProducers = producers.filter((p) => foldForCompare(String(p.name)).includes(needle));
  return jsonResponse(200, {
    jobs: matchedJobs.map((j) => ({ id: String(j.id), title: String(j.title) })),
    clients: matchedClients.map((c) => ({ id: String(c.id), name: String(c.name) })),
    producers: matchedProducers.map((p) => ({
      id: String(p.id),
      name: String(p.name),
      clientId: String(p.client_id),
    })),
    total: matchedJobs.length + matchedClients.length + matchedProducers.length,
  });
});

route("GET", "/api/jobs/:id/history", async (req, _store, db) => {
  await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const events = await db.many(
    "select at, actor, action, text from job_history where job_id = $1 order by at, id",
    [req.params.id!],
  );
  return jsonResponse(200, {
    events: events.map((e) => ({
      at: instantText(Number(e.at)),
      actor: String(e.actor),
      action: String(e.action),
      text: String(e.text),
    })),
  });
});

async function addHistory(db: Db, jobId: string, action: string, actor: string, text: string): Promise<void> {
  await db.query(
    "insert into job_history (id, job_id, at, actor, action, text) values ($1, $2, $3, $4, $5, $6)",
    [newId(), jobId, String(now()), actor, action, text],
  );
}

// ---------------------------------------------------------------------------
// Board, frames and script
// ---------------------------------------------------------------------------

route("GET", "/api/jobs/:id/board", async (req, _store, db) => {
  await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const view = await board.loadBoard(db, req.params.id!);
  if (view === null) throw new HttpError(404, "unknownJob", "There is nothing at this address.");
  return jsonResponse(200, view as unknown as Json);
});

route("POST", "/api/jobs/:id/frames", async (req, store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupportedType", "Send the file as multipart form data.");
  }
  const parts = parseMultipart(req.body, contentType);
  const file = findFile(parts, "file");
  if (file === null) {
    throw new HttpError(422, "file", "Choose a file to upload.", { file: "Choose a file to upload." });
  }
  // Judged in order: size, content, aspect, repeat. The size is counted on
  // the file alone, never on the multipart body.
  if (file.data.length > FRAME_FILE_LIMIT) {
    throw new HttpError(413, "tooLarge", ARTIST_COPY.uploadTooBig);
  }
  const image = readImage(file.data);
  if (image === null) {
    throw new HttpError(422, "file", ARTIST_COPY.uploadNotImage, { file: ARTIST_COPY.uploadNotImage });
  }
  const [w, h] = image;
  const aspect = String(job.aspect);
  if (!aspectMatches(w, h, aspect)) {
    const message = ARTIST_COPY.uploadAspect(w, h, aspect);
    throw new HttpError(422, "file", message, { file: message });
  }
  const sha = sha256Hex(file.data);
  const repeat = await db.one(
    "select number from frames where job_id = $1 and sha256 = $2",
    [String(job.id), sha],
  );
  if (repeat !== null) {
    const message = ARTIST_COPY.uploadDuplicate(Number(repeat.number));
    throw new HttpError(422, "file", message, { file: message });
  }
  const stored = await store.put(objectKey(String(job.client_id), String(job.id), `frames/${sha}`), file.data, imageMimeOf(file.data));
  if (!stored.ok) {
    throw new HttpError(503, "storeUnavailable", ARTIST_COPY.storeUnavailable);
  }
  // Stored shows only after the store has confirmed.
  const empty = await db.one(
    "select id, number from frames where job_id = $1 and sha256 is null order by number limit 1",
    [String(job.id)],
  );
  let frameNumber: number;
  if (empty !== null) {
    frameNumber = Number(empty.number);
    await db.query(
      "update frames set duration_frames = $1, file_name = $2, width = $3, height = $4, sha256 = $5, seeded = false where id = $6",
      [nominalFrames(rate(job)), file.filename, w, h, sha, String(empty.id)],
    );
  } else {
    const next = await nextFrameNumber(db, String(job.id));
    frameNumber = next;
    await db.query(
      "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [newId(), String(job.id), next, await nextPosition(db, String(job.id)), nominalFrames(rate(job)), "", "", "", "", file.filename, w, h, sha, false, String(now())],
    );
  }
  await board.newBoardStamp(db, String(job.id));
  const view = await board.loadBoard(db, String(job.id));
  return jsonResponse(201, { frame: view!.frames.find((f) => f.number === frameNumber)!, stamp: view!.stamp });
});

function rate(job: Record<string, unknown>): FrameRate {
  const r = String(job.frame_rate);
  return isFrameRate(r) ? r : "25";
}

function objectKey(clientId: string, jobId: string, rest: string): string {
  return `clients/${clientId}/jobs/${jobId}/${rest}`;
}

async function nextFrameNumber(db: Db, jobId: string): Promise<number> {
  const row = await db.one("select max(number) as n from frames where job_id = $1", [jobId]);
  return row === null || row.n === null ? 1 : Number(row.n) + 1;
}

async function nextPosition(db: Db, jobId: string): Promise<number> {
  const row = await db.one("select max(position) as n from frames where job_id = $1", [jobId]);
  return row === null || row.n === null ? 1 : Number(row.n) + 1;
}

// Content is judged from the file's own header bytes, never its name or
// declared type.
function readImage(data: Buffer): [number, number] | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    const w = data.readUInt32BE(16);
    const h = data.readUInt32BE(20);
    return [w, h];
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) {
        at++;
        continue;
      }
      const marker = data[at + 1]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = data.readUInt16BE(at + 5);
        const w = data.readUInt16BE(at + 7);
        return [w, h];
      }
      const len = data.readUInt16BE(at + 2);
      at += 2 + len;
    }
  }
  return null;
}

function imageMimeOf(data: Buffer): string {
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50) return "image/png";
  return "image/jpeg";
}

function aspectMatches(w: number, h: number, aspect: string): boolean {
  switch (aspect) {
    case "16:9":
      return w * 9 === h * 16;
    case "1:1":
      return w === h;
    case "9:16":
      return w * 16 === h * 9;
    default:
      return false;
  }
}

route("PATCH", "/api/jobs/:id/frames/:number", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp === null) {
    throw new HttpError(422, "stamp", "This board changed in another window. Reload it.", { stamp: "Reload the board." });
  }
  const row = await db.one("select * from frames where job_id = $1 and number = $2", [
    String(job.id),
    Number(req.params.number),
  ]);
  if (row === null) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  await board.requireStamp(db, String(job.id), stamp);
  const duration = numOf(body, "durationFrames");
  if (duration !== undefined && duration !== null) {
    if (!Number.isInteger(duration) || duration < 1) {
      throw new HttpError(422, "durationFrames", "A clip is at least 1 frame.", {
        durationFrames: "A clip is at least 1 frame.",
      });
    }
  }
  const actionNote = strOf(body, "actionNote") ?? String(row.action_note);
  await db.query(
    "update frames set duration_frames = $1, action_note = $2 where id = $3",
    [duration ?? Number(row.duration_frames), actionNote, String(row.id)],
  );
  await board.newBoardStamp(db, String(job.id));
  const view = await board.loadBoard(db, String(job.id));
  return jsonResponse(200, view as unknown as Json);
});

route("GET", "/api/jobs/:id/frames/:number/drawing", async (req, store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const row = await db.one("select * from frames where job_id = $1 and number = $2", [
    String(job.id),
    Number(req.params.number),
  ]);
  if (row === null || row.sha256 === null) {
    // A seeded frame's drawing is a generated SVG made when read, never kept
    // in the store.
    if (row !== null && Boolean(row.seeded)) {
      return textResponse(200, "image/svg+xml", seededDrawing(Number(row.number), String(row.action_note)).toString("utf8"));
    }
    throw new HttpError(404, "noDrawing", "There is nothing at this address.");
  }
  const data = await store.get(objectKey(String(job.client_id), String(job.id), `frames/${String(row.sha256)}`));
  if (data === null) throw new HttpError(404, "noDrawing", "There is nothing at this address.");
  return bytesResponse(200, imageMimeOf(data), data);
});

route("POST", "/api/jobs/:id/frames/:number/move", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  const position = numOf(body, "position");
  if (stamp === null || position === null || !Number.isInteger(position) || position < 1) {
    throw new HttpError(422, "position", "Pick a position on the board.", { position: "Pick a position on the board." });
  }
  await board.requireStamp(db, String(job.id), stamp);
  const frames = await db.many("select id, number, position from frames where job_id = $1 order by position", [String(job.id)]);
  if (position > frames.length) {
    throw new HttpError(422, "position", "Pick a position on the board.", { position: "Pick a position on the board." });
  }
  const moving = frames.find((f) => Number(f.number) === Number(req.params.number));
  if (moving === undefined) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  const order = frames.filter((f) => String(f.id) !== String(moving.id));
  order.splice(position - 1, 0, moving);
  let at = 1;
  for (const frame of order) {
    await db.query("update frames set position = $1 where id = $2", [at, String(frame.id)]);
    at++;
  }
  await board.newBoardStamp(db, String(job.id));
  const view = await board.loadBoard(db, String(job.id));
  return jsonResponse(200, view as unknown as Json);
});

route("POST", "/api/jobs/:id/frames/:number/duplicate", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp === null) {
    throw new HttpError(422, "stamp", "Reload the board.", { stamp: "Reload the board." });
  }
  await board.requireStamp(db, String(job.id), stamp);
  const row = await db.one("select * from frames where job_id = $1 and number = $2", [
    String(job.id),
    Number(req.params.number),
  ]);
  if (row === null) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  const number = await nextFrameNumber(db, String(job.id));
  const position = await nextPosition(db, String(job.id));
  await db.query(
    "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    [
      newId(),
      String(job.id),
      number,
      position,
      Number(row.duration_frames),
      String(row.action_note),
      String(row.audio_note),
      String(row.shot),
      String(row.visual),
      row.file_name === null ? null : String(row.file_name),
      row.width === null ? null : Number(row.width),
      row.height === null ? null : Number(row.height),
      row.sha256 === null ? null : String(row.sha256),
      Boolean(row.seeded),
      String(now()),
    ],
  );
  await board.newBoardStamp(db, String(job.id));
  const view = await board.loadBoard(db, String(job.id));
  return jsonResponse(201, view as unknown as Json);
});

route("POST", "/api/jobs/:id/frames/:number/insert-after", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp === null) {
    throw new HttpError(422, "stamp", "Reload the board.", { stamp: "Reload the board." });
  }
  await board.requireStamp(db, String(job.id), stamp);
  const row = await db.one("select * from frames where job_id = $1 and number = $2", [
    String(job.id),
    Number(req.params.number),
  ]);
  if (row === null) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  const after = Number(row.position);
  const frames = await db.many("select id from frames where job_id = $1 order by position", [String(job.id)]);
  let at = 1;
  for (const frame of frames) {
    if (at === after + 1) {
      const number = await nextFrameNumber(db, String(job.id));
      await db.query(
        "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        [newId(), String(job.id), number, at, nominalFrames(rate(job)), "", "", "", "", null, null, null, null, false, String(now())],
      );
    }
    await db.query("update frames set position = $1 where id = $2", [at, String(frame.id)]);
    at++;
  }
  await board.newBoardStamp(db, String(job.id));
  const view = await board.loadBoard(db, String(job.id));
  return jsonResponse(201, view as unknown as Json);
});

// Removing opens an Undo window the server ends.
route("POST", "/api/jobs/:id/removals", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  const frameNumber = numOf(body, "frame");
  if (stamp === null || frameNumber === null) {
    throw new HttpError(422, "frame", "Pick a frame on the board.", { frame: "Pick a frame on the board." });
  }
  await board.requireStamp(db, String(job.id), stamp);
  const row = await db.one("select * from frames where job_id = $1 and number = $2", [String(job.id), frameNumber]);
  if (row === null) {
    throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  }
  const endsAt = now() + req.config.timers.undoSeconds;
  await db.query(
    "insert into removals (job_id, frame, frame_id, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, ends_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
    [
      String(job.id),
      frameNumber,
      String(row.id),
      Number(row.position),
      Number(row.duration_frames),
      String(row.action_note),
      String(row.audio_note),
      String(row.shot),
      String(row.visual),
      row.file_name === null ? null : String(row.file_name),
      row.width === null ? null : Number(row.width),
      row.height === null ? null : Number(row.height),
      row.sha256 === null ? null : String(row.sha256),
      Boolean(row.seeded),
      String(endsAt),
    ],
  );
  await db.query("delete from frames where id = $1", [String(row.id)]);
  const rest = await db.many("select id from frames where job_id = $1 order by position", [String(job.id)]);
  let at = 1;
  for (const frame of rest) {
    await db.query("update frames set position = $1 where id = $2", [at, String(frame.id)]);
    at++;
  }
  await board.newBoardStamp(db, String(job.id));
  return jsonResponse(201, {
    frame: frameNumber,
    position: Number(row.position),
    endsAt: instantText(endsAt),
    stamp: (await board.loadBoard(db, String(job.id)))!.stamp,
  });
});

route("GET", "/api/jobs/:id/removals", async (req, _store, db) => {
  await jobOfDesk(db, req.session!.deskId, req.params.id!);
  await reapRemovals(db, req.params.id!);
  const rows = await db.many(
    "select frame, position, ends_at from removals where job_id = $1 and ends_at > $2",
    [req.params.id!, String(now())],
  );
  return jsonResponse(200, {
    removals: rows.map((r) => ({
      frame: Number(r.frame),
      position: Number(r.position),
      endsAt: instantText(Number(r.ends_at)),
    })),
  });
});

route("POST", "/api/jobs/:id/removals/:number/hold", async (req, _store, db) => {
  await jobOfDesk(db, req.session!.deskId, req.params.id!);
  await reapRemovals(db, req.params.id!);
  const row = await db.one("select * from removals where job_id = $1 and frame = $2", [
    req.params.id!,
    Number(req.params.number),
  ]);
  if (row === null) {
    throw new HttpError(409, "undoPassed", ARTIST_COPY.undoPassed);
  }
  const endsAt = now() + req.config.timers.undoSeconds;
  await db.query("update removals set ends_at = $1 where job_id = $2 and frame = $3", [
    String(endsAt),
    req.params.id!,
    Number(req.params.number),
  ]);
  return jsonResponse(200, { frame: Number(row.frame), position: Number(row.position), endsAt: instantText(endsAt) });
});

route("POST", "/api/jobs/:id/removals/:number/undo", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  await reapRemovals(db, req.params.id!);
  const row = await db.one("select * from removals where job_id = $1 and frame = $2", [
    req.params.id!,
    Number(req.params.number),
  ]);
  if (row === null) {
    throw new HttpError(409, "undoPassed", ARTIST_COPY.undoPassed);
  }
  const frames = await db.many("select id, position from frames where job_id = $1 order by position", [String(job.id)]);
  const target = Number(row.position);
  const order: Record<string, unknown>[] = [];
  let placed = false;
  for (const frame of frames) {
    if (!placed && Number(frame.position) >= target) {
      order.push(row);
      placed = true;
    }
    order.push(frame);
  }
  if (!placed) order.push(row);
  let at = 1;
  for (const frame of order) {
    if (frame === row) {
      await db.query(
        "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        [
          String(row.frame_id),
          String(job.id),
          Number(row.frame),
          at,
          Number(row.duration_frames),
          String(row.action_note),
          String(row.audio_note),
          String(row.shot),
          String(row.visual),
          row.file_name === null ? null : String(row.file_name),
          row.width === null ? null : Number(row.width),
          row.height === null ? null : Number(row.height),
          row.sha256 === null ? null : String(row.sha256),
          Boolean(row.seeded),
          String(now()),
        ],
      );
    } else {
      await db.query("update frames set position = $1 where id = $2", [at, String(frame.id)]);
    }
    at++;
  }
  await db.query("delete from removals where job_id = $1 and frame = $2", [String(job.id), Number(row.frame)]);
  await board.newBoardStamp(db, String(job.id));
  const view = await board.loadBoard(db, String(job.id));
  return jsonResponse(200, view as unknown as Json);
});

async function reapRemovals(db: Db, jobId: string): Promise<void> {
  await db.query("delete from removals where job_id = $1 and ends_at <= $2", [jobId, String(now())]);
}

route("POST", "/api/jobs/:id/frame-rate", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  const next = strOf(body, "frameRate");
  const playhead = numOf(body, "playhead");
  if (stamp === null || next === null || !isFrameRate(next) || playhead === null) {
    throw new HttpError(422, "frameRate", "Pick a frame rate from the list.", {
      frameRate: "Pick a frame rate from the list.",
    });
  }
  await board.requireStamp(db, String(job.id), stamp);
  const from = rate(job);
  const frames = await db.many("select id, duration_frames from frames where job_id = $1 order by position", [String(job.id)]);
  for (const frame of frames) {
    const converted = convertFrames(Number(frame.duration_frames), from, next);
    await db.query("update frames set duration_frames = $1 where id = $2", [converted, String(frame.id)]);
  }
  await db.query("update board_stamps set frame_rate = $1 where job_id = $2", [next, String(job.id)]);
  await db.query("update jobs set frame_rate = $1 where id = $2", [next, String(job.id)]);
  await board.newBoardStamp(db, String(job.id));
  const view = await board.loadBoard(db, String(job.id));
  const total = view!.totalFrames;
  const newPlayhead = Math.min(playhead, Math.max(0, total - 1));
  return jsonResponse(200, { ...(view as unknown as Json), playhead: newPlayhead });
});

// A script file: UTF-8 with or without a byte order mark, LF or CRLF,
// comma separated with double-quoted fields, header `shot,visual,audio,seconds`.
route("POST", "/api/jobs/:id/script/preview", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupportedType", "Send the file as multipart form data.");
  }
  const parts = parseMultipart(req.body, contentType);
  const file = findFile(parts, "file");
  if (file === null) {
    throw new HttpError(422, "file", "Choose a file to read.", { file: "Choose a file to read." });
  }
  if (file.data.length > FRAME_FILE_LIMIT) {
    throw new HttpError(413, "tooLarge", "This file is over 8,000,000 bytes.");
  }
  const parsed = parseScriptFile(file.data);
  if (parsed === null) {
    throw new HttpError(422, "file", ARTIST_COPY.scriptNotUtf8, { file: ARTIST_COPY.scriptNotUtf8 });
  }
  if (!parsed.headerOk) {
    throw new HttpError(422, "file", ARTIST_COPY.scriptHeader, { file: ARTIST_COPY.scriptHeader });
  }
  const rows = await scriptRows(db, String(job.id), parsed.rows);
  return jsonResponse(200, { rows });
});

route("POST", "/api/jobs/:id/script", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupportedType", "Send the file as multipart form data.");
  }
  const parts = parseMultipart(req.body, contentType);
  const file = findFile(parts, "file");
  if (file === null) {
    throw new HttpError(422, "file", "Choose a file to read.", { file: "Choose a file to read." });
  }
  if (file.data.length > FRAME_FILE_LIMIT) {
    throw new HttpError(413, "tooLarge", "This file is over 8,000,000 bytes.");
  }
  const parsed = parseScriptFile(file.data);
  if (parsed === null) {
    throw new HttpError(422, "file", ARTIST_COPY.scriptNotUtf8, { file: ARTIST_COPY.scriptNotUtf8 });
  }
  if (!parsed.headerOk) {
    throw new HttpError(422, "file", ARTIST_COPY.scriptHeader, { file: ARTIST_COPY.scriptHeader });
  }
  const rows = await scriptRows(db, String(job.id), parsed.rows);
  const frameRate = rate(job);
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const refused = rows.filter((r) => r.result === "refused").length;
  for (const row of rows) {
    if (row.result === "new") {
      const number = await nextFrameNumber(db, String(job.id));
      const duration = secondsToFrames(parsed.rows[row.row - 2]!.seconds, frameRate);
      await db.query(
        "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        [
          newId(),
          String(job.id),
          number,
          await nextPosition(db, String(job.id)),
          duration,
          parsed.rows[row.row - 2]!.visual,
          parsed.rows[row.row - 2]!.audio,
          parsed.rows[row.row - 2]!.shot,
          parsed.rows[row.row - 2]!.visual,
          null,
          null,
          null,
          null,
          false,
          String(now()),
        ],
      );
      created++;
    } else if (row.result === "matched") {
      const existing = await db.one("select * from frames where job_id = $1 and shot = $2", [
        String(job.id),
        parsed.rows[row.row - 2]!.shot,
      ]);
      if (existing !== null) {
        const duration = secondsToFrames(parsed.rows[row.row - 2]!.seconds, frameRate);
        if (
          Number(existing.duration_frames) !== duration ||
          String(existing.action_note) !== parsed.rows[row.row - 2]!.visual ||
          String(existing.audio_note) !== parsed.rows[row.row - 2]!.audio
        ) {
          await db.query("update frames set duration_frames = $1, action_note = $2, audio_note = $3, visual = $4 where id = $5", [
            duration,
            parsed.rows[row.row - 2]!.visual,
            parsed.rows[row.row - 2]!.audio,
            parsed.rows[row.row - 2]!.visual,
            String(existing.id),
          ]);
          updated++;
        } else {
          unchanged++;
        }
      }
    }
  }
  if (created + updated > 0) {
    await board.newBoardStamp(db, String(job.id));
  }
  return jsonResponse(200, { created, updated, unchanged, refused, rows });
});

type ScriptRow = { shot: string; visual: string; audio: string; seconds: string };

function parseScriptFile(data: Buffer): { headerOk: boolean; rows: ScriptRow[] } | null {
  let text: string;
  try {
    if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
      text = data.subarray(3).toString("utf8");
    } else {
      text = data.toString("utf8");
    }
  } catch {
    return null;
  }
  if (text.includes("\u0000")) return null;
  const rows = parseCsv(text);
  if (rows.length === 0) return { headerOk: false, rows: [] };
  const header = rows[0]!;
  const headerOk =
    header.length === 4 && header[0] === "shot" && header[1] === "visual" && header[2] === "audio" && header[3] === "seconds";
  return {
    headerOk,
    rows: rows.slice(1).map((r) => ({ shot: r[0] ?? "", visual: r[1] ?? "", audio: r[2] ?? "", seconds: r[3] ?? "" })),
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < s.length) {
    const ch = s[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""));
}

// Rows match on shot; a refused row never blocks the others, and a later row
// repeating a shot is refused. Script text is stored exactly as written.
async function scriptRows(
  db: Db,
  jobId: string,
  rows: ScriptRow[],
): Promise<{ row: number; shot: string; result: string; reason: string | null }[]> {
  const existing = await db.many("select shot, number from frames where job_id = $1", [jobId]);
  const byShot = new Map(existing.map((e) => [String(e.shot), Number(e.number)]));
  const seen = new Map<string, number>();
  const out: { row: number; shot: string; result: string; reason: string | null }[] = [];
  let rowNumber = 2;
  for (const row of rows) {
    if (row.shot.trim().length === 0) {
      out.push({ row: rowNumber, shot: row.shot, result: "refused", reason: ARTIST_COPY.scriptRowShot(rowNumber) });
    } else if (seen.has(row.shot)) {
      out.push({
        row: rowNumber,
        shot: row.shot,
        result: "refused",
        reason: ARTIST_COPY.scriptRowDuplicate(rowNumber, row.shot, seen.get(row.shot)!),
      });
    } else if (parsePositiveDecimal(row.seconds, null) === null) {
      out.push({
        row: rowNumber,
        shot: row.shot,
        result: "refused",
        reason: ARTIST_COPY.scriptRowSeconds(rowNumber),
      });
    } else if (byShot.has(row.shot)) {
      seen.set(row.shot, rowNumber);
      out.push({ row: rowNumber, shot: row.shot, result: "matched", reason: null });
    } else {
      seen.set(row.shot, rowNumber);
      out.push({ row: rowNumber, shot: row.shot, result: "new", reason: null });
    }
    rowNumber++;
  }
  return out;
}

export { routes, route, jsonResponse, emptyResponse, HttpError, seededDrawing, jobView, jobOfDesk, jobRow, addHistory, deskRow, deskOf };

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

// The safe area is judged before reading time, and both answer 422.
function lineProblems(
  x: number,
  y: number,
  width: number,
  height: number,
  clips: number,
  text: string,
  frameRate: FrameRate,
  framePosition: number,
  totalFrames: number,
): string | null {
  if (text.trim().length === 0) {
    return ARTIST_COPY.lineEmpty;
  }
  const left = 5 - x;
  const top = 5 - y;
  const right = x + width - 95;
  const bottom = y + height - 95;
  const worst = Math.max(left, top, right, bottom);
  if (worst > 0) {
    // Half up to one decimal, exact: x 1.5 is 3.5 outside.
    const scaled = BigInt(Math.round(worst * 10)) * 10n;
    return ARTIST_COPY.lineOutside(`${scaled / 100n}.${((scaled % 100n) / 10n).toString()}`);
  }
  const words = text.trim().split(/\s+/).length;
  const needRat = Rat.of(BigInt(words), 3n).mul(shared.RATE_RAT[frameRate]);
  const need = Number(needRat.roundHalfUp());
  const startFrame = framePosition - 1;
  const framesAvailable = Math.max(0, totalFrames - startFrame);
  if (need > framesAvailable) {
    return ARTIST_COPY.lineReading(need, framesAvailable);
  }
  void clips;
  return null;
}

route("GET", "/api/jobs/:id/lines", async (req, _store, db) => {
  await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const market = req.query.get("market");
  const rows = await db.many("select * from lines where job_id = $1", [req.params.id!]);
  const filtered = market === null ? rows : rows.filter((r) => String(r.market) === market);
  return jsonResponse(200, { lines: filtered.map(lineView) });
});

function lineView(row: Record<string, unknown>): Json {
  return {
    id: String(row.id),
    frame: Number(row.frame),
    market: String(row.market),
    text: String(row.text),
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    clips: Number(row.clips),
  };
}

route("POST", "/api/jobs/:id/lines", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const body = jsonOf(req);
  const frame = numOf(body, "frame");
  const market = strOf(body, "market");
  const text = strOf(body, "text");
  const x = numOf(body, "x");
  const y = numOf(body, "y");
  const width = numOf(body, "width");
  const height = numOf(body, "height");
  const clips = numOf(body, "clips") ?? 1;
  if (frame === null || market === null || text === null || x === null || y === null || width === null || height === null) {
    throw new HttpError(422, "shape", "Type the line's text.", { text: ARTIST_COPY.lineEmpty });
  }
  if (!MARKETS.includes(market as never)) {
    throw new HttpError(422, "market", "Pick a market from the list.", { market: "Pick a market from the list." });
  }
  const frameRow = await db.one("select position from frames where job_id = $1 and number = $2", [String(job.id), frame]);
  if (frameRow === null) {
    throw new HttpError(422, "frame", "Pick a frame from the board.", { frame: "Pick a frame from the board." });
  }
  const view = await board.loadBoard(db, String(job.id));
  const problem = lineProblems(x, y, width, height, clips, text, rate(job), Number(frameRow.position), view!.totalFrames);
  if (problem !== null) {
    throw new HttpError(422, "line", problem, { line: problem });
  }
  const id = newId();
  await db.query(
    "insert into lines (id, job_id, frame, market, text, x, y, width, height, clips) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [id, String(job.id), frame, market, text, String(x), String(y), String(width), String(height), clips],
  );
  const after = await db.one("select * from lines where id = $1", [id]);
  return jsonResponse(201, lineView(after!));
});

route("PATCH", "/api/lines/:id", async (req, _store, db) => {
  const row = await lineOfDesk(db, req.session!.deskId, req.params.id!);
  const job = await jobRow(db, String(row.job_id));
  const body = jsonOf(req);
  const frame = numOf(body, "frame") ?? Number(row.frame);
  const market = strOf(body, "market") ?? String(row.market);
  const text = strOf(body, "text") ?? String(row.text);
  const x = numOf(body, "x") ?? Number(row.x);
  const y = numOf(body, "y") ?? Number(row.y);
  const width = numOf(body, "width") ?? Number(row.width);
  const height = numOf(body, "height") ?? Number(row.height);
  const clips = numOf(body, "clips") ?? Number(row.clips);
  const frameRow = await db.one("select position from frames where job_id = $1 and number = $2", [String(row.job_id), frame]);
  if (frameRow === null) {
    throw new HttpError(422, "frame", "Pick a frame from the board.", { frame: "Pick a frame from the board." });
  }
  const view = await board.loadBoard(db, String(row.job_id));
  const problem = lineProblems(x, y, width, height, clips, text, rate(job), Number(frameRow.position), view!.totalFrames);
  if (problem !== null) {
    throw new HttpError(422, "line", problem, { line: problem });
  }
  await db.query(
    "update lines set frame = $1, market = $2, text = $3, x = $4, y = $5, width = $6, height = $7, clips = $8 where id = $9",
    [frame, market, text, String(x), String(y), String(width), String(height), clips, String(row.id)],
  );
  const after = await db.one("select * from lines where id = $1", [String(row.id)]);
  return jsonResponse(200, lineView(after!));
});

route("DELETE", "/api/lines/:id", async (req, _store, db) => {
  const row = await lineOfDesk(db, req.session!.deskId, req.params.id!);
  await db.query("delete from lines where id = $1", [String(row.id)]);
  return emptyResponse(204);
});

async function lineOfDesk(db: Db, deskId: string, lineId: string): Promise<Record<string, unknown>> {
  const row = await db.one(
    "select l.* from lines l join jobs j on j.id = l.job_id where l.id = $1 and j.desk_id = $2",
    [lineId, deskId],
  );
  if (row === null) throw new HttpError(404, "unknownLine", "There is nothing at this address.");
  return row;
}

const MARKETS = ["en", "nl", "fr", "ar"];

// ---------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------

route("GET", "/api/cues/search", async (req, _store, db) => {
  const q = req.query.get("q");
  const cursor = req.query.get("cursor");
  if (q === null || q.trim().length === 0) {
    return jsonResponse(200, { tracks: [], nextCursor: null });
  }
  const cacheKey = `search:${q.trim()}:${cursor ?? ""}`;
  const cached = await cueCacheGet(db, cacheKey);
  if (cached !== null) {
    return jsonResponse(200, cached);
  }
  const hollowreed = new Hollowreed(req.config);
  try {
    const page = await hollowreed.searchTracks(q.trim(), cursor);
    const body = {
      tracks: page.tracks.map((t) => ({
        id: t.id,
        title: t.title,
        composer: t.composer,
        seconds: t.seconds,
      })),
      nextCursor: page.nextCursor,
    };
    await cueCacheSet(db, cacheKey, body);
    return jsonResponse(200, body);
  } catch (e) {
    if (e instanceof RateLimited) {
      throw new HttpError(429, "rateLimited", "The music library is busy right now.", null, {
        "Retry-After": String(e.retryAfterSeconds),
      });
    }
    throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
  }
});

async function cueCacheGet(db: Db, key: string): Promise<Json | null> {
  const row = await db.one("select at, value from cue_cache where key = $1", [key]);
  if (row === null) return null;
  if (Number(row.at) + 0 <= now()) return null;
  return JSON.parse(String(row.value)) as Json;
}

async function cueCacheSet(db: Db, key: string, value: Json): Promise<void> {
  void db;
  void key;
  void value;
}

route("GET", "/api/jobs/:id/cues", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const rows = await db.many("select * from cues where job_id = $1 order by from_date, id", [String(job.id)]);
  const at = now();
  return jsonResponse(200, {
    cues: rows.map((row) => ({
      id: String(row.id),
      trackId: String(row.track_id),
      title: String(row.title),
      composer: String(row.composer),
      seconds: Number(row.seconds),
      market: String(row.market),
      from: String(row.from_date),
      until: String(row.until_date),
      fee: Number(row.fee),
      licenceId: String(row.licence_id),
      licenceText: board.licenceTextOf(String(row.until_date), MARKET_TOWN[String(row.market) as "NL"], at),
    })),
  });
});

const MARKET_TOWN: Record<string, Town> = { NL: "amsterdam", US: "newYork", CA: "toronto", AE: "dubai" };

route("POST", "/api/jobs/:id/cues", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const body = jsonOf(req);
  const trackId = strOf(body, "trackId");
  const market = strOf(body, "market");
  const from = strOf(body, "from");
  const until = strOf(body, "until");
  if (trackId === null || market === null || from === null || until === null) {
    throw new HttpError(422, "shape", "Pick a track, a market and the licence window.", {
      market: "Pick a market from the list.",
    });
  }
  if (!LICENCE_MARKETS.includes(market as never)) {
    throw new HttpError(422, "market", "Pick a market from the list.", { market: "Pick a market from the list." });
  }
  if (dateOfText(from) === null || dateOfText(until) === null) {
    throw new HttpError(422, "window", COPY.typeADate, { from: COPY.typeADate, until: COPY.typeADate });
  }
  if (until < from) {
    throw new HttpError(422, "window", ARTIST_COPY.licenceOrder, { until: ARTIST_COPY.licenceOrder });
  }
  const hollowreed = new Hollowreed(req.config);
  // Adding a cue reads the prices every time; a new cue takes the newest
  // price row valid today. No row in effect counts as unavailable.
  let fee = "0.00";
  try {
    const prices = await hollowreed.prices();
    const today = wallDate("amsterdam", now());
    const inEffect = prices
      .filter((p) => p.validFrom <= today)
      .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
    if (inEffect.length === 0) {
      throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
    }
    fee = inEffect[0]!.perMarket;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
  }
  // The cue exists only after the library's 201.
  let licenceId: string;
  try {
    const licence = await hollowreed.buyLicence({ trackId, market, from, until, fee });
    licenceId = licence.licenceId;
  } catch (e) {
    if (e instanceof RateLimited) {
      throw new HttpError(429, "rateLimited", "The music library is busy right now.", null, {
        "Retry-After": String(e.retryAfterSeconds),
      });
    }
    throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
  }
  const track = await trackById(hollowreed, trackId);
  const id = newId();
  await db.query(
    "insert into cues (id, job_id, track_id, title, composer, seconds, market, from_date, until_date, fee, licence_id, licence_text) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [id, String(job.id), trackId, track.title, track.composer, track.seconds, market, from, until, fee, licenceId, `Licence ref ${licenceId}`],
  );
  const after = await db.one("select * from cues where id = $1", [id]);
  return jsonResponse(201, {
    id: String(after!.id),
    trackId: String(after!.track_id),
    title: String(after!.title),
    composer: String(after!.composer),
    seconds: Number(after!.seconds),
    market: String(after!.market),
    from: String(after!.from_date),
    until: String(after!.until_date),
    fee: Number(after!.fee),
    licenceId: String(after!.licence_id),
    licenceText: board.licenceTextOf(String(after!.until_date), MARKET_TOWN[String(after!.market) as "NL"], now()),
  });
});

async function trackById(hollowreed: Hollowreed, trackId: string): Promise<Track> {
  try {
    const page = await hollowreed.searchTracks("", null);
    const found = page.tracks.find((t) => t.id === trackId);
    if (found !== undefined) return found;
  } catch {
    throw new HttpError(503, "libraryUnavailable", ARTIST_COPY.libraryUnavailable);
  }
  throw new HttpError(422, "trackId", "Pick a track from the list.", { trackId: "Pick a track from the list." });
}

route("DELETE", "/api/jobs/:id/cues/:cueId", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const row = await db.one("select * from cues where id = $1 and job_id = $2", [req.params.cueId!, String(job.id)]);
  if (row === null) throw new HttpError(404, "unknownCue", "There is nothing at this address.");
  await db.query("delete from cues where id = $1", [String(row.id)]);
  return emptyResponse(204);
});

const LICENCE_MARKETS = ["NL", "US", "CA", "AE"];

// ---------------------------------------------------------------------------
// Cuts, compare and renders
// ---------------------------------------------------------------------------

route("GET", "/api/jobs/:id/cuts", async (req, _store, db) => {
  await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const rows = await db.many("select * from cuts where job_id = $1 order by number", [req.params.id!]);
  return jsonResponse(200, { cuts: rows.map(cutView) });
});

function cutView(row: Record<string, unknown>): Json {
  return {
    id: String(row.id),
    number: Number(row.number),
    name: String(row.name),
    frameRate: String(row.frame_rate),
    createdAt: instantText(Number(row.created_at)),
    signedOffAt: row.signed_off_at === null ? null : instantText(Number(row.signed_off_at)),
    signedOffBy: row.signed_off_by === null ? null : String(row.signed_off_by),
  };
}

// Make cut keeps the board exactly as `Cut <number>` with a name. Cuts number
// from 1 on each job, and a deleted cut's number is not reused.
route("POST", "/api/jobs/:id/cuts", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const name = strOf(body, "name") ?? "";
  if (name.trim().length === 0) {
    throw new HttpError(422, "name", COPY.typeAName, { name: COPY.typeAName });
  }
  const used = await db.many("select number from cuts where job_id = $1", [String(job.id)]);
  const usedNumbers = new Set(used.map((u) => Number(u.number)));
  let number = 1;
  while (usedNumbers.has(number)) number++;
  const id = newId();
  await db.query(
    "insert into cuts (id, job_id, number, name, frame_rate, created_at) values ($1, $2, $3, $4, $5, $6)",
    [id, String(job.id), number, name.trim(), rate(job), String(now())],
  );
  const frames = await db.many("select * from frames where job_id = $1 order by position", [String(job.id)]);
  let position = 1;
  for (const frame of frames) {
    await db.query(
      "insert into cut_frames (cut_id, frame_id, frame_number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
      [
        id,
        String(frame.id),
        Number(frame.number),
        position,
        Number(frame.duration_frames),
        String(frame.action_note),
        String(frame.audio_note),
        String(frame.shot),
        String(frame.visual),
        frame.file_name === null ? null : String(frame.file_name),
        frame.width === null ? null : Number(frame.width),
        frame.height === null ? null : Number(frame.height),
        frame.sha256 === null ? null : String(frame.sha256),
        Boolean(frame.seeded),
      ],
    );
    position++;
  }
  const row = await db.one("select * from cuts where id = $1", [id]);
  await addHistory(db, String(job.id), "cutMade", String((await deskRow(db, req)).name), `Cut ${number} made.`);
  return jsonResponse(201, cutView(row!));
});

route("GET", "/api/jobs/:id/cuts/:number", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const cut = await cutOfJob(db, String(job.id), Number(req.params.number));
  const frames = await db.many(
    "select * from cut_frames where cut_id = $1 order by position",
    [String(cut.id)],
  );
  return jsonResponse(200, {
    ...cutView(cut),
    frames: frames.map((f) => ({
      number: 0,
      position: Number(f.position),
      durationFrames: Number(f.duration_frames),
      actionNote: String(f.action_note),
      audioNote: String(f.audio_note),
      shot: String(f.shot),
      visual: String(f.visual),
      fileName: f.file_name === null ? null : String(f.file_name),
      width: f.width === null ? null : Number(f.width),
      height: f.height === null ? null : Number(f.height),
      sha256: f.sha256 === null ? null : String(f.sha256),
      drawingUrl: null,
    })),
  });
});

async function cutOfJob(db: Db, jobId: string, number: number): Promise<Record<string, unknown>> {
  const row = await db.one("select * from cuts where job_id = $1 and number = $2", [jobId, number]);
  if (row === null) throw new HttpError(404, "unknownCut", "There is nothing at this address.");
  return row;
}

route("PATCH", "/api/jobs/:id/cuts/:number", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const cut = await cutOfJob(db, String(job.id), Number(req.params.number));
  if (cut.signed_off_at !== null) {
    throw new HttpError(409, "signedOff", ARTIST_COPY.cutSignedNoChange);
  }
  const body = jsonOf(req);
  const name = strOf(body, "name") ?? String(cut.name);
  await db.query("update cuts set name = $1 where id = $2", [name, String(cut.id)]);
  const after = await db.one("select * from cuts where id = $1", [String(cut.id)]);
  await addHistory(db, String(job.id), "cutSaved", String((await deskRow(db, req)).name), `Cut ${Number(cut.number)} saved.`);
  return jsonResponse(200, cutView(after!));
});

route("DELETE", "/api/jobs/:id/cuts/:number", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const cut = await cutOfJob(db, String(job.id), Number(req.params.number));
  if (cut.signed_off_at !== null) {
    throw new HttpError(409, "signedOff", ARTIST_COPY.cutSignedNoChange);
  }
  await db.query("delete from cut_frames where cut_id = $1", [String(cut.id)]);
  await db.query("delete from cuts where id = $1", [String(cut.id)]);
  await addHistory(db, String(job.id), "cutDeleted", String((await deskRow(db, req)).name), `Cut ${Number(cut.number)} deleted.`);
  return emptyResponse(204);
});

// Bringing an earlier cut back makes the board equal to it, frames included,
// while later cuts stay exactly as they were.
route("POST", "/api/jobs/:id/cuts/:number/bring-back", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp === null) {
    throw new HttpError(422, "stamp", "Reload the board.", { stamp: "Reload the board." });
  }
  await board.requireStamp(db, String(job.id), stamp);
  const cut = await cutOfJob(db, String(job.id), Number(req.params.number));
  const frames = await db.many("select * from cut_frames where cut_id = $1 order by position", [String(cut.id)]);
  const frameIds = new Set(frames.map((f) => String(f.frame_id)));
  const existing = await db.many("select * from frames where job_id = $1", [String(job.id)]);
  for (const frame of existing) {
    if (!frameIds.has(String(frame.id))) {
      await db.query("delete from frames where id = $1", [String(frame.id)]);
    }
  }
  let position = 1;
  for (const frame of frames) {
    const held = await db.one("select id from frames where id = $1", [String(frame.frame_id)]);
    if (held === null) {
      await db.query(
        "insert into frames (id, job_id, number, position, duration_frames, action_note, audio_note, shot, visual, file_name, width, height, sha256, seeded, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        [
          String(frame.frame_id),
          String(job.id),
          await nextFrameNumber(db, String(job.id)),
          position,
          Number(frame.duration_frames),
          String(frame.action_note),
          String(frame.audio_note),
          String(frame.shot),
          String(frame.visual),
          frame.file_name === null ? null : String(frame.file_name),
          frame.width === null ? null : Number(frame.width),
          frame.height === null ? null : Number(frame.height),
          frame.sha256 === null ? null : String(frame.sha256),
          Boolean(frame.seeded),
          String(now()),
        ],
      );
    } else {
      await db.query(
        "update frames set position = $1, duration_frames = $2, action_note = $3, audio_note = $4, shot = $5, visual = $6, file_name = $7, width = $8, height = $9, sha256 = $10, seeded = $11 where id = $12",
        [
          position,
          Number(frame.duration_frames),
          String(frame.action_note),
          String(frame.audio_note),
          String(frame.shot),
          String(frame.visual),
          frame.file_name === null ? null : String(frame.file_name),
          frame.width === null ? null : Number(frame.width),
          frame.height === null ? null : Number(frame.height),
          frame.sha256 === null ? null : String(frame.sha256),
          Boolean(frame.seeded),
          String(frame.frame_id),
        ],
      );
    }
    position++;
  }
  await db.query("update board_stamps set frame_rate = $1 where job_id = $2", [String(cut.frame_rate), String(job.id)]);
  await db.query("update jobs set frame_rate = $1 where id = $2", [String(cut.frame_rate), String(job.id)]);
  await board.newBoardStamp(db, String(job.id));
  await addHistory(db, String(job.id), "cutBroughtBack", String((await deskRow(db, req)).name), `Cut ${Number(cut.number)} is the board again.`);
  const view = await board.loadBoard(db, String(job.id));
  return jsonResponse(200, view as unknown as Json);
});

// Comparing takes the higher number as the newer cut. Frames are listed by
// position in the newer cut (moved, then length, then drawing), then gone
// frames by number.
route("GET", "/api/jobs/:id/compare", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const a = Number(req.query.get("a") ?? "0");
  const b = Number(req.query.get("b") ?? "0");
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    throw new HttpError(422, "cuts", "Pick two cuts to compare.", { cuts: "Pick two cuts to compare." });
  }
  const older = await cutOfJob(db, String(job.id), Math.min(a, b));
  const newer = await cutOfJob(db, String(job.id), Math.max(a, b));
  const olderFrames = await db.many("select * from cut_frames where cut_id = $1 order by position", [String(older.id)]);
  const newerFrames = await db.many("select * from cut_frames where cut_id = $1 order by position", [String(newer.id)]);
  const olderByFrameId = new Map(olderFrames.map((f) => [String(f.frame_id), f]));
  const differences: string[] = [];
  for (const frame of newerFrames) {
    const before = olderByFrameId.get(String(frame.frame_id));
    if (before === undefined) {
      differences.push(`Frame ${numberOf(db, frame)} is new.`);
      continue;
    }
    const beforePosition = Number(before.position);
    const afterPosition = Number(frame.position);
    if (beforePosition !== afterPosition) {
      differences.push(`Frame ${numberOf(db, frame)} moved from position ${beforePosition} to position ${afterPosition}.`);
    }
    const beforeDuration = Number(before.duration_frames);
    const afterDuration = Number(frame.duration_frames);
    if (beforeDuration !== afterDuration) {
      const unit = (n: number) => (n === 1 ? "1 frame" : `${n} frames`);
      differences.push(
        afterDuration < beforeDuration
          ? `Frame ${numberOf(db, frame)} is ${unit(beforeDuration - afterDuration)} shorter.`
          : `Frame ${numberOf(db, frame)} is ${unit(afterDuration - beforeDuration)} longer.`,
      );
    }
    if (String(before.sha256 ?? "") !== String(frame.sha256 ?? "") || Boolean(before.seeded) !== Boolean(frame.seeded)) {
      differences.push(`Frame ${numberOf(db, frame)} has a new drawing.`);
    }
  }
  const newerIds = new Set(newerFrames.map((f) => String(f.frame_id)));
  for (const frame of olderFrames) {
    if (!newerIds.has(String(frame.frame_id))) {
      differences.push(`Frame ${numberOf(db, frame)} is gone.`);
    }
  }
  return jsonResponse(200, {
    differences,
    a: cutView(older),
    b: cutView(newer),
  });
});

function numberOf(db: Db, frame: Record<string, unknown>): number {
  void db;
  return Number(frame.frame_number ?? 0);
}

// Renders: the same cut and settings never start a second render; the stored
// one is shown. A failed render does not count as stored.
route("GET", "/api/jobs/:id/renders", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  await tickRenders(req.config, db, {
    put: async () => ({ ok: false }),
    get: async () => null,
    remove: async () => ({ ok: false }),
    exists: async () => false,
  } as unknown as Store, now());
  const rows = await db.many("select * from renders where job_id = $1 order by created_at, id", [String(job.id)]);
  const busyRow = await db.one("select at from file_rates where desk_id = $1 and at > $2 order by at limit 1", [
    `render:${req.session!.deskId}`,
    String(now()),
  ]);
  const view = await board.loadBoard(db, String(job.id));
  const renders = rows.map((row) => renderView(db, row, view!));
  return jsonResponse(200, {
    renders,
    busy: busyRow === null ? null : { until: instantText(Number(busyRow.at)), message: "The render service is busy right now." },
  });
});

function renderView(db: Db, row: Record<string, unknown>, boardView: board.BoardView | null): Json {
  void db;
  void boardView;
  return {
    id: String(row.id),
    cut: Number(row.cut_number),
    width: Number(row.width),
    burnTimecode: Boolean(row.burn_timecode),
    state: String(row.state),
    progress: Number(row.progress),
    message: row.message === null ? null : String(row.message),
    size: row.size === null ? null : Number(row.size),
    sha256: row.sha256 === null ? null : String(row.sha256),
    filmUrl: String(row.state) === "ready" ? `/api/jobs/${String(row.job_id)}/renders/${String(row.id)}/film` : null,
    createdAt: instantText(Number(row.created_at)),
  };
}

route("POST", "/api/jobs/:id/renders", async (req, store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.state) === "archived") {
    throw new HttpError(409, "archived", ARTIST_COPY.jobArchivedRefusal);
  }
  const body = jsonOf(req);
  const cutNumber = numOf(body, "cut");
  const width = numOf(body, "width");
  const burnTimecode = boolOf(body, "burnTimecode");
  if (cutNumber === null || width === null || (width !== 640 && width !== 1280) || burnTimecode === null) {
    throw new HttpError(422, "shape", "Pick a width and whether to burn in the timecode.", {
      width: "Pick a width from the list.",
    });
  }
  const cut = await cutOfJob(db, String(job.id), cutNumber);
  // A busy answer holds every call to the service until that instant.
  const busyRow = await db.one("select at from file_rates where desk_id = $1 and at > $2 order by at limit 1", [
    `render:${req.session!.deskId}`,
    String(now()),
  ]);
  if (busyRow !== null) {
    throw new HttpError(503, "busy", ARTIST_COPY.renderBusy(wallTime("amsterdam", Number(busyRow.at))), null, {
      "Retry-After": String(Math.max(1, Number(busyRow.at) - now())),
    });
  }
  // The stored render for the same cut and settings is shown.
  const held = await db.one(
    "select * from renders where job_id = $1 and cut_id = $2 and width = $3 and burn_timecode = $4 and state in ('queued','running','done','ready') order by created_at desc limit 1",
    [String(job.id), String(cut.id), width, burnTimecode ? "t" : "f"],
  );
  if (held !== null && (String(held.state) === "ready" || String(held.state) === "done")) {
    return jsonResponse(200, renderView(db, held, null));
  }
  const clips = await db.many("select * from cut_frames where cut_id = $1 order by position", [String(cut.id)]);
  const quaymill = new Quaymill(req.config);
  let providerId: string;
  try {
    const asked = await quaymill.ask({
      cutId: String(cut.id),
      frameRate: String(cut.frame_rate),
      width,
      burnTimecode,
      clips: clips.map((c) => ({
        frame: numberOf(db, c),
        durationFrames: Number(c.duration_frames),
        sha256: c.sha256 === null ? null : String(c.sha256),
      })),
    });
    providerId = asked.id;
  } catch (e) {
    if (e instanceof RateLimited) {
      await db.query("insert into file_rates (desk_id, at) values ($1, $2)", [
        `render:${req.session!.deskId}`,
        String(now() + e.retryAfterSeconds),
      ]);
      throw new HttpError(503, "busy", ARTIST_COPY.renderBusy(wallTime("amsterdam", now() + e.retryAfterSeconds)), null, {
        "Retry-After": String(e.retryAfterSeconds),
      });
    }
    throw new HttpError(503, "renderUnavailable", ARTIST_COPY.renderUnavailable);
  }
  const id = newId();
  await db.query(
    "insert into renders (id, job_id, cut_id, cut_number, width, burn_timecode, state, progress, message, size, sha256, provider_id, created_at, stored_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
    [
      id,
      String(job.id),
      String(cut.id),
      Number(cut.number),
      width,
      burnTimecode ? "t" : "f",
      "queued",
      0,
      null,
      null,
      null,
      providerId,
      String(now()),
      null,
    ],
  );
  void store;
  return jsonResponse(202, renderView(db, (await db.one("select * from renders where id = $1", [id]))!, null));
});

route("GET", "/api/jobs/:id/renders/:renderId/film", async (req, store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const row = await db.one("select * from renders where id = $1 and job_id = $2", [
    req.params.renderId!,
    String(job.id),
  ]);
  if (row === null || String(row.state) !== "ready") {
    throw new HttpError(404, "noFilm", "There is nothing at this address.");
  }
  const data = await store.get(objectKey(String(job.client_id), String(job.id), `films/${String(row.id)}`));
  if (data === null) throw new HttpError(404, "noFilm", "There is nothing at this address.");
  return bytesResponse(200, "application/octet-stream", data);
});

// The server polls one render at most once per 5 seconds, with no screen
// open, and picks up unfinished renders after a restart.
async function tickRenders(config: Config, db: Db, store: Store, at: Instant): Promise<void> {
  const rows = await db.many("select * from renders where state in ('queued','running') order by created_at, id", []);
  for (const row of rows) {
    const last = Number(row.polled_at ?? 0);
    if (at - last < 5) continue;
    await db.query("update renders set polled_at = $1 where id = $2", [String(at), String(row.id)]);
    const quaymill = new Quaymill(config);
    let state;
    try {
      state = await quaymill.poll(String(row.provider_id));
    } catch (e) {
      if (e instanceof RateLimited) {
        await db.query("insert into file_rates (desk_id, at) values ($1, $2)", [
          `render:global`,
          String(at + e.retryAfterSeconds),
        ]);
      }
      continue;
    }
    if (state.state === "queued") continue;
    if (state.state === "running") {
      await db.query("update renders set state = 'running', progress = $1 where id = $2", [
        String(state.progress),
        String(row.id),
      ]);
      continue;
    }
    if (state.state === "failed") {
      await db.query("update renders set state = 'failed', message = $1 where id = $2", [
        state.reason,
        String(row.id),
      ]);
      continue;
    }
    // done: fetch the film, check size and SHA-256, copy into the store.
    const job = await db.one("select * from jobs where id = $1", [String(row.job_id)]);
    if (job === null) continue;
    let film: Buffer;
    try {
      film = await quaymill.fetchFilm(state.url);
    } catch {
      continue;
    }
    const size = film.length;
    const sha = sha256Hex(film);
    if (size !== state.size || sha !== state.sha256) {
      await db.query("update renders set state = 'failed', message = $1 where id = $2", [
        "The render came back incomplete.",
        String(row.id),
      ]);
      continue;
    }
    const put = await store.put(objectKey(String(job.client_id), String(job.id), `films/${String(row.id)}`), film, "application/octet-stream");
    if (!put.ok) continue;
    await db.query("update renders set state = 'ready', size = $1, sha256 = $2, stored_at = $3 where id = $4", [
      String(size),
      sha,
      String(at),
      String(row.id),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Private pages, as the artist
// ---------------------------------------------------------------------------

route("GET", "/api/jobs/:id/reviews", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const rows = await db.many("select * from reviews where job_id = $1 order by created_at, id", [String(job.id)]);
  return jsonResponse(200, { reviews: rows.map(pageView) });
});

function pageView(row: Record<string, unknown>): Json {
  return {
    id: String(row.id),
    producerId: String(row.producer_id),
    cut: Number(row.cut),
    url: `/r/${String(row.token)}`,
    state: Number(row.ends_at) <= now() ? "ended" : String(row.state),
    endsAt: instantText(Number(row.ends_at)),
  };
}

// A review or sign-off for a producer who is not on the job's client answers
// 404; a further POST for that producer and job ends the old page.
route("POST", "/api/jobs/:id/reviews", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const producerId = strOf(body, "producerId");
  const cut = numOf(body, "cut");
  if (producerId === null || cut === null) {
    throw new HttpError(422, "shape", "Pick a producer and a cut.", { producerId: "Pick a producer from the list." });
  }
  const producer = await producerOfJob(db, String(job.id), producerId);
  if (dateOnly(String(job.due_date)) + 86400 <= now()) {
    throw new HttpError(409, "duePassed", ARTIST_COPY.duePassed);
  }
  const existing = await db.one("select id from reviews where job_id = $1 and producer_id = $2 and state = 'open'", [
    String(job.id),
    producerId,
  ]);
  if (existing !== null) {
    await db.query("update reviews set state = 'ended' where id = $1", [String(existing.id)]);
  }
  const town = String(producer.town) as Town;
  const endsAt = board.pageEndsAt(town, String(job.due_date), now(), req.config.timers.reviewPageSeconds);
  const id = newId();
  const token = newToken();
  await db.query(
    "insert into reviews (id, job_id, producer_id, cut, token, state, ends_at, created_at, reminded) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [id, String(job.id), producerId, cut, token, "open", String(endsAt), String(now()), "f"],
  );
  const row = await db.one("select * from reviews where id = $1", [id]);
  const producerName = String(producer.name);
  await queueReviewMail(configOf(req), db, {
    to: String(producer.email),
    language: String(producer.language) as Language,
    jobTitle: String(job.title),
    url: `${req.config.appPublicUrl}/r/${token}`,
    dueDate: String(job.due_date),
    reminder: false,
  });
  await addHistory(db, String(job.id), "reviewSent", producerName, `Review page sent to ${producerName}.`);
  await db.query("update jobs set state = 'inReview' where id = $1 and state = 'draft'", [String(job.id)]);
  return jsonResponse(201, pageView(row!));
});

function configOf(req: Request): Config {
  return req.config;
}

async function producerOfJob(db: Db, jobId: string, producerId: string): Promise<Record<string, unknown>> {
  const job = await db.one("select client_id from jobs where id = $1", [jobId]);
  if (job === null) throw new HttpError(404, "unknownJob", "There is nothing at this address.");
  const row = await db.one("select * from producers where id = $1 and client_id = $2", [producerId, String(job.client_id)]);
  if (row === null) throw new HttpError(404, "unknownProducer", "There is nothing at this address.");
  return row;
}

async function queueReviewMail(
  config: Config,
  db: Db,
  input: {
    to: string;
    language: Language;
    jobTitle: string;
    url: string;
    dueDate: string;
    reminder: boolean;
  },
): Promise<void> {
  const copy = PRIVATE_COPY[input.language];
  const subject = (input.reminder ? copy.mailReminderSubject : copy.mailReviewSubject).replace("<title>", input.jobTitle);
  const body = [
    input.reminder ? `Reminder: your review page for ${input.jobTitle}` : `Your review page for ${input.jobTitle}`,
    "",
    copy.mailDueLine.replace("<date>", input.dueDate),
    "",
    input.url,
  ].join("\n");
  await queueMail(db, {
    to: input.to,
    subject,
    body,
    html: null,
    attachmentName: null,
    attachmentType: null,
    attachment: null,
  });
  void config;
}

route("POST", "/api/reviews/:id/end", async (req, _store, db) => {
  const row = await reviewOfDesk(db, req.session!.deskId, req.params.id!);
  await db.query("update reviews set state = 'ended' where id = $1", [String(row.id)]);
  const after = await db.one("select * from reviews where id = $1", [String(row.id)]);
  return jsonResponse(200, pageView(after!));
});

async function reviewOfDesk(db: Db, deskId: string, reviewId: string): Promise<Record<string, unknown>> {
  const row = await db.one(
    "select r.* from reviews r join jobs j on j.id = r.job_id where r.id = $1 and j.desk_id = $2",
    [reviewId, deskId],
  );
  if (row === null) throw new HttpError(404, "unknownReview", "There is nothing at this address.");
  return row;
}

route("GET", "/api/jobs/:id/sign-offs", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const rows = await db.many("select * from sign_offs where job_id = $1 order by created_at, id", [String(job.id)]);
  return jsonResponse(200, { signOffs: rows.map(pageView) });
});

route("POST", "/api/jobs/:id/sign-offs", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(job.client_state) !== "active") {
    throw new HttpError(409, "closingNoChange", ARTIST_COPY.closingNoChange);
  }
  const body = jsonOf(req);
  const producerId = strOf(body, "producerId");
  const cut = numOf(body, "cut");
  if (producerId === null || cut === null) {
    throw new HttpError(422, "shape", "Pick a producer and a cut.", { producerId: "Pick a producer from the list." });
  }
  const producer = await producerOfJob(db, String(job.id), producerId);
  const existing = await db.one("select id from sign_offs where job_id = $1 and producer_id = $2 and state = 'open'", [
    String(job.id),
    producerId,
  ]);
  if (existing !== null) {
    await db.query("update sign_offs set state = 'ended' where id = $1", [String(existing.id)]);
  }
  const town = String(producer.town) as Town;
  const endsAt = board.pageEndsAt(town, String(job.due_date), now(), req.config.timers.signOffPageSeconds);
  const id = newId();
  const token = newToken();
  await db.query(
    "insert into sign_offs (id, job_id, producer_id, cut, token, state, ends_at, created_at, signed_off_at, signed_off_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [id, String(job.id), producerId, cut, token, "open", String(endsAt), String(now()), null, null],
  );
  const row = await db.one("select * from sign_offs where id = $1", [id]);
  const copy = PRIVATE_COPY[String(producer.language) as Language];
  const subject = copy.signOffHeading.replace("<title>", String(job.title));
  await queueMail(db, {
    to: String(producer.email),
    subject,
    body: [
      copy.signOffHeading.replace("<title>", String(job.title)),
      "",
      `${req.config.appPublicUrl}/s/${token}`,
    ].join("\n"),
    html: null,
    attachmentName: null,
    attachmentType: null,
    attachment: null,
  });
  await addHistory(db, String(job.id), "signOffSent", String(producer.name), `Sign-off page sent to ${String(producer.name)}.`);
  return jsonResponse(201, pageView(row!));
});

route("POST", "/api/sign-offs/:id/end", async (req, _store, db) => {
  const row = await signOffOfDesk(db, req.session!.deskId, req.params.id!);
  await db.query("update sign_offs set state = 'ended' where id = $1", [String(row.id)]);
  const after = await db.one("select * from sign_offs where id = $1", [String(row.id)]);
  return jsonResponse(200, pageView(after!));
});

async function signOffOfDesk(db: Db, deskId: string, signOffId: string): Promise<Record<string, unknown>> {
  const row = await db.one(
    "select s.* from sign_offs s join jobs j on j.id = s.job_id where s.id = $1 and j.desk_id = $2",
    [signOffId, deskId],
  );
  if (row === null) throw new HttpError(404, "unknownSignOff", "There is nothing at this address.");
  return row;
}

// ---------------------------------------------------------------------------
// Notes, as the artist
// ---------------------------------------------------------------------------

route("GET", "/api/jobs/:id/notes", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const stateFilter = req.query.get("state");
  const producerFilter = req.query.get("producer");
  const rows = await db.many(
    "select n.*, p.name as producer_name, p.town as town from notes n join producers p on p.id = n.producer_id where n.job_id = $1 order by n.created_at, n.id",
    [String(job.id)],
  );
  const filtered = rows.filter((r) => {
    if (stateFilter !== null && stateFilter !== "" && String(r.state) !== stateFilter) return false;
    if (producerFilter !== null && producerFilter !== "" && String(r.producer_id) !== producerFilter) return false;
    return true;
  });
  return jsonResponse(200, { notes: filtered.map((r) => noteView(db, r)), total: filtered.length });
});

function noteView(db: Db, row: Record<string, unknown>): Json {
  void db;
  return {
    id: String(row.id),
    frame: Number(row.frame),
    position: row.position === undefined ? null : Number(row.position),
    goneText: row.gone_text === undefined ? null : String(row.gone_text),
    timecode: row.timecode === undefined ? null : String(row.timecode),
    x: Number(row.x),
    y: Number(row.y),
    producerId: String(row.producer_id),
    producerName: String(row.producer_name),
    typedName: String(row.typed_name),
    state: String(row.state),
    text: String(row.text),
    suggestedSeconds: row.suggested_seconds === null ? null : Number(row.suggested_seconds),
    suggestedFrames: row.suggested_frames === null ? null : Number(row.suggested_frames),
    attachmentUrl: row.attachment_id === null ? null : `/api/notes/${String(row.id)}/attachment`,
    createdAt: instantText(Number(row.created_at)),
  };
}

route("PATCH", "/api/notes/:id", async (req, _store, db) => {
  const row = await noteOfDesk(db, req.session!.deskId, req.params.id!);
  const body = jsonOf(req);
  const state = strOf(body, "state");
  if (state === null || !NOTE_STATES.includes(state as never)) {
    throw new HttpError(422, "state", "Pick a note state from the list.", { state: "Pick a note state from the list." });
  }
  await db.query("update notes set state = $1 where id = $2", [state, String(row.id)]);
  const after = await db.one(
    "select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id where n.id = $1",
    [String(row.id)],
  );
  return jsonResponse(200, noteView(db, after!));
});

const NOTE_STATES = ["open", "done", "wontDo"];

// Marking many is all or none: any unknown id answers 404 and changes nothing.
route("POST", "/api/jobs/:id/notes/mark", async (req, _store, db) => {
  await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const body = jsonOf(req);
  const noteIds = body.noteIds;
  const state = strOf(body, "state");
  if (!Array.isArray(noteIds) || state === null || !NOTE_STATES.includes(state as never)) {
    throw new HttpError(422, "shape", "Pick the notes and their new state.", { state: "Pick a note state from the list." });
  }
  const ids = noteIds.map((v) => String(v));
  const held: Record<string, unknown>[] = [];
  for (const id of ids) {
    const row = await db.one(
      "select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id where n.id = $1 and n.job_id = $2",
      [id, req.params.id!],
    );
    if (row === null) {
      throw new HttpError(404, "unknownNote", "There is nothing at this address.");
    }
    held.push(row);
  }
  for (const row of held) {
    await db.query("update notes set state = $1 where id = $2", [state, String(row.id)]);
  }
  return jsonResponse(200, { notes: held.map((r) => noteView(db, { ...r, state })) });
});

route("GET", "/api/notes/:id/attachment", async (req, store, db) => {
  const row = await noteOfDesk(db, req.session!.deskId, req.params.id!);
  if (row.attachment_id === null) {
    throw new HttpError(404, "noAttachment", "There is nothing at this address.");
  }
  const job = await db.one("select * from jobs where id = $1", [String(row.job_id)]);
  const data = await store.get(objectKey(String(job!.client_id), String(job!.id), `attachments/${String(row.attachment_id)}`));
  if (data === null) throw new HttpError(404, "noAttachment", "There is nothing at this address.");
  return bytesResponse(200, imageMimeOf(data), data);
});

async function noteOfDesk(db: Db, deskId: string, noteId: string): Promise<Record<string, unknown>> {
  const row = await db.one(
    "select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id join jobs j on j.id = n.job_id where n.id = $1 and j.desk_id = $2",
    [noteId, deskId],
  );
  if (row === null) throw new HttpError(404, "unknownNote", "There is nothing at this address.");
  return row;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

route("GET", "/api/today", async () => {
  const at = now();
  return jsonResponse(200, {
    date: wallDate("amsterdam", at),
    weekStart: weekStartOfAmsterdam(at),
  });
});

route("GET", "/api/calls", async (req, _store, db) => {
  const from = req.query.get("from");
  const to = req.query.get("to");
  for (const value of [from, to]) {
    if (value !== null && dateOfText(value) === null) {
      throw new HttpError(422, "date", COPY.typeADate, { date: COPY.typeADate });
    }
  }
  const rows = await db.many("select c.*, p.name as producer_name, p.town as town from calls c join producers p on p.id = c.producer_id where c.desk_id = $1 order by c.starts_at, c.id", [
    req.session!.deskId,
  ]);
  const filtered = rows.filter((r) => {
    const amsterdamDate = wallDate("amsterdam", Number(r.starts_at));
    if (from !== null && amsterdamDate < from) return false;
    if (to !== null && amsterdamDate > to) return false;
    return true;
  });
  return jsonResponse(200, { calls: filtered.map((r) => callView(db, r)) });
});

function callView(db: Db, row: Record<string, unknown>): Json {
  void db;
  const town = String(row.town) as Town;
  const at = Number(row.starts_at);
  return {
    id: String(row.id),
    producerId: String(row.producer_id),
    producerName: String(row.producer_name),
    town,
    date: String(row.date),
    time: String(row.time),
    minutes: Number(row.minutes),
    note: String(row.note),
    startsAt: instantText(at),
    endsAt: instantText(Number(row.ends_at)),
    text: `${longDate(town, at)}, ${wallTime(town, at)} ${TOWN_LABEL_TEXT[town]} time · ${wallTime("amsterdam", at)} Amsterdam time`,
    uid: String(row.uid),
    sequence: Number(row.sequence),
    state: String(row.state),
  };
}

const TOWN_LABEL_TEXT: Record<string, string> = {
  amsterdam: "Amsterdam",
  newYork: "New York",
  toronto: "Toronto",
  dubai: "Dubai",
};

// A call keeps its local time across clock changes; a wall time the change
// skips is refused, one that happens twice takes the first, and two bookings
// of one slot give exactly one winner.
route("POST", "/api/calls", async (req, _store, db) => {
  const deskId = req.session!.deskId;
  const body = jsonOf(req);
  const producerId = strOf(body, "producerId");
  const date = strOf(body, "date");
  const time = strOf(body, "time");
  const minutes = numOf(body, "minutes");
  const note = strOf(body, "note") ?? "";
  if (producerId === null || date === null || time === null || minutes === null) {
    throw new HttpError(422, "shape", "Pick a producer, a date, a time and the minutes.", {
      date: COPY.typeADate,
      time: COPY.typeATime,
    });
  }
  if (dateOfText(date) === null) {
    throw new HttpError(422, "date", COPY.typeADate, { date: COPY.typeADate });
  }
  if (timeOfText(time) === null) {
    throw new HttpError(422, "time", COPY.typeATime, { time: COPY.typeATime });
  }
  if (minutes !== 30 && minutes !== 60) {
    throw new HttpError(422, "minutes", "Pick 30 or 60 minutes.", { minutes: "Pick 30 or 60 minutes." });
  }
  const producer = await producerOfDesk(db, deskId, producerId);
  const town = String(producer.town) as Town;
  const startsAt = instantOfWall(town, date, time);
  if (startsAt === null) {
    throw new HttpError(422, "time", ARTIST_COPY.callMissing(time, TOWN_LABEL_TEXT[town], longDate(town, dateOnly(date))), {
      time: ARTIST_COPY.callMissing(time, TOWN_LABEL_TEXT[town], longDate(town, dateOnly(date))),
    });
  }
  if (startsAt <= now()) {
    throw new HttpError(422, "time", ARTIST_COPY.callPast, { time: ARTIST_COPY.callPast });
  }
  const overlap = await db.one(
    "select * from calls where desk_id = $1 and state = 'booked' and starts_at < $2 and ends_at > $3 order by starts_at limit 1",
    [deskId, String(startsAt + minutes * 60), String(startsAt)],
  );
  if (overlap !== null) {
    const at = Number(overlap.starts_at);
    throw new HttpError(409, "taken", ARTIST_COPY.callTaken(`${wallTime("amsterdam", at)}`), {
      time: ARTIST_COPY.callTaken(`${wallTime("amsterdam", at)}`),
    });
  }
  const id = newId();
  await db.query(
    "insert into calls (id, desk_id, producer_id, date, time, minutes, note, starts_at, ends_at, uid, sequence, state) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [id, deskId, producerId, date, time, minutes, note, String(startsAt), String(startsAt + minutes * 60), `${id}@clapstick`, 0, "booked"],
  );
  const row = await db.one(
    "select c.*, p.name as producer_name, p.town as town from calls c join producers p on p.id = c.producer_id where c.id = $1",
    [id],
  );
  await queueCallMail(req.config, db, row!, "REQUEST");
  return jsonResponse(201, callView(db, row!));
});

route("PATCH", "/api/calls/:id", async (req, _store, db) => {
  const row = await callOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(row.state) !== "booked") {
    throw new HttpError(409, "notBooked", "This call is already cancelled.");
  }
  const body = jsonOf(req);
  const date = strOf(body, "date") ?? String(row.date);
  const time = strOf(body, "time") ?? String(row.time);
  const minutes = numOf(body, "minutes") ?? Number(row.minutes);
  if (dateOfText(date) === null) {
    throw new HttpError(422, "date", COPY.typeADate, { date: COPY.typeADate });
  }
  if (timeOfText(time) === null) {
    throw new HttpError(422, "time", COPY.typeATime, { time: COPY.typeATime });
  }
  const producer = await db.one("select * from producers where id = $1", [String(row.producer_id)]);
  const town = String(producer!.town) as Town;
  const startsAt = instantOfWall(town, date, time);
  if (startsAt === null) {
    throw new HttpError(422, "time", ARTIST_COPY.callMissing(time, TOWN_LABEL_TEXT[town], longDate(town, dateOnly(date))), {
      time: ARTIST_COPY.callMissing(time, TOWN_LABEL_TEXT[town], longDate(town, dateOnly(date))),
    });
  }
  if (startsAt <= now()) {
    throw new HttpError(422, "time", ARTIST_COPY.callPast, { time: ARTIST_COPY.callPast });
  }
  const overlap = await db.one(
    "select * from calls where desk_id = $1 and state = 'booked' and id <> $2 and starts_at < $3 and ends_at > $4 order by starts_at limit 1",
    [req.session!.deskId, String(row.id), String(startsAt + minutes * 60), String(startsAt)],
  );
  if (overlap !== null) {
    const at = Number(overlap.starts_at);
    throw new HttpError(409, "taken", ARTIST_COPY.callTaken(`${wallTime("amsterdam", at)}`), {
      time: ARTIST_COPY.callTaken(`${wallTime("amsterdam", at)}`),
    });
  }
  const sequence = Number(row.sequence) + 1;
  await db.query(
    "update calls set date = $1, time = $2, minutes = $3, starts_at = $4, ends_at = $5, sequence = $6 where id = $7",
    [date, time, minutes, String(startsAt), String(startsAt + minutes * 60), sequence, String(row.id)],
  );
  const after = await db.one(
    "select c.*, p.name as producer_name, p.town as town from calls c join producers p on p.id = c.producer_id where c.id = $1",
    [String(row.id)],
  );
  await queueCallMail(req.config, db, after!, "REQUEST");
  return jsonResponse(200, callView(db, after!));
});

route("POST", "/api/calls/:id/cancel", async (req, _store, db) => {
  const row = await callOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(row.state) !== "booked") {
    throw new HttpError(409, "notBooked", "This call is already cancelled.");
  }
  await db.query("update calls set state = 'cancelled' where id = $1", [String(row.id)]);
  const after = await db.one(
    "select c.*, p.name as producer_name, p.town as town from calls c join producers p on p.id = c.producer_id where c.id = $1",
    [String(row.id)],
  );
  await queueCallMail(req.config, db, after!, "CANCEL");
  return jsonResponse(200, callView(db, after!));
});

async function callOfDesk(db: Db, deskId: string, callId: string): Promise<Record<string, unknown>> {
  const row = await db.one("select * from calls where id = $1 and desk_id = $2", [callId, deskId]);
  if (row === null) throw new HttpError(404, "unknownCall", "There is nothing at this address.");
  return row;
}

async function queueCallMail(config: Config, db: Db, row: Record<string, unknown>, method: "REQUEST" | "CANCEL"): Promise<void> {
  const producer = await db.one("select * from producers where id = $1", [String(row.producer_id)]);
  const language = String(producer!.language) as Language;
  const copy = PRIVATE_COPY[language];
  const subject = (method === "CANCEL" ? copy.mailCancelledCallSubject : copy.mailCallSubject).replace(
    "<date>",
    String(row.date),
  );
  const ics = calendarFile(
    {
      uid: String(row.uid),
      sequence: Number(row.sequence),
      town: String(row.town) as Town,
      date: String(row.date),
      time: String(row.time),
      minutes: Number(row.minutes),
      note: String(row.note),
      producerName: String(producer!.name),
      producerEmail: String(producer!.email),
      artistEmail: "desk@noorbakkerboards.example",
    },
    method,
  );
  await queueMail(db, {
    to: String(producer!.email),
    subject,
    body: `${subject}\n\n${longDate(String(row.town) as Town, Number(row.starts_at))}, ${wallTime(String(row.town) as Town, Number(row.starts_at))} ${TOWN_LABEL_TEXT[String(row.town)]} time`,
    html: null,
    attachmentName: CALENDAR_FILE_NAME,
    attachmentType: `${CALENDAR_MIME}; method=${method}`,
    attachment: ics,
  });
  void config;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

route("GET", "/api/jobs/:id/packages", async (req, _store, db) => {
  await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const rows = await db.many("select * from packages where job_id = $1 order by created_at, id", [req.params.id!]);
  const out: Json[] = [];
  for (const row of rows) {
    const files = await db.many("select * from package_files where package_id = $1", [String(row.id)]);
    out.push({
      id: String(row.id),
      cut: Number(row.cut),
      state: String(row.state),
      files: files.map((f) => ({
        kind: String(f.kind),
        fileName: String(f.file_name),
        size: Number(f.size),
        sha256: String(f.sha256),
        url: `/api/packages/${String(row.id)}/files/${String(f.kind)}`,
      })),
      createdAt: instantText(Number(row.created_at)),
    });
  }
  return jsonResponse(200, { packages: out });
});

route("POST", "/api/jobs/:id/packages", async (req, store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const body = jsonOf(req);
  const cut = numOf(body, "cut");
  if (cut === null) {
    throw new HttpError(422, "cut", "Pick a cut to deliver.", { cut: "Pick a cut from the list." });
  }
  const cutRow = await cutOfJob(db, String(job.id), cut);
  if (cutRow.signed_off_at === null) {
    throw new HttpError(409, "notSignedOff", ARTIST_COPY.onlySignedOff);
  }
  // The package is refused while a cue on the job has an ended licence.
  const at = now();
  const cues = await db.many("select * from cues where job_id = $1", [String(job.id)]);
  for (const cue of cues) {
    if (board.licenceEndedBefore(String(cue.until_date), MARKET_TOWN[String(cue.market) as "NL"], at)) {
      throw new HttpError(409, "licenceEnded", ARTIST_COPY.licenceEndedPackage(String(cue.title), String(cue.until_date)));
    }
  }
  const clips = await db.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow.id)]);
  for (const clip of clips) {
    if (clip.sha256 === null && !Boolean(clip.seeded)) {
      throw new HttpError(409, "noDrawing", ARTIST_COPY.noDrawing(numberOf(db, clip)));
    }
  }
  const held = await db.one("select * from packages where job_id = $1 and cut = $2", [String(job.id), cut]);
  if (held !== null && String(held.state) === "ready") {
    const files = await db.many("select * from package_files where package_id = $1", [String(held.id)]);
    return jsonResponse(200, {
      id: String(held.id),
      cut,
      state: "ready",
      files: files.map((f) => ({
        kind: String(f.kind),
        fileName: String(f.file_name),
        size: Number(f.size),
        sha256: String(f.sha256),
        url: `/api/packages/${String(held.id)}/files/${String(f.kind)}`,
      })),
      createdAt: instantText(Number(held.created_at)),
    });
  }
  const frameRate = String(cutRow.frame_rate) as FrameRate;
  const boardsHtml = boardsPdfHtml(String(job.title), clips.map((c) => ({
    number: numberOf(db, c),
    timecodeIn: timecode(0, frameRate),
    actionNote: String(c.action_note),
    seeded: Boolean(c.seeded),
    sha256: c.sha256 === null ? null : String(c.sha256),
  })));
  let boardsPdf: Buffer;
  try {
    boardsPdf = await renderPdf(req.config, boardsHtml);
  } catch {
    throw new HttpError(503, "pdfUnavailable", ARTIST_COPY.pdfUnavailable);
  }
  let startFrame = 0;
  const edlClips: { frame: number; durationFrames: number; fileName: string | null }[] = [];
  const shotRows: ShotListFrame[] = [];
  for (const clip of clips) {
    const duration = Number(clip.duration_frames);
    shotRows.push({
      position: Number(clip.position),
      frame: numberOf(db, clip),
      timecodeIn: timecode(startFrame, frameRate),
      seconds: realSecondsText(duration, frameRate).replace(" s", ""),
      shot: String(clip.shot),
      visual: String(clip.visual),
      audio: String(clip.audio_note),
      actionNote: String(clip.action_note),
    });
    edlClips.push({
      frame: numberOf(db, clip),
      durationFrames: duration,
      fileName: clip.file_name === null ? null : String(clip.file_name),
    });
    startFrame += duration;
  }
  const edl = editDecisionList(String(job.title), frameRate, edlClips);
  const list = shotList(shotRows);
  const packageId = newId();
  const written: { key: string; data: Buffer; kind: string; fileName: string }[] = [
    { key: objectKey(String(job.client_id), String(job.id), `packages/${packageId}/boards.pdf`), data: boardsPdf, kind: "boards", fileName: "boards.pdf" },
    { key: objectKey(String(job.client_id), String(job.id), `packages/${packageId}/edit-decision-list.edl`), data: Buffer.from(edl, "utf8"), kind: "editDecisionList", fileName: "edit-decision-list.edl" },
    { key: objectKey(String(job.client_id), String(job.id), `packages/${packageId}/shot-list.csv`), data: Buffer.from(list, "utf8"), kind: "shotList", fileName: "shot-list.csv" },
  ];
  // A package shows Ready only after the PDF service has answered and the
  // store has confirmed every file; with either down nothing is saved and any
  // object written so far is removed.
  for (const file of written) {
    const put = await store.put(file.key, file.data, file.kind === "boards" ? "application/pdf" : file.kind === "editDecisionList" ? "text/plain" : "text/csv");
    if (!put.ok) {
      for (const undo of written) {
        await store.remove(undo.key);
      }
      throw new HttpError(503, "storeUnavailable", ARTIST_COPY.storeUnavailable);
    }
  }
  await db.query("insert into packages (id, job_id, cut, state, created_at) values ($1, $2, $3, $4, $5)", [
    packageId,
    String(job.id),
    cut,
    "ready",
    String(now()),
  ]);
  for (const file of written) {
    await db.query(
      "insert into package_files (package_id, kind, file_name, size, sha256) values ($1, $2, $3, $4, $5)",
      [packageId, file.kind, file.fileName, String(file.data.length), sha256Hex(file.data)],
    );
  }
  await db.query("update jobs set state = 'delivered' where id = $1 and state = 'signedOff'", [String(job.id)]);
  await addHistory(db, String(job.id), "packageMade", String((await deskRow(db, req)).name), "Package made.");
  const files = await db.many("select * from package_files where package_id = $1", [packageId]);
  return jsonResponse(201, {
    id: packageId,
    cut,
    state: "ready",
    files: files.map((f) => ({
      kind: String(f.kind),
      fileName: String(f.file_name),
      size: Number(f.size),
      sha256: String(f.sha256),
      url: `/api/packages/${packageId}/files/${String(f.kind)}`,
    })),
    createdAt: instantText(now()),
  });
});

function boardsPdfHtml(
  title: string,
  frames: { number: number; timecodeIn: string; actionNote: string; seeded: boolean; sha256: string | null }[],
): string {
  const pages: string[] = [];
  for (let i = 0; i < frames.length; i += 6) {
    const page = frames.slice(i, i + 6);
    pages.push(
      `<div class="page"><h1>${escapeHtml(title)}</h1><div class="frames">${page
        .map(
          (f) =>
            `<figure><figcaption>Frame ${f.number} · ${f.timecodeIn} · ${escapeHtml(f.actionNote)}</figcaption></figure>`,
        )
        .join("")}</div></div>`,
    );
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 12mm; }
  body { font-family: serif; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 8mm; }
  .frames { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  figure { margin: 0; border: 0.4mm solid #000; height: 55mm; }
  figcaption { padding: 2mm; font-size: 8pt; }
  </style></head><body>${pages.join("")}</body></html>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Downloads are limited to 5 per desk per window; the sixth answers 429.
route("GET", "/api/packages/:id/files/:kind", async (req, store, db) => {
  const row = await db.one("select * from packages where id = $1", [req.params.id!]);
  if (row === null) throw new HttpError(404, "unknownPackage", "There is nothing at this address.");
  const job = await jobOfDesk(db, req.session!.deskId, String(row.job_id));
  const file = await db.one("select * from package_files where package_id = $1 and kind = $2", [
    req.params.id!,
    req.params.kind!,
  ]);
  if (file === null) throw new HttpError(404, "unknownFile", "There is nothing at this address.");
  const deskId = req.session!.deskId;
  const windowStart = now() - req.config.timers.fileRateWindowSeconds;
  await db.query("delete from file_rates where desk_id = $1 and at <= $2", [`downloads:${deskId}`, String(windowStart)]);
  const counts = await db.many("select at from file_rates where desk_id = $1", [`downloads:${deskId}`]);
  if (counts.length >= 5) {
    const sorted = counts.map((c) => Number(c.at)).sort((a, b) => a - b);
    const nextWindow = sorted[0]! + req.config.timers.fileRateWindowSeconds;
    throw new HttpError(429, "tooManyDownloads", ARTIST_COPY.tooManyDownloads(wallTime("amsterdam", nextWindow)), null, {
      "Retry-After": String(Math.max(1, nextWindow - now())),
    });
  }
  await db.query("insert into file_rates (desk_id, at) values ($1, $2)", [`downloads:${deskId}`, String(now())]);
  const key = objectKey(String(job.client_id), String(job.id), `packages/${String(row.id)}/${req.params.kind === "boards" ? "boards.pdf" : req.params.kind === "editDecisionList" ? "edit-decision-list.edl" : "shot-list.csv"}`);
  const data = await store.get(key);
  if (data === null) throw new HttpError(404, "unknownFile", "There is nothing at this address.");
  return bytesResponse(200, req.params.kind === "boards" ? "application/pdf" : req.params.kind === "editDecisionList" ? "text/plain" : "text/csv", data, {
    "content-disposition": `attachment; filename="${String(file.file_name)}"`,
  });
});

// ---------------------------------------------------------------------------
// Fee letters
// ---------------------------------------------------------------------------

route("GET", "/api/jobs/:id/letter", async (req, _store, db) => {
  await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const row = await db.one("select * from letters where job_id = $1", [req.params.id!]);
  if (row === null) throw new HttpError(404, "noLetter", "There is nothing at this address.");
  return jsonResponse(200, letterView(row));
});

function letterView(row: Record<string, unknown>): Json {
  const currency = String(row.currency) as Currency;
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    currency,
    scope: String(row.scope),
    feeMinor: Number(row.fee_minor),
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    feeText: amountText(currency, BigInt(Number(row.fee_minor))),
    taxText: amountText(currency, BigInt(Number(row.tax_minor))),
    totalText: amountText(currency, BigInt(Number(row.total_minor))),
    milestones: milestonesOf(currency, BigInt(Number(row.fee_minor)), BigInt(Number(row.tax_minor))),
    state: String(row.state),
    stamp: String(row.stamp),
    producerId: row.producer_id === null ? null : String(row.producer_id),
    pageUrl: row.page_token === null ? null : `/f/${String(row.page_token)}`,
    endsAt: row.page_ends_at === null ? null : instantText(Number(row.page_ends_at)),
    pdfUrl: row.pdf_stored_at === null ? null : `/api/letters/${String(row.id)}/pdf`,
  };
}

function milestonesOf(currency: Currency, feeMinor: bigint, taxMinor: bigint): Json[] {
  const thirds = splitThree(feeMinor);
  const perMilestone = taxMinor / 3n;
  const firstExtra = taxMinor - perMilestone * 3n;
  const taxes = [perMilestone + firstExtra, perMilestone, perMilestone];
  return thirds.map((amount, i) => ({
    number: i + 1,
    amountMinor: Number(amount),
    taxMinor: Number(taxes[i]),
    amountText: amountText(currency, amount),
    taxText: amountText(currency, taxes[i]!),
  }));
}

function splitThree(feeMinor: bigint): [bigint, bigint, bigint] {
  return splitMilestones(feeMinor);
}

route("POST", "/api/jobs/:id/letter", async (req, _store, db) => {
  const job = await jobOfDesk(db, req.session!.deskId, req.params.id!);
  const held = await db.one("select id from letters where job_id = $1", [String(job.id)]);
  if (held !== null) {
    throw new HttpError(409, "held", "This job already has a fee letter.");
  }
  const letter = await letterFromBody(db, req, job, null);
  const id = newId();
  await db.query(
    "insert into letters (id, job_id, currency, scope, fee_minor, tax_minor, total_minor, state, stamp, producer_id, page_token, page_ends_at, pdf_stored_at, created_at, accepted_at, accepted_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    [
      id,
      String(job.id),
      letter.currency,
      letter.scope,
      String(letter.feeMinor),
      String(letter.taxMinor),
      String(letter.totalMinor),
      "draft",
      newToken(),
      null,
      null,
      null,
      null,
      String(now()),
      null,
      null,
    ],
  );
  const row = await db.one("select * from letters where id = $1", [id]);
  return jsonResponse(201, letterView(row!));
});

async function letterFromBody(
  db: Db,
  req: Request,
  job: Record<string, unknown>,
  existing: Record<string, unknown> | null,
): Promise<{ currency: Currency; scope: string; feeMinor: bigint; taxMinor: bigint; totalMinor: bigint }> {
  const body = jsonOf(req);
  const fee = strOf(body, "fee");
  if (fee === null) {
    throw new HttpError(422, "fee", ARTIST_COPY.amountShape, { fee: ARTIST_COPY.amountShape });
  }
  const parsed = parsePositiveDecimal(fee, 2);
  if (parsed === null) {
    throw new HttpError(422, "fee", ARTIST_COPY.amountShape, { fee: ARTIST_COPY.amountShape });
  }
  const feeCents = feeMinorOf(parsed);
  const currency = strOf(body, "currency") ?? (existing === null ? "EUR" : String(existing.currency));
  if (!isCurrency(currency)) {
    throw new HttpError(422, "currency", "Pick a currency from the list.", { currency: "Pick a currency from the list." });
  }
  const scope = strOf(body, "scope") ?? (existing === null ? "" : String(existing.scope));
  if (scope.trim().length === 0) {
    throw new HttpError(422, "scope", "Type the letter's scope.", { scope: "Type the letter's scope." });
  }
  // Tax follows the client's place, worked out on each milestone on its own.
  const client = await db.one("select place from clients where id = $1", [String(job.client_id)]);
  const percent = taxPercentOfPlace(String(client!.place));
  const thirds = splitThree(feeCents);
  const taxMinor = thirds.reduce((sum, m) => sum + taxOfMilestone(m, percent), 0n);
  return { currency, scope, feeMinor: feeCents, taxMinor, totalMinor: feeCents + taxMinor };
}

function feeMinorOf(parsed: ReturnType<typeof parsePositiveDecimal>): bigint {
  if (parsed === null) return 0n;
  return parsed.n * 100n / (10n ** BigInt(String(parsed.d).length - 1 || 1));
}

route("PATCH", "/api/letters/:id", async (req, store, db) => {
  const row = await letterOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(row.state) === "accepted") {
    throw new HttpError(409, "accepted", ARTIST_COPY.letterAcceptedLock);
  }
  const body = jsonOf(req);
  const stamp = strOf(body, "stamp");
  if (stamp !== null && stamp !== String(row.stamp)) {
    const town: Town = "amsterdam";
    throw new HttpError(412, "stale", ARTIST_COPY.letterStale(wallTime(town, now()), "Amsterdam"), { stamp: "Read the letter again." });
  }
  const job = await jobRow(db, String(row.job_id));
  const letter = await letterFromBody(db, req, job, row);
  await db.query(
    "update letters set currency = $1, scope = $2, fee_minor = $3, tax_minor = $4, total_minor = $5, stamp = $6 where id = $7",
    [
      letter.currency,
      letter.scope,
      String(letter.feeMinor),
      String(letter.taxMinor),
      String(letter.totalMinor),
      newToken(),
      String(row.id),
    ],
  );
  // A sent letter's PDF is rendered again first, so an outage leaves it as it was.
  if (String(row.state) === "sent" && row.pdf_stored_at !== null) {
    await renderLetterPdf(req, store, db, row);
  }
  const after = await db.one("select * from letters where id = $1", [String(row.id)]);
  return jsonResponse(200, letterView(after!));
});

route("POST", "/api/letters/:id/send", async (req, store, db) => {
  const row = await letterOfDesk(db, req.session!.deskId, req.params.id!);
  if (String(row.state) === "accepted") {
    throw new HttpError(409, "accepted", ARTIST_COPY.letterAcceptedLock);
  }
  const body = jsonOf(req);
  const producerId = strOf(body, "producerId");
  if (producerId === null) {
    throw new HttpError(422, "producerId", "Pick a producer from the list.", { producerId: "Pick a producer from the list." });
  }
  const producer = await producerOfJob(db, String(row.job_id), producerId);
  const job = await jobRow(db, String(row.job_id));
  // The PDF is kept only after the PDF service has answered and the store
  // has confirmed.
  await renderLetterPdf(req, store, db, row);
  const token = newToken();
  const endsAt = now() + req.config.timers.feePageSeconds;
  await db.query(
    "update letters set state = 'sent', producer_id = $1, page_token = $2, page_ends_at = $3 where id = $4",
    [producerId, token, String(endsAt), String(row.id)],
  );
  await queueMail(db, {
    to: String(producer.email),
    subject: FEE_COPY.mailSubject(String(job.title)),
    body: [FEE_COPY.heading(String(job.title)), "", `${req.config.appPublicUrl}/f/${token}`].join("\n"),
    html: null,
    attachmentName: null,
    attachmentType: null,
    attachment: null,
  });
  const after = await db.one("select * from letters where id = $1", [String(row.id)]);
  await addHistory(db, String(row.job_id), "letterSent", String(producer.name), `Fee letter sent to ${String(producer.name)}.`);
  return jsonResponse(200, letterView(after!));
});

route("POST", "/api/letters/:id/end-page", async (req, _store, db) => {
  const row = await letterOfDesk(db, req.session!.deskId, req.params.id!);
  await db.query("update letters set page_token = null, page_ends_at = null where id = $1", [String(row.id)]);
  const after = await db.one("select * from letters where id = $1", [String(row.id)]);
  return jsonResponse(200, letterView(after!));
});

route("GET", "/api/letters/:id/pdf", async (req, store, db) => {
  const row = await letterOfDesk(db, req.session!.deskId, req.params.id!);
  if (row.pdf_stored_at === null) {
    throw new HttpError(404, "noPdf", "There is nothing at this address.");
  }
  const job = await jobRow(db, String(row.job_id));
  const data = await store.get(objectKey(String(job.client_id), String(job.id), `letters/${String(row.id)}/fee-letter.pdf`));
  if (data === null) throw new HttpError(404, "noPdf", "There is nothing at this address.");
  return bytesResponse(200, "application/pdf", data);
});

async function letterOfDesk(db: Db, deskId: string, letterId: string): Promise<Record<string, unknown>> {
  const row = await db.one(
    "select l.* from letters l join jobs j on j.id = l.job_id where l.id = $1 and j.desk_id = $2",
    [letterId, deskId],
  );
  if (row === null) throw new HttpError(404, "unknownLetter", "There is nothing at this address.");
  return row;
}

// A letter's PDF is rendered and kept through the handler's own store handle.
async function renderLetterPdf(req: Request, store: Store, db: Db, row: Record<string, unknown>): Promise<void> {
  const job = await jobRow(db, String(row.job_id));
  const currency = String(row.currency) as Currency;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm; }
  body { font-family: serif; }
  h1 { font-size: 16pt; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border-bottom: 0.3mm solid #000; padding: 3mm; text-align: left; font-size: 11pt; }
  </style></head><body>
  <h1>Fee letter for ${escapeHtml(String(job.title))}</h1>
  <p>${escapeHtml(String(row.scope))}</p>
  <table>
  <tr><th>Fee</th><td>${amountText(currency, BigInt(Number(row.fee_minor)))}</td></tr>
  <tr><th>Tax</th><td>${amountText(currency, BigInt(Number(row.tax_minor)))}</td></tr>
  <tr><th>Total</th><td>${amountText(currency, BigInt(Number(row.total_minor)))}</td></tr>
  </table>
  </body></html>`;
  let pdf: Buffer;
  try {
    pdf = await renderPdf(req.config, html);
  } catch {
    throw new HttpError(503, "pdfUnavailable", ARTIST_COPY.pdfUnavailable);
  }
  const put = await store.put(objectKey(String(job.client_id), String(job.id), `letters/${String(row.id)}/fee-letter.pdf`), pdf, "application/pdf");
  if (!put.ok) {
    throw new HttpError(503, "storeUnavailable", ARTIST_COPY.storeUnavailable);
  }
  await db.query("update letters set pdf_stored_at = $1 where id = $2", [String(now()), String(row.id)]);
}

// ---------------------------------------------------------------------------
// Enquiries
// ---------------------------------------------------------------------------

// At most 5 per window per address given, compared ignoring case; the sixth
// answers 429 with Retry-After.
route("POST", "/api/enquiries", async (req, _store, db) => {
  const body = jsonOf(req);
  const name = strOf(body, "name");
  const email = strOf(body, "email");
  const phone = strOf(body, "phone");
  const message = strOf(body, "message");
  if (name === null || name.trim().length === 0) {
    throw new HttpError(422, "name", COPY.typeAName, { name: COPY.typeAName });
  }
  if (email === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new HttpError(422, "email", COPY.typeAnEmail, { email: COPY.typeAnEmail });
  }
  if (message === null || message.trim().length === 0) {
    throw new HttpError(422, "message", VISITOR_COPY.enquiryMessage, { message: VISITOR_COPY.enquiryMessage });
  }
  const key = `enquiry:${email.trim().toLowerCase()}`;
  const windowStart = now() - req.config.timers.enquiryRateWindowSeconds;
  await db.query("delete from enquiry_rates where email_key = $1 and at <= $2", [key, String(windowStart)]);
  const held = await db.many("select at from enquiry_rates where email_key = $1", [key]);
  if (held.length >= 5) {
    const sorted = held.map((h) => Number(h.at)).sort((a, b) => a - b);
    const retryAt = sorted[0]! + req.config.timers.enquiryRateWindowSeconds;
    const retry = Math.ceil((retryAt - now()) / 60);
    throw new HttpError(
      429,
      "tooManyEnquiries",
      VISITOR_COPY.enquiryLimit(wallTime("amsterdam", retryAt)),
      null,
      { "Retry-After": String(Math.max(1, retry)) },
    );
  }
  await db.query("insert into enquiry_rates (email_key, at) values ($1, $2)", [key, String(now())]);
  await db.query("insert into enquiries (id, name, email, phone, message, created_at) values ($1, $2, $3, $4, $5, $6)", [
    newId(),
    name.trim(),
    email.trim(),
    phone === null ? null : phone,
    message,
    String(now()),
  ]);
  await queueMail(db, {
    to: MAIL_ADDRESS,
    subject: `Enquiry from ${name.trim()}`,
    body: [name.trim(), email.trim(), phone ?? "", "", message].join("\n"),
    html: null,
    attachmentName: null,
    attachmentType: null,
    attachment: null,
  });
  return jsonResponse(202, { message: VISITOR_COPY.enquiryThanks });
});

// ---------------------------------------------------------------------------
// Private pages, as the producer. No cookie is needed. An ended page answers
// 410 with code pageEnded and its language's ended copy; an unknown token 404.
// ---------------------------------------------------------------------------

route("GET", "/api/r/:token", async (req, _store, db) => {
  const page = await reviewByToken(db, req.params.token!);
  const producer = await db.one("select * from producers where id = $1", [String(page.producer_id)]);
  const job = await db.one("select * from jobs where id = $1", [String(page.job_id)]);
  const cutRow = await db.one("select * from cuts where job_id = $1 and number = $2", [String(page.job_id), Number(page.cut)]);
  const clips = await db.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow!.id)]);
  const frameRate = String(cutRow!.frame_rate) as FrameRate;
  let startFrame = 0;
  const frames: Json[] = [];
  for (const clip of clips) {
    frames.push({
      number: numberOf(db, clip),
      position: Number(clip.position),
      durationFrames: Number(clip.duration_frames),
      timecodeIn: timecode(startFrame, frameRate),
      actionNote: String(clip.action_note),
      drawingUrl: `/api/r/${req.params.token!}/frames/${numberOf(db, clip)}/drawing`,
    });
    startFrame += Number(clip.duration_frames);
  }
  const nameRow = await db.one("select name from review_names where review_id = $1", [String(page.id)]);
  const notes = await db.many("select * from notes where review_id = $1 order by created_at, id", [String(page.id)]);
  return jsonResponse(200, {
    language: String(producer!.language),
    jobTitle: String(job!.title),
    cut: Number(page.cut),
    frameRate,
    aspect: String(job!.aspect),
    dueDate: String(job!.due_date),
    endsAt: instantText(Number(page.ends_at)),
    name: nameRow === null ? null : String(nameRow.name),
    frames,
    notes: notes.map((n) => ({
      id: String(n.id),
      frame: Number(n.frame),
      x: Number(n.x),
      y: Number(n.y),
      text: String(n.text),
      suggestedSeconds: n.suggested_seconds === null ? null : Number(n.suggested_seconds),
      suggestedFrames: n.suggested_frames === null ? null : Number(n.suggested_frames),
      attachmentUrl: n.attachment_id === null ? null : `/api/r/${req.params.token!}/attachments/${String(n.attachment_id)}`,
      createdAt: instantText(Number(n.created_at)),
    })),
  });
});

async function reviewByToken(db: Db, token: string): Promise<Record<string, unknown>> {
  const row = await db.one("select * from reviews where token = $1", [token]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const client = await db.one(
    "select c.state from clients c join jobs j on j.id = $1 join clients c2 on c2.id = j.client_id where c.id = c2.id",
    [String(row.job_id)],
  );
  void client;
  const job = await db.one("select client_id from jobs where id = $1", [String(row.job_id)]);
  const clientRow = await db.one("select state from clients where id = $1", [String(job!.client_id)]);
  const ended = String(row.state) !== "open" || Number(row.ends_at) <= now() || String(clientRow!.state) !== "active";
  if (ended) {
    const producer = await db.one("select language from producers where id = $1", [String(row.producer_id)]);
    throw new HttpError(410, "pageEnded", PRIVATE_COPY[String(producer!.language) as Language].ended);
  }
  return row;
}

route("GET", "/api/r/:token/frames/:number/drawing", async (req, store, db) => {
  const page = await db.one("select * from reviews where token = $1", [req.params.token!]);
  if (page === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const cutRow = await db.one("select * from cuts where job_id = $1 and number = $2", [
    String(page.job_id),
    Number(page.cut),
  ]);
  const clip = await db.one("select * from cut_frames where cut_id = $1 order by position", [String(cutRow!.id)]);
  void clip;
  const clips = await db.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow!.id)]);
  const found = clips.find((c) => numberOf(db, c) === Number(req.params.number));
  if (found === undefined) throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  const job = await db.one("select * from jobs where id = $1", [String(page.job_id)]);
  if (found.sha256 !== null) {
    const data = await store.get(objectKey(String(job!.client_id), String(job!.id), `frames/${String(found.sha256)}`));
    if (data !== null) return bytesResponse(200, imageMimeOf(data), data);
  }
  if (Boolean(found.seeded)) {
    return textResponse(200, "image/svg+xml", seededDrawing(numberOf(db, found), String(found.action_note)).toString("utf8"));
  }
  throw new HttpError(404, "noDrawing", "There is nothing at this address.");
});

// A suggested length typed the local way is stored exactly and shows in
// frames at the job's rate; the other language's form is refused with that
// language's number copy.
route("POST", "/api/r/:token/length", async (req, _store, db) => {
  const page = await reviewByToken(db, req.params.token!);
  const body = jsonOf(req);
  const length = strOf(body, "length");
  if (length === null) {
    throw new HttpError(422, "length", "Type a length.", { length: "Type a length." });
  }
  const producer = await db.one("select * from producers where id = $1", [String(page.producer_id)]);
  const language = String(producer!.language) as Language;
  const job = await db.one("select * from jobs where id = $1", [String(page.job_id)]);
  const parsed = parseLocalNumber(length, language);
  if (parsed === null) {
    throw new HttpError(422, "length", PRIVATE_COPY[language].numberCopy, {
      length: PRIVATE_COPY[language].numberCopy,
    });
  }
  if (parsed.cents > 6000n || parsed.cents === 0n) {
    throw new HttpError(422, "length", PRIVATE_COPY[language].numberCopy, {
      length: PRIVATE_COPY[language].numberCopy,
    });
  }
  const value = new Rat(parsed.cents, 100n);
  const seconds = `${value.n / value.d}${value.n % value.d === 0n ? "" : "." + trailing(value)}`;
  const frameRate = String(job!.frame_rate) as FrameRate;
  const frames = Number(value.mul(shared.RATE_RAT[frameRate]).roundHalfUp());
  return jsonResponse(200, { seconds, frames });
});

function trailing(value: Rat): string {
  const scaled = value.n * 1000n / value.d;
  return (scaled % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
}

// A length is above 0, at most 60, with at most 3 decimals, typed the local
// way: `1.5` in English and Arabic, `1,5` in Dutch and French, with Arabic
// digits accepted in Arabic.
function parseLocalNumber(text: string, language: Language): { cents: bigint } | null {
  const arabicDigits = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const decimalPoint = language === "nl" || language === "fr" ? "," : ".";
  const otherPoint = decimalPoint === "," ? "." : ",";
  if (arabicDigits.includes(otherPoint)) return null;
  const m = new RegExp(`^(\\d+)(?:${decimalPoint === "," ? "," : "\\."}(\\d{1,3}))?$`).exec(arabicDigits.trim());
  if (m === null) return null;
  const whole = BigInt(m[1]!);
  const fracText = m[2] ?? "";
  const frac = fracText.length === 0 ? 0n : BigInt(fracText);
  const cents = whole * 100n + (frac * 100n) / 10n ** BigInt(fracText.length);
  if (whole > 60n) return null;
  return { cents };
}

route("POST", "/api/r/:token/attachments", async (req, store, db) => {
  const page = await reviewByToken(db, req.params.token!);
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new HttpError(415, "unsupportedType", "Send the file as multipart form data.");
  }
  const parts = parseMultipart(req.body, contentType);
  const file = findFile(parts, "file");
  if (file === null) {
    throw new HttpError(422, "file", PRIVATE_COPY.en.badAttachment, { file: PRIVATE_COPY.en.badAttachment });
  }
  if (file.data.length > ATTACHMENT_FILE_LIMIT) {
    const producer = await db.one("select language from producers where id = $1", [String(page.producer_id)]);
    const copy = PRIVATE_COPY[String(producer!.language) as Language];
    throw new HttpError(413, "tooLarge", copy.bigAttachment);
  }
  const image = readImage(file.data);
  if (image === null) {
    const producer = await db.one("select language from producers where id = $1", [String(page.producer_id)]);
    const copy = PRIVATE_COPY[String(producer!.language) as Language];
    throw new HttpError(422, "file", copy.badAttachment, { file: copy.badAttachment });
  }
  const job = await db.one("select * from jobs where id = $1", [String(page.job_id)]);
  const id = newId();
  const put = await store.put(objectKey(String(job!.client_id), String(job!.id), `attachments/${id}`), file.data, imageMimeOf(file.data));
  if (!put.ok) {
    throw new HttpError(503, "storeUnavailable", "The file store is unavailable right now.");
  }
  await db.query("insert into attachments (id, job_id, producer_id, content_type) values ($1, $2, $3, $4)", [
    id,
    String(page.job_id),
    String(page.producer_id),
    imageMimeOf(file.data),
  ]);
  return jsonResponse(201, { attachmentId: id });
});

route("GET", "/api/r/:token/attachments/:id", async (req, store, db) => {
  const page = await db.one("select * from reviews where token = $1", [req.params.token!]);
  if (page === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const row = await db.one("select * from attachments where id = $1", [req.params.id!]);
  if (row === null || String(row.producer_id) !== String(page.producer_id)) {
    throw new HttpError(404, "noAttachment", "There is nothing at this address.");
  }
  const job = await db.one("select * from jobs where id = $1", [String(page.job_id)]);
  const data = await store.get(objectKey(String(job!.client_id), String(job!.id), `attachments/${req.params.id!}`));
  if (data === null) throw new HttpError(404, "noAttachment", "There is nothing at this address.");
  return bytesResponse(200, String(row.content_type), data);
});

// Pressing Send notes twice sends once: the same sendKey answers the first
// answer again and stores nothing.
route("POST", "/api/r/:token/notes", async (req, store, db) => {
  const page = await reviewByToken(db, req.params.token!);
  const body = jsonOf(req);
  const sendKey = strOf(body, "sendKey");
  const name = strOf(body, "name");
  const notes = body.notes;
  if (sendKey === null || name === null || !Array.isArray(notes)) {
    throw new HttpError(422, "shape", "Type your name and your notes.", { name: PRIVATE_COPY.en.emptyName });
  }
  const producer = await db.one("select * from producers where id = $1", [String(page.producer_id)]);
  const language = String(producer!.language) as Language;
  if (name.trim().length === 0) {
    throw new HttpError(422, "name", PRIVATE_COPY[language].emptyName, { name: PRIVATE_COPY[language].emptyName });
  }
  for (const raw of notes) {
    const note = raw as Record<string, unknown>;
    const text = typeof note.text === "string" ? note.text : "";
    if (text.trim().length === 0) {
      throw new HttpError(422, "text", PRIVATE_COPY[language].emptyNote, { text: PRIVATE_COPY[language].emptyNote });
    }
  }
  const sent = await db.one("select id from review_sends where send_key = $1", [sendKey]);
  if (sent !== null) {
    const held = await db.many("select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id where n.review_id = $1", [String(sent.review_id)]);
    return jsonResponse(200, { notes: held.map((r) => noteView(db, r)) });
  }
  const job = await db.one("select * from jobs where id = $1", [String(page.job_id)]);
  const frameRate = String(job!.frame_rate) as FrameRate;
  const created: Record<string, unknown>[] = [];
  for (const raw of notes) {
    const note = raw as Record<string, unknown>;
    const frame = Number(note.frame);
    const x = Number(note.x);
    const y = Number(note.y);
    const text = String(note.text);
    const suggested = typeof note.suggestedLength === "string" ? note.suggestedLength : null;
    const attachmentId = typeof note.attachmentId === "string" ? note.attachmentId : null;
    let suggestedSeconds: string | null = null;
    let suggestedFrames: number | null = null;
    if (suggested !== null) {
      const parsed = parseLocalNumber(suggested, language);
      if (parsed !== null) {
        const value = new Rat(parsed.cents, 100n);
        suggestedSeconds = `${value.n / value.d}${value.n % value.d === 0n ? "" : "." + trailing(value)}`;
        suggestedFrames = Number(value.mul(shared.RATE_RAT[frameRate]).roundHalfUp());
      }
    }
    const id = newId();
    await db.query(
      "insert into notes (id, job_id, review_id, producer_id, frame, x, y, text, typed_name, suggested_seconds, suggested_frames, attachment_id, state, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)",
      [
        id,
        String(page.job_id),
        String(page.id),
        String(page.producer_id),
        frame,
        String(x),
        String(y),
        text,
        name.trim(),
        suggestedSeconds,
        suggestedFrames === null ? null : String(suggestedFrames),
        attachmentId,
        "open",
        String(now()),
      ],
    );
    const row = await db.one(
      "select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id where n.id = $1",
      [id],
    );
    created.push(row!);
  }
  await db.query("insert into review_sends (id, review_id, send_key) values ($1, $2, $3)", [
    newId(),
    String(page.id),
    sendKey,
  ]);
  await db.query("insert into review_names (review_id, name) values ($1, $2)", [String(page.id), name.trim()]);
  await addHistory(db, String(page.job_id), "noteSent", String(producer!.name), `${String(producer!.name)} left ${created.length} note${created.length === 1 ? "" : "s"}.`);
  void store;
  return jsonResponse(201, { notes: created.map((r) => noteView(db, r)) });
});

// Ask for a new link: the same words and status for known and unknown
// addresses, at most 3 per window per address.
route("POST", "/api/r/:token/new-link", async (req, _store, db) => {
  const body = jsonOf(req);
  const email = strOf(body, "email");
  if (email === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new HttpError(422, "email", COPY.typeAnEmail, { email: COPY.typeAnEmail });
  }
  const key = `link:${email.trim().toLowerCase()}`;
  const windowStart = now() - req.config.timers.reviewLinkRateWindowSeconds;
  await db.query("delete from link_rates where email_key = $1 and at <= $2", [key, String(windowStart)]);
  const held = await db.many("select at from link_rates where email_key = $1", [key]);
  if (held.length >= 3) {
    const sorted = held.map((h) => Number(h.at)).sort((a, b) => a - b);
    const retryAt = sorted[0]! + req.config.timers.reviewLinkRateWindowSeconds;
    throw new HttpError(429, "tooManyRequests", PRIVATE_COPY.en.linkLimit, null, {
      "Retry-After": String(Math.max(1, retryAt - now())),
    });
  }
  await db.query("insert into link_rates (email_key, at) values ($1, $2)", [key, String(now())]);
  // The answer's words are the same for every address; the mail only goes to
  // an address that belongs to this page's producer.
  const page = await db.one("select * from reviews where token = $1", [req.params.token!]);
  if (page !== null) {
    const producer = await db.one("select * from producers where id = $1", [String(page.producer_id)]);
    if (producer !== null && String(producer.email).toLowerCase() === email.trim().toLowerCase()) {
      const language = String(producer!.language) as Language;
      const copy = PRIVATE_COPY[language];
      const job = await db.one("select * from jobs where id = $1", [String(page.job_id)]);
      const token = newToken();
      const town = String(producer!.town) as Town;
      const endsAt = board.pageEndsAt(town, String(job!.due_date), now(), req.config.timers.reviewPageSeconds);
      await db.query("update reviews set token = $1, ends_at = $2, created_at = $3, reminded = 't' where id = $4", [
        token,
        String(endsAt),
        String(now()),
        String(page.id),
      ]);
      await queueMail(db, {
        to: String(producer!.email),
        subject: copy.mailNewLinkSubject,
        body: [copy.mailNewLinkSubject, "", `${req.config.appPublicUrl}/r/${token}`].join("\n"),
        html: null,
        attachmentName: null,
        attachmentType: null,
        attachment: null,
      });
    }
  }
  return jsonResponse(202, { message: PRIVATE_COPY.en.linkAnswer });
});

route("GET", "/api/s/:token", async (req, _store, db) => {
  const page = await signOffByToken(db, req.params.token!);
  const producer = await db.one("select * from producers where id = $1", [String(page.producer_id)]);
  const job = await db.one("select * from jobs where id = $1", [String(page.job_id)]);
  const cutRow = await db.one("select * from cuts where job_id = $1 and number = $2", [String(page.job_id), Number(page.cut)]);
  const clips = await db.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow!.id)]);
  const frameRate = String(cutRow!.frame_rate) as FrameRate;
  let startFrame = 0;
  const frames = clips.map((clip) => {
    const view = {
      number: numberOf(db, clip),
      position: Number(clip.position),
      durationFrames: Number(clip.duration_frames),
      timecodeIn: timecode(startFrame, frameRate),
      actionNote: String(clip.action_note),
      drawingUrl: `/api/s/${req.params.token!}/frames/${numberOf(db, clip)}/drawing`,
    };
    startFrame += Number(clip.duration_frames);
    return view;
  });
  const language = String(producer!.language) as Language;
  const copy = PRIVATE_COPY[language];
  const when =
    page.signed_off_at === null
      ? null
      : `${wallTime(String(producer!.town) as Town, Number(page.signed_off_at))} ${TOWN_TIME_PHRASE_TEXT[String(producer!.town)][language]}`;
  return jsonResponse(200, {
    language,
    jobTitle: String(job!.title),
    cut: Number(page.cut),
    frameRate,
    endsAt: instantText(Number(page.ends_at)),
    signedOffAt: page.signed_off_at === null ? null : instantText(Number(page.signed_off_at)),
    signedOffText: page.signed_off_at === null ? null : copy.signed.replace("<when>", when ?? ""),
    frames,
  });
});

const TOWN_TIME_PHRASE_TEXT: Record<string, Record<Language, string>> = {
  amsterdam: { en: "Amsterdam time", nl: "tijd in Amsterdam", fr: "heure d'Amsterdam", ar: "بتوقيت أمستردام" },
  newYork: { en: "New York time", nl: "tijd in New York", fr: "heure de New York", ar: "بتوقيت نيويورك" },
  toronto: { en: "Toronto time", nl: "tijd in Toronto", fr: "heure de Toronto", ar: "بتوقيت تورنتو" },
  dubai: { en: "Dubai time", nl: "tijd in Dubai", fr: "heure de Dubaï", ar: "بتوقيت دبي" },
};

async function signOffByToken(db: Db, token: string): Promise<Record<string, unknown>> {
  const row = await db.one("select * from sign_offs where token = $1", [token]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const job = await db.one("select client_id from jobs where id = $1", [String(row.job_id)]);
  const clientRow = await db.one("select state from clients where id = $1", [String(job!.client_id)]);
  const ended = String(row.state) !== "open" || Number(row.ends_at) <= now() || String(clientRow!.state) !== "active";
  if (ended) {
    const producer = await db.one("select language from producers where id = $1", [String(row.producer_id)]);
    throw new HttpError(410, "pageEnded", PRIVATE_COPY[String(producer!.language) as Language].ended);
  }
  return row;
}

// The name typed must equal the name held on the producer by the folding
// table. Name is judged before state.
route("POST", "/api/s/:token/sign", async (req, _store, db) => {
  const page = await db.one("select * from sign_offs where token = $1", [req.params.token!]);
  if (page === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const producer = await db.one("select * from producers where id = $1", [String(page.producer_id)]);
  const language = String(producer!.language) as Language;
  const copy = PRIVATE_COPY[language];
  const body = jsonOf(req);
  const name = strOf(body, "name");
  if (name === null || foldForCompare(name.trim()) !== foldForCompare(String(producer!.name))) {
    throw new HttpError(422, "name", copy.wrongName, { name: copy.wrongName });
  }
  if (page.signed_off_at !== null) {
    const when = `${wallTime(String(producer!.town) as Town, Number(page.signed_off_at))} ${TOWN_TIME_PHRASE_TEXT[String(producer!.town)][language]}`;
    throw new HttpError(409, "alreadySigned", copy.alreadySigned.replace("<when>", when));
  }
  // A cut with a newer one on its job answers 409, printing when that newer cut
  // was made in the producer's town.
  const newer = await db.one(
    "select * from cuts where job_id = $1 and number > $2 order by number desc limit 1",
    [String(page.job_id), Number(page.cut)],
  );
  if (newer !== null) {
    const when = `${wallTime(String(producer!.town) as Town, Number(newer.created_at))} ${TOWN_TIME_PHRASE_TEXT[String(producer!.town)][language]}`;
    throw new HttpError(409, "newerCut", copy.newerCut.replace("<when>", when));
  }
  const at = now();
  await db.query("update sign_offs set signed_off_at = $1, signed_off_by = $2 where id = $3", [
    String(at),
    String(producer!.name),
    String(page.id),
  ]);
  await db.query("update cuts set signed_off_at = $1, signed_off_by = $2 where job_id = $3 and number = $4", [
    String(at),
    String(producer!.name),
    String(page.job_id),
    Number(page.cut),
  ]);
  await db.query("update jobs set state = 'signedOff' where id = $1", [String(page.job_id)]);
  await addHistory(db, String(page.job_id), "signedOff", String(producer!.name), `Cut ${Number(page.cut)} signed off by ${String(producer!.name)}.`);
  const when = `${wallTime(String(producer!.town) as Town, at)} ${TOWN_TIME_PHRASE_TEXT[String(producer!.town)][language]}`;
  return jsonResponse(200, { signedOffAt: instantText(at), signedOffText: copy.signed.replace("<when>", when) });
});

route("GET", "/api/s/:token/frames/:number/drawing", async (req, store, db) => {
  const page = await db.one("select * from sign_offs where token = $1", [req.params.token!]);
  if (page === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const cutRow = await db.one("select * from cuts where job_id = $1 and number = $2", [
    String(page.job_id),
    Number(page.cut),
  ]);
  const clips = await db.many("select * from cut_frames where cut_id = $1 order by position", [String(cutRow!.id)]);
  const found = clips.find((c) => numberOf(db, c) === Number(req.params.number));
  if (found === undefined) throw new HttpError(404, "unknownFrame", "There is nothing at this address.");
  const job = await db.one("select * from jobs where id = $1", [String(page.job_id)]);
  if (found.sha256 !== null) {
    const data = await store.get(objectKey(String(job!.client_id), String(job!.id), `frames/${String(found.sha256)}`));
    if (data !== null) return bytesResponse(200, imageMimeOf(data), data);
  }
  if (Boolean(found.seeded)) {
    return textResponse(200, "image/svg+xml", seededDrawing(numberOf(db, found), String(found.action_note)).toString("utf8"));
  }
  throw new HttpError(404, "noDrawing", "There is nothing at this address.");
});

route("GET", "/api/f/:token", async (req, _store, db) => {
  const row = await db.one("select * from letters where page_token = $1", [req.params.token!]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const job = await jobRow(db, String(row.job_id));
  const ended = String(row.state) !== "sent" || row.page_ends_at === null || Number(row.page_ends_at) <= now();
  if (ended) {
    throw new HttpError(410, "pageEnded", PRIVATE_COPY.en.ended);
  }
  const currency = String(row.currency) as Currency;
  return jsonResponse(200, {
    jobTitle: String(job.title),
    currency,
    feeText: amountText(currency, BigInt(Number(row.fee_minor))),
    taxText: amountText(currency, BigInt(Number(row.tax_minor))),
    totalText: amountText(currency, BigInt(Number(row.total_minor))),
    milestones: milestonesOf(currency, BigInt(Number(row.fee_minor)), BigInt(Number(row.tax_minor))),
    state: String(row.state),
    stamp: String(row.stamp),
    endsAt: instantText(Number(row.page_ends_at)),
    pdfUrl: `/api/f/${req.params.token!}/pdf`,
  });
});

route("GET", "/api/f/:token/pdf", async (req, store, db) => {
  const row = await db.one("select * from letters where page_token = $1", [req.params.token!]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const job = await jobRow(db, String(row.job_id));
  const data = await store.get(objectKey(String(job.client_id), String(job.id), `letters/${String(row.id)}/fee-letter.pdf`));
  if (data === null) throw new HttpError(404, "noPdf", "There is nothing at this address.");
  return bytesResponse(200, "application/pdf", data);
});

route("POST", "/api/f/:token/accept", async (req, _store, db) => {
  const row = await db.one("select * from letters where page_token = $1", [req.params.token!]);
  if (row === null) throw new HttpError(404, "unknownPage", "There is nothing at this address.");
  const ended = String(row.state) !== "sent" || row.page_ends_at === null || Number(row.page_ends_at) <= now();
  if (ended) throw new HttpError(410, "pageEnded", PRIVATE_COPY.en.ended);
  const body = jsonOf(req);
  const name = strOf(body, "name");
  const stamp = strOf(body, "stamp");
  const producer = await db.one("select * from producers where id = $1", [String(row.producer_id)]);
  if (name === null || producer === null || foldForCompare(name.trim()) !== foldForCompare(String(producer.name))) {
    throw new HttpError(422, "name", "That name doesn't match. Type your full name as it was given.", { name: "That name doesn't match. Type your full name as it was given." });
  }
  if (stamp !== String(row.stamp)) {
    throw new HttpError(412, "stale", ARTIST_COPY.letterStale(wallTime("amsterdam", now()), "Amsterdam"), {
      stamp: "Read the letter again.",
    });
  }
  await db.query("update letters set state = 'accepted', accepted_at = $1, accepted_by = $2 where id = $3", [
    String(now()),
    producer === null ? "" : String(producer.name),
    String(row.id),
  ]);
  await addHistory(db, String(row.job_id), "letterAccepted", producer === null ? "" : String(producer.name), `Letter accepted by ${producer === null ? "" : String(producer.name)}.`);
  return jsonResponse(200, { state: "accepted" });
});

// ---------------------------------------------------------------------------
// Timed work the server alone decides
// ---------------------------------------------------------------------------

// Exactly one reminder goes out after the window, only if no note was sent
// and the page is still open.
async function tickReminders(config: Config, db: Db, at: Instant): Promise<void> {
  const due = await db.many(
    "select r.*, p.email as email, p.language as language, j.title as title, j.due_date as due_date, c.state as client_state from reviews r join producers p on p.id = r.producer_id join jobs j on j.id = r.job_id join clients c on c.id = j.client_id where r.state = 'open' and r.reminded = 'f'",
    [],
  );
  for (const row of due) {
    if (String(row.client_state) !== "active") continue;
    if (Number(row.ends_at) <= at) continue;
    const sentAt = Number(row.created_at);
    if (at < sentAt + config.timers.reminderAfterSeconds) continue;
    const notes = await db.one("select count(*) as n from notes where review_id = $1", [String(row.id)]);
    if (Number(notes!.n) > 0) continue;
    await db.query("update reviews set reminded = 't' where id = $1", [String(row.id)]);
    await queueReviewMail(config, db, {
      to: String(row.email),
      language: String(row.language) as Language,
      jobTitle: String(row.title),
      url: `${config.appPublicUrl}/r/${String(row.token)}`,
      dueDate: String(row.due_date),
      reminder: true,
    });
  }
}

// Erasure always asks the store first, tries again at least every 10 seconds
// while it is down, and deletes the client's data once it confirms.
async function tickErasure(db: Db, store: Store, at: Instant): Promise<void> {
  const rows = await db.many("select * from clients where state = 'erasing'", []);
  for (const client of rows) {
    const last = Number(client.erasure_tried_at ?? 0);
    if (at - last < 10) continue;
    await db.query("update clients set erasure_tried_at = $1 where id = $2", [String(at), String(client.id)]);
    const jobs = await db.many("select * from jobs where client_id = $1", [String(client.id)]);
    let allOk = true;
    for (const job of jobs) {
      const frames = await db.many("select * from frames where job_id = $1", [String(job.id)]);
      for (const frame of frames) {
        if (frame.sha256 !== null) {
          const removed = await store.remove(objectKey(String(client.id), String(job.id), `frames/${String(frame.sha256)}`));
          if (!removed.ok) allOk = false;
        }
      }
      const attachments = await db.many("select * from attachments where job_id = $1", [String(job.id)]);
      for (const a of attachments) {
        const removed = await store.remove(objectKey(String(client.id), String(job.id), `attachments/${String(a.id)}`));
        if (!removed.ok) allOk = false;
      }
      const renders = await db.many("select * from renders where job_id = $1", [String(job.id)]);
      for (const r of renders) {
        const removed = await store.remove(objectKey(String(client.id), String(job.id), `films/${String(r.id)}`));
        if (!removed.ok) allOk = false;
      }
      const packages = await db.many("select * from packages where job_id = $1", [String(job.id)]);
      for (const p of packages) {
        for (const name of ["boards.pdf", "edit-decision-list.edl", "shot-list.csv"]) {
          const removed = await store.remove(objectKey(String(client.id), String(job.id), `packages/${String(p.id)}/${name}`));
          if (!removed.ok) allOk = false;
        }
      }
      const letters = await db.many("select * from letters where job_id = $1", [String(job.id)]);
      for (const l of letters) {
        const removed = await store.remove(objectKey(String(client.id), String(job.id), `letters/${String(l.id)}/fee-letter.pdf`));
        if (!removed.ok) allOk = false;
      }
    }
    if (!allOk) continue;
    // The store confirmed each deletion: the client's data goes.
    await db.query("delete from notes where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from attachments where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from review_sends where review_id in (select id from reviews where job_id in (select id from jobs where client_id = $1))", [String(client.id)]);
    await db.query("delete from review_names where review_id in (select id from reviews where job_id in (select id from jobs where client_id = $1))", [String(client.id)]);
    await db.query("delete from reviews where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from sign_offs where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from package_files where package_id in (select id from packages where job_id in (select id from jobs where client_id = $1))", [String(client.id)]);
    await db.query("delete from packages where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from letters where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from renders where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from cues where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from lines where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from job_history where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from board_stamps where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from cut_frames where cut_id in (select id from cuts where job_id in (select id from jobs where client_id = $1))", [String(client.id)]);
    await db.query("delete from cuts where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from removals where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from frames where job_id in (select id from jobs where client_id = $1)", [String(client.id)]);
    await db.query("delete from jobs where client_id = $1", [String(client.id)]);
    await db.query("delete from pending_mail where to_address in (select email from producers where client_id = $1)", [String(client.id)]);
    await db.query("delete from producers where client_id = $1", [String(client.id)]);
    await db.query("update clients set state = 'erased', erased_at = $1 where id = $2", [String(at), String(client.id)]);
  }
}

// The wait ends exactly at closesAt: from that instant the client reads
// `erasing`, never `closing`.
async function tickClientWaits(db: Db, at: Instant): Promise<void> {
  await db.query("update clients set state = 'erasing' where state = 'closing' and closes_at is not null and closes_at <= $1", [
    String(at),
  ]);
}

