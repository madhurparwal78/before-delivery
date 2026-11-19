import { randomUUID } from "node:crypto";
import { type Queryable, one, query, tx } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { fixed, rational } from "../domain/decimal.ts";
import { defaultPatternArea } from "../domain/placement.ts";
import { displayFigures, estimateLotRefusal, type EstimateCharge, type EstimateFigures, isPositive, quarterHours, withinAmountRange, type WorkedEstimate, workOutEstimate } from "../domain/estimate.ts";
import { type Currency, priceKey, splitMilestones } from "../domain/money.ts";
import { instant, timeCopy } from "../domain/time.ts";
import { TOWNS } from "../domain/towns.ts";
import { conflict, invalid, stale } from "../http/errors.ts";
import { type Ctx, json, route } from "../http/router.ts";
import { bodyOf, type Body, decimalField, requiredText } from "./fields.ts";
import { findMaterial, stockOf } from "./materials.ts";
import { labourRateMinor } from "./rates.ts";
import { type PieceRow, pieceOf, pieceResource } from "./resources.ts";

export interface EstimateRow {
  id: string;
  piece_id: string;
  version: number;
  state: string;
  currency: Currency;
  material_code: string | null;
  material_name: string | null;
  lot: string | null;
  pattern_area_sq_ft: string | null;
  hides: number | null;
  metres: string | null;
  labour_hours: string;
  labour_rate_minor: bigint;
  material_minor: bigint;
  labour_minor: bigint;
  subtotal_minor: bigint;
  tax_percent: number;
  tax_minor: bigint;
  total_minor: bigint;
  created_at: Date;
}

function publishedBody(fields: { version: number; state: string; materialCode: string | null; lot: string | null; labourHours: string; createdAt: Date } & Pick<WorkedEstimate, "hides" | "metres" | "patternAreaSqFt">, figures: EstimateFigures) {
  return {
    version: fields.version,
    state: fields.state,
    currency: figures.currency,
    materialCode: fields.materialCode,
    lot: fields.lot,
    patternAreaSqFt: fields.patternAreaSqFt,
    hides: fields.hides,
    metres: fields.metres,
    labourHours: fields.labourHours,
    labourRateMinor: Number(figures.labourRateMinor),
    materialMinor: Number(figures.materialMinor),
    labourMinor: Number(figures.labourMinor),
    subtotalMinor: Number(figures.subtotalMinor),
    taxPercent: figures.taxPercent,
    taxMinor: Number(figures.taxMinor),
    totalMinor: Number(figures.totalMinor),
    milestones: splitMilestones(figures.totalMinor).map((milestone) => ({ percent: milestone.percent, amountMinor: Number(milestone.amountMinor) })),
    display: displayFigures(figures, fields.patternAreaSqFt),
    createdAt: instant(fields.createdAt),
  };
}

/** The published estimate body of a stored row. */
function estimateBody(row: EstimateRow) {
  const figures: EstimateFigures = {
    currency: row.currency,
    labourRateMinor: row.labour_rate_minor,
    materialMinor: row.material_minor,
    labourMinor: row.labour_minor,
    subtotalMinor: row.subtotal_minor,
    taxPercent: row.tax_percent,
    taxMinor: row.tax_minor,
    totalMinor: row.total_minor,
  };
  const fields = {
    version: row.version,
    state: row.state,
    materialCode: row.material_code,
    lot: row.lot,
    patternAreaSqFt: row.pattern_area_sq_ft,
    hides: row.hides,
    metres: row.metres,
    labourHours: row.labour_hours,
    createdAt: row.created_at,
  };
  return { id: row.id, ...publishedBody(fields, figures) };
}

/** Every estimate of a piece, newest first. */
async function estimatesOfPiece(pieceId: string, on?: Queryable): Promise<EstimateRow[]> {
  return query<EstimateRow>("SELECT * FROM estimates WHERE piece_id = $1 ORDER BY version DESC", [pieceId], on);
}

export async function latestSignedOff(pieceId: string, on?: Queryable): Promise<EstimateRow | null> {
  return one<EstimateRow>("SELECT * FROM estimates WHERE piece_id = $1 AND state = 'signedOff' ORDER BY version DESC LIMIT 1", [pieceId], on);
}

function readSized(body: Body, field: string): string {
  const text = decimalField(body, field);
  if (!isPositive(text) || !withinAmountRange(text)) throw invalid(field, copy("F-08"));
  return text;
}

function readLabourHours(body: Body): string {
  const text = decimalField(body, "labourHours");
  if (!withinAmountRange(text)) throw invalid("labourHours", copy("F-08"));
  if (!quarterHours(text)) throw invalid("labourHours", copy("F-56"));
  return fixed(rational(text), 2);
}

