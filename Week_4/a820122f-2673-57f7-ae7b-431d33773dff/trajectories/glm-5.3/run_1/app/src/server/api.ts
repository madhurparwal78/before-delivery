import { Router, type Request, type Response } from "express";
import { query, type ClockChangeRow, type CrewRow, type OwnerRow, type VesselRow } from "./db.js";
import { hashPasscode, verifyPasscode } from "./passcode.js";
import { sendError, sendValidation } from "./errors.js";
import {
  SESSION_COOKIE, crewRecordFor, nowUtcString, personFromRequest, requireOwnerMaster, requirePerson,
  serverNow, todayShipDate, vesselOwner,
} from "./auth.js";
import { ShipTimeline } from "./timeline.js";
import { buildStrip, buildWindow } from "./strip.js";
import { judgeWindow } from "./rest-rules.js";
import { recordBreaches, stillBreaching as stillBreachingOf } from "./breaches.js";
import { archiveStatus, monthReadiness, readObject, sealMonth, writeInspectionDocument } from "./archive.js";
import { isValidShipDate, parseHhMm, parseOffset, fromUtcString, isAlignedString, toShipTimeString, toUtcString, floorHalfHour, ceilHalfHour, HALF_HOUR_MS, HOUR_MS } from "../shared/time.js";

export const api = Router();

interface Body { [key: string]: unknown }

function str(body: Body, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function requireFields(res: Response, body: Body, fields: { name: string; message: string }[]): Record<string, string> | null {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = str(body, field.name);
    if (value === undefined || value.length === 0) errors[field.name] = field.message;
  }
  if (Object.keys(errors).length > 0) {
    sendValidation(res, errors);
    return null;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Sign-in and identity

api.post("/owners", async (req: Request, res: Response) => {
  const name = str(req.body as Body, "name");
  const email = str(req.body as Body, "email")?.toLowerCase().trim();
  const passcode = str(req.body as Body, "passcode");
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Write your name.";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "Write an email address.";
  if (!passcode || passcode.length < 8) errors.passcode = "The passcode needs at least 8 characters.";
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const taken = await query<OwnerRow>(`SELECT id FROM owners WHERE email = $1`, [email!]);
  if (taken.length > 0) return sendError(res, 409, "email_taken", "That email already has an account.");
  const id = `owner-${crypto.randomUUID()}`;
  await query(`INSERT INTO owners (id, name, email, passcode_hash) VALUES ($1,$2,$3,$4)`,
    [id, name!, email!, hashPasscode(passcode!)]);
  await startSession(res, id, "owner_master");
  res.status(201).json({ id, name: name!, email: email!, role: "owner_master" });
});

async function startSession(res: Response, personId: string, role: "owner_master" | "crew"): Promise<void> {
  const id = crypto.randomUUID() + crypto.randomUUID();
  const expires = new Date(serverNow() + 30 * 24 * HOUR_MS);
  await query(`INSERT INTO sessions (id, person_id, role, expires_at) VALUES ($1,$2,$3,$4)`, [id, personId, role, expires]);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}`);
}

api.post("/session", async (req: Request, res: Response) => {
  const body = req.body as Body;
  const email = str(body, "email")?.toLowerCase().trim();
  const passcode = str(body, "passcode");
  const errors: Record<string, string> = {};
  if (!email) errors.email = "Write your email.";
  if (!passcode) errors.passcode = "Write your passcode.";
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const owner = await query<OwnerRow>(`SELECT * FROM owners WHERE email = $1`, [email!]);
  if (owner[0] && verifyPasscode(passcode!, owner[0].passcode_hash)) {
    await startSession(res, owner[0].id, "owner_master");
    return res.json({ id: owner[0].id, name: owner[0].name, role: "owner_master", vessel_id: null });
  }
  const crew = await query<CrewRow>(`SELECT * FROM crew WHERE email = $1`, [email!]);
  if (crew[0] && verifyPasscode(passcode!, crew[0].passcode_hash)) {
    await startSession(res, crew[0].id, "crew");
    return res.json({ id: crew[0].id, name: crew[0].name, role: "crew", vessel_id: crew[0].vessel_id });
  }
  sendError(res, 401, "bad_credentials", "That email and passcode do not match.");
});

api.delete("/session", requirePerson, async (req: Request, res: Response) => {
  const token = req.headers.cookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (token) await query(`DELETE FROM sessions WHERE id = $1`, [decodeURIComponent(token)]);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.status(204).end();
});

api.get("/me", requirePerson, async (req: Request, res: Response) => {
  const person = req.person!;
  let todayShipDateValue: string | null = null;
  if (person.role === "crew" && person.vesselId) {
    const record = await crewRecordFor(person.id);
    if (record) todayShipDateValue = todayShipDate(record);
  }
  res.json({
    id: person.id,
    name: person.name,
    role: person.role,
    vessel_id: person.vesselId,
    server_now_utc: nowUtcString(),
    today_ship_date: todayShipDateValue,
  });
});

// ---------------------------------------------------------------------------
// Vessels and crew

api.get("/vessels", requirePerson, async (req: Request, res: Response) => {
  if (req.person!.role !== "owner_master") return sendError(res, 403, "forbidden", "Only the owner-master can do that.");
  const vessels = await query<VesselRow>(`SELECT id, name, kind, initial_offset_minutes FROM vessels WHERE owner_id = $1 ORDER BY name`, [req.person!.id]);
  const now = serverNow();
  const vesselsWithOffsets = await Promise.all(vessels.map(async (v) => {
    const changes = await query<{ changes_at_utc: string; new_offset_minutes: number }>(
      `SELECT changes_at_utc, new_offset_minutes FROM clock_changes WHERE vessel_id = $1 ORDER BY changes_at_utc`, [v.id]);
    const timeline = new ShipTimeline(v.initial_offset_minutes, changes.map((c) => ({
      id: "", vessel_id: v.id, changes_at_utc: c.changes_at_utc, old_offset_minutes: 0, new_offset_minutes: c.new_offset_minutes, fix_id: null,
    })));
    return { id: v.id, name: v.name, kind: v.kind, current_offset_minutes: timeline.offsetAt(now) };
  }));
  res.json({ vessels: vesselsWithOffsets });
});

api.post("/vessels", requireOwnerMaster, async (req: Request, res: Response) => {
  const body = req.body as Body;
  const name = str(body, "name");
  const kind = str(body, "kind");
  const offset = parseOffset(body["initial_offset_minutes"]);
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Write a vessel name.";
  if (!["workboat", "survey_boat", "coaster", "charter_yacht"].includes(kind ?? "")) errors.kind = "Pick a vessel type.";
  if (offset === null || offset % 30 !== 0 || offset < -720 || offset > 840) errors.initial_offset_minutes = "The offset must be whole half hours from -720 to 840.";
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const count = await query<{ n: string }>(`SELECT count(*)::text AS n FROM vessels WHERE owner_id = $1`, [req.person!.id]);
  if (Number(count[0]?.n ?? 0) >= 4) return sendError(res, 409, "vessel_limit", "You already run four vessels.");
  const id = `vessel-${crypto.randomUUID()}`;
  await query(`INSERT INTO vessels (id, owner_id, name, kind, initial_offset_minutes) VALUES ($1,$2,$3,$4,$5)`,
    [id, req.person!.id, name!, kind as string, offset!]);
  res.status(201).json({ id, name: name!, kind, current_offset_minutes: offset! });
});

api.get("/vessels/:vesselId/crew", requirePerson, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const crew = await query<CrewRow>(`SELECT id, name, rank, email FROM crew WHERE vessel_id = $1 ORDER BY name`, [req.params.vesselId]);
  res.json({ crew: crew.map((c) => ({ id: c.id, name: c.name, rank: c.rank, email: c.email })) });
});

api.post("/vessels/:vesselId/crew", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const body = req.body as Body;
  const name = str(body, "name");
  const rank = str(body, "rank");
  const email = str(body, "email")?.toLowerCase().trim();
  const passcode = str(body, "passcode");
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Write a name.";
  if (!rank) errors.rank = "Write a rank.";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = "Write an email address.";
  if (!passcode || passcode.length < 8) errors.passcode = "The passcode needs at least 8 characters.";
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const taken = await query<{ id: string }>(`SELECT id FROM crew WHERE email = $1 UNION ALL SELECT id FROM owners WHERE email = $1`, [email!]);
  if (taken.length > 0) return sendError(res, 409, "email_taken", "That email already has an account.");
  const id = `crew-${crypto.randomUUID()}`;
  await query(`INSERT INTO crew (id, vessel_id, name, rank, email, passcode_hash) VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, req.params.vesselId, name!, rank!, email!, hashPasscode(passcode!)]);
  res.status(201).json({ id, name: name!, rank: rank!, email: email! });
});

export { requireFields };

// ---------------------------------------------------------------------------
// Clock changes and fixes

api.get("/vessels/:vesselId/clock-changes", requirePerson, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  if (owner !== req.person!.id && req.person!.vesselId !== req.params.vesselId) {
    return sendError(res, 403, "forbidden", "Only the owner-master can do that.");
  }
  const rows = await query<{
    id: string; changes_at_utc: string; old_offset_minutes: number; new_offset_minutes: number; fix_id: string | null;
  }>(`SELECT id, changes_at_utc, old_offset_minutes, new_offset_minutes, fix_id FROM clock_changes
      WHERE vessel_id = $1 ORDER BY changes_at_utc`, [req.params.vesselId]);
  res.json({ clock_changes: rows });
});

