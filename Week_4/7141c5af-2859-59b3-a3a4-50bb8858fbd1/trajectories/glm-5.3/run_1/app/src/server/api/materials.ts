import { Router, type Request, type Response } from "express";
import { q, q1, tx } from "../db.js";
import { err, asyncHandler } from "../http.js";
import { requireSession } from "../session.js";
import { apiMessages } from "../copy.js";
import { readJsonBody, asBody, assertDepth, assertOrigin } from "../request.js";
import { pieceOfDesk } from "./clients-pieces.js";
import { fetchAllMaterials, fetchLots, placeHold, ProviderError, type SupplierLot } from "../providers/third-party.js";
import { config, newToken } from "../config.js";
import { todayTurin } from "../db.js";
import { addDaysISO, fmtDateEn, isoZ, startOfDayTurin } from "../time.js";
import { decideHold, quantityLabel } from "../holds.js";
import { syncEntries } from "../sync.js";

export const materialsRouter = Router({ mergeParams: true });

const materialJson = (row: { code: string; name: string; family: string; unit: string; prices: Record<string, string> }) => ({
  code: row.code,
  name: row.name,
  family: row.family,
  unit: row.unit,
  prices: {
    eur: row.prices.eur ?? "",
    gbp: row.prices.gbp ?? "",
    usd: row.prices.usd ?? "",
    jpy: row.prices.jpy ?? "",
    aed: row.prices.aed ?? "",
  },
});

materialsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const rows = await q<{ code: string; name: string; family: string; unit: string; prices: Record<string, string> }>(
    "SELECT code, name, family, unit, prices FROM materials WHERE desk_id = $1 ORDER BY position, code", [session.deskId]
  );
  res.json({ materials: rows.map(materialJson) });
}));

materialsRouter.post("/refresh", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  await readJsonBody(req);
  const fetched = await fetchAllMaterials();
  if (fetched instanceof ProviderError) {
    if (fetched.kind === "busy") {
      const retry = Math.ceil((fetched.retryAfter ?? 60));
      throw err.limited(retry, apiMessages.supplierBusy);
    }
    throw err.unavailable(apiMessages.supplierFailed);
  }
  // Stage the rows; only once Meilisearch confirms does the library change.
  const staged = fetched.map((m, i) => ({ ...m, position: i }));
  const ok = await tx(async (client) => {
    for (const m of staged) {
      const doc = { id: `mat-${session.deskId}-${m.code}`, desk_id: session.deskId, kind: "material", ref_id: m.code, label: `${m.name} ${m.code}`, href: `/library?material=${m.code}` };
      await client.query(
        "INSERT INTO search_sync (desk_id, kind, ref_id, label, href, pending) VALUES ($1,'material',$2,$3,$4,true) ON CONFLICT (desk_id, kind, ref_id) DO UPDATE SET label=$3, href=$4, pending=true",
        [session.deskId, m.code, doc.label, doc.href]
      );
    }
    return true;
  });
  if (!ok) throw err.unavailable(apiMessages.supplierFailed);
  const entries = staged.map((m) => ({ kind: "material" as const, refId: m.code, label: `${m.name} ${m.code}`, href: `/library?material=${m.code}` }));
  const pending = await q<{ ref_id: string }>("SELECT ref_id FROM search_sync WHERE desk_id=$1 AND kind='material' AND pending=true", [session.deskId]);
  let allConfirmed = true;
  for (const row of pending) {
    const e = entries.find((x) => x.refId === row.ref_id);
    if (!e) {
      await tx(async (client) => { await client.query("DELETE FROM search_sync WHERE desk_id=$1 AND kind='material' AND ref_id=$2", [session.deskId, row.ref_id]); });
      continue;
    }
    const { meili } = await import("../providers/meili.js");
    const added = await meili.add([{ id: `${session.deskId}-material-${e.refId}`, deskId: session.deskId, kind: "material", refId: e.refId, label: e.label, href: e.href }]);
    if (!added) allConfirmed = false;
    else await q("UPDATE search_sync SET pending=false WHERE desk_id=$1 AND kind='material' AND ref_id=$2", [session.deskId, e.refId]);
  }
  if (!allConfirmed) throw err.unavailable(apiMessages.searchNotConfirmed);
  for (const m of staged) {
    await q("INSERT INTO materials (id, desk_id, code, name, family, unit, prices, position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (desk_id, code) DO UPDATE SET name=$4, family=$5, unit=$6, prices=$7, position=$8", [
      `mat-${session.deskId}-${m.code}`, session.deskId, m.code, m.name, m.family, m.unit, JSON.stringify(m.prices), m.position,
    ]);
  }
  const count = (await q1<{ n: string }>("SELECT count(*)::text AS n FROM materials WHERE desk_id=$1", [session.deskId]))!.n;
  res.json({ count: Number(count) });
}));

materialsRouter.get("/:code/lots", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const code = req.params.code!;
  const material = await q1<{ unit: string; name: string }>("SELECT unit, name FROM materials WHERE desk_id=$1 AND code=$2", [session.deskId, code]);
  if (!material) throw err.notFound();
  const cached = await q1<{ fetched_at: Date; lots: SupplierLot[] }>("SELECT fetched_at, lots FROM stock_cache WHERE desk_id=$1 AND code=$2", [session.deskId, code]);
  const now = Date.now();
  if (cached && now - cached.fetched_at.getTime() < config.timers.stockCache * 1000) {
    res.json({ code, lots: cached.lots });
    return;
  }
  const fetched = await fetchLots(code);
  if (fetched instanceof ProviderError) {
    if (fetched.kind === "busy") {
      throw err.limited(Math.ceil(fetched.retryAfter ?? 60), apiMessages.supplierBusy);
    }
    throw err.unavailable(apiMessages.supplierDown);
  }
  await q(
    "INSERT INTO stock_cache (desk_id, code, fetched_at, lots) VALUES ($1,$2,now(),$3) ON CONFLICT (desk_id, code) DO UPDATE SET fetched_at=now(), lots=$3",
    [session.deskId, code, JSON.stringify(fetched)]
  );
  res.json({ code, lots: fetched });
}));

