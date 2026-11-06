import { boardPackage, component, SLOTS, type Component, type Slot } from './catalog.js';
import { buildShape, type BuildPicks, type BuildShape } from './builds.js';
import type { Queryable } from './cart.js';

interface BuildRow {
  code: string;
  board_sku: string;
  wing: string;
  mast: string;
  propulsion: string;
  battery: string;
  controller: string;
  spares: number;
  rider_kg: number;
  gear: number;
}

export function shapeFromPicks(picks: BuildPicks): BuildShape {
  const pkg = boardPackage(picks.board_sku);
  if (!pkg) throw new Error(`Saved build names unknown board ${picks.board_sku}`);
  const parts = {} as Record<Slot, Component>;
  for (const slot of SLOTS) {
    const part = component(picks[slot]);
    if (!part) throw new Error(`Saved build names unknown part ${picks[slot]}`);
    parts[slot] = part;
  }
  return buildShape(pkg, parts, picks);
}

/** A saved build, priced at the current price. */
export async function buildFromCode(db: Queryable, code: string): Promise<BuildShape | null> {
  const row = (await db.query('SELECT * FROM builds WHERE code = $1', [code])).rows[0] as unknown as
    | BuildRow
    | undefined;
  if (!row) return null;
  return shapeFromPicks({
    board_sku: row.board_sku,
    wing: row.wing,
    mast: row.mast,
    propulsion: row.propulsion,
    battery: row.battery,
    controller: row.controller,
    spares: row.spares,
    rider_kg: row.rider_kg,
    gear: row.gear,
  });
}

export async function saveBuild(db: Queryable, picks: BuildPicks, code: string, at: Date): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO builds (code, board_sku, wing, mast, propulsion, battery, controller, spares, rider_kg, gear, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (code) DO NOTHING`,
    [
      code,
      picks.board_sku,
      picks.wing,
      picks.mast,
      picks.propulsion,
      picks.battery,
      picks.controller,
      picks.spares,
      picks.rider_kg,
      picks.gear,
      at,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}
