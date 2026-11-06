// Reservations: a parent reserves a type and size for their own child; under the fleet lock the server takes the
// available serial that sorts first and places a hold. One winner for the last unit.

import type { User } from "../../shared/api.js";
import { isInstrumentType, isSizeFor } from "../../shared/vocabulary.js";
import { config } from "../config.js";
import { now, nowSecond } from "../clock.js";
import { lockFleetForTransaction, query, transaction } from "../db/pool.js";
import { ApiError, notFound, validationFailed } from "../http/errors.js";
import { fieldOf } from "../http/fields.js";
import { createContract, expireLapsedHolds } from "./contractStates.js";
import { freshContractBody } from "./contracts.js";
import { deliveryDateFor } from "./deliveryDays.js";
import { takeFirstAvailable } from "./fleet.js";

export async function reserve(user: User, body: unknown): Promise<unknown> {
  return transaction(async (db) => {
    await lockFleetForTransaction(db);
    await expireLapsedHolds(db, now());
    const studentId = fieldOf(body, "student_id");
    const [student] = await query<{ id: string; delivery_weekday: number }>(db, `SELECT s.id, sc.delivery_weekday
      FROM students s JOIN schools sc ON sc.id = s.school_id WHERE s.id = $1 AND s.family_id = $2`,
    [typeof studentId === "string" ? studentId : "", user.family_id]);
    if (student === undefined) throw notFound();
    const [open] = await query(db, `SELECT 1 FROM contracts WHERE student_id = $1
      AND status IN ('reserved', 'agreement_sent', 'signed', 'active')`, [student.id]);
    if (open !== undefined) {
      throw new ApiError(409, "student_has_instrument", "This student already has an instrument on contract.");
    }
    const type = fieldOf(body, "instrument_type");
    const size = fieldOf(body, "size");
    const waiver = fieldOf(body, "waiver");
    const fields: Record<string, string> = {};
    if (!isInstrumentType(type)) fields.instrument_type = "invalid";
    if (!isInstrumentType(type) || !isSizeFor(type, size)) fields.size = "invalid";
    if (typeof waiver !== "boolean") fields.waiver = "invalid";
    if (!isInstrumentType(type) || !isSizeFor(type, size) || typeof waiver !== "boolean") throw validationFailed(fields);
    const serial = await takeFirstAvailable(db, type, size);
    const [{ next }] = await query<{ next: number }>(db, "SELECT nextval('contract_number') AS next");
    const id = `C-${next}`;
    const receivedAt = now();
    const at = nowSecond();
    await createContract(db, {
      id, student_id: student.id, instrument_serial: serial, status: "reserved", waiver, price_list_id: null,
      delivery_date: deliveryDateFor(student.delivery_weekday, receivedAt),
      hold_expires_at: new Date(at.getTime() + config.holdSeconds * 1000), signer_name: null, signed_at: null,
      activated_at: null, billing_anchor_date: null, predecessor_id: null, subscription_state: null,
      agreement_stored: false, created_at: at,
    }, { actor: "parent", actor_name: user.name });
    return { contract: await freshContractBody(db, id) };
  });
}