// ---- Holds ----

export const holdsRouter = Router({ mergeParams: true });

type HoldDbRow = { id: string; hold_id: string; code: string; lot: string; quantity: string; unit: string; state: "held" | "ended"; ends_on: string };

const holdJson = (h: HoldDbRow) => ({
  id: h.id,
  holdId: h.hold_id,
  code: h.code,
  lot: h.lot,
  quantity: h.unit === "metre" ? h.quantity : Number(h.quantity),
  state: h.state,
  endsOn: h.ends_on,
  label: h.state === "held" ? apiMessages.holdLabel(fmtDateEn(startOfDayTurin(h.ends_on), "Europe/Rome")) : apiMessages.holdEndedLabel(fmtDateEn(startOfDayTurin(h.ends_on), "Europe/Rome")),
});

holdsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const rows = await q<HoldDbRow>("SELECT id, hold_id, code, lot, quantity, unit, state, ends_on::text AS ends_on FROM holds WHERE piece_id=$1 ORDER BY created_at", [piece.id]);
  res.json({ holds: rows.map(holdJson) });
}));

holdsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  assertOrigin(req);
  const session = await requireSession(req);
  const piece = await pieceOfDesk(session.deskId, req.params.pieceId!);
  if (!piece) throw err.notFound();
  const body = asBody(await readJsonBody(req));
  assertDepth(body);
  const code = typeof body.code === "string" ? body.code : "";
  const lot = typeof body.lot === "string" ? body.lot : "";
  const quantity = typeof body.quantity === "string" ? body.quantity : body.quantity !== undefined ? String(body.quantity) : "";
  const material = await q1<{ unit: string; name: string }>("SELECT unit, name FROM materials WHERE desk_id=$1 AND code=$2", [session.deskId, code]);
  if (!material) throw err.notFound();
  const existing = await q<HoldDbRow>("SELECT id, hold_id, code, lot, quantity, unit, state, ends_on::text AS ends_on FROM holds WHERE piece_id=$1 ORDER BY created_at", [piece.id]);
  const cached = await q1<{ fetched_at: Date; lots: SupplierLot[] }>("SELECT fetched_at, lots FROM stock_cache WHERE desk_id=$1 AND code=$2", [session.deskId, code]);
  const fresh = !cached || Date.now() - cached.fetched_at.getTime() >= config.timers.stockCache * 1000;
  let lots: SupplierLot[];
  if (fresh) {
    const fetched = await fetchLots(code);
    if (fetched instanceof ProviderError) {
      if (fetched.kind === "busy") throw err.limited(Math.ceil(fetched.retryAfter ?? 60), apiMessages.supplierBusy);
      throw err.unavailable(apiMessages.supplierDown);
    }
    lots = fetched;
    await q("INSERT INTO stock_cache (desk_id, code, fetched_at, lots) VALUES ($1,$2,now(),$3) ON CONFLICT (desk_id, code) DO UPDATE SET fetched_at=now(), lots=$3", [session.deskId, code, JSON.stringify(lots)]);
  } else {
    lots = cached!.lots;
  }
  const decision = decideHold(code, material.name, material.unit, lot, quantity, existing, lots);
  if (decision.ok !== "call" && "status" in decision) {
    if (decision.status === 422) throw err.field({ quantity: decision.message });
    throw err.state(decision.code, decision.message);
  }
  if (decision.ok === true) {
    res.status(200).json({ hold: holdJson(decision.hold as never) });
    return;
  }
  const repeatKey = `${piece.id}:${code}:${lot}`;
  const prior = await q1<{ hold_id: string }>("SELECT hold_id FROM hold_calls WHERE desk_id=$1 AND piece_id=$2 AND code=$3 AND lot=$4", [session.deskId, piece.id, code, lot]);
  let holdId: string;
  if (prior) {
    holdId = prior.hold_id;
  } else {
    const answer = await placeHold(code, lot, material.unit === "metre" ? quantity : String(quantity), piece.id, repeatKey);
    if (answer instanceof ProviderError) {
      if (answer.kind === "busy") throw err.limited(Math.ceil(answer.retryAfter ?? 60), apiMessages.supplierBusy);
      throw err.unavailable(apiMessages.supplierDown);
    }
    holdId = answer.holdId;
    await q("INSERT INTO hold_calls (desk_id, piece_id, code, lot, hold_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [session.deskId, piece.id, code, lot, holdId]);
  }
  const endsOn = addDaysISO(todayTurin(), config.timers.holdDays);
  const id = newToken(8);
  const unit = material.unit === "metre" ? "metre" : "hides";
  await q("INSERT INTO holds (id, piece_id, desk_id, hold_id, code, lot, quantity, unit, state, ends_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'held',$9)", [
    id, piece.id, session.deskId, holdId, code, lot, quantity, unit, endsOn,
  ]);
  const row = await q1<HoldDbRow>("SELECT id, hold_id, code, lot, quantity, unit, state, ends_on::text AS ends_on FROM holds WHERE id=$1", [id]);
  res.status(201).json({ hold: holdJson(row as never) });
}));

void syncEntries;
