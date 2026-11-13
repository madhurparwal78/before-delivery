import { createHash, randomUUID } from 'node:crypto';
import { type Queryable, type Row, query, queryOne } from '../db/pool.js';
import { CELL_METRES, cellCentre, parseCellName } from '../domain/cells.js';
import { CIRCUIT_CAPACITY_WATTS, effectiveLumens } from '../domain/catalogue.js';
import { type Decimal, toFixed } from '../domain/decimal.js';
import {
  type CellLight,
  type PlacementOptics,
  covers,
  lightCell,
  projectionOf,
} from '../domain/photometrics.js';
import { round4 } from '../domain/round.js';
import { LENGTH_SCALE } from '../domain/units.js';
import { writeEvent } from '../events/outbox.js';
import { problem } from '../http/problem.js';
import { boundSerials, SHELF, siteLocation } from './kit.js';
import { type SiteRecord, cellGround, requireSite, sortedCellNames } from './sites.js';

export type PlacementStatus = 'Bodied' | 'On hold' | 'Needs a body';

export interface PlacementRecord {
  readonly id: string;
  readonly ordinal: number;
  readonly bodySerial: string | null;
  readonly holdId: string | null;
  readonly model: string;
  readonly lensSerial: string;
  readonly aimAcross: string;
  readonly aimDown: string;
  readonly bodyAcross: string;
  readonly bodyDown: string;
  readonly standoff: string;
  readonly ratio: string;
  readonly shiftAcrossPercent: string;
  readonly shiftDownPercent: string;
  readonly circuitId: string;
  readonly ratedLumens: number;
  readonly ratedHours: number;
  readonly nativeWidthPx: number;
  readonly nativeHeightPx: number;
  readonly watts: number;
  readonly loggedHours: string;
  readonly holdStatus: string | null;
}

export interface LayoutRecord {
  readonly id: string;
  readonly siteId: string;
  readonly name: string;
  readonly version: number;
  readonly hash: string;
  readonly sheetStatus: string;
  readonly sheetId: string | null;
  readonly placements: readonly PlacementRecord[];
}

export interface PlacementView {
  readonly id: string;
  readonly status: PlacementStatus;
  readonly bodySerial: string | null;
  readonly holdId: string | null;
  readonly model: string;
  readonly lensSerial: string;
  readonly aimAcross: string;
  readonly aimDown: string;
  readonly bodyAcross: string;
  readonly bodyDown: string;
  readonly standoff: string;
  readonly ratio: string;
  readonly shiftAcrossPercent: string;
  readonly shiftDownPercent: string;
  readonly circuitId: string;
  readonly imageWidthMetres: number;
  readonly imageHeightMetres: number;
  readonly throwMetres: number;
  readonly obliquityDegrees: number;
}

export interface LayoutView {
  readonly id: string;
  readonly siteId: string;
  readonly name: string;
  readonly version: number;
  readonly sheetStatus: string;
  readonly sheetId: string | null;
  readonly hash: string;
  readonly placements: readonly PlacementView[];
}

const PLACEMENT_COLUMNS = `p.id, p.ordinal, p.body_serial, p.hold_id, p.model, p.lens_serial,
  p.aim_across, p.aim_down, p.body_across, p.body_down, p.standoff, p.ratio,
  p.shift_across_percent, p.shift_down_percent, p.circuit_id,
  m.rated_lumens, m.rated_hours, m.native_width_px, m.native_height_px, m.watts,
  coalesce(u.logged_hours, h.logged_hours, 0) as logged_hours, h.status as hold_status`;

const PLACEMENT_FROM = `from placements p
  join models m on m.code = p.model
  left join units u on u.serial = p.body_serial
  left join holds h on h.id = p.hold_id`;

