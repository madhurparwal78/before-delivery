import { randomUUID } from "node:crypto";
import { read, type Db } from "../db.js";
import { ApiError, forbidden, notFound, validationFailed } from "../errors.js";
import { writeEvent } from "../events.js";
import { isLocked, nextStatus, type PlacementStatus } from "../domain/lifecycle.js";
import { undoOpen, undoUntil, undoView } from "../domain/undo.js";
import { json, jsonBody, route, type Ctx, type Route } from "../http.js";
import { placementById, placementsWhere, requireRole, type Placement, type Staff } from "../model.js";
import { assertHangs, idempotentChange, isWhole, recomputeLux, WHOLE_MM, type Position } from "./support.js";

const illegal = () => new ApiError(409, "illegal_transition", "That step isn't possible from the work's current status.");

function moveFields(b: Record<string, unknown>, keys: (keyof Position)[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of keys) {
    const value = b[key];
    if (value === undefined) continue;
    if ((key === "offsetMm" || key === "centreHeightMm") && !isWhole(value)) fields[key] = WHOLE_MM;
    if (key === "heightOverride" && typeof value !== "boolean") fields[key] = "Choose whether the work is off the centre line.";
    if (key === "wallId" && typeof value !== "string") fields[key] = "Choose a wall.";
  }
  return fields;
}

async function placeWork(ctx: Ctx) {
  return idempotentChange(ctx, "POST /api/placements", async (db, idem) => {
    requireRole(ctx.staff, "curator");
    idem?.assertNoConflict();
    const b = jsonBody(ctx);
    const object =
      typeof b.objectId === "string"
        ? (await db.query("SELECT id, title, width_mm, height_mm, lux_limit FROM objects WHERE id = $1 FOR UPDATE", [b.objectId])).rows[0]
        : undefined;
    if (object) {
      const live = await db.query("SELECT 1 FROM placements WHERE object_id = $1 AND status <> 'removed'", [object.id]);
      if (live.rowCount) throw new ApiError(409, "already_placed", "That work is already on a wall.");
    }
    const fields = moveFields(b, ["wallId", "offsetMm", "centreHeightMm", "heightOverride"]);
    if (!object) fields.objectId = "Choose a work to place.";
    for (const key of ["wallId", "offsetMm", "centreHeightMm", "heightOverride"] as const) {
      if (b[key] === undefined) fields[key] = key === "wallId" ? "Choose a wall." : key === "heightOverride" ? "Choose whether the work is off the centre line." : WHOLE_MM;
    }
    if (Object.keys(fields).length) throw validationFailed(fields);
    const position: Position = {
      wallId: b.wallId as string,
      offsetMm: b.offsetMm as number,
      centreHeightMm: b.centreHeightMm as number,
      heightOverride: b.heightOverride as boolean,
    };
    await assertHangs(db, position, { widthMm: object.width_mm, heightMm: object.height_mm, luxLimit: object.lux_limit }, null);
    const id = randomUUID();
    await db.query(
      `INSERT INTO placements (id, object_id, wall_id, offset_mm, centre_height_mm, height_override, status, version,
         planned_lux, planned_lux_hours, lux_status) VALUES ($1,$2,$3,$4,$5,$6,'proposed',1,0,0,'within')`,
      [id, object.id, position.wallId, position.offsetMm, position.centreHeightMm, position.heightOverride],
    );
    await recomputeLux(db, "p.id = $1", [id]);
    const placed = await placementById(db, id);
    const seq = await writeEvent(db, "placement.placed", ctx.staff, eventFields(placed));
    return { status: 201, body: { placement: placed, seq } };
  });
}

function eventFields(p: Placement) {
  return { placementId: p.id, objectId: p.objectId, wallId: p.wallId, title: p.objectTitle, wallName: p.wallName };
}

/** Who may move a placement (brief: Business rules, Who may move a placement). */
function assertMayMove(staff: Staff, p: Placement, wallId: unknown): void {
  if (staff.role === "registrar") throw forbidden();
  if (isLocked(p.status)) throw new ApiError(409, "placement_locked", "This work is hung or removed and can't be moved.");
  if (staff.role === "curator" && p.status !== "proposed") throw forbidden();
  if (staff.role === "preparator") {
    if (p.status !== "claimed" || p.claimedBy?.id !== staff.id) throw forbidden();
    if (wallId !== undefined && wallId !== p.wallId) throw forbidden();
  }
}

/** Where a placement stood before a removal or move: an undo_actions row's previous column. */
type UndoPrevious = Position & { status: PlacementStatus };

/** An undo_actions row, typed by the schema's columns and checks. */
interface UndoActionRow {
  id: string;
  placement_id: string;
  staff_id: string;
  kind: "remove" | "move";
  previous: UndoPrevious;
  result_version: number;
  undo_until: Date;
  undone: boolean;
}