api.post("/vessels/:vesselId/clock-changes", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const body = req.body as Body;
  const changesAt = str(body, "changes_at_utc");
  const newOffset = parseOffset(body["new_offset_minutes"]);
  const latitude = typeof body["latitude"] === "number" ? body["latitude"] : Number(str(body, "latitude"));
  const longitude = typeof body["longitude"] === "number" ? body["longitude"] : Number(str(body, "longitude"));
  const errors: Record<string, string> = {};
  const changeMs = changesAt ? fromUtcString(changesAt) : null;
  if (changeMs === null || !isAlignedString(changesAt ?? "")) {
    errors.changes_at_utc = "Write the change time in UTC on a half hour.";
  }
  if (newOffset === null || newOffset % 30 !== 0 || newOffset < -720 || newOffset > 840) {
    errors.new_offset_minutes = "The offset must be whole half hours from -720 to 840.";
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.latitude = "Write the latitude in decimal degrees.";
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.longitude = "Write the longitude in decimal degrees.";

  const vessel = await query<VesselRow>(`SELECT * FROM vessels WHERE id = $1`, [req.params.vesselId]);
  const existingChanges = await query<ClockChangeRow>(
    `SELECT id, vessel_id, changes_at_utc, old_offset_minutes, new_offset_minutes, fix_id FROM clock_changes WHERE vessel_id = $1 ORDER BY changes_at_utc`,
    [req.params.vesselId]);
  const timeline = new ShipTimeline(vessel[0]?.initial_offset_minutes ?? 0, existingChanges);
  if (changeMs !== null && newOffset !== null) {
    const oldOffset = timeline.offsetAt(changeMs);
    if (oldOffset === newOffset) errors.new_offset_minutes = "The new offset must differ from the old one.";
    if (existingChanges.length > 0 && changeMs <= fromUtcString(existingChanges[existingChanges.length - 1]!.changes_at_utc)!) {
      errors.changes_at_utc = "Pick a time after the latest clock change.";
    }
    const shipDate = timeline.shipDateOf(changeMs);
    const sameDay = existingChanges.some((c) => timeline.shipDateOf(fromUtcString(c.changes_at_utc)!) === shipDate);
    if (sameDay) errors.changes_at_utc = "Pick a ship's date with no other clock change.";
    // The clock's reading just before and just after the change must share a ship's date.
    const beforeDate = timeline.shipDateOf(changeMs - 1);
    const afterDate = toShipDateString(changeMs + newOffset * 60_000);
    if (beforeDate !== afterDate) errors.changes_at_utc = "Pick a time that keeps the clock change inside one ship's day.";
  }
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);

  // A clock change in a sealed month for any crew member of the vessel is refused.
  const sealedMonths = await query<{ crew_id: string; month: string }>(
    `SELECT m.crew_id, m.month FROM months m JOIN crew c ON c.id = m.crew_id WHERE c.vessel_id = $1 AND m.state = 'sealed'`,
    [req.params.vesselId]);
  const changeShipDate = timeline.shipDateOf(changeMs!);
  const changeMonth = changeShipDate.slice(0, 7);
  if (sealedMonths.some((m) => m.month === changeMonth)) {
    return sendError(res, 409, "month_sealed", "That month is sealed, so its clock cannot change.");
  }

  const oldOffset = timeline.offsetAt(changeMs!);
  const kind = newOffset! < oldOffset ? "retard" : "advance";
  const fixId = `fix-${crypto.randomUUID()}`;
  await query(`INSERT INTO fixes (id, vessel_id, at_utc, latitude, longitude) VALUES ($1,$2,$3,$4,$5)`,
    [fixId, req.params.vesselId, changesAt!, latitude as number, longitude as number]);
  const id = `change-${crypto.randomUUID()}`;
  await query(`INSERT INTO clock_changes (id, vessel_id, changes_at_utc, old_offset_minutes, new_offset_minutes, fix_id)
    VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, req.params.vesselId, changesAt!, oldOffset, newOffset!, fixId]);
  const shipDate = timeline.shipDateOf(changeMs!);
  const nauticalZone = nauticalZoneOf(longitude as number);
  const updatedTimeline = new ShipTimeline(vessel[0]!.initial_offset_minutes, [
    ...existingChanges,
    { id, vessel_id: req.params.vesselId, changes_at_utc: changesAt!, old_offset_minutes: oldOffset, new_offset_minutes: newOffset!, fix_id: fixId },
  ]);
  res.status(201).json({
    id,
    changes_at_utc: changesAt!,
    old_offset_minutes: oldOffset,
    new_offset_minutes: newOffset!,
    kind,
    label: kind === "retard" ? `+${Math.abs(oldOffset - newOffset!) / 60} h` : `-${Math.abs(oldOffset - newOffset!) / 60} h`,
    ship_date: shipDate,
    ship_date_cells: updatedTimeline.cellCountOf(shipDate),
    fix_id: fixId,
    nautical_zone: nauticalZone,
    zone_warning: Math.abs(newOffset! / 60 - nauticalZone) > 1,
  });
});

function toShipDateString(ms: number): string {
  return toUtcString(ms).slice(0, 10);
}

function nauticalZoneOf(longitude: number): number {
  const zone = longitude / 15;
  return zone >= 0 ? Math.round(zone) : -Math.round(-zone);
}

api.get("/vessels/:vesselId/fixes", requirePerson, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  if (owner !== req.person!.id && req.person!.vesselId !== req.params.vesselId) {
    return sendError(res, 403, "forbidden", "Only the owner-master can do that.");
  }
  const rows = await query<{ id: string; at_utc: string; latitude: number; longitude: number }>(
    `SELECT id, at_utc, latitude, longitude FROM fixes WHERE vessel_id = $1 ORDER BY at_utc`, [req.params.vesselId]);
  res.json({ fixes: rows });
});

api.post("/vessels/:vesselId/fixes", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const body = req.body as Body;
  const at = str(body, "at_utc");
  const latitude = typeof body["latitude"] === "number" ? body["latitude"] : Number(str(body, "latitude"));
  const longitude = typeof body["longitude"] === "number" ? body["longitude"] : Number(str(body, "longitude"));
  const errors: Record<string, string> = {};
  if (at === undefined || fromUtcString(at) === null) errors.at_utc = "Write the fix time in UTC.";
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.latitude = "Write the latitude in decimal degrees.";
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.longitude = "Write the longitude in decimal degrees.";
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const repeated = await query<{ id: string }>(`SELECT id FROM fixes WHERE vessel_id = $1 AND at_utc = $2`,
    [req.params.vesselId, at!]);
  if (repeated.length > 0) return sendValidation(res, { at_utc: "A fix already exists at that instant." });
  const id = `fix-${crypto.randomUUID()}`;
  await query(`INSERT INTO fixes (id, vessel_id, at_utc, latitude, longitude) VALUES ($1,$2,$3,$4,$5)`,
    [id, req.params.vesselId, at!, latitude as number, longitude as number]);
  res.status(201).json({ id, at_utc: at!, latitude: latitude as number, longitude: longitude as number });
});

// ---------------------------------------------------------------------------
// Rota and rule sets

api.post("/vessels/:vesselId/rota-watches", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const body = req.body as Body;
  const crewId = str(body, "crew_id");
  const label = str(body, "label");
  const startTime = str(body, "start_time");
  const endTime = str(body, "end_time");
  const fromDate = str(body, "from_date");
  const toDate = str(body, "to_date");
  const errors: Record<string, string> = {};
  if (!crewId) errors.crew_id = "Pick a crew member.";
  const startMinutes = startTime ? parseHhMm(startTime) : null;
  const endMinutes = endTime ? parseHhMm(endTime) : null;
  if (startMinutes === null) errors.start_time = "Write the start time as HH:MM on the half hour.";
  if (endMinutes === null) errors.end_time = "Write the end time as HH:MM on the half hour.";
  if (!fromDate || !isValidShipDate(fromDate)) errors.from_date = "Write the first ship's date as YYYY-MM-DD.";
  if (!toDate || !isValidShipDate(toDate)) errors.to_date = "Write the last ship's date as YYYY-MM-DD.";
  if (fromDate && toDate && isValidShipDate(fromDate) && isValidShipDate(toDate) && fromDate > toDate) {
    errors.to_date = "The last ship's date must not be before the first.";
  }
  if (crewId) {
    const crew = await query<{ vessel_id: string }>(`SELECT vessel_id FROM crew WHERE id = $1`, [crewId]);
    if (!crew[0] || crew[0].vessel_id !== req.params.vesselId) errors.crew_id = "Pick a crew member of this vessel.";
  }
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const id = `rota-${crypto.randomUUID()}`;
  await query(`INSERT INTO rota_watches (id, vessel_id, crew_id, label, start_time, end_time, from_date, to_date)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, req.params.vesselId, crewId!, label!, startTime!, endTime!, fromDate!, toDate!]);
  res.status(201).json({
    id, crew_id: crewId!, label: label!, start_time: startTime!, end_time: endTime!, from_date: fromDate!, to_date: toDate!,
  });
});

api.get("/vessels/:vesselId/rota-watches", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const rows = await query<{ id: string; crew_id: string; label: string; start_time: string; end_time: string; from_date: string; to_date: string }>(
    `SELECT id, crew_id, label, start_time, end_time, from_date, to_date FROM rota_watches WHERE vessel_id = $1 ORDER BY from_date, start_time`,
    [req.params.vesselId]);
  res.json(rows);
});

