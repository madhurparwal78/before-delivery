// The API surface. Each handler follows the error precedence: body limits and type, session, scope (404),
// role (403), idempotent replay, state (409), validation (422), storage (503).
import { alertJson, acknowledge } from "./alerts.js";
import { clearedCookie, isStaff, refreshSession, requireRole, requireUser, revokeSession, sessionCookie, signIn, userJson } from "./auth.js";
import { computeCoverage, counters, loadSweeps } from "./coverage.js";
import { one, only, pool, rows, tx } from "./db.js";
import { evaluateOverdue } from "./fleet.js";
import { flagLine, listFlags, replyToFlag } from "./flags.js";
import { downloadLineFile, openUpload, readReport, uploadPart, uploadWhole } from "./files.js";
import { historyPage } from "./history.js";
import { conflict, forbidden, headerValue, invalid, isNumber, isRecord, notFound, readJson, Router, sendEmpty, sendJson, type Context } from "./http.js";
import { fingerprint, idempotent } from "./idempotency.js";
import { eligibleVessels, holidayRecord, queueOf } from "./infill.js";
import { ingestFixes, lineCommand, vesselForKey } from "./ingest.js";
import { safeFor } from "./landing.js";
import { lineJson, loadLines } from "./lines.js";
import {
  changeGeofence, createMission, handover, hold, listMissions, missionFor, missionJson, previewPlan, queueInfill,
  reorderQueue, rerun, resume, saveAssignments, transition,
} from "./missions.js";
import { hours, fixed1 } from "./numbers.js";
import { newId } from "./passwords.js";
import type { AlertView, ClientOrgRecord, FixRecord, HolidayRecord, LineRecord, ServiceLogRecord, SessionUser, UserRecord } from "./records.js";
import { kickReports } from "./report.js";
import { status } from "./status.js";
import { loadVessel, loadVessels, overdue, serviceOverdueError, vesselJson } from "./vessels.js";

export const router = new Router();


/** JSON endpoints read (and size-check) the body before the session check. */
async function staffVessel(ctx: Context): Promise<{ user: SessionUser; vesselId: string }> {
  const user = await requireUser(ctx.req);
  if (!(await one(pool, "SELECT 1 FROM vessels WHERE id = $1", [ctx.params.id]))) throw notFound();
  if (!isStaff(user)) throw forbidden();
  return { user, vesselId: ctx.params.id };
}

// Session, user and status

router.on("POST", "/api/session", async (ctx) => {
  const raw = await readJson(ctx.req);
  const input = isRecord(raw) ? raw : {};
  const { user, token, home } = await signIn(input.email, input.password, input.next);
  sendJson(ctx.res, 200, { user: userJson(user), home }, { "Set-Cookie": sessionCookie(token) });
});

router.on("POST", "/api/session/refresh", async (ctx) => {
  await readJson(ctx.req);
  const user = await requireUser(ctx.req);
  await refreshSession(user.token_hash);
  sendEmpty(ctx.res, 204);
});

router.on("DELETE", "/api/session", async (ctx) => {
  await readJson(ctx.req);
  const user = await requireUser(ctx.req);
  await revokeSession(user.token_hash);
  sendEmpty(ctx.res, 204, { "Set-Cookie": clearedCookie });
});

router.on("GET", "/api/me", async (ctx) => sendJson(ctx.res, 200, userJson(await requireUser(ctx.req))));

router.on("PATCH", "/api/me", async (ctx) => {
  const raw = await readJson(ctx.req);
  const user = await requireUser(ctx.req);
  const units = isRecord(raw) ? raw.units : undefined;
  if (units !== "metric" && units !== "imperial") throw invalid({ units: "Choose metric or imperial" });
  await pool.query("UPDATE users SET units = $2 WHERE id = $1", [user.id, units]);
  sendJson(ctx.res, 200, userJson({ ...user, units }));
});

