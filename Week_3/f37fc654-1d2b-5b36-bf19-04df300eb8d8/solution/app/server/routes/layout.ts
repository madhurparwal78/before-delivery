// The configurator: layouts with versions, quote previews, options and quote refresh
// (brief: API › Layout and quote, Business rules › Pieces and placement, Options lock).
import { ADD_ONS, SIZES, type AddOn, type PieceKind, type Size } from "../../shared/catalog.js";
import { requireCaller } from "../auth.js";
import { applyMove, commissionFor, currentQuote, installDayOf, issueQuote, quoteView, requiredPieces, type Commission } from "../commissions.js";
import { one, pool, tx, type Db } from "../db.js";
import { fail, invalid, jsonBody, ok, record, type Request, type Router } from "../http.js";
import { priceQuote } from "../rules/money.js";
import { allPiecesPlaced, firstPlacementError, type LayoutItem } from "../rules/placement.js";
import { queueCrewAlert } from "../alerts.js";

const LAYOUT_STATES = ["previewed", "placed", "held", "contracted", "concept_approved"];

function toItems(value: unknown): LayoutItem[] {
  if (!Array.isArray(value)) invalid({ items: "Positions snap to 0.25 m and turns to 15°." });
  return value.map((raw) => {
    const item = record(raw);
    const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
    return { kind: String(item.kind ?? "") as PieceKind, x: num(item.x), y: num(item.y), rotationDeg: num(item.rotationDeg) };
  });
}

async function saveLayout(req: Request) {
  const caller = await requireCaller(req);
  const body = record(jsonBody(req));
  return tx(async (db) => {
    const c = await commissionFor(db, caller, req.params.id, ["owner", "producer"], true);
    if (!LAYOUT_STATES.includes(c.state)) fail(409, "illegal_state");
    if (body.version !== c.layoutVersion) fail(412, "version_conflict", { currentVersion: c.layoutVersion });
    const items = toItems(body.items);
    const problem = firstPlacementError(items, c.room, requiredPieces(c));
    if (problem) invalid({ [`items[${problem.index}]`]: problem.message });
    const version = c.layoutVersion + 1;
    await db.query("UPDATE commissions SET layout = $2, layout_version = $3 WHERE id = $1", [c.id, JSON.stringify(items), version]);
    c.layout = items;
    if (allPiecesPlaced(requiredPieces(c), items)) await applyMove(db, c, "placed", "system");
    const day = await installDayOf(db, c.id);
    if (day) await queueCrewAlert(db, c, day.id, day.date, "placement_changed");
    return ok({ version, items });
  });
}

function parseOptions(body: Record<string, unknown>): { size: Size; addOns: AddOn[] } {
  const errors: Record<string, string> = {};
  const size = typeof body.size === "string" && body.size in SIZES ? (body.size as Size) : null;
  const addOns = Array.isArray(body.addOns) && body.addOns.every((a) => typeof a === "string" && a in ADD_ONS) && new Set(body.addOns).size === body.addOns.length
    ? (Object.keys(ADD_ONS) as AddOn[]).filter((a) => (body.addOns as unknown[]).includes(a))
    : null;
  if (!size) errors.size = "Pick Compact, Standard or Grand.";
  if (!addOns) errors.addOns = "Pick from the listed extras.";
  if (!size || !addOns) invalid(errors);
  return { size, addOns };
}

async function quotePreview(req: Request) {
  const caller = await requireCaller(req);
  const c = await commissionFor(pool, caller, req.params.id, ["owner", "producer"]);
  const { size, addOns } = parseOptions(record(jsonBody(req)));
  return ok(priceQuote(c.installationType, size, addOns, c.venue.taxRateBp));
}

async function sponsorAccepted(db: Db, commissionId: string): Promise<boolean> {
  return Boolean(await one("SELECT 1 FROM funders WHERE commission_id = $1 AND kind = 'sponsor' AND accepted_at IS NOT NULL AND removed_at IS NULL", [commissionId], db));
}

async function saveOptions(req: Request) {
  const caller = await requireCaller(req);
  const body = record(jsonBody(req));
  return tx(async (db) => {
    const c: Commission = await commissionFor(db, caller, req.params.id, ["owner", "producer"], true);
    if (!["previewed", "placed"].includes(c.state) || (await sponsorAccepted(db, c.id))) fail(409, "options_locked");
    const { size, addOns } = parseOptions(body);
    c.size = size;
    c.addOns = addOns;
    const kept = c.layout.filter((i) => requiredPieces(c).includes(i.kind));
    if (kept.length !== c.layout.length) {
      c.layoutVersion += 1;
      c.layout = kept;
    }
    await db.query("UPDATE commissions SET size = $2, add_ons = $3, layout = $4, layout_version = $5 WHERE id = $1",
      [c.id, size, addOns, JSON.stringify(c.layout), c.layoutVersion]);
    const quote = await issueQuote(db, c, Date.now());
    return ok({ options: { size, addOns }, quote: quoteView(quote, c), layout: { version: c.layoutVersion, items: c.layout } });
  });
}

async function refreshQuote(req: Request) {
  const caller = await requireCaller(req);
  return tx(async (db) => {
    const c = await commissionFor(db, caller, req.params.id, ["owner", "producer"], true);
    if (!["briefed", "previewed", "placed", "held"].includes(c.state)) fail(409, "illegal_state");
    if (!(await currentQuote(db, c))) fail(409, "illegal_state");
    return ok({ quote: quoteView(await issueQuote(db, c, Date.now()), c) });
  });
}

export function registerLayout(router: Router): void {
  router.add("PUT", "/api/commissions/:id/layout", saveLayout);
  router.add("POST", "/api/commissions/:id/quote-preview", quotePreview);
  router.add("PUT", "/api/commissions/:id/options", saveOptions);
  router.add("POST", "/api/commissions/:id/quote/refresh", refreshQuote);
}