api.get("/vessels/:vesselId/rota", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const crewId = typeof req.query.crew_id === "string" ? req.query.crew_id : "";
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const errors: Record<string, string> = {};
  if (!crewId) errors.crew_id = "Pick a crew member.";
  if (!isValidShipDate(from)) errors.from = "Write the first ship's date as YYYY-MM-DD.";
  if (!isValidShipDate(to)) errors.to = "Write the last ship's date as YYYY-MM-DD.";
  if (isValidShipDate(from) && isValidShipDate(to)) {
    const days = (fromUtcString(`${to}T00:00:00Z`)! - fromUtcString(`${from}T00:00:00Z`)!) / (24 * HOUR_MS) + 1;
    if (days > 28) errors.to = "The plan may cover at most 28 ship's dates.";
    if (from > to) errors.from = "The plan's dates must run forwards.";
  }
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);

  const result = await buildRota(req.params.vesselId, crewId, from, to);
  if (result === null) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  res.json(result);
});

async function buildRota(vesselId: string, crewId: string, fromDate: string, toDate: string): Promise<unknown> {
  const vessel = await query<VesselRow>(`SELECT * FROM vessels WHERE id = $1`, [vesselId]);
  if (!vessel[0]) return null;
  const crew = await query<{ id: string; name: string }>(`SELECT id, name FROM crew WHERE id = $1 AND vessel_id = $2`, [crewId, vesselId]);
  if (!crew[0]) return null;
  const changes = await query<{ id: string; vessel_id: string; changes_at_utc: string; old_offset_minutes: number; new_offset_minutes: number; fix_id: string | null }>(
    `SELECT id, vessel_id, changes_at_utc, old_offset_minutes, new_offset_minutes, fix_id FROM clock_changes WHERE vessel_id = $1 ORDER BY changes_at_utc`,
    [vesselId]);
  const timeline = new ShipTimeline(vessel[0].initial_offset_minutes, changes);
  const watches = await query<{ label: string; start_time: string; end_time: string; from_date: string; to_date: string }>(
    `SELECT label, start_time, end_time, from_date, to_date FROM rota_watches WHERE crew_id = $1 AND from_date <= $3 AND to_date >= $2
     ORDER BY from_date, start_time`,
    [crewId, fromDate, toDate]);
  const ruleSets = await query<{ effective_from_utc: string; effective_until_utc: string }>(
    `SELECT effective_from_utc, effective_until_utc FROM rule_sets WHERE vessel_id = $1 ORDER BY effective_from_utc`, [vesselId]);

  const days: unknown[] = [];
  let cursor = fromDate;
  const watchIntervals: { start: number; end: number }[] = [];
  while (cursor <= toDate) {
    const dayStart = timeline.dayStartUtc(cursor);
    const nextDay = timeline.dayStartUtc(addShipDay(cursor));
    const dayWatches: { startMs: number; endMs: number; label: string }[] = [];
    for (const watch of watches) {
      const wStart = parseHhMm(watch.start_time)!;
      const wEnd = parseHhMm(watch.end_time)!;
      const crossesMidnight = wEnd <= wStart;
      // A start time that a retard makes occur twice takes the first occurrence.
      const startMs = firstOccurrence(timeline, cursor, wStart, crossesMidnight);
      // An end time that a retard makes occur twice takes the last occurrence.
      const endMs = lastOccurrence(timeline, cursor, wEnd, crossesMidnight);
      if (startMs === null || endMs === null) continue;
      const watchInfo = { startMs, endMs, label: watch.label };
      if (dayTouches(dayStart, nextDay, startMs, endMs)) {
        dayWatches.push(watchInfo);
        watchIntervals.push({ start: startMs, end: endMs });
      }
    }
    // Elapsed hours the watches take in this day, with overlaps counted once.
    const unionHours = unionHoursOf(dayWatches.map((w) => [w.startMs, w.endMs] as [number, number]), dayStart, nextDay);
    const dayHours = (nextDay - dayStart) / HOUR_MS;
    const dayWatchesOut = dayWatches
      .filter((w) => w.startMs < nextDay && w.endMs > dayStart)
      .map((w) => {
        const startShip = toShipTimeString(Math.max(w.startMs, dayStart), timeline.offsetAt(Math.max(w.startMs, dayStart)));
        const endShip = toShipTimeString(Math.min(w.endMs, nextDay), timeline.offsetJustBefore(Math.min(w.endMs, nextDay)));
        return {
          label: w.label,
          start_ship_time: startShip.slice(11),
          end_ship_time: endShip.slice(11),
          start_utc: toUtcString(w.startMs),
          end_utc: toUtcString(w.endMs),
          elapsed_hours: (w.endMs - w.startMs) / HOUR_MS,
        };
      });
    days.push({
      ship_date: cursor,
      cell_count: Math.round((nextDay - dayStart) / HALF_HOUR_MS),
      day_hours: dayHours,
      watches: dayWatchesOut,
      planned_rest_hours: dayHours - unionHours,
    });
    cursor = addShipDay(cursor);
  }

  // Plan: everything outside watches is rest; every window wholly inside the
  // range is judged under the rule set in force at the window's end.
  const rangeStart = timeline.dayStartUtc(fromDate);
  const rangeEnd = timeline.dayStartUtc(addShipDay(toDate));
  const breaches: { rule: string; window_hours: number; window_start_utc: string; window_end_utc: string }[] = [];
  for (const width of [24, 168] as const) {
    const stepMax = Math.floor((rangeEnd - rangeStart) / HALF_HOUR_MS) - width * 2;
    for (let step = 0; step <= stepMax; step++) {
      const windowStart = rangeStart + step * HALF_HOUR_MS;
      const windowEnd = windowStart + width * HOUR_MS;
      if (windowEnd > rangeEnd) continue;
      const ruleSet = ruleSetAtOf(ruleSets, windowEnd);
      const cells = plannedCells(watchIntervals, windowStart, windowEnd, rangeStart, rangeEnd);
      const failed = judgePlannedWindow(cells, windowStart, windowEnd, width, ruleSet);
      for (const rule of failed) breaches.push({ rule, window_hours: width, window_start_utc: toUtcString(windowStart), window_end_utc: toUtcString(windowEnd) });
    }
  }
  return {
    days,
    plan: { verdict: breaches.length > 0 ? "breach" : "pass", breaches },
  };
}

function ruleSetAtOf(ruleSets: { effective_from_utc: string; effective_until_utc: string }[], ms: number): "standard" | "flag_exception" {
  for (const period of ruleSets) {
    if (ms >= fromUtcString(period.effective_from_utc)! && ms < fromUtcString(period.effective_until_utc)!) return "flag_exception";
  }
  return "standard";
}

function judgePlannedWindow(
  cells: { startMs: number; state: "rest" | "work" }[],
  startMs: number,
  endMs: number,
  width: 24 | 168,
  ruleSet: "standard" | "flag_exception"
): string[] {
  const periods = restPeriodsOfPlanned(cells);
  const failed: string[] = [];
  const restHours = plannedRestHours(periods, startMs, endMs);
  if (width === 24) {
    if (restHours < 10) failed.push("rest_24h");
    const beginning = periods.filter((p) => !p.shortBreak && p.startMs >= startMs && p.startMs < endMs).length;
    if (beginning > (ruleSet === "standard" ? 2 : 3)) failed.push("rest_periods");
    const hasBlock = periods.some((p) => !p.shortBreak && p.endMs - p.startMs >= 6 * HOUR_MS && p.startMs < endMs && p.endMs > startMs);
    if (!hasBlock) failed.push("six_hour_block");
    if (longestWorkRun(periods, startMs, endMs) > 14) failed.push("fourteen_hour_gap");
  } else {
    if (restHours < (ruleSet === "standard" ? 77 : 70)) failed.push("rest_168h");
  }
  return failed;
}

function restPeriodsOfPlanned(cells: { startMs: number; state: "rest" | "work" }[]): { startMs: number; endMs: number; shortBreak: boolean }[] {
  const periods: { startMs: number; endMs: number; shortBreak: boolean }[] = [];
  let runStart: number | null = null;
  let runIsRest: boolean | null = null;
  for (const cell of cells) {
    const isRest = cell.state === "rest";
    if (runStart === null || runIsRest !== isRest) {
      if (runStart !== null && runIsRest === true) {
        periods.push({ startMs: runStart, endMs: cell.startMs, shortBreak: cell.startMs - runStart < HOUR_MS });
      }
      runStart = cell.startMs;
      runIsRest = isRest;
    }
  }
  if (runStart !== null && runIsRest === true && cells.length > 0) {
    const last = cells[cells.length - 1]!;
    periods.push({ startMs: runStart, endMs: last.startMs + HALF_HOUR_MS, shortBreak: last.startMs + HALF_HOUR_MS - runStart < HOUR_MS });
  }
  return periods;
}

function plannedRestHours(periods: { startMs: number; endMs: number; shortBreak: boolean }[], startMs: number, endMs: number): number {
  let total = 0;
  for (const p of periods) {
    if (p.shortBreak) continue;
    const from = Math.max(p.startMs, startMs);
    const to = Math.min(p.endMs, endMs);
    if (to > from) total += to - from;
  }
  return total / HOUR_MS;
}

