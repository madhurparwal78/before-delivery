import type { PgPool } from '../db/pg.ts';
import { DatabaseError } from '../db/pg.ts';

/** Sandbox card rules, decided here and only here. */

export const DECLINED_ALWAYS = '4000000000000002';
export const APPROVED_FIRST_ONLY = '4000000000000341';

export type OutcomeClass = 'approved' | 'declined' | 'first_only';

/** Luhn check on 16 digits. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{16}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let d = Number(digits[i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Normalize and validate an entered card number. Returns null when invalid. */
export function normalizeCard(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const digits = input.replace(/\s+/g, '');
  if (!luhnValid(digits)) return null;
  return digits;
}

/** Which sandbox class does a full number match? */
export function outcomeClass(digits: string): OutcomeClass {
  if (digits === DECLINED_ALWAYS) return 'declined';
  if (digits === APPROVED_FIRST_ONLY) return 'first_only';
  return 'approved';
}

export interface CardDecision {
  approved: boolean;
  last4: string;
  outcomeClass: OutcomeClass;
}

/**
 * Record a charge attempt for a person and decide its outcome.
 * `counting` is true only for attempts that count (not replays, not refused).
 */
export async function decideCharge(pool: PgPool, userId: string, digits: string): Promise<CardDecision> {
  const cls = outcomeClass(digits);
  const last4 = digits.slice(-4);
  if (cls === 'approved') return { approved: true, last4, outcomeClass: cls };
  if (cls === 'declined') {
    await recordCardState(pool, userId, cls, last4);
    return { approved: false, last4, outcomeClass: cls };
  }
  // first_only: charge count per person, across instances, on the same database
  await pool.query(
    `INSERT INTO card_state (user_id, outcome_class, last4, charge_count_0341)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (user_id) DO UPDATE SET charge_count_0341 = card_state.charge_count_0341 + 1, outcome_class = $2, last4 = $3, updated_at = now()`,
    [userId, cls, last4],
  );
  const res = await pool.query(`SELECT charge_count_0341 FROM card_state WHERE user_id = $1`, [userId]);
  const count = Number(res.rows[0]?.['charge_count_0341'] ?? 1);
  return { approved: count <= 1, last4, outcomeClass: cls };
}

/** Decide using the stored card on file (retries). */
export async function decideChargeWithStoredClass(
  pool: PgPool,
  userId: string,
  cls: OutcomeClass,
): Promise<CardDecision> {
  if (cls === 'approved') return { approved: true, last4: '', outcomeClass: cls };
  if (cls === 'declined') return { approved: false, last4: '', outcomeClass: cls };
  const res = await pool.query(
    `UPDATE card_state SET charge_count_0341 = card_state.charge_count_0341 + 1, updated_at = now()
     WHERE user_id = $1 AND outcome_class = 'first_only'
     RETURNING charge_count_0341`,
    [userId],
  );
  const count = res.rows.length ? Number(res.rows[0]!['charge_count_0341']) : 1;
  return { approved: count <= 1, last4: '', outcomeClass: cls };
}

async function recordCardState(pool: PgPool, userId: string, cls: OutcomeClass, last4: string): Promise<void> {
  await pool.query(
    `INSERT INTO card_state (user_id, outcome_class, last4) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET outcome_class = $2, last4 = $3, updated_at = now()`,
    [userId, cls, last4],
  );
}

/** Store the card on file (last four digits and outcome class only). */
export async function storeCardOnFile(pool: PgPool, userId: string, digits: string): Promise<CardDecision> {
  const cls = outcomeClass(digits);
  const last4 = digits.slice(-4);
  if (cls === 'first_only') {
    // A card update with 0341 counts as an entry into the per-person scheme, but
    // not as a charge: the count is set without incrementing.
    await pool.query(
      `INSERT INTO card_state (user_id, outcome_class, last4, charge_count_0341)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id) DO UPDATE SET outcome_class = $2, last4 = $3, updated_at = now()`,
      [userId, cls, last4],
    );
  } else {
    await pool.query(
      `INSERT INTO card_state (user_id, outcome_class, last4)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET outcome_class = $2, last4 = $3, updated_at = now()`,
      [userId, cls, last4],
    );
  }
  const res = await pool.query(`SELECT charge_count_0341 FROM card_state WHERE user_id = $1`, [userId]);
  void res;
  return { approved: true, last4, outcomeClass: cls };
}

export async function getCardState(pool: PgPool, userId: string): Promise<{ outcomeClass: OutcomeClass | null; last4: string | null }> {
  const res = await pool.query(`SELECT outcome_class, last4 FROM card_state WHERE user_id = $1`, [userId]);
  if (!res.rows.length) return { outcomeClass: null, last4: null };
  return {
    outcomeClass: res.rows[0]!['outcome_class'] as OutcomeClass,
    last4: res.rows[0]!['last4'] as string,
  };
}

/** Count a charge attempt against the per-person counter for 0341. */
export async function countChargeAttempt(pool: PgPool, userId: string, cls: OutcomeClass): Promise<void> {
  if (cls !== 'first_only') return;
  await pool.query(
    `INSERT INTO card_state (user_id, outcome_class, last4, charge_count_0341)
     VALUES ($1, $2, '', 1)
     ON CONFLICT (user_id) DO UPDATE SET charge_count_0341 = card_state.charge_count_0341 + 1, updated_at = now()`,
    [userId, cls],
  );
}

export { DatabaseError };
