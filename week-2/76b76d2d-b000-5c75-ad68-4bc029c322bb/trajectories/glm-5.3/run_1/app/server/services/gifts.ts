import { DateTime } from 'luxon';
import { query, withTransaction, recordKbAccount } from './database';
import type { KillBillClient, KbInvoice, KbItem } from './killbill';
import type { OutboxService } from './outbox';
import type { Config } from '../config';
import { ApiError } from '../http/errors';
import { tierPrices, type Tier, type Locale } from '../domain/model';
import { dateOnly, torontoTz } from '../time';
import { giftRef, capabilityToken } from '../domain/ids';
import {
  giftReceiptEmail, giftDeliveredEmail, membershipStartedEmail,
  emailText, emailHtml,
} from '../mail/templates';
import { ensureKbAccount, nextSequence, type PatronAccount } from './membership';
import { kbSafe } from './kb-safe';
import { nextMovementId } from './finance';

export interface GiftView {
  ref: string;
  tier: Tier;
  price_cents: number;
  currency: 'CAD';
  recipient_name: string;
  recipient_email: string;
  state: 'unredeemed' | 'redeemed';
  redeemed_at: string | null;
}

export interface GiftDeps {
  cfg: Config;
  kb: KillBillClient;
  outbox: OutboxService;
}

export interface PurchaseGiftInput {
  tier: Tier;
  purchaserAccount: PatronAccount | null;
  purchaserName: string;
  purchaserEmail: string;
  purchaserLocale: Locale;
  recipientName: string;
  recipientEmail: string;
  recipientLocale: Locale;
  message: string;
  cardholderName: string;
}

export function giftInvoiceItems(ref: string, tier: Tier): KbItem[] {
  return [{
    itemType: 'EXTERNAL_CHARGE',
    description: `${ref} GIFT ${tier}`,
    amountCents: tierPrices[tier].annual,
  }];
}

/**
 * The one gift purchase rule: the purchaser is charged the tier's annual
 * price in one invoice; the receipt goes to the purchaser's locale and the
 * delivery email to the recipient's locale.
 */