function longestWorkRun(periods: { startMs: number; endMs: number; shortBreak: boolean }[], startMs: number, endMs: number): number {
  const clipped: { startMs: number; endMs: number }[] = [];
  for (const p of periods) {
    if (p.shortBreak) continue;
    const from = Math.max(p.startMs, startMs);
    const to = Math.min(p.endMs, endMs);
    if (to > from) clipped.push({ startMs: from, endMs: to });
  }
  clipped.sort((a, b) => a.startMs - b.startMs);
  let longest = 0;
  let cursor = startMs;
  for (const p of clipped) {
    if (p.startMs > cursor) longest = Math.max(longest, p.startMs - cursor);
    cursor = Math.max(cursor, p.endMs);
  }
  if (endMs > cursor) longest = Math.max(longest, endMs - cursor);
  return longest / HOUR_MS;
}

function plannedCells(
  watchIntervals: { start: number; end: number }[],
  startMs: number,
  endMs: number,
  rangeStart: number,
  rangeEnd: number
): { startMs: number; state: "rest" | "work" }[] {
  // Cells span the whole requested range; windows read only their own slice.
  const cells: { startMs: number; state: "rest" | "work" }[] = [];
  for (let t = rangeStart; t < rangeEnd; t += HALF_HOUR_MS) {
    const inWatch = watchIntervals.some((w) => w.start <= t && t < w.end);
    cells.push({ startMs: t, state: inWatch ? "work" : "rest" });
  }
  return cells;
}

function unionHoursOf(intervals: [number, number][], dayStart: number, dayEnd: number): number {
  const clipped = intervals
    .map(([s, e]) => [Math.max(s, dayStart), Math.min(e, dayEnd)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor: number | null = null;
  for (const [s, e] of clipped) {
    if (cursor === null || s > cursor) {
      total += e - s;
      cursor = e;
    } else if (e > cursor) {
      total += e - cursor;
      cursor = e;
    }
  }
  return total / HOUR_MS;
}

function dayTouches(dayStart: number, dayEnd: number, startMs: number, endMs: number): boolean {
  return startMs < dayEnd && endMs > dayStart;
}

/** The first instant of a ship's-time occurrence on a ship's date: a start
 *  time that a retard makes occur twice takes this. */
function firstOccurrence(timeline: ShipTimeline, shipDate: string, minutes: number, crossesMidnight: boolean): number | null {
  const date = crossesMidnight ? subShipDay(shipDate) : shipDate;
  const target = timeline.dayStartUtc(date) + minutes * 60_000;
  // A retard makes the target's clock time appear at an earlier UTC instant
  // than the plain reading; an advance never makes it appear earlier.
  for (let t = Math.max(target - 4 * HOUR_MS, timeline.dayStartUtc(date) - 2 * HOUR_MS); t <= target + HALF_HOUR_MS; t += HALF_HOUR_MS) {
    const clockTime = t + timeline.offsetAt(t) * 60_000;
    if (toShipDateString(clockTime) === date && utcMinutesOf(clockTime) === minutes) return t;
  }
  return null;
}

/** The instant of the last occurrence of a ship's-time on a ship's date: an
 *  end time that a retard makes occur twice takes this. A time an advance
 *  skips moves to the first instant after the jump. */
function lastOccurrence(timeline: ShipTimeline, shipDate: string, minutes: number, crossesMidnight: boolean): number | null {
  const date = shipDate;
  const target = timeline.dayStartUtc(date) + minutes * 60_000;
  let found: number | null = null;
  for (let t = Math.max(target - 4 * HOUR_MS, timeline.dayStartUtc(date) - 2 * HOUR_MS); t <= target + 4 * HOUR_MS; t += HALF_HOUR_MS) {
    const clockTime = t + timeline.offsetAt(t) * 60_000;
    if (toShipDateString(clockTime) === date && utcMinutesOf(clockTime) === minutes) found = t;
  }
  if (found !== null) return found;
  // Skipped by an advance: the first instant after the jump whose clock time
  // is still on the date and past the target minutes.
  for (let t = timeline.dayStartUtc(date); t < timeline.dayStartUtc(addShipDay(date)); t += HALF_HOUR_MS) {
    const clockTime = t + timeline.offsetAt(t) * 60_000;
    if (toShipDateString(clockTime) === date && utcMinutesOf(clockTime) > minutes) return t;
  }
  return null;
}

function utcMinutesOf(ms: number): number {
  const d = new Date(ms);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function addShipDay(shipDate: string): string {
  return toShipDateString(fromUtcString(`${shipDate}T00:00:00Z`)! + 24 * HOUR_MS);
}

function subShipDay(shipDate: string): string {
  return toShipDateString(fromUtcString(`${shipDate}T00:00:00Z`)! - 24 * HOUR_MS);
}

// ---------------------------------------------------------------------------
// Rule sets

api.get("/vessels/:vesselId/rule-sets", requirePerson, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  if (owner !== req.person!.id && req.person!.vesselId !== req.params.vesselId) {
    return sendError(res, 403, "forbidden", "Only the owner-master can do that.");
  }
  const rows = await query<{
    id: string; rule_set: string; effective_from_utc: string; effective_until_utc: string; flag_reference: string;
  }>(`SELECT id, rule_set, effective_from_utc, effective_until_utc, flag_reference FROM rule_sets WHERE vessel_id = $1 ORDER BY effective_from_utc`,
    [req.params.vesselId]);
  res.json({ rule_sets: rows });
});

api.post("/vessels/:vesselId/rule-sets", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const body = req.body as Body;
  const ruleSet = str(body, "rule_set");
  const from = str(body, "effective_from_utc");
  const until = str(body, "effective_until_utc");
  const flagReference = str(body, "flag_reference");
  const errors: Record<string, string> = {};
  if (ruleSet !== "flag_exception") errors.rule_set = "Only a flag exception period can be scheduled.";
  const fromMs = from ? fromUtcString(from) : null;
  const untilMs = until ? fromUtcString(until) : null;
  if (fromMs === null || !isAlignedString(from ?? "")) errors.effective_from_utc = "Pick a start time in UTC on a half hour.";
  if (untilMs === null || !isAlignedString(until ?? "")) errors.effective_until_utc = "Pick an end time in UTC on a half hour.";
  const now = serverNow();
  if (fromMs !== null && fromMs <= now) errors.effective_from_utc = "Pick a start time after now.";
  if (fromMs !== null && untilMs !== null) {
    if (untilMs <= fromMs) errors.effective_until_utc = "Pick an end time after the start.";
    if (untilMs - fromMs > 336 * HOUR_MS) errors.effective_until_utc = "A flag exception cannot run longer than two weeks.";
  }
  if (!flagReference || flagReference.length < 1 || flagReference.length > 200) {
    errors.flag_reference = "Write the flag authorisation in 1 to 200 characters.";
  }
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const overlap = await query<{ id: string }>(
    `SELECT id FROM rule_sets WHERE vessel_id = $1 AND effective_from_utc < $3 AND effective_until_utc > $2`,
    [req.params.vesselId, from!, until!]);
  if (overlap.length > 0) return sendError(res, 409, "rule_set_overlap", "Another rule set is already in force for those dates.");
  const id = `ruleset-${crypto.randomUUID()}`;
  await query(`INSERT INTO rule_sets (id, vessel_id, rule_set, effective_from_utc, effective_until_utc, flag_reference)
    VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, req.params.vesselId, "flag_exception", from!, until!, flagReference!]);
  res.status(201).json({
    id, rule_set: "flag_exception", effective_from_utc: from!, effective_until_utc: until!, flag_reference: flagReference!,
  });
});

// ---------------------------------------------------------------------------
// Watch entries

api.post("/watch-entries", async (req: Request, res: Response) => {
  const person = req.person!;
  if (!person) return sendError(res, 401, "not_signed_in", "You need to sign in first.");
  if (person.role !== "crew") return sendError(res, 403, "crew_only", "Only the crew member logs their own hours.");
  const outcome = await applyWatchEntry(person.id, req.body as Body, "direct");
  if (outcome.kind === "entry") return res.status(201).json({ entry: outcome.entry });
  if (outcome.kind === "conflict") return sendError(res, 409, "entry_key_conflict", "That entry key was used for different hours.");
  if (outcome.kind === "day_closed") return sendError(res, 409, "day_closed", "This ship's day has closed, so the server did not save that entry.");
  if (outcome.kind === "month_sealed") return sendError(res, 409, "month_sealed", "That month is sealed, so its hours cannot change.");
  return sendError(res, 409, "entry_invalid", "That entry is not valid.");
});

api.post("/watch-entries/sync", async (req: Request, res: Response) => {
  const person = req.person!;
  if (!person) return sendError(res, 401, "not_signed_in", "You need to sign in first.");
  if (person.role !== "crew") return sendError(res, 403, "crew_only", "Only the crew member logs their own hours.");
  const body = req.body as Body;
  const entries = body["entries"];
  if (!Array.isArray(entries)) return sendValidation(res, { entries: "Send the entries to sync." });
  if (entries.length > 500) return sendValidation(res, { entries: "At most 500 entries can sync at once." });
  const results: unknown[] = [];
  for (const entryBody of entries) {
    const outcome = await applyWatchEntry(person.id, entryBody as Body, "sync");
    results.push(syncResultOf(outcome));
  }
  res.json({ results });
});

interface EntryOutcome {
  kind: "entry" | "conflict" | "day_closed" | "month_sealed" | "rejected";
  entry?: WatchEntryOut;
  errors?: Record<string, string> | null;
}

interface WatchEntryOut {
  id: string;
  entry_key: string;
  start_utc: string;
  end_utc: string;
  kind: "rest" | "work";
  ship_date: string;
  late: boolean;
  applied: boolean;
  received_at_utc: string;
}

function syncResultOf(outcome: EntryOutcome): unknown {
  switch (outcome.kind) {
    case "entry": {
      const entry = outcome.entry!;
      return { entry_key: entry.entry_key, outcome: entry.late ? "late" : "applied", entry, errors: null };
    }
    case "conflict":
      return { entry_key: "", outcome: "conflict", entry: null, errors: null };
    case "rejected":
      return { entry_key: "", outcome: "rejected", entry: null, errors: outcome.errors };
    default:
      return { entry_key: "", outcome: "rejected", entry: null, errors: null };
  }
}

async function applyWatchEntry(crewId: string, body: Body, mode: "direct" | "sync"): Promise<EntryOutcome> {
  const entryKey = str(body, "entry_key");
  const startUtc = str(body, "start_utc");
  const endUtc = str(body, "end_utc");
  const kind = str(body, "kind");
  const errors: Record<string, string> = {};
  if (entryKey === undefined || entryKey.length < 1 || entryKey.length > 100) errors.entry_key = "The entry key needs 1 to 100 characters.";
  const startMs = startUtc ? fromUtcString(startUtc) : null;
  const endMs = endUtc ? fromUtcString(endUtc) : null;
  if (startMs === null || !isAlignedString(startUtc ?? "")) errors.start_utc = "Write the start in UTC on a half hour.";
  if (endMs === null || !isAlignedString(endUtc ?? "")) errors.end_utc = "Write the end in UTC on a half hour.";
  if (startMs !== null && endMs !== null && endMs <= startMs) errors.end_utc = "The end must be after the start.";
  if (kind !== "rest" && kind !== "work") errors.kind = "Mark the hours as rest or work.";
  const record = await crewRecordFor(crewId);
  if (!record) return { kind: "rejected", errors: { crew_id: "We couldn't find that crew member." } };
  if (startMs !== null && endMs !== null && errors["end_utc"] === undefined) {
    const now = serverNow();
    if (endMs > now + 48 * HOUR_MS) errors.end_utc = "The entry may end at most 48 hours after the server's time.";
    const shipDate = record.timeline.shipDateOf(startMs);
    if (record.timeline.shipDateOf(endMs - 1) !== shipDate) errors.end_utc = "The entry must lie inside one ship's day.";
  }
  if (Object.keys(errors).length > 0) return { kind: "rejected", errors };

  // Replay: a stored key with the same contents is applied once.
  const stored = await query<{ id: string; entry_key: string; start_utc: string; end_utc: string; kind: "rest" | "work"; ship_date: string; late: boolean; applied: boolean; received_at_utc: string }>(
    `SELECT id, entry_key, start_utc, end_utc, kind, ship_date, late, applied, received_at_utc FROM watch_entries WHERE crew_id = $1 AND entry_key = $2`,
    [crewId, entryKey!]);
  if (stored[0]) {
    const row = stored[0];
    if (row.start_utc === startUtc && row.end_utc === endUtc && row.kind === kind) {
      return { kind: "entry", entry: { ...row } };
    }
    return { kind: "conflict" };
  }

  const shipDate = record.timeline.shipDateOf(startMs!);
  const now = serverNow();
  const recorded = (await record.dayStates()).get(shipDate);
  const { state } = record.dayStateOf(shipDate, recorded, now);
  const month = shipDate.slice(0, 7);
  const monthRow = await query<{ state: "open" | "awaiting_archive" | "sealed" }>(
    `SELECT state FROM months WHERE crew_id = $1 AND month = $2`, [crewId, month]);

  if (mode === "direct") {
    if (monthRow[0]?.state === "sealed") return { kind: "month_sealed" };
    if (state !== "open") return { kind: "day_closed" };
  } else {
    // Synced entries are held on the phone; the day's state decides late handling.
    const late = state !== "open";
    const applied = state === "open" || (state === "closed" && monthRow[0]?.state !== "sealed");
    const entry = await storeWatchEntry(crewId, entryKey!, startUtc!, endUtc!, kind as "rest" | "work", shipDate, late, applied);
    return { kind: "entry", entry };
  }

  const entry = await storeWatchEntry(crewId, entryKey!, startUtc!, endUtc!, kind as "rest" | "work", shipDate, false, true);
  return { kind: "entry", entry };
}

async function storeWatchEntry(
  crewId: string, entryKey: string, startUtc: string, endUtc: string, kind: "rest" | "work",
  shipDate: string, late: boolean, applied: boolean
): Promise<WatchEntryOut> {
  const id = `entry-${crypto.randomUUID()}`;
  const receivedAt = nowUtcString();
  const orderRow = await query<{ next: string }>(`SELECT COALESCE(max(applied_order), 0) + 1 AS next FROM watch_entries WHERE crew_id = $1`, [crewId]);
  const order = Number(orderRow[0]?.next ?? 1);
  await query(
    `INSERT INTO watch_entries (id, crew_id, entry_key, start_utc, end_utc, kind, ship_date, late, applied, received_at_utc, applied_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, crewId, entryKey, startUtc, endUtc, kind, shipDate, late, applied, receivedAt, order]);
  // An applied write may make fully logged windows fail rules: record them.
  if (applied) {
    const record = await crewRecordFor(crewId);
    if (record) await recordBreaches(record, fromUtcString(startUtc)!, fromUtcString(endUtc)!);
  }
  return {
    id, entry_key: entryKey, start_utc: startUtc, end_utc: endUtc, kind,
    ship_date: shipDate, late, applied, received_at_utc: receivedAt,
  };
}

// ---------------------------------------------------------------------------
// Crew records

/** Crew-record access: the owner-master of the vessel, or that crew member. */
async function canReadCrew(req: Request, res: Response, crewId: string): Promise<boolean> {
  const person = req.person!;
  const crew = await query<{ vessel_id: string }>(`SELECT vessel_id FROM crew WHERE id = $1`, [crewId]);
  if (!crew[0]) {
    res.status(404).json({ error: "not_found", message: "We couldn't find that crew member." });
    return false;
  }
  if (person.role === "owner_master") {
    const owner = await vesselOwner(crew[0].vessel_id);
    if (owner !== person.id) {
      res.status(404).json({ error: "not_found", message: "We couldn't find that crew member." });
      return false;
    }
    return true;
  }
  if (person.id !== crewId) {
    res.status(403).json({ error: "forbidden", message: "Only that crew member and the owner-master can read this record." });
    return false;
  }
  return true;
}

api.get("/crew/:crewId/days", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const record = await crewRecordFor(req.params.crewId);
  if (!record) return sendError(res, 404, "not_found", "We couldn't find that crew member.");
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  if (!isValidShipDate(from) || !isValidShipDate(to) || from > to) {
    return sendValidation(res, { from: "Write the ship's dates as YYYY-MM-DD." });
  }
  const daysSpan = (fromUtcString(`${to}T00:00:00Z`)! - fromUtcString(`${from}T00:00:00Z`)!) / (24 * HOUR_MS) + 1;
  if (daysSpan > 62) return sendValidation(res, { to: "The range may cover at most 62 ship's dates." });
  const recorded = await record.dayStates();
  const days: unknown[] = [];
  let cursor = from;
  while (cursor <= to) {
    const { state, closesAtMs, canEdit } = record.dayStateOf(cursor, recorded.get(cursor), serverNow());
    days.push({ ship_date: cursor, state, closes_at_utc: toUtcString(closesAtMs), can_edit: canEdit });
    cursor = addShipDay(cursor);
  }
  res.json({ server_now_utc: nowUtcString(), days });
});

api.get("/crew/:crewId/days/:shipDate", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  if (!isValidShipDate(req.params.shipDate)) {
    return sendValidation(res, { ship_date: "Write the ship's date as YYYY-MM-DD." });
  }
  const record = await crewRecordFor(req.params.crewId);
  if (!record) return sendError(res, 404, "not_found", "We couldn't find that crew member.");
  res.json(await record.dayView(req.params.shipDate));
});

