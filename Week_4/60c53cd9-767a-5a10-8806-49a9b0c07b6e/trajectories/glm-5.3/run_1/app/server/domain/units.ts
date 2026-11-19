// The unit and hold state transitions, the lapse check every read and write goes
// through, and the published projections. One place decides each rule.
import type { Row, Tx } from '../store/db.js';
import {
  pricePerM2,
  pricePerSqft,
  type BandId,
  type Stack,
  type UnitStatus,
  type ViewTag,
} from './shared.js';

export interface UnitRow {
  code: string;
  floor: number;
  stack: Stack;
  band: BandId;
  bedrooms: number;
  areaM2: number;
  areaSqft: number;
  bearing: number;
  facing: string;
  viewTag: ViewTag;
  released: boolean;
  withdrawn: boolean;
  status: UnitStatus | 'withdrawn' | 'unreleased';
  price: number;
  priceVersion: number;
  viewPhotographed: boolean;
  viewPhotoKey: string | null;
  viewPhotoSize: number | null;
  viewPhotoChecksum: string | null;
}

export interface HoldRow {
  id: string;
  unitCode: string;
  accountId: string;
  status: 'active' | 'released' | 'lapsed' | 'converted';
  endedBy: 'buyer' | 'withdrawal' | 'lapse' | 'conversion' | null;
  quotedPrice: number;
  priceVersion: number;
  createdAt: string;
  endsAt: string;
  endedAt: string | null;
}

export function parseUnit(row: Row): UnitRow {
  return {
    code: String(row.code),
    floor: Number(row.floor),
    stack: String(row.stack) as Stack,
    band: String(row.band) as BandId,
    bedrooms: Number(row.bedrooms),
    areaM2: Number(row.area_m2),
    areaSqft: Number(row.area_sqft),
    bearing: Number(row.bearing),
    facing: String(row.facing),
    viewTag: String(row.view_tag) as ViewTag,
    released: row.released === 't' || row.released === true,
    withdrawn: row.withdrawn === 't' || row.withdrawn === true,
    status: String(row.status) as UnitRow['status'],
    price: Number(row.price),
    priceVersion: Number(row.price_version),
    viewPhotographed: row.view_photographed === 't' || row.view_photographed === true,
    viewPhotoKey: row.view_photo_key === null ? null : String(row.view_photo_key),
    viewPhotoSize: row.view_photo_size === null ? null : Number(row.view_photo_size),
    viewPhotoChecksum: row.view_photo_checksum === null ? null : String(row.view_photo_checksum),
  };
}

export function parseHold(row: Row): HoldRow {
  return {
    id: String(row.id),
    unitCode: String(row.unit_code),
    accountId: String(row.account_id),
    status: String(row.status) as HoldRow['status'],
    endedBy: row.ended_by === null ? null : String(row.ended_by) as HoldRow['endedBy'],
    quotedPrice: Number(row.quoted_price),
    priceVersion: Number(row.price_version),
    createdAt: String(row.created_at),
    endsAt: String(row.ends_at),
    endedAt: row.ended_at === null ? null : String(row.ended_at),
  };
}

// The lapse check (Business rules). Runs inside every read and write that touches
// a hold or its unit, before anything else happens in that request. Units whose
// holds just lapsed are returned so the caller can queue their index updates.
export async function runLapseCheck(tx: Tx, nowIso: string): Promise<string[]> {
  const lapsed = await tx.query(
    `UPDATE holds SET status = 'lapsed', ended_by = 'lapse', ended_at = ends_at
     WHERE status = 'active' AND ends_at <= $1
     RETURNING id, unit_code`,
    [nowIso],
  );
  const releasedUnits: string[] = [];
  for (const row of lapsed.rows) {
    await tx.query(
      `UPDATE units SET status = 'available' WHERE code = $1 AND status = 'held'`,
      [String(row.unit_code)],
    );
    releasedUnits.push(String(row.unit_code));
  }
  return releasedUnits;
}

export async function queueIndexUpdate(tx: Tx, unitCode: string, kind: string): Promise<void> {
  await tx.query(
    `INSERT INTO pending_index_updates (unit_code, kind, enqueued_at) VALUES ($1, $2, $3)`,
    [unitCode, kind, new Date().toISOString()],
  );
}

export function unitStatusForCell(unit: UnitRow): 'available' | 'held' | 'reserved' | 'withdrawn' | 'unreleased' {
  if (unit.withdrawn) return 'withdrawn';
  if (!unit.released) return 'unreleased';
  if (unit.status === 'held') return 'held';
  if (unit.status === 'reserved') return 'reserved';
  return 'available';
}

// The public unit projection (DP-10): exactly the published fields.
export function publicUnit(unit: UnitRow, syncing: boolean, viewUrl: string | null): Record<string, unknown> {
  return {
    code: unit.code,
    floor: unit.floor,
    stack: unit.stack,
    band: unit.band,
    bedrooms: unit.bedrooms,
    areaM2: unit.areaM2,
    areaSqft: unit.areaSqft,
    bearing: unit.bearing,
    facing: unit.facing,
    viewTag: unit.viewTag,
    price: unit.price,
    pricePerM2: pricePerM2(unit.price, unit.areaM2),
    pricePerSqft: pricePerSqft(unit.price, unit.areaSqft),
    priceVersion: unit.priceVersion,
    status: unit.status === 'held' || unit.status === 'reserved' ? unit.status : 'available',
    syncing,
    viewPhotographed: unit.viewPhotographed,
    viewUrl,
  };
}

// The shared unit projection carries no price figures at all (DP-10, DP-79).
export function sharedUnit(unit: UnitRow, viewUrl: string | null): Record<string, unknown> {
  return {
    code: unit.code,
    floor: unit.floor,
    stack: unit.stack,
    band: unit.band,
    bedrooms: unit.bedrooms,
    areaM2: unit.areaM2,
    areaSqft: unit.areaSqft,
    bearing: unit.bearing,
    facing: unit.facing,
    viewTag: unit.viewTag,
    viewPhotographed: unit.viewPhotographed,
    viewUrl,
  };
}
