import { transact, type Transaction } from '../db/pool';
import { renderCutSheet, type CutSheetInput, type CutSheetNest } from './cutsheet';
import { placedOutline, outlineBounds, type Rotation } from './nest';
import {
  claimsOf, clothByCode, drawingByCode, laysOfClaims, liveStatusOf, panelGeometry, panelsOf,
  ruleSetByVersion, stockByCode, type ClothRow, type DrawingRow, type Reader, type RuleSetRow, type StockRow,
} from './model';
import { CUT_SHEET_CONTENT_TYPE, confirmQuietly, cutSheetKey } from '../services/store';
import { sha256OfBytes } from '../services/s3';

/**
 * The one place that renders a drawing's cut sheet from the values recorded at
 * Draw and the nest of each Cut claim, and the one place that moves a drawing on
 * once the store has confirmed the bytes.
 */

export async function cutSheetInput(db: Reader, drawing: DrawingRow, now: Date): Promise<CutSheetInput> {
  const cloth = (await clothByCode(db, drawing.cloth_code)) as ClothRow;
  const ruleset = (await ruleSetByVersion(db, drawing.ruleset_version as number)) as RuleSetRow;
  const panels = await panelsOf(db, drawing.code);
  const claims = await claimsOf(db, drawing.code);
  const lays = await laysOfClaims(db, claims.map((claim) => claim.id));
  const byNumber = new Map(panels.map((panel) => [panel.number, panel]));

  const nests: CutSheetNest[] = [];
  for (const claim of claims) {
    if (liveStatusOf(claim, now) !== 'cut') continue;
    const stock = (await stockByCode(db, claim.stock_code)) as StockRow;
    const outlines = (lays.get(claim.id) ?? []).map((lay) => ({
      panel_number: lay.panel_number,
      outline: placedOutline(
        panelGeometry(byNumber.get(lay.panel_number) as never),
        lay.rotation as Rotation,
        lay.x_mm,
        lay.y_mm,
      ),
    }));
    const usedMm = outlines.reduce((most, entry) => Math.max(most, outlineBounds(entry.outline).maxX), 0);
    nests.push({
      stock_code: claim.stock_code,
      used_mm: usedMm,
      width_mm: stock.width_mm,
      lot: stock.lot,
      outlines,
    });
  }

  return {
    drawing_code: drawing.code,
    boat_name: drawing.draw_boat_name as string,
    sail: drawing.sail,
    owner_display_name: drawing.draw_owner_name as string,
    cloth_code: cloth.code,
    cloth_name: cloth.name,
    usable_width_mm: cloth.usable_width_mm,
    dimensions: drawing.draw_dimensions ?? [],
    area_mm2: Number(drawing.area_mm2),
    area_basis: drawing.area_basis as string,
    seam_overlap_mm: ruleset.seam_overlap_mm,
    tolerance_mm: ruleset.tolerance_mm,
    ruleset_version: ruleset.version,
    panels: panels.map((panel) => ({
      number: panel.number,
      length_mm: panel.length_mm,
      width_mm: panel.width_mm,
      area_mm2: Number(panel.area_mm2),
      outline: panel.outline,
    })),
    nests,
    predecessor: drawing.predecessor,
  };
}

export interface RenderedSheet {
  readonly bytes: Buffer;
  readonly sha256: string;
  readonly key: string;
}

export async function renderSheet(db: Reader, drawing: DrawingRow, now: Date): Promise<RenderedSheet> {
  const bytes = renderCutSheet(await cutSheetInput(db, drawing, now));
  const digest = sha256OfBytes(bytes);
  return { bytes, sha256: digest, key: cutSheetKey(drawing.code, digest) };
}

/**
 * Tries to issue one drawing. The drawing becomes Issued only when the bytes
 * read back have the rendered length and a matching digest.
 */
export async function tryIssue(db: Reader, drawing: DrawingRow, now: Date): Promise<boolean> {
  const sheet = await renderSheet(db, drawing, now);
  const confirmed = await confirmQuietly(sheet.key, sheet.bytes, CUT_SHEET_CONTENT_TYPE, {
    sha256: sheet.sha256,
  });
  await transact(async (tx) => {
    await recordSheet(tx, drawing.code, sheet, confirmed);
  });
  return confirmed;
}

export async function recordSheet(
  tx: Transaction,
  code: string,
  sheet: RenderedSheet,
  confirmed: boolean,
): Promise<void> {
  await tx.query(
    `UPDATE drawing SET cut_sheet_sha256 = $2, cut_sheet_size = $3, cut_sheet_key = $4,
        status = CASE WHEN $5 THEN 'issued' ELSE 'pending_store' END
      WHERE code = $1 AND status IN ('cut','pending_store')`,
    [code, sheet.sha256, sheet.bytes.length, sheet.key, confirmed],
  );
}

/** Every instance retries every Pending store drawing, with no job and no restart. */
export async function retryPendingStore(db: Reader, now: Date): Promise<void> {
  const rows = await db.query<{ code: string }>(
    `SELECT code FROM drawing WHERE status = 'pending_store' ORDER BY code_number(code) ASC`,
  );
  for (const row of rows) {
    const drawing = await drawingByCode(db, row.code);
    if (drawing === null || drawing.ruleset_version === null) continue;
    await tryIssue(db, drawing, now);
  }
}
