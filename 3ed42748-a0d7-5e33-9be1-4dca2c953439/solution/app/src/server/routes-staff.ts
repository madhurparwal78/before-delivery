// Staff endpoints: the moderation drawer (helpers and the founder) and the founder console.
import { today } from "./board";
import { pool, tx } from "./db";
import { conflict, notFound, validation } from "./errors";
import { json, publishedBody, route } from "./http";
import {
  allMissions,
  checkRevision,
  createMission,
  editMission,
  etag,
  founderView,
  loadMission,
  MISSION_SPEC,
  missionFieldReasons,
  missionForChange,
  promoteDue,
  requireMove,
  retireMission,
  scheduleInstant,
  scheduleMission,
  unscheduleMission,
  type Mission,
} from "./missions";
import { auditEntries, moderate, requireModeratable, targetOf, type ModerationAction } from "./moderation";
import { onlineNow, staffPresenceFor } from "./presence";
import { requireFounder, requireSession, requireStaff } from "./sessions";
import { isAcceptedZone } from "./studio";

// ---- moderation ----

route(
  "GET",
  "/api/moderation/audit",
  "none",
  async (ctx) => {
    const s = await requireSession(ctx, pool);
    requireStaff(s.courier);
    return json(200, await auditEntries(pool));
  },
  false,
);

route(
  "GET",
  "/api/moderation/audit/:rest*",
  "none",
  async () => {
    throw notFound();
  },
  false,
);

route("GET", "/api/moderation/presence", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  requireStaff(s.courier);
  return json(200, await staffPresenceFor(pool, s.courier.id));
});

for (const action of ["mute", "unmute", "rename"] as ModerationAction[]) {
  route("POST", `/api/moderation/:ref/${action}`, "json", async (ctx) => {
    const s = await requireSession(ctx, pool);
    const target = await targetOf(pool, ctx.params.ref!);
    requireStaff(s.courier);
    requireModeratable(target);
    const reply = await tx((db) => moderate(db, s.courier, ctx.params.ref!, action, () => publishedBody(ctx, {})));
    return json(200, reply);
  });
}

// ---- founder: missions ----

const one = (m: Mission, status = 200) => json(status, founderView(m), etag(m));

route("GET", "/api/founder/missions", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  requireFounder(s.courier);
  await promoteDue();
  return json(200, { missions: (await allMissions(pool)).map(founderView) });
});

route("POST", "/api/founder/missions", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  requireFounder(s.courier);
  const body = publishedBody(ctx, MISSION_SPEC);
  const fields = missionFieldReasons(body);
  if (Object.keys(fields).length) throw validation(fields);
  return one(await tx((db) => createMission(db, body)), 201);
});

route("GET", "/api/founder/missions/:mission_id", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  await promoteDue();
  const m = await loadMission(pool, ctx.params.mission_id!);
  if (!m) throw notFound();
  requireFounder(s.courier);
  return one(m);
});

route("PATCH", "/api/founder/missions/:mission_id", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  await promoteDue();
  return tx(async (db) => {
    const m = await missionForChange(db, ctx.params.mission_id!);
    requireFounder(s.courier);
    checkRevision(ctx, m);
    if (m.status === "retired") throw conflict("mission_retired");
    const body = publishedBody(ctx, MISSION_SPEC);
    const fields = missionFieldReasons(body, m.kind);
    if (Object.keys(fields).length) throw validation(fields);
    return one(await editMission(db, m, body));
  });
});

route("POST", "/api/founder/missions/:mission_id/schedule", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  await promoteDue();
  return tx(async (db) => {
    const m = await missionForChange(db, ctx.params.mission_id!);
    requireFounder(s.courier);
    checkRevision(ctx, m);
    requireMove(m, "draft");
    const at = await scheduleInstant(db, publishedBody(ctx, { live_at: true, live_at_local: true }));
    return one(await scheduleMission(db, m, at));
  });
});

route("POST", "/api/founder/missions/:mission_id/unschedule", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  await promoteDue();
  return tx(async (db) => {
    const m = await missionForChange(db, ctx.params.mission_id!);
    requireFounder(s.courier);
    checkRevision(ctx, m);
    requireMove(m, "scheduled");
    publishedBody(ctx, {});
    return one(await unscheduleMission(db, m));
  });
});

route("POST", "/api/founder/missions/:mission_id/retire", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  await promoteDue();
  return tx(async (db) => {
    const m = await missionForChange(db, ctx.params.mission_id!);
    requireFounder(s.courier);
    checkRevision(ctx, m);
    requireMove(m, "live");
    publishedBody(ctx, {});
    return one(await retireMission(db, m));
  });
});

// ---- founder: studio and Online now ----

route("GET", "/api/founder/studio", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  requireFounder(s.courier);
  const { date, zone } = await today(pool);
  return json(200, { time_zone: zone, board_date: date });
});

route("PATCH", "/api/founder/studio", "json", async (ctx) => {
  const s = await requireSession(ctx, pool);
  requireFounder(s.courier);
  const body = publishedBody(ctx, { time_zone: true });
  if (!isAcceptedZone(body.time_zone)) throw validation({ time_zone: "time_zone" in body ? "invalid" : "required" });
  await pool.query("UPDATE app_settings SET time_zone = $1 WHERE id = 1", [body.time_zone]);
  const { date, zone } = await today(pool);
  return json(200, { time_zone: zone, board_date: date });
});

route("GET", "/api/founder/online", "none", async (ctx) => {
  const s = await requireSession(ctx, pool);
  requireFounder(s.courier);
  return json(200, await onlineNow(pool));
});
