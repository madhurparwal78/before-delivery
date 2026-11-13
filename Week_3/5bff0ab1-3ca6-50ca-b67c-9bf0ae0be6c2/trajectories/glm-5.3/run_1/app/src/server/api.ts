// The one router for the whole API. Every error comes from the shared builder,
// with the one published precedence: 401, then 404, then 403, then 409, then 422, then 503.
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config";
import {
  ApiError,
  
  errorBody,
  throwApi} from "./errors";
import {
  pool,
  verifyPassword,
  hashPassword,
  newId,
  
  n,
  normaliseLockRow,
  normaliseRideRow,
  
  
  type UserRow} from "./db";
import {
  appNowMs,
  istDateOf,
  isValidDateString,
  toIsoIst,
  unfreezeAppClock,
  setAppClock,
  parseIsoTime} from "./clock";
import * as store from "./store";
import * as ledger from "./ledger";
import * as rides from "./rides";
import * as hubSvc from "./hub";
import { renderPdf, sheetHtml } from "./sheet";
import { turnOnReminders} from "./notices";
import {
  CHAPTERS,
  FINISHES,
  HUBS,
  MODELS,
  SEED_HOSTS,
  SEED_RIDERS,
  SEED_RIDES,
  ON_HAND,
  EARLIER_SALES,
  finishById,
  hubById,
  modelById} from "./seed";
import {
  bookableDates,
  
  
  
  isClosedDay,
  pastCutOff,
  slotsForDay,
  insideBookablePattern} from "./domain";
import {} from "./db";
import { seedClockMs } from "./clock";

const BODY_LIMIT = 16384;

export interface Caller {
  id: string;
  role: "rider" | "hub_host";
  hub: string | null;
  name: string;
  sessionToken: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    ...extraHeaders});
  res.end(data);
}

function sendError(res: ServerResponse, err: ApiError): void {
  sendJson(res, err.status, errorBody(err.code), err.headers);
}

async function readBody(req: IncomingMessage): Promise<{ raw: Buffer; json: unknown | null; malformed: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > BODY_LIMIT) throwApi(413, "too_large");
    chunks.push(b);
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) return { raw, json: null, malformed: false };
  const ct = String(req.headers["content-type"] ?? "");
  const isJson = ct.split(";")[0].trim().toLowerCase() === "application/json";
  if (!isJson) return { raw, json: null, malformed: false };
  try {
    return { raw, json: JSON.parse(raw.toString("utf8")), malformed: false };
  } catch {
    return { raw, json: null, malformed: true };
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const { json, malformed } = await readBody(req);
  if (malformed || json === null || typeof json !== "object" || Array.isArray(json)) {
    throwApi(422, "invalid_body");
  }
  return json as Record<string, unknown>;
}

async function callerFromReq(req: IncomingMessage): Promise<Caller | null> {
  const cookie = String(req.headers.cookie ?? "");
  const token = /(?:^|;\s*)mkos=([^;]+)/.exec(cookie)?.[1];
  if (!token) return null;
  const r = await pool.query(
    `SELECT s.token, s.started_at_ms, s.ended, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token]
  );
  if (!r.rowCount) return null;
  const row = r.rows[0] as UserRow & { token: string; started_at_ms: number; ended: boolean };
  // A session ends 12 hours after sign-in on the app clock; at exactly 12 hours it has ended.
  if (row.ended || appNowMs() - n(row.started_at_ms) >= 12 * 3600000) {
    throwApi(401, "session_ended");
  }
  return {
    id: row.id,
    role: row.role,
    hub: row.hub,
    name: row.name,
    sessionToken: row.token};
}

function requireRider(caller: Caller | null): Caller {
  if (!caller) throwApi(401, "unauthenticated");
  if (caller.role !== "rider") throwApi(403, "forbidden");
  return caller;
}

function requireHost(caller: Caller | null): Caller & { hub: string } {
  if (!caller) throwApi(401, "unauthenticated");
  if (caller.role !== "hub_host") throwApi(403, "forbidden");
  if (caller.hub === null) throwApi(403, "forbidden");
  return { ...caller, hub: caller.hub };
}

function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader("Set-Cookie", `mkos=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

// ---------- route table ----------

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL, caller: Caller | null) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  needsBody?: boolean;
  noBody?: boolean;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler, opts?: { noBody?: boolean }): void {
  const pattern = new RegExp(
    "^" + path.replace(/:[^/]+/g, "([^/]+)") + "$"
  );
  routes.push({ method, pattern, handler, noBody: opts?.noBody });
}

// ---------- public ----------

route("GET", "/api/health", async (_req, res) => {
  sendJson(res, 200, { status: "ok" });
});

