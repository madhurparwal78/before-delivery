/** Unit records, the published projections built from explicit field lists, and unit state. */

import { query, queryOne, type Db } from '../db';
import { mediaUrl } from '../storage/mediaToken';
import { unconfirmedCodes } from '../search/pending';
import { areaSqft, pricePerM2, pricePerSqft } from '../../shared/derived';
import type { BandId, Facing, StackLetter, ViewTag } from '../../shared/units';
import type { CellStatus, PublicUnit, SharedUnit, TowerCell, UnitStatus } from '../../shared/types';

export interface UnitRow {
  code: string;
  floor: number;
  stack: StackLetter;
  band: BandId;
  bedrooms: number;
  area_m2: number;
  bearing: number;
  facing: Facing;
  view_tag: ViewTag;
  price: string;
  price_version: number;
  status: CellStatus;
  view_photographed: boolean;
  view_photo_key: string | null;
  view_photo_size: string | null;
  view_photo_checksum: string | null;
  upload_in_progress: boolean;
}

export const UNIT_COLUMNS = `code, floor, stack, band, bedrooms, area_m2, bearing, facing, view_tag,
  price::text as price, price_version, status, view_photographed, view_photo_key,
  view_photo_size::text as view_photo_size, view_photo_checksum, upload_in_progress`;

export function isVisibleToBuyers(status: CellStatus): status is UnitStatus {
  return status === 'available' || status === 'held' || status === 'reserved';
}

export async function loadUnit(db: Db, code: string): Promise<UnitRow | null> {
  return queryOne<UnitRow>(db, `select ${UNIT_COLUMNS} from units where code = $1`, [code]);
}

/** Locks the unit row, which is how every write on one unit is serialised. */
export async function lockUnit(db: Db, code: string): Promise<UnitRow | null> {
  const locked = await queryOne<{ code: string }>(db, 'select code from units where code = $1 for update', [code]);
  if (!locked) return null;
  return loadUnit(db, code);
}

export async function loadUnits(db: Db, codes: readonly string[]): Promise<UnitRow[]> {
  if (codes.length === 0) return [];
  return query<UnitRow>(db, `select ${UNIT_COLUMNS} from units where code = any($1::text[])`, [codes as string[]]);
}

export function publicUnit(row: UnitRow, syncing: boolean): PublicUnit {
  const price = Number(row.price);
  if (!isVisibleToBuyers(row.status)) throw new Error(`unit ${row.code} is not visible`);
  return {
    code: row.code,
    floor: row.floor,
    stack: row.stack,
    band: row.band,
    bedrooms: row.bedrooms,
    areaM2: row.area_m2,
    areaSqft: areaSqft(row.area_m2),
    bearing: row.bearing,
    facing: row.facing,
    viewTag: row.view_tag,
    price,
    pricePerM2: pricePerM2(price, row.area_m2),
    pricePerSqft: pricePerSqft(price, row.area_m2),
    priceVersion: row.price_version,
    status: row.status,
    syncing,
    viewPhotographed: row.view_photographed,
    viewUrl: viewUrlFor(row),
  };
}

export function sharedUnit(row: UnitRow): SharedUnit {
  return {
    code: row.code,
    floor: row.floor,
    stack: row.stack,
    band: row.band,
    bedrooms: row.bedrooms,
    areaM2: row.area_m2,
    areaSqft: areaSqft(row.area_m2),
    bearing: row.bearing,
    facing: row.facing,
    viewTag: row.view_tag,
    viewPhotographed: row.view_photographed,
    viewUrl: viewUrlFor(row),
  };
}

function viewUrlFor(row: UnitRow): string | null {
  if (!row.view_photographed || !row.view_photo_key) return null;
  return mediaUrl(row.view_photo_key, row.code);
}

export function towerCell(row: { code: string; floor: number; stack: StackLetter; status: CellStatus }, syncing: boolean): TowerCell {
  return { code: row.code, floor: row.floor, stack: row.stack, status: row.status, syncing };
}

export async function towerCells(db: Db): Promise<TowerCell[]> {
  const rows = await query<{ code: string; floor: number; stack: StackLetter; status: CellStatus }>(
    db,
    'select code, floor, stack, status from units order by floor, stack',
  );
  const syncing = await unconfirmedCodes(db, rows.map((row) => row.code));
  return rows.map((row) => towerCell(row, syncing.has(row.code)));
}

export async function availableCount(db: Db): Promise<number> {
  const row = await queryOne<{ count: string }>(
    db,
    "select count(*)::text as count from units where status = 'available'",
  );
  return row ? Number(row.count) : 0;
}
