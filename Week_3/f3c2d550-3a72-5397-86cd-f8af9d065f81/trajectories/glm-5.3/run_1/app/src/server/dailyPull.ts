// Daily Pull: the pull day turns over at 06:00 local in the effective home zone;
// the pick excludes the last 30 pulls; every request on a pull day returns the
// same single pick, decided by the shared records.

import type { Pool } from "pg";
import { pullDayFor, nextPullAt, dateToYyyyMmDd, effectiveZone, startOfDay, type ZoneEntry } from "./zones.js";
import { toIsoSecond, rowToReference, type ReferenceRow } from "./repo.js";
import type { Reference } from "../shared/domain.js";

export interface DailyPullBody {
  pull_day: string;
  zone: string;
  state: "picked" | "empty" | "removed";
  reference: Reference | null;
  next_pull_at: string;
  today_starts_at: string;
  server_now: string;
}

const PICK_SPAN_DAYS = 30;

export async function getDailyPull(pool: Pool, zone: ZoneEntry[], nowMs: number): Promise<DailyPullBody> {
  const home = effectiveZone(zone, nowMs);
  const day = pullDayFor(home, nowMs);
  const dayKey = dateToYyyyMmDd(day);

  // First request on a pull day without a pick makes the pick, guarded by an
  // insert-only write so simultaneous requests on any copies create exactly one.
  const existing = await pool.query<{ reference_id: string }>(
    `SELECT reference_id FROM daily_pulls WHERE pull_day = $1`, [dayKey]);

  let pickedId: string | null = existing.rows[0]?.reference_id ?? null;
  if (!pickedId) {
    pickedId = await pickForPullDay(pool, dayKey);
  }

  let state: DailyPullBody["state"] = "empty";
  let reference: Reference | null = null;
  if (pickedId) {
    const { rows } = await pool.query(
      `SELECT id, state, version, title, maker, year, materials, finish, colour_family,
        source_url, source_note, notes, width_tenths, height_tenths, depth_tenths,
        swatch, swatch_source, captured_at, trashed_at, purge_at,
        photo_content_type, photo_bytes, photo_sha256, photo_width, photo_height
       FROM "references" WHERE id = $1`, [pickedId]);
    if (rows[0] && rows[0].state === "stored") {
      state = "picked";
      reference = rowToReference(rows[0] as ReferenceRow);
    } else if (rows[0]) {
      state = "removed";
    }
  }

  const next = nextPullAt(home, nowMs);
  const todayStart = startOfDay(home, nowMs);
  return {
    pull_day: dayKey,
    zone: home,
    state,
    reference,
    next_pull_at: toIsoSecond(new Date(next)),
    today_starts_at: toIsoSecond(new Date(startOfDay(home, nowMs))),
    server_now: toIsoSecond(new Date(nowMs)),
  };
}

// The published pick rule among stored references not picked in the 30 most
// recent pulls by pull day; ties by smaller id; if all were picked, the one
// whose latest pick is oldest.
async function pickForPullDay(pool: Pool, dayKey: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock the daily_pulls rows and the candidate references so simultaneous
    // first requests on any copy converge on one pick.
    await client.query(`LOCK TABLE daily_pulls IN ACCESS EXCLUSIVE MODE`);
    const again = await client.query<{ reference_id: string }>(
      `SELECT reference_id FROM daily_pulls WHERE pull_day = $1`, [dayKey]);
    if (again.rows[0]) {
      await client.query("COMMIT");
      return again.rows[0].reference_id;
    }
    const { rows } = await client.query<{ id: string }>(
      `SELECT r.id
       FROM "references" r
       WHERE r.state = 'stored'
         AND r.id NOT IN (
           SELECT reference_id FROM daily_pulls
           WHERE pull_day > ($1::date - interval '${PICK_SPAN_DAYS} days')
         )
       ORDER BY r.captured_at ASC, r.id ASC
       LIMIT 1`, [dayKey]);
    let id = rows[0]?.id ?? null;
    if (!id) {
      const fallback = await client.query<{ id: string }>(
        `SELECT r.id FROM "references" r
         WHERE r.state = 'stored'
         ORDER BY (SELECT max(pull_day) FROM daily_pulls dp WHERE dp.reference_id = r.id) NULLS FIRST,
                  r.captured_at ASC, r.id ASC
         LIMIT 1`);
      id = fallback.rows[0]?.id ?? null;
    }
    if (id) {
      await client.query(`INSERT INTO daily_pulls (pull_day, reference_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [dayKey, id]);
    }
    await client.query("COMMIT");
    return id;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
