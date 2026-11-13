import { EventEmitter } from "node:events";
import { HUBS, type HubId } from "../shared/catalogue.js";
import { appNow, realNow } from "../shared/clock.js";
import { fail } from "./errors.js";
import { LedgerDamaged, LedgerDown, ledger } from "./ledger.js";
import { one, pool, q, tx, type Db } from "./db.js";

// --- the app clock, shared by every copy through Postgres

export async function now(db: Db = pool): Promise<number> {
  const row = await one<{ base_real_ms: number; base_app_ms: number; frozen: boolean }>("SELECT base_real_ms, base_app_ms, frozen FROM app_clock WHERE id=1", [], db);
  if (!row) throw new Error("the app clock is not seeded");
  return appNow({ baseRealMs: row.base_real_ms, baseAppMs: row.base_app_ms, frozen: row.frozen });
}

export async function setClock(atMs: number, freeze: boolean): Promise<void> {
  await q("UPDATE app_clock SET base_real_ms=$1, base_app_ms=$2, frozen=$3 WHERE id=1", [realNow(), atMs, freeze]);
}

// --- change notification: a bump in Postgres is the truth, the ledger channel and the poll are hints

export const events = new EventEmitter();
events.setMaxListeners(0);

export class Changes {
  private readonly hubs = new Set<HubId>();
  private readonly riders = new Set<string>();
  private bumped: { hub: string; seq: number }[] = [];

  hub(...hubs: HubId[]): this {
    for (const h of hubs) this.hubs.add(h);
    return this;
  }
  allHubs(): this {
    return this.hub(...HUBS.map((h) => h.id));
  }
  rider(...riders: (string | null | undefined)[]): this {
    for (const r of riders) if (r) this.riders.add(r);
    return this;
  }
  get empty(): boolean {
    return this.hubs.size === 0 && this.riders.size === 0;
  }

  /** Runs inside the transaction that made the change. */
  async apply(c: Db): Promise<void> {
    if (this.hubs.size > 0) {
      this.bumped = await q<{ hub: string; seq: number }>("UPDATE hub_state SET seq=seq+1 WHERE hub = ANY($1) RETURNING hub, seq", [[...this.hubs].sort()], c);
    }
    for (const rider of [...this.riders].sort()) {
      await q("INSERT INTO rider_ver (rider_id, ver) VALUES ($1, nextval('change_seq')) ON CONFLICT (rider_id) DO UPDATE SET ver = nextval('change_seq')", [rider], c);
    }
  }

  /** Runs after the transaction committed. */
  publish(): void {
    for (const b of this.bumped) ledger.publishLive(b.hub, b.seq);
    for (const r of this.riders) ledger.publishRider(r);
    nudge();
  }
}

/** Applies a set of changes in a transaction of their own. */
export async function commitChanges(changes: Changes): Promise<void> {
  if (changes.empty) return;
  await tx((c) => changes.apply(c));
  changes.publish();
}

const seenSeq = new Map<string, number>();
let seenVer = -1;
let polling = false;
let again = false;

export async function poll(): Promise<void> {
  if (polling) {
    again = true;
    return;
  }
  polling = true;
  try {
    do {
      again = false;
      const hubs = await q<{ hub: string; seq: number }>("SELECT hub, seq FROM hub_state");
      for (const h of hubs) {
        const before = seenSeq.get(h.hub);
        seenSeq.set(h.hub, h.seq);
        if (before !== undefined && before !== h.seq) events.emit("hub", h.hub as HubId, h.seq);
      }
      const fresh = await q<{ rider_id: string; ver: number }>("SELECT rider_id, ver FROM rider_ver WHERE ver > $1", [Math.max(seenVer, 0)]);
      const first = seenVer < 0;
      for (const r of fresh) {
        seenVer = Math.max(seenVer, r.ver);
        if (!first) events.emit("rider", r.rider_id);
      }
      if (first) seenVer = Math.max(seenVer, 0);
    } while (again);
  } catch {
    // Postgres is away; the next poll catches up from the stored sequence numbers.
  } finally {
    polling = false;
  }
}

export function nudge(): void {
  void poll();
}

// --- hub and ledger status, shared by every copy

type HubStatus = {
  hub: HubId;
  seq: number;
  stale: boolean;
  reason: "system" | "count" | null;
  asOfMs: number;
  counting: boolean;
  damaged: boolean;
  ledgerDown: boolean;
};

type StatusRow = { hub: string; seq: number; counting: boolean; count_started_ms: number | null; stock_as_of_ms: number; damaged_real_ms: number | null; down: boolean };

const toStatus = (r: StatusRow): HubStatus => {
  const system = r.down || r.damaged_real_ms !== null;
  const reason = system ? "system" : r.counting ? "count" : null;
  return {
    hub: r.hub as HubId,
    seq: r.seq,
    stale: reason !== null,
    reason,
    asOfMs: reason === "count" ? (r.count_started_ms ?? r.stock_as_of_ms) : r.stock_as_of_ms,
    counting: r.counting,
    damaged: r.damaged_real_ms !== null,
    ledgerDown: r.down,
  };
};

const STATUS_SQL = "SELECT h.hub, h.seq, h.counting, h.count_started_ms, h.stock_as_of_ms, h.damaged_real_ms, l.down FROM hub_state h CROSS JOIN ledger_status l";

export async function hubStatus(hub: HubId, db: Db = pool): Promise<HubStatus> {
  const row = await one<StatusRow>(`${STATUS_SQL} WHERE h.hub=$1`, [hub], db);
  if (!row) throw new Error(`unknown hub ${hub}`);
  return toStatus(row);
}

export async function allStatuses(): Promise<HubStatus[]> {
  return (await q<StatusRow>(STATUS_SQL)).map(toStatus);
}

export async function markLedgerDown(): Promise<void> {
  const changed = await q("UPDATE ledger_status SET down=true WHERE id=1 AND NOT down RETURNING id");
  if (changed.length > 0) await commitChanges(new Changes().allHubs());
}

export async function markLedgerUp(): Promise<void> {
  const changed = await q("UPDATE ledger_status SET down=false WHERE id=1 AND down RETURNING id");
  if (changed.length > 0) await commitChanges(new Changes().allHubs());
}

async function markDamaged(hub: HubId): Promise<void> {
  const changed = await q("UPDATE hub_state SET damaged_real_ms=$2 WHERE hub=$1 AND damaged_real_ms IS NULL RETURNING hub", [hub, realNow()]);
  if (changed.length > 0) await commitChanges(new Changes().hub(hub));
}

/** Turns a ledger failure met inside `work` into the honest refusal, after recording what was found. */
export async function guarded<T>(hub: HubId, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LedgerDown) {
      await markLedgerDown();
      throw fail("hub_unreachable");
    }
    if (error instanceof LedgerDamaged) {
      await markDamaged(hub);
      throw fail("hub_unreachable");
    }
    throw error;
  }
}
