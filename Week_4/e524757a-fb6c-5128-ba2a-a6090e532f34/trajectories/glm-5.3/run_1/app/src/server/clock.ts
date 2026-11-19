// The world clock and the live hub. The server owns the tick; grading worlds are frozen.

import { Db, withClient } from "./db";
import { Config } from "../shared/config";
import { hourOfTick, minuteOfTick, weatherAt, isDusk, presentCreatures } from "../shared/creatures";

export interface WorldRow {
  id: string;
  kind: "main" | "grading";
  tick: number;
  frozen: boolean;
  start_ms: number;
}

export interface WorldSnapshot {
  world: string;
  tick: number;
  hour: number;
  minute: number;
  time: string;
  weather: "clear" | "rain";
  dusk: boolean;
  lighthouse: "open" | "closed";
  creatures: ReturnType<typeof presentCreatures>;
}

export class WorldClock {
  constructor(private db: Db, private config: Config) {}

  /** The tick of a world: frozen worlds stay at their row's tick; the main world advances from its epoch. */
  async tickOf(worldId: string): Promise<number> {
    return withClient(this.db, async client => {
      const r = await client.query<{ tick: string; frozen: boolean; start_ms: string }>(
        "SELECT tick, frozen, start_ms FROM worlds WHERE id = $1", [worldId]);
      if (r.rows.length === 0) throw new Error("world-missing");
      const row = r.rows[0];
      if (row.frozen) return Number(row.tick);
      const now = Date.now();
      const elapsed = Math.floor((now - Number(row.start_ms)) / this.config.worldTickMs);
      return Number(row.tick) + elapsed;
    });
  }

  async setTick(worldId: string, tick: number): Promise<void> {
    await this.db.query("UPDATE worlds SET tick = $2, start_ms = $3 WHERE id = $1", [worldId, tick, Date.now()]);
  }

  async snapshot(worldId: string): Promise<WorldSnapshot> {
    const tick = await this.tickOf(worldId);
    return this.snapshotAtTick(worldId, tick);
  }

  snapshotAtTick(worldId: string, tick: number): WorldSnapshot {
    const dayTicks = this.config.worldDayTicks;
    const hour = hourOfTick(tick, dayTicks);
    const minute = minuteOfTick(tick, dayTicks);
    const weather = weatherAt(tick, this.config);
    const dusk = isDusk(tick, this.config);
    return {
      world: worldId,
      tick,
      hour,
      minute,
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      weather,
      dusk,
      lighthouse: "closed",
      creatures: presentCreatures(tick, this.config)
    };
  }
}
