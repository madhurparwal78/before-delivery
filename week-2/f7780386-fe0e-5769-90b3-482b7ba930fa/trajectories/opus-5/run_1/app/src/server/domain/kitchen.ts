import type { QueryResult, QueryResultRow } from 'pg';

import type { PackInfo, StationInfo } from '../../shared/api.js';
import type { Station } from '../../shared/domain.js';
import { formatMoney } from '../../shared/format.js';
import type { Database } from '../db/pool.js';

export interface Pack {
  id: string;
  name: string;
  minutes: number;
  price_cents: number;
}

/** Anything that can run SQL: the pool itself or a client inside a transaction. */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export async function listStations(db: Queryable): Promise<Station[]> {
  const result = await db.query<Station>(
    `SELECT id, name, hourly_rate_cents, cleaning_minutes FROM stations ORDER BY sort_order`,
  );
  return result.rows;
}

export async function findStation(db: Queryable, id: string): Promise<Station | null> {
  const result = await db.query<Station>(
    `SELECT id, name, hourly_rate_cents, cleaning_minutes FROM stations WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function listPacks(db: Queryable): Promise<Pack[]> {
  const result = await db.query<Pack>(
    `SELECT id, name, minutes, price_cents FROM packs ORDER BY sort_order`,
  );
  return result.rows;
}

export function stationView(station: Station): StationInfo {
  return {
    id: station.id,
    name: station.name,
    hourly_rate: formatMoney(station.hourly_rate_cents),
    cleaning_minutes: station.cleaning_minutes,
  };
}

export function packView(pack: Pack): PackInfo {
  return {
    id: pack.id,
    name: pack.name,
    minutes: pack.minutes,
    price: formatMoney(pack.price_cents),
  };
}

export interface MemberRow {
  id: string;
  business_name: string;
  contact_email: string;
}

export async function findMember(db: Queryable, id: string): Promise<MemberRow | null> {
  const result = await db.query<MemberRow>(
    'SELECT id, business_name, contact_email FROM members WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function allMembers(db: Database): Promise<MemberRow[]> {
  const result = await db.query<MemberRow>(
    'SELECT id, business_name, contact_email FROM members ORDER BY business_name',
  );
  return result.rows;
}