route("GET", "/api/catalogue", async (_req, res) => {
  sendJson(res, 200, {
    models: MODELS.map((m) => ({ id: m.id, name: m.name, cc: m.cc })),
    finishes: FINISHES.map((f) => ({ id: f.id, name: f.name })),
    hubs: HUBS.map((h) => ({ id: h.id, name: h.name })),
    chapters: CHAPTERS.map((c) => ({
      id: c.id,
      name: c.name,
      parts: c.parts.map((p) => ({ id: p.id, name: p.name }))}))});
});

function readSelection(url: URL): { hub: string; model: string; finish: string } {
  const hub = url.searchParams.get("hub") ?? "pune";
  const model = url.searchParams.get("model") ?? "megh-349";
  const finish = url.searchParams.get("finish") ?? "monsoon-slate";
  if (!hubById(hub) || !modelById(model) || !finishById(finish)) throwApi(422, "invalid_body");
  return { hub, model, finish };
}

route("GET", "/api/live/now", async (req, res, url, caller) => {
  const sel = readSelection(url);
  const reading = await store.liveReading(sel.hub, sel.model, sel.finish, caller);
  sendJson(res, 200, reading);
});

route("GET", "/api/hubs/:hub/slots", async (req, res, url, _caller) => {
  const hubId = url.pathname.split("/")[3];
  if (!hubById(hubId)) throwApi(404, "not_found");
  const date = url.searchParams.get("date") ?? "";
  if (!isValidDateString(date)) throwApi(422, "invalid_body");
  const now = appNowMs();
  const today = istDateOf(now);
  // A date before today in IST, or more than 14 IST calendar days ahead, gets 200
  // with open false and slots empty.
  const diff = daysDiff(today, date);
  if (diff < 0 || diff > 14 || isClosedDay(hubId, date)) {
    sendJson(res, 200, {
      date,
      dayLabel: store.dayLabelOf(hubId, date, today),
      open: false,
      slots: []});
    return;
  }
  const booked = new Set(
    (
      await pool.query(`SELECT starts_at_ms FROM rides WHERE hub = $1 AND state = 'booked'`, [hubId])
    ).rows.map((r: { starts_at_ms: number }) => n(r.starts_at_ms))
  );
  // The ledger is the source of truth for whether a slot is taken: a Postgres
  // booked ride may be newer than the sweep has rebuilt.
  const slots: { startsAt: string; label: string; state: string }[] = [];
  for (const start of slotsForDay(hubId, date)) {
    const taken =
      booked.has(start) ||
      (await ledger.slotValue(hubId, store.slotKeyOf(start)).catch(() => null)) !== null;
    const cut = pastCutOff(start, now);
    slots.push({
      startsAt: toIsoIst(start),
      label: store.slotLabel(start),
      state: cut ? "past_cut_off" : taken ? "taken" : "free"});
  }
  sendJson(res, 200, {
    date,
    dayLabel: store.dayLabelOf(hubId, date, today),
    open: true,
    slots});
});

route("GET", "/api/hubs/:hub/ride-days", async (req, res, url) => {
  const hubId = url.pathname.split("/")[3];
  if (!hubById(hubId)) throwApi(404, "not_found");
  const now = appNowMs();
  const today = istDateOf(now);
  const days = bookableDates(hubId, now).map((d) => ({ date: d, dayLabel: store.dayLabelOf(hubId, d, today) }));
  sendJson(res, 200, { days });
});

// ---------- accounts ----------

route("POST", "/api/auth/register", async (req, res) => {
  const body = await readJsonBody(req);
  const name = typeof body.name === "string" ? body.name : "";
  const mobile = typeof body.mobile === "string" ? body.mobile : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (name.length < 1 || name.length > 120) throwApi(422, "invalid_body");
  if (!/^[6-9]\d{9}$/.test(mobile)) throwApi(422, "invalid_body");
  if (password.length < 8) throwApi(422, "invalid_body");
  const existing = await pool.query(`SELECT id FROM users WHERE mobile = $1`, [mobile]);
  if (existing.rowCount) throwApi(409, "mobile_taken");
  const id = newId("rider");
  await pool.query(
    `INSERT INTO users (id, role, name, mobile, password_hash) VALUES ($1, 'rider', $2, $3, $4)`,
    [id, name, mobile, hashPassword(password)]
  );
  const token = newId("sess");
  await pool.query(`INSERT INTO sessions (token, user_id, started_at_ms) VALUES ($1, $2, $3)`, [
    token,
    id,
    appNowMs(),
  ]);
  setSessionCookie(res, token);
  const user = (await pool.query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0] as UserRow;
  sendJson(res, 201, { user: store.userToJson(user) });
});