api.get("/crew/:crewId/rolling", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const record = await crewRecordFor(req.params.crewId);
  if (!record) return sendError(res, 404, "not_found", "We couldn't find that crew member.");
  let asOf: number;
  if (typeof req.query.as_of === "string") {
    const parsed = fromUtcString(req.query.as_of);
    if (parsed === null || !isAlignedString(req.query.as_of)) {
      return sendValidation(res, { as_of: "Write the instant in UTC on a half hour." });
    }
    asOf = parsed;
  } else {
    asOf = floorHalfHour(serverNow());
  }
  const rolling = await record.rolling(asOf);
  res.json({
    as_of_utc: toUtcString(asOf),
    rest_hours_24: rolling.restHours24,
    rest_hours_168: rolling.restHours168,
    verdict_24: rolling.verdict24,
    verdict_168: rolling.verdict168,
  });
});

api.get("/crew/:crewId/strip", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const record = await crewRecordFor(req.params.crewId);
  if (!record) return sendError(res, 404, "not_found", "We couldn't find that crew member.");
  let startMs: number;
  if (typeof req.query.start === "string" && req.query.start.length > 0) {
    const parsed = fromUtcString(req.query.start);
    if (parsed === null || !isAlignedString(req.query.start)) {
      return sendValidation(res, { start: "Write the start in UTC on a half hour." });
    }
    startMs = parsed;
  } else {
    const latest = await record.latestLoggedCellEnd();
    startMs = (latest ?? ceilHalfHour(serverNow())) - 336 * HOUR_MS;
  }
  const strip = await buildStrip(record, startMs);
  const changes = await query<ClockChangeRow>(
    `SELECT id, vessel_id, changes_at_utc, old_offset_minutes, new_offset_minutes, fix_id FROM clock_changes
     WHERE vessel_id = $1 AND changes_at_utc >= $2 AND changes_at_utc < $3 ORDER BY changes_at_utc`,
    [record.vesselId, strip.start_utc, strip.end_utc]);
  const fixes = await query<{ id: string; at_utc: string; latitude: number; longitude: number }>(
    `SELECT id, at_utc, latitude, longitude FROM fixes WHERE vessel_id = $1 AND at_utc >= $2 AND at_utc <= $3 ORDER BY at_utc`,
    [record.vesselId, strip.start_utc, strip.end_utc]);
  strip.clock_changes = changes.map((c) => ({
    id: c.id, changes_at_utc: c.changes_at_utc,
    old_offset_minutes: c.old_offset_minutes, new_offset_minutes: c.new_offset_minutes,
    kind: c.new_offset_minutes < c.old_offset_minutes ? "retard" : "advance",
    label: c.new_offset_minutes < c.old_offset_minutes
      ? `+${Math.abs(c.old_offset_minutes - c.new_offset_minutes) / 60} h`
      : `-${Math.abs(c.old_offset_minutes - c.new_offset_minutes) / 60} h`,
  }));
  strip.fixes = fixes;
  res.json(strip);
});

