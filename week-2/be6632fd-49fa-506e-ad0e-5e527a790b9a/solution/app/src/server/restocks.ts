// Weekly restock series (brief: Business rules → Weekly restocks). Occurrence k is the first restock's Copenhagen
// wall-clock time k weeks later, so its UTC instant shifts by an hour across each clock change.
import { COPY, FIELD, gapMessage } from "../shared/copy";
import { WEEKDAYS, dateText, weekdayIndex } from "../shared/format";
import { type Market, type Wall, ZONE, addDays, hhmm, instantText, parseLocal, resolveWall } from "../shared/time";
import { requireRole, staff } from "./auth";
import { type Db, nowSeconds, one, pool, rows } from "./db";
import { checkPieces, staffDrop } from "./drops";
import { ApiError, type Json, reply, route, validationFailed } from "./http";
import { type Fields, failed } from "./validate";

export function occurrence(first: Wall, k: number): number {
  return resolveWall({ ...first, ...addDays(first, 7 * k) }, ZONE.copenhagen).ms;
}

interface SeriesRow {
  id: string;
  first_restock: string;
  pieces: Record<Market, number>;
  applied: number;
}

function seriesJson(series: SeriesRow, nowMs: number): Json {
  const first = parseLocal(series.first_restock) as Wall;
  const next: string[] = [];
  for (let k = 0; next.length < 8; k += 1) {
    const ms = occurrence(first, k);
    if (ms >= nowMs) next.push(instantText(ms));
  }
  return { id: series.id, weekday: WEEKDAYS[weekdayIndex(first)].toLowerCase(), copenhagenTime: hhmm(first), pieces: series.pieces, nextInstants: next };
}

async function seriesOf(db: Db, dropId: string): Promise<SeriesRow[]> {
  return rows<SeriesRow>(db, "SELECT id, first_restock, pieces, applied FROM restock_series WHERE drop_id = $1 ORDER BY created_at", [dropId]);
}

route("GET", "/api/drops/{dropId}/restocks", "none", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "launch_producer", "merchandiser");
  const now = Date.now();
  return reply(200, { items: (await seriesOf(pool, drop.id)).map((s) => seriesJson(s, now)) });
});

route("POST", "/api/drops/{dropId}/restocks", "json", async (ctx) => {
  const me = await staff(ctx);
  const drop = await staffDrop(pool, me, ctx.params.dropId);
  requireRole(me, "launch_producer");
  const body = ctx.json();
  if (drop.status === "withdrawn") throw new ApiError(409, "drop_withdrawn_already", COPY.dropWithdrawnAlready);
  const fields: Fields = {};
  const first = typeof body.firstRestock === "string" ? parseLocal(body.firstRestock) : null;
  if (body.firstRestock === undefined || body.firstRestock === null || body.firstRestock === "") fields.firstRestock = FIELD.required;
  else if (!first) fields.firstRestock = "Enter a date and time like 2027-03-11T18:00.";
  else {
    const resolved = resolveWall(first, ZONE.copenhagen);
    if (resolved.shiftMinutes) fields.firstRestock = gapMessage(dateText(first));
    else if (resolved.ms <= Date.now()) fields.firstRestock = FIELD.notLater;
  }
  const pieces = checkPieces(body.pieces, "pieces", fields);
  if (failed(fields) || !first) throw validationFailed(fields);
  const created = await one<SeriesRow>(
    pool,
    "INSERT INTO restock_series (drop_id, first_restock, pieces, created_at) VALUES ($1, $2, $3, $4) RETURNING id, first_restock, pieces, applied",
    [drop.id, body.firstRestock, JSON.stringify(pieces), nowSeconds()],
  );
  return reply(201, seriesJson(created as SeriesRow, Date.now()));
});