route("POST", "/api/auth/signin", async (req, res) => {
  const body = await readJsonBody(req);
  const mobile = typeof body.mobile === "string" ? body.mobile : "";
  const password = typeof body.password === "string" ? body.password : "";
  const r = await pool.query(`SELECT * FROM users WHERE mobile = $1`, [mobile]);
  if (!r.rowCount || !verifyPassword(password, (r.rows[0] as UserRow & { password_hash: string | null }).password_hash)) {
    throwApi(401, "bad_credentials");
  }
  const token = newId("sess");
  await pool.query(`INSERT INTO sessions (token, user_id, started_at_ms) VALUES ($1, $2, $3)`, [
    token,
    (r.rows[0] as UserRow).id,
    appNowMs(),
  ]);
  setSessionCookie(res, token);
  sendJson(res, 200, { user: store.userToJson(r.rows[0] as UserRow) });
});

route("POST", "/api/auth/signout", async (req, res, _url, caller) => {
  if (!caller) throwApi(401, "unauthenticated");
  await pool.query(`DELETE FROM sessions WHERE token = $1`, [caller.sessionToken]);
  res.writeHead(204, { "Set-Cookie": `mkos=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
  res.end();
}, { noBody: true });

route("GET", "/api/me", async (req, res, _url, caller) => {
  const user = await callerFromReq(req);
  if (!user) throwApi(401, "unauthenticated");
  const r = await pool.query(`SELECT * FROM users WHERE id = $1`, [user.id]);
  sendJson(res, 200, { user: store.userToJson(r.rows[0] as UserRow) });
});

// ---------- rider: locks ----------

route("GET", "/api/locks", async (req, res, _url, caller) => {
  const rider = requireRider(caller);
  const r = await pool.query(`SELECT * FROM locks WHERE rider_id = $1 ORDER BY issued_at_ms DESC`, [rider.id]);
  const now = appNowMs();
  sendJson(res, 200, { locks: (r.rows as Record<string, unknown>[]).map(normaliseLockRow).map((l) => store.lockToJson(l, now)) });
});

route("POST", "/api/locks", async (req, res, _url, caller) => {
  const rider = requireRider(caller);
  const body = await readJsonBody(req);
  const hub = typeof body.hub === "string" ? body.hub : "";
  const model = typeof body.model === "string" ? body.model : "";
  const finish = typeof body.finish === "string" ? body.finish : "";
  const stepEffectiveFrom = body.stepEffectiveFrom;
  // A body with an unknown hub, model or finish is 422 invalid_body.
  if (!hubById(hub) || !modelById(model) || !finishById(finish)) throwApi(422, "invalid_body");
  if (typeof stepEffectiveFrom !== "string" || !isValidDateString(stepEffectiveFrom)) {
    // A missing or malformed stepEffectiveFrom falls through to the state refusals.
  }
  const result = await rides.claimLock(rider.id, { hub, model, finish, stepEffectiveFrom: typeof stepEffectiveFrom === "string" ? stepEffectiveFrom : "" });
  sendJson(res, result.status, { lock: store.lockToJson(result.lock, appNowMs()) });
  await ledger.publishRiderChange(rider.id);
});

route("GET", "/api/locks/:id", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const lock = await rides.riderLock(rider.id, url.pathname.split("/")[3]);
  sendJson(res, 200, { lock: store.lockToJson(lock, appNowMs()) });
});

route("POST", "/api/locks/:id/release", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const lock = await rides.releaseLock(rider.id, url.pathname.split("/")[3]);
  sendJson(res, 200, { lock: store.lockToJson(lock, appNowMs()) });
  await ledger.publishRiderChange(rider.id);
}, { noBody: true });

// A sheet can be made for a lock in locked or delivery_set. Parallel presses or
// requests across both copies make one render: the render is claimed atomically in
// Postgres, the losers wait for the winner, and a stored render is never made again.
async function makeOrReuseSheet(res: ServerResponse, rider: Caller, lockId: string): Promise<void> {
  const lock = await rides.riderLock(rider.id, lockId);
  if (lock.state === "requested") throwApi(409, "illegal_state");
  if (lock.expires_at_ms !== null && n(lock.expires_at_ms) <= appNowMs() && lock.state !== "delivery_set") {
    throwApi(409, "lock_expired");
  }
  if (lock.state !== "locked" && lock.state !== "delivery_set") throwApi(409, "illegal_state");
  if (lock.sheet_ready) {
    const fresh = await rides.riderLock(rider.id, lockId);
    sendJson(res, 200, { lock: store.lockToJson(fresh, appNowMs()) });
    return;
  }
  // Claim the render: only one press across all copies renders.
  const claim = await pool.query(
    `UPDATE locks SET sheet_rendering = true WHERE id = $1 AND sheet_rendering = false RETURNING id`,
    [lockId]
  );
  if (claim.rowCount === 0) {
    // another copy is rendering: wait for the winner, then answer with its result
    const fresh = await waitForSheet(lockId);
    if (fresh !== null) {
      const ready = await rides.riderLock(rider.id, lockId);
      sendJson(res, 200, { lock: store.lockToJson(ready, appNowMs()) });
      return;
    }
    throwApi(503, "sheet_unreachable");
  }
  try {
    const html = sheetHtml(lock, rider.name);
    const pdf = await renderPdf(html);
    if (!pdf) {
      // a failed render stores nothing and does not latch
      await pool.query(`UPDATE locks SET sheet_rendering = false WHERE id = $1`, [lockId]);
      throwApi(503, "sheet_unreachable");
    }
    await pool.query(`UPDATE locks SET sheet_ready = true, sheet_pdf = $2, sheet_rendering = false WHERE id = $1`, [lockId, pdf]);
    const ready = await rides.riderLock(rider.id, lockId);
    sendJson(res, 201, { lock: store.lockToJson(ready, appNowMs()) });
  } catch (e) {
    await pool.query(`UPDATE locks SET sheet_rendering = false WHERE id = $1`, [lockId]).catch(() => {});
    throw e;
  }
}

// Waits for a parallel render to finish, for a short while.
async function waitForSheet(lockId: string): Promise<boolean | null> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const row = await pool.query(`SELECT sheet_ready, sheet_rendering FROM locks WHERE id = $1`, [lockId]);
    if (row.rowCount) {
      const state = row.rows[0] as { sheet_ready: boolean; sheet_rendering: boolean };
      if (state.sheet_ready) return true;
      if (!state.sheet_rendering) return null;
    }
  }
  return null;
}

route("POST", "/api/locks/:id/sheet", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  await makeOrReuseSheet(res, rider, url.pathname.split("/")[3]);
  await ledger.publishRiderChange(rider.id);
}, { noBody: true });

route("GET", "/api/locks/:id/sheet", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const lockId = url.pathname.split("/")[3];
  const lock = await rides.riderLock(rider.id, lockId);
  if (!lock.sheet_ready) throwApi(404, "not_found");
  const r = await pool.query(`SELECT sheet_pdf FROM locks WHERE id = $1`, [lockId]);
  const pdf = (r.rows[0] as { sheet_pdf: Buffer }).sheet_pdf;
  if (!pdf) throwApi(404, "not_found");
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="malhar-price-sheet-${lockId}.pdf"`,
    "Content-Length": pdf.length,
    "Cache-Control": "no-store"});
  res.end(pdf);
});