api.get("/crew/:crewId/window", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const record = await crewRecordFor(req.params.crewId);
  if (!record) return sendError(res, 404, "not_found", "We couldn't find that crew member.");
  const start = typeof req.query.start === "string" ? req.query.start : "";
  const hours = typeof req.query.hours === "string" ? req.query.hours : "";
  const startMs = fromUtcString(start);
  if (startMs === null || !isAlignedString(start)) {
    return sendValidation(res, { start: "Write the start in UTC on a half hour." });
  }
  if (hours !== "24" && hours !== "168") {
    return sendValidation(res, { hours: "The window width is 24 or 168 hours." });
  }
  res.json(await buildWindow(record, startMs, hours === "24" ? 24 : 168));
});

api.get("/crew/:crewId/breaches", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const rows = await query<{
    id: string; rule: string; window_hours: number; window_start_utc: string; window_end_utc: string;
    rule_set: string; rest_hours: number; recorded_at_utc: string;
  }>(
    `SELECT id, rule, window_hours, window_start_utc, window_end_utc, rule_set, rest_hours, recorded_at_utc
     FROM breaches WHERE crew_id = $1 ORDER BY window_start_utc, rule`, [req.params.crewId]);
  const filtered = rows.filter((r) => {
    if (from && r.window_start_utc < from) return false;
    if (to && r.window_start_utc > to) return false;
    return true;
  });
  const record = await crewRecordFor(req.params.crewId);
  const stillBreaching = new Map<string, boolean>();
  if (record) {
    for (const row of filtered) {
      stillBreaching.set(row.id, await stillBreachingOf(record, row.rule, row.window_hours, row.window_start_utc));
    }
  }
  res.json({
    breaches: filtered.map((r) => ({
      id: r.id, rule: r.rule, window_hours: r.window_hours, window_start_utc: r.window_start_utc,
      window_end_utc: r.window_end_utc, rule_set: r.rule_set, rest_hours: r.rest_hours,
      recorded_at_utc: r.recorded_at_utc, still_breaching: stillBreaching.get(r.id) ?? false,
    })),
  });
});

api.all("/crew/:crewId/breaches", requirePerson, (req: Request, res: Response) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendError(res, 405, "breach_permanent", "A recorded breach can never be changed or removed.");
  }
});
api.all("/crew/:crewId/breaches/:id", requirePerson, (req: Request, res: Response) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendError(res, 405, "breach_permanent", "A recorded breach can never be changed or removed.");
  }
});

api.post("/crew/:crewId/days/:shipDate/notes", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const shipDate = req.params.shipDate;
  if (!isValidShipDate(shipDate)) return sendValidation(res, { ship_date: "Write the ship's date as YYYY-MM-DD." });
  const person = req.person!;
  const body = req.body as Body;
  const text = str(body, "text");
  const eventId = str(body, "event_id");
  const errors: Record<string, string> = {};
  if (!text || text.length < 1 || text.length > 2000) errors.text = "Write the note in 1 to 2000 characters.";
  if (eventId) {
    const event = await query<{ crew_id: string; start_utc: string }>(`SELECT crew_id, start_utc FROM events WHERE id = $1`, [eventId]);
    const record = await crewRecordFor(req.params.crewId);
    if (!event[0] || event[0].crew_id !== req.params.crewId || !record) {
      errors.event_id = "That event is not on this crew member's record.";
    } else if (record.timeline.shipDateOf(fromUtcString(event[0].start_utc)!) !== shipDate) {
      errors.event_id = "That event is not on this ship's day.";
    }
  }
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const month = shipDate.slice(0, 7);
  const monthRow = await query<{ state: string }>(`SELECT state FROM months WHERE crew_id = $1 AND month = $2`, [req.params.crewId, month]);
  if (monthRow[0]?.state === "sealed") return sendError(res, 409, "month_sealed", "That month is sealed, so its notes cannot change.");
  const id = `note-${crypto.randomUUID()}`;
  const createdAt = nowUtcString();
  await query(`INSERT INTO notes (id, crew_id, ship_date, text, event_id, author_role, created_at_utc) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, req.params.crewId, shipDate, text!, eventId ?? null, person.role, createdAt]);
  res.status(201).json({
    id, ship_date: shipDate, text: text!, event_id: eventId ?? null, author_role: person.role, created_at_utc: createdAt,
  });
});

api.post("/crew/:crewId/days/sign", requirePerson, async (req: Request, res: Response) => {
  const person = req.person!;
  if (person.role !== "crew") return sendError(res, 403, "forbidden", "Only the crew member signs their own day.");
  if (person.id !== req.params.crewId) return sendError(res, 403, "forbidden", "Only the crew member signs their own day.");
  const shipDates = (req.body as Body)["ship_dates"];
  if (!Array.isArray(shipDates) || shipDates.some((d) => typeof d !== "string" || !isValidShipDate(d))) {
    return sendValidation(res, { ship_dates: "Send the ship's dates to sign." });
  }
  const record = await crewRecordFor(req.params.crewId);
  if (!record) return sendError(res, 404, "not_found", "We couldn't find that crew member.");
  const recorded = await record.dayStates();
  const now = serverNow();
  for (const shipDate of shipDates as string[]) {
    const month = shipDate.slice(0, 7);
    const monthRow = await query<{ state: string }>(`SELECT state FROM months WHERE crew_id = $1 AND month = $2`, [person.id, month]);
    if (monthRow[0]?.state === "sealed") {
      return sendError(res, 409, "already_signed", "That month is sealed.", { ship_date: shipDate });
    }
    const existing = recorded.get(shipDate);
    const { state } = record.dayStateOf(shipDate, existing, now);
    if (existing?.state === "signed" || existing?.state === "countersigned" || state === "signed" || state === "countersigned") {
      return sendError(res, 409, "already_signed", "This ship's day is already signed.", { ship_date: shipDate });
    }
    if (state === "open") {
      return sendError(res, 409, "day_not_closed", "This ship's day is still open, so it cannot be signed yet.", { ship_date: shipDate });
    }
  }
  const outDays: unknown[] = [];
  for (const shipDate of shipDates as string[]) {
    const existing = recorded.get(shipDate);
    if (existing?.state === "signed" || existing?.state === "countersigned") {
      outDays.push({ ship_date: shipDate, state: existing.state });
      continue;
    }
    await query(`INSERT INTO day_states (crew_id, ship_date, state, signed_at_utc, countersigned_at_utc)
      VALUES ($1,$2,'signed',$3,null) ON CONFLICT (crew_id, ship_date) DO UPDATE SET state = 'signed', signed_at_utc = $3`,
      [person.id, shipDate, nowUtcString()]);
    outDays.push({ ship_date: shipDate, state: "signed" });
  }
  res.json({ days: outDays });
});

api.post("/crew/:crewId/days/countersign", requirePerson, async (req: Request, res: Response) => {
  const person = req.person!;
  if (person.role !== "owner_master") return sendError(res, 403, "forbidden", "Only the owner-master countersigns.");
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const shipDates = (req.body as Body)["ship_dates"];
  if (!Array.isArray(shipDates) || shipDates.some((d) => typeof d !== "string" || !isValidShipDate(d))) {
    return sendValidation(res, { ship_dates: "Send the ship's dates to countersign." });
  }
  const record = await crewRecordFor(req.params.crewId);
  if (!record) return sendError(res, 404, "not_found", "We couldn't find that crew member.");
  const recorded = await record.dayStates();
  const now = serverNow();
  for (const shipDate of shipDates as string[]) {
    const month = shipDate.slice(0, 7);
    const monthRow = await query<{ state: string }>(`SELECT state FROM months WHERE crew_id = $1 AND month = $2`, [req.params.crewId, month]);
    if (monthRow[0]?.state === "sealed") {
      return sendError(res, 409, "already_countersigned", "That month is sealed.", { ship_date: shipDate });
    }
    const existing = recorded.get(shipDate);
    if (existing?.state === "countersigned") {
      return sendError(res, 409, "already_countersigned", "This ship's day is already countersigned.", { ship_date: shipDate });
    }
    if (existing?.state !== "signed") {
      return sendError(res, 409, "day_not_signed", "The crew member has not signed this day yet.", { ship_date: shipDate });
    }
  }
  const outDays: unknown[] = [];
  for (const shipDate of shipDates as string[]) {
    await query(`UPDATE day_states SET state = 'countersigned', countersigned_at_utc = $3 WHERE crew_id = $1 AND ship_date = $2`,
      [req.params.crewId, shipDate, nowUtcString()]);
    outDays.push({ ship_date: shipDate, state: "countersigned" });
  }
  res.json({ days: outDays });
});

api.get("/vessels/:vesselId/events", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const rows = await query<{ id: string; crew_id: string; kind: string; start_utc: string; end_utc: string; description: string }>(
    `SELECT id, crew_id, kind, start_utc, end_utc, description FROM events WHERE vessel_id = $1 ORDER BY start_utc`,
    [req.params.vesselId]);
  res.json({ events: rows });
});

api.post("/vessels/:vesselId/events", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const body = req.body as Body;
  const crewId = str(body, "crew_id");
  const kind = str(body, "kind");
  const startUtc = str(body, "start_utc");
  const endUtc = str(body, "end_utc");
  const description = str(body, "description");
  const errors: Record<string, string> = {};
  if (!crewId) errors.crew_id = "Pick a crew member.";
  if (kind !== "drill" && kind !== "call_out") errors.kind = "Pick a drill or a call-out.";
  const startMs = startUtc ? fromUtcString(startUtc) : null;
  const endMs = endUtc ? fromUtcString(endUtc) : null;
  if (startMs === null || !isAlignedString(startUtc ?? "")) errors.start_utc = "Write the start in UTC on a half hour.";
  if (endMs === null || !isAlignedString(endUtc ?? "")) errors.end_utc = "Write the end in UTC on a half hour.";
  if (startMs !== null && endMs !== null && endMs <= startMs) errors.end_utc = "The end must be after the start.";
  if (!description) errors.description = "Write what happened.";
  if (crewId) {
    const crew = await query<{ vessel_id: string }>(`SELECT vessel_id FROM crew WHERE id = $1`, [crewId]);
    if (!crew[0] || crew[0].vessel_id !== req.params.vesselId) errors.crew_id = "Pick a crew member of this vessel.";
  }
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const record = await crewRecordFor(crewId!);
  if (record) {
    const shipDate = record.timeline.shipDateOf(startMs!);
    const month = shipDate.slice(0, 7);
    const monthRow = await query<{ state: string }>(`SELECT state FROM months WHERE crew_id = $1 AND month = $2`, [crewId!, month]);
    if (monthRow[0]?.state === "sealed") return sendError(res, 409, "month_sealed", "That month is sealed, so its events cannot change.");
  }
  const id = `event-${crypto.randomUUID()}`;
  await query(`INSERT INTO events (id, vessel_id, crew_id, kind, start_utc, end_utc, description) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, req.params.vesselId, crewId!, kind as string, startUtc!, endUtc!, description!]);
  res.status(201).json({
    id, crew_id: crewId!, kind: kind as "drill" | "call_out", start_utc: startUtc!, end_utc: endUtc!, description: description!,
  });
});

