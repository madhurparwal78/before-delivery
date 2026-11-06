// Fix ingest (single and batched) and the logger's line start and end, applied one request at a time per vessel.
import type pg from "pg";
import { one, only, pool, tx } from "./db.js";
import { clearAlert, openAlert } from "./alerts.js";
import { lineDirection, pairSweeps, refreshCoverage } from "./coverage.js";
import { ACTIVE, evaluateExcursion, evaluateOverdue } from "./fleet.js";
import { recordEvent, SYSTEM } from "./history.js";
import { ApiError, conflict, illegalTransition, invalid, isNumber, isRecord, notFound } from "./http.js";
import { finished, lineJson, loadLine, loadLines } from "./lines.js";
import type { FixRecord, LineRecord, MissionRecord, PlacedVessel } from "./records.js";
import { linkState, loadVessel, overdue, serviceOverdueError } from "./vessels.js";
import type { IncomingMessage } from "node:http";

interface Fix {
  t: Date;
  easting: number;
  northing: number;
  heading_deg: number;
  speed_mps: number;
  battery_pct: number;
  depth_m: number;
}

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;

function parseUtc(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const m = ISO_UTC.exec(value);
  if (!m) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const same = date.getUTCFullYear() === y && date.getUTCMonth() + 1 === mo && date.getUTCDate() === d
    && date.getUTCHours() === h && date.getUTCMinutes() === mi && date.getUTCSeconds() === s;
  return same ? date : null;
}

const RULES: [keyof Omit<Fix, "t">, (n: number) => boolean, string][] = [
  ["easting", () => true, "Send easting in metres"],
  ["northing", () => true, "Send northing in metres"],
  ["heading_deg", (n) => n >= 0 && n < 360, "Heading must be at least 0 and below 360"],
  ["speed_mps", (n) => n >= 0 && n <= 20, "Speed must be between 0 and 20 m/s"],
  ["battery_pct", (n) => n >= 0 && n <= 100, "Battery must be between 0 and 100 %"],
  ["depth_m", (n) => n > 0 && n <= 500, "Depth must be above 0 and at most 500 m"],
];

function checkFix(raw: unknown, prefix: string, errors: Record<string, string>): Fix | null {
  const item = isRecord(raw) ? raw : {};
  const t = parseUtc(item.t);
  if (!t) errors[`${prefix}t`] = "Send t as an ISO 8601 UTC time";
  for (const [field, ok, message] of RULES) {
    const v = item[field];
    if (!isNumber(v) || !ok(v)) errors[`${prefix}${field}`] = message;
  }
  if (!t || Object.keys(errors).some((k) => k.startsWith(prefix))) return null;
  return { t, ...(Object.fromEntries(RULES.map(([f]) => [f, item[f]])) as Omit<Fix, "t">) };
}

export async function vesselForKey(req: IncomingMessage): Promise<string> {
  const key = req.headers["x-ingest-key"];
  const vessel = typeof key === "string" && key ? await one<{ id: string }>(pool, "SELECT id FROM vessels WHERE ingest_key = $1", [key]) : null;
  if (!vessel) throw new ApiError(401, "invalid_ingest_key", "Send this logger's ingest key.");
  return vessel.id;
}

interface Running {
  line: LineRecord;
  mission: MissionRecord;
}

