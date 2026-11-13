import { HUBS, type FinishId, type HubId, type ModelId } from "../shared/catalogue.js";
import { realNow } from "../shared/clock.js";
import { Changes, commitChanges, markLedgerDown, markLedgerUp, now } from "./core.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { runDue } from "./due.js";
import { LedgerDamaged, LedgerDown, keys, ledger } from "./ledger.js";
import { earlierSaleRefs, rebuildPlaces, rebuildUnit } from "./rebuild.js";
import { holdScore, slotMinute } from "./rules.js";
import { HELD_SQL } from "./views.js";

/**
 * The sweep: every 10 seconds on every copy it proves the ledger accepts writes, writes the heartbeat, compares the ledger
 * with Postgres, and repairs the difference. A missing key or member is put back once it is still missing 400 ms later; an
 * orphan or a changed value is acted on only when two sweeps in a row see it, so a claim in progress never loses its member.
 */

export const SWEEP_MS = 10_000;
let sweepNumber = 0;
const suspects = new Map<string, number>();

type Expected = { strings: Map<string, string>; sets: Map<string, Set<string>>; zsets: Map<string, Map<string, number | null>> };

async function expected(): Promise<Expected> {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Map<string, number | null>>();
  for (const s of await q<{ hub: string; model: string; finish: string; on_hand: number }>("SELECT hub, model, finish, on_hand FROM stock")) {
    strings.set(keys.onhand(s.hub, s.model, s.finish), String(s.on_hand));
    zsets.set(keys.holds(s.hub, s.model, s.finish), new Map());
  }
  for (const l of await q<{ ref: string; hub: string; model: string; finish: string; state: string; expires_ms: number | null }>(
    `SELECT l.ref, l.hub, l.model, l.finish, l.state, l.expires_ms FROM locks l WHERE ${HELD_SQL}`,
  )) {
    zsets.get(keys.holds(l.hub, l.model, l.finish))?.set(l.ref, holdScore(l.state, l.expires_ms));
  }
  for (const r of await q<{ id: string; hub: string; starts_ms: number }>("SELECT id, hub, starts_ms FROM rides WHERE state='booked'")) {
    strings.set(keys.slot(r.hub, slotMinute(r.starts_ms)), r.id);
  }
  for (const e of await q<{ hub: string; date: string; n: number }>("SELECT hub, date, n FROM earlier_sales")) {
    const set = new Set<string>(earlierSaleRefs(e.n));
    sets.set(keys.places(e.hub, e.date), set);
  }
  for (const l of await q<{ ref: string; hub: string; delivery_date: string }>("SELECT ref, hub, delivery_date FROM locks WHERE state IN ('delivery_set','delivered')")) {
    const key = keys.places(l.hub, l.delivery_date);
    const set = sets.get(key) ?? new Set<string>();
    set.add(l.ref);
    sets.set(key, set);
  }
  return { strings, sets, zsets };
}

/** True when this exact difference was also seen by the previous sweep, so it is now safe to act on. */
function confirmed(id: string): boolean {
  const before = suspects.get(id);
  suspects.set(id, sweepNumber);
  return before === sweepNumber - 1;
}

const parts = (key: string): string[] => key.slice(config.valkeyPrefix.length + 1).split(":");
const hubOfKey = (key: string): string => parts(key)[1] ?? "";

/** A key or member the ledger lacks is put back once it is still missing after this long, so work in flight is never undone. */
const SETTLE_MS = 400;

async function reconcile(want: Expected, keyList: { key: string; type: string }[], skip: Set<string>): Promise<void> {
  const present = new Map(keyList.map((i) => [i.key, i.type]));
  const seen = new Set<string>();
  const note = (id: string): boolean => {
    seen.add(id);
    return confirmed(id);
  };
  // A restore asks Postgres again once it has settled: the first read may predate a release that has since committed.
  const restores: ((now: Expected) => Promise<void>)[] = [];
  for (const [key, value] of want.strings) {
    if (skip.has(hubOfKey(key))) continue;
    if (present.get(key) !== "string") {
      restores.push(async (now) => {
        const current = now.strings.get(key);
        if (current !== undefined && (await ledger.string(key)) === null) await ledger.setString(key, current);
      });
    } else if ((await ledger.string(key)) !== value && note(`str|${key}|${value}`)) await ledger.setString(key, value);
  }
  for (const [key, members] of want.sets) {
    if (skip.has(hubOfKey(key))) continue;
    const have = new Set(present.get(key) === "set" ? await ledger.members(key) : []);
    for (const m of members) if (!have.has(m)) restores.push(async (now) => (!now.sets.get(key)?.has(m) || (await ledger.members(key)).includes(m) ? undefined : ledger.add(key, "set", m)));
    for (const m of have) if (!members.has(m) && note(`srem|${key}|${m}`)) await ledger.remove(key, "set", m);
  }
  for (const [key, members] of want.zsets) {
    if (skip.has(hubOfKey(key))) continue;
    const have = new Set(present.get(key) === "zset" ? await ledger.holdMembers(key) : []);
    for (const m of members.keys()) {
      if (have.has(m)) continue;
      restores.push(async (now) => {
        const held = now.zsets.get(key);
        if (held?.has(m) && !(await ledger.holdMembers(key)).includes(m)) await ledger.add(key, "zset", m, held.get(m) ?? null);
      });
    }
    for (const m of have) if (!members.has(m) && note(`zrem|${key}|${m}`)) await ledger.remove(key, "zset", m);
  }
  for (const { key, type } of keyList) {
    if (skip.has(hubOfKey(key)) || key === keys.heartbeat) continue;
    const known = want.strings.has(key) || want.sets.has(key) || want.zsets.has(key);
    if (!known && (type === "string" || type === "set" || type === "zset") && note(`orphan|${key}`)) await ledger.del(key);
  }
  for (const id of suspects.keys()) if (!seen.has(id)) suspects.delete(id);
  if (restores.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const fresh = await expected();
    for (const restore of restores) await restore(fresh);
  }
}

