// Missions: the record, creation, assignments, the status machine, handover, hold, geofence and re-runs.
import type pg from "pg";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { one, only, pool, rows, tx } from "./db.js";
import { clearMissionAlerts } from "./alerts.js";
import { agreement, counters, refreshCoverage } from "./coverage.js";
import { ACTIVE, evaluateExcursion, OPEN } from "./fleet.js";
import { recordEvent, SYSTEM } from "./history.js";
import { ApiError, conflict, forbidden, illegalTransition, invalid, isRecord, isString, notFound } from "./http.js";
import { appendToQueue, eligibleVessels, holidayRecord, infillGeometry, midpoint, nearestOf, queueOf } from "./infill.js";
import { insertLines, lineJson, loadLine, loadLines, sortKey } from "./lines.js";
import { queueMail } from "./mail.js";
import { newId } from "./passwords.js";
import { checkGeofence, checkSettings, checkSurveyArea, derivePlan } from "./plan.js";
import type { HolidayRecord, LineRecord, MissionRecord, PlacedVessel, UserRecord, VesselRecord } from "./records.js";
import { findVessel, linkState, loadVessel, nameList, overdue, serviceOverdueError } from "./vessels.js";
import { distance } from "./geometry.js";

const STATUS_WORDS = ["Planned", "Launched", "Surveying", "Recovering", "Complete", "Aborted"];