route("GET", "/api/locks/:id/delivery-days", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const lock = await rides.riderLock(rider.id, url.pathname.split("/")[3]);
  const days = await rides.deliveryDays(lock);
  const now = appNowMs();
  const today = istDateOf(now);
  sendJson(res, 200, {
    days: days.map((d) => ({
      date: d.date,
      dayLabel: store.dayLabelOf(lock.hub, d.date, today),
      capacity: d.capacity,
      placesLeft: d.state === "closed" ? (d.placesLeft === 0 ? 0 : d.placesLeft) : d.placesLeft,
      state: d.state}))});
});

route("POST", "/api/locks/:id/delivery", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const lockId = url.pathname.split("/")[3];
  const body = await readJsonBody(req);
  const date = typeof body.date === "string" ? body.date : "";
  const lock0 = await rides.riderLock(rider.id, lockId);
  // replay of the same day returns before any refusal
  if (lock0.state === "delivery_set" && lock0.delivery_date === date && isValidDateString(date)) {
    sendJson(res, 200, { lock: store.lockToJson(lock0, appNowMs()) });
    return;
  }
  if (!isValidDateString(date)) {
    if (n(lock0.expires_at_ms ?? 0) !== 0 && lock0.state !== "delivery_set" && n(lock0.expires_at_ms) <= appNowMs()) {
      throwApi(409, "lock_expired");
    }
    throwApi(422, "invalid_body");
  }
  const lock = await rides.setDeliveryDay(rider.id, lockId, date);
  sendJson(res, 200, { lock: store.lockToJson(lock, appNowMs()) });
  await ledger.publishRiderChange(rider.id);
});