// ---------------------------------------------------------------------------
// Months

api.get("/crew/:crewId/months/:month", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month) || !isValidMonthValue(month)) {
    return sendValidation(res, { month: "Write the month as YYYY-MM." });
  }
  const row = await monthRowOf(req.params.crewId, month);
  res.json(monthOut(row));
});

function isValidMonthValue(month: string): boolean {
  const [y, m] = month.split("-");
  return Number(y) >= 1 && Number(m) >= 1 && Number(m) <= 12;
}

async function monthRowOf(crewId: string, month: string): Promise<{ crew_id: string; month: string; state: "open" | "awaiting_archive" | "sealed"; label: string | null; record_key: string | null; record_sha256: string | null; copy_key: string | null; sealed_at_utc: string | null }> {
  const rows = await query<{ crew_id: string; month: string; state: "open" | "awaiting_archive" | "sealed"; label: string | null; record_key: string | null; record_sha256: string | null; copy_key: string | null; sealed_at_utc: string | null }>(
    `SELECT * FROM months WHERE crew_id = $1 AND month = $2`, [crewId, month]);
  return rows[0] ?? { crew_id: crewId, month, state: "open" as const, label: null, record_key: null, record_sha256: null, copy_key: null, sealed_at_utc: null };
}

function monthOut(row: { month: string; state: string; label: string | null; record_key: string | null; record_sha256: string | null; copy_key: string | null; sealed_at_utc: string | null }): unknown {
  return {
    month: row.month,
    state: row.state,
    label: row.label,
    record_key: row.record_key,
    record_sha256: row.record_sha256,
    copy_key: row.copy_key,
    sealed_at_utc: row.sealed_at_utc,
  };
}

api.post("/crew/:crewId/months/:month/seal", requireOwnerMaster, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const month = req.params.month;
  if (!/^\d{4}-\d{2}$/.test(month) || !isValidMonthValue(month)) {
    return sendValidation(res, { month: "Write the month as YYYY-MM." });
  }
  const row = await monthRowOf(req.params.crewId, month);
  if (row.state === "sealed") return res.status(200).json(monthOut(row));
  const readiness = await monthReadiness(req.params.crewId, month);
  if (!readiness.ready) {
    return sendError(res, 409, "month_not_ready", "Every logged day must be signed and countersigned first.",
      { blocking_dates: readiness.blockingDates });
  }
  if (row.state !== "awaiting_archive") {
    await query(`INSERT INTO months (crew_id, month, state) VALUES ($1,$2,'awaiting_archive')
      ON CONFLICT (crew_id, month) DO UPDATE SET state = 'awaiting_archive'`,
      [req.params.crewId, month]);
  }
  const outcome = await sealMonth(req.params.crewId, month);
  const updated = await monthRowOf(req.params.crewId, month);
  res.status(outcome.state === "sealed" ? 200 : 202).json(monthOut(updated));
});

api.get("/crew/:crewId/months/:month/record.pdf", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const row = await monthRowOf(req.params.crewId, req.params.month);
  if (row.state !== "sealed") return sendError(res, 409, "month_not_sealed", "That month is not sealed yet.");
  const pdf = await readObject(row.record_key!);
  if (!pdf) return sendError(res, 503, "archive_unreachable", "The archive is unreachable, so this document cannot be fetched right now.");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="record-${req.params.month}.pdf"`);
  res.send(pdf);
});

api.get("/crew/:crewId/months/:month/copy.pdf", requirePerson, async (req: Request, res: Response) => {
  if (!(await canReadCrew(req, res, req.params.crewId))) return;
  const row = await monthRowOf(req.params.crewId, req.params.month);
  if (row.state !== "sealed") return sendError(res, 409, "month_not_sealed", "That month is not sealed yet.");
  const pdf = await readObject(row.copy_key!);
  if (!pdf) return sendError(res, 503, "archive_unreachable", "The archive is unreachable, so this document cannot be fetched right now.");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="seafarer-copy-${req.params.month}.pdf"`);
  res.send(pdf);
});

api.get("/archive-status", requireOwnerMaster, async (req: Request, res: Response) => {
  res.json(await archiveStatus());
});

// ---------------------------------------------------------------------------
// Inspection links

api.get("/vessels/:vesselId/inspection-links", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const rows = await query<{ id: string; token: string; from_date: string; to_date: string; expires_at_utc: string; state: string }>(
    `SELECT id, token, from_date, to_date, expires_at_utc, state FROM inspection_links WHERE vessel_id = $1 ORDER BY expires_at_utc DESC`,
    [req.params.vesselId]);
  res.json({ links: rows.map((r) => ({
    id: r.id, url: `/inspect/${r.token}`, from_date: r.from_date, to_date: r.to_date,
    expires_at_utc: r.expires_at_utc, state: linkStateOf(r.expires_at_utc, r.state),
  })) });
});

function linkStateOf(expiresAtUtc: string, storedState: string): "active" | "expired" | "revoked" {
  if (storedState === "revoked") return "revoked";
  if (serverNow() >= fromUtcString(expiresAtUtc)!) return "expired";
  return "active";
}

