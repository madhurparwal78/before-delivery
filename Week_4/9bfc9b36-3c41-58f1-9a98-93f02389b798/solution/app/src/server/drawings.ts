/** Drawings: reading them (derived status, step, lot), creating, drawing the sail, assigning, revising, stepping back. */
import { nextCode, one, rows, run, transaction, type Queryable, type Row } from "./db.js";
import { audit } from "./audit.js";
import { buildPanels, headsailArea, mainsailArea, roachText } from "../shared/geometry.js";
import { squareFeetOf, squareMetresOf } from "../shared/units.js";
import { byTaken, derive, usedDimensions, type ClaimFact, type DerivedState, type LayFact, type Phase } from "./drawing-state.js";
import { areaFigure, measurementsOf, statesOf, type DimensionState } from "./boats.js";
import { currentRuleSet } from "./rules.js";
import { personOf, type AccountRow } from "./accounts.js";
import { refuse } from "./errors.js";
import { now } from "./time.js";
import { slicePage, type PageRequest } from "./paging.js";
import { projectDrawing } from "./projection.js";
import type { Drawing, DrawingStatus, Panel, Role, Sail } from "../shared/types.js";

export interface PanelRow {
  drawing_code: string;
  number: number;
  outline: [number, number][];
  length_mm: number;
  width_mm: number;
  area_mm2: number;
  cut: boolean;
}

export interface LayRow extends LayFact {
  drawing_code: string;
  x_mm: number;
  y_mm: number;
  rotation: 0 | 180;
  outline: [number, number][];
}

export interface DrawingFacts {
  row: Row;
  panels: PanelRow[];
  lays: LayRow[];
  claims: ClaimFact[];
  states: Record<string, DimensionState>;
  derived: DerivedState;
  usedFlagged: boolean;
}

const DRAWING_SELECT = `
  SELECT d.*, b.name AS boat_name, b.owner_id, ow.display_name AS owner_name, ow.email AS owner_email,
         a.email AS assigned_email, a.display_name AS assigned_name, a.deleted AS assigned_deleted,
         succ.code AS successor, succ.phase AS successor_phase
    FROM drawing d
    JOIN boat b ON b.code = d.boat_code
    JOIN account ow ON ow.id = b.owner_id
    LEFT JOIN account a ON a.id = d.assigned_to
    LEFT JOIN drawing succ ON succ.predecessor = d.code`;

async function drawingRows(db: Queryable, where = "", params: unknown[] = [], lock = false): Promise<Row[]> {
  return rows(db, `${DRAWING_SELECT} ${where} ORDER BY d.num DESC ${lock ? "FOR UPDATE OF d" : ""}`, params);
}

export async function drawingRow(db: Queryable, code: string, lock = false): Promise<Row | null> {
  return (await drawingRows(db, "WHERE d.code = $1", [code], lock))[0] ?? null;
}

async function loadFacts(db: Queryable, drawingRowList: Row[], at: Date): Promise<DrawingFacts[]> {
  if (drawingRowList.length === 0) return [];
  const codes = drawingRowList.map((row) => row.code);
  const [panels, lays, claims, measurements] = await Promise.all([
    rows<PanelRow>(db, "SELECT * FROM panel WHERE drawing_code = ANY($1) ORDER BY number", [codes]),
    rows<LayRow>(db, "SELECT * FROM lay WHERE drawing_code = ANY($1)", [codes]),
    rows<ClaimFact & { drawing_code: string }>(
      db,
      `SELECT c.id, c.drawing_code, c.stock_code, c.status, c.taken_at, c.expires_at, s.lot
         FROM claim c JOIN stock s ON s.code = c.stock_code WHERE c.drawing_code = ANY($1)`,
      [codes],
    ),
    measurementsOf(db, [...new Set(drawingRowList.map((row) => row.boat_code))]),
  ]);
  return drawingRowList.map((row) => {
    const own = panels.filter((p) => p.drawing_code === row.code);
    const ownLays = lays.filter((l) => l.drawing_code === row.code);
    const ownClaims = claims.filter((c) => c.drawing_code === row.code);
    const states = statesOf(measurements.filter((m) => m.boat_code === row.boat_code));
    const used = usedDimensions(row.sail);
    const usedFlagged = states[used.luff].flagged || states[used.foot].flagged;
    const derived = derive(row.phase as Phase, own, ownLays, ownClaims, usedFlagged, at);
    return { row, panels: own, lays: ownLays, claims: ownClaims, states, derived, usedFlagged };
  });
}

export async function loadFact(db: Queryable, code: string, at: Date, lock = false): Promise<DrawingFacts | null> {
  const row = await drawingRow(db, code, lock);
  return row ? (await loadFacts(db, [row], at))[0]! : null;
}

export const isSealed = (facts: DrawingFacts): boolean => facts.row.phase === "pending_store" || facts.row.phase === "issued";