/** Applies one new fix as the vessel's latest; returns whether it swept a swath. */
async function applyFix(db: pg.PoolClient, vessel: PlacedVessel, running: Running | null, fix: Fix, receivedAt: Date): Promise<boolean> {
  const dt = vessel.last_fix_t ? (fix.t.getTime() - vessel.last_fix_t.getTime()) / 1000 : 0;
  await db.query(
    `INSERT INTO fixes (vessel_id, t, received_at, easting, northing, heading_deg, speed_mps, battery_pct, depth_m, line_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [vessel.id, fix.t, receivedAt, fix.easting, fix.northing, fix.heading_deg, fix.speed_mps, fix.battery_pct, fix.depth_m, running?.line.id ?? null]);
  let gained = 0;
  if (running && fix.speed_mps > 0.3 && dt > 0 && dt <= 60) gained = dt / 3600;
  let swept = false;
  if (running && vessel.last_fix_t && vessel.last_fix_line_id === running.line.id
    && pairSweeps(dt, fix.speed_mps, running.mission.planned_speed_mps, fix.heading_deg, lineDirection(running.line.kind, running.mission.line_azimuth_deg))) {
    const length = Math.hypot(fix.easting - vessel.last_easting, fix.northing - vessel.last_northing);
    await db.query(
      `INSERT INTO sweeps (mission_id, line_id, ax, ay, bx, by_, half_width, depth_m, length_m) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [running.mission.id, running.line.id, vessel.last_easting, vessel.last_northing, fix.easting, fix.northing,
        (fix.depth_m * running.mission.swath_ratio) / 2, fix.depth_m, length]);
    swept = true;
  }
  await db.query(
    `UPDATE vessels SET last_fix_t = $2, last_fix_received_at = $3, last_easting = $4, last_northing = $5, last_heading = $6,
       last_speed = $7, last_battery = $8, last_depth = $9, last_fix_line_id = $10, link_observed = 'Live',
       thruster_hours_total = thruster_hours_total + $11, hours_since_service = hours_since_service + $11 WHERE id = $1`,
    [vessel.id, fix.t, receivedAt, fix.easting, fix.northing, fix.heading_deg, fix.speed_mps, fix.battery_pct, fix.depth_m,
      running?.line.id ?? null, gained]);
  Object.assign(vessel, {
    last_fix_t: fix.t, last_fix_received_at: receivedAt, last_easting: fix.easting, last_northing: fix.northing,
    last_fix_line_id: running?.line.id ?? null, thruster_hours_total: vessel.thruster_hours_total + gained,
    hours_since_service: vessel.hours_since_service + gained,
  });
  const lost = await openAlert(db, "link_lost", vessel.id);
  if (lost) await clearAlert(db, lost.id);
  if (vessel.mission_id) {
    const mission = await only<MissionRecord>(db, "SELECT * FROM missions WHERE id = $1", [vessel.mission_id]);
    if (ACTIVE.includes(mission.status)) await evaluateExcursion(db, vessel, mission, { easting: fix.easting, northing: fix.northing });
  }
  await evaluateOverdue(db, vessel);
  return swept;
}

async function runningOf(db: pg.PoolClient, vessel: PlacedVessel): Promise<Running | null> {
  if (!vessel.running_line_id) return null;
  const line = await only<LineRecord>(db, "SELECT * FROM lines WHERE id = $1", [vessel.running_line_id]);
  const mission = await only<MissionRecord>(db, "SELECT * FROM missions WHERE id = $1", [line.mission_id]);
  return { line, mission };
}

export async function ingestFixes(vesselId: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const batch = isRecord(payload) && "fixes" in payload;
  const errors: Record<string, string> = {};
  let fixes: Fix[] = [];
  if (batch) {
    const list = (payload as Record<string, unknown>).fixes;
    if (!Array.isArray(list) || list.length < 1 || list.length > 100) throw invalid({ fixes: "Send 1 to 100 fixes" });
    const seenTimes = new Map<number, number>();
    list.forEach((raw, i) => {
      const fix = checkFix(raw, `fixes.${i}.`, errors);
      if (!fix) return;
      if (seenTimes.has(fix.t.getTime())) errors[`fixes.${i}.t`] = "Each fix in a batch needs its own time";
      else seenTimes.set(fix.t.getTime(), i);
      fixes[i] = fix;
    });
  } else {
    const fix = checkFix(payload, "", errors);
    if (fix) fixes = [fix];
  }
  if (Object.keys(errors).length) throw invalid(errors);

  return tx(async (db) => {
    const vessel = await loadVessel(db, vesselId, true);
    const known = new Set((await db.query<Pick<FixRecord, "t">>("SELECT t FROM fixes WHERE vessel_id = $1 AND t = ANY($2)", [vesselId, fixes.map((f) => f.t)]))
      .rows.map((r) => r.t.getTime()));
    const latest = vessel.last_fix_t ? vessel.last_fix_t.getTime() : -Infinity;
    const receivedAt = new Date();
    if (!batch) {
      const fix = fixes[0];
      if (known.has(fix.t.getTime())) {
        const stored = await only<Pick<FixRecord, "received_at">>(db, "SELECT received_at FROM fixes WHERE vessel_id = $1 AND t = $2", [vesselId, fix.t]);
        return { status: 200, body: { vessel_id: vesselId, received_at: stored.received_at.toISOString(), link_state: linkState(vessel.last_fix_received_at), duplicate: true } };
      }
      if (fix.t.getTime() < latest) throw conflict("out_of_order", "This fix is older than the vessel's latest fix");
    } else {
      const stale = fixes.findIndex((f) => !known.has(f.t.getTime()) && f.t.getTime() < latest);
      if (stale >= 0) throw conflict("stale_fix", "A fix in this batch is older than the vessel's latest fix", { index: stale });
    }
    const fresh = fixes.filter((f) => !known.has(f.t.getTime())).sort((a, b) => a.t.getTime() - b.t.getTime());
    const running = await runningOf(db, vessel);
    let swept = false;
    for (const fix of fresh) swept = (await applyFix(db, vessel, running, fix, receivedAt)) || swept;
    if (running && (swept || fresh.length)) await refreshCoverage(db, running.mission.id);
    if (!batch) {
      return { status: 201, body: { vessel_id: vesselId, received_at: receivedAt.toISOString(), link_state: "Live", duplicate: false } };
    }
    return {
      status: fresh.length ? 201 : 200,
      body: { vessel_id: vesselId, accepted: fresh.length, replayed: fixes.length - fresh.length,
        link_state: linkState(vessel.last_fix_received_at), last_t: vessel.last_fix_t ? vessel.last_fix_t.toISOString() : null },
    };
  });
}

