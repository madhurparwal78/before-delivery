import type { Kitchen, RateCard, Station } from '../../shared/types.js';
import { minutesToHHMM } from '../../shared/format.js';
import { query, queryOne, type Sql } from '../db/pool.js';
import { env } from '../env.js';
import type { RateCardRecord, StationRef } from './pricing.js';
import { kitchenToday } from './time.js';

export interface KitchenRecord {
  id: string;
  name: string;
  timezone: string;
  same_day_cutoff_minutes: number;
}

export async function loadKitchen(client: Sql, kitchenId: string): Promise<KitchenRecord | null> {
  return queryOne<KitchenRecord>(
    client,
    'SELECT id, name, timezone, same_day_cutoff_minutes FROM kitchens WHERE id = $1',
    [kitchenId],
  );
}

export async function loadStations(client: Sql, kitchenId: string): Promise<Station[]> {
  const rows = await query<{ id: string; name: string; kind: Station['kind']; loom_order: number }>(
    client,
    'SELECT id, name, kind, loom_order FROM stations WHERE kitchen_id = $1 ORDER BY loom_order',
    [kitchenId],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, order: row.loom_order }));
}

export function stationMap(stations: readonly Station[]): Map<string, StationRef> {
  return new Map(stations.map((station) => [station.id, station]));
}

export function kitchenView(
  record: KitchenRecord,
  stations: Station[],
  now: Date,
  cancellationWindowHours: number,
): Kitchen {
  return {
    id: record.id,
    name: record.name,
    timezone: record.timezone,
    today: kitchenToday(record.timezone, now),
    server_now: now.toISOString(),
    same_day_cutoff: minutesToHHMM(record.same_day_cutoff_minutes),
    hold_seconds: env.holdSeconds,
    cancellation_window_hours: cancellationWindowHours,
    stations,
  };
}

interface RateCardRow {
  id: string;
  effective_from: string;
  tier_1_cents: number;
  tier_2_cents: number;
  tier_3_cents: number;
  tier_4_cents: number;
  cancellation_window_hours: number;
  pack_price_cents: number;
  created_at: Date;
  surcharges: { station_id: string; surcharge_cents: number }[] | null;
}

async function rateCardRows(client: Sql, where: string, values: unknown[]): Promise<RateCardRow[]> {
  return query<RateCardRow>(
    client,
    `SELECT r.id, r.effective_from, r.tier_1_cents, r.tier_2_cents, r.tier_3_cents, r.tier_4_cents,
            r.cancellation_window_hours, r.pack_price_cents, r.created_at,
            (SELECT json_agg(json_build_object('station_id', s.station_id, 'surcharge_cents', s.surcharge_cents))
               FROM rate_card_surcharges s WHERE s.rate_card_id = r.id) AS surcharges
       FROM rate_cards r
      WHERE ${where}
      ORDER BY r.effective_from DESC`,
    values,
  );
}

function toRecord(row: RateCardRow): RateCardRecord & { created_at: string } {
  const surcharges: Record<string, number> = {};
  for (const entry of row.surcharges ?? []) surcharges[entry.station_id] = entry.surcharge_cents;
  return {
    id: row.id,
    effective_from: row.effective_from,
    tier_rates_cents: [row.tier_1_cents, row.tier_2_cents, row.tier_3_cents, row.tier_4_cents],
    station_surcharges_cents: surcharges,
    cancellation_window_hours: row.cancellation_window_hours,
    pack_price_cents: row.pack_price_cents,
    created_at: row.created_at.toISOString(),
  };
}

export async function loadRateCards(
  client: Sql,
  kitchenId: string,
): Promise<(RateCardRecord & { created_at: string })[]> {
  const rows = await rateCardRows(client, 'r.kitchen_id = $1', [kitchenId]);
  return rows.map(toRecord);
}

export async function loadRateCard(client: Sql, rateCardId: string): Promise<RateCardRecord | null> {
  const rows = await rateCardRows(client, 'r.id = $1', [rateCardId]);
  const row = rows[0];
  return row ? toRecord(row) : null;
}

/** The card in force is the one with the latest effective date on or before today. */
export function cardInForce<T extends { effective_from: string }>(
  cards: readonly T[],
  today: string,
): T | null {
  return cards.filter((card) => card.effective_from <= today)[0] ?? null;
}

export function rateCardView(
  card: RateCardRecord & { created_at: string },
  inForceId: string | null,
): RateCard {
  return {
    id: card.id,
    effective_from: card.effective_from,
    tier_rates_cents: [...card.tier_rates_cents],
    station_surcharges_cents: { ...card.station_surcharges_cents },
    cancellation_window_hours: card.cancellation_window_hours,
    pack_price_cents: card.pack_price_cents,
    in_force: card.id === inForceId,
    created_at: card.created_at,
  };
}

export interface MemberRecord {
  id: string;
  kitchen_id: string;
  business: string;
  contact_email: string;
}

export async function loadMember(client: Sql, memberId: string): Promise<MemberRecord | null> {
  return queryOne<MemberRecord>(
    client,
    'SELECT id, kitchen_id, business, contact_email FROM members WHERE id = $1',
    [memberId],
  );
}

export async function loadKitchenOperatorEmail(
  client: Sql,
  kitchenId: string,
): Promise<string | null> {
  const row = await queryOne<{ email: string }>(
    client,
    "SELECT email FROM users WHERE kitchen_id = $1 AND role = 'operator' ORDER BY id LIMIT 1",
    [kitchenId],
  );
  return row ? row.email : null;
}
