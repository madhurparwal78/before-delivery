// Activation, return and write-off, and the closing rule every move out of `active` follows: the subscription is
// cancelled and read back from Kill Bill as CANCELLED before anything is committed.

import type { User } from "../../shared/api.js";
import { storeDateOf } from "../../shared/storeTime.js";
import { nowSecond } from "../clock.js";
import { inTransaction, withContractLock, type Db } from "../db/pool.js";
import { ApiError, invalidTransition } from "../http/errors.js";
import { cancelSubscriptionConfirmed, ensureAccount, ensureSubscription, type AccountHolder } from "../services/killbill.js";
import { agreementKey, objectExists } from "../services/storage.js";
import { moveContract, type Actor } from "./contractStates.js";
import { freshContractBody, loadContractRow, requireVisible, type ContractRow } from "./contracts.js";

export function accountHolder(row: ContractRow): AccountHolder {
  return { contractId: row.id, parentName: row.parent_name, parentEmail: row.parent_email };
}

export function ownerActor(user: User): Actor {
  return { actor: "owner", actor_name: user.name };
}

/** The closing rule's Kill Bill part: account and subscription exist (created now if never made), then cancelled. */
export async function confirmSubscriptionCancelled(row: ContractRow): Promise<void> {
  const accountId = await ensureAccount(accountHolder(row));
  await cancelSubscriptionConfirmed(await ensureSubscription(accountId, row.id));
}

/** The contract re-read under its lock, so each queued action checks the result of the one before it. */
export async function lockedRow(db: Db, id: string): Promise<ContractRow> {
  const row = await loadContractRow(db, id);
  if (row === undefined) throw invalidTransition();
  return row;
}

export async function activate(user: User, id: string): Promise<unknown> {
  await requireVisible(user, id);
  return withContractLock(id, async (db) => {
    const row = await lockedRow(db, id);
    if (row.status !== "signed") throw invalidTransition();
    if (!(await objectExists(agreementKey(id)))) {
      throw new ApiError(409, "agreement_not_stored", "The signed agreement isn't stored yet.");
    }
    const accountId = await ensureAccount(accountHolder(row));
    await ensureSubscription(accountId, id);
    const at = nowSecond();
    return inTransaction(db, async () => {
      await moveContract(db, { id, from: "signed", to: "active", actor: ownerActor(user), at,
        set: { activated_at: at, billing_anchor_date: storeDateOf(at), subscription_state: "active" } });
      return { contract: await freshContractBody(db, id) };
    });
  });
}

/** Return or write-off: confirmed cancelled in Kill Bill, then closed. */
export async function close(user: User, id: string, to: "returned" | "written_off"): Promise<unknown> {
  await requireVisible(user, id);
  return withContractLock(id, async (db) => {
    const row = await lockedRow(db, id);
    if (row.status !== "active") throw invalidTransition();
    await confirmSubscriptionCancelled(row);
    const at = nowSecond();
    return inTransaction(db, async () => {
      await moveContract(db, { id, from: "active", to, actor: ownerActor(user), at,
        set: { closed_at: at, subscription_state: "cancelled" } });
      return { contract: await freshContractBody(db, id) };
    });
  });
}