interface Requested {
  materialCode: string | null;
  lot: string | null;
  materialName: string | null;
  labourHours: string;
  worked: WorkedEstimate;
}

/** Steps 9 and 10 of a save or preview: fields, then the lot check. An estimate's material, rate and currency are read by the server. */
async function readRequest(ctx: Ctx, piece: PieceRow): Promise<Requested> {
  const body = bodyOf(ctx);
  const { currency, taxPercent } = TOWNS[piece.client_town];
  const code = body.materialCode === undefined || body.materialCode === null ? null : requiredText(body, "materialCode", 40);
  let charge: EstimateCharge | null = null;
  let lotName: string | null = null;
  let labourHours: string;
  if (code === null) {
    labourHours = readLabourHours(body);
  } else {
    const material = await findMaterial(ctx.deskId, code);
    if (!material) throw invalid("materialCode", copy("F-04"));
    lotName = requiredText(body, "lot", 40);
    const amount = material.unit === "metre" ? readSized(body, "metres") : body.patternAreaSqFt === undefined ? defaultPatternArea() : readSized(body, "patternAreaSqFt");
    labourHours = readLabourHours(body);
    const lots = await stockOf(code);
    const lot = lots.find((each) => each.lot === lotName);
    if (!lot) throw invalid("lot", copy("F-04"));
    charge = { material: { name: material.name, unit: material.unit, price: material.prices[priceKey(currency)] }, lot, amount };
    const refusal = estimateLotRefusal(charge, lots);
    if (refusal) throw conflict("lotTooSmall", refusal);
  }
  const rate = await labourRateMinor(ctx.deskId, currency);
  return { materialCode: code, lot: lotName, materialName: charge?.material.name ?? null, labourHours, worked: workOutEstimate(charge, labourHours, rate, currency, taxPercent) };
}

function readOpenVersion(body: Body): number | null {
  const value = body.openVersion;
  if (value === undefined || value === null) return null;
  if (typeof value !== "number") throw invalid("openVersion", copy("F-112"));
  return value;
}

async function preview(ctx: Ctx) {
  const piece = pieceOf(ctx);
  const requested = await readRequest(ctx, piece);
  const newest = (await estimatesOfPiece(piece.id))[0];
  const { worked } = requested;
  return json(200, { estimate: publishedBody({ ...requested, ...worked, version: (newest?.version ?? 0) + 1, state: "open", createdAt: new Date() }, worked.figures) });
}

/** A new estimate replaces the piece's open one; the piece's row lock orders two saves, and an old `openVersion` changes nothing. */
async function save(ctx: Ctx) {
  const piece = pieceOf(ctx);
  const openVersion = readOpenVersion(bodyOf(ctx));
  const requested = await readRequest(ctx, piece);
  const { figures, hides, metres, patternAreaSqFt } = requested.worked;
  return tx(async (client) => {
    await client.query("SELECT 1 FROM pieces WHERE id = $1 FOR UPDATE", [piece.id]);
    const earlier = await estimatesOfPiece(piece.id, client);
    const open = earlier.find((estimate) => estimate.state === "open");
    if (openVersion !== null && open?.version !== openVersion) {
      throw stale("staleEstimate", copy("F-55", { time: timeCopy(earlier[0]?.created_at ?? new Date()) }));
    }
    await client.query("UPDATE estimates SET state = 'replaced' WHERE piece_id = $1 AND state = 'open'", [piece.id]);
    const row = await one<EstimateRow>(
      `INSERT INTO estimates (id, piece_id, version, state, currency, material_code, material_name, lot, pattern_area_sq_ft, hides, metres,
         labour_hours, labour_rate_minor, material_minor, labour_minor, subtotal_minor, tax_percent, tax_minor, total_minor)
       VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *`,
      [
        randomUUID(), piece.id, (earlier[0]?.version ?? 0) + 1, figures.currency, requested.materialCode, requested.materialName, requested.lot, patternAreaSqFt, hides, metres,
        requested.labourHours, figures.labourRateMinor, figures.materialMinor, figures.labourMinor, figures.subtotalMinor, figures.taxPercent, figures.taxMinor, figures.totalMinor,
      ],
      client,
    );
    return json(201, { estimate: estimateBody(row as EstimateRow) });
  });
}

export function register(): void {
  route({
    method: "GET",
    pattern: "/api/pieces/:id/estimates",
    resource: pieceResource,
    handle: async (ctx) => json(200, { estimates: (await estimatesOfPiece(pieceOf(ctx).id)).map(estimateBody) }),
  });
  route({ method: "POST", pattern: "/api/pieces/:id/estimates", resource: pieceResource, handle: save });
  route({ method: "POST", pattern: "/api/pieces/:id/estimates/preview", resource: pieceResource, handle: preview });
}
