import { pool, type Queryable } from '../pool.js';
import type { StationKind } from '../../domain/constants.js';
import type { HourPackRecord, ShelfRecord, StationRecord } from '../../domain/types.js';

interface StationRow {
  id: string;
  name: string;
  kind: StationKind;
  hourly_rate_cents: number;
  position: number;
}

interface ShelfRow {
  id: string;
  name: string;
  monthly_rate_cents: number;
  tenant_id: string | null;
  position: number;
}

interface PackRow {
  id: string;
  name: string;
  minutes: number;
  price_cents: number;
}

function toStation(row: StationRow): StationRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    hourlyRateCents: row.hourly_rate_cents,
    position: row.position,
  };
}

function toShelf(row: ShelfRow): ShelfRecord {
  return {
    id: row.id,
    name: row.name,
    monthlyRateCents: row.monthly_rate_cents,
    tenantId: row.tenant_id,
    position: row.position,
  };
}

export async function listStations(db: Queryable = pool): Promise<StationRecord[]> {
  const result = await db.query<StationRow>('SELECT * FROM stations ORDER BY position');
  return result.rows.map(toStation);
}

export async function findStation(id: string): Promise<StationRecord | null> {
  const result = await pool.query<StationRow>('SELECT * FROM stations WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? toStation(row) : null;
}

export async function listShelves(db: Queryable = pool): Promise<ShelfRecord[]> {
  const result = await db.query<ShelfRow>('SELECT * FROM shelves ORDER BY position');
  return result.rows.map(toShelf);
}

export async function findShelf(id: string, db: Queryable = pool): Promise<ShelfRecord | null> {
  const result = await db.query<ShelfRow>('SELECT * FROM shelves WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? toShelf(row) : null;
}

export async function setShelfTenant(id: string, tenantId: string | null): Promise<void> {
  await pool.query('UPDATE shelves SET tenant_id = $2 WHERE id = $1', [id, tenantId]);
}

export async function listHourPacks(): Promise<HourPackRecord[]> {
  const result = await pool.query<PackRow>('SELECT * FROM hour_packs ORDER BY position');
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    minutes: row.minutes,
    priceCents: row.price_cents,
  }));
}

export async function findHourPack(id: string): Promise<HourPackRecord | null> {
  const result = await pool.query<PackRow>('SELECT * FROM hour_packs WHERE id = $1', [id]);
  const row = result.rows[0];
  return row
    ? { id: row.id, name: row.name, minutes: row.minutes, priceCents: row.price_cents }
    : null;
}