/** A mission the user may see, or 404 (another organisation's mission is never confirmed to exist). */
export async function missionFor(db: Db, user: UserRecord, id: string, lock = false): Promise<MissionRecord> {
  const m = await one<MissionRecord>(db, `SELECT * FROM missions WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  if (!m || (user.role === "client_reviewer" && m.client_org_id !== user.client_org_id)) throw notFound();
  return m;
}

/** A mission re-read after a change in the caller's transaction. */
const reloadMission = (db: Db, id: string) => only<MissionRecord>(db, "SELECT * FROM missions WHERE id = $1", [id]);

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function missionJson(db: Db, m: MissionRecord, viewer: UserRecord): Promise<Record<string, unknown>> {
  const org = await only<{ name: string }>(db, "SELECT name FROM client_orgs WHERE id = $1", [m.client_org_id]);
  const owner = await only<{ name: string }>(db, "SELECT name FROM users WHERE id = $1", [m.owner_id]);
  const vessels = await rows<Pick<VesselRecord, "id" | "name" | "last_fix_received_at">>(db,
    `SELECT v.id, v.name, v.last_fix_received_at FROM vessels v
     WHERE EXISTS (SELECT 1 FROM lines l WHERE l.mission_id = $1 AND l.vessel_id = v.id) ORDER BY v.seed_order`, [m.id]);
  const showLink = viewer.role !== "client_reviewer" || ACTIVE.includes(m.status);
  return {
    id: m.id,
    name: m.name,
    client_org_id: m.client_org_id,
    client_name: org.name,
    survey_date: m.survey_date,
    status: m.status,
    survey_order: m.survey_order,
    survey_area: m.survey_area,
    geofence: m.geofence,
    planned_depth_m: m.planned_depth_m,
    swath_ratio: m.swath_ratio,
    overlap_pct: m.overlap_pct,
    line_azimuth_deg: m.line_azimuth_deg,
    planned_speed_mps: m.planned_speed_mps,
    swath_width_m: m.swath_width_m,
    line_spacing_m: m.line_spacing_m,
    line_count: m.line_count,
    crossline_count: m.crossline_count,
    estimated_duration_s: m.estimated_duration_s,
    counters: await counters(db, m.id),
    crossline_agreement: await agreement(db, m.id),
    vessels: vessels.map((v) => ({ id: v.id, name: v.name, link_state: showLink ? linkState(v.last_fix_received_at) : null })),
    report: { state: m.report_state },
    owner_id: m.owner_id,
    owner_name: owner.name,
    version: m.version,
    hold: m.hold_reason === null ? null : { reason: m.hold_reason, since: iso(m.hold_since), by: m.hold_by },
    created_at: iso(m.created_at),
    launched_at: iso(m.launched_at),
    completed_at: iso(m.completed_at),
  };
}

type MissionListing = Pick<MissionRecord, "id" | "name" | "client_org_id" | "survey_date" | "status" | "owner_id"> & { client_name: string; owner_name: string };

/** Missions in the mission order: newest survey date, then lower-cased name, then id. */
export async function listMissions(user: UserRecord): Promise<Record<string, unknown>[]> {
  const found = await rows<MissionListing>(pool,
    `SELECT m.id, m.name, m.client_org_id, o.name AS client_name, m.survey_date, m.status, m.owner_id, u.name AS owner_name
     FROM missions m JOIN client_orgs o ON o.id = m.client_org_id JOIN users u ON u.id = m.owner_id ${user.role === "client_reviewer" ? "WHERE m.client_org_id = $1" : ""}
     ORDER BY m.survey_date DESC, lower(m.name), m.id`, user.role === "client_reviewer" ? [user.client_org_id] : []);
  const out = [];
  for (const m of found) out.push({ ...m, counters: await counters(pool, m.id) });
  return out;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function realDate(value: unknown): boolean {
  const m = typeof value === "string" ? DATE.exec(value) : null;
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** The plan-preview body: settings and survey area only. */
export function previewPlan(raw: unknown) {
  const input = isRecord(raw) ? raw : {};
  const errors: Record<string, string> = {};
  const area = checkSurveyArea(input.survey_area, errors);
  const settings = checkSettings(input, errors);
  if (!area || !settings) throw invalid(errors);
  const plan = derivePlan(area, settings);
  return { swath_width_m: plan.swath_width_m, line_spacing_m: plan.line_spacing_m, line_count: plan.line_count,
    crossline_count: plan.crossline_count, estimated_duration_s: plan.estimated_duration_s };
}

export async function createMission(db: pg.PoolClient, user: UserRecord, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const errors: Record<string, string> = {};
  if (!isString(raw.name) || raw.name.trim().length < 1 || raw.name.length > 80) errors.name = "Enter a mission name of up to 80 characters";
  if (!realDate(raw.survey_date)) errors.survey_date = "Enter the survey date as YYYY-MM-DD";
  const area = checkSurveyArea(raw.survey_area, errors);
  const fence = checkGeofence(raw.geofence, area, errors);
  const settings = checkSettings(raw, errors);
  if (Object.keys(errors).length || !area || !fence || !settings) throw invalid(errors);
  const plan = derivePlan(area, settings);
  const id = newId("m");
  const now = new Date();
  await db.query(
    `INSERT INTO missions (id, name, client_org_id, survey_date, status, survey_order, survey_area, geofence,
       planned_depth_m, swath_ratio, overlap_pct, line_azimuth_deg, planned_speed_mps, swath_width_m, line_spacing_m,
       line_count, crossline_count, estimated_duration_s, owner_id, created_at)
     VALUES ($1,$2,$3,$4,'Planned',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [id, raw.name, raw.client_org_id, raw.survey_date, settings.survey_order, JSON.stringify(area), JSON.stringify(fence),
      settings.planned_depth_m, settings.swath_ratio, settings.overlap_pct, settings.line_azimuth_deg, settings.planned_speed_mps,
      plan.swath_width_m, plan.line_spacing_m, plan.line_count, plan.crossline_count, plan.estimated_duration_s, user.id, now]);
  await insertLines(db, id, plan.lines);
  await db.query("INSERT INTO mission_coverage (mission_id) VALUES ($1)", [id]);
  await recordEvent(db, id, "created", user.name, "Mission created", now);
  return missionJson(db, await reloadMission(db, id), user);
}

const notOwner = (owner: string, mission: string) => new ApiError(403, "not_mission_owner", `Only ${owner} can do this for ${mission}.`);

/** Owner-only actions: a principal surveyor who is not the owner gets 403 not_mission_owner. */
async function requireOwner(db: Db, user: UserRecord, m: MissionRecord): Promise<void> {
  if (user.role !== "principal_surveyor") throw forbidden();
  if (m.owner_id !== user.id) {
    const owner = await only<{ name: string }>(db, "SELECT name FROM users WHERE id = $1", [m.owner_id]);
    throw notOwner(owner.name, m.name);
  }
}

/** Locks vessel rows in id order so saves, launches and completions touching a vessel run one at a time. */
async function lockVessels(db: Db, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) await db.query("SELECT 1 FROM vessels WHERE id = $1 FOR UPDATE", [id]);
}

