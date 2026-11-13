import type { Transaction } from "../db.js";
import type { Emit } from "../live/events.js";
import type { GrantRow } from "../model/grants.js";
import { grantAudience } from "./audiences.js";
import { emitCapTable } from "./ledger.js";

/** An offer that has reached its expiry: the reservation is released and the grant lapses. */
export async function expireOffer(tx: Transaction, emit: Emit, row: GrantRow): Promise<void> {
  await tx.query("update grants set state = 'expired' where id = $1", [row.id]);
  await emit(
    "grant_changed",
    { grant_id: row.id, state: "expired", reason: "expired", holder_id: row.holder_id, options: row.options },
    grantAudience(row.holder_id, true),
  );
  await emitCapTable(emit);
}
