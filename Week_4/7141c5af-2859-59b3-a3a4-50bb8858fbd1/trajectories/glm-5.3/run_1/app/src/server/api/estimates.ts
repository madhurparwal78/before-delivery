import { Router, type Request, type Response } from "express";
import { q, q1 } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { readJsonBody, asBody, assertDepth, assertOrigin } from "../request.js";
import { pieceOfDesk, clientOfDesk } from "./clients-pieces.js";
import { computeEstimate, validateLabourHours, type EstimateResult } from "../estimate.js";
import { todayTurin } from "../db.js";
import { isoZ, localTimeHM } from "../time.js";
import { config, newToken } from "../config.js";
import type { SupplierLot } from "../providers/third-party.js";


export const estimatesRouter = Router({ mergeParams: true });
export const ratesRouter = Router({ mergeParams: true });

type RateRow = { takes_effect_on: string; takesEffectOn: string; eur: string; gbp: string; usd: string; jpy: string; aed: string };

async function applicableRate(deskId: string): Promise<RateRow | null> {
  const today = todayTurin();
  const row = await q1<RateRow>(
    "SELECT takes_effect_on::text AS takes_effect_on, eur, gbp, usd, jpy, aed FROM rates WHERE desk_id=$1 AND takes_effect_on <= $2 ORDER BY takes_effect_on DESC LIMIT 1",
    [deskId, today]
  );
  return row ?? null;
}

const estimateJson = (r: {
  id: string; piece_id: string; version: number; state: string; currency: string; material_code: string | null; lot: string | null;
  pattern_area_sq_ft: string | null; hides: number | null; metres: string | null; labour_hours: string; labour_rate_minor: number;
  material_minor: number; labour_minor: number; subtotal_minor: number; tax_percent: number; tax_minor: number; total_minor: number;
  milestones: { percent: number; amountMinor: number }[]; created_at: Date;
}, display: EstimateResult["display"]) => ({
  id: r.id,
  version: r.version,
  state: r.state,
  currency: r.currency,
  materialCode: r.material_code,
  lot: r.lot,
  patternAreaSqFt: r.pattern_area_sq_ft,
  hides: r.hides,
  metres: r.metres,
  labourHours: r.labour_hours,
  labourRateMinor: r.labour_rate_minor,
  materialMinor: r.material_minor,
  labourMinor: r.labour_minor,
  subtotalMinor: r.subtotal_minor,
  taxPercent: r.tax_percent,
  taxMinor: r.tax_minor,
  totalMinor: r.total_minor,
  milestones: r.milestones,
  display,
  createdAt: isoZ(r.created_at),
});

type EstDbRow = {
  id: string; piece_id: string; version: number; state: string; currency: string; material_code: string | null; lot: string | null;
  pattern_area_sq_ft: string | null; hides: number | null; metres: string | null; labour_hours: string; labour_rate_minor: number;
  material_minor: number; labour_minor: number; subtotal_minor: number; tax_percent: number; tax_minor: number; total_minor: number;
  milestones: { percent: number; amountMinor: number }[]; created_at: Date;
};

async function dbEstimate(id: string): Promise<{ row: EstDbRow; display: EstimateResult["display"] } | null> {
  const row = await q1<EstDbRow>("SELECT * FROM estimates WHERE id = $1", [id]);
  if (!row) return null;
  return { row, display: displayOf(row) };
}

const displayOf = (row: EstDbRow): EstimateResult["display"] => {
  const milestones = (row.milestones ?? []) as { percent: number; amountMinor: number }[];
  return {
    material: print(row.currency, row.material_minor),
    labour: print(row.currency, row.labour_minor),
    labourRate: print(row.currency, row.labour_rate_minor),
    subtotal: print(row.currency, row.subtotal_minor),
    tax: print(row.currency, row.tax_minor),
    total: print(row.currency, row.total_minor),
    milestones: milestones.map((m) => print(row.currency, m.amountMinor)),
  };
};

import { printMinor } from "../decimal.js";
const print = (currency: string, minor: number) => printMinor(minor, currency as never);