export async function saveAssignments(user: UserRecord, missionId: string, raw: unknown): Promise<Record<string, unknown>[]> {
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId, true);
    const list = isRecord(raw) ? raw.assignments : undefined;
    const wellFormed = Array.isArray(list) && list.length >= 1 && list.length <= 500
      && list.every((a) => isRecord(a) && isString(a.line_id) && (a.vessel_id === null || isString(a.vessel_id)));
    if (!wellFormed) {
      if (user.role !== "principal_surveyor") throw forbidden();
      throw invalid({ assignments: "Send 1 to 500 assignments of a line and a vessel or null" });
    }
    const entries = list as { line_id: string; vessel_id: string | null }[];
    const lines = new Map((await loadLines(db, m.id)).map((l) => [l.id, l]));
    const vesselIds = [...new Set(entries.map((e) => e.vessel_id).filter((v): v is string => v !== null))];
    await lockVessels(db, vesselIds);
    const vessels: PlacedVessel[] = [];
    for (const id of vesselIds) {
      const v = await findVessel(db, id);
      if (!v) throw notFound();
      vessels.push(v);
    }
    const targets: { line: LineRecord; vessel_id: string | null }[] = [];
    for (const e of entries) {
      const line = lines.get(e.line_id);
      if (!line) throw notFound();
      targets.push({ line, vessel_id: e.vessel_id });
    }
    if (user.role !== "principal_surveyor") throw forbidden();
    if (!["Planned", "Launched", "Surveying"].includes(m.status)) throw conflict("mission_not_assignable", "This mission no longer takes assignments");
    const refused = targets.find((t) => !["Pending", "Assigned"].includes(t.line.status));
    if (refused) {
      throw illegalTransition("Only pending or assigned lines can be reassigned", refused.line.status, refused.vessel_id ? "Assigned" : "Pending");
    }
    for (const v of vessels) {
      const other = await one<{ name: string }>(db,
        `SELECT m.name FROM lines l JOIN missions m ON m.id = l.mission_id
         WHERE l.vessel_id = $1 AND l.mission_id <> $2 AND m.status IN ('Planned','Launched','Surveying','Recovering') LIMIT 1`, [v.id, m.id]);
      if (other) throw conflict("vessel_committed", `${v.name} is already on ${other.name}`);
    }
    for (const v of vessels) if (overdue(v)) throw serviceOverdueError(v);
    if (m.status !== "Planned") {
      const ashore = vessels.filter((v) => !v.afloat);
      if (ashore.length) throw conflict("vessels_not_afloat", `Not afloat yet: ${nameList(ashore.map((v) => v.name))}`);
    }
    for (const { line, vessel_id } of targets) {
      const status = vessel_id ? "Assigned" : "Pending";
      await db.query("UPDATE lines SET vessel_id = $2, status = $3 WHERE id = $1", [line.id, vessel_id, status]);
      if (line.kind === "infill") {
        if (!vessel_id) await db.query("UPDATE lines SET queue_pos = NULL WHERE id = $1", [line.id]);
        else if (vessel_id !== line.vessel_id) await appendToQueue(db, line.id, m.id, vessel_id);
      }
      if (status !== line.status) await recordEvent(db, m.id, "line", user.name, `${line.label} ${line.status} → ${status}`);
    }
    await db.query("UPDATE missions SET version = version + 1 WHERE id = $1", [m.id]);
    await recordEvent(db, m.id, "assignments", user.name, `Assignments saved (${entries.length} lines)`);
    await refreshCoverage(db, m.id);
    const after = await loadLines(db, m.id);
    return targets.map(({ line }) => {
      const [fresh] = after.filter((l) => l.id === line.id);
      return lineJson(fresh);
    });
  });
}

