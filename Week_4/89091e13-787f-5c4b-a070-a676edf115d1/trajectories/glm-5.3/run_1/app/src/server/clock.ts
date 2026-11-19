// The server clock and the due-event loop. The clock starts at APP_START_AT and
// advances with real time in realtime mode, or only through the grading clock
// route in manual mode. Every due event runs in time order at its own instant.

import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";

export type EventKind =
  | "unbonding-release"
  | "proposal-deposit-end"
  | "proposal-voting-end"
  | "vote-reminder"
  | "block-production"
  | "light-node-sample"
  | "fraud-check";

export interface DueEvent {
  at: number;
  kind: EventKind;
  order: number;
  workspaceId?: string;
  payload?: Record<string, unknown>;
}

const EVENT_ORDER: Record<EventKind, number> = {
  "unbonding-release": 1,
  "proposal-deposit-end": 2,
  "block-production": 3,
  "light-node-sample": 4,
  "fraud-check": 5,
  "proposal-voting-end": 6,
  "vote-reminder": 7,
};

export function compareEvents(a: DueEvent, b: DueEvent): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.order !== b.order) return a.order - b.order;
  return (a.workspaceId ?? "").localeCompare(b.workspaceId ?? "");
}

export function eventOrder(kind: EventKind): number {
  return EVENT_ORDER[kind]!;
}

export class Clock {
  private config: AppConfig;
  private db: Db;
  private offsetMs: bigint;
  private bootRealMs: number;

  constructor(config: AppConfig, db: Db, persistedOffsetMs: bigint) {
    this.config = config;
    this.db = db;
    this.offsetMs = persistedOffsetMs;
    this.bootRealMs = Date.now();
  }

  /** Current simulated time in epoch milliseconds. */
  now(): number {
    if (this.config.clockMode === "manual") {
      return Number(this.appStartMs() + this.offsetMs);
    }
    return Number(this.appStartMs() + this.offsetMs) + (Date.now() - this.bootRealMs);
  }

  private appStartMs(): bigint {
    return BigInt(this.config.appStartAtMs);
  }

  /** Sets the persisted offset; used by the grading reset, seed and clock routes. */
  async setOffset(ms: bigint): Promise<void> {
    this.offsetMs = ms;
    this.bootRealMs = Date.now();
    await this.db.query(`INSERT INTO meta (key, value) VALUES ('clock_offset', $1)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [ms.toString()]);
  }

  currentOffset(): bigint {
    return this.offsetMs;
  }

  /** Block h of every network is produced at APP_START_AT + h x BLOCK_TIME_SECONDS. */
  blockTimeMs(height: number): number {
    return this.config.appStartAtMs + height * this.config.blockTimeSeconds * 1000;
  }
}
