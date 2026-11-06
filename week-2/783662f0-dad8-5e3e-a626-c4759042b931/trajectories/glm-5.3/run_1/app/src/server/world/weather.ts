/** Weather and day: decided only here, from the published schedule. */

import { config } from "../config.js";
import type { Pool } from "../db/pool.js";
import { publish } from "../api/events.js";
import { isoInstant } from "../time.js";

const WeatherCycle: ("clear" | "rain" | "storm")[] = ["clear", "rain", "clear", "storm"];

/** Weather period k, indexed by (k + seed) mod 4. */
export function weatherAt(seed: number, epochSeconds: number): "clear" | "rain" | "storm" {
  const k = Math.floor(epochSeconds / config().weatherPeriodSeconds);
  return WeatherCycle[(k + seed) % 4]!;
}

/** The night level, linear between the published points, rounded to three decimals. */
export function nightLevel(epochSeconds: number): number {
  const phase = ((epochSeconds % config().dayCycleSeconds) + config().dayCycleSeconds) % config().dayCycleSeconds / config().dayCycleSeconds;
  let start: number;
  let end: number;
  if (phase <= 0.25) {
    start = 0.45;
    end = 0.15;
  } else if (phase <= 0.5) {
    start = 0.15;
    end = 0;
  } else if (phase <= 0.75) {
    start = 0;
    end = 0.15;
  } else {
    start = 0.15;
    end = 0.45;
  }
  const span = end - start;
  const sub = ((phase * 4) % 1);
  return Math.round((start + span * sub) * 1000) / 1000;
}

export interface WeatherView {
  weather: "clear" | "rain" | "storm";
  since: string;
  changes_at: string;
  night_level: number;
}

export async function weatherView(pool: Pool, serverId: string): Promise<WeatherView> {
  const server = (await pool.query<{ weather_seed: number }>("SELECT weather_seed FROM servers WHERE id = $1", [serverId])).rows[0];
  const seed = server?.weather_seed ?? 0;
  const nowSeconds = Date.now() / 1000;
  const period = config().weatherPeriodSeconds;
  const k = Math.floor(nowSeconds / period);
  const sinceSeconds = k * period;
  const changesAtSeconds = (k + 1) * period;
  return {
    weather: weatherAt(seed, nowSeconds),
    since: isoInstant(new Date(sinceSeconds * 1000)),
    changes_at: isoInstant(new Date(changesAtSeconds * 1000)),
    night_level: nightLevel(nowSeconds),
  };
}

/** Pushes weather changes to a server within the push delay. */
export async function scanWeather(pool: Pool): Promise<void> {
  const servers = await pool.query<{ id: string; weather_seed: number }>("SELECT id, weather_seed FROM servers");
  for (const server of servers.rows) {
    const view = await weatherView(pool, server.id);
    const current = view.weather;
    const pushed = weatherPushed.get(server.id);
    if (pushed !== current) {
      weatherPushed.set(server.id, current);
      await publish(pool, server.id, [{ kind: "weather", payload: view }]);
    }
  }
}

const weatherPushed = new Map<string, string>();