const illegalMove = (from: string, to: string) => illegalTransition(`This mission cannot move from ${from} to ${to}`, from, to);

/** The mission status machine with its role checks and preconditions. */
export async function transition(user: UserRecord, missionId: string, raw: unknown): Promise<{ mission: Record<string, unknown>; completed: boolean }> {
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId, true);
    const to = isRecord(raw) ? raw.to : undefined;
    if (user.role === "client_reviewer") throw forbidden();
    if (to === "Launched" || to === "Aborted") await requireOwner(db, user, m);
    else if (to === "Complete" && user.role !== "launch_technician") throw forbidden();
    if (!isString(to) || !STATUS_WORDS.includes(to)) throw invalid({ to: "Choose a mission status" });
    const lines = await loadLines(db, m.id);
    const vesselIds = [...new Set(lines.flatMap((l) => (l.vessel_id ? [l.vessel_id] : [])))];
    await lockVessels(db, vesselIds);
    const vessels: PlacedVessel[] = [];
    for (const id of vesselIds) vessels.push(await loadVessel(db, id));
    const now = new Date();
    let completed = false;
    if (to === "Launched" && m.status === "Planned") {
      if (lines.some((l) => l.kind !== "infill" && l.status !== "Assigned")) throw conflict("lines_unassigned", "Assign every line and crossline before launching");
      const late = vessels.filter((v) => overdue(v)).sort((a, b) => a.name.localeCompare(b.name))[0];
      if (late) throw serviceOverdueError(late);
      const ashore = vessels.filter((v) => !v.afloat);
      if (ashore.length) throw conflict("vessels_not_afloat", `Not afloat yet: ${nameList(ashore.map((v) => v.name))}`);
      await db.query("UPDATE missions SET status = 'Launched', launched_at = $2, version = version + 1 WHERE id = $1", [m.id, now]);
    } else if (to === "Aborted" && ACTIVE.includes(m.status)) {
      await db.query("UPDATE missions SET status = 'Aborted', hold_reason = NULL, hold_since = NULL, hold_by = NULL, version = version + 1 WHERE id = $1", [m.id]);
      await clearMissionAlerts(db, m.id);
    } else if (to === "Complete" && m.status === "Recovering") {
      if (lines.some((l) => l.status !== "Delivered" && l.status !== "Superseded")) throw conflict("lines_awaiting_upload", "Upload every line file before completing");
      const afloat = vessels.filter((v) => v.afloat);
      if (afloat.length) throw conflict("vessels_afloat", `Recover every vessel before completing: ${nameList(afloat.map((v) => v.name))}`);
      await db.query("UPDATE missions SET status = 'Complete', completed_at = $2, report_state = 'Pending', version = version + 1 WHERE id = $1", [m.id, now]);
      await clearMissionAlerts(db, m.id);
      completed = true;
    } else throw illegalMove(m.status, to);
    await recordEvent(db, m.id, "status", user.name, `Status ${m.status} → ${to}`, now);
    return { mission: await missionJson(db, await reloadMission(db, m.id), user), completed };
  });
}

function versionOf(raw: Record<string, unknown>): number | null {
  return Number.isInteger(raw.version) ? (raw.version as number) : null;
}