route("POST", "/api/locks/:id/delivery/wait", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const lockId = url.pathname.split("/")[3];
  const body = await readJsonBody(req);
  const date = typeof body.date === "string" ? body.date : "";
  const lock0 = await rides.riderLock(rider.id, lockId);
  if (lock0.waiting_for === date && lock0.state === "locked" && isValidDateString(date)) {
    sendJson(res, 200, { lock: store.lockToJson(lock0, appNowMs()) });
    return;
  }
  if (!isValidDateString(date)) {
    if (n(lock0.expires_at_ms ?? 0) !== 0 && lock0.state !== "delivery_set" && n(lock0.expires_at_ms) <= appNowMs()) {
      throwApi(409, "lock_expired");
    }
    throwApi(422, "invalid_body");
  }
  const result = await rides.joinWaitLine(rider.id, lockId, date);
  sendJson(res, result.status, { lock: store.lockToJson(result.lock, appNowMs()) });
  await ledger.publishRiderChange(rider.id);
});

route("POST", "/api/locks/:id/delivery/wait/leave", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const lock = await rides.leaveWaitLine(rider.id, url.pathname.split("/")[3]);
  sendJson(res, 200, { lock: store.lockToJson(lock, appNowMs()) });
  await ledger.publishRiderChange(rider.id);
}, { noBody: true });

// ---------- rider: rides ----------

route("GET", "/api/rides", async (req, res, _url, caller) => {
  const rider = requireRider(caller);
  const r = await pool.query(`SELECT * FROM rides WHERE rider_id = $1 ORDER BY starts_at_ms ASC`, [rider.id]);
  const now = appNowMs();
  sendJson(res, 200, { rides: (r.rows as Record<string, unknown>[]).map(normaliseRideRow).map((x) => store.rideToJson(x, now)) });
});

route("GET", "/api/rides/:id", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const ride = await rides.riderRide(rider.id, url.pathname.split("/")[3]);
  sendJson(res, 200, { ride: store.rideToJson(ride, appNowMs()) });
});

route("POST", "/api/rides", async (req, res, _url, caller) => {
  const rider = requireRider(caller);
  const body = await readJsonBody(req);
  const hub = typeof body.hub === "string" ? body.hub : "";
  const model = typeof body.model === "string" ? body.model : "";
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const licenceNumber = typeof body.licenceNumber === "string" ? body.licenceNumber : "";
  const licenceValidUntil = typeof body.licenceValidUntil === "string" ? body.licenceValidUntil : "";
  const hasMcwg = body.hasMcwg === true;
  if (!hubById(hub) || !modelById(model)) throwApi(422, "invalid_body");
  // Inside 422, a ride body with several faults gets the first code that applies.
  const now = appNowMs();
  const startMs = parseIsoTimeOrNull(startsAt);
  if (startMs === null) throwApi(422, "invalid_body");
  const rawBooked = (
    await pool.query(`SELECT * FROM rides WHERE rider_id = $1 AND model = $2 AND state = 'booked'`, [rider.id, model])
  ).rows as Record<string, unknown>[];
  const booked = rawBooked.map(normaliseRideRow);
  if (booked.length > 0) {
    const same = booked.find((r) => r.hub === hub && n(r.starts_at_ms) === startMs);
    if (same) {
      sendJson(res, 200, { ride: store.rideToJson(same, now) });
      return;
    }
    if (insideBookablePattern(hub, startMs, now) && !validLicenceFn(licenceNumber)) {
      // ride_exists applies whatever start the body names; checked after the replay
    }
    throwApi(409, "ride_exists");
  }
  // malformed field, including a malformed licenceValidUntil
  if (!/^[6-9]\d{9}$/.test("") ) { /* unreachable guard, placeholder */ }
  const inPattern = insideBookablePattern(hub, startMs, now);
  if (!validLicenceFn(licenceNumber)) throwApi(422, "licence_invalid");
  if (!hasMcwg) throwApi(422, "mcwg_required");
  if (!isValidDateString(licenceValidUntil)) throwApi(422, "invalid_body");
  const rideDate = istDateOf(startMs);
  if (rideDate > licenceValidUntil) throwApi(422, "licence_expired");
  if (!inPattern) throwApi(422, "invalid_slot");
  if (pastCutOff(startMs, now)) throwApi(409, "ride_cut_off");
  if (await hubStaleForClaims(hub)) throwApi(503, "hub_unreachable");
  const result = await rides.claimRide(rider.id, { hub, model, startsAt, licenceNumber, licenceValidUntil, hasMcwg });
  sendJson(res, result.status, { ride: store.rideToJson(result.ride, appNowMs()) });
  await ledger.publishRiderChange(rider.id);
});

function parseIsoTimeOrNull(s: string): number | null {
  return parseIsoTime(s);
}

import { validLicenceNumber as validLicenceFn } from "./domain";

async function hubStaleForClaims(hub: string): Promise<boolean> {
  const r = await pool.query(`SELECT stale_reason FROM hub_state WHERE hub = $1`, [hub]);
  // a stock count pauses only lock claims; rides work as usual
  return r.rowCount ? (r.rows[0] as { stale_reason: string | null }).stale_reason === "system" : true;
}

