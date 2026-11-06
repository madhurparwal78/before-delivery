import type { Locale } from '../../shared/money.ts';
import { LOCALES, TIERS, TIER_PLANS, type Tier } from '../../shared/domain.ts';
import { one, transaction } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { assertBillingUp } from './guard.ts';
import { Validator } from '../http/validate.ts';
import { capabilityToken, giftRef as newGiftRef } from '../domain/ids.ts';
import { toIso } from '../domain/time.ts';
import { creditBalance, writeMovement } from '../repo/credit.ts';
import { ensureGuestBillingAccount, ensurePatronBillingAccount } from '../repo/accounts.ts';
import { createChargeInvoice, payInvoice, voidInvoice } from '../killbill/client.ts';
import { enqueueMail } from '../mail/outbox.ts';
import { giftDeliveredEmail, giftReceiptEmail } from '../mail/templates.ts';
import type { SessionAccount } from '../http/context.ts';
import { activeMembership, hasLiveVerification, startGiftMembership, type MembershipPayload } from './membership.ts';

export type GiftRow = {
  id: number;
  ref: string;
  tier: Tier;
  price_cents: number;
  purchaser_account_id: number | null;
  purchaser_name: string;
  purchaser_email: string;
  recipient_name: string;
  recipient_email: string;
  recipient_locale: Locale;
  locale: Locale;
  message: string;
  state: 'unredeemed' | 'redeemed';
  token: string | null;
  credit_applied_cents: number;
  paid_cents: number;
  redeemed_at: Date | null;
};

export function giftPayload(row: GiftRow): Record<string, unknown> {
  return {
    ref: row.ref,
    tier: row.tier,
    price_cents: row.price_cents,
    currency: 'CAD',
    recipient_name: row.recipient_name,
    recipient_email: row.recipient_email,
    state: row.state,
    redeemed_at: row.redeemed_at === null ? null : toIso(row.redeemed_at),
  };
}

export async function purchaseGift(input: {
  account: SessionAccount | null;
  sessionToken: string | null;
  locale: Locale;
  body: Record<string, unknown>;
  now: Date;
}): Promise<Record<string, unknown>> {
  const validator = new Validator();
  const tier = validator.enumValue('tier', input.body.tier, TIERS);
  const purchaser = (input.body.purchaser ?? {}) as Record<string, unknown>;
  const recipient = (input.body.recipient ?? {}) as Record<string, unknown>;
  const purchaserName =
    input.account === null ? validator.text('purchaser.name', purchaser.name, 1, 80) : input.account.name;
  const purchaserEmail =
    input.account === null ? validator.email('purchaser.email', purchaser.email) : input.account.email;
  const recipientName = validator.text('recipient.name', recipient.name, 1, 80);
  const recipientEmail = validator.email('recipient.email', recipient.email);
  const recipientLocale = validator.enumValue('recipient.locale', recipient.locale ?? input.locale, LOCALES);
  const message = validator.optionalText('message', input.body.message, 300);
  const price = TIER_PLANS[tier].annual;
  const balance = await creditBalance(input.account?.number ?? null);
  const credit = Math.min(balance, price);
  const cardholder =
    price - credit > 0
      ? validator.text('cardholder_name', input.body.cardholder_name, 1, 80)
      : validator.optionalText('cardholder_name', input.body.cardholder_name, 80);
  validator.check();

  if (credit > 0 && !(await hasLiveVerification(input.sessionToken, input.now))) {
    throw new ApiError('stepup_required');
  }
  assertBillingUp();

  const ref = newGiftRef();
  const kbAccountId =
    input.account === null
      ? await ensureGuestBillingAccount({ name: purchaserName, email: purchaserEmail, locale: input.locale })
      : await ensurePatronBillingAccount(input.account);

  let invoiceId: string | null = null;
  let paymentId: string | null = null;
  let creditApplied = 0;
  let paidCents = 0;
  try {
    const invoice = await createChargeInvoice(
      kbAccountId,
      [{ description: `${ref} GIFT ${tier}`, amount_cents: price }],
      [],
    );
    invoiceId = invoice.invoice_id;
    creditApplied = invoice.credit_applied_cents;
    paidCents = invoice.balance_cents;
    if (paidCents > 0) paymentId = await payInvoice(kbAccountId, invoice.invoice_id, paidCents);
  } catch (error) {
    if (invoiceId !== null) await voidInvoice(invoiceId).catch(() => undefined);
    throw error;
  }

  const token = capabilityToken();
  const row = await transaction(async (tx) => {
    const created = await tx.one<GiftRow>(
      `insert into gifts(ref, tier, price_cents, purchaser_account_id, purchaser_name, purchaser_email,
         recipient_name, recipient_email, recipient_locale, locale, message, cardholder_name, state, token,
         credit_applied_cents, paid_cents, kb_invoice_id, kb_payment_id)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'unredeemed',$13,$14,$15,$16,$17) returning *`,
      [
        ref,
        tier,
        price,
        input.account?.id ?? null,
        purchaserName,
        purchaserEmail,
        recipientName,
        recipientEmail,
        recipientLocale,
        input.locale,
        message,
        cardholder,
        token,
        creditApplied,
        paidCents,
        invoiceId,
        paymentId,
      ],
    );
    if (creditApplied > 0 && input.account?.number != null) {
      await writeMovement(tx, {
        accountNumber: input.account.number,
        kind: 'spend',
        amountCents: creditApplied,
        reference: ref,
      });
    }
    await enqueueMail(
      tx,
      giftReceiptEmail({
        ref,
        email: purchaserEmail,
        locale: input.locale,
        tier,
        recipient_name: recipientName,
        amount_cents: price,
      }),
    );
    await enqueueMail(
      tx,
      giftDeliveredEmail({
        ref,
        email: recipientEmail,
        locale: recipientLocale,
        tier,
        purchaser_name: purchaserName,
        message,
        token,
      }),
    );
    return created!;
  }).catch(async (error: unknown) => {
    if (invoiceId !== null) await voidInvoice(invoiceId).catch(() => undefined);
    throw error;
  });

  return giftPayload(row);
}

export async function giftByToken(token: string): Promise<GiftRow | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return one<GiftRow>("select * from gifts where token = $1 and state = 'unredeemed'", [token]);
}

export async function giftByRef(ref: string): Promise<GiftRow | null> {
  return one<GiftRow>('select * from gifts where upper(ref) = upper($1)', [ref]);
}

export async function redeemGift(input: {
  token: string;
  account: SessionAccount;
  now: Date;
}): Promise<{ membership: MembershipPayload; first_invoice_cents: number }> {
  const gift = await giftByToken(input.token);
  if (gift === null) throw new ApiError('not_found');
  if ((await activeMembership(input.account.id)) !== null) throw new ApiError('already_member');
  const claimed = await transaction(async (tx) => {
    const rows = await tx.query<{ id: number }>(
      `update gifts set state='redeemed', redeemed_at=now(), redeemed_by=$2, token=null
         where id = $1 and state='unredeemed' returning id`,
      [gift.id, input.account.id],
    );
    return rows.length === 1;
  });
  if (!claimed) throw new ApiError('not_found');
  try {
    const membership = await startGiftMembership({ account: input.account, tier: gift.tier, now: input.now });
    return { membership, first_invoice_cents: 0 };
  } catch (error) {
    await transaction(async (tx) => {
      await tx.query(
        `update gifts set state='unredeemed', redeemed_at=null, redeemed_by=null, token=$2 where id = $1`,
        [gift.id, gift.token],
      );
    });
    throw error;
  }
}
