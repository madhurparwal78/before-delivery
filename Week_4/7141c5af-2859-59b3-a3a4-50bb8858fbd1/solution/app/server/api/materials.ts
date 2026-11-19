import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { one, query, tx } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { fractionDigits } from "../domain/decimal.ts";
import { fabricLotRefusal, type FabricLot, isLeatherLot, isPositive, type LeatherLot, leatherLotRefusal, type Lot, metresFigure, withinAmountRange } from "../domain/estimate.ts";
import { decideHold, type HeldLot, holdEndsOn, holdLabel, type HoldQuantity, isLive } from "../domain/holds.ts";
import { minuteCopy } from "../domain/time.ts";
import { conflict, invalid, notFound, tooMany, unavailable } from "../http/errors.ts";
import { type Ctx, json, route } from "../http/router.ts";
import { ProviderDown } from "../providers/call.ts";
import { addEntries, entryOfMaterial } from "../providers/meili.ts";
import { placeHold, readCatalogue, readLots, SupplierBusy, type SupplierMaterial } from "../providers/supplier.ts";
import { bodyOf, decimalField, requiredText } from "./fields.ts";
import { pieceOf, pieceResource } from "./resources.ts";

type MaterialRow = SupplierMaterial;

const MATERIAL_COLUMNS = "code, name, family, unit, prices";

export async function findMaterial(deskId: string, code: string): Promise<MaterialRow | null> {
  return one<MaterialRow>(`SELECT ${MATERIAL_COLUMNS} FROM materials WHERE desk_id = $1 AND code = $2`, [deskId, code]);
}

/** Turns a supplier failure into the published answer. */
function supplierRefusal(error: unknown): unknown {
  if (error instanceof SupplierBusy) return tooMany("supplierBusy", copy("F-35", { minute: minuteCopy(error.until) }), error.until);
  if (error instanceof ProviderDown) return unavailable("supplierDown", copy("F-36"));
  return error;
}

/** The one stock read: at most one supplier call per code within STOCK_CACHE_SECONDS, and a failed read is not kept. */
export async function stockOf(code: string): Promise<Lot[]> {
  const fresh = "SELECT lots FROM stock_reads WHERE code = $1 AND read_at + make_interval(secs => $2) > now()";
  const cached = await one<{ lots: Lot[] }>(fresh, [code, config.stockCacheSeconds]);
  if (cached) return cached.lots;
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`stock:${code}`]);
    const raced = await one<{ lots: Lot[] }>(fresh, [code, config.stockCacheSeconds], client);
    if (raced) return raced.lots;
    const lots = await readLots(code).catch((error: unknown) => {
      throw supplierRefusal(error);
    });
    await client.query(
      `INSERT INTO stock_reads (code, lots, read_at) VALUES ($1, $2, now())
       ON CONFLICT (code) DO UPDATE SET lots = EXCLUDED.lots, read_at = EXCLUDED.read_at`,
      [code, JSON.stringify(lots)],
    );
    return lots;
  });
}

async function refreshLibrary(deskId: string): Promise<number> {
  const catalogue = await readCatalogue().catch(() => {
    throw unavailable("supplierDown", copy("F-29"));
  });
  await addEntries(catalogue.map((material) => entryOfMaterial(deskId, material))).catch(() => {
    throw unavailable("searchDown", copy("F-30"));
  });
  await tx(async (client) => {
    await client.query("DELETE FROM materials WHERE desk_id = $1", [deskId]);
    for (const [position, material] of catalogue.entries()) {
      await client.query(
        "INSERT INTO materials (desk_id, code, name, family, unit, prices, position) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [deskId, material.code, material.name, material.family, material.unit, JSON.stringify(material.prices), position],
      );
    }
  });
  return catalogue.length;
}

interface HoldRow {
  id: string;
  hold_id: string;
  code: string;
  lot: string;
  quantity: string;
  ends_on: string;
}

function quantityOf(text: string): HoldQuantity {
  return text.includes(".") ? text : Number(text);
}

function heldLot(row: HoldRow): HeldLot & { id: string; holdId: string } {
  return { id: row.id, holdId: row.hold_id, code: row.code, lot: row.lot, quantity: quantityOf(row.quantity), endsOn: row.ends_on };
}

function holdBody(hold: ReturnType<typeof heldLot>) {
  return {
    id: hold.id,
    holdId: hold.holdId,
    code: hold.code,
    lot: hold.lot,
    quantity: hold.quantity,
    state: isLive(hold.endsOn) ? "held" : "ended",
    endsOn: hold.endsOn,
    label: holdLabel(hold.endsOn),
  };
}

