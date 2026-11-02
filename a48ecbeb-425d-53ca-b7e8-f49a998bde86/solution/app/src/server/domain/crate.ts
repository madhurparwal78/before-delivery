import { config } from "../config.js";
import { afterCommit, one, rows, tx, type Client } from "../db.js";
import { ApiError, notFound, validation } from "../http.js";
import { planForCrate } from "../killbill.js";
import { ledgerEvent, stockChanged, stockFigures } from "./stock.js";

// A crate is 12 slots of server reservations sharing one hold window.

export const CRATE_SIZE = 12;
const DROP_LIMIT = 6;

export type Cadence = "monthly" | "bimonthly";

interface CrateRow {
  id: string;
  province: string;
  subscribe: boolean;
  cadence: Cadence;
  hold_status: "none" | "active" | "expired";
  hold_expires_at: Date | null;
  [key: string]: unknown;
}

interface Crate extends CrateRow {
  slots: (string | null)[];
  serverTime: Date;
}

export function counts(slots: (string | null)[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const f of slots) if (f) tally.set(f, (tally.get(f) ?? 0) + 1);
  return tally;
}

export function cartJson(crate: Crate) {
  return {
    slots: crate.slots.map((f) => (f ? { flavour: f, status: "held" } : null)),
    count: crate.slots.filter(Boolean).length,
    province: crate.province,
    subscribe: crate.subscribe,
    subscribe_eligible: planForCrate(counts(crate.slots), crate.cadence) !== undefined,
    cadence: crate.cadence,
    hold: {
      status: crate.hold_status,
      expires_at: crate.hold_status === "active" && crate.hold_expires_at ? crate.hold_expires_at.toISOString() : null,
    },
    server_time: crate.serverTime.toISOString(),
  };
}

