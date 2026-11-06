import { LOCALES, TIER_PRICES, TIERS, type Locale, type Tier } from "../shared/domain.ts";
import { guestBillingAccount, type Replyable } from "./checkout.ts";
import { creditBalance, recordMovement } from "./credit.ts";
import { one, transaction, type Db } from "./db.ts";
import { giftDelivered, giftReceipt } from "./emails.ts";
import { ApiError } from "./errors.ts";
import { claimKey, release, remember } from "./idempotency.ts";
import { newGiftRef, newToken, sha256 } from "./ids.ts";
import { chargeInvoice, requireBilling, subscribe, undoCharge, type BilledInvoice } from "./killbill.ts";
import { activeMembership, kbAccountFor, lockAccount, startMembership, undoMembershipStart } from "./membership.ts";
import { enqueue, wakeOutbox } from "./outbox.ts";
import type { Session } from "./sessions.ts";
import { requireStepup } from "./stepup.ts";
import { isoToronto } from "./time.ts";
import { Fields } from "./validate.ts";

type GiftRow = {
  ref: string; tier: Tier; price_cents: number; purchaser_account_id: number | null; purchaser_name: string; purchaser_email: string;
  purchaser_locale: Locale; recipient_name: string; recipient_email: string; recipient_locale: Locale; message: string;
  credit_applied_cents: number; paid_cents: number; created_at: Date; redeemed_at: Date | null;
};

export function giftView(row: GiftRow, withRedemption: boolean): Record<string, unknown> {
  const view: Record<string, unknown> = {
    ref: row.ref, tier: row.tier, price_cents: row.price_cents, currency: "CAD", recipient_name: row.recipient_name,
    recipient_email: row.recipient_email, state: row.redeemed_at ? "redeemed" : "unredeemed",
  };
  if (withRedemption) view.redeemed_at = row.redeemed_at ? isoToronto(row.redeemed_at) : null;
  return view;
}

export async function findGift(ref: string, db?: Db): Promise<GiftRow | undefined> {
  return one<GiftRow>("SELECT * FROM gifts WHERE ref = $1", [ref.trim().toUpperCase()], db);
}

/** A guest or signed-in patron buys a gift; the purchaser's Kill Bill account is charged the tier's annual price. */
export async function buyGift(body: Record<string, unknown>, session: Session | null, scope: string, key: string | undefined, locale: Locale): Promise<Replyable> {
  const claimed = await claimKey(scope, key, "/api/gifts", body);
  if ("replay" in claimed) return { status: claimed.replay.status, text: claimed.replay.body, replayed: true };
  const claim = claimed.claim;
  try {
    const now = new Date();
    requireStepup(session, { creditApplied: await creditBalance(session?.account.number ?? null), tierChange: false }, now);
    const fields = new Fields(body);
    const tier = fields.choice("tier", TIERS);
    const purchaser = session ? { name: session.account.name, email: session.account.email } : { name: fields.text("purchaser.name", 1, 80), email: fields.email("purchaser.email") };
    const recipient = { name: fields.text("recipient.name", 1, 80), email: fields.email("recipient.email"), locale: fields.choice("recipient.locale", LOCALES) };
    const message = fields.text("message", 0, 300, true);
    const cardholder = fields.text("cardholder_name", 1, 80);
    fields.done();
    requireBilling();
    const price = TIER_PRICES[tier].annual;
    const kbAccount = session ? await kbAccountFor(session.account) : await guestBillingAccount(purchaser.name, purchaser.email, locale);
    const ref = newGiftRef();
    const invoice = await chargeInvoice(kbAccount, [{ type: "EXTERNAL_CHARGE", description: `${ref} GIFT ${tier}`, cents: price }], ref);
    const token = newToken();
    const text = await transaction(async (tx) => {
      await tx.query(
        `INSERT INTO gifts (ref, tier, price_cents, purchaser_account_id, purchaser_name, purchaser_email, purchaser_locale, recipient_name,
           recipient_email, recipient_locale, message, cardholder_name, token_hash, kb_invoice_id, credit_applied_cents, paid_cents, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())`,
        [ref, tier, price, session?.account.id ?? null, purchaser.name, purchaser.email, locale, recipient.name, recipient.email, recipient.locale,
          message, cardholder, sha256(token), invoice.invoiceId, invoice.creditAppliedCents, invoice.paidCents],
      );
      if (invoice.creditAppliedCents > 0 && session?.account.number) await recordMovement(tx, session.account.number, "spend", invoice.creditAppliedCents, ref);
      await enqueue(tx, { key: `gift-receipt:${ref}`, kind: "gift-receipt", to: purchaser.email, ...giftReceipt(locale, { ref, tier, recipientName: recipient.name, charged: invoice.amountCents }) });
      await enqueue(tx, { key: `gift-delivered:${ref}`, kind: "gift-delivered", to: recipient.email, ...giftDelivered(recipient.locale, { purchaserName: purchaser.name, tier, message, token }) });
      const gift = await findGift(ref, tx);
      if (!gift) throw new Error("gift vanished");
      return remember(tx, claim, 201, { gift: giftView(gift, false) });
    }).catch(async (error: unknown) => {
      await undoCharge(invoice);
      throw error;
    });
    wakeOutbox();
    return { status: 201, text, replayed: false };
  } catch (error) {
    await release(claim);
    throw error;
  }
}

async function unredeemedByToken(token: string, db?: Db, lock = false): Promise<GiftRow> {
  const gift = /^[A-Za-z0-9_-]{43}$/.test(token)
    ? await one<GiftRow>(`SELECT * FROM gifts WHERE token_hash = $1 AND redeemed_at IS NULL${lock ? " FOR UPDATE" : ""}`, [sha256(token)], db)
    : undefined;
  if (!gift) throw new ApiError("not_found");
  return gift;
}

export async function giftForRedemption(token: string): Promise<Record<string, unknown>> {
  const gift = await unredeemedByToken(token);
  return { gift: { ref: gift.ref, tier: gift.tier, from_name: gift.purchaser_name, message: gift.message, term_months: 12 } };
}

/** Redeems at most once: the gift row is locked, and every later attempt finds no unredeemed gift. */
export async function redeemGift(token: string, session: Session): Promise<Record<string, unknown>> {
  let started: { subscriptionId: string; invoice: BilledInvoice } | null = null;
  const result = await transaction(async (tx) => {
    const gift = await unredeemedByToken(token, tx, true);
    await lockAccount(tx, session.account.id);
    const now = new Date();
    if (await activeMembership(session.account.id, now, tx)) throw new ApiError("already_member");
    requireBilling();
    const kbAccount = await kbAccountFor(session.account);
    const { subscription, invoice } = await subscribe(kbAccount, `${gift.tier}-gift`, `${session.account.number}-gift-${gift.ref}`, `${gift.ref}-redeem`);
    started = { subscriptionId: subscription.subscriptionId, invoice };
    await tx.query("UPDATE gifts SET redeemed_at = now(), redeemed_by = $2 WHERE ref = $1", [gift.ref, session.account.id]);
    const membership = await startMembership(tx, session.account, gift.tier, "gift", subscription, invoice.amountCents, gift.ref);
    return { membership, first_invoice_cents: invoice.amountCents };
  }).catch(async (error: unknown) => {
    if (started) await undoMembershipStart(started);
    throw error;
  });
  wakeOutbox();
  return result;
}

export async function purchasedGift(ref: string, session: Session): Promise<Record<string, unknown>> {
  const gift = await findGift(ref);
  if (!gift || gift.purchaser_account_id !== session.account.id) throw new ApiError("not_found");
  return { gift: giftView(gift, true) };
}