route("POST", "/api/rides/:id/move", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const body = await readJsonBody(req);
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const startMs = parseIsoTimeOrNull(startsAt);
  if (startMs === null) {
    // A cancelled ride, malformed startsAt on move -> illegal_state when not booked.
    const ride = await rides.riderRide(rider.id, url.pathname.split("/")[3]);
    if (ride.state !== "booked") throwApi(409, "illegal_state");
    throwApi(422, "invalid_body");
  }
  const ride = await rides.moveRide(rider.id, url.pathname.split("/")[3], startsAt);
  sendJson(res, 200, { ride: store.rideToJson(ride, appNowMs()) });
  await ledger.publishRiderChange(rider.id);
});

route("POST", "/api/rides/:id/cancel", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const ride = await rides.cancelRide(rider.id, url.pathname.split("/")[3]);
  sendJson(res, 200, { ride: store.rideToJson(ride, appNowMs()) });
  await ledger.publishRiderChange(rider.id);
}, { noBody: true });

// ---------- rider: reminders and notices ----------

route("POST", "/api/reminders", async (req, res, _url, caller) => {
  const rider = requireRider(caller);
  const already = (await pool.query(`SELECT reminders_on FROM users WHERE id = $1`, [rider.id])).rows[0] as {
    reminders_on: boolean;
  };
  if (already.reminders_on) {
    sendJson(res, 200, { remindersOn: true, topic: `malhar-${rider.id}` });
    return;
  }
  const result = await turnOnReminders(rider.id);
  if (!result.remindersOn) throwApi(503, "notice_unreachable");
  sendJson(res, 200, { remindersOn: true, topic: result.topic });
}, { noBody: true });

route("GET", "/api/notices", async (req, res, _url, caller) => {
  const rider = requireRider(caller);
  const r = await pool.query(`SELECT * FROM notices WHERE rider_id = $1 ORDER BY due_at_ms ASC`, [rider.id]);
  sendJson(res, 200, {
    notices: (r.rows as { id: string; kind: string; state: string; due_at_ms: number; sent_at_ms: number | null; lock_id: string | null; ride_id: string | null }[]).map((row) => ({
      id: row.id,
      kind: row.kind,
      state: row.state,
      dueAt: toIsoIst(n(row.due_at_ms)),
      sentAt: row.sent_at_ms !== null ? toIsoIst(n(row.sent_at_ms)) : null,
      lockId: row.lock_id,
      rideId: row.ride_id}))});
});

route("GET", "/api/notices/:id", async (req, res, url, caller) => {
  const rider = requireRider(caller);
  const id = url.pathname.split("/")[3];
  const r = await pool.query(`SELECT * FROM notices WHERE id = $1 AND rider_id = $2`, [id, rider.id]);
  if (!r.rowCount) throwApi(404, "not_found");
  const row = r.rows[0] as { id: string; kind: string; state: string; due_at_ms: number; sent_at_ms: number | null; lock_id: string | null; ride_id: string | null };
  sendJson(res, 200, {
    notice: {
      id: row.id,
      kind: row.kind,
      state: row.state,
      dueAt: toIsoIst(n(row.due_at_ms)),
      sentAt: row.sent_at_ms !== null ? toIsoIst(n(row.sent_at_ms)) : null,
      lockId: row.lock_id,
      rideId: row.ride_id}});
});

// ---------- hub host ----------

route("GET", "/api/hub/day-sheet", async (req, res, url, caller) => {
  const host = requireHost(caller);
  const dateParam = url.searchParams.get("date");
  let date: string;
  if (dateParam === null) {
    date = istDateOf(appNowMs());
  } else if (!isValidDateString(dateParam)) {
    throwApi(422, "invalid_body");
  } else {
    date = dateParam;
  }
  const sheet = await hubSvc.daySheet(host, date);
  sendJson(res, 200, sheet);
});

route("GET", "/api/hub/held-units", async (req, res, _url, caller) => {
  const host = requireHost(caller);
  sendJson(res, 200, { rows: await hubSvc.heldUnits(host) });
});

route("GET", "/api/hub/stock", async (req, res, _url, caller) => {
  const host = requireHost(caller);
  sendJson(res, 200, await store.hubStock(host.hub));
});

route("POST", "/api/hub/rides/:id/mark", async (req, res, url, caller) => {
  const host = requireHost(caller);
  const body = await readJsonBody(req);
  const outcome = body.outcome;
  if (outcome !== "ridden" && outcome !== "no_show") throwApi(422, "invalid_body");
  const ride = await hubSvc.markRide(host, url.pathname.split("/")[4], outcome);
  sendJson(res, 200, { ride: store.rideToJson(ride, appNowMs()) });
});

