import { mm2ToFt2, mm2ToM2, mmToInch2 } from '../domain/units.ts';
import { firstFit, placedOutline, type PanelShape } from '../domain/nesting.ts';
import type { Caller } from './caller.ts';
import type { DbClient } from './db.ts';
import { foretriangleArea } from '../domain/sail.ts';

export interface StockRow {
  [k: string]: unknown;
  code: string;
  kind: 'roll' | 'offcut';
  cloth_code: string;
  lot: string;
  width_mm: number;
  usable_width_mm: number;
  remaining_mm: number;
  on_hand_mm2: string | number;
  shelf_location: string;
  note: string;
  last_counted_mm: number | null;
  last_counted_at: Date | null;
  revision: number;
}

export interface ClaimLayRow {
  panel_number: number;
  x_mm: number;
  y_mm: number;
  rotation: number;
  [k: string]: unknown;
}

export interface ClaimRow {
  id: string;
  stock_code: string;
  drawing_code: string;
  holder_id: string;
  holder_name: string;
  length_mm: number;
  status: 'held' | 'cut' | 'lapsed' | 'released';
  taken_at: Date;
  expires_at: Date;
  [k: string]: unknown;
}

export async function freeMm(db: DbClient, stockCode: string): Promise<{ remaining: number; free: number }> {
  const rows = await db.query<{ remaining_mm: number; free: string }>(
    `SELECT s.remaining_mm,
            s.remaining_mm - COALESCE((SELECT SUM(c.length_mm) FROM claims c WHERE c.stock_code = s.code AND c.status='held' AND c.expires_at > now()),0) AS free
     FROM stock s WHERE s.code = $1`,
    [stockCode],
  );
  const row = rows[0];
  return { remaining: row?.remaining_mm ?? 0, free: Number(row?.free ?? 0) };
}

/** after_laid_mm: remaining less the used lengths of the item's live Held claims. */
export async function afterLaidMm(db: DbClient, stockCode: string): Promise<number> {
  const rows = await db.query<{ after: string }>(
    `SELECT s.remaining_mm - COALESCE((SELECT SUM(x.used) FROM (
        SELECT c.id, (SELECT COALESCE(MAX(x2.x_mm + p2.mx), 0) AS used FROM lays l2,
          LATERAL (SELECT panel_number) pp, LATERAL (SELECT 0) p2 WHERE l2.claim_id = c.id) x
        ) x WHERE c.stock_code = s.code AND c.status='held' AND c.expires_at > now()), 0) AS after
     FROM stock s WHERE s.code = $1`,
    [stockCode],
  );
  return Number(rows[0]?.after ?? 0);
}

export function stockView(s: StockRow, free: number, afterLaid: number): Record<string, unknown> {
  const onHand = Number(s.on_hand_mm2);
  return {
    code: s.code,
    kind: s.kind,
    cloth_code: s.cloth_code,
    lot: s.lot,
    width_mm: s.width_mm,
    usable_width_mm: s.usable_width_mm,
    remaining_mm: s.remaining_mm,
    remaining_in: mmToInch2(s.remaining_mm),
    free_mm: free,
    after_laid_mm: afterLaid,
    after_laid_in: mmToInch2(afterLaid),
    on_hand_mm2: onHand,
    on_hand_m2: mm2ToM2(onHand),
    on_hand_ft2: mm2ToFt2(onHand),
    shelf_location: s.shelf_location,
    note: s.note,
    last_count: s.last_counted_mm === null || s.last_counted_at === null ? null : { counted_mm: s.last_counted_mm, at: apiTs(s.last_counted_at) },
    revision: s.revision,
  };
}

