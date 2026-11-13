import type { ServerResponse, IncomingMessage } from "node:http";
import crypto from "node:crypto";
import { db, s3, cfg, storageAvailable, setStorageDown } from "./runtime.js";
import { clock } from "./clock.js";
import { hub } from "./events.js";
import * as E from "./errors.js";
import { randomToken, bookingCode, storePreferences, completedStaysCount, type Ctx } from "./context.js";
import { getProperty, getRoomTypes, inventoryFor, occupancyFor, priceRoom, type PropertyRow, type RoomTypeRow } from "./inventory.js";
import { checkStay, arrivalCheck, type NightInventory, type Reason } from "../domain/restrictions.js";
import { eachNight, nightsBetween, zoneDate, addDays, toDate, iso } from "../domain/dates.js";
import { normaliseQuery, canonicalString, type SearchParams, type Notice } from "../domain/params.js";
import { recommend, placeOverride, compareCandidates, type RoomTypeLite, type PlacedRoom } from "./allocation.js";
import { priceNight, tierFor, roomAmountOf, type Plan, type PriceLine } from "../domain/pricing.js";
import { convertTotal, splitAcrossNights, DECIMALS, type CurrencyCode, type RatesPpm, CURRENCIES, DEFAULT_RATES } from "../domain/money.js";
import { RateLimiter } from "./ratelimit.js";
import type { Lang } from "../domain/messages.js";

const loginLimiter = new RateLimiter(cfg.loginRate);
const lookupLimiter = new RateLimiter(cfg.lookupRate);
const searchLimiter = new RateLimiter(cfg.searchRate);

export type RouteResult = E.ApiError | { status: number; body: unknown; headers?: Record<string, string> } | "handled" | null;

// ---------------------------------------------------------------------------
// helpers

function json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): "handled" {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(headers ?? {}) });
  res.end(JSON.stringify(body));
  return "handled";
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | E.ApiError> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (c: Buffer) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) {
        done = true;
        // stop reading but drain the rest so the client keeps its connection
        req.pause();
        resolve(E.tooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on("close", () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
  });
}

async function readJson(req: IncomingMessage): Promise<{ data: Record<string, unknown> } | E.ApiError> {
  const ct = (req.headers["content-type"] ?? "").split(";")[0].trim();
  if (ct !== "application/json") return E.unsupportedMedia();
  const body = await readBody(req, 65536);
  if (isErr(body)) return body;
  try {
    const data = JSON.parse(body.toString("utf-8") || "{}");
    if (typeof data !== "object" || data === null || Array.isArray(data)) return E.validation({ "": "invalid" });
    return { data: data as Record<string, unknown> };
  } catch {
    return E.validation({ "": "invalid" });
  }
}

function isErr(x: unknown): x is E.ApiError {
  return typeof x === "object" && x !== null && "status" in x && "body" in x && !("handled" in x);
}

function ratesOf(row: { code: string; ppm: string | number }[]): RatesPpm {
  const out = {} as RatesPpm;
  for (const r of row) out[r.code as CurrencyCode] = Number(r.ppm);
  return out;
}

export async function currentRates(): Promise<RatesPpm> {
  const r = await db.query("SELECT code, ppm FROM currency");
  if (r.rows.length === 4) return ratesOf(r.rows);
  return DEFAULT_RATES;
}

function reasonFields(reason: Reason): { code: string; date?: string; n?: number } {
  const out: { code: string; date?: string; n?: number } = { code: reason.code };
  if (reason.date !== undefined) out.date = reason.date;
  if (reason.n !== undefined) out.n = reason.n;
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function int(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

// ---------------------------------------------------------------------------
// route dispatch

export async function route(req: IncomingMessage, res: ServerResponse, pathname: string, url: URL, ctx: Ctx, writeCookies: () => void): Promise<RouteResult> {
  const method = req.method ?? "GET";
  const segs = pathname.split("/").filter(Boolean); // ["api", ...]
  const now = clock.value();

  // ---- grading routes (404 unless enabled)
  if (segs[1] === "grading") {
    if (!cfg.grading) return E.notFound();
    return gradingRoute(req, res, method, pathname, ctx, writeCookies);
  }
  // ---- core
  if (pathname === "/api/time" && method === "GET") {
    return json(res, 200, { now: clock.now().toISOString() });
  }
  if (pathname === "/api/currency" && method === "GET") {
    return json(res, 200, await currentRates());
  }
  if (pathname === "/api/destinations" && method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const rows = await db.query(
      `SELECT d.code, d.name, d.zone, d.cx, d.cy,
              (SELECT count(*)::int FROM properties p WHERE p.destination = d.code) AS property_count
       FROM destinations d ORDER BY d.name`
    );
    const list = rows.rows.filter((r: { name: string }) => q === "" || r.name.toLowerCase().includes(q.toLowerCase()));
    return json(res, 200, list);
  }
  // ---- accounts
  if (pathname === "/api/signup" && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    const username = str(parsed.data.username) ?? "";
    const password = str(parsed.data.password) ?? "";
    return signup(res, ctx, username, password, writeCookies);
  }
  if (pathname === "/api/signin" && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    const username = str(parsed.data.username) ?? "";
    const password = str(parsed.data.password) ?? "";
    if (!loginLimiter.take("user:" + username.toLowerCase(), now)) return E.rateLimited(loginLimiter.retryAfter(now));
    return signin(res, ctx, username, password, writeCookies);
  }
  if (pathname === "/api/signout" && method === "POST") return signout(res, ctx, false, writeCookies);
  if (pathname === "/api/signout-everywhere" && method === "POST") return signout(res, ctx, true, writeCookies);
  if (pathname === "/api/me" && method === "GET") return json(res, 200, await mePayload(ctx));
  if (pathname === "/api/me/preferences" && method === "PATCH") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return patchPreferences(res, ctx, parsed.data);
  }
  if (pathname === "/api/inbox" && method === "GET") return inboxRoute(res, ctx);

  // ---- search and properties
  if (pathname === "/api/search" && method === "GET") {
    if (!searchLimiter.take("v:" + ctx.visitorId, now)) return E.rateLimited(searchLimiter.retryAfter(now));
    return searchRoute(res, ctx, url);
  }
  if (pathname === "/api/dates" && method === "GET") return datesRoute(res, ctx, url);
  if (segs[1] === "properties" && segs.length === 3 && method === "GET") {
    return propertyRoute(res, ctx, url, segs[2]);
  }
  if (pathname === "/api/allocations" && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return allocationRoute(res, ctx, parsed.data);
  }
  // ---- quotes, holds, bookings
  if (pathname === "/api/quotes" && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return createQuote(req, res, ctx, parsed.data);
  }
  if (segs[1] === "quotes" && segs.length === 3 && method === "GET") {
    return getQuote(res, ctx, segs[2]);
  }
  if (pathname === "/api/holds" && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return createHold(res, ctx, parsed.data);
  }
  if (segs[1] === "holds" && segs.length === 3 && method === "DELETE") {
    return deleteHold(res, ctx, segs[2]);
  }
  if (pathname === "/api/bookings" && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return createBooking(req, res, ctx, parsed.data);
  }
  if (pathname === "/api/bookings/find" && method === "POST") {
    if (!lookupLimiter.take("v:" + ctx.visitorId, now)) return E.rateLimited(lookupLimiter.retryAfter(now));
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return findBooking(res, ctx, parsed.data);
  }
  if (segs.length === 3 && segs[1] === "bookings" && method === "GET") return getBooking(res, ctx, segs[2]);
  if (segs.length === 5 && segs[1] === "bookings" && segs[3] === "cancellations" && segs[4] === "preview" && method === "GET") {
    return cancelPreview(res, ctx, segs[2], url);
  }
  if (segs.length === 4 && segs[1] === "bookings" && segs[3] === "cancellations" && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return cancelBooking(req, res, ctx, segs[2], parsed.data);
  }
  if (segs.length === 5 && segs[1] === "bookings" && segs[3] === "changes" && segs[4] === "preview" && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return changePreview(res, ctx, segs[2], parsed.data);
  }
  if (segs.length === 4 && segs[1] === "bookings" && segs[3] === "changes" && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return changeBooking(req, res, ctx, segs[2], parsed.data);
  }
  if (segs.length === 4 && segs[1] === "bookings" && segs[3] === "no-show" && method === "POST") {
    return noShow(req, res, ctx, segs[2]);
  }
  // ---- reviews
  if (segs[1] === "reviews" && segs.length === 3 && method === "GET") return getReview(res, ctx, segs[2]);
  if (segs[1] === "reviews" && segs.length === 3 && method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return postReview(res, ctx, segs[2], parsed.data);
  }
  // ---- moderation
  if (pathname === "/api/moderation/reviews" && method === "GET") return moderationList(res, ctx);
  if (segs[1] === "moderation" && segs[4] === "publish" && method === "POST" && segs.length === 5) return moderateReview(res, ctx, segs[3], "published");
  if (segs[1] === "moderation" && segs[4] === "reject" && method === "POST" && segs.length === 5) return moderateReview(res, ctx, segs[3], "rejected");
  // ---- manager
  if (segs[1] === "manage" && segs.length >= 3) {
    const code = segs[2];
    const sub = "/" + segs.slice(3).join("/");
    if (sub === "/calendar" && method === "GET") return managerCalendar(res, ctx, code, url);
    if (sub === "/nights" && method === "PATCH") {
      const parsed = await readJson(req);
      if (isErr(parsed)) return parsed;
      return managerNights(res, ctx, code, parsed.data);
    }
    if (sub === "/reservations" && method === "GET") return managerReservations(res, ctx, code);
    if (sub === "/reservations.csv" && method === "GET") return managerReservationsCsv(res, ctx, code);
    if (sub === "/imports/preview" && method === "POST") return importPreview(req, res, ctx, code);
    if (sub === "/imports" && method === "POST") return importApply(req, res, ctx, code);
    if (sub.startsWith("/statements/")) {
      const rest = sub.slice("/statements/".length);
      if (rest.endsWith(".csv") && method === "GET") return statementCsv(res, ctx, code, rest.slice(0, -4));
      if (method === "GET") return statementRoute(res, ctx, code, rest);
    }
  }
  return E.notFound();
}

// ---------------------------------------------------------------------------
// pages known to the client router

export async function pageKnown(pathname: string): Promise<boolean> {
  const routes: RegExp[] = [
    /^\/$/,
    /^\/search$/,
    /^\/properties\/[A-Za-z0-9-]+$/,
    /^\/checkout\/[A-Za-z0-9-]+$/,
    /^\/bookings\/[A-Za-z0-9-]+$/,
    /^\/bookings\/[A-Za-z0-9-]+\/invoice$/,
    /^\/find$/,
    /^\/reviews\/[A-Za-z0-9-]+$/,
    /^\/inbox$/,
    /^\/account$/,
    /^\/signin$/,
    /^\/signup$/,
    /^\/moderation$/,
    /^\/manage\/[A-Za-z0-9-]+\/(calendar|reservations|import|statements)$/
  ];
  return routes.some((r) => r.test(pathname));
}

// ---------------------------------------------------------------------------
// accounts

async function signup(res: ServerResponse, ctx: Ctx, usernameRaw: string, password: string, writeCookies: () => void): Promise<RouteResult> {
  if (ctx.visitorId === "") return E.unauthorised("no_visitor");
  const username = usernameRaw.toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return E.validation({ username: "signup.username" });
  if (password.length < 8) return E.validation({ password: "signup.password" });
  const exists = await db.query("SELECT 1 FROM users WHERE username = $1", [username]);
  if (exists.rows[0]) return E.conflict("username_taken");
  await db.query("INSERT INTO users (username, password_hash, role) VALUES ($1, crypt($2, gen_salt('bf')), 'guest')", [username, password]);
  return startSession(res, ctx, username, writeCookies);
}

async function signin(res: ServerResponse, ctx: Ctx, usernameRaw: string, password: string, writeCookies: () => void): Promise<RouteResult> {
  if (ctx.visitorId === "") return E.unauthorised("no_visitor");
  const username = usernameRaw.toLowerCase();
  const r = await db.query("SELECT username, role, password_hash = crypt($2, password_hash) AS ok FROM users WHERE username = $1", [username, password]);
  if (!r.rows[0] || !r.rows[0].ok) return E.unauthorised("bad_credentials");
  return startSession(res, ctx, r.rows[0].username, writeCookies);
}

async function startSession(res: ServerResponse, ctx: Ctx, username: string, writeCookies: () => void): Promise<RouteResult> {
  const id = randomToken(24);
  await db.query("INSERT INTO sessions (id, username, lang, cur) SELECT $1, $2, lang, cur FROM (SELECT $3::text AS lang, $4::text AS cur) prefs", [id, username, ctx.lang, ctx.cur]);
  ctx.sessionId = id;
  ctx.setSession = true;
  ctx.username = username;
  const u = await db.query("SELECT role FROM users WHERE username = $1", [username]);
  ctx.role = u.rows[0].role;
  ctx.manages = [];
  if (ctx.role === "manager") {
    const m = await db.query("SELECT p.code FROM manager_properties mp JOIN properties p ON p.id = mp.property_id WHERE mp.username = $1 ORDER BY p.code", [username]);
    ctx.manages = m.rows.map((r: { code: string }) => r.code);
  }
  writeCookies();
  return json(res, 200, { username, role: ctx.role, manages: ctx.manages });
}

async function signout(res: ServerResponse, ctx: Ctx, everywhere: boolean, writeCookies: () => void): Promise<RouteResult> {
  if (ctx.sessionId) {
    if (everywhere) {
      const user = ctx.username;
      await db.query("DELETE FROM sessions WHERE username = $1", [user]);
      const pairs = await db.query("SELECT v.id AS vid FROM visitors v").catch(() => ({ rows: [] }));
      hub.publish({ name: "account.changed", to: { usernames: [user!] }, data: { signed_out: true } });
    } else {
      await db.query("DELETE FROM sessions WHERE id = $1", [ctx.sessionId]);
    }
  }
  ctx.sessionId = null;
  ctx.username = null;
  ctx.role = null;
  ctx.manages = [];
  ctx.clearSession = true;
  writeCookies();
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
  return "handled";
}

async function mePayload(ctx: Ctx): Promise<Record<string, unknown>> {
  const tierInfo = tierFor(await completedStaysCount(db, ctx));
  return {
    user: ctx.username ? { username: ctx.username, role: ctx.role, manages: ctx.manages } : null,
    lang: ctx.lang,
    cur: ctx.cur,
    tier: tierInfo.name,
    completed_stays: await completedStaysCount(db, ctx),
    perks: tierInfo.perks
  };
}

async function patchPreferences(res: ServerResponse, ctx: Ctx, data: Record<string, unknown>): Promise<RouteResult> {
  const lang = str(data.lang);
  const cur = str(data.cur);
  const fields: Record<string, string> = {};
  if (lang !== undefined && !["en", "de", "ar"].includes(lang)) fields.lang = "invalid";
  if (cur !== undefined && !CURRENCIES.includes(cur as CurrencyCode)) fields.cur = "invalid";
  if (Object.keys(fields).length > 0) return E.validation(fields);
  const newLang = (lang as Lang | undefined) ?? ctx.lang;
  const newCur = (cur as CurrencyCode | undefined) ?? ctx.cur;
  await storePreferences(db, ctx, newLang, newCur);
  ctx.lang = newLang;
  ctx.cur = newCur;
  // broadcast to this browser context's other tabs and the user's other sessions
  const targets: { visitors?: string[]; usernames?: string[] } = { visitors: [ctx.visitorId] };
  if (ctx.username) targets.usernames = [ctx.username];
  hub.publish({ name: "account.changed", to: targets, data: { lang: newLang, cur: newCur } });
  return json(res, 200, await mePayload(ctx));
}

async function inboxRoute(res: ServerResponse, ctx: Ctx): Promise<RouteResult> {
  const rows = await db.query(
    `SELECT id, at, kind, property, link FROM inbox
     WHERE ($1::text IS NOT NULL AND username = $1) OR ($2::text IS NOT NULL AND visitor_id = $2)
     ORDER BY at DESC, id DESC`,
    [ctx.username, ctx.username ? null : ctx.visitorId]
  );
  return json(res, 200, rows.rows);
}

// ---------------------------------------------------------------------------
// search

async function searchRoute(res: ServerResponse, ctx: Ctx, url: URL): Promise<RouteResult> {
  const dest = url.searchParams.get("dest") ?? "";
  const destRow = await db.query("SELECT * FROM destinations WHERE code = $1", [dest]);
  if (!destRow.rows[0]) {
    return json(res, 200, {
      canonical: canonicalString(url.searchParams), notices: [], count: 0, results: [],
      counts: { stars: { "3": 0, "4": 0, "5": 0 }, amen: { pool: 0, parking: 0, wifi: 0, spa: 0, pets: 0 }, free: 0 },
      histogram: [], pins: [], next_cursor: null
    });
  }
  const zone = destRow.rows[0].zone;
  const today = zoneDate(clock.now(), zone);
  const norm = normaliseQuery(url.searchParams, { storedLang: ctx.lang, storedCur: ctx.cur, today });
  const p = norm.params;
  const rates = await currentRates();
  const props = await db.query(
    `SELECT p.*, d.zone, d.cx, d.cy FROM properties p JOIN destinations d ON d.code = p.destination WHERE p.destination = $1 ORDER BY p.code`,
    [dest]
  );
  const reviewAgg = await db.query(
    `SELECT property_id, cleanliness, comfort, location, staff, value, created_at FROM reviews WHERE state = 'published'`
  );
  const scoresByProperty = new Map<number, { value: number; weight: number }[]>();
  for (const r of reviewAgg.rows) {
    const ageDays = (clock.now().getTime() - new Date(r.created_at).getTime()) / 86400000;
    const weight = Math.pow(0.5, ageDays / 180);
    const value = (r.cleanliness + r.comfort + r.location + r.staff + r.value) / 5;
    const list = scoresByProperty.get(r.property_id) ?? [];
    list.push({ value, weight });
    scoresByProperty.set(r.property_id, list);
  }
  const scoreOf = (propertyId: number): number => {
    const list = scoresByProperty.get(propertyId);
    if (!list || list.length === 0) return 6.0;
    let w = 0, v = 0;
    for (const x of list) { w += x.weight; v += x.weight * x.value; }
    const mean = v / w;
    return Math.floor(mean * 10 + 0.5 + 1e-9) / 10;
  };

  const results: SearchResult[] = [];
  for (const prow of props.rows) {
    const property: PropertyRow = { ...prow, amenities: prow.amenities ?? [], policy: prow.policy ?? [] };
    const rec = p.in && p.out ? await priceRecommendation(property, { in: p.in, out: p.out, adults: p.adults, ages: p.ages }, rates) : null;
    if (!rec) continue;
    results.push(makeResult(property, rec, p, rates, scoreOf(property.id)));
  }
  // filters
  const filtered = results.filter((r) => matchFilters(r, p));
  // map view filter
  const inView = (r: SearchResult) => p.zoom === null || (Math.abs(r.x - p.cx!) <= (1000 / 2 ** p.zoom!) / 2 && Math.abs(r.y - p.cy!) <= (1000 / 2 ** p.zoom!) / 2);
  const viewFiltered = filtered.filter(inView);
  // sort
  sortResults(viewFiltered, p.sort);
  // counts: per option, matching every other group + price + view
  const counts = await computeCounts(filtered, inView, p);
  const histogram = computeHistogram(viewFiltered, p);
  // paging
  const pageSize = cfg.pageSize;
  const after = p.cursor ? parseCursor(p.cursor) : null;
  let page = viewFiltered;
  if (after) {
    page = viewFiltered.filter((r) => cursorAfter(r, after, p.sort));
  }
  const pageItems = page.slice(0, pageSize);
  const nextCursor = page.length > pageSize ? makeCursor(pageItems[pageItems.length - 1], p.sort) : null;
  const pins = viewFiltered.map((r) => ({ code: r.code, name: r.name, x: r.x, y: r.y, score: r.score, display_minor: r.display_minor }));
  return json(res, 200, {
    canonical: canonicalString(norm.canonical),
    notices: norm.notices,
    count: viewFiltered.length,
    results: pageItems,
    counts,
    histogram,
    pins,
    next_cursor: nextCursor
  });
}

type SearchResult = {
  code: string; name: string; stars: number; score: number; distance_km: number; x: number; y: number;
  total_minor: number; avg_night_minor: number; display_minor: number; display_currency: CurrencyCode;
  refundable: boolean; rank: number;
  amenities: string[];
};

function matchFilters(r: SearchResult, p: SearchParams): boolean {
  if (p.stars.length > 0 && !p.stars.includes(r.stars)) return false;
  for (const a of p.amen) if (!r.amenities.includes(a)) return false;
  if (p.free && !r.refundable) return false;
  if (p.min !== null && r.avg_night_minor < p.min * 100) return false;
  if (p.max !== null && r.avg_night_minor > p.max * 100) return false;
  return true;
}

function sortResults(list: SearchResult[], sort: SearchParams["sort"]): void {
  list.sort((a, b) => {
    let c = 0;
    if (sort === "price_asc") c = a.total_minor - b.total_minor;
    else if (sort === "price_desc") c = b.total_minor - a.total_minor;
    else if (sort === "score_desc") c = b.score - a.score;
    else if (sort === "distance_asc") c = a.distance_km - b.distance_km;
    else c = b.rank - a.rank || a.total_minor - b.total_minor;
    if (c !== 0) return c;
    return a.code.localeCompare(b.code);
  });
}

function cursorValue(r: SearchResult, sort: SearchParams["sort"]): string {
  switch (sort) {
    case "price_asc": case "price_desc": return String(r.total_minor);
    case "score_desc": return String(Math.round(r.score * 10));
    case "distance_asc": return String(Math.round(r.distance_km * 1000));
    default: return r.rank + "~" + r.total_minor;
  }
}

function makeCursor(r: SearchResult, sort: SearchParams["sort"]): string {
  return cursorValue(r, sort) + "_" + r.code;
}

function parseCursor(c: string): { value: string; code: string } {
  const idx = c.lastIndexOf("_");
  return { value: c.slice(0, idx), code: c.slice(idx + 1) };
}

function cursorAfter(r: SearchResult, after: { value: string; code: string }, sort: SearchParams["sort"]): boolean {
  const v = cursorValue(r, sort);
  if (sort === "price_asc" || sort === "distance_asc") return v > after.value || (v === after.value && r.code > after.code);
  if (sort === "price_desc" || sort === "score_desc") return v < after.value || (v === after.value && r.code > after.code);
  return v > after.value || (v === after.value && r.code > after.code);
}

async function computeCounts(all: SearchResult[], inView: (r: SearchResult) => boolean, p: SearchParams): Promise<{ stars: Record<string, number>; amen: Record<string, number>; free: number }> {
  const stars: Record<string, number> = { "3": 0, "4": 0, "5": 0 };
  const amen: Record<string, number> = { pool: 0, parking: 0, wifi: 0, spa: 0, pets: 0 };
  let free = 0;
  const priceMatch = (r: SearchResult) =>
    (p.min === null || r.avg_night_minor >= p.min * 100) && (p.max === null || r.avg_night_minor <= p.max * 100);
  // For an option in one group, count results matching every other group's
  // selection, the price range and the view, ignoring its own group's selection.
  const otherGroups = (r: SearchResult, group: "stars" | "amen" | "free") => {
    if (group !== "stars" && p.stars.length > 0 && !p.stars.includes(r.stars)) return false;
    if (group !== "amen") for (const a of p.amen) if (!r.amenities.includes(a)) return false;
    if (group !== "free" && p.free && !r.refundable) return false;
    return true;
  };
  for (const r of all) {
    if (!inView(r) || !priceMatch(r)) continue;
    for (const s of [3, 4, 5]) if (r.stars === s && otherGroups(r, "stars")) stars[String(s)]++;
    for (const a of ["pool", "parking", "wifi", "spa", "pets"]) if (r.amenities.includes(a) && otherGroups(r, "amen")) amen[a]++;
    if (r.refundable && otherGroups(r, "free")) free++;
  }
  return { stars, amen, free };
}

function computeHistogram(list: SearchResult[], p: SearchParams): { from_minor: number; count: number }[] {
  const out: { from_minor: number; count: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const from = 5000 * i;
    const to = i === 11 ? Infinity : 5000 * (i + 1);
    const count = list.filter((r) => r.avg_night_minor >= from && r.avg_night_minor < to).length;
    out.push({ from_minor: from, count });
  }
  return out;
}

// ---------------------------------------------------------------------------
// recommendation and pricing for a property

export async function priceRecommendation(property: PropertyRow, p: { in: string; out: string; adults: number; ages: number[] }, rates: RatesPpm, excludeBooking?: number | null): Promise<{ rooms: PlacedRoom[]; total_minor: number; nights: string[]; perRoom: pricedRoomOut[] } | null> {
  const nights = eachNight(p.in, p.out);
  if (nights.length === 0 || nights.length > 30) return null;
  const roomTypes = await getRoomTypes(db, property.id);
  if (roomTypes.length === 0) return null;
  const inv = excludeBooking === null || excludeBooking === undefined
    ? await inventoryFor(db, property.id, roomTypes, nights, {})
    : await inventoryFor(db, property.id, roomTypes, nights, { excludeBooking });
  const lite: RoomTypeLite[] = roomTypes.map((rt) => ({
    code: rt.code, name: rt.name, included_adults: rt.included_adults, max_adults: rt.max_adults,
    max_guests: rt.max_guests, extra_adult_minor: rt.extra_adult_minor, child_minor: rt.child_minor
  }));
  const today = zoneDate(clock.now(), property.zone);
  const price = (rooms: PlacedRoom[]): number | null => {
    let total = 0;
    for (const room of rooms) {
      const rt = roomTypes.find((r) => r.code === room.room_type)!;
      const stay = checkStay({ in: p.in, out: p.out, rooms: 1, nights, inv: inv.get(rt.code)!, today });
      if (stay !== null) return null;
      const pr = priceRoom({
        property, roomType: rt, plan: "refundable", breakfast: false,
        adults: room.adults, ages: room.ages, nights, rates: inv.get(rt.code)!, today, tier_pct: 0
      });
      total += pr.total_minor;
    }
    return total;
  };
  const result = recommend(lite, inv, nights, today, { adults: p.adults, ages: p.ages }, price);
  if (!result.ok || result.best === null) return null;
  return { rooms: result.best.rooms, total_minor: result.best.total_minor, nights, perRoom: [] };
}

type pricedRoomOut = ReturnType<typeof priceRoom>;

function makeResult(property: PropertyRow, rec: { rooms: PlacedRoom[]; total_minor: number; nights: string[] }, p: SearchParams, rates: RatesPpm, score: number): SearchResult {
  const n = rec.nights.length;
  const avg = Math.round(rec.total_minor / n);
  const distance = Math.round(Math.hypot(property.x - property.cx, property.y - property.cy) * 10) / 10;
  const rank = Math.round(3 * (score * 10)) - 2 * Math.floor(distance) - Math.floor(avg / 1000);
  return {
    code: property.code, name: property.name, stars: property.stars, score, distance_km: distance,
    x: property.x, y: property.y, total_minor: rec.total_minor, avg_night_minor: avg,
    display_minor: p.display === "night" ? perNightDisplay(rec.total_minor, n, p.cur, rates) : convertTotal([rec.total_minor], rates[p.cur], DECIMALS[p.cur]),
    display_currency: p.cur,
    refundable: p.in !== null && refundableNow(property, p.in, rec.nights),
    rank,
    amenities: property.amenities
  };
}

function perNightDisplay(total: number, nights: number, cur: CurrencyCode, rates: RatesPpm): number {
  return Math.round(convertTotal([total], rates[cur], DECIMALS[cur]) / nights);
}

function refundableNow(property: PropertyRow, arrival: string, nights: string[]): boolean {
  const now = clock.now();
  for (const tier of property.policy) {
    if (tier.refund_pct === 100) {
      const dl = deadlineFor(property.zone, arrival, tier.days_before, tier.hour);
      if (now < dl) return true;
    }
  }
  return false;
}

export function deadlineFor(zone: string, arrival: string, daysBefore: number, hour: number): Date {
  const arr = toDate(arrival)!;
  const day = addDays(arr, -daysBefore);
  const naive = day.toISOString().slice(0, 10) + "T" + String(hour).padStart(2, "0") + ":00";
  // Resolve the wall-clock time in the zone, honouring DST gaps and repeats.
  return resolveZoneTime(naive, zone);
}

/** Find the UTC instant of a local wall-clock time; skipped times move forward, repeated use first occurrence. */
export function resolveZoneTime(localIso: string, zone: string): Date {
  // Try every plausible UTC offset: an instant whose local wall clock reads
  // exactly the wanted time. A repeated time yields two candidates and the
  // first occurrence is the earlier UTC instant (the larger offset).
  const guess = Date.parse(localIso + ":00Z");
  const candidates: number[] = [];
  for (let off = -14; off <= 14; off++) {
    const inst = guess - off * 3600000;
    if (localStamp(inst, zone) === localIso) candidates.push(inst);
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => a - b);
    return new Date(candidates[0]);
  }
  // A skipped time: the first valid minute after the gap. Scan forward from
  // before the gap (the naive instant sits inside it) and return the first
  // instant whose local stamp is at least the wanted time.
  const start = guess - 14 * 3600000;
  const end = guess + 14 * 3600000;
  for (let t = start; t <= end; t += 60000) {
    const stamp = localStamp(t, zone);
    if (stamp.slice(0, 10) === localIso.slice(0, 10) && stamp >= localIso) return new Date(t);
  }
  return new Date(guess);
}