/** The logger starts or ends one of its vessel's lines. */
export async function lineCommand(vesselId: string, lineId: string, command: "start" | "end"): Promise<Record<string, unknown>> {
  return tx(async (db) => {
    const found = await one<Pick<LineRecord, "mission_id" | "vessel_id">>(db, "SELECT mission_id, vessel_id FROM lines WHERE id = $1", [lineId]);
    if (!found || found.vessel_id !== vesselId) throw notFound();
    const mission = await only<MissionRecord>(db, "SELECT * FROM missions WHERE id = $1 FOR UPDATE", [found.mission_id]);
    const vessel = await loadVessel(db, vesselId, true);
    const line = await only<LineRecord>(db, "SELECT * FROM lines WHERE id = $1 FOR UPDATE", [lineId]);
    if (line.vessel_id !== vesselId) throw notFound();
    const to = command === "start" ? "Running" : "Surveyed";
    const refuse = () => illegalTransition(`Line ${line.label} cannot move from ${line.status} to ${to}`, line.status, to);
    if (command === "start") {
      if (!["Launched", "Surveying"].includes(mission.status)) throw conflict("mission_not_active", "The mission is not launched or surveying.");
      if (mission.hold_reason !== null) throw conflict("mission_on_hold", "The mission is on hold for weather.");
      if (overdue(vessel)) throw serviceOverdueError(vessel);
      if (vessel.running_line_id) throw conflict("vessel_busy", `${vessel.name} is already running a line.`);
      if (line.status !== "Assigned") throw refuse();
      await db.query("UPDATE lines SET status = 'Running', queue_pos = NULL WHERE id = $1", [lineId]);
      await recordEvent(db, mission.id, "line", SYSTEM, `${line.label} Assigned → Running`);
      if (mission.status === "Launched") {
        await db.query("UPDATE missions SET status = 'Surveying', version = version + 1 WHERE id = $1", [mission.id]);
        await recordEvent(db, mission.id, "status", SYSTEM, "Status Launched → Surveying");
      }
    } else {
      if (line.status !== "Running") throw refuse();
      await db.query("UPDATE lines SET status = 'Surveyed', file_state = 'Awaiting upload' WHERE id = $1", [lineId]);
      await recordEvent(db, mission.id, "line", SYSTEM, `${line.label} Running → Surveyed`);
    }
    await refreshCoverage(db, mission.id);
    if (command === "end" && mission.status === "Surveying" && (await loadLines(db, mission.id)).every((l) => finished(l.status))) {
      await db.query("UPDATE missions SET status = 'Recovering', version = version + 1 WHERE id = $1", [mission.id]);
      await recordEvent(db, mission.id, "status", SYSTEM, "Status Surveying → Recovering");
    }
    const updated = await loadLine(db, mission.id, lineId);
    return { line: lineJson(updated) };
  });
}