export async function handover(user: UserRecord, missionId: string, raw: unknown): Promise<Record<string, unknown>> {
  const input = isRecord(raw) ? raw : {};
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId, true);
    await requireOwner(db, user, m);
    if (!OPEN.includes(m.status)) throw conflict("mission_not_open", "Only an open mission can be handed over.");
    if (versionOf(input) !== m.version) throw conflict("stale_version", "This mission was changed by someone else.", { current: await missionJson(db, m, user) });
    const target = isString(input.to_user_id) ? await one<UserRecord>(db, "SELECT * FROM users WHERE id = $1", [input.to_user_id]) : null;
    if (!target || target.role !== "principal_surveyor" || target.id === user.id) throw invalid({ to_user_id: "Choose another principal surveyor" });
    const now = new Date();
    await db.query("UPDATE missions SET owner_id = $2, version = version + 1 WHERE id = $1", [m.id, target.id]);
    await recordEvent(db, m.id, "owner", user.name, `Handed to ${target.name}`, now);
    const stamp = now.toISOString().replace("T", " ").slice(0, 16);
    await queueMail(db, "handover", m.id, `handover:${m.id}:${m.version + 1}:${target.id}`, target, `${m.name} handed to you`,
      [`${user.name} handed ${m.name} to you at ${stamp} UTC.`, `Open the mission console: ${config.publicUrl}/missions/${m.id}`]);
    return missionJson(db, await reloadMission(db, m.id), user);
  });
}

export async function hold(user: UserRecord, missionId: string, raw: unknown): Promise<Record<string, unknown>> {
  const reason = isRecord(raw) && isString(raw.reason) ? raw.reason.trim() : "";
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId, true);
    await requireOwner(db, user, m);
    if (m.status !== "Surveying") throw conflict("mission_not_surveying", "Only a surveying mission can be held.");
    if (m.hold_reason !== null) throw conflict("mission_on_hold", "The mission is already on hold.");
    if (await one(db, "SELECT 1 FROM lines WHERE mission_id = $1 AND status = 'Running'", [m.id])) throw conflict("line_running", "Wait for the running line to end before holding.");
    if (reason.length < 3 || reason.length > 120) throw invalid({ reason: "Give a reason of 3 to 120 characters" });
    const now = new Date();
    await db.query("UPDATE missions SET hold_reason = $2, hold_since = $3, hold_by = $4, version = version + 1 WHERE id = $1", [m.id, reason, now, user.name]);
    await recordEvent(db, m.id, "hold", user.name, `Held: ${reason}`, now);
    return missionJson(db, await reloadMission(db, m.id), user);
  });
}

export async function resume(user: UserRecord, missionId: string): Promise<Record<string, unknown>> {
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId, true);
    await requireOwner(db, user, m);
    if (m.hold_reason === null) throw conflict("mission_not_on_hold", "The mission is not on hold.");
    await db.query("UPDATE missions SET hold_reason = NULL, hold_since = NULL, hold_by = NULL, version = version + 1 WHERE id = $1", [m.id]);
    await recordEvent(db, m.id, "hold", user.name, "Resumed");
    return missionJson(db, await reloadMission(db, m.id), user);
  });
}

/** A new geofence re-evaluates every vessel's open breach at once, from its latest fix. */
export async function changeGeofence(user: UserRecord, missionId: string, raw: unknown): Promise<Record<string, unknown>> {
  const input = isRecord(raw) ? raw : {};
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId, true);
    await requireOwner(db, user, m);
    if (!["Launched", "Surveying"].includes(m.status)) throw conflict("mission_not_active", "The geofence can change only while the mission is launched or surveying.");
    if (versionOf(input) !== m.version) throw conflict("stale_version", "This mission was changed by someone else.", { current: await missionJson(db, m, user) });
    const errors: Record<string, string> = {};
    const fence = checkGeofence(input.geofence, m.survey_area, errors);
    if (!fence) throw invalid(errors);
    const vesselIds = (await rows<{ vessel_id: string }>(db, "SELECT DISTINCT vessel_id FROM lines WHERE mission_id = $1 AND vessel_id IS NOT NULL", [m.id])).map((r) => r.vessel_id);
    await lockVessels(db, vesselIds);
    await db.query("UPDATE missions SET geofence = $2, version = version + 1 WHERE id = $1", [m.id, JSON.stringify(fence)]);
    await recordEvent(db, m.id, "geofence", user.name, "Geofence changed");
    const updated = await reloadMission(db, m.id);
    for (const id of vesselIds) {
      const v = await loadVessel(db, id);
      if (v.last_fix_t) await evaluateExcursion(db, v, updated, { easting: v.last_easting, northing: v.last_northing }, user.name);
    }
    return missionJson(db, updated, user);
  });
}