api.post("/vessels/:vesselId/inspection-links", requireOwnerMaster, async (req: Request, res: Response) => {
  const owner = await vesselOwner(req.params.vesselId);
  if (owner === null || owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that vessel.");
  const body = req.body as Body;
  const fromDate = str(body, "from_date");
  const toDate = str(body, "to_date");
  const expiresAt = str(body, "expires_at_utc");
  const errors: Record<string, string> = {};
  if (!fromDate || !isValidShipDate(fromDate)) errors.from_date = "Write the from ship's date as YYYY-MM-DD.";
  if (!toDate || !isValidShipDate(toDate)) errors.to_date = "Write the to ship's date as YYYY-MM-DD.";
  if (fromDate && toDate && fromDate > toDate) errors.to_date = "The to date must not be before the from date.";
  const expiresMs = expiresAt ? fromUtcString(expiresAt) : null;
  if (expiresMs === null || !isAlignedString(expiresAt ?? "")) errors.expires_at_utc = "Write the expiry in UTC on a half hour.";
  if (expiresMs !== null && expiresMs <= serverNow()) errors.expires_at_utc = "Pick an expiry after the server's time.";
  if (Object.keys(errors).length > 0) return void sendValidation(res, errors);
  const id = `link-${crypto.randomUUID()}`;
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await query(`INSERT INTO inspection_links (id, vessel_id, token, from_date, to_date, expires_at_utc, state)
    VALUES ($1,$2,$3,$4,$5,$6,'active')`,
    [id, req.params.vesselId, token, fromDate!, toDate!, expiresAt!]);
  void writeInspectionDocument(id, req.params.vesselId, fromDate!, toDate!);
  res.status(201).json({
    id, vessel_id: req.params.vesselId, url: `/inspect/${token}`,
    from_date: fromDate!, to_date: toDate!, expires_at_utc: expiresAt!, state: "active",
  });
});

api.post("/inspection-links/:id/revoke", requireOwnerMaster, async (req: Request, res: Response) => {
  const link = await query<{ id: string; vessel_id: string; token: string; from_date: string; to_date: string; expires_at_utc: string; state: string }>(
    `SELECT id, vessel_id, token, from_date, to_date, expires_at_utc, state FROM inspection_links WHERE id = $1`, [req.params.id]);
  if (!link[0]) return sendError(res, 404, "not_found", "We couldn't find that link.");
  const owner = await vesselOwner(link[0].vessel_id);
  if (owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that link.");
  if (linkStateOf(link[0].expires_at_utc, link[0].state) !== "active") {
    return sendError(res, 409, "link_ended", "This link no longer opens.");
  }
  await query(`UPDATE inspection_links SET state = 'revoked' WHERE id = $1`, [req.params.id]);
  res.json({
    id: link[0].id, url: `/inspect/${link[0].token}`, from_date: link[0].from_date, to_date: link[0].to_date,
    expires_at_utc: link[0].expires_at_utc, state: "revoked",
  });
});

api.post("/inspection-links/:id/regenerate", requireOwnerMaster, async (req: Request, res: Response) => {
  const link = await query<{ id: string; vessel_id: string; token: string; from_date: string; to_date: string; expires_at_utc: string; state: string }>(
    `SELECT id, vessel_id, token, from_date, to_date, expires_at_utc, state FROM inspection_links WHERE id = $1`, [req.params.id]);
  if (!link[0]) return sendError(res, 404, "not_found", "We couldn't find that link.");
  const owner = await vesselOwner(link[0].vessel_id);
  if (owner !== req.person!.id) return sendError(res, 404, "not_found", "We couldn't find that link.");
  if (linkStateOf(link[0].expires_at_utc, link[0].state) !== "active") {
    return sendError(res, 409, "link_ended", "This link no longer opens.");
  }
  const newToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await query(`UPDATE inspection_links SET state = 'revoked' WHERE id = $1`, [req.params.id]);
  const newId = `link-${crypto.randomUUID()}`;
  await query(`INSERT INTO inspection_links (id, vessel_id, token, from_date, to_date, expires_at_utc, state)
    VALUES ($1,$2,$3,$4,$5,$6,'active')`,
    [newId, link[0].vessel_id, newToken, link[0].from_date, link[0].to_date, link[0].expires_at_utc]);
  void writeInspectionDocument(newId, link[0].vessel_id, link[0].from_date, link[0].to_date);
  res.status(201).json({
    id: newId, url: `/inspect/${newToken}`, from_date: link[0].from_date, to_date: link[0].to_date,
    expires_at_utc: link[0].expires_at_utc, state: "active",
  });
});

// ---------------------------------------------------------------------------
// Inspector endpoints (no session; token checked first: unknown, revoked, expired)

api.get("/inspect/:token", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const token = req.params.token;
  const link = await query<{ id: string; vessel_id: string; from_date: string; to_date: string; expires_at_utc: string; state: string }>(
    `SELECT id, vessel_id, from_date, to_date, expires_at_utc, state FROM inspection_links WHERE token = $1`, [token]);
  if (!link[0]) return sendError(res, 404, "not_found", "We couldn't find that inspection link.");
  if (link[0].state === "revoked") return sendError(res, 410, "link_revoked", "This inspection link has been revoked.");
  if (serverNow() >= fromUtcString(link[0].expires_at_utc)!) {
    return sendError(res, 410, "link_expired", "This inspection link has expired.");
  }
  let fromDate = link[0].from_date;
  let toDate = link[0].to_date;
  if (typeof req.query.from === "string" && req.query.from.length > 0) {
    if (req.query.from < link[0].from_date || req.query.from > link[0].to_date) {
      return sendError(res, 403, "outside_scope", "That date is outside this link's range.");
    }
    fromDate = req.query.from;
  }
  if (typeof req.query.to === "string" && req.query.to.length > 0) {
    if (req.query.to < link[0].from_date || req.query.to > link[0].to_date) {
      return sendError(res, 403, "outside_scope", "That date is outside this link's range.");
    }
    toDate = req.query.to;
  }

  const vessel = await query<{ id: string; name: string }>(`SELECT id, name FROM vessels WHERE id = $1`, [link[0].vessel_id]);
  const crewRows = await query<{ id: string; name: string; rank: string }>(
    `SELECT id, name, rank FROM crew WHERE vessel_id = $1 ORDER BY name`, [link[0].vessel_id]);
  const crewOut: unknown[] = [];
  const unsealedDates = new Set<string>();
  for (const crew of crewRows) {
    const record = await crewRecordFor(crew.id);
    if (!record) continue;
    // Days appear only when they are within the link's dates and in a sealed month.
    const dayViews: unknown[] = [];
    const breaches = await query<{ id: string; rule: string; window_hours: number; window_start_utc: string; window_end_utc: string; rule_set: string; rest_hours: number; recorded_at_utc: string; still_breaching: boolean }>(
      `SELECT id, rule, window_hours, window_start_utc, window_end_utc, rule_set, rest_hours, recorded_at_utc, false AS still_breaching
       FROM breaches WHERE crew_id = $1`, [crew.id]);
    let cursor = fromDate;
    while (cursor <= toDate) {
      const month = cursor.slice(0, 7);
      const sealed = await query<{ state: string }>(`SELECT state FROM months WHERE crew_id = $1 AND month = $2`, [crew.id, month]);
      if (sealed[0]?.state === "sealed") {
        const view = await record.dayView(cursor);
        dayViews.push({
          ship_date: cursor,
          cell_count: view.cell_count,
          cells: view.cells,
          rest_hours: view.rest_hours,
          signed_at_utc: view.signed_at_utc,
          countersigned_at_utc: view.countersigned_at_utc,
          late_entries: view.entries.filter((e) => e.late).length,
          notes: view.notes,
        });
      } else if (sealed[0]?.state) {
        unsealedDates.add(cursor);
      }
      cursor = addShipDay(cursor);
    }
    crewOut.push({ id: crew.id, name: crew.name, rank: crew.rank, days: dayViews, breaches });
  }
  const clockChanges = await query<{ id: string; changes_at_utc: string; old_offset_minutes: number; new_offset_minutes: number }>(
    `SELECT id, changes_at_utc, old_offset_minutes, new_offset_minutes FROM clock_changes WHERE vessel_id = $1 ORDER BY changes_at_utc`,
    [link[0].vessel_id]);
  const fixes = await query<{ id: string; at_utc: string; latitude: number; longitude: number }>(
    `SELECT id, at_utc, latitude, longitude FROM fixes WHERE vessel_id = $1 ORDER BY at_utc`, [link[0].vessel_id]);
  const events = await query<{ id: string; crew_id: string; kind: string; start_utc: string; end_utc: string; description: string }>(
    `SELECT id, crew_id, kind, start_utc, end_utc, description FROM events WHERE vessel_id = $1 ORDER BY start_utc`, [link[0].vessel_id]);
  res.json({
    vessel: vessel[0] ? { id: vessel[0].id, name: vessel[0].name } : null,
    from_date: fromDate,
    to_date: toDate,
    expires_at_utc: link[0].expires_at_utc,
    server_now_utc: nowUtcString(),
    crew: crewOut,
    unsealed_dates: [...unsealedDates].sort(),
    clock_changes: clockChanges,
    fixes,
    events,
  });
});

api.get("/inspect/:token/document", async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const token = req.params.token;
  const link = await query<{ id: string; vessel_id: string; from_date: string; to_date: string; expires_at_utc: string; state: string }>(
    `SELECT id, vessel_id, from_date, to_date, expires_at_utc, state FROM inspection_links WHERE token = $1`, [token]);
  if (!link[0]) return sendError(res, 404, "not_found", "We couldn't find that inspection link.");
  if (link[0].state === "revoked") return sendError(res, 410, "link_revoked", "This inspection link has been revoked.");
  if (serverNow() >= fromUtcString(link[0].expires_at_utc)!) {
    return sendError(res, 410, "link_expired", "This inspection link has expired.");
  }
  const pdf = await readObject(`inspections/${link[0].id}/document.pdf`);
  if (!pdf) return sendError(res, 503, "archive_unreachable", "The archive is unreachable, so this document cannot be fetched right now.");
  res.setHeader("Content-Type", "application/pdf");
  res.send(pdf);
});

api.all("/inspect/:token", (req: Request, res: Response) => {
  if (req.method !== "GET") {
    return sendError(res, 405, "read_only", "This link only reads records.");
  }
});

api.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

api.use((req: Request, res: Response) => {
  sendError(res, 404, "not_found", "We couldn't find that page.");
});
