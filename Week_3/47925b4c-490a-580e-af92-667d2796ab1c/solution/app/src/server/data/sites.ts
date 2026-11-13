import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { type Queryable, type Row, query, queryOne } from '../db/pool.js';
import { cellName, parseCellName } from '../domain/cells.js';
import { CIRCUIT_CAPACITY_WATTS } from '../domain/catalogue.js';
import { type Decimal, ceilToInteger, fromInteger, multiply, toFixed } from '../domain/decimal.js';
import { LENGTH_SCALE } from '../domain/units.js';
import { EMPTY_LAYOUT_HASH } from '../domain/layouthash.js';
import { writeEvent } from '../events/outbox.js';
import { problem } from '../http/problem.js';

interface CircuitView {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly capacityWatts: number;
}

interface SiteView {
  readonly id: string;
  readonly name: string;
  readonly widthMetres: string;
  readonly heightMetres: string;
  readonly columns: number;
  readonly rows: number;
  readonly showAt: string;
  readonly rectified: boolean;
  readonly residualMetres: string | null;
  readonly demo: boolean;
  readonly stale: boolean;
  readonly staleAt: string | null;
  readonly circuits: readonly CircuitView[];
  readonly layouts: readonly { readonly id: string; readonly name: string; readonly sheetStatus: string }[];
}

export interface SiteRecord {
  readonly id: string;
  readonly name: string;
  readonly widthMetres: string;
  readonly heightMetres: string;
  readonly columns: number;
  readonly rows: number;
  readonly rectified: boolean;
  readonly residualMetres: string | null;
  readonly homography: readonly number[] | null;
  readonly photoSha256: string | null;
  readonly photoKey: string | null;
  readonly photoOrientation: number | null;
  readonly photoWidthPx: number | null;
  readonly photoHeightPx: number | null;
  readonly showAt: Date;
  readonly showAtLocal: string;
  readonly demo: boolean;
}

function cellCountFor(metres: Decimal): number {
  return ceilToInteger(multiply(metres, fromInteger(2)));
}

function toRecord(row: Row): SiteRecord {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    widthMetres: row['width_metres'] as string,
    heightMetres: row['height_metres'] as string,
    columns: Number(row['columns']),
    rows: Number(row['rows']),
    rectified: row['rectified'] as boolean,
    residualMetres: (row['residual_metres'] as string | null) ?? null,
    homography: (row['homography'] as number[] | null) ?? null,
    photoSha256: (row['photo_sha256'] as string | null) ?? null,
    photoKey: (row['photo_key'] as string | null) ?? null,
    photoOrientation: row['photo_orientation'] === null ? null : Number(row['photo_orientation']),
    photoWidthPx: row['photo_width_px'] === null ? null : Number(row['photo_width_px']),
    photoHeightPx: row['photo_height_px'] === null ? null : Number(row['photo_height_px']),
    showAt: row['show_at'] as Date,
    showAtLocal: row['show_at_local'] as string,
    demo: row['demo'] as boolean,
  };
}

async function findSite(siteId: string): Promise<SiteRecord | null> {
  const row = await queryOne('select * from sites where id = $1', [siteId]);
  return row === null ? null : toRecord(row);
}

export async function requireSite(siteId: string): Promise<SiteRecord> {
  const site = await findSite(siteId);
  if (site === null) throw problem('not_found');
  return site;
}

interface StaleFacts {
  readonly stale: boolean;
  readonly staleAt: string | null;
}

export async function staleFacts(siteId: string): Promise<StaleFacts> {
  const row = await queryOne<{ newest: Date | null }>(
    'select max(counted_at) as newest from readings where site_id = $1',
    [siteId],
  );
  const newest = row?.newest ?? null;
  if (newest === null) return { stale: false, staleAt: null };
  const staleAt = new Date(newest.getTime() + config.readingStaleSeconds * 1000);
  return { stale: Date.now() >= staleAt.getTime(), staleAt: staleAt.toISOString() };
}

async function circuitsOf(siteId: string): Promise<CircuitView[]> {
  const rows = await query('select id, name, kind from circuits where site_id = $1 order by name', [siteId]);
  return rows.map((row) => ({
    id: row['id'] as string,
    name: row['name'] as string,
    kind: row['kind'] as string,
    capacityWatts: CIRCUIT_CAPACITY_WATTS[row['kind'] as string] ?? 0,
  }));
}