route("POST", "/api/hub/locks/:id/delivered", async (req, res, url, caller) => {
  const host = requireHost(caller);
  const lock = await hubSvc.markDelivered(host, url.pathname.split("/")[4]);
  sendJson(res, 200, { lock: store.lockToJson(lock, appNowMs()) });
  await ledger.publishRiderChange(lock.rider_id);
}, { noBody: true });

route("POST", "/api/hub/locks/:id/confirm", async (req, res, url, caller) => {
  const host = requireHost(caller);
  const lock = await hubSvc.confirmUnit(host, url.pathname.split("/")[4]);
  sendJson(res, 200, { lock: store.lockToJson(lock, appNowMs()) });
  await ledger.publishRiderChange(lock.rider_id);
}, { noBody: true });

route("POST", "/api/hub/locks/:id/refuse", async (req, res, url, caller) => {
  const host = requireHost(caller);
  const lock = await hubSvc.refuseUnit(host, url.pathname.split("/")[4]);
  sendJson(res, 200, { lock: store.lockToJson(lock, appNowMs()) });
}, { noBody: true });

route("POST", "/api/hub/locks/:id/withdraw", async (req, res, url, caller) => {
  const host = requireHost(caller);
  const lock = await hubSvc.withdrawUnit(host, url.pathname.split("/")[4]);
  sendJson(res, 200, { lock: store.lockToJson(lock, appNowMs()) });
  await ledger.publishRiderChange(lock.rider_id);
}, { noBody: true });

route("POST", "/api/hub/stock-count/start", async (req, res, _url, caller) => {
  const host = requireHost(caller);
  await hubSvc.startStockCount(host);
  sendJson(res, 200, await store.hubStock(host.hub));
}, { noBody: true });

route("POST", "/api/hub/stock-count/finish", async (req, res, _url, caller) => {
  const host = requireHost(caller);
  const body = await readJsonBody(req);
  const unitsRaw = body.units;
  if (!Array.isArray(unitsRaw)) throwApi(422, "invalid_body");
  const units: { model: string; finish: string; onHand: number }[] = [];
  for (const row of unitsRaw) {
    if (typeof row !== "object" || row === null) throwApi(422, "invalid_body");
    const r = row as Record<string, unknown>;
    if (typeof r.model !== "string" || typeof r.finish !== "string" || typeof r.onHand !== "number" || !Number.isInteger(r.onHand) || r.onHand < 0) {
      throwApi(422, "invalid_body");
    }
    units.push({ model: r.model, finish: r.finish, onHand: r.onHand });
  }
  await hubSvc.finishStockCount(host, units);
  sendJson(res, 200, await store.hubStock(host.hub));
});

// ---------- test surface ----------

function testSurface(handler: Handler): Handler {
  return async (req, res, url, caller) => {
    if (!config.testClock) throwApi(404, "not_found");
    await handler(req, res, url, caller);
  };
}

route("POST", "/api/test/clock", testSurface(async (req, res) => {
  const body = await readJsonBody(req);
  const atRaw = typeof body.at === "string" ? body.at : "";
  const atMs = parseIsoTime(atRaw);
  if (atMs === null) throwApi(422, "invalid_body");
  const freeze = body.freeze === true;
  const { applyTestClock } = await import("./testclock");
  const now = await applyTestClock(atMs, freeze);
  sendJson(res, 200, { now: toIsoIst(now) });
}));

route("POST", "/api/test/reset", testSurface(async (req, res) => {
  await resetDatabase();
  sendJson(res, 200, { now: toIsoIst(appNowMs()) });
}), { noBody: true });