router.on("PUT", "/api/me/last-screen", async (ctx) => {
  const raw = await readJson(ctx.req);
  const user = await requireUser(ctx.req);
  const path = isRecord(raw) ? raw.path : undefined;
  if (!(await safeFor(pool, user, path))) throw invalid({ path: "Send a screen address this role may open" });
  await pool.query("UPDATE users SET last_screen = $2 WHERE id = $1", [user.id, path]);
  sendEmpty(ctx.res, 204);
});

router.on("GET", "/api/status", async (ctx) => {
  await requireUser(ctx.req);
  sendJson(ctx.res, 200, { storage: status.storage, mail: status.mail });
});

router.on("GET", "/api/health", async (ctx) => sendJson(ctx.res, 200, { status: "ok" }));

router.on("GET", "/api/client-orgs", async (ctx) => {
  const user = await requireUser(ctx.req);
  if (!isStaff(user)) throw forbidden();
  sendJson(ctx.res, 200, await rows<ClientOrgRecord>(pool, "SELECT id, name, time_zone FROM client_orgs ORDER BY name"));
});

/** The principal surveyors a mission can be handed to (the hand-over dialog's Surveyor picker). */
router.on("GET", "/api/surveyors", async (ctx) => {
  const user = await requireUser(ctx.req);
  if (!isStaff(user)) throw forbidden();
  sendJson(ctx.res, 200, await rows<Pick<UserRecord, "id" | "name">>(pool, "SELECT id, name FROM users WHERE role = 'principal_surveyor' ORDER BY name"));
});

// Vessels and service

router.on("GET", "/api/vessels", async (ctx) => {
  const user = await requireUser(ctx.req);
  if (!isStaff(user)) throw forbidden();
  sendJson(ctx.res, 200, (await loadVessels(pool)).map(vesselJson));
});

router.on("GET", "/api/vessels/:id", async (ctx) => {
  const { vesselId } = await staffVessel(ctx);
  sendJson(ctx.res, 200, vesselJson(await loadVessel(pool, vesselId)));
});

router.on("GET", "/api/vessels/:id/fixes", async (ctx) => {
  const { vesselId } = await staffVessel(ctx);
  const window = ctx.query.get("window_s");
  if (window !== null && window !== "600") throw invalid({ window_s: "Send window_s as 600" });
  const found = window === null
    ? await rows<FixRecord>(pool, "SELECT * FROM fixes WHERE vessel_id = $1 ORDER BY t DESC LIMIT 20", [vesselId])
    : await rows<FixRecord>(pool, `SELECT * FROM fixes WHERE vessel_id = $1 AND t >= (SELECT max(t) FROM fixes WHERE vessel_id = $1) - interval '600 seconds'
        ORDER BY t DESC`, [vesselId]);
  sendJson(ctx.res, 200, found.map((f) => ({ t: f.t.toISOString(), received_at: f.received_at.toISOString(),
    position: { easting: f.easting, northing: f.northing }, heading_deg: f.heading_deg, speed_mps: f.speed_mps,
    battery_pct: f.battery_pct, depth_m: f.depth_m })));
});

router.on("PATCH", "/api/vessels/:id", async (ctx) => {
  const raw = await readJson(ctx.req);
  const { user, vesselId } = await staffVessel(ctx);
  requireRole(user, "principal_surveyor");
  const input = isRecord(raw) ? raw : {};
  if (!Number.isInteger(input.version)) throw invalid({ version: "Send the vessel version you last read" });
  const vessel = await tx(async (db) => {
    const v = await loadVessel(db, vesselId, true);
    if (input.version !== v.version) throw conflict("stale_version", `${v.name} was changed by someone else. Review the latest values and save again.`, { current: vesselJson(v) });
    const h = input.service_interval_h;
    if (!isNumber(h) || h < 50 || h > 1000 || Math.abs(h * 10 - Math.round(h * 10)) > 1e-9) {
      throw invalid({ service_interval_h: "Service interval must be between 50 and 1000 h" });
    }
    await db.query("UPDATE vessels SET service_interval_h = $2, version = version + 1 WHERE id = $1", [vesselId, h]);
    await evaluateOverdue(db, await loadVessel(db, vesselId));
    return loadVessel(db, vesselId);
  });
  sendJson(ctx.res, 200, vesselJson(vessel));
});