function toPlacement(row: Row): PlacementRecord {
  return {
    id: row['id'] as string,
    ordinal: Number(row['ordinal']),
    bodySerial: (row['body_serial'] as string | null) ?? null,
    holdId: (row['hold_id'] as string | null) ?? null,
    model: row['model'] as string,
    lensSerial: row['lens_serial'] as string,
    aimAcross: row['aim_across'] as string,
    aimDown: row['aim_down'] as string,
    bodyAcross: row['body_across'] as string,
    bodyDown: row['body_down'] as string,
    standoff: row['standoff'] as string,
    ratio: row['ratio'] as string,
    shiftAcrossPercent: row['shift_across_percent'] as string,
    shiftDownPercent: row['shift_down_percent'] as string,
    circuitId: row['circuit_id'] as string,
    ratedLumens: Number(row['rated_lumens']),
    ratedHours: Number(row['rated_hours']),
    nativeWidthPx: Number(row['native_width_px']),
    nativeHeightPx: Number(row['native_height_px']),
    watts: Number(row['watts']),
    loggedHours: String(row['logged_hours']),
    holdStatus: (row['hold_status'] as string | null) ?? null,
  };
}

export async function findLayout(layoutId: string): Promise<LayoutRecord | null> {
  const layout = await queryOne(
    `select l.*, coalesce(s.status, 'Draft') as sheet_status, s.id as sheet_id
     from layouts l
     left join sheets s on s.layout_id = l.id and s.status <> 'Withdrawn'
     where l.id = $1`,
    [layoutId],
  );
  if (layout === null) return null;
  const placements = await query(`select ${PLACEMENT_COLUMNS} ${PLACEMENT_FROM} where p.layout_id = $1 order by p.ordinal`, [
    layoutId,
  ]);
  return {
    id: layout['id'] as string,
    siteId: layout['site_id'] as string,
    name: layout['name'] as string,
    version: Number(layout['version']),
    hash: layout['hash'] as string,
    sheetStatus: layout['sheet_status'] as string,
    sheetId: (layout['sheet_id'] as string | null) ?? null,
    placements: placements.map(toPlacement),
  };
}

export async function requireLayout(layoutId: string): Promise<LayoutRecord> {
  const layout = await findLayout(layoutId);
  if (layout === null) throw problem('not_found');
  return layout;
}

export function placementStatus(placement: PlacementRecord): PlacementStatus {
  if (placement.bodySerial !== null) return 'Bodied';
  if (placement.holdId !== null && placement.holdStatus === 'Held') return 'On hold';
  return 'Needs a body';
}

export function opticsOf(placement: PlacementRecord): PlacementOptics {
  return {
    id: placement.id,
    ordinal: placement.ordinal,
    aimAcross: Number(placement.aimAcross),
    aimDown: Number(placement.aimDown),
    bodyAcross: Number(placement.bodyAcross),
    bodyDown: Number(placement.bodyDown),
    standoff: Number(placement.standoff),
    ratio: Number(placement.ratio),
    shiftAcrossPercent: Number(placement.shiftAcrossPercent),
    shiftDownPercent: Number(placement.shiftDownPercent),
    effectiveLumens: effectiveLumens(placement.ratedLumens, placement.ratedHours, Number(placement.loggedHours)),
    nativeWidthPx: placement.nativeWidthPx,
    nativeHeightPx: placement.nativeHeightPx,
  };
}

export function layoutView(layout: LayoutRecord): LayoutView {
  return {
    id: layout.id,
    siteId: layout.siteId,
    name: layout.name,
    version: layout.version,
    sheetStatus: layout.sheetStatus,
    sheetId: layout.sheetId,
    hash: layout.hash,
    placements: layout.placements.map((placement) => {
      const projection = projectionOf(opticsOf(placement));
      return {
        id: placement.id,
        status: placementStatus(placement),
        bodySerial: placement.bodySerial,
        holdId: placement.holdId,
        model: placement.model,
        lensSerial: placement.lensSerial,
        aimAcross: placement.aimAcross,
        aimDown: placement.aimDown,
        bodyAcross: placement.bodyAcross,
        bodyDown: placement.bodyDown,
        standoff: placement.standoff,
        ratio: placement.ratio,
        shiftAcrossPercent: placement.shiftAcrossPercent,
        shiftDownPercent: placement.shiftDownPercent,
        circuitId: placement.circuitId,
        imageWidthMetres: round4(projection.imageWidthMetres),
        imageHeightMetres: round4(projection.imageHeightMetres),
        throwMetres: round4(projection.throwMetres),
        obliquityDegrees: round4(projection.obliquityDegrees),
      };
    }),
  };
}

