// Size exchange: the old contract closes as exchanged and one successor opens with a paired transfer that
// conserves equity. Storage first (the agreement copy), then Kill Bill (cancel the old, open the new), then one commit.

import { nowSecond } from "../clock.js";
import { inTransaction, query, withFleetLock } from "../db/pool.js";
import { ApiError, idempotencyConflict, invalidTransition, validationFailed } from "../http/errors.js";
import { fieldOf, newId } from "../http/fields.js";
import type { Reply, Request } from "../http/router.js";
import { ensureAccount, ensureSubscription } from "../services/killbill.js";
import { agreementKey, deleteWritten, putObject } from "../services/storage.js";
import { isSizeFor, isStringInstrument, type Size } from "../../shared/vocabulary.js";
import { generateSeededAgreement, pendingSeededSignature, storedAgreement } from "./agreements.js";
import { accountHolder, confirmSubscriptionCancelled, lockedRow, ownerActor } from "./closing.js";
import { createContract, moveContract } from "./contractStates.js";
import { freshContractBody, requireVisible } from "./contracts.js";
import { deliveryDateFor } from "./deliveryDays.js";
import { isLargerSize, takeFirstAvailable } from "./fleet.js";
import { idempotent } from "./idempotency.js";

export async function exchangeSize(request: Request, id: string): Promise<Reply> {
  const user = request.user;
  await requireVisible(user, id);
  return idempotent(request, id, "exchange", null, async (db, idempotency) => {
    const row = await lockedRow(db, id);
    if (row.status !== "active") throw invalidTransition();
    if (!isStringInstrument(row.instrument_type)) {
      throw new ApiError(409, "not_exchangeable", "Only violins and cellos change size.");
    }
    if (idempotency.conflicting) throw idempotencyConflict();
    const requested = fieldOf(request.body, "size");
    const size: Size | null = isSizeFor(row.instrument_type, requested) && isLargerSize(row.instrument_type, row.size, requested)
      ? requested : null;
    const fields: Record<string, string> = { ...idempotency.keyFields };
    if (size === null) fields.size = "invalid";
    if (size === null || Object.keys(fields).length > 0) throw validationFailed(fields);
    return withFleetLock(db, async () => {
      const serial = await takeFirstAvailable(db, row.instrument_type, size);
      const [{ next }] = await query<{ next: number }>(db, "SELECT nextval('contract_number') AS next");
      const successorId = `C-${next}`;
      const seededSignedAt = pendingSeededSignature(row);
      const written: string[] = [];
      try {
        let agreement: Buffer;
        if (seededSignedAt === null) {
          agreement = await storedAgreement(id);
        } else {
          agreement = await generateSeededAgreement(db, row, seededSignedAt);
          await putObject(agreementKey(id), agreement, "application/pdf");
          written.push(agreementKey(id));
        }
        await putObject(agreementKey(successorId), agreement, "application/pdf");
        written.push(agreementKey(successorId));
        await confirmSubscriptionCancelled(row);
        const accountId = await ensureAccount({ ...accountHolder(row), contractId: successorId });
        await ensureSubscription(accountId, successorId);
      } catch (error) {
        await deleteWritten(written);
        throw error;
      }
      const [{ weekday }] = await query<{ weekday: number }>(db,
        "SELECT delivery_weekday AS weekday FROM schools WHERE id = $1", [row.school_id]);
      const at = nowSecond();
      const actor = ownerActor(user);
      const transferId = newId("T");
      try {
        return await inTransaction(db, async () => {
          await moveContract(db, { id, from: "active", to: "exchanged", actor, at,
            set: { closed_at: at, subscription_state: "cancelled", successor_id: successorId, agreement_stored: true } });
          await createContract(db, {
            id: successorId, student_id: row.student_id, instrument_serial: serial, status: "active", waiver: row.waiver,
            price_list_id: row.price_list_id, delivery_date: deliveryDateFor(weekday, at), hold_expires_at: null,
            signer_name: row.signer_name, signed_at: row.signed_at, activated_at: at,
            billing_anchor_date: row.billing_anchor_date, predecessor_id: id, subscription_state: "active",
            agreement_stored: true, created_at: at,
          }, actor);
          await db.query(`INSERT INTO ledger_entries (id, contract_id, kind, amount_cents, transfer_id, created_at)
            VALUES ($1, $2, 'exchange_out', $3, $4, $5), ($6, $7, 'exchange_in', $8, $4, $5)`,
          [newId("L"), id, -row.equity_cents, transferId, at, newId("L"), successorId, row.equity_cents]);
          return idempotency.respond(db, 201, { old_contract: await freshContractBody(db, id),
            new_contract: await freshContractBody(db, successorId), transfer_id: transferId });
        });
      } catch (error) {
        await deleteWritten(written);
        throw error;
      }
    });
  });
}
