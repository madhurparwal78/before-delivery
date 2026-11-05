// Credit top-ups: credit is added only once Kill Bill shows a successful PURCHASE for the top-up.
import { creditOf } from "./credit.js";
import { all, one, run } from "./db.js";
import { conflict, invalid, type Reply } from "./errors.js";
import { purchaseTopUp } from "./killbill.js";
import { householdAccount, movementTime, writeMovement } from "./ledger.js";
import { dollarTextToCents, TOPUP_MAX_CENTS, TOPUP_MIN_CENTS } from "./money.js";
import { allow, type Viewer } from "./session.js";
import { householdRow } from "./households.js";

interface TopUpRow {
  id: number;
  amount_cents: number;
  created_at: string;
}

const topUpJson = (t: TopUpRow) => ({ id: t.id, amount_cents: t.amount_cents, status: "confirmed", created_at: t.created_at });

/** Confirms the top-up with Kill Bill; the returned step writes the one `top_up` movement. */
export async function topUp(viewer: Viewer, key: string, body: Record<string, unknown>): Promise<() => Reply> {
  allow(viewer, "member");
  const cents = typeof body.amount === "string" ? dollarTextToCents(body.amount) : null;
  if (cents === null || cents < TOPUP_MIN_CENTS || cents > TOPUP_MAX_CENTS) {
    throw invalid("amount", "Enter an amount from $5.00 to $500.00.");
  }
  const household = householdRow(viewer.household_code!)!;
  if ((await purchaseTopUp(household, key, cents)) === "other-amount") {
    throw conflict("idempotency_key_reused", "This top-up was already sent with a different amount.");
  }
  return () => {
    const createdAt = movementTime();
    const id = run("INSERT INTO topups (household_code, amount_cents, created_at) VALUES (?, ?, ?)", household.code, cents, createdAt).lastId;
    writeMovement("top_up", "Top-up", cents, householdAccount(household.code), "clearing:killbill", null, createdAt);
    return {
      status: 201,
      body: { topup: topUpJson(one<TopUpRow>("SELECT * FROM topups WHERE id = ?", id)!), credit: creditOf(household.code) },
    };
  };
}

export function listTopUps(viewer: Viewer): Reply {
  allow(viewer, "member");
  const rows = all<TopUpRow>("SELECT * FROM topups WHERE household_code = ? ORDER BY id DESC", viewer.household_code!);
  return { status: 200, body: { topups: rows.map(topUpJson) } };
}