export async function rerun(user: UserRecord, missionId: string, lineId: string, raw: unknown): Promise<Record<string, unknown>> {
  const reason = isRecord(raw) && isString(raw.reason) ? raw.reason.trim() : "";
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId, true);
    const line = await one<LineRecord>(db, "SELECT * FROM lines WHERE id = $1 AND mission_id = $2 FOR UPDATE", [lineId, m.id]);
    if (!line) throw notFound();
    await requireOwner(db, user, m);
    if (!["Launched", "Surveying"].includes(m.status)) throw conflict("mission_not_active", "Lines can be re-run only while the mission is launched or surveying.");
    const reruns = await rows<{ status: string }>(db, "SELECT status FROM lines WHERE rerun_of = $1", [line.id]);
    if (reruns.some((r) => r.status !== "Delivered")) throw conflict("rerun_open", `${line.label} already has a re-run waiting.`);
    if (line.kind === "infill" || !["Surveyed", "Delivered"].includes(line.status)) {
      throw illegalTransition(`Line ${line.label} cannot move from ${line.status} to Superseded`, line.status, "Superseded");
    }
    if (reason.length < 3 || reason.length > 200) throw invalid({ reason: "Give a reason of 3 to 200 characters" });
    const n = reruns.length + 1;
    const label = `${line.label}R${n}`;
    const id = newId("l");
    await db.query(
      `INSERT INTO lines (id, mission_id, label, kind, sort_key, status, rerun_of, start_e, start_n, end_e, end_n, length_m, offset_m)
       VALUES ($1,$2,$3,$4,$5,'Pending',$6,$7,$8,$9,$10,$11,$12)`,
      [id, m.id, label, line.kind, `${line.sort_key}-R${String(n).padStart(3, "0")}`, line.id, line.start_e, line.start_n,
        line.end_e, line.end_n, line.length_m, line.offset_m]);
    await recordEvent(db, m.id, "rerun", user.name, `${label} added: ${reason}`);
    await refreshCoverage(db, m.id);
    return { line: lineJson(await loadLine(db, m.id, id)) };
  });
}

