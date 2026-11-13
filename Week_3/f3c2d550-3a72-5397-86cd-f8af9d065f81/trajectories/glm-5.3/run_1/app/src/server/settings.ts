// Settings: the home-zone history and pending change, and the unit preference.
// The effective zone at an instant is the entry with the latest effective_from
// at or before it; a new zone takes effect at the next local midnight in the
// currently effective zone.

import type { Pool } from "pg";
import { effectiveZone, isAcceptedZone, nextLocalMidnight, dateToYyyyMmDd, localDate, type ZoneEntry } from "./zones.js";
import { toIsoSecond } from "./repo.js";

export interface PendingZone { zone: string; effective_from: string; effective_date: string }

export interface Settings {
  home_zone: string;
  pending_zone: PendingZone | null;
  history: Array<{ zone: string; effective_from: string }>;
  unit: "mm" | "in";
  server_now: string;
}

interface SettingsRow { home_history: ZoneRow[]; pending_zone: PendingRow | null; unit: string }

interface ZoneRow { zone: string; effective_from: string }
interface PendingRow { zone: string; effective_from: string }

function rowToPending(row: PendingRow | null, atMs: number, currentZone: string): PendingZone | null {
  if (!row) return null;
  const from = Date.parse(row.effective_from);
  if (from <= atMs) return null;
  const d = localDate(currentZone, from);
  return { zone: row.zone, effective_from: toIsoSecond(new Date(from)), effective_date: dateToYyyyMmDd(d) };
}

export async function getSettings(pool: Pool, nowMs: number): Promise<Settings> {
  await pool.query(
    `INSERT INTO settings (singleton, home_history, pending_zone, unit)
     VALUES (true, '[{"zone":"Europe/London","effective_from":"2024-01-01T00:00:00Z"}]'::jsonb, NULL, 'mm')
     ON CONFLICT (singleton) DO NOTHING`,
  );
  const { rows } = await pool.query<SettingsRow>(`SELECT home_history, pending_zone, unit FROM settings WHERE singleton = true`);
  const row = rows[0];
  const history: ZoneEntry[] = (row.home_history ?? []).map((e) => ({ zone: e.zone, effective_from: Date.parse(e.effective_from) }));
  const currentZone = effectiveZone(history, nowMs);
  return {
    home_zone: currentZone,
    pending_zone: rowToPending(row.pending_zone, nowMs, currentZone),
    history: history.map((e) => ({ zone: e.zone, effective_from: toIsoSecond(new Date(e.effective_from)) })),
    unit: row.unit === "in" ? "in" : "mm",
    server_now: toIsoSecond(new Date(nowMs)),
  };
}

// Save a new zone: a pending entry effective at the next local midnight in the
// currently effective zone. Saving the currently effective zone cancels any
// pending change.
export async function saveHomeZone(pool: Pool, zone: string, nowMs: number): Promise<Settings> {
  const settings = await getSettings(pool, nowMs);
  if (zone === settings.home_zone) {
    await pool.query(`UPDATE settings SET pending_zone = NULL WHERE singleton = true`);
  } else {
    const from = nextLocalMidnight(settings.home_zone, nowMs);
    await pool.query(`UPDATE settings SET pending_zone = $1::jsonb WHERE singleton = true`,
      [JSON.stringify({ zone, effective_from: toIsoSecond(new Date(from)) })]);
  }
  return getSettings(pool, nowMs);
}

// Apply any pending zone whose effective_from has passed. Called on the shared
// record so every app copy converges.
export async function applyDueZoneChange(pool: Pool, nowMs: number): Promise<void> {
  const { rows } = await pool.query<{ home_history: ZoneRow[]; pending_zone: PendingRow | null }>(
    `SELECT home_history, pending_zone FROM settings WHERE singleton = true FOR UPDATE`);
  const row = rows[0];
  if (!row?.pending_zone) return;
  const from = Date.parse(row.pending_zone.effective_from);
  if (from > nowMs) return;
  const history = [...(row.home_history ?? []), { zone: row.pending_zone.zone, effective_from: row.pending_zone.effective_from }];
  await pool.query(`UPDATE settings SET home_history = $1::jsonb, pending_zone = NULL WHERE singleton = true`,
    [JSON.stringify(history)]);
}

export async function saveUnit(pool: Pool, unit: "mm" | "in", nowMs: number): Promise<Settings> {
  await getSettings(pool, nowMs);
  await pool.query(`UPDATE settings SET unit = $1 WHERE singleton = true`, [unit]);
  return getSettings(pool, nowMs);
}

export { isAcceptedZone };