/** Mark afloat or recovered: launch technicians only; a repeat that changes nothing returns 200 unchanged. */
async function markVessel(ctx: Context, afloat: boolean): Promise<void> {
  await readJson(ctx.req);
  const { user, vesselId } = await staffVessel(ctx);
  requireRole(user, "launch_technician");
  const vessel = await tx(async (db) => {
    const v = await loadVessel(db, vesselId, true);
    if (v.afloat === afloat) return v;
    if (afloat && overdue(v)) throw serviceOverdueError(v);
    if (!afloat && v.running_line_id) {
      const line = await only<Pick<LineRecord, "label">>(db, "SELECT label FROM lines WHERE id = $1", [v.running_line_id]);
      throw conflict("line_running", `${v.name} is still running ${line.label}`);
    }
    await db.query("UPDATE vessels SET afloat = $2, version = version + 1 WHERE id = $1", [vesselId, afloat]);
    return loadVessel(db, vesselId);
  });
  sendJson(ctx.res, 200, vesselJson(vessel));
}

router.on("POST", "/api/vessels/:id/afloat", (ctx) => markVessel(ctx, true));
router.on("POST", "/api/vessels/:id/recovered", (ctx) => markVessel(ctx, false));

const serviceJson = (s: ServiceLogRecord) => ({ id: s.id, vessel_id: s.vessel_id, logged_at: s.logged_at.toISOString(),
  logged_by: s.logged_by, hours_at_service: hours(s.hours_at_service), note: s.note });