async function holdsOfPiece(pieceId: string): Promise<ReturnType<typeof holdBody>[]> {
  const rows = await query<HoldRow>("SELECT id, hold_id, code, lot, quantity, ends_on FROM holds WHERE piece_id = $1 ORDER BY ends_on DESC, id", [pieceId]);
  return rows.map((row) => holdBody(heldLot(row)));
}

function readQuantity(ctx: Ctx, unit: MaterialRow["unit"]): HoldQuantity {
  const text = decimalField(bodyOf(ctx), "quantity");
  const refused = invalid("quantity", copy("F-08"));
  if (!isPositive(text) || !withinAmountRange(text)) throw refused;
  if (unit === "metre") {
    if (fractionDigits(text) > 2) throw refused;
    return metresFigure(text);
  }
  if (!/^\d+(?:\.0+)?$/.test(text)) throw refused;
  return Number(text);
}

function lotRefusal(quantity: HoldQuantity, chosen: Lot, lots: readonly Lot[], name: string): string | null {
  if (isLeatherLot(chosen)) return leatherLotRefusal(() => Number(quantity), chosen, lots.filter(isLeatherLot) as LeatherLot[], name);
  return fabricLotRefusal(String(quantity), chosen, lots.filter((lot) => !isLeatherLot(lot)) as FabricLot[], name);
}

/** One supplier call per piece, material and lot: requests queue on the piece, and each finds what the first one left. */
async function askForHold(ctx: Ctx) {
  const body = bodyOf(ctx);
  const code = requiredText(body, "code", 40);
  const lot = requiredText(body, "lot", 40);
  const material = await findMaterial(ctx.deskId, code);
  if (!material) throw invalid("code", copy("F-04"));
  const quantity = readQuantity(ctx, material.unit);
  const piece = pieceOf(ctx);
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`hold:${piece.id}`]);
    const rows = await query<HoldRow>("SELECT id, hold_id, code, lot, quantity, ends_on FROM holds WHERE piece_id = $1", [piece.id], client);
    const decision = decideHold(rows.map(heldLot), code, lot, quantity);
    if (decision.kind === "same") return json(200, { hold: holdBody(decision.hold as ReturnType<typeof heldLot>) });
    if (decision.kind === "refused") throw conflict("holdRefused", decision.message);
    const lots = await stockOf(code);
    const chosen = lots.find((each) => each.lot === lot);
    if (!chosen) throw invalid("lot", copy("F-04"));
    const refusal = lotRefusal(quantity, chosen, lots, material.name);
    if (refusal) throw conflict("lotTooSmall", refusal);
    const repeatKey = createHash("sha256").update(`hold:${piece.id}:${code}:${lot}`).digest("hex");
    const holdId = await placeHold({ code, lot, quantity, pieceRef: piece.id }, repeatKey).catch((error: unknown) => {
      throw supplierRefusal(error);
    });
    const row: HoldRow = { id: randomUUID(), hold_id: holdId, code, lot, quantity: String(quantity), ends_on: holdEndsOn(config.holdDays) };
    await client.query(
      "INSERT INTO holds (id, piece_id, code, lot, quantity, hold_id, ends_on) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [row.id, piece.id, code, lot, row.quantity, holdId, row.ends_on],
    );
    return json(201, { hold: holdBody(heldLot(row)) });
  });
}

async function materialResource(ctx: Ctx): Promise<void> {
  if (!(await findMaterial(ctx.deskId, ctx.params.code as string))) throw notFound();
}

export function register(): void {
  route({
    method: "GET",
    pattern: "/api/materials",
    handle: async (ctx) => {
      const materials = await query<MaterialRow>(`SELECT ${MATERIAL_COLUMNS} FROM materials WHERE desk_id = $1 ORDER BY position`, [ctx.deskId]);
      return json(200, { materials });
    },
  });
  route({
    method: "POST",
    pattern: "/api/materials/refresh",
    handle: async (ctx) => json(200, { count: await refreshLibrary(ctx.deskId) }),
  });
  route({
    method: "GET",
    pattern: "/api/materials/:code/lots",
    resource: materialResource,
    handle: async (ctx) => {
      const code = ctx.params.code as string;
      return json(200, { code, lots: await stockOf(code) });
    },
  });
  route({
    method: "GET",
    pattern: "/api/pieces/:id/holds",
    resource: pieceResource,
    handle: async (ctx) => json(200, { holds: await holdsOfPiece(pieceOf(ctx).id) }),
  });
  route({ method: "POST", pattern: "/api/pieces/:id/holds", resource: pieceResource, handle: askForHold });
}

