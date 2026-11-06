// Protection plans (brief: Protection plans): price plus each of the order's tax components, inside the window,
// once per line.
import { transaction } from "../db.ts";
import { ApiError, invalid } from "../errors.ts";
import { addSeconds, iso, now, SECONDS } from "../clock.ts";
import type { User } from "../http.ts";
import { taxComponents } from "./checkout.ts";
import { ownOrder } from "./orders.ts";
import { isRowId } from "../patterns.ts";

export const PROTECTION_PRICES: Record<2 | 3, number> = { 2: 79900, 3: 129900 };

interface Plan {
  line_id: number;
  term_years: number;
  price_cents: number;
  tax_cents: number;
  protected_until: string;
}

export async function addProtection(user: User, number: string, body: Record<string, unknown>): Promise<Plan> {
  return transaction(async (tx) => {
    const order = await ownOrder(tx, user, number, true);
    const term = body.term_years;
    if (term !== 2 && term !== 3) throw invalid({ term_years: "Choose 2 or 3 years." });
    if (!isRowId(body.line_id)) throw invalid({ line_id: "Choose a board on this order." });
    const line = (await tx.query<{ id: number; type: string }>("SELECT id, type FROM order_lines WHERE id = $1 AND order_number = $2", [body.line_id, number])).rows[0];
    if (!line) throw new ApiError("not_found");
    if (order.status === "cancelled") throw new ApiError("illegal_transition", { message: "This order cannot be changed now." });
    if (line.type !== "build") throw new ApiError("not_eligible");
    if (!(now() < addSeconds(order.placed_at, SECONDS.protectionWindow))) throw new ApiError("window_closed");
    const until = new Date(order.placed_at);
    until.setUTCFullYear(until.getUTCFullYear() + term);
    const price = PROTECTION_PRICES[term];
    const tax = taxComponents(price, order.taxes).reduce((sum, t) => sum + t.amount_cents, 0);
    const inserted = await tx.query(
      `INSERT INTO protection_plans (line_id, order_number, term_years, price_cents, tax_cents, protected_until)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (line_id) DO NOTHING`,
      [line.id, number, term, price, tax, until],
    );
    if (inserted.rowCount !== 1) throw new ApiError("already_protected");
    return { line_id: line.id, term_years: term, price_cents: price, tax_cents: tax, protected_until: iso(until) };
  });
}