function localStamp(instant: number, zone: string): string {
  return zoneDate(new Date(instant), zone) + "T" + localTimeOf(new Date(instant), zone);
}

function localTimeOf(at: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}



export async function sendContextState(res: ServerResponse, ctx: Ctx): Promise<void> {
  const now = clock.now();
  // ended holds
  const holds = await db.query("SELECT id, expires_at FROM holds WHERE visitor_id = $1 OR username = $2", [ctx.visitorId, ctx.username]);
  for (const h of holds.rows) {
    if (new Date(h.expires_at) <= now) {
      res.write(`event: hold.expired\ndata: ${JSON.stringify({ hold_id: h.id })}\n\n`);
    }
  }
  // stale or expired quotes
  const quotes = await db.query("SELECT id, total_minor, expires_at FROM quotes WHERE visitor_id = $1 OR username = $2", [ctx.visitorId, ctx.username]);
  for (const q of quotes.rows) {
    if (new Date(q.expires_at) <= now) {
      res.write(`event: quote.changed\ndata: ${JSON.stringify({ quote_id: q.id, reason: "expired", old_total_minor: q.total_minor, new_total_minor: q.total_minor })}\n\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// grading routes

async function gradingRoute(req: IncomingMessage, res: ServerResponse, method: string, pathname: string, ctx: Ctx, writeCookies: () => void): Promise<RouteResult> {
  if (pathname === "/api/grading/seed" && req.method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    return seedRoute(res, parsed.data);
  }
  if (pathname === "/api/grading/session" && req.method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    const username = str(parsed.data.username) ?? "";
    const u = await db.query("SELECT username, role FROM users WHERE username = $1", [username.toLowerCase()]);
    if (!u.rows[0]) return E.notFound();
    ctx.username = u.rows[0].username;
    ctx.role = u.rows[0].role;
    const id = randomToken(24);
    await db.query("INSERT INTO sessions (id, username, lang, cur) VALUES ($1, $2, $3, $4)", [id, ctx.username, ctx.lang, ctx.cur]);
    ctx.sessionId = id;
    ctx.setSession = true;
    if (ctx.role === "manager") {
      const m = await db.query("SELECT p.code FROM manager_properties mp JOIN properties p ON p.id = mp.property_id WHERE mp.username = $1", [ctx.username]);
      ctx.manages = m.rows.map((r: { code: string }) => r.code);
    }
    writeCookies();
    return json(res, 200, { username: ctx.username, role: ctx.role });
  }
  if (pathname === "/api/grading/clock" && req.method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    const set = str(parsed.data.set);
    const advance = int(parsed.data.advance_ms);
    let now: Date;
    if (set !== undefined) now = await clock.set(set);
    else if (advance !== undefined) now = await clock.advance(advance);
    else return E.validation({ clock: "invalid" });
    await applyDue(now);
    return json(res, 200, { now: now.toISOString() });
  }
  if (pathname === "/api/grading/currency" && req.method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    const table: Record<string, unknown> = {};
    for (const c of CURRENCIES) {
      const v = parsed.data[c];
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return E.validation({ [c]: "invalid" });
      table[c] = v;
    }
    for (const c of CURRENCIES) {
      await db.query("INSERT INTO currency (code, ppm) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET ppm = EXCLUDED.ppm", [c, table[c]]);
    }
    return json(res, 200, table);
  }
  if (pathname === "/api/grading/storage" && req.method === "POST") {
    const parsed = await readJson(req);
    if (isErr(parsed)) return parsed;
    const down = bool(parsed.data.down);
    if (down === undefined) return E.validation({ down: "invalid" });
    setStorageDown(down);
    return json(res, 200, { down });
  }
  return E.notFound();
}

async function applyDue(now: Date): Promise<void> {
  // Holds that have expired return their rooms and broadcast.
  const expired = await db.query("SELECT id, visitor_id, username, property_id FROM holds WHERE expires_at <= $1", [now]);
  for (const h of expired.rows) {
    await db.query("DELETE FROM holds WHERE id = $1", [h.id]);
    hub.publish({ name: "hold.expired", to: { visitors: [h.visitor_id], ...(h.username ? { usernames: [h.username] } : {}) }, data: { hold_id: h.id } });
    hub.publish({ name: "availability", to: {}, data: { property: h.property_id } });
  }
  // Quotes that have expired go stale.
  const staleQuotes = await db.query("SELECT id, visitor_id, username, total_minor FROM quotes WHERE expires_at <= $1", [now]);
  for (const q of staleQuotes.rows) {
    hub.publish({ name: "quote.changed", to: { visitors: [q.visitor_id], ...(q.username ? { usernames: [q.username] } : {}) }, data: { quote_id: q.id, reason: "expired", old_total_minor: q.total_minor, new_total_minor: q.total_minor } });
  }
  // Completion at 11:00 property-local on the checkout date.
  const due = await db.query(
    `SELECT b.id, b.code FROM bookings b
     JOIN properties p ON p.id = b.property_id
     WHERE b.state IN ('confirmed','changed') AND b.completion_at IS NOT NULL AND b.completion_at <= $1`,
    [now]
  );
  for (const b of due.rows) {
    await completeBooking(b.id);
  }
  hub.broadcastClock(now.toISOString());
}

async function completeBooking(id: number): Promise<void> {
  const b = await db.query("SELECT * FROM bookings WHERE id = $1", [id]);
  if (!b.rows[0]) return;
  const rooms = b.rows[0].rooms as { n: number; state: string }[];
  const roomsOut = rooms.map((r) => ({ ...r, state: r.state === "cancelled" ? r.state : "completed" }));
  const allCancelled = roomsOut.every((r) => r.state === "cancelled");
  await db.query("UPDATE bookings SET state = $1, rooms = $2, version = version + 1 WHERE id = $3", [
    allCancelled ? "cancelled" : "completed", JSON.stringify(roomsOut), id
  ]);
}

// placeholder exports used by main.ts

// ---------------------------------------------------------------------------
// property page, dates and allocation

async function propertyRoute(res: ServerResponse, ctx: Ctx, url: URL, code: string): Promise<RouteResult> {
  const property = await getProperty(db, code);
  if (!property) return E.notFound();
  const cur = (url.searchParams.get("cur") ?? "EUR") as CurrencyCode;
  const inDate = url.searchParams.get("in");
  const outDate = url.searchParams.get("out");
  const adults = Number(url.searchParams.get("adults") ?? 2) || 2;
  const agesParam = url.searchParams.get("ages") ?? "";
  const ages = agesParam === "" ? [] : agesParam.split(",").map(Number).filter((n) => Number.isInteger(n));
  const roomTypes = await getRoomTypes(db, property.id);
  const pictures = [1, 2, 3].map((n) => `/images/${code}/${n}.svg`);
  const base = {
    code: property.code, name: property.name, zone: property.zone, stars: property.stars,
    amenities: property.amenities, score: await propertyScore(property.id),
    distance_km: Math.round(Math.hypot(property.x - property.cx, property.y - property.cy) * 10) / 10,
    pictures, policy: property.policy, room_types: roomTypes.map((rt) => ({
      code: rt.code, name: rt.name, max_adults: rt.max_adults, max_guests: rt.max_guests, left: 0
    }))
  };
  if (!inDate || !outDate) return json(res, 200, { ...base, recommendation: null });
  const nights = eachNight(inDate, outDate);
  if (nights.length === 0 || nights.length > 30) return json(res, 200, { ...base, recommendation: null });
  const rates = await currentRates();
  const rec = await buildRecommendation(property, roomTypes, nights, inDate, outDate, adults, ages, rates, cur ?? "EUR");
  if (!rec) return json(res, 200, { ...base, recommendation: null });
  return json(res, 200, {
    ...base,
    room_types: base.room_types.map((rt) => ({ ...rt, left: rec.leftByCode[rt.code] ?? 0 })),
    recommendation: { rooms: rec.rooms, total_minor: rec.display_total_minor, total_eur_minor: rec.total_minor }
  });
}

export async function propertyScore(propertyId: number): Promise<number> {
  const now = clock.now();
  const rows = await db.query("SELECT * FROM reviews WHERE property_id = $1 AND state = 'published'", [propertyId]);
  if (rows.rows.length === 0) return 6.0;
  let weightSum = 0, valueSum = 0;
  for (const r of rows.rows) {
    const ageDays = (now.getTime() - new Date(r.created_at).getTime()) / 86400000;
    const w = Math.pow(0.5, ageDays / 180);
    const value = (r.cleanliness + r.comfort + r.location + r.staff + r.value) / 5;
    weightSum += w;
    valueSum += w * value;
  }
  const x = valueSum / weightSum;
  return Math.floor(x * 10 + 0.5 + 1e-9) / 10;
}

type RecOut = { rooms: PlacedRoom[]; total_minor: number; display_total_minor: number; leftByCode: Record<string, number>; perRoom: pricedRoom[] };

type pricedRoom = { room_type: string; plan: Plan; breakfast: boolean; adults: number; ages: number[]; nights: { date: string; lines: PriceLine[]; total_minor: number; taxable_minor: number }[]; total_minor: number; amount_minor: number };

async function buildRecommendation(property: PropertyRow, roomTypes: RoomTypeRow[], nights: string[], inDate: string, outDate: string, adults: number, ages: number[], rates: RatesPpm, cur: CurrencyCode, tierPct = 0, excludeBooking: number | null = null): Promise<RecOut | null> {
  const inv = excludeBooking === null || excludeBooking === undefined
    ? await inventoryFor(db, property.id, roomTypes, nights, {})
    : await inventoryFor(db, property.id, roomTypes, nights, { excludeBooking });
  const lite: RoomTypeLite[] = roomTypes.map((rt) => ({
    code: rt.code, name: rt.name, included_adults: rt.included_adults, max_adults: rt.max_adults,
    max_guests: rt.max_guests, extra_adult_minor: rt.extra_adult_minor, child_minor: rt.child_minor
  }));
  const today = zoneDate(clock.now(), property.zone);
  const price = (rooms: PlacedRoom[]): number | null => {
    let total = 0;
    for (const room of rooms) {
      const rt = roomTypes.find((r) => r.code === room.room_type)!;
      if (checkStay({ in: inDate, out: outDate, rooms: 1, nights, inv: inv.get(rt.code)!, today }) !== null) return null;
      const pr = priceRoom({
        property, roomType: rt, plan: "refundable", breakfast: false,
        adults: room.adults, ages: room.ages, nights, rates: inv.get(rt.code)!, today, tier_pct: tierPct
      });
      total += pr.total_minor;
    }
    return total;
  };
  const result = recommend(lite, inv, nights, today, { adults, ages }, price);
  if (!result.ok || result.best === null) return null;
  const perRoom: pricedRoom[] = [];
  for (const room of result.best.rooms) {
    const rt = roomTypes.find((r) => r.code === room.room_type)!;
    perRoom.push(priceRoom({ property, roomType: rt, plan: "refundable", breakfast: false, adults: room.adults, ages: room.ages, nights, rates: inv.get(rt.code)!, today, tier_pct: tierPct }));
  }
  const leftByCode: Record<string, number> = {};
  for (const rt of roomTypes) {
    let min = Infinity;
    for (const date of nights) min = Math.min(min, inv.get(rt.code)?.get(date)?.left ?? 0);
    leftByCode[rt.code] = min === Infinity ? 0 : min;
  }
  const displayTotal = convertTotal([result.best.total_minor], rates[cur], DECIMALS[cur]);
  return { rooms: result.best.rooms, total_minor: result.best.total_minor, display_total_minor: displayTotal, leftByCode, perRoom };
}

async function datesRoute(res: ServerResponse, ctx: Ctx, url: URL): Promise<RouteResult> {
  const dest = url.searchParams.get("dest");
  const propCode = url.searchParams.get("property");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const cur = (url.searchParams.get("cur") ?? "EUR") as CurrencyCode;
  const start = url.searchParams.get("start");
  const rates = await currentRates();
  let zone: string, roomTypesByProperty: { property: PropertyRow; roomTypes: RoomTypeRow[] }[] = [];
  if (dest) {
    const d = await db.query("SELECT * FROM destinations WHERE code = $1", [dest]);
    if (!d.rows[0]) return E.notFound();
    zone = d.rows[0].zone;
    const props = await db.query("SELECT p.*, d.zone AS zone, d.cx, d.cy FROM properties p JOIN destinations d ON d.code = p.destination WHERE p.destination = $1", [dest]);
    for (const prow of props.rows) {
      roomTypesByProperty.push({ property: { ...prow, amenities: prow.amenities ?? [], policy: prow.policy ?? [] }, roomTypes: await getRoomTypes(db, prow.id) });
    }
  } else if (propCode) {
    const property = await getProperty(db, propCode);
    if (!property) return E.notFound();
    zone = property.zone;
    roomTypesByProperty = [{ property, roomTypes: await getRoomTypes(db, property.id) }];
  } else return E.notFound();
  if (!from || !to) return E.validation({ from: "required" });
  const today = zoneDate(clock.now(), zone);
  const startBound = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : from;
  const days: { date: string; available: boolean; from_minor: number; min_stay: number; reason: Record<string, unknown> | null; after_start: "before" | "short" | null }[] = [];
  const dates = eachNight(from, to);
  const chosenArrival = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null;
  for (const date of dates) {
    if (date < startBound) { days.push({ date, available: false, from_minor: 0, min_stay: 0, reason: null, after_start: "before" }); continue; }
    let available = false, lowestRate: number | null = null, lowestMin = Infinity;
    let reason: Reason | null = null, reasonCode = "";
    for (const { property, roomTypes } of roomTypesByProperty) {
      const nights = [date];
      const inv = await inventoryFor(db, property.id, roomTypes, nights);
      for (const rt of roomTypes) {
        const m = inv.get(rt.code)!;
        const inv0 = m.get(date);
        if (!inv0) continue;
        const r = arrivalCheck(inv0, date, today);
        if (r === null) {
          available = true;
          lowestRate = lowestRate === null ? inv0.rate_minor : Math.min(lowestRate, inv0.rate_minor);
          lowestMin = Math.min(lowestMin, inv0.min_stay);
        } else if (!available && reason === null) {
          reason = r;
          reasonCode = rt.code;
        }
      }
    }
    if (chosenArrival && date > chosenArrival) {
      // check as departure for that arrival: skip arrival-only checks
      const nightsStay = eachNight(chosenArrival, date);
      let block: Reason | null = null, short = false, minFromArrival = Infinity;
      for (const { property, roomTypes } of roomTypesByProperty) {
        const inv = await inventoryFor(db, property.id, roomTypes, nightsStay);
        for (const rt of roomTypes) {
          const m = inv.get(rt.code)!;
          const arrInv = m.get(chosenArrival);
          if (!arrInv) continue;
          if (nightsStay.length < arrInv.min_stay) { short = true; minFromArrival = arrInv.min_stay; continue; }
          const r = checkStay({ in: chosenArrival, out: date, rooms: 1, nights: nightsStay, inv: m, today });
          if (r === null) {
            if (!block) { block = null; minFromArrival = arrInv.min_stay; break; }
          } else if (block === null) block = r;
        }
        if (block === null && !short) break;
      }
      if (short) { days.push({ date, available: false, from_minor: 0, min_stay: minFromArrival, reason: null, after_start: "short" }); continue; }
      if (block !== null) { days.push({ date, available: false, from_minor: 0, min_stay: 0, reason: reasonFields(block), after_start: null }); continue; }
      days.push({ date, available: true, from_minor: 0, min_stay: 0, reason: null, after_start: null });
      continue;
    }
    if (available) {
      const fromMinor = convertTotal([lowestRate!], rates[cur], DECIMALS[cur]);
      const major = Math.round(fromMinor / 10 ** DECIMALS[cur]);
      days.push({ date, available: true, from_minor: fromMinor, min_stay: lowestMin === Infinity ? 1 : lowestMin, reason: null, after_start: null });
    } else {
      days.push({ date, available: false, from_minor: 0, min_stay: 0, reason: reason ? reasonFields(reason) : { code: "sold_out", date }, after_start: null });
    }
  }
  return json(res, 200, { days });
}

async function allocationRoute(res: ServerResponse, ctx: Ctx, data: Record<string, unknown>): Promise<RouteResult> {
  const code = str(data.property) ?? "";
  const inDate = str(data.in) ?? "";
  const outDate = str(data.out) ?? "";
  const adults = int(data.adults) ?? 2;
  const ages = Array.isArray(data.ages) ? (data.ages as unknown[]).map(Number).filter((n) => Number.isInteger(n)) : [];
  const countsIn = (data.counts ?? {}) as Record<string, unknown>;
  const property = await getProperty(db, code);
  if (!property) return E.notFound();
  const roomTypes = await getRoomTypes(db, property.id);
  const nights = eachNight(inDate, outDate);
  if (nights.length === 0) return E.validation({ in: "invalid" });
  const inv = await inventoryFor(db, property.id, roomTypes, nights);
  const today = zoneDate(clock.now(), property.zone);
  const lite: RoomTypeLite[] = roomTypes.map((rt) => ({
    code: rt.code, name: rt.name, included_adults: rt.included_adults, max_adults: rt.max_adults,
    max_guests: rt.max_guests, extra_adult_minor: rt.extra_adult_minor, child_minor: rt.child_minor
  }));
  const rates = await currentRates();
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(countsIn)) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0) counts[k] = n;
  }
  const price = (rooms: PlacedRoom[]): number | null => {
    let total = 0;
    for (const room of rooms) {
      const rt = roomTypes.find((r) => r.code === room.room_type)!;
      if (checkStay({ in: inDate, out: outDate, rooms: 1, nights, inv: inv.get(rt.code)!, today }) !== null) return null;
      total += priceRoom({ property, roomType: rt, plan: "refundable", breakfast: false, adults: room.adults, ages: room.ages, nights, rates: inv.get(rt.code)!, today, tier_pct: 0 }).total_minor;
    }
    return total;
  };
  const result = placeOverride(counts, lite, inv, nights, today, { adults, ages }, price);
  if (!result.ok) {
    return json(res, 422, { error: "room_advice", advice: result.advice });
  }
  return json(res, 200, { rooms: result.best!.rooms, total_minor: result.best!.total_minor });
}

// ---------------------------------------------------------------------------
// quotes and holds

type QuoteRoomInput = { room_type: string; plan: Plan; breakfast: boolean; adults: number; ages: number[] };

async function createQuote(req: IncomingMessage, res: ServerResponse, ctx: Ctx, data: Record<string, unknown>): Promise<RouteResult> {
  if (ctx.visitorId === "") return E.unauthorised("no_visitor");
  const code = str(data.property) ?? "";
  const inDate = str(data.in) ?? "";
  const outDate = str(data.out) ?? "";
  const currency = (str(data.currency) ?? "EUR") as CurrencyCode;
  if (!CURRENCIES.includes(currency)) return E.validation({ currency: "invalid" });
  const property = await getProperty(db, code);
  if (!property) return E.notFound();
  const roomTypes = await getRoomTypes(db, property.id);
  const nights = eachNight(inDate, outDate);
  if (nights.length === 0 || nights.length > 30) return E.validation({ in: "invalid" });
  const tierCount = await completedStaysCount(db, ctx);
  const tier = tierFor(tierCount);
  const rates = await currentRates();
  let roomsInput: QuoteRoomInput[];
  if (Array.isArray(data.rooms)) {
    roomsInput = [];
    for (const r of data.rooms as Record<string, unknown>[]) {
      const rt = roomTypes.find((x) => x.code === r.room_type);
      if (!rt) return E.validation({ rooms: "invalid" });
      roomsInput.push({
        room_type: r.room_type as string,
        plan: r.plan === "nonrefundable" ? "nonrefundable" : "refundable",
        breakfast: r.breakfast === true,
        adults: Number(r.adults) || 0,
        ages: Array.isArray(r.ages) ? (r.ages as unknown[]).map(Number) : []
      });
    }
  } else {
    // the recommendation with the refundable plan and no breakfast
    const rec = await buildRecommendation(property, roomTypes, nights, inDate, outDate, int(data.adults) ?? 2, Array.isArray(data.ages) ? (data.ages as unknown[]).map(Number) : [], rates, currency, tier.pct);
    if (!rec) return E.restricted({ code: "sold_out", date: nights[0] });
    roomsInput = rec.rooms.map((r) => ({ room_type: r.room_type, plan: "refundable" as Plan, breakfast: false, adults: r.adults, ages: r.ages }));
  }
  const inv = await inventoryFor(db, property.id, roomTypes, nights);
  const today = zoneDate(clock.now(), property.zone);
  // restriction check per room type
  const byRt = new Map<string, number>();
  for (const room of roomsInput) byRt.set(room.room_type, (byRt.get(room.room_type) ?? 0) + 1);
  for (const [rtCode, count] of byRt) {
    const r = checkStay({ in: inDate, out: outDate, rooms: count, nights, inv: inv.get(rtCode)!, today });
    if (r !== null) return E.restricted(reasonFields(r));
  }
  const priced: pricedRoom[] = roomsInput.map((room) => {
    const rt = roomTypes.find((x) => x.code === room.room_type)!;
    return priceRoom({ property, roomType: rt, plan: room.plan, breakfast: room.breakfast, adults: room.adults, ages: room.ages, nights, rates: inv.get(rt.code)!, today, tier_pct: tier.pct });
  });
  const total = priced.reduce((s, r) => s + r.total_minor, 0);
  const taxable = priced.reduce((s, r) => s + r.nights.reduce((t, n) => t + n.taxable_minor, 0), 0);
  const id = "q_" + randomToken(12);
  const expiresAt = new Date(clock.value() + cfg.quoteTtlMs);
  const nightsOut = nights.map((date, i) => {
    const amount = priced.reduce((s, r) => s + r.nights[i].total_minor, 0);
    const taxableN = priced.reduce((s, r) => s + r.nights[i].taxable_minor, 0);
    return { date, total_minor: amount, taxable_minor: taxableN };
  });
  const holdId = str(data.hold_id);
  await db.query(
    `INSERT INTO quotes (id, visitor_id, username, property_id, currency, tier, tier_pct, rates_ppm, in_date, out_date, adults, ages, rooms, total_minor, taxable_minor, nights, expires_at, hold_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [id, ctx.visitorId, ctx.username, property.id, currency, tier.name, tier.pct, JSON.stringify(rates),
      inDate, outDate, int(data.adults) ?? roomsInput.reduce((s, r) => s + r.adults, 0),
      JSON.stringify(Array.isArray(data.ages) ? data.ages : []), JSON.stringify(roomsInput),
      total, taxable, JSON.stringify(nightsOut), expiresAt.toISOString(), holdId ?? null]
  );
  const quote = await quoteObject(id, ctx);
  return json(res, 201, quote);
}

async function quoteObject(id: string, ctx: Ctx): Promise<Record<string, unknown> | null> {
  const q = await db.query("SELECT * FROM quotes WHERE id = $1", [id]);
  if (!q.rows[0]) return null;
  const row = q.rows[0];
  if (row.visitor_id !== ctx.visitorId && row.username !== ctx.username) return null;
  const property = await db.query("SELECT p.code, p.name, d.zone, p.vat_pct, p.city_minor, p.levy_pct, p.breakfast_minor, p.single_pct FROM properties p JOIN destinations d ON d.code = p.destination WHERE p.id = $1", [row.property_id]);
  const roomTypes = await getRoomTypes(db, row.property_id);
  const nights = eachNight(row.in_date, row.out_date);
  const rates = row.rates_ppm as RatesPpm;
  const roomsInput = row.rooms as QuoteRoomInput[];
  const today = zoneDate(clock.now(), property.rows[0].zone);
  const inv = await inventoryFor(db, row.property_id, roomTypes, nights, { excludeHold: row.hold_id ?? undefined });
  const priced = roomsInput.map((room) => {
    const rt = roomTypes.find((x) => x.code === room.room_type)!;
    return priceRoom({ property: { ...property.rows[0], amenities: [], policy: [], x: 0, y: 0, cx: 0, cy: 0, stars: 0, destination: "", code: "" }, roomType: rt, plan: room.plan, breakfast: room.breakfast, adults: room.adults, ages: room.ages, nights, rates: inv.get(rt.code)!, today, tier_pct: row.tier_pct });
  });
  const nightTotals = nights.map((date, i) => priced.reduce((s, r) => s + r.nights[i].total_minor, 0));
  const converted = splitAcrossNights(nightTotals, rates[row.currency as CurrencyCode], DECIMALS[row.currency as CurrencyCode]);
  const taxable = priced.reduce((s, r) => s + r.nights.reduce((t, n) => t + n.taxable_minor, 0), 0);
  const taxablePerNight = nights.map((_, i) => priced.reduce((s, r) => s + r.nights[i].taxable_minor, 0));
  const convertedTaxable = splitAcrossNights(taxablePerNight, rates[row.currency as CurrencyCode], DECIMALS[row.currency as CurrencyCode]);
  // night states: held when this context holds the nights; closed when inventory now fails
  const hold = row.hold_id ? await db.query("SELECT * FROM holds WHERE id = $1 AND expires_at > $2", [row.hold_id, clock.now().toISOString()]) : null;
  const state = nights.map((date, i) => {
    if (hold && hold.rows[0]) return "held";
    for (const room of roomsInput) {
      const inv0 = inv.get(room.room_type)!.get(date);
      if (!inv0 || inv0.stop_sell || inv0.left < 1) return "closed";
    }
    const hasDiscount = priced.some((r) => {
      const l = r.nights[i].lines;
      return r.plan === "nonrefundable" || l.some((x) => (x.key === "occupancy" || x.key === "length_of_stay" || x.key === "early_booking" || x.key === "last_minute" || x.key === "loyalty") && x.minor < 0);
    });
    return hasDiscount ? "discount" : "base";
  });
  return {
    id: row.id, property: (await db.query("SELECT code FROM properties WHERE id = $1", [row.property_id])).rows[0].code,
    in: row.in_date, out: row.out_date, nights_count: nights.length, currency: row.currency, tier: row.tier,
    rates_ppm: rates,
    rooms: priced.map((r) => ({ room_type: r.room_type, plan: r.plan, breakfast: r.breakfast, adults: r.adults, ages: r.ages, nights: r.nights, total_minor: r.total_minor })),
    nights: nights.map((date, i) => ({ date, total_minor: nightTotals[i], taxable_minor: taxablePerNight[i], converted_minor: converted[i], converted_taxable_minor: convertedTaxable[i], state: state[i] })),
    total_minor: nightTotals.reduce((s, x) => s + x, 0),
    taxable_minor: taxable,
    converted_total_minor: converted.reduce((s, x) => s + x, 0),
    converted_taxable_minor: convertedTaxable.reduce((s, x) => s + x, 0),
    expires_at: new Date(row.expires_at).toISOString(),
    hold_id: row.hold_id
  };
}

async function getQuote(res: ServerResponse, ctx: Ctx, id: string): Promise<RouteResult> {
  const q = await quoteObject(id, ctx);
  if (!q) return E.notFound();
  return json(res, 200, q);
}

async function createHold(res: ServerResponse, ctx: Ctx, data: Record<string, unknown>): Promise<RouteResult> {
  if (ctx.visitorId === "") return E.unauthorised("no_visitor");
  const quoteId = str(data.quote_id) ?? "";
  const q = await db.query("SELECT * FROM quotes WHERE id = $1", [quoteId]);
  if (!q.rows[0] || (q.rows[0].visitor_id !== ctx.visitorId && q.rows[0].username !== ctx.username)) return E.notFound();
  const row = q.rows[0];
  if (new Date(row.expires_at) <= clock.now()) return E.gone("quote_expired");
  const property = await getProperty(db, (await db.query("SELECT code FROM properties WHERE id = $1", [row.property_id])).rows[0].code);
  const roomTypes = await getRoomTypes(db, row.property_id);
  const nights = eachNight(row.in_date, row.out_date);
  const inv = await inventoryFor(db, row.property_id, roomTypes, nights, { excludeHold: row.hold_id ?? undefined });
  const today = zoneDate(clock.now(), property!.zone);
  const roomsInput = row.rooms as QuoteRoomInput[];
  const byRt = new Map<string, number>();
  for (const room of roomsInput) byRt.set(room.room_type, (byRt.get(room.room_type) ?? 0) + 1);
  for (const [rtCode, count] of byRt) {
    const r = checkStay({ in: row.in_date, out: row.out_date, rooms: count, nights, inv: inv.get(rtCode)!, today });
    if (r !== null) {
      if (r.code === "sold_out") return E.conflict("sold_out", { date: r.date });
      return E.restricted(reasonFields(r));
    }
  }
  const id = "h_" + randomToken(12);
  const expiresAt = new Date(clock.value() + cfg.holdMs);
  const roomsOut = roomsInput.map((room) => ({ room_type: room.room_type, adults: room.adults, ages: room.ages, plan: room.plan, breakfast: room.breakfast, nights }));
  await db.query(
    "INSERT INTO holds (id, quote_id, visitor_id, username, property_id, rooms, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, quoteId, ctx.visitorId, ctx.username, row.property_id, JSON.stringify(roomsOut), expiresAt.toISOString()]
  );
  await db.query("UPDATE quotes SET hold_id = $1 WHERE id = $2", [id, quoteId]);
  hub.publish({ name: "availability", to: {}, data: { property: property!.code, room_type: "", dates: nights } });
  return json(res, 201, { id, quote_id: quoteId, expires_at: expiresAt.toISOString(), rooms: roomsOut });
}

async function deleteHold(res: ServerResponse, ctx: Ctx, id: string): Promise<RouteResult> {
  const h = await db.query("SELECT * FROM holds WHERE id = $1", [id]);
  if (!h.rows[0] || (h.rows[0].visitor_id !== ctx.visitorId && h.rows[0].username !== ctx.username)) return E.notFound();
  await db.query("DELETE FROM holds WHERE id = $1", [id]);
  await db.query("UPDATE quotes SET hold_id = NULL WHERE hold_id = $1", [id]);
  const property = await db.query("SELECT code FROM properties WHERE id = $1", [h.rows[0].property_id]);
  const nights = (h.rows[0].rooms as { nights: string[] }[]).flatMap((r) => r.nights);
  hub.publish({ name: "availability", to: {}, data: { property: property.rows[0].code, room_type: "", dates: nights } });
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
  return "handled";
}

// ---------------------------------------------------------------------------
// bookings

type BookingRoom = {
  n: number; room_type: string; plan: Plan; breakfast: boolean; adults: number; ages: number[];
  state: "held" | "confirmed" | "changed" | "cancelled" | "expired" | "no_show" | "completed";
  paid_minor: number; refunded_minor: number;
  nights: { date: string; lines: PriceLine[]; total_minor: number; taxable_minor: number }[];
};

const BOOKING_ROOM_STATES = ["held", "confirmed", "changed", "cancelled", "expired", "no_show", "completed"] as const;

function normaliseRooms(rooms: unknown): BookingRoom[] {
  const list = Array.isArray(rooms) ? rooms : [];
  const out: BookingRoom[] = [];
  list.forEach((r, i) => {
    const room = r as Record<string, unknown>;
    out.push({
      n: Number(room.n ?? i + 1),
      room_type: String(room.room_type ?? ""),
      plan: room.plan === "nonrefundable" ? "nonrefundable" : "refundable",
      breakfast: room.breakfast === true,
      adults: Number(room.adults ?? 0),
      ages: Array.isArray(room.ages) ? (room.ages as unknown[]).map(Number) : [],
      state: (BOOKING_ROOM_STATES as readonly string[]).includes(String(room.state)) ? room.state as BookingRoom["state"] : "confirmed",
      paid_minor: Number(room.paid_minor ?? 0),
      refunded_minor: Number(room.refunded_minor ?? 0),
      nights: Array.isArray(room.nights) ? (room.nights as BookingRoom["nights"]) : []
    });
  });
  return out;
}

async function loadBooking(code: string): Promise<Record<string, unknown> | null> {
  const r = await db.query("SELECT * FROM bookings WHERE lower(code) = lower($1)", [code]);
  return r.rows[0] ?? null;
}

async function bookingVisible(ctx: Ctx, row: Record<string, unknown>): Promise<boolean> {
  if (row.visitor_id === ctx.visitorId) return true;
  if (ctx.username && row.username === ctx.username) return true;
  if (ctx.role === "manager" || ctx.role === "operator") {
    const p = await db.query("SELECT code FROM properties WHERE id = $1", [row.property_id]);
    if (ctx.manages.includes(p.rows[0]?.code)) return true;
  }
  const found = await db.query("SELECT 1 FROM finder_bookings WHERE visitor_id = $1 AND booking_id = $2", [ctx.visitorId, row.id]);
  if (found.rows[0]) return true;
  const vb = await db.query("SELECT 1 FROM visitor_bookings WHERE visitor_id = $1 AND booking_id = $2", [ctx.visitorId, row.id]);
  return !!vb.rows[0];
}

async function createBooking(req: IncomingMessage, res: ServerResponse, ctx: Ctx, data: Record<string, unknown>): Promise<RouteResult> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key === "") return E.validation({ "Idempotency-Key": "required" });
  if (ctx.visitorId === "") return E.unauthorised("no_visitor");
  const bodyStr = JSON.stringify(data);
  const stored = await db.query("SELECT status, body FROM idempotency WHERE key = $1", [key]);
  if (stored.rows[0]) {
    const saved = stored.rows[0].body as { request?: string };
    if (saved.request !== bodyStr) return E.conflict("idempotency_conflict");
    const replay = { ...saved };
    delete replay.request;
    return json(res, stored.rows[0].status === 201 ? 200 : stored.rows[0].status, replay);
  }
  const holdId = str(data.hold_id) ?? "";
  const quoteId = str(data.quote_id) ?? "";
  const given = str(data.given_name) ?? "";
  const surname = str(data.surname) ?? "";
  const cardNumber = (str(data.card_number) ?? "").replace(/\s+/g, "");
  const expiry = str(data.expiry) ?? "";
  const sec = str(data.security_code) ?? "";
  const stepUp = str(data.step_up_code);
  const fields: Record<string, string> = {};
  if (given.length < 1 || given.length > 80) fields.given_name = "required";
  if (surname.length < 1 || surname.length > 80) fields.surname = "required";
  if (!/^\d{16}$/.test(cardNumber)) fields.card_number = "field.card";
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) fields.expiry = "field.expiry";
  if (!/^\d{3}$/.test(sec)) fields.security_code = "field.code";
  if (Object.keys(fields).length > 0) {
    await storeIdempotent(key, 422, { error: "validation", fields }, bodyStr);
    return json(res, 422, { error: "validation", fields });
  }
  const hold = await db.query("SELECT * FROM holds WHERE id = $1", [holdId]);
  if (!hold.rows[0] || (hold.rows[0].visitor_id !== ctx.visitorId && hold.rows[0].username !== ctx.username)) return E.notFound();
  const quote = await db.query("SELECT * FROM quotes WHERE id = $1", [quoteId]);
  if (!quote.rows[0] || (quote.rows[0].visitor_id !== ctx.visitorId && quote.rows[0].username !== ctx.username)) return E.notFound();
  if (new Date(hold.rows[0].expires_at) <= clock.now()) return E.gone("hold_expired");
  const row = quote.rows[0];
  const currentQuote = await repriceQuote(row);
  if (currentQuote === null) return E.notFound();
  if (currentQuote.total_minor !== row.total_minor) {
    return E.conflict("price_changed", { old_total_minor: row.total_minor, new_total_minor: currentQuote.total_minor });
  }
  const outcome = cardOutcome(cardNumber, stepUp);
  if (outcome !== "approved") {
    const body = { error: "card", outcome };
    await storeIdempotent(key, 402, body, bodyStr);
    return json(res, 402, body);
  }
  const property = await getProperty(db, (await db.query("SELECT code FROM properties WHERE id = $1", [row.property_id])).rows[0].code);
  const nights = eachNight(row.in_date as string, row.out_date as string);
  const code = bookingCode();
  const pricedRooms = currentQuote.rooms as { room_type: string; plan: Plan; breakfast: boolean; adults: number; ages: number[]; nights: { date: string; lines: PriceLine[]; total_minor: number; taxable_minor: number }[] }[];
  const rooms: BookingRoom[] = pricedRooms.map((r, i) => ({
    n: i + 1, room_type: r.room_type, plan: r.plan, breakfast: r.breakfast, adults: r.adults, ages: r.ages,
    state: "confirmed", paid_minor: r.nights.reduce((s, x) => s + x.total_minor, 0), refunded_minor: 0, nights: r.nights
  }));
  const total = rooms.reduce((s, r) => s + r.paid_minor, 0);
  const token = randomToken(20);
  const completionAt = completionInstant(property!.zone, row.out_date as string);
  const insert = await db.query(
    `INSERT INTO bookings (code, state, property_id, in_date, out_date, given_name, surname, card_last4,
       quote_currency, visitor_id, username, total_minor, paid_minor, refunded_minor, nights, rooms,
       cancellation, review_token, completion_at)
     VALUES ($1,'confirmed',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,0,$12,$13,$14,$15,$16) RETURNING id, version`,
    [code, row.property_id, row.in_date, row.out_date, given, surname, cardNumber.slice(-4), row.currency,
      ctx.visitorId, ctx.username, total, JSON.stringify(nights), JSON.stringify(rooms),
      JSON.stringify(cancellationSnapshot(property!, row.in_date as string)), token, completionAt.toISOString()]
  );
  const bookingId = insert.rows[0].id;
  await db.query("INSERT INTO visitor_bookings (visitor_id, booking_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [ctx.visitorId, bookingId]);
  await addLedger(bookingId, bookingId, "charge", "guest", total);
  await addLedger(bookingId, bookingId, "charge", "property", 0, total);
  await db.query("DELETE FROM holds WHERE id = $1", [holdId]);
  await db.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
  hub.publish({ name: "availability", to: {}, data: { property: property!.code, dates: nights } });
  const bres = await bookingObject(code, ctx);
  await storeIdempotent(key, 201, { ...bres, request: bodyStr }, bodyStr);
  const body = { ...bres } as Record<string, unknown>;
  delete body.request;
  return json(res, 201, body);
}

function cardOutcome(cardNumber: string, stepUp: string | undefined): "approved" | "declined" | "expired" | "unknown" | "step_up" | "wrong_code" {
  if (cardNumber === "9000000000000002") return "approved";
  if (cardNumber === "9000000000000010") return "declined";
  if (cardNumber === "9000000000000028") return "expired";
  if (cardNumber === "9000000000000036") {
    if (stepUp === undefined) return "step_up";
    return stepUp === "1234" ? "approved" : "wrong_code";
  }
  return "unknown";
}

async function storeIdempotent(key: string, status: number, body: Record<string, unknown>, request: string): Promise<void> {
  await db.query(
    "INSERT INTO idempotency (key, status, body) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING",
    [key, status, JSON.stringify({ ...body, request })]
  );
}

async function addLedger(bookingId: number, pair: number, kind: "charge" | "refund" | "change", account: "guest" | "property", debit = 0, credit = 0): Promise<void> {
  await db.query(
    "INSERT INTO ledger (pair, kind, account, debit_minor, credit_minor) VALUES ($1,$2,$3,$4,$5)",
    [pair, kind, account, debit, credit]
  );
}

function completionInstant(zone: string, outDate: string): Date {
  return resolveZoneTime(outDate + "T11:00", zone);
}

function cancellationSnapshot(property: PropertyRow, arrival: string): { tiers: { refund_pct: number; deadline_utc: string; deadline_local: string }[] } {
  const tiers = property.policy.map((t) => {
    const dl = deadlineFor(property.zone, arrival, t.days_before, t.hour);
    return { refund_pct: t.refund_pct, deadline_utc: dl.toISOString(), deadline_local: zoneLocal(dl, property.zone) };
  });
  return { tiers };
}

function zoneLocal(at: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

async function repriceQuote(row: Record<string, unknown>): Promise<{ total_minor: number; rooms: unknown } | null> {
  const propertyRow = await db.query("SELECT code FROM properties WHERE id = $1", [row.property_id]);
  const property = await getProperty(db, propertyRow.rows[0].code);
  if (!property) return null;
  const roomTypes = await getRoomTypes(db, property.id);
  const nights = eachNight(row.in_date as string, row.out_date as string);
  const roomsInput = row.rooms as QuoteRoomInput[];
  const today = zoneDate(clock.now(), property.zone);
  const inv = row.hold_id === null
    ? await inventoryFor(db, property.id, roomTypes, nights, {})
    : await inventoryFor(db, property.id, roomTypes, nights, { excludeHold: row.hold_id as string });
  const priced = roomsInput.map((room) => {
    const rt = roomTypes.find((x) => x.code === room.room_type)!;
    return priceRoom({ property, roomType: rt, plan: room.plan, breakfast: room.breakfast, adults: room.adults, ages: room.ages, nights, rates: inv.get(rt.code)!, today, tier_pct: row.tier_pct as number });
  });
  return {
    total_minor: priced.reduce((s, r) => s + r.total_minor, 0),
    rooms: priced.map((r) => ({ room_type: r.room_type, plan: r.plan, breakfast: r.breakfast, adults: r.adults, ages: r.ages, nights: r.nights }))
  };
}

async function bookingObject(code: string, ctx: Ctx): Promise<Record<string, unknown> | null> {
  const row = await loadBooking(code);
  if (!row) return null;
  if (!await bookingVisible(ctx, row)) return null;
  const property = await db.query("SELECT p.code, p.name, d.zone FROM properties p JOIN destinations d ON d.code = p.destination WHERE p.id = $1", [row.property_id]);
  const rooms = normaliseRooms(row.rooms);
  const active = rooms.filter((r) => r.state !== "cancelled");
  const state = active.length === 0 ? "cancelled" : active.every((r) => r.state === active[0].state) ? active[0].state : "changed";
  const ledgerRows = await db.query(
    "SELECT id, pair, kind, account, debit_minor, credit_minor, at FROM ledger WHERE pair = $1 ORDER BY id",
    [row.id]
  );
  const balance = ledgerRows.rows.reduce((s: number, r: { debit_minor: number; credit_minor: number }) => s + r.debit_minor - r.credit_minor, 0);
  const cancel = row.cancellation as { tiers: { refund_pct: number; deadline_utc: string; deadline_local: string }[] };
  const status = refundStatus(cancel.tiers, rooms);
  const noShowOpen = noShowWindowOpen(row, property.rows[0].zone);
  return {
    code: row.code, version: row.version, state,
    property: property.rows[0],
    in: row.in_date, out: row.out_date,
    given_name: row.given_name, surname: row.surname, card_last4: row.card_last4,
    quote_currency: row.quote_currency,
    rooms,
    total_minor: row.total_minor,
    paid_minor: row.paid_minor,
    refunded_minor: row.refunded_minor,
    cancellation: { tiers: cancel.tiers, status },
    no_show_open: noShowOpen,
    ledger: ledgerRows.rows,
    balance_minor: balance
  };
}

function refundStatus(tiers: { refund_pct: number; deadline_utc: string }[], rooms: BookingRoom[]): { kind: "free" | "partial" | "none"; refund_pct: number; until_utc: string | null } {
  const now = clock.now();
  if (rooms.some((r) => r.state !== "cancelled" && r.plan === "nonrefundable")) {
    return { kind: "none", refund_pct: 0, until_utc: null };
  }
  const active = tiers.filter((t) => new Date(t.deadline_utc) > now);
  if (active.length === 0) return { kind: "none", refund_pct: 0, until_utc: null };
  const tier = active[0];
  return { kind: tier.refund_pct === 100 ? "free" : "partial", refund_pct: tier.refund_pct, until_utc: tier.deadline_utc };
}

function noShowWindowOpen(row: Record<string, unknown>, zone: string): boolean {
  const arrival = row.in_date as string;
  const dayAfter = addDays(toDate(arrival)!, 1).toISOString().slice(0, 10);
  const openFrom = resolveZoneTime(dayAfter + "T12:00", zone);
  const completion = row.completion_at ? new Date(row.completion_at as string) : null;
  const now = clock.now();
  return now.getTime() >= openFrom.getTime() && (completion === null || now.getTime() < completion.getTime());
}

async function getBooking(res: ServerResponse, ctx: Ctx, code: string): Promise<RouteResult> {
  const b = await bookingObject(code, ctx);
  if (!b) return E.notFound();
  return json(res, 200, b, { ETag: `"${b.version}"` });
}

async function findBooking(res: ServerResponse, ctx: Ctx, data: Record<string, unknown>): Promise<RouteResult> {
  const code = str(data.code) ?? "";
  const surname = str(data.surname) ?? "";
  const r = await db.query("SELECT id, code FROM bookings WHERE lower(code) = lower($1) AND lower(surname) = lower(trim($2))", [code, surname]);
  if (!r.rows[0]) return E.notFound();
  await db.query("INSERT INTO finder_bookings (visitor_id, booking_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [ctx.visitorId, r.rows[0].id]);
  return json(res, 200, { code: r.rows[0].code });
}

async function cancelPreview(res: ServerResponse, ctx: Ctx, code: string, url: URL): Promise<RouteResult> {
  const row = await loadBooking(code);
  if (!row || !await bookingVisible(ctx, row)) return E.notFound();
  const roomsParam = (url.searchParams.get("rooms") ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const result = await computeRefund(row, roomsParam);
  if (result === null) return E.conflict("invalid_state");
  return json(res, 200, result);
}

// ---------------------------------------------------------------------------
// reviews

async function reviewByToken(token: string): Promise<Record<string, unknown> | null> {
  const r = await db.query("SELECT * FROM bookings WHERE review_token = $1", [token]);
  return r.rows[0] ?? null;
}

async function reviewWindowState(b: Record<string, unknown>): Promise<"too_early" | "closed" | "used" | "open"> {
  const existing = await db.query("SELECT 1 FROM reviews WHERE booking_id = $1", [b.id]);
  if (existing.rows[0]) return "used";
  const now = clock.now();
  if (!b.completion_at || now < new Date(b.completion_at as string)) return "too_early";
  if (now.getTime() >= new Date(b.completion_at as string).getTime() + cfg.reviewWindowMs) return "closed";
  return "open";
}

async function getReview(res: ServerResponse, ctx: Ctx, token: string): Promise<RouteResult> {
  const b = await reviewByToken(token);
  if (!b) return E.notFound();
  const state = await reviewWindowState(b);
  if (state === "too_early") return E.forbidden();
  if (state === "closed") return E.gone("window_closed");
  if (state === "used") return E.conflict("already_reviewed");
  const property = await db.query("SELECT name FROM properties WHERE id = $1", [b.property_id]);
  return json(res, 200, {
    property: property.rows[0].name,
    in: b.in_date, out: b.out_date,
    open_until: new Date(new Date(b.completion_at as string).getTime() + cfg.reviewWindowMs).toISOString()
  });
}

async function postReview(res: ServerResponse, ctx: Ctx, token: string, data: Record<string, unknown>): Promise<RouteResult> {
  const b = await reviewByToken(token);
  if (!b) return E.notFound();
  const state = await reviewWindowState(b);
  if (state === "too_early") return E.forbidden();
  if (state === "closed") return E.gone("window_closed");
  if (state === "used") return E.conflict("already_reviewed");
  const keys = ["cleanliness", "comfort", "location", "staff", "value"] as const;
  const fields: Record<string, string> = {};
  const scores: number[] = [];
  for (const k of keys) {
    const v = data[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 10) { fields[k] = "review.score_range"; scores.push(0); }
    else scores.push(v);
  }
  const comment = str(data.comment) ?? "";
  if (comment.length > 2000) fields.comment = "too_long";
  if (Object.keys(fields).length > 0) return E.validation(fields);
  const r = await db.query(
    "INSERT INTO reviews (property_id, booking_id, cleanliness, comfort, location, staff, value, comment, state, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9) RETURNING id",
    [b.property_id, b.id, scores[0], scores[1], scores[2], scores[3], scores[4], comment, clock.now().toISOString()]
  );
  return json(res, 201, { id: r.rows[0].id, state: "pending" });
}

async function moderationList(res: ServerResponse, ctx: Ctx): Promise<RouteResult> {
  if (!ctx.username) return E.unauthorised();
  if (ctx.role !== "operator") return E.forbidden();
  const rows = await db.query(
    `SELECT r.id, r.cleanliness, r.comfort, r.location, r.staff, r.value, r.comment, p.name AS property
     FROM reviews r JOIN properties p ON p.id = r.property_id
     WHERE r.state = 'pending' ORDER BY r.created_at, r.id`
  );
  return json(res, 200, rows.rows);
}

async function moderateReview(res: ServerResponse, ctx: Ctx, id: string, state: "published" | "rejected"): Promise<RouteResult> {
  if (!ctx.username) return E.unauthorised();
  if (ctx.role !== "operator") return E.forbidden();
  const r = await db.query("SELECT * FROM reviews WHERE id = $1", [Number(id)]);
  if (!r.rows[0]) return E.notFound();
  if (r.rows[0].state !== "pending") return E.conflict("not_pending");
  await db.query("UPDATE reviews SET state = $1 WHERE id = $2", [state, Number(id)]);
  return json(res, 200, { id: Number(id), state });
}

// ---------------------------------------------------------------------------
// manager routes

async function requireManager(ctx: Ctx, code: string): Promise<PropertyRow | E.ApiError> {
  if (!ctx.username) return E.unauthorised();
  const property = await getProperty(db, code);
  if (!property) return E.notFound();
  const allowed = (ctx.role === "manager" && ctx.manages.includes(code)) || ctx.role === "operator";
  if (!allowed) return E.notFound();
  return property;
}

async function managerCalendar(res: ServerResponse, ctx: Ctx, code: string, url: URL): Promise<RouteResult> {
  const m = await requireManager(ctx, code);
  if (isErr(m)) return m;
  const property = m;
  const from = url.searchParams.get("from") ?? zoneDate(clock.now(), property.zone);
  const days = Math.min(120, Math.max(1, Number(url.searchParams.get("days") ?? 28)));
  const roomTypes = await getRoomTypes(db, property.id);
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date(from + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const inv = await inventoryFor(db, property.id, roomTypes, dates);
  const cells: Record<string, unknown>[] = [];
  for (const rt of roomTypes) {
    for (const date of dates) {
      const c = inv.get(rt.code)?.get(date);
      cells.push({
        room_type: rt.code, date,
        rate_minor: c?.rate_minor ?? rt.base_rate_minor,
        allotment: c?.allotment ?? rt.rooms,
        left: c?.left ?? rt.rooms,
        min_stay: c?.min_stay ?? 1,
        max_stay: c?.max_stay ?? 30,
        closed_to_arrival: c?.closed_to_arrival ?? false,
        closed_to_departure: c?.closed_to_departure ?? false,
        stop_sell: c?.stop_sell ?? false,
        release_days: c?.release_days ?? 0
      });
    }
  }
  return json(res, 200, { room_types: roomTypes.map((rt) => ({ code: rt.code, name: rt.name, rooms: rt.rooms })), cells });
}

async function managerNights(res: ServerResponse, ctx: Ctx, code: string, data: Record<string, unknown>): Promise<RouteResult> {
  const m = await requireManager(ctx, code);
  if (isErr(m)) return m;
  const property = m;
  const roomTypes = await getRoomTypes(db, property.id);
  const from = str(data.from) ?? "";
  const to = str(data.to) ?? "";
  const weekdays = Array.isArray(data.weekdays) ? [...new Set((data.weekdays as unknown[]).map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b) : [];
  const rate = int(data.rate_minor);
  const rooms = int(data.rooms);
  const minStay = int(data.min_stay);
  const maxStay = int(data.max_stay);
  const closedToArrival = bool(data.closed_to_arrival);
  const closedToDeparture = bool(data.closed_to_departure);
  const stopSell = bool(data.stop_sell);
  const seasonName = str(data.season_name);
  const replace = bool(data.replace);
  const replaceSeason = str(data.replace_season);
  const roomTypesIn = Array.isArray(data.room_types) ? (data.room_types as unknown[]).map(String) : [];
  const selected = roomTypes.filter((rt) => roomTypesIn.includes(rt.code));
  const fields: Record<string, unknown> = {};
  if (selected.length === 0) fields.room_types = "required";
  if (!from || !to || from > to) fields.from = "invalid";
  // from..to are inclusive; a single night is a one-night edit
  const allNights = from && to && from <= to ? eachNight(from, addDaysIso(to, 1)) : [];
  const nights = allNights.filter((d) => weekdays.includes(weekdayOf(d)));
  if (nights.length === 0) fields.weekdays = "required";
  let sold = 0;
  if (rooms !== undefined && nights.length > 0 && selected.length > 0) {
    sold = await maxHeldOrBooked(property.id, selected, nights);
    if (rooms < sold) fields.rooms = { code: "edit.rooms_sold", n: sold };
  }
  if (rate !== undefined && rate < 100) fields.rate_minor = { code: "edit.rate_min" };
  if (minStay !== undefined && maxStay !== undefined && maxStay < minStay) fields.max_stay = { code: "edit.max_below_min" };
  const isSeason = nights.length > 1;
  if (isSeason && (!seasonName || seasonName.trim() === "")) fields.season_name = { code: "edit.season_name" };
  if (Object.keys(fields).length > 0) return json(res, 422, { error: "validation", fields });
  // season overlap
  if (isSeason) {
    const seasons = await db.query("SELECT * FROM seasons WHERE property_id = $1 ORDER BY name", [property.id]);
    for (const s of seasons.rows) {
      if (replace && s.name === replaceSeason) continue;
      const sharedRoom = (s.room_type_ids as number[]).some((id) => selected.some((rt) => rt.id === id));
      if (!sharedRoom) continue;
      const overlapDates = nights.filter((d) => d >= s.from_date && d <= s.to_date && (s.weekdays as number[]).includes(weekdayOf(d)));
      if (overlapDates.length > 0) {
        return E.conflict("season_overlap", { season: seasonName, other: s.name, from: overlapDates[0], to: overlapDates[overlapDates.length - 1] });
      }
    }
  }
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    for (const rt of selected) {
      for (const date of nights) {
        await c.query(
          `UPDATE nights SET
             rate_minor = COALESCE($1, rate_minor), allotment = COALESCE($2, allotment),
             min_stay = COALESCE($3, min_stay), max_stay = COALESCE($4, max_stay),
             closed_to_arrival = COALESCE($5, closed_to_arrival), closed_to_departure = COALESCE($6, closed_to_departure),
             stop_sell = COALESCE($7, stop_sell)
           WHERE property_id = $8 AND room_type_id = $9 AND date = $10`,
          [rate, rooms, minStay, maxStay, closedToArrival, closedToDeparture, stopSell, property.id, rt.id, date]
        );
      }
    }
    if (isSeason) {
      if (replace) await c.query("DELETE FROM seasons WHERE property_id = $1 AND name = $2", [property.id, replaceSeason]);
      await c.query(
        "INSERT INTO seasons (property_id, name, room_type_ids, from_date, to_date, weekdays) VALUES ($1,$2,$3,$4,$5,$6)",
        [property.id, seasonName, selected.map((rt) => rt.id), from, to, weekdays]
      );
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  hub.publish({ name: "availability", to: {}, data: { property: code, dates: nights } });
  // every quote touching these nights goes stale: re-price it and notify its owner
  await staleQuotesForProperty(property.id, nights);
  return json(res, 200, { changed_nights: nights.length * selected.length, season: isSeason ? { name: seasonName } : null });
}

/**
 * A manager's rate edit makes every live quote touching those nights stale;
 * each owner receives quote.changed with the old and new totals.
 */
async function staleQuotesForProperty(propertyId: number, dates: string[]): Promise<void> {
  const quotes = await db.query(
    "SELECT * FROM quotes WHERE property_id = $1 AND expires_at > $2",
    [propertyId, clock.now().toISOString()]
  );
  for (const q of quotes.rows) {
    const fresh = await repriceQuote(q);
    if (fresh === null) continue;
    hub.publish({
      name: "quote.changed",
      to: { visitors: [q.visitor_id], ...(q.username ? { usernames: [q.username] } : {}) },
      data: { quote_id: q.id, reason: "rate", old_total_minor: q.total_minor, new_total_minor: fresh.total_minor }
    });
  }
}

function weekdayOf(date: string): number {
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  return dow === 0 ? 7 : dow;
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function maxHeldOrBooked(propertyId: number, roomTypes: RoomTypeRow[], nights: string[]): Promise<number> {
  let max = 0;
  for (const rt of roomTypes) {
    const heldRows = await db.query(
      `SELECT (SELECT count(*) FROM jsonb_array_elements(h.rooms) r WHERE r->>'room_type' = $2) AS n, h.expires_at
       FROM holds h WHERE h.property_id = $1 AND h.expires_at > $3`,
      [propertyId, rt.code, clock.now().toISOString()]
    );
    for (const h of heldRows.rows) {
      const roomNights = await db.query(
        "SELECT count(*)::int AS n FROM jsonb_array_elements((SELECT rooms FROM holds WHERE id IS NOT NULL)) AS x"
      ).catch(() => ({ rows: [{ n: 0 }] }));
      max = Math.max(max, h.n);
    }
    const booked = await db.query(
      `SELECT count(*)::int AS n FROM bookings b
       WHERE b.property_id = $1 AND b.state IN ('confirmed','changed','no_show')
         AND b.in_date <= $2 AND b.out_date > $2
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(b.rooms) r WHERE r->>'room_type' = $3)`,
      [propertyId, nights[0], rt.code]
    );
    max = Math.max(max, booked.rows[0].n);
  }
  return max;
}

async function managerReservations(res: ServerResponse, ctx: Ctx, code: string): Promise<RouteResult> {
  const m = await requireManager(ctx, code);
  if (isErr(m)) return m;
  const rows = await db.query(
    "SELECT code, surname, in_date AS arrival, out_date AS departure, rooms, total_minor, state FROM bookings WHERE property_id = $1 AND state NOT IN ('held','expired') ORDER BY in_date, code",
    [m.id]
  );
  const out = rows.rows.map((r: Record<string, unknown>) => ({
    code: r.code, surname: r.surname, arrival: r.arrival, departure: r.departure,
    rooms: normaliseRooms(r.rooms).filter((x) => x.state !== "cancelled").length,
    total_minor: r.total_minor, state: r.state
  }));
  return json(res, 200, out);
}

function csvCell(v: string | number): string {
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return '"' + s.replace(/"/g, '""') + '"';
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

async function managerReservationsCsv(res: ServerResponse, ctx: Ctx, code: string): Promise<RouteResult> {
  const m = await requireManager(ctx, code);
  if (isErr(m)) return m;
  const rows = await db.query(
    "SELECT code, surname, in_date, out_date, rooms, paid_minor, refunded_minor FROM bookings WHERE property_id = $1 AND state NOT IN ('held','expired') ORDER BY in_date, code",
    [m.id]
  );
  const lines = ["code,surname,arrival,departure,rooms,total_minor"];
  for (const r of rows.rows) {
    const rooms = normaliseRooms(r.rooms).filter((x) => x.state !== "cancelled").length;
    const total = r.paid_minor - r.refunded_minor;
    lines.push([csvCell(r.code), csvCell(r.surname), csvCell(r.in_date), csvCell(r.out_date), rooms, total].join(","));
  }
  res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${code}-reservations.csv"` });
  res.end(lines.join("\n") + "\n");
  return "handled";
}

// ---------------------------------------------------------------------------
// statements

async function statementData(code: string, ym: string): Promise<{ month: string; lines: { code: string; kind: "stay" | "cancellation"; base_minor: number; commission_minor: number }[]; total_base_minor: number; total_commission_minor: number } | null> {
  const property = await getProperty(db, code);
  if (!property) return null;
  const monthStart = ym + "-01";
  const monthEnd = nextMonthIso(monthStart);
  const rows = await db.query(
    "SELECT * FROM bookings WHERE property_id = $1 AND out_date >= $2 AND out_date < $3",
    [property.id, monthStart, monthEnd]
  );
  const lines: { code: string; kind: "stay" | "cancellation"; base_minor: number; commission_minor: number }[] = [];
  for (const b of rows.rows) {
    const rooms = normaliseRooms(b.rooms);
    const active = rooms.filter((r) => r.state !== "cancelled");
    if (active.length === 0) continue;
    let base = 0;
    for (const room of active) {
      for (const night of room.nights) {
        base += roomAmountOf(night.lines) + night.lines.filter((l) => l.key === "breakfast").reduce((s, l) => s + l.minor, 0);
      }
    }
    if (base > 0) lines.push({ code: b.code, kind: "stay", base_minor: base, commission_minor: roundHalfUp(base * 9, 100) });
  }
  lines.sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === "stay" ? -1 : 1));
  const totalBase = lines.reduce((s, l) => s + l.base_minor, 0);
  const totalCommission = lines.reduce((s, l) => s + l.commission_minor, 0);
  return { month: ym, lines, total_base_minor: totalBase, total_commission_minor: totalCommission };
}

function nextMonthIso(iso: string): string {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

async function statementRoute(res: ServerResponse, ctx: Ctx, code: string, ym: string): Promise<RouteResult> {
  const m = await requireManager(ctx, code);
  if (isErr(m)) return m;
  if (!/^\d{4}-\d{2}$/.test(ym)) return E.validation({ month: "invalid" });
  const data = await statementData(code, ym);
  if (!data) return E.notFound();
  const downloadable = zoneDate(clock.now(), m.zone) >= nextMonthIso(ym + "-01");
  return json(res, 200, { ...data, downloadable });
}

async function statementCsv(res: ServerResponse, ctx: Ctx, code: string, ym: string): Promise<RouteResult> {
  const m = await requireManager(ctx, code);
  if (isErr(m)) return m;
  if (!/^\d{4}-\d{2}$/.test(ym)) return E.validation({ month: "invalid" });
  if (zoneDate(clock.now(), m.zone) < nextMonthIso(ym + "-01")) return E.conflict("month_open");
  if (!storageAvailable()) return E.storageUnavailable();
  const key = `statements/${code}/${ym}.csv`;
  try {
    let buf = await s3.get(key);
    if (!buf) {
      const data = await statementData(code, ym);
      if (!data) return E.notFound();
      const lines = ["code,kind,base_minor,commission_minor"];
      for (const l of data.lines) lines.push([csvCell(l.code), csvCell(l.kind), l.base_minor, l.commission_minor].join(","));
      lines.push(["total", "", data.total_base_minor, data.total_commission_minor].join(","));
      const content = lines.join("\n") + "\n";
      await s3.put(key, Buffer.from(content, "utf-8"), "text/csv");
      buf = Buffer.from(content, "utf-8");
    }
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${code}-${ym}.csv"` });
    res.end(buf);
    return "handled";
  } catch {
    return E.storageUnavailable();
  }
}

async function computeRefund(row: Record<string, unknown>, roomNums: number[]): Promise<{ refund_minor: number; refund_pct: number } | null> {
  const rooms = normaliseRooms(row.rooms);
  const targets = rooms.filter((r) => roomNums.includes(r.n));
  if (targets.length === 0) return null;
  if (targets.some((r) => r.state !== "confirmed" && r.state !== "changed")) return null;
  const cancel = row.cancellation as { tiers: { refund_pct: number; deadline_utc: string }[] };
  const pct = pctInForce(cancel.tiers, targets);
  const paid = targets.reduce((s, r) => s + r.paid_minor - r.refunded_minor, 0);
  return { refund_minor: roundHalfUp(paid * pct, 100), refund_pct: pct };
}

function pctInForce(tiers: { refund_pct: number; deadline_utc: string }[], rooms: BookingRoom[]): number {
  if (rooms.some((r) => r.state !== "cancelled" && r.plan === "nonrefundable")) return 0;
  const now = clock.now();
  const active = tiers.filter((t) => new Date(t.deadline_utc) > now);
  return active.length === 0 ? 0 : active[0].refund_pct;
}

function roundHalfUp(a: number, b: number): number {
  return Number((2n * BigInt(a) + BigInt(b)) / (2n * BigInt(b)));
}

async function cancelBooking(req: IncomingMessage, res: ServerResponse, ctx: Ctx, code: string, data: Record<string, unknown>): Promise<RouteResult> {
  const ifMatch = req.headers["if-match"];
  if (typeof ifMatch !== "string" || ifMatch === "") return E.validation({ "If-Match": "required" });
  const row = await loadBooking(code);
  if (!row || !await bookingVisible(ctx, row)) return E.notFound();
  const version = Number(ifMatch.replace(/"/g, ""));
  if (version !== row.version) return E.conflict("version_conflict");
  const roomsParam = Array.isArray(data.rooms) ? (data.rooms as unknown[]).map(Number).filter((n) => Number.isInteger(n)) : [];
  const refund = await computeRefund(row, roomsParam);
  if (refund === null) return E.conflict("invalid_state");
  const rooms = normaliseRooms(row.rooms);
  const cancel = row.cancellation as { tiers: { refund_pct: number; deadline_utc: string }[] };
  const pct = pctInForce(cancel.tiers, rooms);
  const finalRooms = rooms.map((r) => {
    if (!roomsParam.includes(r.n)) return r;
    const roomRefund = roundHalfUp((r.paid_minor - r.refunded_minor) * pct, 100);
    return { ...r, state: "cancelled" as const, refunded_minor: r.refunded_minor + roomRefund };
  });
  const refunded = finalRooms.reduce((s, r) => s + r.refunded_minor, 0);
  const property = await db.query("SELECT p.code FROM properties p WHERE p.id = $1", [row.property_id]);
  await db.query(
    "UPDATE bookings SET rooms = $1, refunded_minor = $2, version = version + 1, state = $3 WHERE id = $4",
    [JSON.stringify(finalRooms), refunded, finalRooms.every((r) => r.state === "cancelled") ? "cancelled" : row.state, row.id]
  );
  const pair = row.id as number;
  await addLedger(pair, pair, "refund", "property", refund.refund_minor);
  await addLedger(pair, pair, "refund", "guest", 0, refund.refund_minor);
  const nightsBack = finalRooms.filter((r) => r.state === "cancelled").flatMap((r) => r.nights.map((n) => n.date));
  hub.publish({ name: "availability", to: {}, data: { property: property.rows[0].code, dates: nightsBack } });
  const b = await bookingObject(row.code as string, ctx);
  return json(res, 201, { refund_minor: refund.refund_minor, booking: b });
}

async function changeCheck(row: Record<string, unknown>, inDate: string, outDate: string): Promise<E.ApiError | { newTotal: number; paid: number; refundPct: number } | null> {
  const rooms = normaliseRooms(row.rooms);
  if (rooms.some((r) => r.state !== "cancelled" && r.plan === "nonrefundable")) return E.validation({ rooms: "nonrefundable" });
  if (!["confirmed", "changed"].includes(row.state as string)) return E.conflict("invalid_state");
  const propertyRow = await db.query("SELECT p.code, d.zone FROM properties p JOIN destinations d ON d.code = p.destination WHERE p.id = $1", [row.property_id]);
  const property = await getProperty(db, propertyRow.rows[0].code);
  const today = zoneDate(clock.now(), property!.zone);
  if ((row.in_date as string) <= today) return E.conflict("invalid_state");
  const roomTypes = await getRoomTypes(db, property!.id);
  const nights = eachNight(inDate, outDate);
  if (nights.length === 0 || nights.length > 30) return E.validation({ in: "invalid" });
  const inv = await inventoryFor(db, property!.id, roomTypes, nights, { excludeBooking: row.id as number });
  const byRt = new Map<string, number>();
  for (const r of rooms) if (r.state !== "cancelled") byRt.set(r.room_type, (byRt.get(r.room_type) ?? 0) + 1);
  for (const [rtCode, count] of byRt) {
    const reason = checkStay({ in: inDate, out: outDate, rooms: count, nights, inv: inv.get(rtCode)!, today });
    if (reason !== null) return E.restricted(reasonFields(reason));
  }
  const tierCount = await completedStaysCount(db, syntheticCtx(row));
  const tier = tierFor(tierCount);
  const priced = rooms.filter((r) => r.state !== "cancelled").map((r) => {
    const rt = roomTypes.find((x) => x.code === r.room_type)!;
    return priceRoom({ property: property!, roomType: rt, plan: r.plan, breakfast: r.breakfast, adults: r.adults, ages: r.ages, nights, rates: inv.get(rt.code)!, today, tier_pct: tier.pct });
  });
  const newTotal = priced.reduce((s, r) => s + r.total_minor, 0);
  const paid = (row.paid_minor as number) - (row.refunded_minor as number);
  const cancel = row.cancellation as { tiers: { refund_pct: number; deadline_utc: string }[] };
  const refundPct = pctInForce(cancel.tiers, rooms);
  return { newTotal, paid, refundPct };
}

function syntheticCtx(row: Record<string, unknown>): Ctx {
  return {
    visitorId: row.visitor_id as string, sessionId: null, username: (row.username as string | null) ?? null,
    role: null, manages: [], lang: "en", cur: "EUR", setVisitor: false, setSession: false, clearSession: false
  };
}

async function changePreview(res: ServerResponse, ctx: Ctx, code: string, data: Record<string, unknown>): Promise<RouteResult> {
  const row = await loadBooking(code);
  if (!row || !await bookingVisible(ctx, row)) return E.notFound();
  const inDate = str(data.in) ?? "";
  const outDate = str(data.out) ?? "";
  const check = await changeCheck(row, inDate, outDate);
  if (check === null) return E.notFound();
  if (isErr(check)) return check;
  const d = check.newTotal - check.paid;
  if (d > 0) return json(res, 200, { new_total_minor: check.newTotal, paid_minor: check.paid, pay_minor: d });
  const refundMinor = roundHalfUp(Math.abs(d) * check.refundPct, 100);
  return json(res, 200, { new_total_minor: check.newTotal, paid_minor: check.paid, refund_minor: refundMinor });
}

async function changeBooking(req: IncomingMessage, res: ServerResponse, ctx: Ctx, code: string, data: Record<string, unknown>): Promise<RouteResult> {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key === "") return E.validation({ "Idempotency-Key": "required" });
  const ifMatch = req.headers["if-match"];
  if (typeof ifMatch !== "string" || ifMatch === "") return E.validation({ "If-Match": "required" });
  const bodyStr = JSON.stringify(data);
  const stored = await db.query("SELECT status, body FROM idempotency WHERE key = $1", [key]);
  if (stored.rows[0]) {
    const saved = stored.rows[0].body as { request?: string };
    if (saved.request !== bodyStr) return E.conflict("idempotency_conflict");
    const replay = { ...saved };
    delete replay.request;
    return json(res, stored.rows[0].status, replay);
  }
  const row = await loadBooking(code);
  if (!row || !await bookingVisible(ctx, row)) return E.notFound();
  const version = Number(ifMatch.replace(/"/g, ""));
  if (version !== row.version) return E.conflict("version_conflict");
  const inDate = str(data.in) ?? "";
  const outDate = str(data.out) ?? "";
  const check = await changeCheck(row, inDate, outDate);
  if (check === null) return E.notFound();
  if (isErr(check)) return check;
  const d = check.newTotal - check.paid;
  const cardNumber = (str(data.card_number) ?? "").replace(/\s+/g, "");
  const expiry = str(data.expiry) ?? "";
  const sec = str(data.security_code) ?? "";
  const stepUp = str(data.step_up_code);
  if (d > 0) {
    const fields: Record<string, string> = {};
    if (!/^\d{16}$/.test(cardNumber)) fields.card_number = "field.card";
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expiry)) fields.expiry = "field.expiry";
    if (!/^\d{3}$/.test(sec)) fields.security_code = "field.code";
    if (Object.keys(fields).length > 0) return E.validation(fields);
    const outcome = cardOutcome(cardNumber, stepUp);
    if (outcome !== "approved") {
      const body = { error: "card", outcome };
      await storeIdempotent(key, 402, body, bodyStr);
      return json(res, 402, body);
    }
  }
  const propertyRow = await db.query("SELECT p.code, d.zone FROM properties p JOIN destinations d ON d.code = p.destination WHERE p.id = $1", [row.property_id]);
  const property = await getProperty(db, propertyRow.rows[0].code);
  const roomTypes = await getRoomTypes(db, property!.id);
  const nights = eachNight(inDate, outDate);
  const today = zoneDate(clock.now(), property!.zone);
  const inv = await inventoryFor(db, property!.id, roomTypes, nights, { excludeBooking: row.id as number });
  const tierCount = await completedStaysCount(db, syntheticCtx(row));
  const tier = tierFor(tierCount);
  const rooms = normaliseRooms(row.rooms);
  const newRooms: BookingRoom[] = rooms.map((r) => {
    if (r.state === "cancelled") return r;
    const rt = roomTypes.find((x) => x.code === r.room_type)!;
    const pr = priceRoom({ property: property!, roomType: rt, plan: r.plan, breakfast: r.breakfast, adults: r.adults, ages: r.ages, nights, rates: inv.get(rt.code)!, today, tier_pct: tier.pct });
    return { ...r, state: "changed", nights: pr.nights, paid_minor: pr.total_minor };
  });
  const newTotalAll = newRooms.reduce((s, r) => s + (r.state === "cancelled" ? 0 : r.paid_minor), 0);
  const pair = row.id as number;
  if (d > 0) {
    await addLedger(pair, pair, "change", "guest", d);
    await addLedger(pair, pair, "change", "property", 0, d);
  } else if (d < 0) {
    const refundMinor = roundHalfUp(Math.abs(d) * check.refundPct, 100);
    if (refundMinor > 0) {
      await addLedger(pair, pair, "change", "property", refundMinor);
      await addLedger(pair, pair, "change", "guest", 0, refundMinor);
      const newRefunded = (row.refunded_minor as number) + refundMinor;
      await db.query("UPDATE bookings SET refunded_minor = $1 WHERE id = $2", [newRefunded, row.id]);
    }
  }
  const oldNights = eachNight(row.in_date as string, row.out_date as string);
  await db.query(
    "UPDATE bookings SET in_date = $1, out_date = $2, nights = $3, rooms = $4, total_minor = $5, paid_minor = $6, version = version + 1, state = 'changed', completion_at = $7 WHERE id = $8",
    [inDate, outDate, JSON.stringify(nights), JSON.stringify(newRooms), newTotalAll,
      d > 0 ? (row.paid_minor as number) + d : row.paid_minor,
      completionInstant(property!.zone, outDate).toISOString(), row.id]
  );
  hub.publish({ name: "availability", to: {}, data: { property: property!.code, dates: [...oldNights, ...nights] } });
  const b = await bookingObject(row.code as string, ctx);
  await storeIdempotent(key, 200, { ...b, request: bodyStr }, bodyStr);
  const body = { ...b } as Record<string, unknown>;
  delete body.request;
  return json(res, 200, body);
}

async function noShow(req: IncomingMessage, res: ServerResponse, ctx: Ctx, code: string): Promise<RouteResult> {
  const ifMatch = req.headers["if-match"];
  if (typeof ifMatch !== "string" || ifMatch === "") return E.validation({ "If-Match": "required" });
  const row = await loadBooking(code);
  if (!row || !await bookingVisible(ctx, row)) return E.notFound();
  const propertyRow = await db.query("SELECT p.code, d.zone FROM properties p JOIN destinations d ON d.code = p.destination WHERE p.id = $1", [row.property_id]);
  const propertyCode = propertyRow.rows[0].code as string;
  if (!(ctx.role === "manager" && ctx.manages.includes(propertyCode)) && ctx.role !== "operator") return E.forbidden();
  const version = Number(ifMatch.replace(/"/g, ""));
  if (version !== row.version) return E.conflict("version_conflict");
  if (!noShowWindowOpen(row, propertyRow.rows[0].zone)) return E.conflict("too_early");
  const rooms = normaliseRooms(row.rooms);
  if (rooms.some((r) => r.state === "cancelled" || r.state === "no_show" || r.state === "completed")) return E.conflict("invalid_state");
  const newRooms = rooms.map((r) => ({ ...r, state: "no_show" as const }));
  await db.query("UPDATE bookings SET rooms = $1, version = version + 1, state = 'no_show' WHERE id = $2", [JSON.stringify(newRooms), row.id]);
  const b = await bookingObject(row.code as string, ctx);
  return json(res, 200, b);
}

// ---------------------------------------------------------------------------
// rate import

type ImportLine = { room: string; from: string; to: string; weekdays: string; rate: number; min: string; max: string; line: number };

type ParsedImport = {
  errors: { line: number; key: string; params: Record<string, unknown> }[];
  changes: { room: string; dates: string[]; old_minor: number; new_minor: number }[];
  sha256: string;
};

function validWeekdaysField(s: string): boolean {
  const letters = "MTWTFSS";
  if (s.length !== 7) return false;
  for (let i = 0; i < 7; i++) {
    if (s[i] !== "-" && s[i] !== letters[i]) return false;
  }
  return true;
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function weekdayIndexOf(date: string): number {
  const dow = new Date(date + "T00:00:00Z").getUTCDay();
  return dow === 0 ? 7 : dow;
}

function sharesNight(a: ImportLine, b: ImportLine): boolean {
  if (a.room !== b.room) return false;
  if (a.from > b.to || b.from > a.to) return false;
  for (let t = Date.parse(a.from + "T00:00:00Z"); t <= Date.parse(a.to + "T00:00:00Z"); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (date < b.from || date > b.to) continue;
    const wd = weekdayIndexOf(date);
    if (a.weekdays[wd - 1] !== "-" && b.weekdays[wd - 1] !== "-") return true;
  }
  return false;
}

/**
 * Parse and validate a rate file in the published KIPRATES 1 format.
 * Each line reports its first error; overlap is checked against the earliest
 * earlier line that shares a room and a night on a ticked weekday.
 */
function parseImport(text: string, roomCodes: string[]): ParsedImport {
  const errors: { line: number; key: string; params: Record<string, unknown> }[] = [];
  const sha256 = crypto.createHash("sha256").update(text, "utf-8").digest("hex");
  const lines = text.split(/\r\n|\n/);
  if (lines.length === 0 || lines[0].trim() !== "KIPRATES 1") {
    errors.push({ line: 1, key: "import.header", params: { n: 1 } });
    return { errors, changes: [], sha256 };
  }
  const valid: ImportLine[] = [];
  lines.forEach((line, idx) => {
    const n = idx + 1;
    if (n === 1) return;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const fields = line.split("|").map((f) => f.trim());
    if (fields.length !== 8) { errors.push({ line: n, key: "import.fields", params: { n, m: fields.length } }); return; }
    const [room, plan, from, to, weekdays, rate, minS, maxS] = fields;
    if (!roomCodes.includes(room)) { errors.push({ line: n, key: "import.room", params: { n, x: room } }); return; }
    if (plan !== "refundable") { errors.push({ line: n, key: "import.plan", params: { n, x: plan } }); return; }
    if (!isValidDate(from)) { errors.push({ line: n, key: "import.date", params: { n, x: from } }); return; }
    if (!isValidDate(to)) { errors.push({ line: n, key: "import.date", params: { n, x: to } }); return; }
    if (from > to) { errors.push({ line: n, key: "import.order", params: { n, from, to } }); return; }
    if (!validWeekdaysField(weekdays)) { errors.push({ line: n, key: "import.weekdays", params: { n, x: weekdays } }); return; }
    if (!/^\d+$/.test(rate) || Number(rate) <= 0) { errors.push({ line: n, key: "import.rate", params: { n } }); return; }
    if ((minS !== "" && !/^\d+$/.test(minS)) || (maxS !== "" && !/^\d+$/.test(maxS))) {
      errors.push({ line: n, key: "import.limits", params: { n, x: `${minS}|${maxS}` } }); return;
    }
    if (minS !== "" && maxS !== "" && Number(maxS) < Number(minS)) {
      errors.push({ line: n, key: "import.limits", params: { n, x: `${minS}|${maxS}` } }); return;
    }
    valid.push({ room, from, to, weekdays, rate: Number(rate), min: minS, max: maxS, line: n });
  });
  for (let i = 0; i < valid.length; i++) {
    const a = valid[i];
    const earlier = valid.slice(0, i).find((b) => sharesNight(a, b));
    if (earlier) { errors.push({ line: a.line, key: "import.overlap", params: { n: a.line, m: earlier.line } }); break; }
  }
  errors.sort((a, b) => a.line - b.line);
  return { errors, changes: [], sha256 };
}

async function importPreview(req: IncomingMessage, res: ServerResponse, ctx: Ctx, code: string): Promise<RouteResult> {
  const m = await requireManager(ctx, code);
  if (isErr(m)) return m;
  const raw = await readBody(req, cfg.importMaxBytes);
  if (isErr(raw)) return raw;
  if (raw.length > cfg.importMaxBytes) return E.tooLarge();
  const roomTypes = await getRoomTypes(db, m.id);
  const result = parseImport(raw.toString("utf-8"), roomTypes.map((rt) => rt.code));
  if (result.errors.length > 0) return json(res, 422, { error: "import_invalid", lines: result.errors });
  const changes = await importChanges(m.id, roomTypes, result.sha256, raw.toString("utf-8"));
  return json(res, 200, { sha256: result.sha256, changes, count: changes.length });
}

async function importApply(req: IncomingMessage, res: ServerResponse, ctx: Ctx, code: string): Promise<RouteResult> {
  const m = await requireManager(ctx, code);
  if (isErr(m)) return m;
  const raw = await readBody(req, cfg.importMaxBytes);
  if (isErr(raw)) return raw;
  if (raw.length > cfg.importMaxBytes) return E.tooLarge();
  const roomTypes = await getRoomTypes(db, m.id);
  const result = parseImport(raw.toString("utf-8"), roomTypes.map((rt) => rt.code));
  if (result.errors.length > 0) return json(res, 422, { error: "import_invalid", lines: result.errors });
  const seen = await db.query("SELECT 1 FROM imports WHERE sha256 = $1", [result.sha256]);
  if (seen.rows[0]) return json(res, 201, { sha256: result.sha256, count: 0, key: result.sha256 });
  // store the exact bytes first; when storage fails nothing applies
  if (!storageAvailable()) return E.storageUnavailable();
  try {
    await s3.put(`imports/${code}/${result.sha256}.kiprates`, raw, "application/octet-stream");
  } catch {
    return E.storageUnavailable();
  }
  const changes = await importChanges(m.id, roomTypes, result.sha256, raw.toString("utf-8"));
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    for (const ch of changes) {
      const rt = roomTypes.find((r) => r.code === ch.room)!;
      for (const date of ch.dates) {
        await c.query("UPDATE nights SET rate_minor = $1 WHERE property_id = $2 AND room_type_id = $3 AND date = $4", [ch.new_minor, m.id, rt.id, date]);
      }
    }
    await c.query("INSERT INTO imports (sha256, property_id) VALUES ($1, $2) ON CONFLICT (sha256) DO NOTHING", [result.sha256, m.id]);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  const dates = [...new Set(changes.flatMap((ch) => ch.dates))];
  hub.publish({ name: "availability", to: {}, data: { property: code, dates } });
  return json(res, 201, { sha256: result.sha256, count: changes.length, key: result.sha256 });
}

/** One change per night whose refundable base rate would change, ordered by room then date. */
async function importChanges(propertyId: number, roomTypes: RoomTypeRow[], sha: string, text: string): Promise<{ room: string; dates: string[]; old_minor: number; new_minor: number }[]> {
  const validLines = collectValidLines(text, roomTypes.map((rt) => rt.code));
  const out: { room: string; dates: string[]; old_minor: number; new_minor: number }[] = [];
  for (const line of validLines) {
    const rt = roomTypes.find((r) => r.code === line.room)!;
    const dates: string[] = [];
    for (let t = Date.parse(line.from + "T00:00:00Z"); t <= Date.parse(line.to + "T00:00:00Z"); t += 86400000) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (line.weekdays[weekdayIndexOf(date) - 1] !== "-") dates.push(date);
    }
    const current = await db.query(
      "SELECT date, rate_minor FROM nights WHERE property_id = $1 AND room_type_id = $2 AND date = ANY($3::date[])",
      [propertyId, rt.id, dates]
    );
    const byDate = new Map<string, number>(current.rows.map((r: { date: string; rate_minor: number }) => [r.date, r.rate_minor]));
    for (const date of dates) {
      const old = byDate.get(date);
      if (old === undefined || old !== line.rate) {
        out.push({ room: line.room, dates: [date], old_minor: old ?? 0, new_minor: line.rate });
      }
    }
  }
  out.sort((a, b) => (a.room === b.room ? (a.dates[0] < b.dates[0] ? -1 : 1) : a.room.localeCompare(b.room)));
  return out;
}

function collectValidLines(text: string, roomCodes: string[]): ImportLine[] {
  const lines = text.split(/\r\n|\n/);
  const out: ImportLine[] = [];
  lines.forEach((line, idx) => {
    const n = idx + 1;
    if (n === 1) return;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const fields = line.split("|").map((f) => f.trim());
    if (fields.length !== 8) return;
    const [room, , from, to, weekdays, rate] = fields;
    if (!roomCodes.includes(room) || !isValidDate(from) || !isValidDate(to) || from > to) return;
    if (!validWeekdaysField(weekdays) || !/^\d+$/.test(rate) || Number(rate) <= 0) return;
    out.push({ room, from, to, weekdays, rate: Number(rate), min: "", max: "", line: n });
  });
  return out;
}

// ---------------------------------------------------------------------------
// invoice and storage pages

export async function serveInvoice(code: string): Promise<string | null | "unavailable"> {
  const row = await loadBooking(code);
  if (!row) return null;
  if (!storageAvailable()) return "unavailable";
  const key = `invoices/${row.code}.html`;
  try {
    const existing = await s3.get(key);
    if (existing) return existing.toString("utf-8");
    const html = await renderInvoice(row);
    await s3.put(key, Buffer.from(html, "utf-8"), "text/html; charset=utf-8");
    return html;
  } catch {
    return "unavailable";
  }
}

async function renderInvoice(row: Record<string, unknown>): Promise<string> {
  const property = await db.query("SELECT p.code, p.name, d.zone FROM properties p JOIN destinations d ON d.code = p.destination WHERE p.id = $1", [row.property_id]);
  const rooms = normaliseRooms(row.rooms);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let vatTotal = 0, cityTotal = 0;
  const rowsHtml: string[] = [];
  for (const room of rooms) {
    for (const night of room.nights) {
      const vat = night.lines.find((l) => l.key === "vat")?.minor ?? 0;
      const city = night.lines.find((l) => l.key === "city_tax")?.minor ?? 0;
      vatTotal += vat;
      cityTotal += city;
      const lines = night.lines.map((l) => `<div class="line"><span>${esc(l.key)}</span><span>${l.minor}</span></div>`).join("");
      rowsHtml.push(`<tr><td>${room.room_type}</td><td>${night.date}</td><td class="lines">${lines}</td><td class="num">${night.total_minor}</td></tr>`);
    }
  }
  const ledgerRows = await db.query("SELECT pair, kind, account, debit_minor, credit_minor, at FROM ledger WHERE pair = $1 ORDER BY id", [row.id]);
  const ledgerHtml = ledgerRows.rows.map((l: Record<string, unknown>) =>
    `<tr><td>${l.kind}</td><td>${l.account}</td><td class="num">${l.debit_minor}</td><td class="num">${l.credit_minor}</td><td>${l.at}</td></tr>`
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice ${esc(row.code as string)}</title>
<style>
body{font-family:Chivo,system-ui,sans-serif;margin:48px;color:#000;background:#fff}
h1{font-weight:900;font-size:64px;margin:0}
table{width:100%;border-collapse:collapse;margin-top:24px}
td,th{padding:6px 10px;text-align:left;vertical-align:top}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.lines .line{display:flex;justify-content:space-between;gap:24px}
.totals{margin-top:24px;font-weight:900;font-size:32px}
</style></head><body>
<h1>${esc(row.code as string)}</h1>
<p>${esc(row.given_name as string)} ${esc(row.surname as string)}</p>
<p>${esc(property.rows[0].name)} (${esc(property.rows[0].zone)})</p>
<p>${row.in_date} to ${row.out_date}</p>
<table><tr><th>Room</th><th>Date</th><th>Price lines</th><th>Night total</th></tr>${rowsHtml.join("")}</table>
<p class="totals">Total ${row.total_minor} minor units (EUR)</p>
<p>VAT ${vatTotal}, city tax ${cityTotal}</p>
<table><tr><th>Kind</th><th>Account</th><th>Debit</th><th>Credit</th><th>Time</th></tr>${ledgerHtml}</table>
<p>Paid by card ending ${row.card_last4}</p>
</body></html>`;
}

export function storageDocPage(lang: Lang): string {
  const copy: Record<Lang, string> = {
    en: "Storage is unavailable. Try again.",
    de: "Der Speicher ist nicht verfügbar. Versuchen Sie es erneut.",
    ar: "التخزين غير متاح. حاول مرة أخرى."
  };
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Kipwell</title></head><body><div role="alert" style="background:#000;color:#f5f5f0;padding:16px">${copy[lang]}</div></body></html>`;
}

// ---------------------------------------------------------------------------
// seed (grading)

async function seedRoute(res: ServerResponse, data: Record<string, unknown>): Promise<RouteResult> {
  const out: Record<string, unknown> = { users: [] as string[], destinations: [] as string[], properties: [] as string[], bookings: [] as Record<string, unknown>[], reviews: [] as Record<string, unknown>[] };
  const users = Array.isArray(data.users) ? data.users : [];
  for (const u of users as Record<string, unknown>[]) {
    const username = String(u.username ?? "").toLowerCase();
    const password = String(u.password ?? "");
    const role = String(u.role ?? "guest");
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return E.validation({ username: "invalid" });
    if (password.length < 1) return E.validation({ password: "required" });
    const exists = await db.query("SELECT 1 FROM users WHERE username = $1", [username]);
    if (exists.rows[0]) return E.conflict("exists", { code: username });
    await db.query("INSERT INTO users (username, password_hash, role) VALUES ($1, crypt($2, gen_salt('bf')), $3)", [username, password, role]);
    (out.users as string[]).push(username);
    for (const code of Array.isArray(u.manages) ? (u.manages as unknown[]).map(String) : []) {
      const p = await db.query("SELECT id FROM properties WHERE code = $1", [code]);
      if (p.rows[0]) await db.query("INSERT INTO manager_properties (username, property_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [username, p.rows[0].id]);
    }
  }
  const destinations = Array.isArray(data.destinations) ? data.destinations : [];
  for (const d of destinations as Record<string, unknown>[]) {
    const code = String(d.code ?? "");
    const exists = await db.query("SELECT 1 FROM destinations WHERE code = $1", [code]);
    if (exists.rows[0]) return E.conflict("exists", { code });
    await db.query("INSERT INTO destinations (code, name, zone, cx, cy) VALUES ($1,$2,$3,$4,$5)", [code, String(d.name ?? ""), String(d.zone ?? "UTC"), Number(d.cx ?? 500), Number(d.cy ?? 500)]);
    (out.destinations as string[]).push(code);
  }
  const properties = Array.isArray(data.properties) ? data.properties : [];
  for (const p of properties as Record<string, unknown>[]) {
    const code = String(p.code ?? "");
    const exists = await db.query("SELECT 1 FROM properties WHERE code = $1", [code]);
    if (exists.rows[0]) return E.conflict("exists", { code });
    const dest = await db.query("SELECT * FROM destinations WHERE code = $1", [String(p.destination ?? "")]);
    if (!dest.rows[0]) return E.validation({ destination: "invalid" });
    const r = await db.query(
      `INSERT INTO properties (code, destination, name, x, y, stars, amenities, vat_pct, city_minor, levy_pct, breakfast_minor, single_pct, policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [code, String(p.destination), String(p.name ?? code), Number(p.x ?? dest.rows[0].cx), Number(p.y ?? dest.rows[0].cy),
        Number(p.stars ?? 3), Array.isArray(p.amenities) ? p.amenities : [],
        p.vat_pct !== undefined ? Number(p.vat_pct) : 7, p.city_minor !== undefined ? Number(p.city_minor) : 300,
        p.levy_pct !== undefined ? Number(p.levy_pct) : 10, p.breakfast_minor !== undefined ? Number(p.breakfast_minor) : 900,
        p.single_pct !== undefined ? Number(p.single_pct) : 10, JSON.stringify(Array.isArray(p.policy) ? p.policy : [])]
    );
    const pid = r.rows[0].id;
    for (const rt of (Array.isArray(p.room_types) ? p.room_types : []) as Record<string, unknown>[]) {
      const base = Number(rt.base_rate_minor ?? 12000);
      const rooms = Number(rt.rooms ?? 1);
      const rr = await db.query(
        `INSERT INTO room_types (code, property_id, name, included_adults, max_adults, max_guests, extra_adult_minor, child_minor, base_rate_minor, rooms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [String(rt.code ?? `${code}-DBL`), pid, String(rt.name ?? "Double"), Number(rt.included_adults ?? 2),
          Number(rt.max_adults ?? 2), Number(rt.max_guests ?? 3), Number(rt.extra_adult_minor ?? 2500),
          Number(rt.child_minor ?? 1500), base, rooms]
      );
      await db.query(
        `INSERT INTO nights (property_id, room_type_id, date, rate_minor, allotment, min_stay, max_stay, closed_to_arrival, closed_to_departure, stop_sell, release_days)
         SELECT $1, $2, d::date, $3, $4, 1, 30, false, false, false, 0
         FROM generate_series('2026-01-01'::date, '2028-12-31'::date, '1 day') AS d`,
        [pid, rr.rows[0].id, base, rooms]
      );
    }
    (out.properties as string[]).push(code);
  }
  const nightOverrides = Array.isArray(data.nights) ? data.nights : [];
  for (const n of nightOverrides as Record<string, unknown>[]) {
    const rt = await db.query("SELECT id, property_id FROM room_types WHERE code = $1", [String(n.room_type ?? "")]);
    if (!rt.rows[0]) return E.validation({ room_type: "invalid" });
    await db.query(
      `UPDATE nights SET
         rate_minor = COALESCE($1, rate_minor), allotment = COALESCE($2, allotment),
         min_stay = COALESCE($3, min_stay), max_stay = COALESCE($4, max_stay),
         closed_to_arrival = COALESCE($5, closed_to_arrival), closed_to_departure = COALESCE($6, closed_to_departure),
         stop_sell = COALESCE($7, stop_sell), release_days = COALESCE($8, release_days)
       WHERE room_type_id = $9 AND date >= $10 AND date <= $11`,
      [n.base_rate_minor !== undefined ? Number(n.base_rate_minor) : null,
       n.allotment !== undefined ? Number(n.allotment) : null,
       n.min_stay !== undefined ? Number(n.min_stay) : null,
       n.max_stay !== undefined ? Number(n.max_stay) : null,
       n.closed_to_arrival !== undefined ? Boolean(n.closed_to_arrival) : null,
       n.closed_to_departure !== undefined ? Boolean(n.closed_to_departure) : null,
       n.stop_sell !== undefined ? Boolean(n.stop_sell) : null,
       n.release_days !== undefined ? Number(n.release_days) : null,
       rt.rows[0].id, String(n.from), String(n.to)]
    );
  }
  // completed_stays create completed one-room bookings for that user
  for (const u of users as Record<string, unknown>[]) {
    const stays = Array.isArray(u.completed_stays) ? u.completed_stays : [];
    for (const stay of stays as Record<string, unknown>[]) {
      await seedCompletedStay(String(u.username ?? "").toLowerCase(), String(stay.property ?? ""), String(stay.checkout ?? ""));
    }
  }
  const bookings = Array.isArray(data.bookings) ? data.bookings : [];
  for (const b of bookings as Record<string, unknown>[]) {
    const seeded = await seedBooking(b);
    if (isErr(seeded)) return seeded;
    (out.bookings as Record<string, unknown>[]).push(seeded);
  }
  const reviews = Array.isArray(data.reviews) ? data.reviews : [];
  for (const r of reviews as Record<string, unknown>[]) {
    const seeded = await seedReview(r);
    if (isErr(seeded)) return seeded;
    (out.reviews as Record<string, unknown>[]).push(seeded);
  }
  return json(res, 201, out);
}

async function seedCompletedStay(username: string, propertyCode: string, checkout: string): Promise<void> {
  const property = await getProperty(db, propertyCode);
  if (!property) return;
  const roomTypes = await getRoomTypes(db, property.id);
  if (roomTypes.length === 0) return;
  const rt = roomTypes[0];
  const inDate = shiftDate(checkout, -1);
  const code = bookingCode();
  const nights = eachNight(inDate, checkout);
  const priced = priceRoom({ property, roomType: rt, plan: "refundable", breakfast: false, adults: 2, ages: [], nights, rates: new Map([[nights[0], { date: nights[0], rate_minor: 12000, allotment: 5, left: 5, min_stay: 1, max_stay: 30, closed_to_arrival: false, closed_to_departure: false, stop_sell: false, release_days: 0 }]]), today: "2026-01-01", tier_pct: 0 });
  const total = priced.total_minor;
  const rooms: BookingRoom[] = [{
    n: 1, room_type: rt.code, plan: "refundable", breakfast: false, adults: 2, ages: [],
    state: "completed", paid_minor: total, refunded_minor: 0, nights: priced.nights
  }];
  const completion = completionInstant(property.zone, checkout);
  const r = await db.query(
    `INSERT INTO bookings (code, state, property_id, in_date, out_date, given_name, surname, card_last4,
       quote_currency, username, total_minor, paid_minor, refunded_minor, nights, rooms, cancellation, completion_at)
     VALUES ($1,'completed',$2,$3,$4,$5,$6,'0002','EUR',$7,$8,$8,0,$9,$10,$11,$12) RETURNING id`,
    [code, property.id, inDate, checkout, username, username, total, JSON.stringify(nights), JSON.stringify(rooms),
      JSON.stringify(cancellationSnapshot(property, inDate)), completion.toISOString()]
  );
  await addLedger(r.rows[0].id, r.rows[0].id, "charge", "guest", total);
  await addLedger(r.rows[0].id, r.rows[0].id, "charge", "property", 0, total);
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seedBooking(b: Record<string, unknown>): Promise<Record<string, unknown> | E.ApiError> {
  const propertyCode = String(b.property ?? "");
  const property = await getProperty(db, propertyCode);
  if (!property) return E.validation({ property: "invalid" });
  const username = b.guest === null || b.guest === undefined ? null : String(b.guest).toLowerCase();
  const inDate = String(b.in ?? "");
  const outDate = String(b.out ?? "");
  const currency = String(b.currency ?? "EUR");
  const state = String(b.state ?? "confirmed");
  const roomTypes = await getRoomTypes(db, property.id);
  const nights = eachNight(inDate, outDate);
  if (nights.length === 0) return E.validation({ in: "invalid" });
  const inv = await inventoryFor(db, property.id, roomTypes, nights);
  const today = zoneDate(clock.now(), property.zone);
  const roomsIn = (Array.isArray(b.rooms) ? b.rooms : []) as Record<string, unknown>[];
  const pricedRooms: pricedRoom[] = [];
  for (const r of roomsIn) {
    const rt = roomTypes.find((x) => x.code === String(r.room_type ?? ""));
    if (!rt) return E.validation({ rooms: "invalid" });
    const plan: Plan = r.plan === "nonrefundable" ? "nonrefundable" : "refundable";
    const priced = priceRoom({
      property, roomType: rt, plan, breakfast: r.breakfast === true,
      adults: Number(r.adults ?? 2), ages: Array.isArray(r.ages) ? (r.ages as unknown[]).map(Number) : [],
      nights, rates: inv.get(rt.code)!, today, tier_pct: 0
    });
    pricedRooms.push(priced);
  }
  const total = pricedRooms.reduce((s, r) => s + r.total_minor, 0);
  const code = bookingCode();
  if (state === "held") {
    // a live hold and quote
    const quoteId = "q_" + randomToken(12);
    const holdId = "h_" + randomToken(12);
    const expires = new Date(clock.value() + cfg.holdMs);
    const roomsJson = pricedRooms.map((r) => ({ room_type: r.room_type, plan: r.plan, breakfast: r.breakfast, adults: r.adults, ages: r.ages }));
    await db.query(
      `INSERT INTO quotes (id, visitor_id, username, property_id, currency, tier, tier_pct, rates_ppm, in_date, out_date, adults, ages, rooms, total_minor, taxable_minor, nights, expires_at, hold_id)
       VALUES ($1,$2,$3,$4,$5,'Wren',0,'{}'::jsonb,$6,$7,$8,'[]'::jsonb,$9,$10,0,'[]'::jsonb,$11,$12)`,
      [quoteId, "seed-" + randomToken(8), username, property.id, currency, inDate, outDate, roomsJson.reduce((s, r) => s + r.adults, 0), JSON.stringify(roomsJson), total, expires.toISOString(), holdId]
    );
    await db.query(
      "INSERT INTO holds (id, quote_id, visitor_id, username, property_id, rooms, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [holdId, quoteId, "seed-" + randomToken(8), username, property.id, JSON.stringify(roomsJson.map((r) => ({ ...r, nights }))), expires.toISOString()]
    );
    return { code: null, state: "held", version: 1, quote_id: quoteId, hold_id: holdId, expires_at: expires.toISOString(), review_link: null };
  }
  const rooms: BookingRoom[] = pricedRooms.map((r, i) => ({
    n: i + 1, room_type: r.room_type, plan: r.plan, breakfast: r.breakfast, adults: r.adults, ages: r.ages,
    state: state === "cancelled" ? "cancelled" : state === "no_show" ? "no_show" : state === "completed" ? "completed" : "confirmed",
    paid_minor: r.total_minor, refunded_minor: 0, nights: r.nights
  }));
  const completion = state === "completed" ? completionInstant(property.zone, outDate) : completionInstant(property.zone, outDate);
  const token = randomToken(20);
  const given = String(b.given_name ?? "Guest");
  const surname = String(b.surname ?? "Guest");
  const insert = await db.query(
    `INSERT INTO bookings (code, state, property_id, in_date, out_date, given_name, surname, card_last4,
       quote_currency, username, total_minor, paid_minor, refunded_minor, nights, rooms, cancellation, review_token, completion_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'0002',$8,$9,$10,$10,0,$11,$12,$13,$14,$15) RETURNING id, version`,
    [code, state === "cancelled" ? "cancelled" : state === "no_show" ? "no_show" : state === "completed" ? "completed" : "confirmed",
      property.id, inDate, outDate, given, surname, currency, username, total,
      JSON.stringify(nights), JSON.stringify(rooms), JSON.stringify(cancellationSnapshot(property, inDate)), token, completion.toISOString()]
  );
  const id = insert.rows[0].id;
  if (state !== "cancelled" && state !== "no_show") {
    await addLedger(id, id, "charge", "guest", total);
    await addLedger(id, id, "charge", "property", 0, total);
  }
  if (state === "completed") {
    // inbox message with the review link for the booking's guest
    const propertyRow = await db.query("SELECT name FROM properties WHERE id = $1", [property.id]);
    await db.query("INSERT INTO inbox (username, kind, property, link, at) VALUES ($1,'review',$2,$3,$4)", [
      username, propertyRow.rows[0].name, `/reviews/${token}`, completion.toISOString()
    ]);
  }
  return { code, state, version: insert.rows[0].version, quote_id: null, hold_id: null, expires_at: null, review_link: `/reviews/${token}` };
}

async function seedReview(r: Record<string, unknown>): Promise<Record<string, unknown> | E.ApiError> {
  const property = await getProperty(db, String(r.property ?? ""));
  if (!property) return E.validation({ property: "invalid" });
  const scores = Array.isArray(r.scores) ? (r.scores as unknown[]).map(Number) : [];
  if (scores.length !== 5 || scores.some((s) => !Number.isInteger(s) || s < 1 || s > 10)) return E.validation({ scores: "invalid" });
  const ageDays = Number(r.age_days ?? 0);
  const createdAt = new Date(clock.value() - ageDays * 86400000);
  const state = String(r.state ?? "pending");
  const row = await db.query(
    "INSERT INTO reviews (property_id, booking_id, cleanliness, comfort, location, staff, value, comment, state, created_at) VALUES ($1,0,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
    [property.id, scores[0], scores[1], scores[2], scores[3], scores[4], String(r.comment ?? ""), state, createdAt.toISOString()]
  );
  return { id: row.rows[0].id, state };
}