async function load(client: Client, id: string, lock = false): Promise<Crate> {
  const [row] = await rows<CrateRow & { now: Date }>(client, `SELECT *, now() AS now FROM crates WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  const slots: (string | null)[] = Array.from({ length: CRATE_SIZE }, () => null);
  for (const s of await rows<{ slot: number; flavour: string }>(client, "SELECT slot, flavour FROM crate_slots WHERE crate_id = $1", [id])) {
    slots[s.slot] = s.flavour;
  }
  return { ...row, slots, serverTime: row.now };
}

/** Ends a hold whose expiry instant has passed: its cans go back on the shelf. */
async function expireIfDue(client: Client, crate: Crate): Promise<Crate> {
  if (crate.hold_status !== "active" || !crate.hold_expires_at || crate.hold_expires_at > crate.serverTime) return crate;
  const held = counts(crate.slots);
  for (const [flavour, n] of held) await ledgerEvent(client, flavour, "released", n, `hold-expired:${crate.id}`);
  await rows(client, "DELETE FROM crate_slots WHERE crate_id = $1", [crate.id]);
  await rows(client, "UPDATE crates SET hold_status = 'expired', subscribe = false WHERE id = $1", [crate.id]);
  afterCommit(client, () => stockChanged(held.keys()));
  return { ...crate, hold_status: "expired", subscribe: false, slots: crate.slots.map(() => null) };
}

/** Locks the crate row, releasing an expired hold first, so every touch sees the true state. */
export async function lockCrate(client: Client, id: string): Promise<Crate> {
  return expireIfDue(client, await load(client, id, true));
}

export async function createCrate(province: string, userId: string | null): Promise<string> {
  const [row] = await tx((client) =>
    rows<{ id: string }>(client, "INSERT INTO crates (id, province, user_id) VALUES (gen_random_uuid(), $1, $2) RETURNING id", [
      province,
      userId,
    ]),
  );
  return row.id;
}

type CrateOwner = {
  id: string;
  user_id: string | null;
  hold_status: string;
};

/**
 * The crate a visitor works with. A signed-in customer keeps one crate across browsers: the
 * cookie's crate if it is theirs, an anonymous crate they filled before signing in, or else their
 * latest crate. Signed-out visitors only ever get anonymous crates.
 */
export async function resolveCrate(cookieId: string | undefined, customerId: string | null): Promise<string | null> {
  const cookie = cookieId ? await one<CrateOwner>("SELECT id, user_id, hold_status FROM crates WHERE id::text = $1", [cookieId]) : undefined;
  if (!customerId) return cookie && cookie.user_id === null ? cookie.id : null;
  if (cookie?.user_id === customerId) return cookie.id;
  if (cookie && cookie.user_id === null && cookie.hold_status === "active") {
    await one("UPDATE crates SET user_id = $2 WHERE id = $1 AND user_id IS NULL", [cookie.id, customerId]);
    return cookie.id;
  }
  const own = await one<{ id: string }>("SELECT id FROM crates WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [customerId]);
  if (own) return own.id;
  if (cookie && cookie.user_id === null) {
    await one("UPDATE crates SET user_id = $2 WHERE id = $1 AND user_id IS NULL", [cookie.id, customerId]);
    return cookie.id;
  }
  return null;
}

export async function readCrate(id: string): Promise<Crate> {
  return tx((client) => lockCrate(client, id));
}

interface Added {
  crate: Crate;
  slots: number[];
  stockLeft: number;
}

/** Turns subscribe-and-save off in memory and in the row when the crate is no longer eligible. */
async function keepEligible(client: Client, crate: Crate): Promise<Crate> {
  if (!crate.subscribe || planForCrate(counts(crate.slots), crate.cadence)) return crate;
  await rows(client, "UPDATE crates SET subscribe = false WHERE id = $1", [crate.id]);
  return { ...crate, subscribe: false };
}

export async function addCans(id: string, flavour: string, quantity: number): Promise<Added> {
  const result = await tx(async (client) => {
    const crate = await lockCrate(client, id);
    const [meta] = await rows<{ limited: boolean }>(client, "SELECT limited FROM flavours WHERE slug = $1 FOR UPDATE", [flavour]);
    if (!meta) return { refused: validation({ flavour: "Pick a flavour from the shop." }) };
    const [stock] = await stockFigures(client, flavour);
    const held = crate.slots.filter(Boolean).length;
    if (held + quantity > CRATE_SIZE) {
      return { refused: new ApiError(409, "hold_limit", "Your crate is full.", { limit: "crate", stock_left: stock.available }) };
    }
    if (meta.limited && (counts(crate.slots).get(flavour) ?? 0) + quantity > DROP_LIMIT) {
      return {
        refused: new ApiError(409, "hold_limit", "You can hold up to 6 cans of a limited drop.", {
          limit: "drop",
          stock_left: stock.available,
        }),
      };
    }
    if (quantity > stock.available) {
      return { refused: new ApiError(409, "sold_out", "That flavour is sold out.", { stock_left: stock.available }) };
    }
    const free = crate.slots.flatMap((f, i) => (f ? [] : [i])).slice(0, quantity);
    await rows(
      client,
      "INSERT INTO crate_slots (crate_id, slot, flavour) SELECT $1, unnest($2::int[]), $3",
      [id, free, flavour],
    );
    await ledgerEvent(client, flavour, "reserved", quantity, `crate:${id}`);
    let hold = { status: crate.hold_status, expires: crate.hold_expires_at };
    if (crate.hold_status !== "active") {
      const [started] = await rows<{ hold_expires_at: Date }>(
        client,
        "UPDATE crates SET hold_status = 'active', hold_expires_at = now() + make_interval(secs => $2) WHERE id = $1 RETURNING hold_expires_at",
        [id, config.holdSeconds],
      );
      hold = { status: "active", expires: started.hold_expires_at };
    }
    const slots = crate.slots.map((f, i) => (free.includes(i) ? flavour : f));
    const after = await keepEligible(client, { ...crate, slots, hold_status: hold.status, hold_expires_at: hold.expires });
    return { added: { crate: after, slots: free, stockLeft: stock.available - quantity } };
  });
  if ("refused" in result) throw result.refused;
  stockChanged([flavour]);
  return result.added;
}

export async function removeCan(id: string, slot: number): Promise<{ crate: Crate; stockLeft: number; flavour: string }> {
  const result = await tx(async (client) => {
    const crate = await lockCrate(client, id);
    const flavour = crate.slots[slot];
    if (!flavour) throw notFound();
    await rows(client, "DELETE FROM crate_slots WHERE crate_id = $1 AND slot = $2", [id, slot]);
    await ledgerEvent(client, flavour, "released", 1, `crate:${id}`);
    const slots = crate.slots.map((f, i) => (i === slot ? null : f));
    let emptied = crate;
    if (slots.every((f) => f === null)) {
      await rows(client, "UPDATE crates SET hold_status = 'none', hold_expires_at = NULL WHERE id = $1", [id]);
      emptied = { ...crate, hold_status: "none", hold_expires_at: null };
    }
    const after = await keepEligible(client, { ...emptied, slots });
    const [left] = await stockFigures(client, flavour);
    return { crate: after, stockLeft: left.available, flavour };
  });
  stockChanged([result.flavour]);
  return result;
}

export async function updateCrate(
  id: string,
  changes: { province?: string; subscribe?: boolean; cadence?: Cadence },
): Promise<Crate> {
  return tx(async (client) => {
    const crate = await lockCrate(client, id);
    const cadence = changes.cadence ?? crate.cadence;
    if (changes.subscribe === true && !planForCrate(counts(crate.slots), cadence)) {
      throw new ApiError(409, "not_subscribable", "Subscriptions come as 12 of one flavour or 4 of each.");
    }
    await rows(
      client,
      "UPDATE crates SET province = $2, subscribe = $3, cadence = $4 WHERE id = $1",
      [id, changes.province ?? crate.province, changes.subscribe ?? crate.subscribe, cadence],
    );
    return load(client, id);
  });
}

/** Releases every hold whose expiry has passed; run by whichever process claims each crate. */
export async function releaseExpiredHolds(): Promise<void> {
  const due = await tx((client) =>
    rows<{ id: string }>(
      client,
      `UPDATE crates SET claimed_until = now() + interval '10 seconds'
       WHERE id IN (SELECT id FROM crates WHERE hold_status = 'active' AND hold_expires_at <= now()
                    AND (claimed_until IS NULL OR claimed_until < now()) LIMIT 50 FOR UPDATE SKIP LOCKED)
       RETURNING id`,
    ),
  );
  for (const { id } of due) await tx((client) => lockCrate(client, id));
}