async function recordUndo(db: Db, staff: Staff, p: Placement, kind: "remove" | "move", resultVersion: number) {
  const now = new Date();
  const until = undoUntil(now);
  const id = randomUUID();
  const previous: UndoPrevious = {
    wallId: p.wallId,
    offsetMm: p.offsetMm,
    centreHeightMm: p.centreHeightMm,
    heightOverride: p.heightOverride,
    status: p.status,
  };
  await db.query(
    "INSERT INTO undo_actions (id, placement_id, staff_id, kind, previous, result_version, undo_until) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, p.id, staff.id, kind, JSON.stringify(previous), resultVersion, until],
  );
  return undoView(id, kind, until, new Date());
}

async function movePlacement(ctx: Ctx) {
  return idempotentChange(ctx, "PATCH /api/placements/{id}", async (db, idem) => {
    const p = await placementById(db, ctx.params.id, true);
    let b: Record<string, unknown> = {};
    let malformed: ApiError | null = null;
    try {
      b = jsonBody(ctx);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      malformed = error;
    }
    assertMayMove(ctx.staff, p, b.wallId);
    idem?.assertNoConflict();
    if (malformed) throw malformed;
    if (!isWhole(b.version)) throw validationFailed({ version: "Send the placement version you last saw." });
    if (b.version !== p.version) {
      throw new ApiError(412, "stale_version", "Someone else changed this placement.", { placement: p });
    }
    const fields = moveFields(b, ["wallId", "offsetMm", "centreHeightMm", "heightOverride"]);
    if (Object.keys(fields).length) throw validationFailed(fields);
    const next: Position = {
      wallId: (b.wallId as string | undefined) ?? p.wallId,
      offsetMm: (b.offsetMm as number | undefined) ?? p.offsetMm,
      centreHeightMm: (b.centreHeightMm as number | undefined) ?? p.centreHeightMm,
      heightOverride: (b.heightOverride as boolean | undefined) ?? p.heightOverride,
    };
    await assertHangs(db, next, p, p.id);
    await db.query(
      `UPDATE placements SET wall_id = $2, offset_mm = $3, centre_height_mm = $4, height_override = $5, version = version + 1
       WHERE id = $1`,
      [p.id, next.wallId, next.offsetMm, next.centreHeightMm, next.heightOverride],
    );
    await recomputeLux(db, "p.id = $1", [p.id]);
    const undo = await recordUndo(db, ctx.staff, p, "move", p.version + 1);
    const moved = await placementById(db, p.id);
    const seq = await writeEvent(db, "placement.moved", ctx.staff, { ...eventFields(moved), offsetMm: moved.offsetMm });
    return { status: 200, body: { placement: moved, undo, seq } };
  });
}

async function removePlacement(ctx: Ctx) {
  return idempotentChange(ctx, "DELETE /api/placements/{id}", async (db, idem) => {
    const p = await placementById(db, ctx.params.id, true);
    requireRole(ctx.staff, "curator");
    idem?.assertNoConflict();
    const status = nextStatus("remove", p.status);
    if (!status) throw illegal();
    await db.query("UPDATE placements SET status = $2, version = version + 1 WHERE id = $1", [p.id, status]);
    const undo = await recordUndo(db, ctx.staff, p, "remove", p.version + 1);
    const removed = await placementById(db, p.id);
    const seq = await writeEvent(db, "placement.removed", ctx.staff, eventFields(removed));
    return { status: 200, body: { placement: removed, undo, seq } };
  });
}

async function undoAction(ctx: Ctx) {
  return idempotentChange(ctx, "POST /api/undo/{actionId}", async (db, idem) => {
    const { rows } = await db.query<UndoActionRow>("SELECT * FROM undo_actions WHERE id = $1 FOR UPDATE", [
      ctx.params.actionId,
    ]);
    const action = rows[0];
    if (!action) throw notFound();
    if (action.staff_id !== ctx.staff.id) throw forbidden();
    idem?.assertNoConflict();
    if (action.undone) throw new ApiError(409, "already_undone", "That change has already been undone.");
    if (!undoOpen(action.undo_until, new Date())) {
      throw new ApiError(410, "undo_expired", "Too late to undo: the 10-second window has closed.");
    }
    const p = await placementById(db, action.placement_id, true);
    const conflict = () => new ApiError(409, "undo_conflict", `Can't undo: ${p.objectTitle} has changed since.`);
    if (p.version !== action.result_version) throw conflict();
    const { previous } = action;
    if (action.kind === "remove") {
      const status = nextStatus("restore", p.status);
      if (!status) throw conflict();
      const live = await db.query("SELECT 1 FROM placements WHERE object_id = $1 AND status <> 'removed'", [p.objectId]);
      if (live.rowCount) throw conflict();
    }
    await assertHangs(db, previous, p, p.id);
    await db.query(
      `UPDATE placements SET wall_id = $2, offset_mm = $3, centre_height_mm = $4, height_override = $5, status = $6,
         version = version + 1 WHERE id = $1`,
      [p.id, previous.wallId, previous.offsetMm, previous.centreHeightMm, previous.heightOverride, previous.status],
    );
    await db.query("UPDATE undo_actions SET undone = true WHERE id = $1", [action.id]);
    await recomputeLux(db, "p.id = $1", [p.id]);
    const restored = await placementById(db, p.id);
    const seq =
      action.kind === "remove"
        ? await writeEvent(db, "placement.restored", ctx.staff, eventFields(restored))
        : await writeEvent(db, "placement.moved", ctx.staff, { ...eventFields(restored), offsetMm: restored.offsetMm });
    return { status: 200, body: { placement: restored, seq } };
  });
}