function panelView(panel: PanelRow, facts: DrawingFacts): Panel {
  const claimId = facts.derived.laid.get(panel.number);
  const lay = claimId ? facts.lays.find((l) => l.claim_id === claimId && l.panel_number === panel.number) : undefined;
  const stockCode = claimId ? facts.claims.find((c) => c.id === claimId)?.stock_code : undefined;
  const view: Panel = {
    number: panel.number,
    outline: panel.outline,
    length_mm: panel.length_mm,
    width_mm: panel.width_mm,
    area_mm2: panel.area_mm2,
    area_m2: squareMetresOf(panel.area_mm2),
    area_ft2: squareFeetOf(panel.area_mm2),
    cut: panel.cut,
  };
  view.laid = lay && stockCode ? { claim_id: lay.claim_id, stock_code: stockCode, x_mm: lay.x_mm, y_mm: lay.y_mm, rotation: lay.rotation } : null;
  return view;
}

export function drawingView(facts: DrawingFacts, role: Role): Drawing {
  const { row, derived } = facts;
  const area = row.area_mm2 === null || row.area_mm2 === undefined ? null : areaFigure(row.area_mm2, row.area_basis);
  const sheetOut = row.cut_sheet_sha !== null && row.cut_sheet_sha !== undefined;
  const supersededBy = row.successor && row.successor_phase === "issued" ? row.successor : null;
  const panels = facts.panels.map((panel) => panelView(panel, facts));
  const drawing: Drawing = {
    code: row.code,
    boat_code: row.boat_code,
    boat_name: row.boat_name,
    sail: row.sail,
    cloth_code: row.cloth_code,
    lot: derived.lot,
    status: derived.status,
    step: derived.step,
    ruleset_version: row.ruleset_version,
    assigned_to: row.assigned_to ? personOf({ email: row.assigned_email, display_name: row.assigned_name, deleted: row.assigned_deleted }) : null,
    luff_mm: row.luff_mm,
    foot_mm: row.foot_mm,
    area,
    panels,
    claim_ids: [...facts.claims].sort(byTaken).map((claim) => claim.id),
    cut_sheet: sheetOut ? { sha256: row.cut_sheet_sha, size: row.cut_sheet_size, key: row.cut_sheet_key, superseded_by: supersededBy } : null,
    predecessor: row.predecessor,
    successor: row.successor,
  };
  return projectDrawing(drawing, role);
}

export async function drawingViewByCode(db: Queryable, code: string, role: Role): Promise<Drawing> {
  const at = now();
  return drawingView((await loadFact(db, code, at))!, role);
}

interface DrawingFilter {
  status: DrawingStatus | null;
  boat: string | null;
}

export async function listDrawings(db: Queryable, scope: { clause: string; params: unknown[] }, filter: DrawingFilter, role: Role, request: PageRequest) {
  const at = now();
  const clauses = [scope.clause];
  const params = [...scope.params];
  if (filter.boat) {
    params.push(filter.boat);
    clauses.push(`d.boat_code = $${params.length}`);
  }
  const facts = await loadFacts(db, await drawingRows(db, `WHERE ${clauses.join(" AND ")}`, params), at);
  const matching = filter.status ? facts.filter((f) => f.derived.status === filter.status) : facts;
  const page = slicePage(matching, (f) => f.row.num as number, "desc", `status=${filter.status ?? ""}&boat=${filter.boat ?? ""}`, request);
  return { ...page, items: page.items.map((f) => drawingView(f, role)) };
}

export const STATUS_FILTERS: readonly DrawingStatus[] = ["measuring", "remeasure", "drawn", "nested", "cutting", "cut", "pending_store", "issued"];

export async function createDrawing(actor: AccountRow, input: { boatCode: string; sail: Sail; clothCode: string }): Promise<string> {
  return transaction(async (db) => {
    const num = await nextCode(db, "drawing");
    const code = `BR-${String(num).padStart(4, "0")}`;
    await run(db, "INSERT INTO drawing (code, num, boat_code, sail, cloth_code, phase) VALUES ($1, $2, $3, $4, $5, 'measuring')", [code, num, input.boatCode, input.sail, input.clothCode]);
    await audit(db, { actor: actor.email, action: "drawing.create", target: code, after: "measuring" });
    return code;
  });
}

