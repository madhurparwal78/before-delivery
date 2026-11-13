// Layout helpers shared by the routes modules.

import type { PoolClient } from 'pg';
import type { Problem } from '../shared/problems.js';
import { etagOf } from './boundary.js';
import type { EnrichedPlacement, LayoutRecord, PlacementRow, SiteRecord } from './layout-types.js';

export { etagOf };

export async function loadLayout(client: PoolClient, layoutId: string): Promise<{ layout: LayoutRecord; site: SiteRecord }> {
  const result = await client.query<LayoutRecord>('SELECT * FROM layouts WHERE id = $1', [layoutId]);
  const layout = result.rows[0];
  if (layout === undefined) {
    const missing: Problem = { status: 404, code: 'not_found' };
    throw new RouteProblem(missing);
  }
  const siteResult = await client.query<SiteRecord>('SELECT * FROM sites WHERE id = $1', [layout.site_id]);
  return { layout, site: siteResult.rows[0]! };
}

export class RouteProblem extends Error {
  constructor(readonly problem: Problem) {
    super(problem.code);
  }
}

export async function loadPlacements(client: PoolClient, layoutId: string): Promise<EnrichedPlacement[]> {
  const rows = await client.query<PlacementRow>(
    'SELECT * FROM placements WHERE layout_id = $1 ORDER BY position',
    [layoutId],
  );
  const holds = await client.query<{ id: string; status: string }>('SELECT id, status FROM holds');
  const holdStatus = new Map(holds.rows.map((h) => [h.id, h.status]));
  return rows.rows.map((row) => ({
    ...row,
    status: row.body_serial !== null ? 'Bodied' : row.hold_id !== null ? (holdStatus.get(row.hold_id) === 'Held' ? 'On hold' : 'Needs a body') : 'Needs a body',
  }));
}

export function rawPlacementRows(placements: EnrichedPlacement[]): PlacementRow[] {
  return placements.map((p) => ({
    id: p.id,
    body_serial: p.body_serial,
    hold_id: p.hold_id,
    model: p.model,
    lens_serial: p.lens_serial,
    aim_across: p.aim_across,
    aim_down: p.aim_down,
    body_across: p.body_across,
    body_down: p.body_down,
    standoff: p.standoff,
    ratio: p.ratio,
    shift_across: p.shift_across,
    shift_down: p.shift_down,
    circuit_id: p.circuit_id,
  }));
}

export function layoutJson(layout: LayoutRecord, placements: EnrichedPlacement[], etag: string): Record<string, unknown> {
  void etag;
  return {
    id: layout.id,
    siteId: layout.site_id,
    name: layout.name,
    version: layout.version,
    sheetStatus: layout.sheet_status,
    hash: layout.layout_hash,
    placements: placements.map((p) => ({
      id: p.id,
      status: p.status,
      bodySerial: p.body_serial,
      holdId: p.hold_id,
      model: p.model,
      lensSerial: p.lens_serial,
      aimAcross: p.aim_across,
      aimDown: p.aim_down,
      bodyAcross: p.body_across,
      bodyDown: p.body_down,
      standoff: p.standoff,
      ratio: p.ratio,
      shiftAcrossPercent: p.shift_across,
      shiftDownPercent: p.shift_down,
      circuitId: p.circuit_id,
    })),
  };
}

export function etagFor(version: number, hash: string): string {
  return etagOf(version, hash);
}

export { geometriesOf, cellInputs, four } from './layout-cells.js';
export { bumpLayout } from './layouts.js';
