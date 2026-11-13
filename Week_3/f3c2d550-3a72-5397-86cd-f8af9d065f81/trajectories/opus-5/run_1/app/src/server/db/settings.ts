import type { SettingsJson, Unit } from '../../shared/types.js';
import { nowIso, nowMs, toIso } from '../domain/clock.js';
import {
  effectiveZoneAt,
  pendingEntryAt,
  planZoneChange,
  type ZoneEntry,
} from '../domain/homeZone.js';
import { localDate } from '../domain/zones.js';
import { pool, withTransaction } from './pool.js';

export interface DeckSettings {
  history: ZoneEntry[];
  unit: Unit;
}

export async function loadSettings(): Promise<DeckSettings> {
  const [zones, unit] = await Promise.all([
    pool.query<{ zone: string; effective_from: string; epoch: string }>(
      `select zone,
              to_char(effective_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as effective_from,
              extract(epoch from effective_from)::text as epoch
       from zone_history order by effective_from`,
    ),
    pool.query<{ unit: Unit }>('select unit from app_settings where id = 1'),
  ]);
  return {
    history: zones.rows.map((row) => ({
      zone: row.zone,
      effective_from: row.effective_from,
      effective_from_ms: Number(row.epoch) * 1000,
    })),
    unit: unit.rows[0]?.unit ?? 'mm',
  };
}

export async function effectiveZone(): Promise<string> {
  const settings = await loadSettings();
  return effectiveZoneAt(settings.history, nowMs());
}

export function toSettingsJson(settings: DeckSettings, instantMs: number): SettingsJson {
  const homeZone = effectiveZoneAt(settings.history, instantMs);
  const pending = pendingEntryAt(settings.history, instantMs);
  return {
    home_zone: homeZone,
    pending_zone: pending
      ? {
          zone: pending.zone,
          effective_from: pending.effective_from,
          // The local date in the old zone on which the change takes effect.
          effective_date: localDate(homeZone, pending.effective_from_ms),
        }
      : null,
    history: settings.history.map((entry) => ({
      zone: entry.zone,
      effective_from: entry.effective_from,
    })),
    unit: settings.unit,
    server_now: toIso(instantMs),
  };
}

export async function saveHomeZone(zone: string): Promise<void> {
  await withTransaction(async (client) => {
    const instant = nowMs();
    const stored = await client.query<{ zone: string; effective_from: string; epoch: string }>(
      `select zone,
              to_char(effective_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as effective_from,
              extract(epoch from effective_from)::text as epoch
       from zone_history order by effective_from for update`,
    );
    const history: ZoneEntry[] = stored.rows.map((row) => ({
      zone: row.zone,
      effective_from: row.effective_from,
      effective_from_ms: Number(row.epoch) * 1000,
    }));
    const change = planZoneChange(history, instant, zone);
    await client.query(`delete from zone_history where effective_from > $1::timestamptz`, [
      nowIso(),
    ]);
    if (change.action === 'cancel') return;
    await client.query(
      `insert into zone_history (effective_from, zone) values ($1::timestamptz, $2)
       on conflict (effective_from) do update set zone = excluded.zone`,
      [toIso(change.effectiveFromMs), change.zone],
    );
  });
}

export async function saveUnit(unit: Unit): Promise<void> {
  await pool.query('update app_settings set unit = $1 where id = 1', [unit]);
}