export async function purchaseGift(
  deps: GiftDeps,
  input: PurchaseGiftInput,
): Promise<GiftView> {
  const { cfg, kb, outbox } = deps;
  const ref = giftRef();
  const priceCents = tierPrices[input.tier].annual;
  const giftToken = capabilityToken();

  await withTransaction(async (client) => {
    const kbAccountId = input.purchaserAccount
      ? await ensureKbAccount(kb, input.purchaserAccount)
      : await ensureGuestKbAccount(kb, input.purchaserName, input.purchaserEmail, input.purchaserLocale);
    const invoice = await kbSafe(kb.createChargeInvoice(kbAccountId, giftInvoiceItems(ref, input.tier)));
    const payNow = Math.max(0, invoice.amountCents - invoice.creditAppliedCents);
    let paymentId: string | null = null;
    if (payNow > 0) {
      paymentId = (await kbSafe(kb.payInvoice(invoice.id, kbAccountId, payNow))).paymentId;
    }
    await client.query(
      `INSERT INTO gifts (ref, purchaser_account_id, purchaser_name, purchaser_email, purchaser_locale,
        recipient_name, recipient_email, recipient_locale, tier, price_cents, message, cardholder_name,
        state, kb_account_id, credit_applied_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'unredeemed',$13,$14)`,
      [ref, input.purchaserAccount?.id ?? null, input.purchaserName, input.purchaserEmail,
        input.purchaserLocale, input.recipientName, input.recipientEmail, input.recipientLocale,
        input.tier, priceCents, input.message, input.cardholderName, kbAccountId, invoice.creditAppliedCents],
    );
    if (invoice.creditAppliedCents > 0 && input.purchaserAccount) {
      const movementId = await nextMovementId(client);
      await client.query(
        `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
         VALUES ($1,$2,'member-credit',$3,'spend',$4)`,
        [movementId, input.purchaserAccount.number, -invoice.creditAppliedCents, ref],
      );
      await client.query(
        `INSERT INTO credit_ledger (movement_id, account_number, ledger_account, amount_cents, kind, reference)
         VALUES ($1,$2,'credit-redeemed',$3,'spend',$4)`,
        [movementId, input.purchaserAccount.number, invoice.creditAppliedCents, ref],
      );
    }
    await client.query(`INSERT INTO gift_tokens (token, gift_ref) VALUES ($1,$2)`, [giftToken, ref]);
    const receipt = giftReceiptEmail(input.purchaserLocale, {
      giftRef: ref,
      tier: input.tier,
      recipientName: input.recipientName,
      amountCents: priceCents,
    });
    outbox.enqueueInTx(client, {
      messageKey: `gift-receipt:${ref}`,
      kind: 'gift-receipt',
      to: input.purchaserEmail,
      subject: receipt.subject,
      bodyText: emailText(receipt.lines),
      html: emailHtml(receipt.lines),
      locale: input.purchaserLocale,
    });
    const delivered = giftDeliveredEmail(input.recipientLocale, {
      purchaserName: input.purchaserName,
      tier: input.tier,
      message: input.message,
      link: `${cfg.publicUrl}/${input.recipientLocale}/gift/${giftToken}`,
    });
    outbox.enqueueInTx(client, {
      messageKey: `gift-delivered:${ref}`,
      kind: 'gift-delivered',
      to: input.recipientEmail,
      subject: delivered.subject,
      bodyText: emailText(delivered.lines),
      html: emailHtml(delivered.lines),
      locale: input.recipientLocale,
    });
  });

  return {
    ref,
    tier: input.tier,
    price_cents: priceCents,
    currency: 'CAD',
    recipient_name: input.recipientName,
    recipient_email: input.recipientEmail,
    state: 'unredeemed',
    redeemed_at: null,
  };
}

async function ensureGuestKbAccount(
  kb: KillBillClient,
  name: string,
  email: string,
  locale: Locale,
): Promise<string> {
  const externalKey = `guest-${email.toLowerCase()}`;
  const existing = await kb.getAccountByExternalKey(externalKey);
  if (existing) return existing.accountId;
  const created = await kbSafe(kb.createAccount({
    externalKey, name, email, locale,
  }));
  await recordKbAccount(created.accountId, externalKey);
  await kbSafe(kb.addExternalPaymentMethod(created.accountId));
  return created.accountId;
}

export interface GiftRecord {
  ref: string;
  tier: Tier;
  state: string;
  purchaserName: string;
  message: string;
  recipientName: string;
  recipientLocale: Locale;
  recipientEmail: string;
  redeemedAt: Date | null;
}

export async function giftByToken(token: string): Promise<GiftRecord | null> {
  const res = await query<{
    ref: string; tier: Tier; state: string; purchaser_name: string; message: string;
    recipient_name: string; recipient_locale: Locale; recipient_email: string; redeemed_at: Date | null;
  }>(
    `SELECT g.ref, g.tier, g.state, g.purchaser_name, g.message,
            g.recipient_name, g.recipient_locale, g.recipient_email, g.redeemed_at
     FROM gift_tokens t JOIN gifts g ON g.ref = t.gift_ref
     WHERE t.token = $1`,
    [token],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    ref: row.ref,
    tier: row.tier,
    state: row.state,
    purchaserName: row.purchaser_name,
    message: row.message,
    recipientName: row.recipient_name,
    recipientLocale: row.recipient_locale,
    recipientEmail: row.recipient_email,
    redeemedAt: row.redeemed_at,
  };
}

export interface GiftTokenView {
  ref: string;
  tier: Tier;
  from_name: string;
  message: string;
  term_months: 12;
}

export function giftTokenView(gift: GiftRecord): GiftTokenView {
  return {
    ref: gift.ref,
    tier: gift.tier,
    from_name: gift.purchaserName,
    message: gift.message,
    term_months: 12,
  };
}

