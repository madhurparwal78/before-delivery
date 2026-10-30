// Settlement: the split of a deposit between release and damage, any extra damage beyond it, the late
// fee fixed once, and their billing records, ledger entries and receipt.

import { FIELD_COPY } from "../../shared/copy.js";
import { pool, transactionOn } from "../db.js";
import { ApiError } from "../http/errors.js";
import { BillingUnavailable, recordSettlement } from "../services/killbill.js";
import { lateDates, lateFeeCents } from "./latefee.js";
import { recordLedgerEntry } from "./ledger.js";
import { library } from "./library.js";
import { assertLoanMove } from "./loans.js";
import { queueReceipt } from "./notices.js";
import { asObject } from "./holds.js";
import { type LoanRow, readLoan } from "./records.js";

interface SettlementSplit {
  releasedCents: number;
  damageFromDepositCents: number;
  extraDamageCents: number;
  totalChargedCents: number;
}

/** Released plus kept always equals the deposit; damage beyond the deposit is billed separately. */
function splitSettlement(depositCents: number, damageCents: number, lateFee: number): SettlementSplit {
  const damageFromDepositCents = Math.min(damageCents, depositCents);
  return {
    releasedCents: depositCents - damageFromDepositCents,
    damageFromDepositCents,
    extraDamageCents: damageCents - damageFromDepositCents,
    totalChargedCents: damageCents + lateFee,
  };
}

export function parseDamage(json: unknown, loan: LoanRow): number {
  const damage = asObject(json).damage_cents;
  if (loan.inspection_outcome === "ok" && damage !== 0) throw ApiError.validation({ damage_cents: FIELD_COPY.damage_ok });
  if (typeof damage !== "number" || !Number.isInteger(damage) || damage < 0 || damage > loan.replacement_cents) {
    throw ApiError.validation({ damage_cents: FIELD_COPY.damage });
  }
  return damage;
}

/** Settles one loan. Attempts for the same loan wait for each other on a session advisory lock, so billing,
 * the ledger and the receipt each record the settlement once. The damage charge is fixed by the first attempt
 * that finds the loan inspected, even if billing then fails; billing records are written before the ledger
 * entries, the receipt and the settled status, which take effect together. */
export async function settleLoan(loanId: string, damageCents: number, now: Date): Promise<void> {
  const lockHolder = await pool.connect();
  try {
    await lockHolder.query("SELECT pg_advisory_lock(hashtext($1))", [`settle:${loanId}`]);
    const loan = await transactionOn(lockHolder, async (db) => {
      const row = await readLoan(db, now, loanId, true);
      if (!row) throw ApiError.of("not_found");
      assertLoanMove("settle", row.status);
      if (row.fixed_damage_cents === null) {
        await db.query("UPDATE loan SET fixed_damage_cents = $2 WHERE id = $1", [loanId, damageCents]);
      } else if (row.fixed_damage_cents !== damageCents) {
        throw ApiError.settlementMismatch(row.fixed_damage_cents);
      }
      return row;
    });
    if (!loan.returned_at) throw new Error("an inspected loan has a return time");
    const { calendar, schedule } = library();
    const late = lateDates(calendar, loan.due_date, loan.returned_at);
    const lateFee = lateFeeCents(schedule, late, loan.replacement_cents);
    const split = splitSettlement(loan.deposit_cents, damageCents, lateFee);

    if (split.releasedCents > 0 || split.extraDamageCents > 0 || lateFee > 0) {
      const payer = await pool.query<{ id: string; name: string; email: string }>("SELECT id, name, email FROM person WHERE id = $1", [
        loan.member_id,
      ]);
      const member = payer.rows[0];
      if (!member) throw new Error("settlement for an unknown member");
      try {
        await recordSettlement(member, loanId, {
          releasedCents: split.releasedCents,
          extraDamageCents: split.extraDamageCents,
          lateFeeCents: lateFee,
        });
      } catch (error) {
        if (error instanceof BillingUnavailable) throw ApiError.billingUnavailable("settle");
        throw error;
      }
    }

    await transactionOn(lockHolder, async (db) => {
      await db.query(
        `INSERT INTO settlement (loan_id, deposit_cents, released_cents, damage_cents, damage_from_deposit_cents,
           extra_damage_cents, late_days, late_fee_cents, total_charged_cents, settled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [loanId, loan.deposit_cents, split.releasedCents, damageCents, split.damageFromDepositCents, split.extraDamageCents, late.length, lateFee, split.totalChargedCents, now],
      );
      if (split.releasedCents > 0) await recordLedgerEntry(db, loanId, "deposit_release", -split.releasedCents, now);
      if (split.damageFromDepositCents > 0) await recordLedgerEntry(db, loanId, "damage_charge", -split.damageFromDepositCents, now);
      if (split.extraDamageCents > 0) await recordLedgerEntry(db, loanId, "extra_damage", split.extraDamageCents, now);
      if (lateFee > 0) await recordLedgerEntry(db, loanId, "late_fee", lateFee, now);
      await db.query("UPDATE loan SET status = 'settled' WHERE id = $1", [loanId]);
      await queueReceipt(
        db,
        { memberId: loan.member_id, itemName: loan.item_name, unitLabel: loan.unit_label },
        {
          deposit_cents: loan.deposit_cents,
          released_cents: split.releasedCents,
          damage_cents: damageCents,
          extra_damage_cents: split.extraDamageCents,
          late_fee_cents: lateFee,
          late_days: late.length,
          total_charged_cents: split.totalChargedCents,
        },
        now,
      );
    });
  } finally {
    await lockHolder.query("SELECT pg_advisory_unlock(hashtext($1))", [`settle:${loanId}`]);
    lockHolder.release();
  }
}
