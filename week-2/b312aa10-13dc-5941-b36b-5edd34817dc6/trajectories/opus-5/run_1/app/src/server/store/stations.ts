import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import type { RateVersion, Station, StationKind } from '../domain/types.js';

type StationRow = {
  id: string;
  kitchen_id: string;
  name: string;
  kind: StationKind;
  capacity: number | null;
  lane_order: number;
};

type RateRow = {
  id: string;
  station_id: string;
  effective_from: string;
  effective_at: Date;
  off_peak_hourly_cents: number | null;
  peak_hourly_cents: number | null;
  shelf_day_cents: number | null;
};

function toRate(row: RateRow): RateVersion {
  return {
    id: row.id,
    stationId: row.station_id,
    effectiveFrom: row.effective_from,
    effectiveAtMs: row.effective_at.getTime(),
    offPeakHourlyCents: row.off_peak_hourly_cents,
    peakHourlyCents: row.peak_hourly_cents,
    shelfDayCents: row.shelf_day_cents,
  };
}

export async function loadStations(client: Queryable, kitchenId: string): Promise<Station[]> {
  const stations = await client.query<StationRow>(
    `select id, kitchen_id, name, kind, capacity, lane_order
       from stations where kitchen_id = $1 order by lane_order`,
    [kitchenId],
  );
  const rates = await client.query<RateRow>(
    `select r.id, r.station_id, r.effective_from, r.effective_at, r.off_peak_hourly_cents,
            r.peak_hourly_cents, r.shelf_day_cents
       from rate_versions r join stations s on s.id = r.station_id
      where s.kitchen_id = $1
      order by r.effective_at, r.created_at`,
    [kitchenId],
  );
  return stations.rows.map((row) => ({
    id: row.id,
    kitchenId: row.kitchen_id,
    name: row.name,
    kind: row.kind,
    capacity: row.capacity,
    laneOrder: row.lane_order,
    rates: rates.rows.filter((rate) => rate.station_id === row.id).map(toRate),
  }));
}

export async function loadStation(
  client: Queryable,
  kitchenId: string,
  stationId: string,
): Promise<Station | null> {
  const stations = await loadStations(client, kitchenId);
  return stations.find((station) => station.id === stationId) ?? null;
}

export async function insertRateVersion(
  client: Queryable,
  stationId: string,
  rate: {
    effectiveFrom: string;
    effectiveAtMs: number;
    offPeakHourlyCents: number | null;
    peakHourlyCents: number | null;
    shelfDayCents: number | null;
  },
): Promise<boolean> {
  const result = await client.query(
    `insert into rate_versions (id, station_id, effective_from, effective_at,
                                off_peak_hourly_cents, peak_hourly_cents, shelf_day_cents)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (station_id, effective_at) do nothing`,
    [
      `rv_${randomUUID()}`,
      stationId,
      rate.effectiveFrom,
      new Date(rate.effectiveAtMs).toISOString(),
      rate.offPeakHourlyCents,
      rate.peakHourlyCents,
      rate.shelfDayCents,
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function rateVersionAtInstant(
  client: Queryable,
  stationId: string,
  effectiveAtMs: number,
): Promise<RateVersion | null> {
  const result = await client.query<RateRow>(
    `select id, station_id, effective_from, effective_at, off_peak_hourly_cents,
            peak_hourly_cents, shelf_day_cents
       from rate_versions where station_id = $1 and effective_at = $2`,
    [stationId, new Date(effectiveAtMs).toISOString()],
  );
  const row = result.rows[0];
  return row ? toRate(row) : null;
}
