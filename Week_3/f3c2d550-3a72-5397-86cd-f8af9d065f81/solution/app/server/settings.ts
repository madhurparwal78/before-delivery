import type { Settings } from "../shared/api.js";
import type { SizeUnit } from "../shared/sizes.js";
import { isoSeconds, now } from "./clock.js";
import { pool, query, transaction, type Queryable } from "./db.js";
import { validationError } from "./errors.js";
import { effectiveZone, isAcceptedZone, localDateOf, nextLocalMidnight, type ZoneEntry } from "./zones.js";

interface HistoryRow {
  zone: string;
  effective_from: Date;
}

async function loadHistory(client: Queryable = pool): Promise<ZoneEntry[]> {
  const rows = await query<HistoryRow>("SELECT zone, effective_from FROM zone_history ORDER BY effective_from", [], client);
  return rows.map((row) => ({ zone: row.zone, effectiveFrom: row.effective_from }));
}

/** The home zone in effect at the server's clock; every local-time rule reads it from here. */
export async function homeZone(): Promise<string> {
  return effectiveZone(await loadHistory(), now());
}

async function savedUnit(client: Queryable = pool): Promise<SizeUnit> {
  const [row] = await query<{ unit: SizeUnit }>("SELECT unit FROM deck_settings WHERE id = 1", [], client);
  return row?.unit ?? "mm";
}

export async function readSettings(client: Queryable = pool): Promise<Settings> {
  const instant = now();
  const entries = await loadHistory(client);
  const zone = effectiveZone(entries, instant);
  const pending = entries.find((entry) => entry.effectiveFrom > instant);
  return {
    home_zone: zone,
    pending_zone: pending
      ? { zone: pending.zone, effective_from: isoSeconds(pending.effectiveFrom), effective_date: localDateOf(pending.effectiveFrom, zone) }
      : null,
    history: entries
      .filter((entry) => entry.effectiveFrom <= instant)
      .map((entry) => ({ zone: entry.zone, effective_from: isoSeconds(entry.effectiveFrom) })),
    unit: await savedUnit(client),
    server_now: isoSeconds(instant),
  };
}

export async function saveHomeZone(zone: unknown): Promise<Settings> {
  if (!isAcceptedZone(zone)) throw validationError({ zone: "Choose a time zone from the list." });
  return transaction(async (client) => {
    await client.query("SELECT 1 FROM deck_settings WHERE id = 1 FOR UPDATE");
    const instant = now();
    const entries = await loadHistory(client);
    const current = effectiveZone(entries, instant);
    const pending = entries.find((entry) => entry.effectiveFrom > instant);
    if (zone === current) {
      await client.query("DELETE FROM zone_history WHERE effective_from > $1", [instant]);
    } else if (pending) {
      await client.query("UPDATE zone_history SET zone = $1 WHERE effective_from = $2", [zone, pending.effectiveFrom]);
    } else {
      await client.query("INSERT INTO zone_history (effective_from, zone) VALUES ($1, $2)", [nextLocalMidnight(instant, current), zone]);
    }
    return readSettings(client);
  });
}

export async function saveUnit(unit: unknown): Promise<Settings> {
  if (unit !== "mm" && unit !== "in") throw validationError({ unit: "Choose millimetres or inches." });
  await query("UPDATE deck_settings SET unit = $1 WHERE id = 1", [unit]);
  return readSettings();
}
