/** Claims on free length, laying panels, and the confirmed cut that posts the ledger pairs. */
import { Ladder } from "./ladder.js";
import { lockNamed, nextCode, one, opaqueId, rows, run, transaction, type Queryable, type Row } from "./db.js";
import { audit } from "./audit.js";
import { autoPosition, outlineExtent, outlinesOverlap, placeOutline, type Placement } from "../shared/geometry.js";
import { effectiveClaimStatus } from "./drawing-state.js";
import { loadFact, drawingRow, isSealed, type DrawingFacts, type LayRow, type PanelRow } from "./drawings.js";
import { postPairs, type PairSpec, type PostedPair } from "./ledger.js";
import { ruleSetByVersion } from "./rules.js";
import { heldFigures, stockRow, stockView, stockViews } from "./stock.js";
import { personOf, type AccountRow } from "./accounts.js";
import { FieldErrors, Refusal, refuse } from "./errors.js";
import { instant, now, wholeSecond } from "./time.js";
import { config } from "./config.js";
import {
  FIELD,
  claimConflictCopy,
  claimTooLongCopy,
  layOverlapCopy,
  offClothCopy,
  panelLaidCopy,
  wholeNumberCopy,
} from "../shared/copy.js";
import { inLengthRange, MAX_LENGTH_MM } from "../shared/units.js";
import type { Claim, CutResult, DrawingStatus, Lay, LayResult, NextPosition, Outline } from "../shared/types.js";

async function authorityCovers(db: Queryable, loftHandId: string, at: Date): Promise<boolean> {
  const found = await one(
    db,
    `SELECT 1 FROM authority WHERE loft_hand_id = $1 AND valid_from <= $2 AND (valid_until IS NULL OR $2 < valid_until)
       AND (withdrawn_at IS NULL OR $2 < withdrawn_at) LIMIT 1`,
    [loftHandId, at],
  );
  return found !== null;
}

interface ClaimRow extends Row {
  id: string;
  stock_code: string;
  drawing_code: string;
  holder_id: string;
  length_mm: number;
  status: "held" | "cut" | "released";
  taken_at: Date;
  expires_at: Date;
  used_mm: number | null;
}

