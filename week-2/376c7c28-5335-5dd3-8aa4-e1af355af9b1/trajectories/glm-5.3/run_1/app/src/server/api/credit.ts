import { pool, one } from "../db";
import { ApiError } from "../errors";
import type { Ctx, Person, Studio } from "../http/context";
import { sendJson } from "../http/context";
import { balanceOf, memberEntries } from "../billing/ledger";
import { entryBody } from "./bodies";
import { buyPack } from "../billing/packs";
import { validateKey, withKeyLock } from "../billing/idempotency";
import { today } from "../studiodays";
import { nowMs } from "../clock";

export async function getCredit(ctx: Ctx): Promise<void> {
  const person = ctx.person as Person;
  const balance = await balanceOf(pool, person.id);
  const entries = await memberEntries(pool, person.id);
  sendJson(ctx.res, 200, {
    balance_cents: balance,
    card_status: person.card_status,
    entries: entries.map(entryBody),
  });
}

export async function purchasePack(ctx: Ctx): Promise<void> {
  const person = ctx.person as Person;
  const studio = ctx.studio as Studio;
  const keyHeader = ctx.req.headers["idempotency-key"];
  validateKey(typeof keyHeader === "string" ? keyHeader : undefined);
  const key = keyHeader as string;
  const packId = ctx.params.id;
  const pack = await one<{ id: string; studio_id: string; amount_cents: number }>(pool, "SELECT * FROM credit_packs WHERE id = $1 AND studio_id = $2", [packId, studio.id]);
  if (!pack) throw new ApiError(404, "not_found", "Not found.");
  // Buying requires an active member with a card on file; both are checked before
  // the daily limit, inside the buy path. Keyed requests serialize on the key lock.
  const result = await withKeyLock(studio.id, "purchase", key, async () => {
    return buyPack(person, studio.time_zone, pack.id, pack.amount_cents, key);
  });
  sendJson(ctx.res, result.status, result.body);
}

export { today, nowMs };
