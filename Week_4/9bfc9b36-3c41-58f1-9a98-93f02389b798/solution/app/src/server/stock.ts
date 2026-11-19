/** Rolls and offcuts: the shelf figures, receiving a roll, editing, and shelf counts. */
import { nextCode, one, rows, run, transaction, type Queryable, type Row } from "./db.js";
import { audit } from "./audit.js";
import { postPairs } from "./ledger.js";
import { FieldErrors, refuse } from "./errors.js";
import * as check from "./validate.js";
import { FIELD } from "../shared/copy.js";
import { instant, now, wholeSecond } from "./time.js";
import { inchesOf, squareFeetOf, squareMetresOf } from "../shared/units.js";
import type { AccountRow } from "./accounts.js";
import type { Stock, StockSummary } from "../shared/types.js";

interface HeldFigures {
  heldMm: number;
  usedMm: number;
}

/** Live holds per stock item: the length each reserves and the length its laid panels actually use. */
export async function heldFigures(db: Queryable, codes: string[], at: Date): Promise<Map<string, HeldFigures>> {
  const found = new Map<string, HeldFigures>();
  if (codes.length === 0) return found;
  const list = await rows(
    db,
    `SELECT c.stock_code, sum(c.length_mm)::int AS held,
            sum(COALESCE((SELECT max(l.max_x) FROM lay l WHERE l.claim_id = c.id), 0))::int AS used
       FROM claim c WHERE c.status = 'held' AND c.expires_at > $2 AND c.stock_code = ANY($1) GROUP BY c.stock_code`,
    [codes, at],
  );
  for (const row of list) found.set(row.stock_code, { heldMm: row.held, usedMm: row.used });
  return found;
}

export function stockView(row: Row, figures: HeldFigures | undefined): Stock {
  const held = figures?.heldMm ?? 0;
  const used = figures?.usedMm ?? 0;
  const afterLaid = row.remaining_mm - used;
  return {
    code: row.code,
    kind: row.kind,
    cloth_code: row.cloth_code,
    lot: row.lot,
    width_mm: row.width_mm,
    usable_width_mm: row.usable_width_mm,
    remaining_mm: row.remaining_mm,
    remaining_in: inchesOf(row.remaining_mm),
    free_mm: row.remaining_mm - held,
    after_laid_mm: afterLaid,
    after_laid_in: inchesOf(afterLaid),
    on_hand_mm2: row.on_hand_mm2,
    on_hand_m2: squareMetresOf(row.on_hand_mm2),
    on_hand_ft2: squareFeetOf(row.on_hand_mm2),
    shelf_location: row.shelf_location,
    note: row.note,
    last_count: row.last_count_at ? { counted_mm: row.last_count_mm, at: instant(row.last_count_at) } : null,
    revision: row.revision,
  };
}

export async function stockViews(db: Queryable, list: Row[], at: Date): Promise<Stock[]> {
  const held = await heldFigures(db, list.map((row) => row.code), at);
  return list.map((row) => stockView(row, held.get(row.code)));
}

export async function stockRow(db: Queryable, code: string, lock = false): Promise<Row | null> {
  return one(db, `SELECT * FROM stock WHERE code = $1 ${lock ? "FOR UPDATE" : ""}`, [code]);
}

export async function stockViewByCode(db: Queryable, code: string): Promise<Stock> {
  const at = now();
  return (await stockViews(db, [(await stockRow(db, code))!], at))[0]!;
}

export async function stockSummary(db: Queryable): Promise<StockSummary> {
  const row = (await one<{ rolls: number; offcuts: number; area: number }>(
    db,
    `SELECT count(*) FILTER (WHERE kind = 'roll')::int AS rolls, count(*) FILTER (WHERE kind = 'offcut')::int AS offcuts,
            COALESCE(sum(on_hand_mm2), 0)::bigint AS area FROM stock`,
  ))!;
  return { rolls: row.rolls, offcuts: row.offcuts, on_hand_mm2: row.area, on_hand_m2: squareMetresOf(row.area), on_hand_ft2: squareFeetOf(row.area) };
}

export async function receiveRoll(actor: AccountRow, input: { clothCode: string; lot: string; lengthMm: number; shelfLocation: string }): Promise<string> {
  return transaction(async (db) => {
    const cloth = (await one<{ width_mm: number; usable_width_mm: number }>(db, "SELECT width_mm, usable_width_mm FROM cloth WHERE code = $1", [input.clothCode]))!;
    const num = await nextCode(db, "roll");
    const code = `R-${String(num).padStart(2, "0")}`;
    const area = cloth.width_mm * input.lengthMm;
    await run(
      db,
      `INSERT INTO stock (code, num, kind, cloth_code, lot, width_mm, usable_width_mm, remaining_mm, on_hand_mm2, shelf_location)
       VALUES ($1, $2, 'roll', $3, $4, $5, $6, $7, $8, $9)`,
      [code, num, input.clothCode, input.lot, cloth.width_mm, cloth.usable_width_mm, input.lengthMm, area, input.shelfLocation],
    );
    await postPairs(db, actor.email, [
      {
        amount: area,
        first: { account: code, stockCode: code },
        second: { account: "supplier-receipt", stockCode: code },
        drawingCode: "",
        reason: "Received, full roll",
      },
    ]);
    await audit(db, { actor: actor.email, action: "stock.receive", target: code, after: `${input.lengthMm} mm` });
    return code;
  });
}

export async function updateStock(actor: AccountRow, code: string, revision: number, change: { shelfLocation?: string; note?: string }): Promise<void> {
  await transaction(async (db) => {
    const locked = (await stockRow(db, code, true))!;
    if (locked.revision !== revision) throw refuse("stale_revision");
    await run(db, "UPDATE stock SET shelf_location = $2, note = $3, revision = revision + 1 WHERE code = $1", [
      code,
      change.shelfLocation ?? locked.shelf_location,
      change.note ?? locked.note,
    ]);
    await audit(db, { actor: actor.email, action: "stock.update", target: code, before: locked.shelf_location, after: change.shelfLocation ?? locked.shelf_location });
  });
}

/** Records a shelf count: nothing posts when it matches; otherwise a counted adjustment pair, and the ledger equals the count. */
export async function recordCount(actor: AccountRow, code: string, body: check.Body): Promise<void> {
  await transaction(async (db) => {
    const at = now();
    const locked = (await stockRow(db, code, true))!;
    const held = await heldFigures(db, [code], at);
    if ((held.get(code)?.heldMm ?? 0) > 0) throw refuse("wrong_state");
    const errors = new FieldErrors();
    const counted = check.wholeNumber(errors, body, "counted_length_mm", 0, 60000);
    const differs = counted !== undefined && counted !== locked.remaining_mm;
    const reason = differs ? check.reason(errors, body, "reason", FIELD.countReason) : "";
    errors.throwIfAny();
    const difference = locked.width_mm * (counted! - locked.remaining_mm);
    if (difference !== 0) {
      await postPairs(db, actor.email, [
        {
          amount: difference,
          first: { account: code, stockCode: code },
          second: { account: "count-adjustment", stockCode: code },
          drawingCode: "",
          reason: reason!,
        },
      ]);
    }
    await run(db, "UPDATE stock SET remaining_mm = $2, on_hand_mm2 = $3, last_count_mm = $2, last_count_at = $4 WHERE code = $1", [
      code,
      counted,
      locked.width_mm * counted!,
      wholeSecond(at),
    ]);
    await audit(db, { actor: actor.email, action: "stock.count", target: code, before: String(locked.remaining_mm), after: String(counted), reason: difference === 0 ? null : reason });
  });
}
