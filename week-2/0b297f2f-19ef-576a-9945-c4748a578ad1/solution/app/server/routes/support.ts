// Pieces the route modules share: the idempotent-route wrapper, lux recomputation and the hang check.
import type { Db } from "../db.js";
import { read, transaction } from "../db.js";
import { ApiError, validationFailed } from "../errors.js";
import { checkHang } from "../domain/hang.js";
import { luxFigures, openHours } from "../domain/lux.js";
import { Idempotency, LostRace } from "../idempotency.js";
import { exhibition, wallById } from "../model.js";
import type { Ctx, Reply } from "../http.js";

/** Runs an idempotent effect: replays return the stored response; 2xx and 4xx answers are stored. */
export async function idempotent(
  ctx: Ctx,
  routeName: string,
  effect: (idem: Idempotency | null) => Promise<{ status: number; body: unknown }>,
): Promise<Reply> {
  const header = ctx.req.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  const open = () => read((db) => Idempotency.open(db, key, ctx.staff.id, routeName, ctx.path, ctx.body));
  const replay = (stored: { status: number; body: string }): Reply => ({
    status: stored.status,
    raw: stored.body,
    contentType: "application/json; charset=utf-8",
    headers: { "Cache-Control": "no-store" },
  });
  const opened = await open();
  if ("replay" in opened) return replay(opened.replay);
  const idem = opened.idem;
  try {
    const { status, body } = await effect(idem);
    return { status, json: body };
  } catch (error) {
    if (error instanceof LostRace) {
      const again = await open();
      if ("replay" in again) return replay(again.replay);
      again.idem?.assertNoConflict();
    }
    if (idem && error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== "idempotency_conflict") {
      await read((db) => idem.record(db, error.status, JSON.stringify(error.body())));
    }
    throw error;
  }
}

/** A state change made in one transaction under its Idempotency-Key, so a request the network delivers twice
 *  changes things once and both deliveries get the first answer. The change calls `assertNoConflict` after its
 *  404 and 403 checks (brief: API, Error precedence). */
export function idempotentChange(
  ctx: Ctx,
  routeName: string,
  change: (db: Db, idem: Idempotency | null) => Promise<{ status: number; body: unknown }>,
): Promise<Reply> {
  return idempotent(ctx, routeName, (idem) =>
    transaction(async (db) => {
      const answer = await change(db, idem);
      await recordSuccess(db, idem, answer.status, answer.body);
      return answer;
    }),
  );
}

/** Stores the success response in the effect's transaction, or rolls back when a twin won. */
export async function recordSuccess(db: Db, idem: Idempotency | null, status: number, body: unknown): Promise<void> {
  if (idem && !(await idem.record(db, status, JSON.stringify(body)))) throw new LostRace();
}

async function runHours(db: Db): Promise<number> {
  return openHours(await exhibition(db));
}

/** Recomputes planned lux, lux-hours and lux status for the placements a filter selects. */
export async function recomputeLux(db: Db, where: string, params: unknown[]): Promise<void> {
  const hours = await runHours(db);
  const { rows } = await db.query(
    `SELECT p.id, w.planned_lux, o.lux_limit, o.lux_hour_budget FROM placements p
     JOIN walls w ON w.id = p.wall_id JOIN objects o ON o.id = p.object_id WHERE ${where}`,
    params,
  );
  for (const r of rows) {
    const lux = luxFigures(r.planned_lux, hours, r.lux_limit, Number(r.lux_hour_budget));
    await db.query("UPDATE placements SET planned_lux = $2, planned_lux_hours = $3, lux_status = $4 WHERE id = $1", [
      r.id,
      lux.plannedLux,
      lux.plannedLuxHours,
      lux.luxStatus,
    ]);
  }
}

export interface Position {
  wallId: string;
  offsetMm: number;
  centreHeightMm: number;
  heightOverride: boolean;
}

/** The hang rules against the wall (locked, so placements on one wall are decided one at a time). */
export async function assertHangs(
  db: Db,
  position: Position,
  work: { widthMm: number; heightMm: number; luxLimit: number },
  placementId: string | null,
): Promise<void> {
  const wall = await wallById(db, position.wallId, true);
  if (!wall) throw validationFailed({ wallId: "Choose a wall." });
  const { rows } = await db.query(
    `SELECT o.title, p.offset_mm, o.width_mm FROM placements p JOIN objects o ON o.id = p.object_id
     WHERE p.wall_id = $1 AND p.status <> 'removed' AND p.id <> $2`,
    [position.wallId, placementId ?? ""],
  );
  const rejection = checkHang(
    { ...work, offsetMm: position.offsetMm, centreHeightMm: position.centreHeightMm, heightOverride: position.heightOverride },
    wall,
    rows.map((r) => ({ title: r.title, offsetMm: r.offset_mm, widthMm: r.width_mm })),
  );
  if (rejection) throw new ApiError(422, "placement_rejected", rejection.message, { reason: rejection.reason });
}

export const WHOLE_MM = "Enter a whole number of millimetres.";

export function isWhole(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