/** Finds hubs whose keys are damaged: a key of the wrong type, or an on-hand value that is not an integer. */
async function damagedHubs(present: { key: string; type: string }[]): Promise<Set<string>> {
  const bad = new Set<string>();
  for (const { key, type } of present) {
    if (key === keys.heartbeat || type === "none") continue; // "none" is a key deleted since the listing, not one of the wrong type.
    const kind = parts(key)[0];
    const hub = hubOfKey(key);
    const wanted = kind === "holds" ? "zset" : kind === "places" ? "set" : kind === "slot" || kind === "onhand" ? "string" : null;
    if (wanted && type !== wanted) bad.add(hub);
    else if (kind === "onhand") {
      const value = await ledger.string(key); // A key gone since the listing is missing, not damaged: reconcile restores it.
      if (value !== null && !/^-?\d+$/.test(value)) bad.add(hub);
    }
  }
  return bad;
}

async function repairHub(hub: HubId): Promise<void> {
  for (const i of (await ledger.keyTypes()).filter((k) => hubOfKey(k.key) === hub)) await ledger.del(i.key);
  for (const s of await q<{ model: ModelId; finish: FinishId }>("SELECT model, finish FROM stock WHERE hub=$1", [hub])) await rebuildUnit(undefined, hub, s.model, s.finish);
  for (const r of await q<{ id: string; starts_ms: number }>("SELECT id, starts_ms FROM rides WHERE hub=$1 AND state='booked'", [hub])) {
    await ledger.setSlot(hub, slotMinute(r.starts_ms), r.id);
  }
  const days = await q<{ date: string }>("SELECT date FROM earlier_sales WHERE hub=$1 UNION SELECT delivery_date FROM locks WHERE hub=$1 AND state IN ('delivery_set','delivered')", [hub]);
  for (const d of days) await rebuildPlaces(undefined, hub, d.date);
}

export async function sweep(): Promise<void> {
  sweepNumber += 1;
  const nowMs = await now();
  try {
    await ledger.heartbeat(nowMs);
    await markLedgerUp();
    let present = await ledger.keyTypes();
    const bad = await damagedHubs(present);
    const marked = await q<{ hub: HubId; damaged_real_ms: number | null }>("SELECT hub, damaged_real_ms FROM hub_state");
    const changes = new Changes();
    const skip = new Set<string>(bad);
    for (const h of marked) {
      if (h.damaged_real_ms === null) continue;
      if (realNow() - h.damaged_real_ms >= SWEEP_MS) {
        await repairHub(h.hub);
        await q("UPDATE hub_state SET damaged_real_ms=NULL WHERE hub=$1", [h.hub]);
        changes.hub(h.hub);
        skip.delete(h.hub);
        bad.delete(h.hub);
      } else {
        skip.add(h.hub);
      }
    }
    for (const hub of bad) {
      if (marked.find((m) => m.hub === hub)?.damaged_real_ms === null) {
        await q("UPDATE hub_state SET damaged_real_ms=$2 WHERE hub=$1 AND damaged_real_ms IS NULL", [hub, realNow()]);
        changes.hub(hub as HubId);
      }
    }
    if (!changes.empty) await commitChanges(changes);
    present = changes.empty ? present : await ledger.keyTypes();
    await reconcile(await expected(), present, skip);
    await q("UPDATE hub_state SET stock_as_of_ms=$1 WHERE damaged_real_ms IS NULL", [nowMs]);
    await runDue(nowMs, true);
  } catch (error) {
    if (error instanceof LedgerDown || error instanceof LedgerDamaged) await markLedgerDown();
  }
}

/** Rebuilds the ledger from Postgres: at a reset every key, at a start only the keys that are missing. */
export async function buildLedger(everything: boolean): Promise<void> {
  try {
    if (everything) {
      for (const i of await ledger.keyTypes()) await ledger.del(i.key);
      for (const h of HUBS) await repairHub(h.id);
      return;
    }
    const present = new Set((await ledger.keyTypes()).map((i) => i.key));
    const want = await expected();
    for (const [key, value] of want.strings) if (!present.has(key)) await ledger.setString(key, value);
    for (const [key, members] of want.sets) if (!present.has(key)) for (const m of members) await ledger.add(key, "set", m);
    for (const [key, members] of want.zsets) if (!present.has(key)) for (const [m, score] of members) await ledger.add(key, "zset", m, score);
  } catch (error) {
    if (!(error instanceof LedgerDown || error instanceof LedgerDamaged)) throw error;
  }
}