/**
 * The one redemption rule: at most once, decided in the database under the
 * gift row lock; it starts exactly one subscription on the tier's gift plan
 * whose first invoice is 0.00, and the link stops working once redeemed.
 */
export async function redeemGift(
  deps: GiftDeps,
  token: string,
  redeemer: PatronAccount,
): Promise<{ membership: Record<string, unknown>; first_invoice_cents: 0 }> {
  const { kb, outbox } = deps;
  const gift = await giftByToken(token);
  if (!gift || gift.state !== 'unredeemed') throw new ApiError('not_found');

  const existing = await query('SELECT account_id FROM memberships WHERE account_id = $1', [redeemer.id]);
  if (existing.rows.length > 0) throw new ApiError('already_member');

  const plan = `${gift.tier}-gift`;
  const startedOn = DateTime.now().setZone(torontoTz).startOf('day');
  const endsOn = startedOn.plus({ months: 12 });

  const membership = await withTransaction(async (client) => {
    const lock = await client.query<{ state: string }>(
      'SELECT state FROM gifts WHERE ref=$1 FOR UPDATE',
      [gift.ref],
    );
    if (lock.rows[0].state !== 'unredeemed') throw new ApiError('not_found');
    const memberAgain = await client.query('SELECT account_id FROM memberships WHERE account_id = $1', [redeemer.id]);
    if (memberAgain.rows.length > 0) throw new ApiError('already_member');

    const kbAccountId = await ensureKbAccount(kb, redeemer);
    const before = await kbSafe(kb.accountInvoices(kbAccountId));
    const lastNumber = before.length > 0 ? before[before.length - 1].invoiceNumber : '0';
    await kbSafe(kb.createSubscription(kbAccountId, plan));
    const invoice = await kbSafe(kb.waitForNewInvoice(kbAccountId, lastNumber));
    if (!invoice) throw new ApiError('billing_unavailable');

    await client.query(
      `UPDATE gifts SET state='redeemed', redeemed_at=now(), redeemed_by=$2 WHERE ref=$1`,
      [gift.ref, redeemer.id],
    );
    await client.query(
      `INSERT INTO membership_invoices (account_number, invoice_number, amount_cents, credit_applied_cents)
       VALUES ($1,$2,0,0)`,
      [redeemer.number, invoice.number],
    );
    await client.query(`DELETE FROM gift_tokens WHERE gift_ref = $1`, [gift.ref]);
    await client.query(
      `INSERT INTO memberships (account_id, tier, cadence, plan, state, started_on, charged_through, ends_on, gift, kb_account_id)
       VALUES ($1,$2,'gift',$3,'active',$4,$5,$6,true,$7)`,
      [redeemer.id, gift.tier, plan, startedOn.toJSDate(), endsOn.toJSDate(), endsOn.toJSDate(), kbAccountId],
    );
    const email = membershipStartedEmail(redeemer.locale, {
      accountNumber: redeemer.number,
      tier: gift.tier,
      cadence: 'gift',
      amountCents: 0,
      nextDate: dateOnly(endsOn),
    });
    const seq = await nextSequence(client, `membership-started:${redeemer.number}`);
    outbox.enqueueInTx(client, {
      messageKey: `membership-started:${redeemer.number}:${seq}`,
      kind: 'membership-started',
      to: redeemer.email,
      subject: email.subject,
      bodyText: emailText(email.lines),
      html: emailHtml(email.lines),
      locale: redeemer.locale,
    });
    return {
      tier: gift.tier,
      cadence: 'gift' as const,
      plan,
      state: 'active' as const,
      started_on: dateOnly(startedOn),
      charged_through: dateOnly(endsOn),
      ends_on: dateOnly(endsOn),
      pending_change: null,
    };
  });

  return { membership: membership as unknown as Record<string, unknown>, first_invoice_cents: 0 };
}