/** Draw: pin the rule set in force, build the crosscut panels and record the values the cut sheet will carry. */
export async function drawSail(actor: AccountRow, code: string): Promise<void> {
  await transaction(async (db) => {
    const at = now();
    await drawingRow(db, code, true);
    const facts = (await loadFact(db, code, at))!;
    if (isSealed(facts)) throw refuse("sealed");
    if (facts.derived.status === "remeasure") throw refuse("remeasure_required");
    if (facts.row.phase !== "measuring") throw refuse("wrong_state");
    const used = usedDimensions(facts.row.sail);
    const luff = facts.states[used.luff]!.value_mm;
    const foot = facts.states[used.foot]!.value_mm;
    if (luff === null || foot === null) throw refuse("wrong_state");
    const rule = await currentRuleSet(db, at);
    const cloth = (await one<{ usable_width_mm: number }>(db, "SELECT usable_width_mm FROM cloth WHERE code = $1", [facts.row.cloth_code]))!;
    const panels = buildPanels(luff, foot, cloth.usable_width_mm - rule.seam_overlap_mm);
    const sail = facts.row.sail as Sail;
    const area = sail === "mainsail" ? mainsailArea(luff, foot, rule.roach_permille) : headsailArea(foot, luff);
    const formula = sail === "mainsail" ? `P × E / 2 × ${roachText(rule.roach_permille)}` : "LP × LL / 2";
    const basis = `${formula} · tolerance ±${rule.tolerance_mm} mm · rule set v${rule.version}`;
    const recorded = Object.fromEntries([used.luff, used.foot].map((key) => [key, facts.states[key]!.value_mm]));
    await run(
      db,
      `UPDATE drawing SET phase = 'drawn', ruleset_version = $2, luff_mm = $3, foot_mm = $4, area_mm2 = $5, area_basis = $6,
         recorded_boat_name = $7, recorded_owner_name = $8, recorded_dims = $9 WHERE code = $1`,
      [code, rule.version, luff, foot, area, basis, facts.row.boat_name, facts.row.owner_name, JSON.stringify(recorded)],
    );
    for (const panel of panels) {
      await run(db, "INSERT INTO panel (drawing_code, number, outline, length_mm, width_mm, area_mm2) VALUES ($1, $2, $3, $4, $5, $6)", [
        code,
        panel.number,
        JSON.stringify(panel.outline),
        panel.length_mm,
        panel.width_mm,
        panel.area_mm2,
      ]);
    }
    await audit(db, { actor: actor.email, action: "drawing.draw", target: code, before: "measuring", after: "drawn" });
  });
}

export async function assignDrawing(actor: AccountRow, code: string, loftHand: AccountRow): Promise<void> {
  await transaction(async (db) => {
    const before = await one<{ email: string | null }>(db, "SELECT a.email FROM drawing d LEFT JOIN account a ON a.id = d.assigned_to WHERE d.code = $1 FOR UPDATE OF d", [code]);
    await run(db, "UPDATE drawing SET assigned_to = $2 WHERE code = $1", [code, loftHand.id]);
    await audit(db, { actor: actor.email, action: "drawing.assign", target: code, before: before?.email ?? null, after: loftHand.email });
  });
}

export async function reviseDrawing(actor: AccountRow, code: string): Promise<string> {
  return transaction(async (db) => {
    const at = now();
    await drawingRow(db, code, true);
    const facts = (await loadFact(db, code, at))!;
    if (facts.row.successor) throw refuse("already_revised");
    if (facts.row.phase !== "issued") throw refuse("wrong_state");
    const num = await nextCode(db, "drawing");
    const successor = `BR-${String(num).padStart(4, "0")}`;
    await run(
      db,
      "INSERT INTO drawing (code, num, boat_code, sail, cloth_code, phase, predecessor) VALUES ($1, $2, $3, $4, $5, 'measuring', $6)",
      [successor, num, facts.row.boat_code, facts.row.sail, facts.row.cloth_code, code],
    );
    await audit(db, { actor: actor.email, action: "drawing.revise", target: code, before: "issued", after: successor });
    return successor;
  });
}

/** Stepping back: a Drawn or Nested drawing whose used dimension changed loses its panels, area and lays. */
export async function stepBackDrawings(db: Queryable, boatCode: string): Promise<void> {
  const at = now();
  const facts = await loadFacts(db, await drawingRows(db, "WHERE d.boat_code = $1 AND d.phase = 'drawn'", [boatCode]), at);
  for (const fact of facts) {
    if (fact.panels.some((panel) => panel.cut)) continue;
    const recorded = fact.row.recorded_dims as Record<string, number>;
    const used = usedDimensions(fact.row.sail);
    const changed = [used.luff, used.foot].some((key) => fact.states[key]!.value_mm !== recorded[key] || fact.states[key]!.flagged);
    if (!changed) continue;
    const code = fact.row.code;
    await run(db, "DELETE FROM lay WHERE drawing_code = $1", [code]);
    await run(db, "DELETE FROM panel WHERE drawing_code = $1", [code]);
    await run(
      db,
      `UPDATE drawing SET phase = 'measuring', ruleset_version = NULL, luff_mm = NULL, foot_mm = NULL, area_mm2 = NULL, area_basis = NULL,
         recorded_boat_name = NULL, recorded_owner_name = NULL, recorded_dims = NULL WHERE code = $1`,
      [code],
    );
  }
}