export function apiTs(d: Date): string {
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

/** The claim body, with next_positions derived now. */
export async function claimView(db: DbClient, claim: ClaimRow, panels: PanelShape[], usableWidth: number, lapsing: boolean): Promise<Record<string, unknown>> {
  const lays = await db.query<ClaimLayRow>(
    `SELECT panel_number, x_mm, y_mm, rotation FROM lays WHERE claim_id=$1 ORDER BY panel_number`,
    [claim.id],
  );
  const laidOutlines = lays.map((l) => placedOutline(panels.find((p) => p.number === l.panel_number)!, l.x_mm, l.y_mm, l.rotation as 0 | 180));
  const used = lays.reduce((m, l) => Math.max(m, l.x_mm + panels.find((p) => p.number === l.panel_number)!.length_mm), 0);
  const laidPanels = new Set(lays.map((l) => l.panel_number));
  const holder = await db.query<{ email_norm: string; display_name: string; deleted: boolean }>(
    `SELECT email_norm, display_name, deleted FROM accounts WHERE id=$1`, [claim.holder_id],
  );
  const h = holder[0]!;
  const nextPositions: { panel_number: number; x_mm: number | null; y_mm: number | null; rotation: 0 | 180 | null }[] = [];
  if (!lapsing) {
    for (const p of panels) {
      if (laidPanels.has(p.number)) continue;
      const fit = firstFit(p, claim.length_mm, usableWidth, laidOutlines);
      nextPositions.push({
        panel_number: p.number,
        x_mm: fit ? fit.x : null,
        y_mm: fit ? fit.y : null,
        rotation: fit ? fit.rotation : null,
      });
    }
  }
  const seconds = lapsing ? 0 : Math.max(0, Math.ceil((claim.expires_at.getTime() - Date.now()) / 1000));
  return {
    id: claim.id,
    stock_code: claim.stock_code,
    drawing_code: claim.drawing_code,
    holder: { email: h.email_norm, display_name: h.deleted ? 'Former account' : h.display_name },
    length_mm: claim.length_mm,
    status: lapsing && claim.status === 'held' ? 'lapsed' : claim.status,
    taken_at: apiTs(claim.taken_at),
    expires_at: apiTs(claim.expires_at),
    seconds_remaining: seconds,
    used_mm: used,
    lays: lapsing ? [] : lays.map((l) => ({
      panel_number: l.panel_number,
      x_mm: l.x_mm,
      y_mm: l.y_mm,
      rotation: l.rotation,
      outline: placedOutline(panels.find((p) => p.number === l.panel_number)!, l.x_mm, l.y_mm, l.rotation as 0 | 180),
    })),
    next_positions: lapsing ? [] : nextPositions,
  };
}

/** The boat projection, with the foretriangle area and dimensions derived. */
export async function boatView(db: DbClient, boat: { code: string; name: string; class_name: string; owner_id: string; notes: string; revision: number }, owner: { email_norm: string; display_name: string; deleted: boolean }, tolerance: number, rulesetVersion: number, forRole: Caller['role'] | null): Promise<Record<string, unknown>> {
  void rulesetVersion;
  const dims = await dimensionViews(db, boat.code, tolerance, forRole);
  const dimsI = dims.find((d) => d['key'] === 'I') as { value_mm: number } | undefined;
  const dimsJ = dims.find((d) => d['key'] === 'J') as { value_mm: number } | undefined;
  const foretriangle = foretriangleArea(dimsI?.value_mm ?? 0, dimsJ?.value_mm ?? 0);
  const out: Record<string, unknown> = {
    code: boat.code,
    name: boat.name,
    class_name: boat.class_name,
    owner: { email: owner.email_norm, display_name: owner.deleted ? 'Former account' : owner.display_name },
    dimensions: dims,
    foretriangle: {
      area_mm2: foretriangle,
      area_m2: mm2ToM2(foretriangle),
      area_ft2: mm2ToFt2(foretriangle),
      basis: `I × J / 2 · tolerance ±${tolerance} mm · rule set v${rulesetVersion}`,
    },
  };
  if (forRole !== 'yacht-owner') {
    out['notes'] = boat.notes;
    out['revision'] = boat.revision;
  }
  return out;
}

export interface DimensionView {
  key: string;
  value_mm: number;
  status: 'measured' | 'remeasure';
  remeasure_due: string | null;
}

export async function dimensionViews(db: DbClient, boatCode: string, tolerance: number, forRole: Caller['role'] | null): Promise<Record<string, unknown>[]> {
  const rows = await db.query<{
    dimension: string; value_mm: number; measured_on: string; source: string; submission_id: string | null;
    id: string; photo_key: string | null; photo_size: number | null; photo_sha256: string | null; photo_content_type: string | null; ord: number;
  }>(
    `SELECT dimension, value_mm, measured_on, source, submission_id, id, photo_key, photo_size, photo_sha256, photo_content_type, ord
     FROM measurements WHERE boat_code=$1 ORDER BY dimension, ord`,
    [boatCode],
  );
  const byDim = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byDim.get(r.dimension) ?? [];
    list.push(r);
    byDim.set(r.dimension, list);
  }
  const out: Record<string, unknown>[] = [];
  for (const key of ['I', 'J', 'P', 'E', 'LL', 'LP']) {
    const list = byDim.get(key) ?? [];
    if (list.length === 0) {
      out.push({ key, value_mm: null, value_in: null, status: 'measured', remeasure_due: null, measurements: [] });
      continue;
    }
    const latest = list[list.length - 1]!;
    const previous = list[list.length - 2];
    const status: 'measured' | 'remeasure' = previous && Math.abs(latest.value_mm - previous.value_mm) > tolerance ? 'remeasure' : 'measured';
    const due = status === 'remeasure' ? await remeasureDue(latest.measured_on, db) : null;
    const measurements = list.map((m) => ({
      id: m.id,
      value_mm: m.value_mm,
      value_in: mmToInch2(m.value_mm),
      measured_on: m.measured_on,
      source: m.source,
      submission_id: m.submission_id,
      photo: m.photo_key === null
        ? null
        : forRole === 'yacht-owner'
          ? { size: m.photo_size, sha256: m.photo_sha256 }
          : { key: m.photo_key, size: m.photo_size, sha256: m.photo_sha256, content_type: m.photo_content_type },
    }));
    out.push({
      key,
      value_mm: latest.value_mm,
      value_in: mmToInch2(latest.value_mm),
      status,
      remeasure_due: due,
      measurements,
    });
  }
  return out;
}

/** The 5th loft working day after the flagging date. */
export async function remeasureDue(on: string, db: DbClient): Promise<string | null> {
  const closures = new Set((await db.query<{ date: string }>(`SELECT to_char(date,'YYYY-MM-DD') AS date FROM closures`)).map((r) => r.date));
  const d = new Date(`${on}T00:00:00Z`);
  let counted = 0;
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    if (day === 0 || day === 6 || closures.has(iso)) continue;
    counted += 1;
    if (counted === 5) return iso;
  }
}