export async function siteView(site: SiteRecord): Promise<SiteView> {
  const [stale, circuits, layouts] = await Promise.all([
    staleFacts(site.id),
    circuitsOf(site.id),
    query(
      `select l.id, l.name, coalesce(s.status, 'Draft') as sheet_status
       from layouts l
       left join sheets s on s.layout_id = l.id and s.status <> 'Withdrawn'
       where l.site_id = $1
       order by l.created_at, l.id`,
      [site.id],
    ),
  ]);
  return {
    id: site.id,
    name: site.name,
    widthMetres: site.widthMetres,
    heightMetres: site.heightMetres,
    columns: site.columns,
    rows: site.rows,
    showAt: site.showAt.toISOString(),
    rectified: site.rectified,
    residualMetres: site.residualMetres,
    demo: site.demo,
    stale: stale.stale,
    staleAt: stale.staleAt,
    circuits,
    layouts: layouts.map((row) => ({
      id: row['id'] as string,
      name: row['name'] as string,
      sheetStatus: row['sheet_status'] as string,
    })),
  };
}

export async function listSiteViews(): Promise<SiteView[]> {
  const rows = await query('select * from sites order by created_at, id');
  const views: SiteView[] = [];
  for (const row of rows) views.push(await siteView(toRecord(row)));
  return views;
}

interface NewSite {
  readonly id: string;
  readonly name: string;
  readonly width: Decimal;
  readonly height: Decimal;
  readonly showAt: Date;
  readonly showAtLocal: string;
  readonly demo: boolean;
  readonly rectified?: boolean;
  readonly residualMetres?: string;
  readonly layoutId?: string;
  readonly layoutName?: string;
  readonly circuitIds?: readonly string[];
  readonly circuits?: readonly { readonly name: string; readonly kind: string }[];
}

export async function insertSite(client: Queryable, site: NewSite): Promise<void> {
  const columns = cellCountFor(site.width);
  const rows = cellCountFor(site.height);
  await client.query(
    `insert into sites (id, name, width_metres, height_metres, columns, rows, show_at, show_at_local, demo, rectified, residual_metres)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      site.id,
      site.name,
      toFixed(site.width, LENGTH_SCALE),
      toFixed(site.height, LENGTH_SCALE),
      columns,
      rows,
      site.showAt.toISOString(),
      site.showAtLocal,
      site.demo,
      site.rectified ?? false,
      site.residualMetres ?? null,
    ],
  );
  await client.query('insert into cells (site_id, cell) select $1, unnest($2::text[])', [
    site.id,
    sortedCellNames(columns, rows),
  ]);
  const circuits = site.circuits ?? [{ name: 'Mains', kind: '400V-CEE-32A' }];
  for (const [index, circuit] of circuits.entries()) {
    await client.query('insert into circuits (id, site_id, name, kind) values ($1, $2, $3, $4)', [
      site.circuitIds?.[index] ?? randomUUID(),
      site.id,
      circuit.name,
      circuit.kind,
    ]);
  }
  const layoutId = site.layoutId ?? randomUUID();
  await client.query('insert into layouts (id, site_id, name, hash) values ($1, $2, $3, $4)', [
    layoutId,
    site.id,
    site.layoutName ?? 'Main layout',
    EMPTY_LAYOUT_HASH,
  ]);
  await writeEvent(client, 'layout.changed', layoutId, { id: layoutId, version: 1, hash: EMPTY_LAYOUT_HASH });
}

interface CellGroundRecord {
  readonly cell: string;
  readonly reflectance: string;
  readonly recessMetres: string;
  readonly ambientLux: string | null;
  readonly readingCount: number;
}

export async function cellGround(siteId: string): Promise<Map<string, CellGroundRecord>> {
  const rows = await query(
    `select c.cell, c.reflectance, c.recess_metres, r.canonical_lux, coalesce(n.count, 0) as count
     from cells c
     left join lateral (
       select canonical_lux from readings
       where readings.site_id = c.site_id and readings.cell = c.cell
       order by counted_at desc, accepted_at desc
       limit 1
     ) r on true
     left join (
       select cell, count(*) as count from readings where site_id = $1 group by cell
     ) n on n.cell = c.cell
     where c.site_id = $1`,
    [siteId],
  );
  const ground = new Map<string, CellGroundRecord>();
  for (const row of rows) {
    ground.set(row['cell'] as string, {
      cell: row['cell'] as string,
      reflectance: row['reflectance'] as string,
      recessMetres: row['recess_metres'] as string,
      ambientLux: (row['canonical_lux'] as string | null) ?? null,
      readingCount: Number(row['count']),
    });
  }
  return ground;
}

export function sortedCellNames(columns: number, rows: number): string[] {
  const names: string[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) names.push(cellName({ column, row }));
  }
  return names;
}

export function cellOnWall(cell: string, columns: number, rows: number): boolean {
  const position = parseCellName(cell);
  return (
    position !== null &&
    position.column >= 1 &&
    position.column <= columns &&
    position.row >= 1 &&
    position.row <= rows
  );
}