async function claimRow(db: Queryable, id: string, lock = false): Promise<ClaimRow | null> {
  return one<ClaimRow>(db, `SELECT * FROM claim WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id]);
}

/** A claim is visible to the sailmaker, and to a loft hand when its drawing is assigned to them. */
export async function visibleClaim(db: Queryable, actor: AccountRow, id: string): Promise<ClaimRow | null> {
  const claim = await claimRow(db, id);
  if (!claim) return null;
  if (actor.role === "sailmaker") return claim;
  if (actor.role !== "loft-hand") return null;
  const assigned = await one(db, "SELECT 1 FROM drawing WHERE code = $1 AND assigned_to = $2", [claim.drawing_code, actor.id]);
  return assigned ? claim : null;
}

const maxX = (outline: Outline): number => outlineExtent(outline).maxX;

function nextPositions(facts: DrawingFacts, claim: ClaimRow, usable: number, ownLays: LayRow[]): NextPosition[] {
  const laidOutlines = ownLays.map((lay) => lay.outline);
  return facts.panels
    .filter((panel) => !panel.cut && !facts.derived.laid.has(panel.number))
    .map((panel) => {
      const fit: Placement | null = autoPosition(panel, claim.length_mm, usable, laidOutlines);
      return { panel_number: panel.number, x_mm: fit?.x_mm ?? null, y_mm: fit?.y_mm ?? null, rotation: fit?.rotation ?? null };
    });
}

async function claimViews(db: Queryable, list: ClaimRow[], at: Date): Promise<Claim[]> {
  if (list.length === 0) return [];
  const [stocks, holders, lays] = await Promise.all([
    rows(db, "SELECT code, usable_width_mm FROM stock WHERE code = ANY($1)", [list.map((c) => c.stock_code)]),
    rows(db, "SELECT * FROM account WHERE id = ANY($1)", [list.map((c) => c.holder_id)]),
    rows<LayRow>(db, "SELECT * FROM lay WHERE claim_id = ANY($1) ORDER BY seq", [list.map((c) => c.id)]),
  ]);
  const facts = new Map<string, DrawingFacts>();
  for (const code of new Set(list.map((c) => c.drawing_code))) facts.set(code, (await loadFact(db, code, at))!);
  return list.map((claim) => {
    const status = effectiveClaimStatus(claim, at);
    const own = lays.filter((lay) => lay.claim_id === claim.id);
    const visible = status === "held" || status === "cut" ? own : [];
    const holder = holders.find((h) => h.id === claim.holder_id)!;
    const usable = stocks.find((s) => s.code === claim.stock_code)!.usable_width_mm as number;
    const remaining = status === "held" ? Math.max(0, Math.ceil((claim.expires_at.getTime() - at.getTime()) / 1000)) : 0;
    const used = status === "cut" ? (claim.used_mm ?? 0) : visible.reduce((largest, lay) => Math.max(largest, maxX(lay.outline)), 0);
    return {
      id: claim.id,
      stock_code: claim.stock_code,
      drawing_code: claim.drawing_code,
      holder: personOf(holder as AccountRow),
      length_mm: claim.length_mm,
      status,
      taken_at: instant(claim.taken_at),
      expires_at: instant(claim.expires_at),
      seconds_remaining: remaining,
      used_mm: used,
      lays: visible.map(
        (lay): Lay => ({ panel_number: lay.panel_number, x_mm: lay.x_mm, y_mm: lay.y_mm, rotation: lay.rotation, outline: lay.outline }),
      ),
      next_positions: status === "held" ? nextPositions(facts.get(claim.drawing_code)!, claim, usable, own) : [],
    };
  });
}

export async function claimViewById(db: Queryable, id: string, at: Date): Promise<Claim> {
  return (await claimViews(db, [(await claimRow(db, id))!], at))[0]!;
}

async function layResult(db: Queryable, claimId: string, at: Date): Promise<LayResult> {
  const claim = (await claimRow(db, claimId))!;
  const [view] = await claimViews(db, [claim], at);
  const stock = (await stockViews(db, [(await stockRow(db, claim.stock_code))!], at))[0]!;
  const facts = (await loadFact(db, claim.drawing_code, at))!;
  return { claim: view!, stock, drawing_status: facts.derived.status as DrawingStatus };
}

async function requireAuthority(db: Queryable, actor: AccountRow, claim: ClaimRow): Promise<void> {
  if (actor.role === "loft-hand" && !(await authorityCovers(db, actor.id, claim.taken_at))) throw refuse("no_authority_on_claim_date");
}

function requireOpen(claim: ClaimRow, at: Date): void {
  const status = effectiveClaimStatus(claim, at);
  if (status === "lapsed") throw refuse("claim_lapsed");
  if (status !== "held") throw refuse("claim_closed");
}

export async function takeClaim(
  actor: AccountRow,
  input: { drawingCode: unknown; stockCode: unknown; lengthMm: unknown },
): Promise<{ id: string; view: Claim }> {
  return transaction(async (db) => {
    const at = now();
    const ladder = new Ladder();
    const errors = new FieldErrors();
    const drawing = typeof input.drawingCode === "string" ? await drawingRow(db, input.drawingCode, true) : null;
    if (actor.role === "loft-hand" && (!drawing || drawing.assigned_to !== actor.id || !(await authorityCovers(db, actor.id, at)))) {
      ladder.consider(refuse("no_cutting_authority"));
    }
    let facts: DrawingFacts | null = null;
    if (drawing) {
      facts = (await loadFact(db, drawing.code, at))!;
      if (isSealed(facts)) ladder.consider(refuse("sealed"));
      else if (!["drawn", "nested", "cutting"].includes(facts.derived.status)) ladder.consider(refuse("wrong_state"));
    } else {
      errors.add("drawing_code", FIELD.drawing);
    }
    const stock = typeof input.stockCode === "string" ? await stockRow(db, input.stockCode, true) : null;
    if (!stock) errors.add("stock_code", FIELD.stock);
    const length = input.lengthMm;
    const validLength = typeof length === "number" && inLengthRange(length);
    if (!validLength) errors.add("length_mm", FIELD.lengthRange);
    if (stock && facts) {
      if (stock.cloth_code !== facts.row.cloth_code) errors.add("stock_code", FIELD.clothMismatch);
      else if (facts.derived.lot !== null && stock.lot !== facts.derived.lot) errors.add("stock_code", FIELD.lotMismatch);
    }
    if (!ladder.refused && stock && facts && validLength && errors.empty) {
      const held = (await heldFigures(db, [stock.code], at)).get(stock.code)?.heldMm ?? 0;
      const free = stock.remaining_mm - held;
      if ((length as number) > free) {
        const winner = await one(
          db,
          `SELECT c.id, a.email, a.display_name, a.deleted FROM claim c JOIN account a ON a.id = c.holder_id
            WHERE c.stock_code = $1 AND c.status = 'held' AND c.expires_at > $2 ORDER BY c.taken_at DESC, c.id DESC LIMIT 1`,
          [stock.code, at],
        );
        if (winner) {
          const name = personOf(winner as AccountRow).display_name;
          ladder.consider(new Refusal("claim_conflict", claimConflictCopy(name), { winner: { display_name: name, claim_id: winner.id } }));
        } else {
          errors.add("length_mm", claimTooLongCopy(stock.code));
        }
      }
    }
    ladder.settle(errors);
    const id = await opaqueId(db, "CL-");
    const takenAt = wholeSecond(at);
    await run(
      db,
      "INSERT INTO claim (id, stock_code, drawing_code, holder_id, length_mm, status, taken_at, expires_at) VALUES ($1, $2, $3, $4, $5, 'held', $6, $7)",
      [id, stock!.code, drawing!.code, actor.id, length, takenAt, new Date(takenAt.getTime() + config.claimHoldSeconds * 1000)],
    );
    await audit(db, { actor: actor.email, action: "claim.take", target: id, after: `held ${length} mm on ${stock!.code}` });
    return { id, view: await claimViewById(db, id, at) };
  });
}

async function lockedClaim(db: Queryable, id: string): Promise<ClaimRow> {
  const first = (await claimRow(db, id))!;
  await drawingRow(db, first.drawing_code, true);
  return (await claimRow(db, id, true))!;
}

export async function layPanel(actor: AccountRow, claimId: string, body: Record<string, unknown>): Promise<LayResult> {
  return transaction(async (db) => {
    const at = now();
    const claim = await lockedClaim(db, claimId);
    await requireAuthority(db, actor, claim);
    requireOpen(claim, at);
    const facts = (await loadFact(db, claim.drawing_code, at))!;
    const stock = (await stockRow(db, claim.stock_code))!;
    const errors = new FieldErrors();
    const number = body.panel_number;
    const panel: PanelRow | undefined = typeof number === "number" ? facts.panels.find((p) => p.number === number) : undefined;
    if (!panel) errors.add("panel_number", FIELD.panel);
    if (panel && (facts.derived.laid.has(panel.number) || panel.cut)) throw new Refusal("panel_laid", panelLaidCopy(panel.number));

    const given = ["x_mm", "y_mm", "rotation"].filter((member) => body[member] !== undefined);
    let placement: Placement | null = null;
    let explicit = false;
    if (given.length > 0 && given.length < 3) {
      errors.add("position", FIELD.position);
    } else if (given.length === 3) {
      explicit = true;
      const { x_mm: x, y_mm: y, rotation } = body;
      if (!Number.isInteger(x)) errors.add("x_mm", wholeNumberCopy(0, MAX_LENGTH_MM));
      if (!Number.isInteger(y)) errors.add("y_mm", wholeNumberCopy(0, MAX_LENGTH_MM));
      if (rotation !== 0 && rotation !== 180) errors.add("rotation", FIELD.rotation);
      if (errors.empty) placement = { x_mm: x as number, y_mm: y as number, rotation: rotation as 0 | 180 };
    }
    const ownLays = await rows<LayRow>(db, "SELECT * FROM lay WHERE claim_id = $1 ORDER BY seq", [claim.id]);
    if (panel && errors.empty && !explicit) {
      placement = autoPosition(panel, claim.length_mm, stock.usable_width_mm, ownLays.map((lay) => lay.outline));
      if (!placement) errors.add("position", offClothCopy(panel.number));
    }
    if (panel && placement) {
      const outline = placeOutline(panel, placement.x_mm, placement.y_mm, placement.rotation);
      const clash = ownLays.find((lay) => outlinesOverlap(outline, lay.outline));
      if (clash) throw new Refusal("lay_overlap", layOverlapCopy(panel.number, clash.panel_number));
      const box = outlineExtent(outline);
      if (box.minX < 0 || box.maxX > claim.length_mm || box.minY < 0 || box.maxY > stock.usable_width_mm) {
        errors.add("position", offClothCopy(panel.number));
      } else {
        errors.throwIfAny();
        await run(
          db,
          "INSERT INTO lay (claim_id, panel_number, drawing_code, x_mm, y_mm, rotation, outline, max_x) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [claim.id, panel.number, claim.drawing_code, placement.x_mm, placement.y_mm, placement.rotation, JSON.stringify(outline), box.maxX],
        );
        await audit(db, { actor: actor.email, action: "claim.lay", target: claim.id, after: `panel ${panel.number}` });
        return layResult(db, claim.id, at);
      }
    }
    errors.throwIfAny();
    throw refuse("wrong_state");
  });
}

export async function unlayPanel(actor: AccountRow, claimId: string, panelNumber: number): Promise<LayResult> {
  return transaction(async (db) => {
    const at = now();
    const claim = await lockedClaim(db, claimId);
    await requireAuthority(db, actor, claim);
    requireOpen(claim, at);
    const removed = await run(db, "DELETE FROM lay WHERE claim_id = $1 AND panel_number = $2", [claim.id, panelNumber]);
    if (removed === 0) throw refuse("not_found");
    await audit(db, { actor: actor.email, action: "claim.unlay", target: claim.id, before: `panel ${panelNumber}` });
    return layResult(db, claim.id, at);
  });
}

export async function releaseClaim(actor: AccountRow, claimId: string): Promise<Claim> {
  return transaction(async (db) => {
    const at = now();
    const claim = await lockedClaim(db, claimId);
    await requireAuthority(db, actor, claim);
    requireOpen(claim, at);
    await run(db, "DELETE FROM lay WHERE claim_id = $1", [claim.id]);
    await run(db, "UPDATE claim SET status = 'released' WHERE id = $1", [claim.id]);
    await audit(db, { actor: actor.email, action: "claim.release", target: claim.id, before: "held", after: "released" });
    return claimViewById(db, claim.id, at);
  });
}

interface StoredReply {
  status: number;
  body: string;
}

const refusalReply = (refusal: Refusal): StoredReply => ({ status: refusal.status, body: JSON.stringify(refusal.body) });

/** Confirm cut: the whole claimed length leaves the stock as balanced pairs; a key makes the answer replayable byte for byte. */
export async function cutClaim(actor: AccountRow, claimId: string, key: string | null): Promise<StoredReply> {
  return transaction(async (db) => {
    const at = now();
    const claim = await lockedClaim(db, claimId);
    await requireAuthority(db, actor, claim);
    if (key !== null) {
      await lockNamed(db, `cutkey:${key}`);
      const seen = await one<{ claim_id: string; status: number; body: string }>(db, "SELECT * FROM cut_key WHERE key = $1", [key]);
      if (seen) {
        if (seen.claim_id !== claim.id) throw refuse("idempotency_key_reused");
        return { status: seen.status, body: seen.body };
      }
    }
    const facts = (await loadFact(db, claim.drawing_code, at))!;
    const lays = await rows<LayRow>(db, "SELECT * FROM lay WHERE claim_id = $1 ORDER BY seq", [claim.id]);
    const refusal = cutRefusal(claim, facts, lays, at);
    if (key === null) {
      if (refusal) throw refusal;
      throw new Refusal("invalid", undefined, { fields: { "idempotency-key": FIELD.required } });
    }
    const reply = refusal ? refusalReply(refusal) : { status: 200, body: JSON.stringify(await performCut(db, actor, claim, facts, lays, at)) };
    await run(db, "INSERT INTO cut_key (key, claim_id, status, body) VALUES ($1, $2, $3, $4)", [key, claim.id, reply.status, reply.body]);
    return reply;
  });
}

function cutRefusal(claim: ClaimRow, facts: DrawingFacts, lays: LayRow[], at: Date): Refusal | null {
  const status = effectiveClaimStatus(claim, at);
  if (status === "cut") return refuse("already_cut");
  if (status === "lapsed") return refuse("claim_lapsed");
  if (status !== "held") return refuse("claim_closed");
  if (lays.length === 0) return refuse("claim_empty");
  const everyPanelAccounted = facts.panels.every((panel) => panel.cut || facts.derived.laid.has(panel.number));
  if (!everyPanelAccounted || !["nested", "cutting"].includes(facts.derived.status)) return refuse("not_nested");
  return null;
}

async function performCut(db: Queryable, actor: AccountRow, claim: ClaimRow, facts: DrawingFacts, lays: LayRow[], at: Date): Promise<CutResult> {
  const stock = (await stockRow(db, claim.stock_code, true))!;
  const rule = await ruleSetByVersion(db, facts.row.ruleset_version);
  const used = lays.reduce((largest, lay) => Math.max(largest, maxX(lay.outline)), 0);
  const tail = claim.length_mm - used;
  const panelArea = lays.reduce((sum, lay) => sum + facts.panels.find((p) => p.number === lay.panel_number)!.area_mm2, 0);
  const makesOffcut = tail >= rule.min_offcut_length_mm && stock.width_mm >= rule.min_offcut_width_mm;
  const offcutArea = makesOffcut ? stock.width_mm * tail : 0;
  const waste = stock.width_mm * claim.length_mm - panelArea - offcutArea;

  let offcutCode: string | null = null;
  if (makesOffcut) {
    const num = await nextCode(db, "offcut");
    offcutCode = `O-${String(num).padStart(2, "0")}`;
    await run(
      db,
      `INSERT INTO stock (code, num, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm, on_hand_mm2, shelf_location)
       VALUES ($1, $2, 'offcut', $3, $4, $5, $6, $7, $8, 'Offcut bin')`,
      [offcutCode, num, stock.cloth_code, stock.lot, stock.width_mm, stock.usable_width_mm, tail, offcutArea],
    );
  }
  const side = { account: stock.code, stockCode: stock.code };
  const specs: PairSpec[] = [
    { amount: -panelArea, first: side, second: { account: `panels ${claim.drawing_code}`, stockCode: stock.code }, drawingCode: claim.drawing_code, reason: "Panels cut" },
  ];
  if (offcutCode) {
    specs.push({ amount: -offcutArea, first: side, second: { account: offcutCode, stockCode: offcutCode }, drawingCode: claim.drawing_code, reason: "Offcut received" });
  }
  if (waste > 0) {
    specs.push({ amount: -waste, first: side, second: { account: "waste", stockCode: stock.code }, drawingCode: claim.drawing_code, reason: "Waste" });
  }
  const pairs: PostedPair[] = await postPairs(db, actor.email, specs);
  await run(db, "UPDATE stock SET remaining_mm = remaining_mm - $2, on_hand_mm2 = width_mm * (remaining_mm - $2) WHERE code = $1", [stock.code, claim.length_mm]);
  await run(db, "UPDATE claim SET status = 'cut', used_mm = $2 WHERE id = $1", [claim.id, used]);
  await run(db, "UPDATE panel SET cut = true WHERE drawing_code = $1 AND number = ANY($2)", [claim.drawing_code, lays.map((lay) => lay.panel_number)]);
  await audit(db, { actor: actor.email, action: "claim.cut", target: claim.id, before: "held", after: "cut" });

  const [view] = await claimViews(db, [(await claimRow(db, claim.id))!], at);
  const after = await stockRow(db, stock.code);
  const afterFigures = await heldFigures(db, [stock.code], at);
  const offcutRow = offcutCode ? await stockRow(db, offcutCode) : null;
  const updated = (await loadFact(db, claim.drawing_code, at))!;
  return {
    claim: view!,
    stock: stockView(after!, afterFigures.get(stock.code)),
    offcut: offcutRow ? stockView(offcutRow, undefined) : null,
    pairs,
    drawing_status: updated.derived.status,
  };
}