async function claim(ctx: Ctx) {
  return idempotentChange(ctx, "POST /api/placements/{id}/claim", async (db, idem) => {
    const p = await placementById(db, ctx.params.id, true);
    requireRole(ctx.staff, "preparator");
    idem?.assertNoConflict();
    if (p.status === "claimed" && p.claimedBy?.id === ctx.staff.id) {
      const { rows } = await db.query(
        "SELECT max(seq) AS seq FROM events WHERE placement_id = $1 AND kind = 'placement.claimed'",
        [p.id],
      );
      return { status: 200, body: { placement: p, seq: Number(rows[0].seq) } };
    }
    if (p.status === "claimed" && p.claimedBy) {
      throw new ApiError(409, "already_claimed", `${p.claimedBy.name} claimed ${p.objectTitle} first.`, { claimedBy: p.claimedBy });
    }
    if (!nextStatus("claim", p.status)) throw illegal();
    await db.query("UPDATE placements SET status = 'claimed', claimed_by = $2, version = version + 1 WHERE id = $1", [
      p.id,
      ctx.staff.id,
    ]);
    const claimed = await placementById(db, p.id);
    const seq = await writeEvent(db, "placement.claimed", ctx.staff, eventFields(claimed));
    return { status: 200, body: { placement: claimed, seq } };
  });
}

const HOLDER_STEPS = {
  release: { kind: "placement.released", clearsHolder: true },
  hang: { kind: "placement.hung", clearsHolder: false },
} as const;

async function holderStep(ctx: Ctx, action: keyof typeof HOLDER_STEPS) {
  return idempotentChange(ctx, `POST /api/placements/{id}/${action}`, async (db, idem) => {
    const p = await placementById(db, ctx.params.id, true);
    if (ctx.staff.role !== "preparator" || (p.claimedBy && p.claimedBy.id !== ctx.staff.id)) throw forbidden();
    idem?.assertNoConflict();
    const status = nextStatus(action, p.status);
    if (!status) throw illegal();
    const step = HOLDER_STEPS[action];
    await db.query(
      `UPDATE placements SET status = $2, version = version + 1${step.clearsHolder ? ", claimed_by = NULL" : ""} WHERE id = $1`,
      [p.id, status],
    );
    const changed = await placementById(db, p.id);
    const seq = await writeEvent(db, step.kind, ctx.staff, eventFields(changed));
    return { status: 200, body: { placement: changed, seq } };
  });
}

async function signOff(ctx: Ctx) {
  return idempotentChange(ctx, "POST /api/placements/{id}/sign-off", async (db, idem) => {
    const p = await placementById(db, ctx.params.id, true);
    requireRole(ctx.staff, "registrar");
    idem?.assertNoConflict();
    const status = nextStatus("sign-off", p.status);
    if (!status) throw illegal();
    const photos = await db.query("SELECT 1 FROM photos WHERE object_id = $1 LIMIT 1", [p.objectId]);
    if (!photos.rowCount) {
      throw new ApiError(409, "condition_not_recorded", `Add a condition photo before signing off ${p.objectTitle}.`);
    }
    if (p.luxStatus === "over") {
      throw new ApiError(409, "over_budget", `${p.objectTitle} is over its light budget and can't be signed off.`);
    }
    await db.query("UPDATE placements SET status = $2, version = version + 1 WHERE id = $1", [p.id, status]);
    const signed = await placementById(db, p.id);
    const seq = await writeEvent(db, "placement.signed_off", ctx.staff, eventFields(signed));
    return { status: 200, body: { placement: signed, seq } };
  });
}

async function listPlacements() {
  return read(async (db) => {
    const placements = await placementsWhere(db, "p.status <> 'removed'");
    return json(200, { placements, overBudgetCount: placements.filter((p) => p.luxStatus === "over").length });
  });
}

export const placementRoutes: Route[] = [
  route("GET", "/api/placements", listPlacements),
  route("POST", "/api/placements", placeWork),
  route("PATCH", "/api/placements/:id", movePlacement),
  route("DELETE", "/api/placements/:id", removePlacement),
  route("POST", "/api/undo/:actionId", undoAction),
  route("POST", "/api/placements/:id/claim", claim),
  route("POST", "/api/placements/:id/release", (ctx) => holderStep(ctx, "release")),
  route("POST", "/api/placements/:id/hang", (ctx) => holderStep(ctx, "hang")),
  route("POST", "/api/placements/:id/sign-off", signOff),
];
