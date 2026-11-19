import { one, tx } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { FLAWS, HIDE_AREA_SQ_FT, HIDE_HEIGHT_CM, HIDE_WIDTH_CM, isPartName, PART_NAMES, partBox, type Placement, placementRefusal, rotationRefusal, usedFigure } from "../domain/placement.ts";
import { instant, timeCopy } from "../domain/time.ts";
import { invalid, notFound, stale } from "../http/errors.ts";
import { type Ctx, json, route } from "../http/router.ts";
import { bodyOf, type Body } from "./fields.ts";
import { pieceOf, pieceResource } from "./resources.ts";

interface LayoutRow {
  version: number;
  placements: Placement[];
  changed_at: Date;
}

function layoutBody(row: LayoutRow) {
  return {
    layout: {
      version: row.version,
      hide: { widthCm: HIDE_WIDTH_CM, heightCm: HIDE_HEIGHT_CM, areaSqFt: HIDE_AREA_SQ_FT },
      flaws: FLAWS,
      pieces: PART_NAMES.map((name) => {
        const placed = row.placements.find((placement) => placement.name === name);
        const { width, height } = partBox(placed ?? { name, x: 0, y: 0, rotation: 0 });
        return placed
          ? { name, width, height, x: placed.x, y: placed.y, rotation: placed.rotation, state: "placed" }
          : { name, width, height, x: null, y: null, rotation: 0, state: "tray" };
      }),
      ...usedFigure(row.placements),
      changedAt: instant(row.changed_at),
    },
  };
}

function numberField(body: Body, field: string): number {
  const value = body[field];
  if (typeof value !== "number") throw invalid(field, copy("F-112"));
  return value;
}

function readPlacement(body: Body, name: Placement["name"]): Placement {
  const placement = { name, x: numberField(body, "x"), y: numberField(body, "y"), rotation: numberField(body, "rotation") };
  const refusal = rotationRefusal(name, placement.rotation);
  if (refusal) throw invalid("rotation", refusal);
  return placement;
}

function checkPlacement(placement: Placement, others: readonly Placement[]): void {
  const refusal = placementRefusal(placement, others);
  if (refusal) throw invalid("x", refusal);
}

/** Decides and writes one change on the locked row: 422 refusals from `next`, then 412 on an old version, then the raised version. */
async function changeLayout(pieceId: string, version: number, next: (current: LayoutRow) => Placement[]) {
  return tx(async (client) => {
    const current = (await one<LayoutRow>("SELECT version, placements, changed_at FROM layouts WHERE piece_id = $1 FOR UPDATE", [pieceId], client)) as LayoutRow;
    const placements = next(current);
    if (version !== current.version) throw stale("staleLayout", copy("F-51", { time: timeCopy(current.changed_at) }));
    const saved = (await one<LayoutRow>(
      "UPDATE layouts SET version = version + 1, placements = $2, changed_at = now() WHERE piece_id = $1 RETURNING version, placements, changed_at",
      [pieceId, JSON.stringify(placements)],
      client,
    )) as LayoutRow;
    return json(200, layoutBody(saved));
  });
}

function partOf(ctx: Ctx): Placement["name"] {
  return ctx.params.name as Placement["name"];
}

async function partResource(ctx: Ctx): Promise<void> {
  await pieceResource(ctx);
  if (!isPartName(ctx.params.name as string)) throw notFound();
}

function replaceAll(ctx: Ctx) {
  const body = bodyOf(ctx);
  const version = numberField(body, "version");
  const listed = body.placements;
  if (!Array.isArray(listed)) throw invalid("placements", copy("F-04"));
  const placements = listed.map((entry: unknown) => {
    const fields = (typeof entry === "object" && entry !== null ? entry : {}) as Body;
    const name = String(fields.name);
    if (!isPartName(name)) throw invalid("placements", copy("F-08"));
    return readPlacement(fields, name);
  });
  if (new Set(placements.map((placement) => placement.name)).size !== placements.length) throw invalid("placements", copy("F-08"));
  return changeLayout(pieceOf(ctx).id, version, () => {
    placements.forEach((placement, index) => checkPlacement(placement, placements.slice(0, index)));
    return placements;
  });
}

function placeOne(ctx: Ctx) {
  const body = bodyOf(ctx);
  const placement = readPlacement(body, partOf(ctx));
  const version = numberField(body, "version");
  return changeLayout(pieceOf(ctx).id, version, (current) => {
    const others = current.placements.filter((other) => other.name !== placement.name);
    checkPlacement(placement, others);
    return [...others, placement];
  });
}

function sendToTray(ctx: Ctx) {
  const version = ctx.query.get("version");
  if (version === null || !/^\d+$/.test(version)) throw invalid("version", copy("F-112"));
  return changeLayout(pieceOf(ctx).id, Number(version), (current) => current.placements.filter((other) => other.name !== partOf(ctx)));
}

export function register(): void {
  route({
    method: "GET",
    pattern: "/api/pieces/:id/layout",
    resource: pieceResource,
    handle: async (ctx) => {
      const row = await one<LayoutRow>("SELECT version, placements, changed_at FROM layouts WHERE piece_id = $1", [pieceOf(ctx).id]);
      return json(200, layoutBody(row as LayoutRow));
    },
  });
  route({ method: "POST", pattern: "/api/pieces/:id/layout", resource: pieceResource, handle: async (ctx) => replaceAll(ctx) });
  route({ method: "PUT", pattern: "/api/pieces/:id/layout/placements/:name", resource: partResource, handle: async (ctx) => placeOne(ctx) });
  route({ method: "DELETE", pattern: "/api/pieces/:id/layout/placements/:name", resource: partResource, handle: async (ctx) => sendToTray(ctx) });
}
