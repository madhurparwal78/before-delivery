import { read } from "../db.js";
import { notFound, validationFailed } from "../errors.js";
import { eventsAfter, latestSeq, writeEvent } from "../events.js";
import { json, jsonBody, route, type Ctx, type Route } from "../http.js";
import { exhibition, exhibitionView, placementsWhere, requireRole, wallById, walls } from "../model.js";
import { idempotentChange, isWhole, recomputeLux } from "./support.js";

async function exhibitionRoute() {
  return read(async (db) => {
    const ex = await exhibition(db);
    const gallery = (await db.query("SELECT id, name FROM galleries WHERE exhibition_id = $1", [ex.id])).rows[0];
    const lenders = (await db.query("SELECT id, name, email FROM lenders ORDER BY position")).rows;
    return json(200, {
      exhibition: exhibitionView(ex),
      gallery: { id: gallery.id, name: gallery.name, walls: await walls(db) },
      lenders,
    });
  });
}

async function setWallLux(ctx: Ctx) {
  return idempotentChange(ctx, "PATCH /api/walls/{id}", async (db, idem) => {
    const wall = await wallById(db, ctx.params.id, true);
    if (!wall) throw notFound();
    requireRole(ctx.staff, "curator");
    idem?.assertNoConflict();
    const b = jsonBody(ctx);
    if (!isWhole(b.plannedLux) || b.plannedLux < 1 || b.plannedLux > 1000) {
      throw validationFailed({ plannedLux: "Enter a lux level from 1 to 1000." });
    }
    await db.query("UPDATE walls SET planned_lux = $2 WHERE id = $1", [wall.id, b.plannedLux]);
    await recomputeLux(db, "p.wall_id = $1 AND p.status <> 'removed'", [wall.id]);
    const updated = { ...wall, plannedLux: b.plannedLux };
    const placements = await placementsWhere(db, "p.wall_id = $1 AND p.status <> 'removed'", [wall.id]);
    const seq = await writeEvent(db, "wall.lux_changed", ctx.staff, {
      wallId: wall.id,
      wallName: wall.name,
      plannedLux: updated.plannedLux,
    });
    return { status: 200, body: { wall: updated, placements, seq } };
  });
}

async function events(ctx: Ctx) {
  const after = ctx.query.get("after");
  if (after !== null && !/^\d+$/.test(after)) throw validationFailed({ after: "Use a whole number of 0 or more." });
  if (after === null) return read(async (db) => json(200, { events: [], latestSeq: await latestSeq(db) }));
  // A seq past any the database can hold has no events after it.
  const from = Math.min(Number(after), Number.MAX_SAFE_INTEGER);
  return read(async (db) => json(200, { events: await eventsAfter(db, from), latestSeq: await latestSeq(db) }));
}

export const galleryRoutes: Route[] = [
  route("GET", "/api/staff", () =>
    read(async (db) => json(200, { staff: (await db.query("SELECT id, name, role FROM staff ORDER BY position")).rows })),
    false,
  ),
  route("GET", "/api/exhibition", exhibitionRoute),
  route("PATCH", "/api/walls/:id", setWallLux),
  route("GET", "/api/events", events),
];
