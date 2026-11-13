import type { Unit } from "./db";
import { one } from "./db";
import * as giftcards from "./giftcards";

interface Payable {
  id: string;
  number: string;
  user_id: string;
  card_amount: number;
  gift_card_amount: number;
  gift_card_code: string | null;
}

/**
 * Pays `amount` back: to the card first, up to the card amount not yet refunded, then to the gift card
 * as a refund ledger group. Returns what went where.
 */
export async function refundOrder(u: Unit, order: Payable, amount: number, reason: string, at: Date): Promise<{ card: number; gift: number }> {
  if (amount <= 0) return { card: 0, gift: 0 };
  const paid = await one<{ card: number }>(u.db, "SELECT coalesce(sum(card_amount), 0) AS card FROM refunds WHERE order_id = $1", [order.id]);
  const card = Math.min(amount, order.card_amount - (paid?.card ?? 0));
  const gift = amount - card;
  await u.db.query("INSERT INTO refunds (order_id, amount, card_amount, gift_card_amount, reason, at) VALUES ($1, $2, $3, $4, $5, $6)", [order.id, amount, card, gift, reason, at]);
  if (gift > 0 && order.gift_card_code) {
    await giftcards.lockCard(u.db, order.gift_card_code);
    await giftcards.refund(u.db, order.gift_card_code, gift, order.number, at);
  }
  return { card, gift };
}
