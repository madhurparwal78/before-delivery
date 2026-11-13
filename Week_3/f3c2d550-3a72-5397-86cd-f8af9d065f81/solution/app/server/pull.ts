import type { DailyPull } from "../shared/api.js";
import { isoSeconds, now } from "./clock.js";
import { query } from "./db.js";
import { findReferences, toReference } from "./references.js";
import { homeZone } from "./settings.js";
import { nextPullAt, pullDay, startOfLocalDay } from "./zones.js";

const RECENT_PULLS = 30;

/** The earliest-captured stored reference outside the last 30 pulls, or the one whose latest pick is oldest. */
async function choosePick(): Promise<string | null> {
  const [fresh] = await query<{ id: string }>(
    `SELECT id FROM deck_reference
     WHERE state = 'stored'
       AND id NOT IN (SELECT reference_id FROM (SELECT reference_id FROM daily_pull ORDER BY pull_day DESC LIMIT $1) recent)
     ORDER BY captured_at, id LIMIT 1`,
    [RECENT_PULLS],
  );
  if (fresh) return fresh.id;
  const [stale] = await query<{ id: string }>(
    `SELECT r.id FROM deck_reference r
     JOIN (SELECT reference_id, max(pull_day) AS latest FROM daily_pull GROUP BY reference_id) p ON p.reference_id = r.id
     WHERE r.state = 'stored' ORDER BY p.latest, r.captured_at, r.id LIMIT 1`,
  );
  return stale?.id ?? null;
}

/** The pick for the pull day; the first request of a day makes it and the primary key keeps exactly one. */
export async function readDailyPull(): Promise<DailyPull> {
  const instant = now();
  const zone = await homeZone();
  const day = pullDay(instant, zone);
  let [picked] = await query<{ reference_id: string }>("SELECT reference_id FROM daily_pull WHERE pull_day = $1", [day]);
  if (!picked) {
    const id = await choosePick();
    if (id) {
      await query("INSERT INTO daily_pull (pull_day, reference_id, picked_at) VALUES ($1, $2, $3) ON CONFLICT (pull_day) DO NOTHING", [day, id, instant]);
      [picked] = await query<{ reference_id: string }>("SELECT reference_id FROM daily_pull WHERE pull_day = $1", [day]);
    }
  }
  const [row] = picked ? await findReferences([picked.reference_id]) : [];
  const stored = row?.state === "stored" ? row : undefined;
  return {
    pull_day: day,
    zone,
    state: !picked ? "empty" : stored ? "picked" : "removed",
    reference: stored ? toReference(stored) : null,
    next_pull_at: isoSeconds(nextPullAt(instant, zone)),
    today_starts_at: isoSeconds(startOfLocalDay(instant, zone)),
    server_now: isoSeconds(instant),
  };
}