export function entityTag(layout: { readonly id: string; readonly version: number }): string {
  return `"${layout.id}:${layout.version}"`;
}

export interface PlacementData {
  readonly bodySerial: string | null;
  readonly holdId: string | null;
  readonly model: string;
  readonly lensSerial: string;
  readonly aimAcross: string;
  readonly aimDown: string;
  readonly bodyAcross: string;
  readonly bodyDown: string;
  readonly standoff: string;
  readonly ratio: string;
  readonly shiftAcrossPercent: string;
  readonly shiftDownPercent: string;
  readonly circuitId: string;
}

/** The hash of the canonical placement data, in placement order. */
export function layoutHash(placements: readonly PlacementData[]): string {
  const canonical = placements.map((placement) => [
    placement.bodySerial ?? '',
    placement.holdId ?? '',
    placement.model,
    placement.lensSerial,
    placement.aimAcross,
    placement.aimDown,
    placement.bodyAcross,
    placement.bodyDown,
    placement.standoff,
    placement.ratio,
    placement.shiftAcrossPercent,
    placement.shiftDownPercent,
    placement.circuitId,
  ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Every committed layout write lands here: it bumps the version, re-reads the
 * hash, puts any issued sheet out of step and writes one layout.changed event.
 */
export async function commitLayoutWrite(client: Queryable, layoutId: string): Promise<void> {
  const placements = await client.query(
    `select ${PLACEMENT_COLUMNS} ${PLACEMENT_FROM} where p.layout_id = $1 order by p.ordinal`,
    [layoutId],
  );
  const hash = layoutHash(placements.rows.map(toPlacement));
  const updated = await client.query(
    'update layouts set version = version + 1, hash = $2 where id = $1 returning version',
    [layoutId, hash],
  );
  const version = Number(updated.rows[0]?.['version']);
  const sheets = await client.query(
    `update sheets set status = 'Out of step'
     where layout_id = $1 and status = 'Issued'
     returning id`,
    [layoutId],
  );
  for (const sheet of sheets.rows) {
    await writeEvent(
      client,
      'sheet.changed',
      sheet['id'] as string,
      { id: sheet['id'], status: 'Out of step' },
      sheet['id'] as string,
    );
  }
  await writeEvent(client, 'layout.changed', layoutId, { id: layoutId, version, hash });
}

export interface PlacementWrite {
  readonly bodySerial: string | null;
  readonly holdId: string | null;
  readonly model: string;
  readonly lensSerial: string;
  readonly aimAcross: Decimal;
  readonly aimDown: Decimal;
  readonly bodyAcross: Decimal;
  readonly bodyDown: Decimal;
  readonly standoff: Decimal;
  readonly ratio: Decimal;
  readonly shiftAcrossPercent: Decimal;
  readonly shiftDownPercent: Decimal;
  readonly circuitId: string;
}

function writeValues(write: PlacementWrite): unknown[] {
  return [
    write.bodySerial,
    write.holdId,
    write.model,
    write.lensSerial,
    toFixed(write.aimAcross, LENGTH_SCALE),
    toFixed(write.aimDown, LENGTH_SCALE),
    toFixed(write.bodyAcross, LENGTH_SCALE),
    toFixed(write.bodyDown, LENGTH_SCALE),
    toFixed(write.standoff, LENGTH_SCALE),
    toFixed(write.ratio, LENGTH_SCALE),
    toFixed(write.shiftAcrossPercent, LENGTH_SCALE),
    toFixed(write.shiftDownPercent, LENGTH_SCALE),
    write.circuitId,
  ];
}

export async function insertPlacement(client: Queryable, layoutId: string, write: PlacementWrite): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into placements (id, layout_id, ordinal, body_serial, hold_id, model, lens_serial,
       aim_across, aim_down, body_across, body_down, standoff, ratio,
       shift_across_percent, shift_down_percent, circuit_id)
     values ($1, $2, nextval('placement_ordinal'), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [id, layoutId, ...writeValues(write)],
  );
  return id;
}

export async function updatePlacement(client: Queryable, placementId: string, write: PlacementWrite): Promise<void> {
  await client.query(
    `update placements set body_serial = $2, hold_id = $3, model = $4, lens_serial = $5,
       aim_across = $6, aim_down = $7, body_across = $8, body_down = $9, standoff = $10,
       ratio = $11, shift_across_percent = $12, shift_down_percent = $13, circuit_id = $14
     where id = $1`,
    [placementId, ...writeValues(write)],
  );
}

export interface AvailableUnit {
  readonly serial: string;
  readonly kind: string;
  readonly model: string;
  readonly location: string;
  readonly free: boolean;
  readonly ratedLumens: number | null;
}

export async function unitsForSite(siteId: string): Promise<AvailableUnit[]> {
  const [rows, bound] = await Promise.all([
    query(
      `select u.serial, u.kind, u.model, u.location, m.rated_lumens
       from units u join models m on m.code = u.model
       where u.location = $1 or u.location = $2
       order by u.serial`,
      [SHELF, siteLocation(siteId)],
    ),
    boundSerials(),
  ]);
  return rows.map((row) => ({
    serial: row['serial'] as string,
    kind: row['kind'] as string,
    model: row['model'] as string,
    location: row['location'] as string,
    free: row['location'] === SHELF && !bound.has(row['serial'] as string),
    ratedLumens: row['rated_lumens'] === null ? null : Number(row['rated_lumens']),
  }));
}

export interface CellView extends CellLight {
  readonly cell: string;
  readonly reflectance: string;
  readonly recessMetres: string;
  readonly stale: boolean;
}

export interface LayoutCells {
  readonly site: SiteRecord;
  readonly cells: readonly CellView[];
}

export async function layoutCells(layout: LayoutRecord, stale: boolean): Promise<LayoutCells> {
  const site = await requireSite(layout.siteId);
  const ground = await cellGround(site.id);
  const optics = layout.placements.map(opticsOf);
  const cells: CellView[] = [];
  for (const name of sortedCellNames(site.columns, site.rows)) {
    const position = parseCellName(name);
    if (position === null) continue;
    const centre = cellCentre(position);
    const record = ground.get(name);
    const light = lightCell(
      {
        across: centre.across,
        down: centre.down,
        reflectance: Number(record?.reflectance ?? '0.6'),
        recessMetres: Number(record?.recessMetres ?? '0'),
        ambientLux: record?.ambientLux ?? null,
      },
      optics,
    );
    cells.push({ cell: name, reflectance: record?.reflectance ?? '0.600000', recessMetres: record?.recessMetres ?? '0.000000', stale, ...light });
  }
  return { site, cells };
}

export interface CircuitLoad {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly loadWatts: number;
  readonly capacityWatts: number;
  readonly overloaded: boolean;
}

export async function circuitLoads(layout: LayoutRecord): Promise<CircuitLoad[]> {
  const rows = await query('select id, name, kind from circuits where site_id = $1 order by name', [layout.siteId]);
  return rows.map((row) => {
    const id = row['id'] as string;
    const kind = row['kind'] as string;
    const capacityWatts = CIRCUIT_CAPACITY_WATTS[kind] ?? 0;
    const loadWatts = layout.placements
      .filter((placement) => placement.circuitId === id)
      .reduce((total, placement) => total + placement.watts, 0);
    return { id, name: row['name'] as string, kind, loadWatts, capacityWatts, overloaded: loadWatts > capacityWatts };
  });
}

/** No cell may sit under a third body. */
export function overlapsTooMany(
  placements: readonly PlacementOptics[],
  columns: number,
  rows: number,
): boolean {
  const projections = placements.map(projectionOf);
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const across = (column - 0.5) * CELL_METRES;
      const down = (row - 0.5) * CELL_METRES;
      let count = 0;
      for (const projection of projections) {
        if (covers(projection, across, down)) count += 1;
        if (count > 2) return true;
      }
    }
  }
  return false;
}

export function lowestContrast(cells: readonly CellView[]): number | null {
  let lowest: number | null = null;
  for (const cell of cells) {
    if (cell.contrast === null || cell.contributions.length === 0) continue;
    if (lowest === null || cell.contrast < lowest) lowest = cell.contrast;
  }
  return lowest;
}


