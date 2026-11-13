import type { LedgerEntry, Pool, ShareClass } from "../shared/types.js";
import { groupThousands } from "../shared/format.js";
import { POOL_LOCK, direct, transaction } from "./db.js";
import { conflict, notFound, validation } from "./errors.js";
import { writeLedgerEntry } from "./ledger.js";
import { SHARE_CLASSES, loadRegisterTotals, presentPool } from "./registry.js";

export async function loadPool(): Promise<Pool> {
  return presentPool(await loadRegisterTotals(direct));
}

export async function resizePool(authorized: unknown): Promise<Pool> {
  if (typeof authorized !== "number" || !Number.isSafeInteger(authorized) || authorized < 1) {
    throw validation({ authorized: "Enter a whole number of options of 1 or more." });
  }
  return transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [POOL_LOCK]);
    const totals = await loadRegisterTotals(tx);
    const allocated = totals.outstanding + totals.exercised + totals.reserved;
    if (authorized < allocated) {
      throw conflict("pool_below_allocated", `The pool can't be smaller than the ${groupThousands(allocated)} options already allocated.`);
    }
    await tx.query("UPDATE settings SET value = to_jsonb($1::bigint) WHERE key = 'authorized'", [authorized]);
    await writeLedgerEntry(tx, {
      holderId: null,
      kind: "pool_resized",
      shareClass: null,
      sharesDelta: 0,
      optionsDelta: authorized - totals.authorized,
      reference: `Pool ${groupThousands(totals.authorized)} to ${groupThousands(authorized)} options`,
    });
    return presentPool(await loadRegisterTotals(tx));
  });
}

export async function issueShares(body: Record<string, unknown>): Promise<LedgerEntry> {
  const holderId = body.holder_id;
  const holder = typeof holderId === "string" ? await direct.query<{ id: string }>("SELECT id FROM people WHERE id = $1", [holderId]) : [];
  if (holder.length === 0) throw notFound();
  const fields: Record<string, string> = {};
  if (!SHARE_CLASSES.includes(body.class as ShareClass)) fields.class = "Choose a share class.";
  const shares = body.shares;
  if (typeof shares !== "number" || !Number.isSafeInteger(shares) || shares < 1) fields.shares = "Enter a whole number of shares from 1 upward.";
  if (Object.keys(fields).length > 0) throw validation(fields);
  return transaction((tx) =>
    writeLedgerEntry(tx, {
      holderId: holderId as string,
      kind: "issuance",
      shareClass: body.class as ShareClass,
      sharesDelta: shares as number,
      optionsDelta: 0,
      reference: "Share issuance",
    }),
  );
}