/** Queue infill across a holiday for the nearest eligible vessel; a Queued holiday returns its line. */
export async function queueInfill(user: UserRecord, missionId: string, holidayId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId, true);
    const h = await one<HolidayRecord>(db, "SELECT * FROM holidays WHERE id = $1 AND mission_id = $2 FOR UPDATE", [holidayId, m.id]);
    if (!h) throw notFound();
    if (user.role !== "principal_surveyor") throw forbidden();
    const label = `H${h.label_no}`;
    const respond = async (status: number, lineIdValue: string) => {
      const line = await loadLine(db, m.id, lineIdValue);
      const fresh = await only<HolidayRecord>(db, "SELECT * FROM holidays WHERE id = $1", [h.id]);
      return { status, body: { line: lineJson(line), holiday: await holidayRecord(db, m, fresh, user), counters: await counters(db, m.id) } };
    };
    if (h.status === "Queued") return respond(200, h.infill_line_id);
    if (h.status === "Closed") throw conflict("holiday_closed", `${label} has already closed`);
    if (m.status !== "Surveying") throw conflict("mission_not_surveying", "Infill can be queued only while the mission is surveying");
    const geometry = infillGeometry(m, h.cells);
    const vessel = nearestOf(await eligibleVessels(db, m.id), midpoint(geometry.start, geometry.end));
    if (!vessel) throw conflict("no_eligible_vessel", `No eligible vessel for ${label}`);
    const count = (await only<{ n: number }>(db, "SELECT count(*) AS n FROM lines WHERE mission_id = $1 AND kind = 'infill'", [m.id])).n + 1;
    const lineLabel = `I${String(count).padStart(2, "0")}`;
    const id = newId("l");
    await db.query(
      `INSERT INTO lines (id, mission_id, label, kind, sort_key, status, vessel_id, start_e, start_n, end_e, end_n, length_m, holiday_id)
       VALUES ($1,$2,$3,'infill',$4,'Assigned',$5,$6,$7,$8,$9,$10,$11)`,
      [id, m.id, lineLabel, sortKey("infill", count), vessel.id, geometry.start.easting, geometry.start.northing,
        geometry.end.easting, geometry.end.northing, distance(geometry.start, geometry.end), h.id]);
    await appendToQueue(db, id, m.id, vessel.id);
    await db.query("UPDATE holidays SET infill_line_id = $2, status = 'Queued' WHERE id = $1", [h.id, id]);
    await recordEvent(db, m.id, "infill", user.name, `${lineLabel} queued to ${vessel.name}`);
    await refreshCoverage(db, m.id);
    return respond(201, id);
  });
}

/** When a vessel becomes Lost, its Assigned infill lines move to the nearest eligible vessel. */
export async function moveInfillOffLost(db: pg.PoolClient, vesselId: string): Promise<void> {
  const lines = await rows<LineRecord>(db, "SELECT * FROM lines WHERE vessel_id = $1 AND kind = 'infill' AND status = 'Assigned' ORDER BY queue_pos", [vesselId]);
  for (const line of lines) {
    const candidates = await eligibleVessels(db, line.mission_id);
    const target = nearestOf(candidates, midpoint({ easting: line.start_e, northing: line.start_n }, { easting: line.end_e, northing: line.end_n }), vesselId);
    if (!target) continue;
    await appendToQueue(db, line.id, line.mission_id, target.id);
    await recordEvent(db, line.mission_id, "infill", SYSTEM, `${line.label} moved to ${target.name}`);
  }
}

/** Reorders a vessel's queue when the ids are exactly its current queue. */
export async function reorderQueue(user: UserRecord, missionId: string, vesselId: string, raw: unknown): Promise<string[]> {
  return tx(async (db) => {
    const m = await missionFor(db, user, missionId, true);
    if (!(await one(db, "SELECT 1 FROM lines WHERE mission_id = $1 AND vessel_id = $2", [m.id, vesselId]))) throw notFound();
    const ids = isRecord(raw) && Array.isArray(raw.line_ids) && raw.line_ids.every(isString) ? (raw.line_ids as string[]) : null;
    if (ids) {
      const infill = new Set((await rows<{ id: string }>(db, "SELECT id FROM lines WHERE mission_id = $1 AND kind = 'infill'", [m.id])).map((r) => r.id));
      if (ids.some((id) => !infill.has(id))) throw notFound();
    }
    if (user.role !== "principal_surveyor") throw forbidden();
    const current = await queueOf(db, m.id, vesselId);
    if (ids && (ids.length !== current.length || [...ids].sort().join() !== [...current].sort().join() || new Set(ids).size !== ids.length)) {
      throw conflict("stale_order", "The infill queue has changed.");
    }
    if (!ids) throw invalid({ line_ids: "Send each infill line id once" });
    for (const [i, id] of ids.entries()) await db.query("UPDATE lines SET queue_pos = $2 WHERE id = $1", [id, i + 1]);
    return queueOf(db, m.id, vesselId);
  });
}