async function loadLots(deskId: string, code: string): Promise<SupplierLot[]> {
  const cached = await q1<{ fetched_at: Date; lots: SupplierLot[] }>("SELECT fetched_at, lots FROM stock_cache WHERE desk_id=$1 AND code=$2", [deskId, code]);
  const fresh = cached && Date.now() - cached.fetched_at.getTime() < config.timers.stockCache * 1000;
  if (fresh) return cached!.lots;
  const { fetchLots, ProviderError } = await import("../providers/third-party.js");
  const fetched = await fetchLots(code);
  if (fetched instanceof ProviderError) return [];
  await q("INSERT INTO stock_cache (desk_id, code, fetched_at, lots) VALUES ($1,$2,now(),$3) ON CONFLICT (desk_id, code) DO UPDATE SET fetched_at=now(), lots=$3", [deskId, code, JSON.stringify(fetched)]);
  return fetched;
}

async function buildEstimate(deskId: string, piece: { id: string; client_id: string | null }, body: Record<string, unknown>) {
  const client = piece.client_id ? await clientOfDesk(deskId, piece.client_id) : null;
  if (!client) throw err.state("F-63", apiMessages.needEmail);
  const rate = await applicableRate(deskId);
  if (!rate) throw err.state("F-92", apiMessages.noSignedOffEstimate);
  const materialCode = typeof body.materialCode === "string" && body.materialCode !== "" ? body.materialCode : null;
  const lot = typeof body.lot === "string" ? body.lot : null;
  const patternArea = typeof body.patternAreaSqFt === "string" ? body.patternAreaSqFt : body.patternAreaSqFt !== undefined ? String(body.patternAreaSqFt) : null;
  const metres = typeof body.metres === "string" ? body.metres : body.metres !== undefined ? String(body.metres) : null;
  const labourHours = typeof body.labourHours === "string" ? body.labourHours : body.labourHours !== undefined ? String(body.labourHours) : "";
  const fields: Record<string, string> = {};
  if (labourHours === "") fields.labourHours = apiMessages.fieldRequired;
  else {
    const d = labourHours;
    if (!/^\d+(\.\d+)?$/.test(d)) fields.labourHours = apiMessages.notANumber;
    else if (validateLabourHours(d)) fields.labourHours = validateLabourHours(d)!;
  }
  if (materialCode) {
    const material = await q1<{ unit: string; prices: Record<string, string>; name: string }>("SELECT unit, prices, name FROM materials WHERE desk_id=$1 AND code=$2", [deskId, materialCode]);
    if (!material) throw err.notFound();
    if (!lot) fields.lot = apiMessages.fieldRequired;
    if (material.unit === "sqFt" && (!patternArea || (patternArea && !/^\d+(\.\d+)?$/.test(patternArea)))) fields.patternAreaSqFt = patternArea ? apiMessages.notANumber : apiMessages.fieldRequired;
    if (material.unit === "metre" && (!metres || (metres && !/^\d+(\.\d+)?$/.test(metres)))) fields.metres = metres ? apiMessages.notANumber : apiMessages.fieldRequired;
  } else {
    if (patternArea || metres) fields.materialCode = apiMessages.fieldRequired;
  }
  if (Object.keys(fields).length) throw err.field(fields);
  const material = materialCode
    ? await q1<{ unit: string; prices: Record<string, string>; name: string }>("SELECT unit, prices, name FROM materials WHERE desk_id=$1 AND code=$2", [deskId, materialCode])
    : null;
  const lots = materialCode && material ? await loadLots(deskId, materialCode) : [];
  const result = computeEstimate(
    { materialCode, lot, patternAreaSqFt: patternArea, metres, labourHours },
    client.town as never,
    rate,
    material ? { name: material.name, unit: material.unit, prices: material.prices } : null,
    lots
  );
  if ("error" in result) {
    if (result.error === apiMessages.quarterHours) throw err.field({ labourHours: apiMessages.quarterHours });
    if (result.error === apiMessages.notANumber) throw err.field({ patternAreaSqFt: apiMessages.notANumber, metres: apiMessages.notANumber });
    if (result.error === apiMessages.numberRange) throw err.field({ patternAreaSqFt: apiMessages.numberRange, metres: apiMessages.numberRange });
    if (result.error === apiMessages.fieldRequired) throw err.field({ lot: apiMessages.fieldRequired });
    const code = result.error === apiMessages.chosenLotTooSmall.replace("<lot>", "")
      || result.error.startsWith("Lot ")
      ? "F-39"
      : result.error.includes(" m of ")
        ? "F-38"
        : "F-37";
    throw err.state(code, result.error);
  }
  return result;
}

estimatesRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const rows = await q<EstDbRow>("SELECT * FROM estimates WHERE piece_id=$1 ORDER BY version DESC", [piece.id]);
  res.json({ estimates: rows.map((r) => estimateJson(r, displayOf(r))) });
}));

async function resolveEstimate(deskId: string, pieceId: string, body: Record<string, unknown>) {
  const result = await buildEstimate(deskId, (await pieceOfDesk(deskId, pieceId))! as { id: string; client_id: string | null }, body);
  return result;
}

estimatesRouter.post("/preview", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const result = await resolveEstimate(session.deskId, piece.id, body);
  res.json({ estimate: { ...result, id: undefined } });
}));

estimatesRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const open = await q1<EstDbRow>("SELECT * FROM estimates WHERE piece_id=$1 AND state='open' ORDER BY version DESC LIMIT 1", [piece.id]);
  if (body.openVersion !== undefined && open) {
    const expected = Number(body.openVersion);
    if (open.version !== expected) throw err.stale("F-55", apiMessages.estimateStale.replace("<time>", localTimeHM(open.created_at, "Europe/Rome")));
  }
  const result = await resolveEstimate(session.deskId, piece.id, body);
  const nextVersion = (await q1<{ n: number }>("SELECT COALESCE(MAX(version),0)+1 AS n FROM estimates WHERE piece_id=$1", [piece.id]))!.n;
  if (open) await q("UPDATE estimates SET state='replaced' WHERE id=$1", [open.id]);
  const id = newToken(8);
  await q(
    `INSERT INTO estimates (id, piece_id, desk_id, version, state, currency, material_code, lot, pattern_area_sq_ft, hides, metres, labour_hours, labour_rate_minor, material_minor, labour_minor, subtotal_minor, tax_percent, tax_minor, total_minor, milestones)
     VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [id, piece.id, session.deskId, nextVersion, result.currency, result.materialCode, result.lot, result.patternAreaSqFt, result.hides, result.metres, result.labourHours, result.labourRateMinor, result.materialMinor, result.labourMinor, result.subtotalMinor, result.taxPercent, result.taxMinor, result.totalMinor, JSON.stringify(result.milestones)]
  );
  const stored = await dbEstimate(id);
  res.status(201).json({ estimate: estimateJson(stored!.row, stored!.display) });
}));

// ---- Rates ----

const rateJson = (r: RateRow) => ({
  takesEffectOn: r.takes_effect_on,
  eur: r.eur, gbp: r.gbp, usd: r.usd, jpy: r.jpy, aed: r.aed,
});

ratesRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const rows = await q<RateRow>("SELECT takes_effect_on::text AS takes_effect_on, eur, gbp, usd, jpy, aed FROM rates WHERE desk_id=$1 ORDER BY takes_effect_on", [session.deskId]);
  res.json({ rates: rows.map(rateJson) });
}));

ratesRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const fields: Record<string, string> = {};
  const takesEffectOn = typeof body.takesEffectOn === "string" ? body.takesEffectOn : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(takesEffectOn)) fields.takesEffectOn = apiMessages.date;
  else if (takesEffectOn < todayTurin()) fields.takesEffectOn = apiMessages.rateTooEarly;
  const values: Record<string, string> = {};
  for (const key of ["eur", "gbp", "usd", "jpy", "aed"] as const) {
    const v = typeof body[key] === "string" ? (body[key] as string) : body[key] !== undefined ? String(body[key]) : "";
    if (v === "" || !/^\d+(\.\d+)?$/.test(v)) fields[key] = v === "" ? apiMessages.fieldRequired : apiMessages.notANumber;
    else values[key] = v;
  }
  if (Object.keys(fields).length) throw err.field(fields);
  const exists = await q1<{ id: string }>("SELECT id FROM rates WHERE desk_id=$1 AND takes_effect_on=$2", [session.deskId, takesEffectOn]);
  if (exists) throw err.state("F-58", apiMessages.rateSameDay);
  const id = newToken(8);
  await q("INSERT INTO rates (id, desk_id, takes_effect_on, eur, gbp, usd, jpy, aed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [
    id, session.deskId, takesEffectOn, values.eur, values.gbp, values.usd, values.jpy, values.aed,
  ]);
  const rows = await q<RateRow>("SELECT takes_effect_on::text AS takes_effect_on, eur, gbp, usd, jpy, aed FROM rates WHERE desk_id=$1 ORDER BY takes_effect_on", [session.deskId]);
  res.status(201).json({ rates: rows.map(rateJson) });
}));