async function resetDatabase(): Promise<void> {
  // Restores seed data and the seeded clock, rebuilds the prefix's ledger keys and
  // ends all sessions. Sequence numbers keep rising.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`DELETE FROM notices`);
    await c.query(`DELETE FROM rides`);
    await c.query(`DELETE FROM locks`);
    await c.query(`DELETE FROM sessions`);
    await c.query(`DELETE FROM users WHERE id NOT LIKE '%\_9%' ESCAPE '\\' OR id = ''`);
    // restore seeded users' data
    for (const host of SEED_HOSTS) {
      await c.query(`UPDATE users SET reminders_on = false WHERE id = $1`, [`host_${host.mobile}`]);
    }
    for (const rider of SEED_RIDERS) {
      await c.query(
        `UPDATE users SET licence_number = $2, licence_valid_until = $3, reminders_on = false WHERE id = $1`,
        [`rider_${rider.mobile}`, rider.licenceNumber, rider.licenceValidUntil]
      );
    }
    for (const [hub, per] of Object.entries(ON_HAND)) {
      for (const [modelFinish, count] of Object.entries(per)) {
        const [model, finish] = modelFinish.split(":");
        await c.query(`UPDATE on_hand SET on_hand = $4 WHERE hub = $1 AND model = $2 AND finish = $3`, [hub, model, finish, count]);
      }
    }
    await c.query(`UPDATE hub_state SET counting = false, stale_reason = NULL, stale_since_ms = NULL, stock_as_of_ms = $1::bigint`, [String(seedClockMs())]);
    for (const r of SEED_RIDES) {
      const licence = SEED_RIDERS.find((x) => x.mobile === r.riderMobile)?.licenceNumber ?? null;
      await c.query(
        `INSERT INTO rides (id, rider_id, hub, model, starts_at_ms, state, moved_from_ms, licence_last4, created_at_ms)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, starts_at_ms = EXCLUDED.starts_at_ms, licence_last4 = EXCLUDED.licence_last4`,
        [`ride_seed_${r.riderMobile}`, `rider_${r.riderMobile}`, r.hub, r.model, r.startsAtMs, r.state, licence ? licence.slice(-4) : null, seedClockMs()]
      );
    }
    // remove non-seed app_state rows that tests may have created
    await c.query(`DELETE FROM app_state WHERE key LIKE 'instants:%'`);
    await c.query(
      `INSERT INTO app_state (key, value) VALUES ('clock_bias_ms', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [String(seedClockMs() - Date.now())]
    );
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  // rebuild the prefix's ledger keys
  try {
    await ledger.deleteAllPrefixKeys();
    await rebuildLedgerFromPostgres();
  } catch {
    // a later sweep retries
  }
  // restore the seeded clock and clear any freeze, in both stores
  await pool.query(`DELETE FROM app_state WHERE key = 'clock_frozen_ms'`, []);
  setAppClock(seedClockMs(), false);
  unfreezeAppClock();
}

export async function rebuildLedgerFromPostgres(): Promise<void> {
  // on-hand keys
  for (const [hub, per] of Object.entries(ON_HAND)) {
    for (const [modelFinish] of Object.entries(per)) {
      const [model, finish] = modelFinish.split(":");
      const r = await pool.query(`SELECT on_hand FROM on_hand WHERE hub = $1 AND model = $2 AND finish = $3`, [hub, model, finish]);
      await ledger.writeOnHand(hub, model, finish, r.rowCount ? n(r.rows[0].on_hand) : 0);
    }
  }
  // seeded rides hold their slot keys
  for (const r of SEED_RIDES) {
    await ledger.setSlotIfMissing(r.hub, r.startsAtMs, `ride_seed_${r.riderMobile}`);
  }
  // earlier sales place members
  for (const sale of EARLIER_SALES) {
    for (let i = 1; i <= sale.count; i++) {
      await ledger.addPlaceIfMissing(sale.hub, sale.date, `earlier-sale-${i}`);
    }
  }
}

function daysDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// ---------- dispatch ----------

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/")) return false;
  const path = url.pathname;

  // 413 and 415 are answered before the request is otherwise read, even when signed out.
  const method = req.method ?? "GET";

  // find matching route
  const matched = routes.filter((r) => r.pattern.test(path));
  if (matched.length === 0) {
    // unknown /api path
    sendError(res, new ApiError(404, "not_found"));
    return true;
  }
  const routeMatch = matched.find((r) => r.method === method);
  if (!routeMatch) {
    const allow = [...new Set(matched.map((r) => r.method))].join(", ");
    sendError(res, new ApiError(405, "method_not_allowed", { Allow: allow }));
    return true;
  }


  try {
    const caller = await callerFromReq(req);
    // Role guards: a signed-in rider on any /api/hub/* path, and a signed-in host
    // on any rider endpoint, always get 403 forbidden without any record lookup.
    if (caller && caller.role === "rider" && path.startsWith("/api/hub/")) {
      sendError(res, new ApiError(403, "forbidden"));
      return true;
    }
    if (caller && caller.role === "hub_host" && isRiderPath(path)) {
      sendError(res, new ApiError(403, "forbidden"));
      return true;
    }
    await routeMatch.handler(req, res, url, caller);
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
    } else {
      process.stderr.write(`api error on ${path}: ${err instanceof Error ? err.stack : String(err)}\n`);
      sendJson(res, 500, errorBody("database_unreachable"));
    }
  }
  return true;
}

function isRiderPath(path: string): boolean {
  return (
    (path.startsWith("/api/locks") && !path.startsWith("/api/locks/")) ||
    (path.startsWith("/api/locks/") && path.split("/").length > 3) ||
    path.startsWith("/api/rides") ||
    path.startsWith("/api/reminders") ||
    path.startsWith("/api/notices")
  );
}

export { sendJson };