router.on("POST", "/api/vessels/:id/services", async (ctx) => {
  const raw = await readJson(ctx.req);
  const { user, vesselId } = await staffVessel(ctx);
  const key = headerValue(ctx.req, "Idempotency-Key");
  const outcome = await idempotent(user.id, `services:${vesselId}`, key || undefined,
    fingerprint("POST", `/api/vessels/${vesselId}/services`, raw), async (db) => {
      const v = await loadVessel(db, vesselId, true);
      if (v.afloat) throw conflict("vessel_afloat", `Recover ${v.name} before logging a service`);
      const note = isRecord(raw) && typeof raw.note === "string" ? raw.note : "";
      if (note.length < 1 || note.length > 500) throw invalid({ note: "Enter a service note of up to 500 characters" });
      const entry = await only<ServiceLogRecord>(db,
        "INSERT INTO service_logs (id, vessel_id, logged_at, logged_by, hours_at_service, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [newId("s"), vesselId, new Date(), user.name, v.hours_since_service, note]);
      await db.query("UPDATE vessels SET hours_since_service = 0, version = version + 1 WHERE id = $1", [vesselId]);
      await evaluateOverdue(db, await loadVessel(db, vesselId));
      return { status: 201, body: serviceJson(entry) };
    });
  sendJson(ctx.res, outcome.status, outcome.body);
});

router.on("GET", "/api/vessels/:id/services", async (ctx) => {
  const { vesselId } = await staffVessel(ctx);
  sendJson(ctx.res, 200, (await rows<ServiceLogRecord>(pool, "SELECT * FROM service_logs WHERE vessel_id = $1 ORDER BY logged_at DESC, seq DESC", [vesselId])).map(serviceJson));
});

// Ingest

router.on("POST", "/api/ingest/fixes", async (ctx) => {
  const raw = await readJson(ctx.req);
  const vesselId = await vesselForKey(ctx.req);
  const outcome = await ingestFixes(vesselId, raw);
  sendJson(ctx.res, outcome.status, outcome.body);
});

for (const command of ["start", "end"] as const) {
  router.on("POST", `/api/ingest/lines/:id/${command}`, async (ctx) => {
    await readJson(ctx.req);
    const vesselId = await vesselForKey(ctx.req);
    sendJson(ctx.res, 200, await lineCommand(vesselId, ctx.params.id, command));
  });
}

// Missions

router.on("GET", "/api/missions", async (ctx) => sendJson(ctx.res, 200, await listMissions(await requireUser(ctx.req))));

router.on("POST", "/api/plan-preview", async (ctx) => {
  const raw = await readJson(ctx.req);
  const user = await requireUser(ctx.req);
  requireRole(user, "principal_surveyor");
  sendJson(ctx.res, 200, previewPlan(raw));
});

router.on("POST", "/api/missions", async (ctx) => {
  const raw = await readJson(ctx.req);
  const user = await requireUser(ctx.req);
  const input = isRecord(raw) ? raw : {};
  if (typeof input.client_org_id !== "string" || !(await one(pool, "SELECT 1 FROM client_orgs WHERE id = $1", [input.client_org_id]))) throw notFound();
  requireRole(user, "principal_surveyor");
  const key = headerValue(ctx.req, "Idempotency-Key");
  const outcome = await idempotent(user.id, "missions", key || undefined, fingerprint("POST", "/api/missions", raw),
    async (db) => ({ status: 201, body: await createMission(db, user, input) }));
  sendJson(ctx.res, outcome.status, outcome.body);
});

router.on("GET", "/api/missions/:id", async (ctx) => {
  const user = await requireUser(ctx.req);
  sendJson(ctx.res, 200, await missionJson(pool, await missionFor(pool, user, ctx.params.id), user));
});

router.on("GET", "/api/missions/:id/lines", async (ctx) => {
  const user = await requireUser(ctx.req);
  const m = await missionFor(pool, user, ctx.params.id);
  sendJson(ctx.res, 200, (await loadLines(pool, m.id)).map(lineJson));
});

router.on("POST", "/api/missions/:id/assignments", async (ctx) => {
  const raw = await readJson(ctx.req);
  sendJson(ctx.res, 200, await saveAssignments(await requireUser(ctx.req), ctx.params.id, raw));
});

router.on("POST", "/api/missions/:id/transitions", async (ctx) => {
  const raw = await readJson(ctx.req);
  const { mission, completed } = await transition(await requireUser(ctx.req), ctx.params.id, raw);
  if (completed) kickReports();
  sendJson(ctx.res, 200, mission);
});

router.on("GET", "/api/missions/:id/coverage", async (ctx) => {
  const user = await requireUser(ctx.req);
  const m = await missionFor(pool, user, ctx.params.id);
  const { grid } = computeCoverage(m, await loadLines(pool, m.id), await loadSweeps(pool, m.id));
  const overlap: number[][] = [];
  for (let r = 0; r < grid.rows; r++) overlap.push(grid.overlap.slice(r * grid.cols, (r + 1) * grid.cols));
  sendJson(ctx.res, 200, { cell_size_m: 5, origin: grid.origin, cols: grid.cols, rows: grid.rows, overlap, counters: await counters(pool, m.id) });
});

const csvField = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

function slugOf(name: string, fallback: string): string {
  const slug = name.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

router.on("GET", "/api/missions/:id/coverage.csv", async (ctx) => {
  const user = await requireUser(ctx.req);
  const m = await missionFor(pool, user, ctx.params.id);
  const lines = await loadLines(pool, m.id);
  const out = ["mission,line,kind,vessel,status,length_m,covered_m,coverage_pct"];
  for (const l of lines) {
    const covered = Number(l.covered_m);
    out.push([csvField(m.name), csvField(l.label), l.kind, csvField(l.vessel_name ?? ""), l.status, fixed1(l.length_m), fixed1(covered),
      fixed1(Math.min(100, (covered / l.length_m) * 100))].join(","));
  }
  const body = Buffer.from(out.map((row) => `${row}\r\n`).join(""), "utf8");
  ctx.res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${slugOf(m.name, m.id)}-coverage.csv"`,
    "Content-Length": String(body.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  ctx.res.end(body);
});

router.on("GET", "/api/missions/:id/tracks", async (ctx) => {
  const user = await requireUser(ctx.req);
  const m = await missionFor(pool, user, ctx.params.id);
  const found = await rows<FixRecord & Pick<LineRecord, "label" | "sort_key"> & { line_id: string }>(pool,
    `SELECT f.*, l.label, l.sort_key FROM fixes f JOIN lines l ON l.id = f.line_id WHERE l.mission_id = $1 ORDER BY l.sort_key, f.t`, [m.id]);
  const tracks = new Map<string, { line_id: string; label: string; vessel_id: string; points: unknown[] }>();
  for (const f of found) {
    const track = tracks.get(f.line_id) ?? { line_id: f.line_id, label: f.label, vessel_id: f.vessel_id, points: [] as unknown[] };
    tracks.set(f.line_id, track);
    track.points.push({ t: f.t.toISOString(), easting: f.easting, northing: f.northing, depth_m: f.depth_m, swath_m: f.depth_m * m.swath_ratio });
  }
  sendJson(ctx.res, 200, { tracks: [...tracks.values()] });
});

router.on("GET", "/api/missions/:id/holidays", async (ctx) => {
  const user = await requireUser(ctx.req);
  const m = await missionFor(pool, user, ctx.params.id);
  const found = await rows<HolidayRecord>(pool, "SELECT * FROM holidays WHERE mission_id = $1 ORDER BY label_no", [m.id]);
  const eligible = isStaff(user) ? await eligibleVessels(pool, m.id) : [];
  const out = [];
  for (const h of found) out.push(await holidayRecord(pool, m, h, user, eligible));
  sendJson(ctx.res, 200, out);
});

router.on("POST", "/api/missions/:id/holidays/:hid/infill", async (ctx) => {
  await readJson(ctx.req);
  const outcome = await queueInfill(await requireUser(ctx.req), ctx.params.id, ctx.params.hid);
  sendJson(ctx.res, outcome.status, outcome.body);
});

router.on("GET", "/api/missions/:id/vessels/:vid/infill-order", async (ctx) => {
  const user = await requireUser(ctx.req);
  const m = await missionFor(pool, user, ctx.params.id);
  if (!(await one(pool, "SELECT 1 FROM lines WHERE mission_id = $1 AND vessel_id = $2", [m.id, ctx.params.vid]))) throw notFound();
  if (!isStaff(user)) throw forbidden();
  sendJson(ctx.res, 200, { line_ids: await queueOf(pool, m.id, ctx.params.vid) });
});

router.on("PUT", "/api/missions/:id/vessels/:vid/infill-order", async (ctx) => {
  const raw = await readJson(ctx.req);
  sendJson(ctx.res, 200, { line_ids: await reorderQueue(await requireUser(ctx.req), ctx.params.id, ctx.params.vid, raw) });
});

router.on("GET", "/api/missions/:id/report", async (ctx) => readReport(ctx.res, await requireUser(ctx.req), ctx.params.id));

router.on("GET", "/api/missions/:id/history", async (ctx) => {
  const user = await requireUser(ctx.req);
  const m = await missionFor(pool, user, ctx.params.id);
  if (!isStaff(user)) throw forbidden();
  sendJson(ctx.res, 200, await historyPage(pool, m.id, ctx.query.get("kinds"), ctx.query.get("before")));
});

router.on("POST", "/api/missions/:id/handover", async (ctx) => {
  const raw = await readJson(ctx.req);
  sendJson(ctx.res, 200, await handover(await requireUser(ctx.req), ctx.params.id, raw));
});

router.on("POST", "/api/missions/:id/hold", async (ctx) => {
  const raw = await readJson(ctx.req);
  sendJson(ctx.res, 200, await hold(await requireUser(ctx.req), ctx.params.id, raw));
});

router.on("POST", "/api/missions/:id/resume", async (ctx) => {
  await readJson(ctx.req);
  sendJson(ctx.res, 200, await resume(await requireUser(ctx.req), ctx.params.id));
});

router.on("PUT", "/api/missions/:id/geofence", async (ctx) => {
  const raw = await readJson(ctx.req);
  sendJson(ctx.res, 200, await changeGeofence(await requireUser(ctx.req), ctx.params.id, raw));
});

router.on("POST", "/api/missions/:id/lines/:lid/rerun", async (ctx) => {
  const raw = await readJson(ctx.req);
  sendJson(ctx.res, 201, await rerun(await requireUser(ctx.req), ctx.params.id, ctx.params.lid, raw));
});

router.on("POST", "/api/missions/:id/lines/:lid/flags", async (ctx) => {
  const raw = await readJson(ctx.req);
  sendJson(ctx.res, 201, await flagLine(await requireUser(ctx.req), ctx.params.id, ctx.params.lid, raw));
});

// Line files

router.on("PUT", "/api/lines/:id/file", async (ctx) => {
  const outcome = await uploadWhole(ctx.req, ctx.params.id);
  sendJson(ctx.res, outcome.status, outcome.body);
});

router.on("GET", "/api/lines/:id/file", async (ctx) => downloadLineFile(ctx.res, await requireUser(ctx.req), ctx.params.id));

router.on("POST", "/api/lines/:id/uploads", async (ctx) => {
  const raw = await readJson(ctx.req);
  const outcome = await openUpload(await requireUser(ctx.req), ctx.params.id, raw);
  sendJson(ctx.res, outcome.status, outcome.body);
});

router.on("PUT", "/api/lines/:id/uploads/:uid", async (ctx) => {
  const outcome = await uploadPart(ctx.req, ctx.params.id, ctx.params.uid);
  sendJson(ctx.res, outcome.status, outcome.body);
});

// Alerts

const ALERT_SELECT = "SELECT a.*, v.name AS vessel_name FROM alerts a JOIN vessels v ON v.id = a.vessel_id";

router.on("GET", "/api/alerts", async (ctx) => {
  const user = await requireUser(ctx.req);
  if (!isStaff(user)) throw forbidden();
  const all = ctx.query.get("status") === "all";
  sendJson(ctx.res, 200, (await rows<AlertView>(pool, `${ALERT_SELECT} ${all ? "" : "WHERE a.state <> 'Closed'"} ORDER BY a.raised_at DESC, a.seq DESC`)).map(alertJson));
});

router.on("POST", "/api/alerts/:id/ack", async (ctx) => {
  await readJson(ctx.req);
  const user = await requireUser(ctx.req);
  if (!(await one(pool, "SELECT 1 FROM alerts WHERE id = $1", [ctx.params.id]))) throw notFound();
  if (!isStaff(user)) throw forbidden();
  await tx((db) => acknowledge(db, ctx.params.id, user));
  sendJson(ctx.res, 200, alertJson(await only<AlertView>(pool, `${ALERT_SELECT} WHERE a.id = $1`, [ctx.params.id])));
});

// Flags

router.on("GET", "/api/flags", async (ctx) => {
  const user = await requireUser(ctx.req);
  if (!isStaff(user)) throw forbidden();
  sendJson(ctx.res, 200, await listFlags(ctx.query.get("state")));
});

router.on("POST", "/api/flags/:id/reply", async (ctx) => {
  const raw = await readJson(ctx.req);
  sendJson(ctx.res, 200, await replyToFlag(await requireUser(ctx.req), ctx.params.id, raw));
});

